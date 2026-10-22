import type {MarketCalendar} from './alpaca-calendar.ts';
import {appendIexMinute, appendIexStatus, IEX_STREAM_URL, parseIexMinute} from './phase38-iex.ts';

export type SocketLike={send(data:string):void;close():void;addEventListener(type:'open'|'message'|'close'|'error',listener:(event:any)=>void):void};
export type StreamState='CONNECTING'|'CONNECTED'|'AUTHENTICATED'|'SUBSCRIBED'|'DISCONNECTED'|'AUTH_FAILED'|'CONNECTION_LIMIT'|'SUBSCRIPTION_FAILED'|'INVALID_MESSAGE';
export class IexStreamError extends Error { constructor(readonly state:StreamState){super(state);} }
export type StreamOptions={apiKey:string;secretKey:string;calendar:MarketCalendar;ledgerPath?:string;probe?:boolean;clock?:()=>number;socketFactory?:(url:string)=>SocketLike;signal?:AbortSignal;onState?:(state:StreamState)=>void};
const socketFactory=(url:string):SocketLike=>new WebSocket(url) as SocketLike;
/** One connection only. Authentication stays inside the socket and is never logged. */
export function connectIex(options:StreamOptions):Promise<void>{
  if(!options.apiKey||!options.secretKey)throw new IexStreamError('AUTH_FAILED');
  const clock=options.clock??Date.now,socket=(options.socketFactory??socketFactory)(IEX_STREAM_URL);
  let done=false,authenticated=false,subscribed=false;
  const state=(value:StreamState)=>{options.onState?.(value);if(options.ledgerPath&&!options.probe)appendIexStatus(options.ledgerPath,value,new Date(clock()).toISOString());};
  state('CONNECTING');
  return new Promise<void>((resolve,reject)=>{
    const timeout=setTimeout(()=>{finish(new IexStreamError('DISCONNECTED'));socket.close();},12_000);
    const abort=()=>{finish();socket.close();};
    const finish=(error?:Error)=>{if(done)return;done=true;clearTimeout(timeout);options.signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve();};
    options.signal?.addEventListener('abort',abort,{once:true});
    if(options.signal?.aborted){abort();return;}
    socket.addEventListener('open',()=>state('CONNECTED'));
    socket.addEventListener('error',()=>{state('DISCONNECTED');finish(new IexStreamError('DISCONNECTED'));});
    socket.addEventListener('close',()=>{state('DISCONNECTED');finish(subscribed&&options.probe?undefined:new IexStreamError('DISCONNECTED'));});
    socket.addEventListener('message',(event:any)=>{
      try{
        const raw=typeof event.data==='string'?event.data:String(event.data);
        if(raw.length>1_000_000)throw new IexStreamError('INVALID_MESSAGE');
        const messages:unknown=JSON.parse(raw);if(!Array.isArray(messages)||messages.length>100)throw new IexStreamError('INVALID_MESSAGE');
        const receivedAtUtc=new Date(clock()).toISOString();
        for(const item of messages){
          if(typeof item!=='object'||item===null||Array.isArray(item))throw new IexStreamError('INVALID_MESSAGE');
          const row=item as Record<string,unknown>;
          if(row.T==='success'&&row.msg==='connected')socket.send(JSON.stringify({action:'auth',key:options.apiKey,secret:options.secretKey}));
          else if(row.T==='success'&&row.msg==='authenticated'){
            authenticated=true;state('AUTHENTICATED');socket.send(JSON.stringify({action:'subscribe',bars:['NVDA'],updatedBars:['NVDA']}));
          }else if(row.T==='subscription'){
            if(!authenticated||JSON.stringify(row.bars)!=='["NVDA"]'||JSON.stringify(row.updatedBars)!=='["NVDA"]'||
               (Array.isArray(row.trades)&&row.trades.length>0)||(Array.isArray(row.quotes)&&row.quotes.length>0))throw new IexStreamError('SUBSCRIPTION_FAILED');
            subscribed=true;clearTimeout(timeout);state('SUBSCRIBED');if(options.probe){finish();socket.close();}
          }else if(row.T==='error'){
            const code=row.code;
            throw new IexStreamError(code===406?'CONNECTION_LIMIT':code===401||code===402||code===403?'AUTH_FAILED':'SUBSCRIPTION_FAILED');
          }else if(row.T==='b'||row.T==='u'){
            if(!subscribed||!options.ledgerPath||options.probe)throw new IexStreamError('INVALID_MESSAGE');
            const bar=parseIexMinute(row,receivedAtUtc,options.calendar);
            if(bar)appendIexMinute(options.ledgerPath,bar,receivedAtUtc,options.calendar);
          }else throw new IexStreamError('INVALID_MESSAGE');
        }
      }catch(error){const failure=error instanceof IexStreamError?error:new IexStreamError('INVALID_MESSAGE');state(failure.state);finish(failure);socket.close();}
    });
  });
}
export async function collectIex(options:StreamOptions & {pause?:(ms:number)=>Promise<void>;maxReconnects?:number}):Promise<void>{
  let attempts=0;const pause=options.pause??(ms=>new Promise<void>(resolve=>setTimeout(resolve,ms)));
  while(!options.signal?.aborted){
    try{await connectIex(options);if(options.probe)return;}
    catch(error){
      if(error instanceof IexStreamError&&['AUTH_FAILED','CONNECTION_LIMIT','SUBSCRIPTION_FAILED','INVALID_MESSAGE'].includes(error.state))throw error;
      if(options.signal?.aborted)return;
      if(attempts++>=(options.maxReconnects??10))throw error;
      await pause(Math.min(1000*2**Math.min(attempts-1,5),30_000));
    }
  }
}
