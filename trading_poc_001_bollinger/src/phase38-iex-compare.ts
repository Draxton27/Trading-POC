import type {MarketCalendar} from './alpaca-calendar.ts';
import type {IexRecord} from './phase38-iex.ts';
import type {IngestionRecord} from './phase32-ingestion.ts';
import {newYorkBarParts} from './strategy-validation.ts';
import {isCalendarBar} from './alpaca-calendar.ts';

const QUARTER=900_000;
export type FeedComparison={symbol:'NVDA';timeframe:'15m';priceBasis:'IEX_RAW_VS_SIP_SPLIT_ADJUSTED';iexBars:number;sipBars:number;matched:number;expectedIntervals:number;iexCoverage:number|null;sipCoverage:number|null;missingIex:number|null;missingSip:number|null;missingSessionsIex:number|null;missingSessionsSip:number|null;fullSessionsObserved:number;fullSessionCoverageIex:number|null;partiallyMonitoredSessions:number;monitoredPeriodExpectedIntervals:number;monitoredPeriodCoverageIex:number|null;unmonitoredSessions:number;observationStartedAtUtc:string|null;observationEndedAtUtc:string|null;iexRevisions:number;sipRevisions:number;meanIexLatencyMs:number|null;meanIexCorrectionLatencyMs:number|null;meanSipLatencyMs:number|null;meanSipCorrectionLatencyMs:number|null;meanTimeGainedMs:number|null;meanAbsoluteOhlcDifference:{open:number;high:number;low:number;close:number}|null;meanRelativeVolumeDifference:number|null;discrepantIntervals:number};
function observationIntervals(rows:readonly IexRecord[]){
  const starts=rows.filter(r=>r.kind==='status'&&r.status==='OBSERVATION_STARTED').map(r=>Date.parse(r.receivedAtUtc)).filter(Number.isFinite);
  const ends=rows.filter(r=>r.kind==='status'&&r.status==='OBSERVATION_ENDED').map(r=>Date.parse(r.receivedAtUtc)).filter(Number.isFinite);
  const connected:{start:number;end:number|null}[]=[];let open:number|null=null;
  for(const row of rows.filter(r=>r.kind==='status').sort((a,b)=>Date.parse(a.receivedAtUtc)-Date.parse(b.receivedAtUtc))){
    const at=Date.parse(row.receivedAtUtc);if(row.status==='SUBSCRIBED')open=at;else if(row.status==='DISCONNECTED'&&open!==null){connected.push({start:open,end:at});open=null;}
  }
  if(open!==null)connected.push({start:open,end:null});
  return {startedAt:starts.length?Math.min(...starts):null,endedAt:ends.length?Math.max(...ends):null,connected};
}
/** Matched OHLC uses the latest revisions; all availability/latency comparisons use first receipts. */
export function compareIexSip(iex:readonly IexRecord[],sip:readonly IngestionRecord[],calendar:MarketCalendar,asOf=Date.now(),collectorActive=false):FeedComparison{
  const latestI=new Map<string,IexRecord>(),firstI=new Map<string,IexRecord>(),latestS=new Map<string,IngestionRecord>(),firstS=new Map<string,IngestionRecord>();
  for(const row of iex)if(row.kind==='quarter'&&row.bar){if(!firstI.has(row.bar.startUtc))firstI.set(row.bar.startUtc,row);latestI.set(row.bar.startUtc,row);}
  for(const row of sip)if(row.kind==='bar'&&row.bar){if(!firstS.has(row.bar.startUtc))firstS.set(row.bar.startUtc,row);latestS.set(row.bar.startUtc,row);}
  const dates=[...new Set([...latestI.keys(),...latestS.keys()].map(at=>newYorkBarParts(at).day))].sort();
  const first=dates[0],last=dates.at(-1),expectedSlots:string[]=[];
  const sessionDays=[...calendar.keys()].filter(day=>first&&last&&day>=first&&day<=last).sort();
  for(const day of sessionDays){const midnight=Date.parse(`${day}T00:00:00.000Z`);for(let at=midnight;at<midnight+86400000;at+=QUARTER)if(newYorkBarParts(new Date(at).toISOString()).day===day&&isCalendarBar(at,calendar))expectedSlots.push(new Date(at).toISOString());}
  const {startedAt,endedAt,connected}=observationIntervals(iex);
  // An open connection window is only extended to now when its collector lock is live.
  // After a crash, do not infer monitoring beyond its last durable status/observation.
  const lastDurable=iex.reduce((latest,row)=>Math.max(latest,Date.parse(row.receivedAtUtc)),0);
  const windows=connected.map(w=>({...w,end:w.end??(collectorActive?asOf:lastDurable)}));
  const monitoredSlots=expectedSlots.filter(at=>windows.some(w=>Date.parse(at)>=w.start&&Date.parse(at)+QUARTER<=(w.end??0)));
  const completeDays=sessionDays.filter(day=>{const slots=expectedSlots.filter(at=>newYorkBarParts(at).day===day);return slots.length>0&&windows.some(w=>{const open=Date.parse(slots[0]!);const close=Date.parse(slots.at(-1)!)+QUARTER;return w.start<=open&&w.end!==null&&w.end>=close;});});
  const partiallyMonitoredDays=sessionDays.filter(day=>{const slots=expectedSlots.filter(at=>newYorkBarParts(at).day===day);if(!slots.length||completeDays.includes(day))return false;const open=Date.parse(slots[0]!);const close=Date.parse(slots.at(-1)!)+QUARTER;return windows.some(w=>w.end!==null&&w.start<close&&w.end>open);});
  const completeSlots=expectedSlots.filter(at=>completeDays.includes(newYorkBarParts(at).day));
  const matched=[...latestI.keys()].filter(at=>latestS.has(at)&&expectedSlots.includes(at));
  const diffs={open:0,high:0,low:0,close:0},latI:number[]=[],latS:number[]=[],gains:number[]=[],corI=iex.filter(r=>r.kind==='quarter'&&r.bar&&r.revision!==null&&r.revision>1).map(r=>Date.parse(r.receivedAtUtc)-Date.parse(r.bar!.endUtc)),corS=sip.filter(r=>r.kind==='bar'&&r.bar&&(r.bar.revision??0)>1).map(r=>Date.parse(r.receivedAtUtc)-Date.parse(r.bar!.endUtc));let volume=0,discrepant=0;
  for(const at of matched){const a=latestI.get(at)!,b=latestS.get(at)!,ab=a.bar!,bb=b.bar!;if(ab.endUtc!==bb.endUtc)continue;
    const ia=firstI.get(at)!,sb=firstS.get(at)!;latI.push(Date.parse(ia.receivedAtUtc)-Date.parse(ia.bar!.endUtc));latS.push(Date.parse(sb.receivedAtUtc)-Date.parse(sb.bar!.endUtc));gains.push(Date.parse(sb.receivedAtUtc)-Date.parse(ia.receivedAtUtc));
    for(const field of ['open','high','low','close'] as const)diffs[field]+=Math.abs(ab[field]-bb[field]);volume+=bb.volume?Math.abs(ab.volume-bb.volume)/bb.volume:0;
    if(ab.open!==bb.open||ab.high!==bb.high||ab.low!==bb.low||ab.close!==bb.close||ab.volume!==bb.volume)discrepant++;
  }
  const mean=(values:number[])=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
  const coverage=(n:number,d:number)=>d>0?n/d:null;
  const observedSessionDays=new Set([...latestI.keys()].map(at=>newYorkBarParts(at).day));
  const fullExpected=completeSlots.length,monitoredExpected=monitoredSlots.length;
  const monitoredCoverage=coverage([...latestI.keys()].filter(at=>monitoredSlots.includes(at)).length,monitoredExpected);
  return {symbol:'NVDA',timeframe:'15m',priceBasis:'IEX_RAW_VS_SIP_SPLIT_ADJUSTED',iexBars:latestI.size,sipBars:latestS.size,matched:matched.length,expectedIntervals:expectedSlots.length,iexCoverage:monitoredCoverage,sipCoverage:coverage([...latestS.keys()].filter(at=>monitoredSlots.includes(at)).length,monitoredExpected),missingIex:startedAt===null?null:monitoredExpected-[...latestI.keys()].filter(at=>monitoredSlots.includes(at)).length,missingSip:startedAt===null?null:monitoredExpected-[...latestS.keys()].filter(at=>monitoredSlots.includes(at)).length,missingSessionsIex:completeDays.filter(day=>!observedSessionDays.has(day)).length,missingSessionsSip:sessionDays.filter(day=>![...latestS.keys()].some(at=>newYorkBarParts(at).day===day)).length,fullSessionsObserved:completeDays.length,fullSessionCoverageIex:coverage([...latestI.keys()].filter(at=>completeSlots.includes(at)).length,fullExpected),partiallyMonitoredSessions:partiallyMonitoredDays.length,monitoredPeriodExpectedIntervals:monitoredExpected,monitoredPeriodCoverageIex:monitoredCoverage,unmonitoredSessions:sessionDays.length-completeDays.length-partiallyMonitoredDays.length,observationStartedAtUtc:startedAt===null?null:new Date(startedAt).toISOString(),observationEndedAtUtc:collectorActive?null:endedAt===null?null:new Date(endedAt).toISOString(),iexRevisions:iex.filter(r=>r.kind==='quarter'&&r.revision!==null&&r.revision>1).length,sipRevisions:sip.filter(r=>r.kind==='bar'&&r.bar&&r.bar.revision>1).length,meanIexLatencyMs:mean(latI),meanIexCorrectionLatencyMs:mean(corI),meanSipLatencyMs:mean(latS),meanSipCorrectionLatencyMs:mean(corS),meanTimeGainedMs:mean(gains),meanAbsoluteOhlcDifference:matched.length?Object.fromEntries(Object.entries(diffs).map(([key,value])=>[key,value/matched.length])) as typeof diffs:null,meanRelativeVolumeDifference:matched.length?volume/matched.length:null,discrepantIntervals:discrepant};
}
