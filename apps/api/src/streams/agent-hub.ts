import {randomUUID,timingSafeEqual} from 'node:crypto';
import {AgentMessage,MarketQuote,OptionQuote,BrokerPosition,FeedType,allowedRequestKinds,type AgentMessage as Message} from '@trading-poc/contracts';
import {z} from 'zod';

type Socket={send:(data:string)=>void;close:(code?:number,reason?:string)=>void;on:(event:string,callback:(data:any)=>void)=>void;readyState:number};
const MAX_BYTES=65536;
export class AgentHub {
  private socket:Socket|null=null;private agentId:string|null=null;private connectionId:string|null=null;
  private lastSequence=-1;private outboundSequence=0;private lastHeartbeat:string|null=null;
  private pending=new Map<string,{resolve:(value:Message)=>void;reject:(e:Error)=>void;timer:NodeJS.Timeout}>();
  private subscriptions=new Map<string,Record<string,unknown>>();
  private seenIds=new Set<string>();private minuteStart=Date.now();private receivedInMinute=0;
  private quotes=new Map<string,Message>();
  private environment:'PAPER'|'UNKNOWN'='UNKNOWN';private simulation=false;private feedType:string='UNKNOWN';private lastDataReceivedAtUtc:string|null=null;
  constructor(private readonly secret:string,private readonly onValidatedMessage?:(message:Message)=>void){}
  authorize(value:string|undefined):boolean{
    if(!this.secret||!value?.startsWith('Bearer '))return false;
    const supplied=Buffer.from(value.slice(7));const expected=Buffer.from(this.secret);
    return supplied.length===expected.length&&timingSafeEqual(supplied,expected);
  }
  status(){return {connected:!!this.socket&&this.socket.readyState===1&&!!this.lastHeartbeat&&Date.now()-Date.parse(this.lastHeartbeat)<30000,agentId:this.agentId,connectionId:this.connectionId,environment:this.environment,simulation:this.simulation,feedType:this.feedType,lastDataReceivedAtUtc:this.lastDataReceivedAtUtc,lastHeartbeatUtc:this.lastHeartbeat,subscriptions:[...this.subscriptions.keys()]};}
  attach(socket:Socket){
    this.socket?.close(1000,'replaced');this.socket=socket;this.agentId=null;this.connectionId=null;this.lastSequence=-1;this.outboundSequence=0;this.environment='UNKNOWN';this.simulation=false;this.feedType='UNKNOWN';this.lastDataReceivedAtUtc=null;this.seenIds.clear();this.minuteStart=Date.now();this.receivedInMinute=0;
    socket.on('message',(raw:Buffer|string)=>{
      if(Buffer.byteLength(raw)>MAX_BYTES){socket.close(1009,'message too large');return;}
      let parsed:ReturnType<typeof AgentMessage.safeParse>;
      try{parsed=AgentMessage.safeParse(JSON.parse(String(raw)));}catch{socket.close(1003,'invalid JSON');return;}
      if(!parsed.success){socket.close(1008,'invalid message');return;}
      const message=parsed.data;
      if(Date.now()-this.minuteStart>60000){this.minuteStart=Date.now();this.receivedInMinute=0;}
      if(++this.receivedInMinute>2000||this.seenIds.has(message.messageId)){socket.close(1008,'rate or replay');return;}
      this.seenIds.add(message.messageId);
      const incoming=['agent.hello','agent.heartbeat','agent.status','agent.error','market.quote','market.bar','option.resolve','option.parameters','option.quote','broker.positions.snapshot','broker.executions.snapshot'];
      if(!incoming.includes(message.kind)){socket.close(1008,'message not allowed');return;}
      if(message.kind==='market.quote'&&!MarketQuote.safeParse(message.payload).success){socket.close(1008,'quote invalid');return;}
      if(message.kind==='option.quote'&&!OptionQuote.safeParse(message.payload).success){socket.close(1008,'option quote invalid');return;}
      if(message.kind==='broker.positions.snapshot'&&!z.array(BrokerPosition).safeParse(message.payload.items).success){socket.close(1008,'positions invalid');return;}
      if(message.kind==='broker.executions.snapshot'&&!z.array(z.object({executionId:z.string().nullable(),accountAlias:z.string(),environment:z.literal('PAPER'),conId:z.number().nullable(),occSymbol:z.string().nullable(),side:z.enum(['BUY','SELL','UNKNOWN']),quantity:z.number().nullable(),price:z.number().nullable(),commission:z.number().nullable(),rawBrokerTime:z.string().nullable(),executedAtUtc:z.null(),receivedAtUtc:z.string(),timeStatus:z.string()})).safeParse(message.payload.items).success){socket.close(1008,'executions invalid');return;}
      if(this.agentId===null){
        if(message.kind!=='agent.hello'||message.sequence!==0||message.payload.environment!=='PAPER'||message.payload.accountVerified!==true){socket.close(1008,'PAPER handshake required');return;}
        this.agentId=message.agentId;this.connectionId=message.connectionId;this.environment='PAPER';this.simulation=message.payload.simulation===true;
        const initialFeed=(message.payload.status as Record<string,unknown>|undefined)?.feedType;
        this.feedType=FeedType.safeParse(initialFeed).success?String(initialFeed):'UNKNOWN';
        queueMicrotask(()=>{for(const payload of this.subscriptions.values())this.request('market.subscribe',payload).catch(()=>{});});
      }else if(message.agentId!==this.agentId||message.connectionId!==this.connectionId||message.sequence<=this.lastSequence){socket.close(1008,'replay or identity mismatch');return;}
      this.lastSequence=message.sequence;this.lastHeartbeat=new Date().toISOString();
      try{this.onValidatedMessage?.(message);}catch{socket.close(1011,'private storage failure');return;}
      if(message.kind==='market.quote'||message.kind==='option.quote'){this.quotes.set(String(message.payload.symbol??message.payload.conId??''),message);this.lastDataReceivedAtUtc=String(message.payload.receivedAtUtc);this.feedType=String(message.payload.feedType);}
      if(message.requestId){const wait=this.pending.get(message.requestId);if(wait){clearTimeout(wait.timer);this.pending.delete(message.requestId);wait.resolve(message);}}
    });
    socket.on('close',()=>{if(this.socket!==socket)return;this.socket=null;this.environment='UNKNOWN';for(const wait of this.pending.values()){clearTimeout(wait.timer);wait.reject(new Error('Agente desconectado'));}this.pending.clear();});
  }
  latestQuote(key:string){return this.quotes.get(key)?.payload??null;}
  async request(kind:typeof allowedRequestKinds[number],payload:Record<string,unknown>,timeoutMs=5000):Promise<Message>{
    if(!allowedRequestKinds.includes(kind)||!this.status().connected||this.environment!=='PAPER')throw new Error('Agente PAPER no disponible');
    const requestId=randomUUID();const message:Message={protocolVersion:1,messageId:randomUUID(),requestId,agentId:'backend',connectionId:this.connectionId!,sequence:++this.outboundSequence,issuedAtUtc:new Date().toISOString(),kind,payload};
    const result=await new Promise<Message>((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(requestId);reject(new Error('Tiempo de espera del agente'));},timeoutMs);this.pending.set(requestId,{resolve,reject,timer});this.socket!.send(JSON.stringify(message));});
    if(result.kind==='agent.error')throw new Error(String(result.payload.message??'Error del agente'));
    if(kind==='market.subscribe'){const key=String(payload.conId??payload.symbol??'');this.subscriptions.set(key,payload);}
    if(kind==='market.unsubscribe'){const key=String(payload.conId??payload.symbol??'');this.subscriptions.delete(key);}
    return result;
  }
}
