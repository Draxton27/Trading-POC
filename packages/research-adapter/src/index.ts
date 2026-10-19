import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import type {MarketBar} from '@trading-poc/contracts';
import {loadDataset} from '../../../trading_poc_001_bollinger/src/csv.ts';
import {loadMetadata} from '../../../trading_poc_001_bollinger/src/data-contract.ts';
import {loadMarketCalendar} from '../../../trading_poc_001_bollinger/src/alpaca-calendar.ts';
import {buildDailyCandles,buildHourlyCandles} from '../../../trading_poc_001_bollinger/src/multitimeframe.ts';
import {parseCsvRows} from '../../../trading_poc_001_bollinger/src/phase17-csv.ts';

export type Symbol='NVDA'|'QQQ'|'SMH';export type Timeframe='15m'|'1h'|'1d';
const root=resolve(fileURLToPath(new URL('../../../trading_poc_001_bollinger/',import.meta.url)));
const cache=new Map<string,MarketBar[]>();
const source=(symbol:Symbol)=>resolve(root,'data',`${symbol}_ALPACA_SIP_15min_20211017_20261017.csv`);
export function offlineMetadata(symbol:Symbol){return loadMetadata(source(symbol));}
export function offlineAvailable(){return (['NVDA','QQQ','SMH'] as Symbol[]).every(s=>existsSync(source(s))&&existsSync(`${source(s)}.meta.json`)&&existsSync(`${source(s)}.calendar.json`));}
const dateNy=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
export function priorCalendarSession(symbol:Symbol,asOfUtc:string):string|null{
  const path=`${source(symbol)}.calendar.json`;if(!existsSync(path))return null;
  const date=dateNy.format(new Date(asOfUtc));
  return [...loadMarketCalendar(path).keys()].filter(day=>day<date).sort().at(-1)??null;
}
export function demoBars(symbol:Symbol,timeframe:Timeframe='15m'):MarketBar[]{
  const base={NVDA:214,QQQ:614,SMH:357}[symbol];const bars:MarketBar[]=[];
  // Datos sintéticos de 15 sesiones de lunes a viernes, todos anteriores al inicio de Fase 19.
  let session=0;for(let day=0;session<15;day++){const date=new Date(Date.UTC(2026,8,28+day));if(date.getUTCDay()===0||date.getUTCDay()===6)continue;
    for(let slot=0;slot<26;slot++){
    const start=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate(),13,30+slot*15));const i=session*26+slot;
    const drift=i*0.035,osc=Math.sin(i/9+base)*1.7,open=base+drift+osc,close=open+Math.sin(i/4+base)*0.46;
    bars.push({symbol,timeframe:'15m',startUtc:start.toISOString(),endUtc:new Date(start.getTime()+900000).toISOString(),open,high:Math.max(open,close)+0.35,low:Math.min(open,close)-0.35,close,volume:Math.round(100000+30000*Math.abs(Math.sin(i/3))),provider:'DEMO sintético',adjustment:'none',receivedAtUtc:null,isComplete:true});
  }session++;}
  return aggregateSimple(bars,timeframe);
}
function aggregateSimple(bars:MarketBar[],frame:Timeframe):MarketBar[]{
  if(frame==='15m')return bars;
  const out:MarketBar[]=[];
  for(let session=0;session<bars.length;session+=26){const day=bars.slice(session,session+26);const size=frame==='1h'?4:26;
    for(let i=0;i<day.length;i+=size){const rows=day.slice(i,i+size);if(!rows.length)continue;
      out.push({...rows[0]!,timeframe:frame,endUtc:rows.at(-1)!.endUtc,high:Math.max(...rows.map(b=>b.high)),low:Math.min(...rows.map(b=>b.low)),close:rows.at(-1)!.close,volume:rows.reduce((n,b)=>n+(b.volume??0),0)});}
  }
  return out;
}
export function offlineBars(symbol:Symbol,frame:Timeframe):MarketBar[]{
  const key=`${symbol}:${frame}`;const prior=cache.get(key);if(prior)return prior;
  const path=source(symbol);if(!existsSync(path))return [];
  const {candles,metadata}=loadDataset(path);const calendar=loadMarketCalendar(`${path}.calendar.json`);
  const rows=frame==='15m'?candles:frame==='1h'?buildHourlyCandles(candles,calendar):buildDailyCandles(candles,calendar);
  const result:MarketBar[]=rows.map(bar=>({symbol,timeframe:frame,startUtc:bar.timestamp,endUtc:(bar as {endTimestamp?:string}).endTimestamp??new Date(Date.parse(bar.timestamp)+900000).toISOString(),open:bar.open,high:bar.high,low:bar.low,close:bar.close,volume:bar.volume,provider:metadata.provider,adjustment:metadata.adjustment??'unknown',receivedAtUtc:null,isComplete:(bar as {complete?:boolean}).complete??true})).filter(b=>Number.isFinite(b.open));
  cache.set(key,result);return result;
}
export function pageBars<T extends {startUtc:string}>(bars:readonly T[],before:string|undefined,limit:number){
  const filtered=before?bars.filter(b=>b.startUtc<before):bars;
  const page=filtered.slice(Math.max(0,filtered.length-limit));
  return {items:page,nextBefore:filtered.length>page.length?page[0]?.startUtc??null:null,total:bars.length};
}
export function historicalSignals(limit=100){
  const path=resolve(root,'../shared-artifacts/phase15-market-confirmation/phase15-signal-analysis.csv');
  if(!existsSync(path))return [];
  const rows=parseCsvRows(readFileSync(path,'utf8'));const header=rows[0]??[];
  return rows.slice(1).filter(r=>r.length===header.length).slice(-limit).map(r=>Object.fromEntries(header.map((h,i)=>[h,r[i]]))).reverse();
}
export function historicalEvents(limit=50){
  const path=resolve(root,'../shared-artifacts/phase14-market-context/phase14-economic-events.csv');
  if(!existsSync(path))return [];
  const rows=parseCsvRows(readFileSync(path,'utf8'));const header=rows[0]??[];
  return rows.slice(1).filter(r=>r.length===header.length).slice(-limit).map(r=>Object.fromEntries(header.map((h,i)=>[h,r[i]]))).reverse();
}
