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
    this.connectionId=randomUUID();this.sequence=0;this.lastBackendSequence=-1;
    this.closedPromise=new Promise(resolve=>{this.closedResolver=resolve;});
    await new Promise<void>((resolve,reject)=>{
      const socket=new WebSocket(this.config.url,{headers:{Authorization:'Bearer '+this.config.secret},maxPayload:65536});
      this.socket=socket;const timer=setTimeout(()=>{socket.terminate();reject(new Error('Timeout de canal privado'));},10000);
      socket.on('open',()=>{clearTimeout(timer);this.send('agent.hello',{environment:'PAPER',accountVerified:true,simulation:!!this.config.simulation,status});this.heartbeat=setInterval(()=>this.send('agent.heartbeat',{status:'connected'}),10000);resolve();});
      socket.on('error',e=>{clearTimeout(timer);reject(e);});
      socket.on('message',raw=>{if(Buffer.byteLength(String(raw))>65536){socket.close(1009);return;}this.onMessage(String(raw)).catch(e=>this.send('agent.error',{message:String(e)}));});
      socket.on('close',()=>{if(this.heartbeat)clearInterval(this.heartbeat);this.heartbeat=null;this.socket=null;this.closedResolver?.();});
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
    try{
      if(m.kind==='market.subscribe'){
        const symbol=String(m.payload.symbol??'');
        const key=String(m.payload.conId??symbol);
        if(this.handles.has(key)){this.send('agent.status',{subscribed:key,alreadyPresent:true},m.requestId);return;}
        let pending=this.subscribing.get(key);
        if(!pending){pending=(async()=>{
          let c:ResolvedContract;
          if(m.payload.conId!==undefined){
            const q=m.payload;
            c=await this.adapter.resolveOption({symbol:'NVDA',expiration:String(q.expiration),right:q.right==='PUT'?'PUT':'CALL',strike:Number(q.strike)});
            if(c.conId!==Number(q.conId))throw new Error('Contrato resuelto distinto de conId solicitado');
          }else c=await this.adapter.resolveStock(symbol);
          return this.adapter.subscribeQuotes([c],quote=>this.send(c.secType==='OPT'?'option.quote':'market.quote',quote as unknown as Record<string,unknown>));
        })();this.subscribing.set(key,pending);}
        let handle:SubscriptionHandle;try{handle=await pending;}finally{this.subscribing.delete(key);}
        this.handles.set(key,handle);this.send('agent.status',{subscribed:key},m.requestId);
      }else if(m.kind==='market.unsubscribe'){
        const key=String(m.payload.conId??m.payload.symbol??'');
        if(this.subscribing.has(key))await this.subscribing.get(key);
        const h=this.handles.get(key);if(h){await h.cancel();this.handles.delete(key);}this.send('agent.status',{unsubscribed:key},m.requestId);
      }else if(m.kind==='option.resolve'){
        const c=await this.adapter.resolveOption({symbol:'NVDA',expiration:String(m.payload.expiration),right:m.payload.right==='PUT'?'PUT':'CALL',strike:Number(m.payload.strike)});
        this.send('option.resolve',{contract:c},m.requestId);
      }else if(m.kind==='option.parameters'){
        const stock=await this.adapter.resolveStock('NVDA');
        const p=await this.adapter.getOptionParameters(stock.conId);this.send('option.parameters',{items:p},m.requestId);
      }else if(m.kind==='broker.positions.request'){
        this.send('broker.positions.snapshot',{items:await this.adapter.getPositions()},m.requestId);
      }else if(m.kind==='broker.executions.request'){
        this.send('broker.executions.snapshot',{items:await this.adapter.getExecutions({})},m.requestId);
      }
    }catch(e){this.send('agent.error',{message:String(e)},m.requestId);}
  }
  async close(){if(this.heartbeat)clearInterval(this.heartbeat);for(const h of this.handles.values())await h.cancel();this.handles.clear();this.subscribing.clear();this.socket?.close();this.closedResolver?.();}
}
