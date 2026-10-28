import {randomUUID} from 'node:crypto';
import WebSocket from 'ws';
import {AgentMessage,allowedRequestKinds,type AgentMessage as Message} from '@trading-poc/contracts';
import type {ReadOnlyBrokerAdapter,SubscriptionHandle,ResolvedContract} from '../connection/adapter.ts';

const allowedUrl=(raw:string)=>{
  const u=new URL(raw);
  if(u.protocol!=='ws:'&&u.protocol!=='wss:')return false;
  if(['127.0.0.1','localhost'].includes(u.hostname))return true;
  const n=u.hostname.split('.').map(Number);
  return n.length===4&&n.every(x=>Number.isInteger(x)&&x>=0&&x<=255)&&
    (n[0]===10||(n[0]===172&&n[1]>=16&&n[1]<=31)||(n[0]===192&&n[1]===168)||(n[0]===100&&n[1]>=64&&n[1]<=127));
};
export class AgentTransport {
  private socket:WebSocket|null=null;private sequence=0;private connectionId=randomUUID();private lastBackendSequence=-1;
  private handles=new Map<string,SubscriptionHandle>();private heartbeat:NodeJS.Timeout|null=null;
  private subscribing=new Map<string,Promise<SubscriptionHandle>>();
  private resolvedOptions=new Map<number,ResolvedContract>();
  private closedResolver:(()=>void)|null=null;private closedPromise:Promise<void>=Promise.resolve();
  constructor(private readonly adapter:ReadOnlyBrokerAdapter,private readonly config:{url:string;agentId:string;secret:string;simulation?:boolean}){
    if(!allowedUrl(config.url))throw new Error('Transporte remoto requiere wss o Tailscale privada');
    if(!config.secret||!config.agentId)throw new Error('Identidad y secreto del agente requeridos');
  }
  private send(kind:Message['kind'],payload:Record<string,unknown>,requestId:string|null=null){
    if(!this.socket||this.socket.readyState!==WebSocket.OPEN)return;
    const m:Message={protocolVersion:1,messageId:randomUUID(),requestId,agentId:this.config.agentId,connectionId:this.connectionId,sequence:this.sequence++,issuedAtUtc:new Date().toISOString(),kind,payload};
    this.socket.send(JSON.stringify(m));
  }
  async connect():Promise<void>{
    const status=await this.adapter.getStatus();
    if(!status.connected||status.environment!=='PAPER'||!status.accountVerified)throw new Error('Agente requiere Paper verificado');
    this.connectionId=randomUUID();this.sequence=0;this.lastBackendSequence=-1;this.resolvedOptions.clear();
    this.closedPromise=new Promise(resolve=>{this.closedResolver=resolve;});
    await new Promise<void>((resolve,reject)=>{
      const socket=new WebSocket(this.config.url,{headers:{Authorization:'Bearer '+this.config.secret},maxPayload:65536});
      this.socket=socket;const timer=setTimeout(()=>{socket.terminate();reject(new Error('Timeout de canal privado'));},10000);
      socket.on('open',()=>{clearTimeout(timer);this.send('agent.hello',{environment:'PAPER',accountVerified:true,simulation:!!this.config.simulation,status});this.heartbeat=setInterval(()=>this.send('agent.heartbeat',{status:'connected'}),10000);resolve();});
      socket.on('error',e=>{clearTimeout(timer);reject(e);});
      socket.on('message',raw=>{if(Buffer.byteLength(String(raw))>65536){socket.close(1009);return;}this.onMessage(String(raw)).catch(()=>{
        console.warn(JSON.stringify({component:'ibkr-agent',event:'request_handler_failure',stage:'agent',code:'BROKER_ERROR'}));
      });});
      socket.on('close',()=>{if(this.socket!==socket)return;if(this.heartbeat)clearInterval(this.heartbeat);this.heartbeat=null;this.socket=null;this.closedResolver?.();});
    });
  }
  get connected(){return this.socket?.readyState===WebSocket.OPEN;}
  waitUntilClosed(){return this.closedPromise;}
  private async onMessage(raw:string){
    let parsed:ReturnType<typeof AgentMessage.safeParse>;
    try{parsed=AgentMessage.safeParse(JSON.parse(raw));}catch{return;}
    if(!parsed.success)return;
    const m=parsed.data;
    if(m.agentId!=='backend'||m.connectionId!==this.connectionId||m.sequence<=this.lastBackendSequence||!allowedRequestKinds.includes(m.kind as any)||!m.requestId)return;
    this.lastBackendSequence=m.sequence;
    const connectionId=this.connectionId;
    const respond=(kind:Message['kind'],payload:Record<string,unknown>,requestId:string|null=m.requestId)=>{
      if(this.connectionId===connectionId)this.send(kind,payload,requestId);
    };
    const startedAt=Date.now();
    try{
      if(m.kind==='market.subscribe'){
        const symbol=String(m.payload.symbol??'');
        const key=String(m.payload.conId??symbol);
        if(this.handles.has(key)){respond('agent.status',{subscribed:key,alreadyPresent:true});return;}
        let pending=this.subscribing.get(key);
        if(!pending){pending=(async()=>{
          let c:ResolvedContract;
          if(m.payload.conId!==undefined){
            const q=m.payload;
            const cached=this.resolvedOptions.get(Number(q.conId));
            c=cached?.expiration===String(q.expiration)&&cached.right===(q.right==='PUT'?'PUT':'CALL')&&cached.strike===Number(q.strike)?cached:
              await this.adapter.resolveOption({symbol:'NVDA',expiration:String(q.expiration),right:q.right==='PUT'?'PUT':'CALL',strike:Number(q.strike)});
            if(c.conId!==Number(q.conId))throw new Error('Contrato resuelto distinto de conId solicitado');
          }else c=await this.adapter.resolveStock(symbol);
          return this.adapter.subscribeQuotes([c],quote=>respond(c.secType==='OPT'?'option.quote':'market.quote',quote as unknown as Record<string,unknown>,null));
        })();this.subscribing.set(key,pending);}
        let handle:SubscriptionHandle;try{handle=await pending;}finally{this.subscribing.delete(key);}
        if(this.connectionId!==connectionId){await handle.cancel();return;}
        this.handles.set(key,handle);respond('agent.status',{subscribed:key});
      }else if(m.kind==='market.unsubscribe'){
        const key=String(m.payload.conId??m.payload.symbol??'');
        if(this.subscribing.has(key))await this.subscribing.get(key);
        const h=this.handles.get(key);if(h){await h.cancel();this.handles.delete(key);}respond('agent.status',{unsubscribed:key});
      }else if(m.kind==='option.resolve'){
        const c=await this.adapter.resolveOption({symbol:'NVDA',expiration:String(m.payload.expiration),right:m.payload.right==='PUT'?'PUT':'CALL',strike:Number(m.payload.strike)});
        if(this.connectionId===connectionId){this.resolvedOptions.set(c.conId,c);respond('option.resolve',{contract:c});}
      }else if(m.kind==='option.parameters'){
        const stock=await this.adapter.resolveStock('NVDA');
        const p=await this.adapter.getOptionParameters(stock.conId);respond('option.parameters',{items:p});
      }else if(m.kind==='broker.positions.request'){
        respond('broker.positions.snapshot',{items:await this.adapter.getPositions()});
      }else if(m.kind==='broker.executions.request'){
        respond('broker.executions.snapshot',{items:await this.adapter.getExecutions({})});
      }
    }catch(e){
      const error=e as {code?:unknown;stage?:unknown;ibkrCode?:unknown;twsRequestId?:unknown};
      const code=typeof error.code==='string'&&['TIMEOUT','NOT_FOUND','AMBIGUOUS','PERMISSION','PACING','DISCONNECTED','BROKER_ERROR',
        'PARTIAL_MARKET_DATA','DELAYED_DATA_UNAVAILABLE','SESSION_CONFLICT_REPORTED','SUBSCRIPTION_LIMIT'].includes(error.code)?error.code:'BROKER_ERROR';
      const stage=typeof error.stage==='string'&&['contract_details','option_parameters','market_data','agent'].includes(error.stage)?error.stage:'agent';
      const ibkrCode=typeof error.ibkrCode==='number'?error.ibkrCode:null;
      const twsRequestId=typeof error.twsRequestId==='number'&&Number.isSafeInteger(error.twsRequestId)?error.twsRequestId:null;
      console.warn(JSON.stringify({component:'ibkr-agent',event:'request_failed',kind:m.kind,requestId:m.requestId,
        durationMs:Date.now()-startedAt,stage,code,...(ibkrCode!==null?{ibkrCode}:{}),...(twsRequestId!==null?{twsRequestId}:{})}));
      respond('agent.error',{code,stage,...(ibkrCode!==null?{ibkrCode}:{}),...(twsRequestId!==null?{twsRequestId}:{})});
    }
  }
  async close(){if(this.heartbeat)clearInterval(this.heartbeat);for(const h of this.handles.values())await h.cancel();this.handles.clear();this.subscribing.clear();this.resolvedOptions.clear();this.socket?.close();this.closedResolver?.();}
}
