import {randomUUID,timingSafeEqual} from 'node:crypto';
import {AgentMessage,MarketQuote,OptionQuote,BrokerPosition,FeedType,allowedRequestKinds,agentRequestBudgets,type AgentMessage as Message} from '@trading-poc/contracts';
import {z} from 'zod';

type Socket={send:(data:string)=>void;close:(code?:number,reason?:string)=>void;on:(event:string,callback:(data:any)=>void)=>void;readyState:number};
const MAX_BYTES=65536;
export class AgentRequestError extends Error {
  constructor(public readonly code:string,public readonly stage:string,public readonly requestId:string,
    public readonly ibkrCode:number|null=null,public readonly twsRequestId:number|null=null){super(code==='DISCONNECTED'?'Agente desconectado':code);this.name='AgentRequestError';}
}
const diagnostic=(event:string,kind:string,requestId:string,durationMs:number,stage:string,code?:string,ibkrCode?:number|null)=>
  console.warn(JSON.stringify({component:'agent-hub',event,kind,requestId,durationMs,stage,...(code?{code}:{}),...(ibkrCode!=null?{ibkrCode}:{})}));
export class AgentHub {
  private socket:Socket|null=null;private agentId:string|null=null;private connectionId:string|null=null;
  private lastSequence=-1;private outboundSequence=0;private lastHeartbeat:string|null=null;
  private pending=new Map<string,{kind:string;startedAt:number;resolve:(value:Message)=>void;reject:(e:Error)=>void;timer:NodeJS.Timeout}>();
  private expired=new Map<string,{kind:string;at:number;payload:Record<string,unknown>}>();
  private readonly budgets=agentRequestBudgets();
  private subscriptions=new Map<string,Record<string,unknown>>();
  private subscribing=new Map<string,Promise<Message>>();
  private consumers=new Map<string,Set<string>>();
  private seenIds=new Set<string>();private seenOrder:string[]=[];private minuteStart=Date.now();private receivedInMinute=0;
  private quotes=new Map<string,Message>();
  private listeners=new Set<(event:Record<string,unknown>)=>void>();
  private environment:'PAPER'|'UNKNOWN'='UNKNOWN';private simulation=false;private feedType:string='UNKNOWN';private lastDataReceivedAtUtc:string|null=null;
  constructor(private readonly secret:string,private readonly onValidatedMessage?:(message:Message)=>void){}
  authorize(value:string|undefined):boolean{
    if(!this.secret||!value?.startsWith('Bearer '))return false;
    const supplied=Buffer.from(value.slice(7));const expected=Buffer.from(this.secret);
    return supplied.length===expected.length&&timingSafeEqual(supplied,expected);
  }
  status(){return {connected:!!this.socket&&this.socket.readyState===1&&!!this.lastHeartbeat&&Date.now()-Date.parse(this.lastHeartbeat)<30000,agentId:this.agentId,connectionId:this.connectionId,environment:this.environment,simulation:this.simulation,feedType:this.feedType,lastDataReceivedAtUtc:this.lastDataReceivedAtUtc,lastHeartbeatUtc:this.lastHeartbeat,subscriptions:[...this.subscriptions.keys()]};}
  onEvent(listener:(event:Record<string,unknown>)=>void){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
  private publish(event:Record<string,unknown>){for(const listener of this.listeners)listener(event);}
  attach(socket:Socket){
    for(const [id,wait] of this.pending){clearTimeout(wait.timer);wait.reject(new AgentRequestError('DISCONNECTED','transport',id));}
    this.pending.clear();
    this.socket?.close(1000,'replaced');this.socket=socket;this.agentId=null;this.connectionId=null;this.lastSequence=-1;this.outboundSequence=0;this.environment='UNKNOWN';this.simulation=false;this.feedType='UNKNOWN';this.lastHeartbeat=null;this.lastDataReceivedAtUtc=null;this.quotes.clear();this.subscribing.clear();this.expired.clear();this.seenIds.clear();this.seenOrder=[];this.minuteStart=Date.now();this.receivedInMinute=0;
    this.publish({kind:'broker.status',broker:this.status(),atUtc:new Date().toISOString()});
    socket.on('message',(raw:Buffer|string)=>{
      if(this.socket!==socket)return;
      if(Buffer.byteLength(raw)>MAX_BYTES){socket.close(1009,'message too large');return;}
      let parsed:ReturnType<typeof AgentMessage.safeParse>;
      try{parsed=AgentMessage.safeParse(JSON.parse(String(raw)));}catch{socket.close(1003,'invalid JSON');return;}
      if(!parsed.success){socket.close(1008,'invalid message');return;}
      const message=parsed.data;
      if(Math.abs(Date.now()-Date.parse(message.issuedAtUtc))>300000){socket.close(1008,'message clock outside five minutes');return;}
      if(Date.now()-this.minuteStart>60000){this.minuteStart=Date.now();this.receivedInMinute=0;}
      if(++this.receivedInMinute>2000||this.seenIds.has(message.messageId)){socket.close(1008,'rate or replay');return;}
      this.seenIds.add(message.messageId);this.seenOrder.push(message.messageId);
      if(this.seenOrder.length>10000)this.seenIds.delete(this.seenOrder.shift()!);
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
      let late=false;
      if(message.requestId){
        const wait=this.pending.get(message.requestId);
        const expired=this.expired.get(message.requestId);
        const expected:Record<string,string>={'market.subscribe':'agent.status','market.unsubscribe':'agent.status',
          'option.resolve':'option.resolve','option.parameters':'option.parameters',
          'broker.positions.request':'broker.positions.snapshot',
          'broker.executions.request':'broker.executions.snapshot'};
        if(!wait&&!expired||message.kind!==expected[(wait??expired)!.kind]&&message.kind!=='agent.error'){
          socket.close(1008,'unexpected request response');return;
        }
        late=!wait;
      }
      this.lastSequence=message.sequence;this.lastHeartbeat=new Date().toISOString();
      if(late&&message.requestId){
        const expired=this.expired.get(message.requestId)!;this.expired.delete(message.requestId);
        diagnostic('late_response_discarded',expired.kind,message.requestId,Date.now()-expired.at,'backend',message.kind);
        if(expired.kind==='market.subscribe'&&message.kind==='agent.status'){
          const key=String(expired.payload.conId??expired.payload.symbol??'');
          queueMicrotask(()=>{if(key&&!this.consumers.has(key)&&!this.subscriptions.has(key)&&!this.subscribing.has(key))
            this.request('market.unsubscribe',expired.payload).catch(error=>diagnostic('late_unsubscribe_failed','market.unsubscribe',message.requestId!,0,'backend',error instanceof AgentRequestError?error.code:'BROKER_ERROR'));});
        }
        return;
      }
      try{this.onValidatedMessage?.(message);}catch{socket.close(1011,'private storage failure');return;}
      if(message.kind==='market.quote'||message.kind==='option.quote'){
        this.quotes.set(String(message.payload.symbol??message.payload.conId??''),message);
        this.lastDataReceivedAtUtc=String(message.payload.receivedAtUtc);
        const feeds=new Set([...this.quotes.values()].map(quote=>String(quote.payload.feedType)));
        this.feedType=feeds.size===1?[...feeds][0]!:'UNKNOWN';
      }
      if(message.kind==='market.quote'||message.kind==='option.quote')this.publish({kind:message.kind,quote:message.payload,simulation:this.simulation,atUtc:new Date().toISOString()});
      if(message.kind==='agent.hello'||message.kind==='agent.status'||message.kind==='agent.error')this.publish({kind:'broker.status',broker:this.status(),atUtc:new Date().toISOString()});
      if(message.requestId){const wait=this.pending.get(message.requestId);if(wait){clearTimeout(wait.timer);this.pending.delete(message.requestId);wait.resolve(message);}}
    });
    socket.on('close',()=>{if(this.socket!==socket)return;this.socket=null;this.environment='UNKNOWN';this.quotes.clear();this.subscribing.clear();this.expired.clear();for(const [id,wait] of this.pending){clearTimeout(wait.timer);wait.reject(new AgentRequestError('DISCONNECTED','transport',id));}this.pending.clear();this.publish({kind:'broker.status',broker:this.status(),atUtc:new Date().toISOString()});});
  }
  latestQuote(key:string){return this.status().connected?this.quotes.get(key)?.payload??null:null;}
  optionPageTimeoutMs(){return this.budgets.optionPageMs;}
  async subscribe(payload:Record<string,unknown>,consumer='server',timeoutMs?:number){
    const key=String(payload.conId??payload.symbol??'');
    if(!key)throw new Error('Contrato sin identidad');
    const addConsumer=()=>{const users=this.consumers.get(key)??new Set<string>();users.add(consumer);this.consumers.set(key,users);};
    if(this.subscriptions.has(key)){addConsumer();return;}
    const pending=this.subscribing.get(key);if(pending){await pending;addConsumer();return;}
    if(this.subscriptions.size+this.subscribing.size>=10)throw new Error('Límite de 10 suscripciones IBKR');
    const request=this.request('market.subscribe',payload,timeoutMs);
    this.subscribing.set(key,request);
    try{await request;addConsumer();}finally{this.subscribing.delete(key);}
  }
  async release(key:string,consumer='server'){
    if(this.subscribing.has(key))await this.subscribing.get(key);
    const users=this.consumers.get(key);if(!users?.has(consumer))return;users.delete(consumer);
    if(users?.size)return;
    this.consumers.delete(key);
    if(!this.subscriptions.has(key))return;
    if(this.status().connected)await this.request('market.unsubscribe',this.subscriptions.get(key)!);
    else this.subscriptions.delete(key);
    this.quotes.delete(key);
  }
  async request(kind:typeof allowedRequestKinds[number],payload:Record<string,unknown>,timeoutMs?:number):Promise<Message>{
    if(!allowedRequestKinds.includes(kind)||!this.status().connected||this.environment!=='PAPER')throw new AgentRequestError('DISCONNECTED','backend','');
    const defaultMs=kind==='option.resolve'?this.budgets.optionResolveMs:kind==='option.parameters'?this.budgets.optionParametersMs:kind==='market.subscribe'?this.budgets.optionSubscribeMs:this.budgets.ordinaryMs;
    const budget=timeoutMs===undefined?defaultMs:Math.max(1000,Math.min(defaultMs,Math.floor(timeoutMs)));
    const requestId=randomUUID();const message:Message={protocolVersion:1,messageId:randomUUID(),requestId,agentId:'backend',connectionId:this.connectionId!,sequence:++this.outboundSequence,issuedAtUtc:new Date().toISOString(),kind,payload};
    const startedAt=Date.now();
    const result=await new Promise<Message>((resolve,reject)=>{
      const timer=setTimeout(()=>{
        this.pending.delete(requestId);this.expired.set(requestId,{kind,at:Date.now(),payload});
        for(const [id,item] of this.expired)if(Date.now()-item.at>120000||this.expired.size>1000)this.expired.delete(id);
        diagnostic('timeout',kind,requestId,Date.now()-startedAt,'backend','TIMEOUT');
        reject(new AgentRequestError('TIMEOUT','backend',requestId));
      },budget);
      this.pending.set(requestId,{kind,startedAt,resolve,reject,timer});
      try{this.socket!.send(JSON.stringify(message));}catch{
        clearTimeout(timer);this.pending.delete(requestId);reject(new AgentRequestError('DISCONNECTED','transport',requestId));
      }
    });
    if(result.kind==='agent.error'){
      const code=typeof result.payload.code==='string'?result.payload.code:'BROKER_ERROR';
      const stage=typeof result.payload.stage==='string'?result.payload.stage:'agent';
      const ibkrCode=typeof result.payload.ibkrCode==='number'?result.payload.ibkrCode:null;
      const twsRequestId=typeof result.payload.twsRequestId==='number'&&Number.isSafeInteger(result.payload.twsRequestId)?result.payload.twsRequestId:null;
      diagnostic('agent_error',kind,requestId,Date.now()-startedAt,stage,code,ibkrCode);
      throw new AgentRequestError(code,stage,requestId,ibkrCode,twsRequestId);
    }
    diagnostic('completed',kind,requestId,Date.now()-startedAt,'agent');
    if(kind==='market.subscribe'||kind==='market.unsubscribe'){
      const key=String(payload.conId??payload.symbol??'');
      if(result.payload[kind==='market.subscribe'?'subscribed':'unsubscribed']!==key)
        throw new Error('Acuse de suscripción IBKR no coincide con el contrato');
      if(kind==='market.subscribe')this.subscriptions.set(key,payload);
      else this.subscriptions.delete(key);
    }
    return result;
  }
}
