import {calculateBollinger} from './bollinger.ts';
import {isCalendarBar,type MarketCalendar} from './alpaca-calendar.ts';
import {newYorkLocalToUtc} from './phase42b-queue.ts';
import type {Candle} from './domain.ts';

export type HistoricalBar=Candle & {providerVwap:number|null};
const minutes=(m:number)=>`${Math.floor(m/60).toString().padStart(2,'0')}:${(m%60).toString().padStart(2,'0')}`;

/** Retrospective OHLCV can establish only a conditional reconstruction, not actual historical receipt. */
export function historicalBollinger15(bars:readonly HistoricalBar[],calendar:MarketCalendar,entryUtc:string){
  const entry=Date.parse(entryUtc);if(!Number.isFinite(entry))throw Error('ENTRY_INVALID');
  const expected:number[]=[];
  for(const [day,s] of [...calendar].sort(([a],[b])=>a.localeCompare(b))){
    const open=Date.parse(newYorkLocalToUtc(`${day}T${minutes(s.open)}:00`));
    if(open>=entry)break;
    for(let m=s.open;m+15<=s.close;m+=15){const t=open+(m-s.open)*60_000;if(t+15*60_000<entry)expected.push(t);}
  }
  const wanted=expected.slice(-20),index=new Map<number,HistoricalBar>();
  for(const bar of bars){const t=Date.parse(bar.timestamp);if(t+15*60_000>=entry||!isCalendarBar(t,calendar))continue;
    if(index.has(t))throw Error('DUPLICATE_BAR');index.set(t,bar);}
  const missing=wanted.filter(t=>!index.has(t)).length;
  if(wanted.length!==20||missing)return {status:'NO_VERIFICABLE' as const,value:null,missing,expected:wanted.length};
  const selected=wanted.map(t=>index.get(t)!);
  return {status:'RETROSPECTIVO_NO_POINT_IN_TIME' as const,value:calculateBollinger(selected).at(-1)!,missing:0,expected:20};
}

/** Only data through the last minute fully closed before entry; missing minutes prevent VWAP. */
export function historicalSessionMinutes(bars:readonly HistoricalBar[],calendar:MarketCalendar,entryLocal:string){
  const entry=Date.parse(newYorkLocalToUtc(entryLocal)),day=entryLocal.slice(0,10),s=calendar.get(day);
  if(!s)return {status:'NO_VERIFICABLE' as const,reasons:['CALENDARIO_AUSENTE'],expected:0,observed:0,vwap:null,lastClose:null};
  const open=Date.parse(newYorkLocalToUtc(`${day}T${minutes(s.open)}:00`)),expected:number[]=[];
  for(let m=s.open;m<s.close;m++){const t=open+(m-s.open)*60_000;if(t+60_000>=entry)break;expected.push(t);}
  const byTime=new Map<number,HistoricalBar>();for(const b of bars){const t=Date.parse(b.timestamp);if(t+60_000>=entry)continue;if(byTime.has(t))throw Error('DUPLICATE_BAR');byTime.set(t,b);}
  const selected=expected.flatMap(t=>byTime.has(t)?[byTime.get(t)!]:[]),valid=expected.length>0&&selected.length===expected.length;
  const volume=selected.reduce((sum,b)=>sum+b.volume,0),vwap=valid&&volume>0&&selected.every(b=>b.providerVwap!==null)?
    selected.reduce((sum,b)=>sum+b.providerVwap!*b.volume,0)/volume:null;
  return {status:valid?'RETROSPECTIVO_NO_POINT_IN_TIME' as const:'NO_VERIFICABLE' as const,
    reasons:[...(!valid?['BARRAS_MINUTO_INSUFICIENTES']:[]),'RECEPCION_HISTORICA_NO_VERIFICADA'],
    expected:expected.length,observed:selected.length,vwap,lastClose:valid?selected.at(-1)!.close:null};
}

/** Compare identical minute timestamps and opening-to-last-close moves, not unobserved prior closes. */
export function historicalRelativeMinutes(asset:readonly HistoricalBar[],benchmark:readonly HistoricalBar[],calendar:MarketCalendar,entryLocal:string){
  const a=historicalSessionMinutes(asset,calendar,entryLocal),b=historicalSessionMinutes(benchmark,calendar,entryLocal);
  if(a.status==='NO_VERIFICABLE'||b.status==='NO_VERIFICABLE'||a.expected!==b.expected)
    return {status:'NO_VERIFICABLE' as const,value:null};
  const s=calendar.get(entryLocal.slice(0,10))!,open=Date.parse(newYorkLocalToUtc(`${entryLocal.slice(0,10)}T${minutes(s.open)}:00`));
  const left=new Map(asset.map(x=>[Date.parse(x.timestamp),x])),right=new Map(benchmark.map(x=>[Date.parse(x.timestamp),x]));
  const end=open+(a.expected-1)*60_000,af=left.get(open),al=left.get(end),bf=right.get(open),bl=right.get(end);
  if(!af||!al||!bf||!bl||af.open<=0||bf.open<=0)return {status:'NO_VERIFICABLE' as const,value:null};
  const assetReturn=(al.close/af.open-1)*100,benchmarkReturn=(bl.close/bf.open-1)*100;
  return {status:'RETROSPECTIVO_NO_POINT_IN_TIME' as const,value:{basis:'APERTURA_A_ULTIMO_CIERRE_MINUTO',
    assetReturnPercent:assetReturn,benchmarkReturnPercent:benchmarkReturn,differencePercentagePoints:assetReturn-benchmarkReturn}};
}
