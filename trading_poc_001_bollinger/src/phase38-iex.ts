import {createHash} from 'node:crypto';
import {closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {isCalendarBar, type MarketCalendar} from './alpaca-calendar.ts';
import {newYorkBarParts} from './strategy-validation.ts';

export const IEX_STREAM_URL = 'wss://stream.data.alpaca.markets/v2/iex';
const MINUTE = 60_000, QUARTER = 15 * MINUTE, MAX_LATENCY = 15 * MINUTE;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export type IexBar = {startUtc:string; endUtc:string; open:number; high:number; low:number; close:number; volume:number; tradeCount:number};
export type IexRecord = {
  schema:'phase38-iex-v1'; id:string; previousHash:string|null; recordHash:string;
  kind:'minute'|'quarter'|'status'; feed:'iex'; adjustment:'raw'; symbol:'NVDA';
  eventAtUtc:string|null; receivedAtUtc:string; status:string; bar:IexBar|null;
  revision:number|null; sourceMessageHash:string|null; latencyMs:number|null;
};
type Input=Omit<IexRecord,'schema'|'id'|'previousHash'|'recordHash'>;
export function readIexLedger(path:string):IexRecord[]{
  if(!existsSync(path))return [];
  const lines=readFileSync(path,'utf8');if(lines.length>100_000_000)throw new Error('Ledger IEX demasiado grande.');
  let previous:string|null=null;
  return lines.split(/\r?\n/).filter(Boolean).map(line=>{
    const record=JSON.parse(line) as IexRecord;const {recordHash,...unsigned}=record;
    if(record.schema!=='phase38-iex-v1'||record.previousHash!==previous||hash(JSON.stringify(unsigned))!==recordHash||record.feed!=='iex'||record.symbol!=='NVDA'||record.adjustment!=='raw')throw new Error('Integridad del ledger IEX inválida.');
    previous=recordHash;return record;
  });
}
function locked<T>(path:string,work:()=>T):T{
  mkdirSync(dirname(path),{recursive:true});const lock=`${path}.lock`;let fd:number|undefined;const until=Date.now()+5000;
  while(fd===undefined){try{fd=openSync(lock,'wx');}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'||Date.now()>until)throw error;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);}}
  try{return work();}finally{closeSync(fd);rmSync(lock,{force:true});}
}
function append(path:string,prior:IexRecord[],inputs:Input[]):IexRecord[]{
  const written:IexRecord[]=[];
  for(const input of inputs){
    const unsigned={schema:'phase38-iex-v1' as const,id:hash(JSON.stringify(input)),previousHash:(written.at(-1)??prior.at(-1))?.recordHash??null,...input};
    const row={...unsigned,recordHash:hash(JSON.stringify(unsigned))};
    writeFileSync(path,JSON.stringify(row)+'\n',{flag:'a'});written.push(row);
  }
  return written;
}
export function appendIexStatus(path:string,status:string,at:string=new Date().toISOString()):void{
  if(!/^[A-Z_]{2,40}$/.test(status))throw new Error('Estado IEX inválido.');
  locked(path,()=>{append(path,readIexLedger(path),[{kind:'status',feed:'iex',adjustment:'raw',symbol:'NVDA',eventAtUtc:null,receivedAtUtc:at,status,bar:null,revision:null,sourceMessageHash:null,latencyMs:null}]);});
}
export function parseIexMinute(value:unknown,receivedAtUtc:string,calendar:MarketCalendar):{bar:IexBar;eventAtUtc:string;sourceMessageHash:string;latencyMs:number;updated:boolean}|null{
  if(typeof value!=='object'||value===null||Array.isArray(value))throw new Error('Mensaje IEX inválido.');
  const row=value as Record<string,unknown>;
  if(row.T!=='b'&&row.T!=='u')return null;
  if(row.S!=='NVDA'||typeof row.t!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:\.0+)?Z$/.test(row.t))throw new Error('Vela IEX con símbolo o timestamp inválido.');
  const start=Date.parse(row.t),received=Date.parse(receivedAtUtc);
  if(!Number.isFinite(start)||!Number.isFinite(received)||start%MINUTE!==0)throw new Error('Timestamp IEX inválido.');
  if(!isCalendarBar(start,calendar))return null;
  const latency=received-start-MINUTE;
  if(latency<0||latency>MAX_LATENCY)throw new Error('Latencia IEX inválida o excesiva.');
  const [o,h,l,c,v,n]=[row.o,row.h,row.l,row.c,row.v,row.n];
  if([o,h,l,c,v,n].some(x=>typeof x!=='number'||!Number.isFinite(x))||
    (o as number)<=0||(l as number)<=0||(h as number)<Math.max(o as number,c as number,l as number)||
    (l as number)>Math.min(o as number,c as number)||!Number.isSafeInteger(v)||!Number.isSafeInteger(n)||(v as number)<0||(n as number)<0)throw new Error('OHLCV IEX inválido.');
  const eventAtUtc=new Date(start).toISOString();
  return {bar:{startUtc:eventAtUtc,endUtc:new Date(start+MINUTE).toISOString(),open:o as number,high:h as number,low:l as number,close:c as number,volume:v as number,tradeCount:n as number},eventAtUtc,sourceMessageHash:hash(JSON.stringify(value)),latencyMs:latency,updated:row.T==='u'};
}
/** One atomic decision for minute revisions and completed 15-minute aggregates. */
export function appendIexMinute(path:string,message:ReturnType<typeof parseIexMinute>,receivedAtUtc:string,calendar:MarketCalendar):{minuteAdded:boolean;quarterAdded:boolean}{
  if(!message)return {minuteAdded:false,quarterAdded:false};
  return locked(path,()=>{
    const prior=readIexLedger(path),at=message.bar.startUtc;
    const minuteRevisions=prior.filter(row=>row.kind==='minute'&&row.bar?.startUtc===at);
    const latest=minuteRevisions.at(-1);
    if(latest?.bar&&JSON.stringify(latest.bar)===JSON.stringify(message.bar))return {minuteAdded:false,quarterAdded:false};
    const minute:Input={kind:'minute',feed:'iex',adjustment:'raw',symbol:'NVDA',eventAtUtc:message.eventAtUtc,receivedAtUtc,status:message.updated?'UPDATED_BAR':'BAR',bar:message.bar,revision:minuteRevisions.length+1,sourceMessageHash:message.sourceMessageHash,latencyMs:message.latencyMs};
    const starts=Math.floor(Date.parse(at)/QUARTER)*QUARTER;
    const window=Array.from({length:15},(_,i)=>new Date(starts+i*MINUTE).toISOString());
    const minutes=new Map<string,IexBar>();
    for(const row of prior){if(row.kind==='minute'&&row.bar)minutes.set(row.bar.startUtc,row.bar);}
    minutes.set(at,message.bar);
    const inputs:Input[]=[minute];
    // Missing minute bars cannot be interpreted as zero-trade intervals without explicit evidence.
    if(window.every(slot=>minutes.has(slot)&&isCalendarBar(Date.parse(slot),calendar))&&Date.parse(receivedAtUtc)>=starts+QUARTER){
      const bars=window.map(slot=>minutes.get(slot)!);
      const quarter:IexBar={startUtc:window[0]!,endUtc:new Date(starts+QUARTER).toISOString(),open:bars[0]!.open,high:Math.max(...bars.map(b=>b.high)),low:Math.min(...bars.map(b=>b.low)),close:bars.at(-1)!.close,volume:bars.reduce((sum,b)=>sum+b.volume,0),tradeCount:bars.reduce((sum,b)=>sum+b.tradeCount,0)};
      const priorQuarters=prior.filter(row=>row.kind==='quarter'&&row.bar?.startUtc===quarter.startUtc);
      if(JSON.stringify(priorQuarters.at(-1)?.bar)!==JSON.stringify(quarter))inputs.push({kind:'quarter',feed:'iex',adjustment:'raw',symbol:'NVDA',eventAtUtc:quarter.endUtc,receivedAtUtc,status:'COMPLETE',bar:quarter,revision:priorQuarters.length+1,sourceMessageHash:hash(bars.map(b=>JSON.stringify(b)).join('\n')),latencyMs:Date.parse(receivedAtUtc)-Date.parse(quarter.endUtc)});
    }
    append(path,prior,inputs);
    return {minuteAdded:true,quarterAdded:inputs.length===2};
  });
}
export function iexCoverage(records:readonly IexRecord[],calendar:MarketCalendar){
  const minutes=new Set(records.filter(r=>r.kind==='minute'&&r.bar).map(r=>r.bar!.startUtc));
  const quarters=new Set(records.filter(r=>r.kind==='quarter'&&r.bar).map(r=>r.bar!.startUtc));
  const days=new Set([...minutes].map(at=>newYorkBarParts(at).day));
  let expected=0;for(const day of days){const session=calendar.get(day);if(session)expected+=session.close-session.open;}
  return {minuteBars:minutes.size,quarterBars:quarters.size,expectedMinutes:expected,coverage:expected?minutes.size/expected:null};
}
