/** Read-only, causal index of Phase 41A geometry for the historical SIP study. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {loadMetadata} from './data-contract.ts';
import {parseCandlesCsv} from './csv.ts';
import {loadMarketCalendar,type MarketCalendar} from './alpaca-calendar.ts';
import {buildDailyCandles,buildHourlyCandles,calculateSmaPoints,SMA_PERIODS,type AggregateCandle,type SmaPoint,type SmaPeriod} from './multitimeframe.ts';
import {classifySmaInteraction,classifySmaPair,classifySmaSlope,classifyTimeframeAlignment,detectSmaEvents,
  type TechnicalFrame,type TechnicalInteraction,type TechnicalPair,type TechnicalSlope} from './investep-technical-context.ts';
import {newYorkBarParts} from './strategy-validation.ts';
import type {Candle} from './domain.ts';

const BAR_MS=15*60_000;
export const SIP_DELAYS=[15,20,30] as const;
export type SipDelay=typeof SIP_DELAYS[number];
export type CoverageReason='SOURCE_OUT_OF_RANGE'|'INSUFFICIENT_SIP_HISTORY'|'INCOMPLETE_SESSION'|'SIMULATED_DELAY_NOT_MET'|'TECHNICAL_CONTEXT_AVAILABLE';
export type SmaSnapshot={value:number|null;previousValue:number|null;slope:TechnicalSlope;distancePercent:number|null;
  priceAbove:boolean|null;priceBelow:boolean|null;interactions:TechnicalInteraction[]};
export type FrameSnapshot={barStartUtc:string|null;barEndUtc:string|null;assumedAvailableAtUtc:string|null;
  continuousBars:number;shortPair:TechnicalPair;longPair:TechnicalPair;state:TechnicalPair;
  sma:Record<SmaPeriod,SmaSnapshot>;events:ReturnType<typeof detectSmaEvents>};
export type SipSnapshot={delayMinutes:SipDelay;iexDecisionAtUtc:string;sipBarEndUtc:string|null;
  sipAssumedAvailableAtUtc:string|null;availability:'SIMULATED_HISTORICAL_DELAY';reason:CoverageReason;
  currentBarDelayNotMet:boolean;alignment:ReturnType<typeof classifyTimeframeAlignment>;
  frames:Record<TechnicalFrame,FrameSnapshot>;ranges:Record<'5'|'20'|'60',{status:'AVAILABLE'|'UNAVAILABLE';
    distanceToHighPercent:number|null;distanceToLowPercent:number|null;breakBelowLow:boolean|null}>;
  previousSession:{status:'AVAILABLE'|'UNAVAILABLE';distanceToLowPercent:number|null;breakBelowLow:boolean|null};
  sipClose:number|null};

type Indexed={point:SmaPoint|null;runStart:number;available:number};
type FrameIndex={items:Indexed[];availability:number[]};
const minute=(utc:string)=>{const [h,m]=newYorkBarParts(utc).slot.split(':').map(Number);return h!*60+m!;};
const iso=(time:number)=>new Date(time).toISOString();
const percent=(value:number,reference:number)=>reference===0?null:(value-reference)/reference*100;
function upperBound(values:readonly number[],cutoff:number):number{
  let lo=0,hi=values.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(values[mid]!<=cutoff)lo=mid+1;else hi=mid;}
  return lo-1;
}
function adjacent(a:AggregateCandle,b:AggregateCandle,calendar:MarketCalendar,position:Map<string,number>):boolean{
  if(a.dateNy===b.dateNy)return a.endTimestamp===b.timestamp;
  const old=calendar.get(a.dateNy),next=calendar.get(b.dateNy);
  return !!old&&!!next&&position.get(b.dateNy)===position.get(a.dateNy)!+1&&
    minute(a.endTimestamp)===old.close&&minute(b.timestamp)===next.open;
}
function frameIndex(aggregates:readonly AggregateCandle[],calendar:MarketCalendar,delay:SipDelay):FrameIndex{
  const position=new Map([...calendar.keys()].sort().map((day,i)=>[day,i]));
  const items:Indexed[]=[],availability:number[]=[];let run:AggregateCandle[]=[],runStart=0;
  function flush(){
    if(!run.length)return;
    const points=calculateSmaPoints(run);
    for(const point of points){const available=Date.parse(point.candle.endTimestamp)+delay*60_000;
      point.candle.availableAt=iso(available);
      items.push({point,runStart,available});availability.push(available);
    }
    run=[];
  }
  for(const candle of aggregates){
    if(!candle.complete){flush();const available=Date.parse(candle.endTimestamp)+delay*60_000;
      items.push({point:null,runStart:items.length+1,available});availability.push(available);continue;}
    if(run.length&&!adjacent(run.at(-1)!,candle,calendar,position))flush();
    if(!run.length)runStart=items.length;
    run.push({...candle});
  }
  flush();return {items,availability};
}
function emptyFrame():FrameSnapshot{
  const blank=():SmaSnapshot=>({value:null,previousValue:null,slope:'UNAVAILABLE',distancePercent:null,
    priceAbove:null,priceBelow:null,interactions:[]});
  const sma:Record<SmaPeriod,SmaSnapshot>={20:blank(),40:blank(),100:blank(),200:blank()};
  return {barStartUtc:null,barEndUtc:null,assumedAvailableAtUtc:null,continuousBars:0,
    shortPair:'INSUFFICIENT_DATA',longPair:'INSUFFICIENT_DATA',state:'INSUFFICIENT_DATA',sma,events:[]};
}
function frameAt(frame:TechnicalFrame,index:FrameIndex,decision:number):FrameSnapshot{
  const at=upperBound(index.availability,decision),entry=index.items[at];
  if(!entry?.point)return emptyFrame();
  const {point,runStart}=entry,prior=index.items[at-1]?.point;
  const snapshot=emptyFrame();snapshot.barStartUtc=point.candle.timestamp;snapshot.barEndUtc=point.candle.endTimestamp;
  snapshot.assumedAvailableAtUtc=point.candle.availableAt;snapshot.continuousBars=at-runStart+1;
  for(const period of SMA_PERIODS){
    const value=point.values[period],previousValue=prior&&at-1>=runStart?prior.values[period]:null;
    const slope=classifySmaSlope(value,previousValue);
    snapshot.sma[period]={value,previousValue,slope:slope.slope,
      distancePercent:value===null?null:percent(point.candle.close,value),
      priceAbove:value===null?null:point.candle.close>value,
      priceBelow:value===null?null:point.candle.close<value,
      interactions:value===null?[]:classifySmaInteraction(prior&&at-1>=runStart?prior.candle:null,point.candle,previousValue,value)};
  }
  snapshot.shortPair=classifySmaPair(snapshot.sma[20].value,snapshot.sma[40].value);
  snapshot.longPair=classifySmaPair(snapshot.sma[100].value,snapshot.sma[200].value);
  snapshot.state=snapshot.shortPair==='INSUFFICIENT_DATA'||snapshot.longPair==='INSUFFICIENT_DATA'?'INSUFFICIENT_DATA':
    snapshot.shortPair===snapshot.longPair?snapshot.shortPair:'MIXED';
  const points=index.items.slice(Math.max(runStart,at-204),at+1).map(item=>item.point).filter((p):p is SmaPoint=>p!==null);
  snapshot.events=detectSmaEvents(points,frame).filter(event=>event.atUtc===point.candle.availableAt);
  return snapshot;
}
function make15(candles:readonly Candle[]):AggregateCandle[]{return candles.map(bar=>({ ...bar,
  endTimestamp:iso(Date.parse(bar.timestamp)+BAR_MS),availableAt:iso(Date.parse(bar.timestamp)+BAR_MS),
  dateNy:newYorkBarParts(bar.timestamp).day,timeframe:'hour',durationMinutes:15,
  expectedSourceBars:1,observedSourceBars:1,complete:true,scheduledAbbreviated:false}));}
export function loadPhase41bSip(csvPath:string){
  const metadata=loadMetadata(csvPath),provenance=JSON.parse(readFileSync(`${csvPath}.provenance.json`,'utf8')) as Record<string,unknown>;
  if(metadata.asset!=='NVDA'||metadata.provider!=='Alpaca Market Data API'||metadata.bar_minutes!==15||
      metadata.data_class!=='real'||metadata.session!=='regular'||metadata.exchange_timezone!=='America/New_York'||
      metadata.feed!=='sip'||metadata.adjustment!=='split'||provenance.provider!==metadata.provider||
      provenance.feed!=='sip'||provenance.adjustment!=='split'||provenance.timeframe!=='15Min'||
      provenance.calendar_endpoint!=='/v2/calendar'||provenance.credentials_recorded!==false)throw new Error('Procedencia SIP incompatible.');
  const calendar=loadMarketCalendar(`${csvPath}.calendar.json`);
  const candles=parseCandlesCsv(readFileSync(csvPath,'utf8'),metadata,{allowIntradayGaps:true});
  for(const bar of candles){const part=newYorkBarParts(bar.timestamp),session=calendar.get(part.day),start=minute(bar.timestamp);
    if(!session||start<session.open||start+15>session.close||(start-session.open)%15!==0)throw new Error('SIP fuera del calendario oficial.');
  }
  const hash=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
  return {candles,calendar,hashes:Object.fromEntries(['', '.meta.json','.calendar.json','.provenance.json'].map(ext=>[ext||'csv',hash(`${csvPath}${ext}`)]))};
}
export function createPhase41bIndex(candles:readonly Candle[],calendar:MarketCalendar,delay:SipDelay){
  if(!SIP_DELAYS.includes(delay))throw new Error('Retraso SIP no permitido.');
  const indexes:Record<TechnicalFrame,FrameIndex>={
    '15m':frameIndex(make15(candles),calendar,delay),
    '1h':frameIndex(buildHourlyCandles(candles,calendar),calendar,delay),
    '1d':frameIndex(buildDailyCandles(candles,calendar),calendar,delay)};
  const daily=new Map<string,AggregateCandle>();
  for(const item of indexes['1d'].items){if(item.point)daily.set(item.point.candle.dateNy,item.point.candle);}
  const closeByStart=new Map(candles.map(c=>[c.timestamp,c.close]));
  const days=[...calendar.keys()].sort();
  const first=Date.parse(candles[0]?.timestamp??'');
  const last=Date.parse(candles.at(-1)?.timestamp??'')+BAR_MS;
  return (iexDecisionAtUtc:string,iexBarEndUtc:string):SipSnapshot=>{
    const decision=Date.parse(iexDecisionAtUtc);if(!Number.isFinite(decision))throw new Error('Decisión UTC inválida.');
    const observedBarEnd=Date.parse(iexBarEndUtc);
    if(!Number.isFinite(observedBarEnd)||observedBarEnd>decision)throw new Error('Vela IEX posterior a la decisión.');
    const currentBarDelayNotMet=observedBarEnd+delay*60_000>decision;
    const sourceOut=decision<first+BAR_MS||decision>last+delay*60_000;
    if(sourceOut){
      const frames={'15m':emptyFrame(),'1h':emptyFrame(),'1d':emptyFrame()};
      const emptyRange=()=>({status:'UNAVAILABLE' as const,distanceToHighPercent:null,
        distanceToLowPercent:null,breakBelowLow:null});
      return {delayMinutes:delay,iexDecisionAtUtc,sipBarEndUtc:null,sipAssumedAvailableAtUtc:null,
        availability:'SIMULATED_HISTORICAL_DELAY',reason:'SOURCE_OUT_OF_RANGE',currentBarDelayNotMet,
        alignment:'INSUFFICIENT_DATA',frames,ranges:{'5':emptyRange(),'20':emptyRange(),'60':emptyRange()},
        previousSession:{status:'UNAVAILABLE',distanceToLowPercent:null,breakBelowLow:null},sipClose:null};
    }
    const frames={ '15m':frameAt('15m',indexes['15m'],decision),
      '1h':frameAt('1h',indexes['1h'],decision),'1d':frameAt('1d',indexes['1d'],decision)};
    const last15=frames['15m'],sipClose=last15.barStartUtc?closeByStart.get(last15.barStartUtc)??null:null;
    const today=newYorkBarParts(iexDecisionAtUtc).day,previous=days.filter(day=>day<today),price=sipClose;
    const ranges={} as SipSnapshot['ranges'];
    for(const count of [5,20,60] as const){const expected=previous.slice(-count);
      const bars=expected.map(day=>daily.get(day));
      const available=expected.length===count&&bars.every(b=>b&&Date.parse(b.endTimestamp)+delay*60_000<=decision);
      const high=available?Math.max(...bars.map(b=>b!.high)):null,low=available?Math.min(...bars.map(b=>b!.low)):null;
      ranges[String(count) as '5'|'20'|'60']={status:available?'AVAILABLE':'UNAVAILABLE',
        distanceToHighPercent:high!==null&&price!==null?percent(price,high):null,
        distanceToLowPercent:low!==null&&price!==null?percent(price,low):null,
        breakBelowLow:low!==null&&price!==null?price<low:null};
    }
    const priorDay=daily.get(previous.at(-1)??'');
    const priorAvailable=!!priorDay&&Date.parse(priorDay.endTimestamp)+delay*60_000<=decision;
    const previousSession:SipSnapshot['previousSession']={status:priorAvailable?'AVAILABLE':'UNAVAILABLE',
      distanceToLowPercent:priorAvailable&&price!==null?percent(price,priorDay!.low):null,
      breakBelowLow:priorAvailable&&price!==null?price<priorDay!.low:null};
    const reason:CoverageReason=!last15.barEndUtc?'SIMULATED_DELAY_NOT_MET':
      last15.continuousBars<200||frames['1h'].continuousBars<200||frames['1d'].continuousBars<200?
        (previous.length>0&&!daily.has(previous.at(-1)!)?'INCOMPLETE_SESSION':'INSUFFICIENT_SIP_HISTORY'):
        'TECHNICAL_CONTEXT_AVAILABLE';
    return {delayMinutes:delay,iexDecisionAtUtc,sipBarEndUtc:last15.barEndUtc,
      sipAssumedAvailableAtUtc:last15.assumedAvailableAtUtc,availability:'SIMULATED_HISTORICAL_DELAY',
      reason,currentBarDelayNotMet,alignment:classifyTimeframeAlignment(frames),frames,ranges,previousSession,sipClose};
  };
}
