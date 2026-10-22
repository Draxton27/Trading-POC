import type {MarketCalendar} from './alpaca-calendar.ts';
import type {IexRecord} from './phase38-iex.ts';
import type {IngestionRecord} from './phase32-ingestion.ts';
import {newYorkBarParts} from './strategy-validation.ts';
import {isCalendarBar} from './alpaca-calendar.ts';

const QUARTER=900_000;
export type FeedComparison={symbol:'NVDA';timeframe:'15m';priceBasis:'IEX_RAW_VS_SIP_SPLIT_ADJUSTED';iexBars:number;sipBars:number;matched:number;expectedIntervals:number;iexCoverage:number|null;sipCoverage:number|null;missingIex:number;missingSip:number;missingSessionsIex:number;missingSessionsSip:number;iexRevisions:number;sipRevisions:number;meanIexLatencyMs:number|null;meanSipLatencyMs:number|null;meanTimeGainedMs:number|null;meanAbsoluteOhlcDifference:{open:number;high:number;low:number;close:number}|null;meanRelativeVolumeDifference:number|null;discrepantIntervals:number};
/** Comparison is descriptive: raw IEX prices and split-adjusted SIP prices have different bases. */
export function compareIexSip(iex:readonly IexRecord[],sip:readonly IngestionRecord[],calendar:MarketCalendar):FeedComparison{
  const i=new Map<string,IexRecord>(),s=new Map<string,IngestionRecord>();
  for(const row of iex)if(row.kind==='quarter'&&row.bar)i.set(row.bar.startUtc,row);
  for(const row of sip)if(row.kind==='bar'&&row.bar)s.set(row.bar.startUtc,row);
  const observedDates=[...i.keys(),...s.keys()].map(at=>newYorkBarParts(at).day).sort();
  const first=observedDates[0],last=observedDates.at(-1),expectedSlots=new Set<string>();
  const sessionDays=[...calendar.keys()].filter(day=>first&&last&&day>=first&&day<=last).sort();
  for(const day of sessionDays){
    const midnight=Date.parse(`${day}T00:00:00.000Z`);
    for(let at=midnight;at<midnight+24*60*60_000;at+=QUARTER){if(newYorkBarParts(new Date(at).toISOString()).day===day&&isCalendarBar(at,calendar))expectedSlots.add(new Date(at).toISOString());}
  }
  const expected=expectedSlots.size;
  const matched=[...i.keys()].filter(at=>s.has(at)&&expectedSlots.has(at));
  const diffs={open:0,high:0,low:0,close:0},latI:number[]=[],latS:number[]=[],gains:number[]=[];
  let volume=0,discrepant=0;
  for(const at of matched){
    const a=i.get(at)!,b=s.get(at)!,ab=a.bar!,bb=b.bar!;
    // Same UTC interval and session are required. Do not align neighboring bars.
    if(ab.endUtc!==bb.endUtc||!calendar.has(newYorkBarParts(at).day))continue;
    for(const field of ['open','high','low','close'] as const)diffs[field]+=Math.abs(ab[field]-bb[field]);
    volume+=bb.volume?Math.abs(ab.volume-bb.volume)/bb.volume:0;
    if(ab.open!==bb.open||ab.high!==bb.high||ab.low!==bb.low||ab.close!==bb.close||ab.volume!==bb.volume)discrepant++;
    latI.push(Date.parse(a.receivedAtUtc)-Date.parse(ab.endUtc));latS.push(Date.parse(b.receivedAtUtc)-Date.parse(bb.endUtc));gains.push(Date.parse(b.receivedAtUtc)-Date.parse(a.receivedAtUtc));
  }
  const mean=(values:number[])=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
  return {symbol:'NVDA',timeframe:'15m',priceBasis:'IEX_RAW_VS_SIP_SPLIT_ADJUSTED',iexBars:i.size,sipBars:s.size,matched:matched.length,expectedIntervals:expected,iexCoverage:expected?i.size/expected:null,sipCoverage:expected?s.size/expected:null,missingIex:[...expectedSlots].filter(at=>!i.has(at)).length,missingSip:[...expectedSlots].filter(at=>!s.has(at)).length,missingSessionsIex:sessionDays.filter(day=>![...i.keys()].some(at=>newYorkBarParts(at).day===day)).length,missingSessionsSip:sessionDays.filter(day=>![...s.keys()].some(at=>newYorkBarParts(at).day===day)).length,iexRevisions:iex.filter(r=>r.kind==='quarter'&&r.revision!==null&&r.revision>1).length,sipRevisions:sip.filter(r=>r.kind==='bar'&&r.bar&&r.bar.revision>1).length,meanIexLatencyMs:mean(latI),meanSipLatencyMs:mean(latS),meanTimeGainedMs:mean(gains),meanAbsoluteOhlcDifference:matched.length?Object.fromEntries(Object.entries(diffs).map(([key,value])=>[key,value/matched.length])) as typeof diffs:null,meanRelativeVolumeDifference:matched.length?volume/matched.length:null,discrepantIntervals:discrepant};
}
