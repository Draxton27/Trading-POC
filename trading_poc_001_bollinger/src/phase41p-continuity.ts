/** Read-only, causal continuity audit. No network access or ledger writes. */
import type {MarketCalendar} from './alpaca-calendar.ts';
import type {IexRecord} from './phase38-iex.ts';
import type {IexWarmup} from './phase38f-warmup.ts';
import type {Candle} from './domain.ts';
import {marketMinuteUtc} from './phase38d-iex-history.ts';
import {phase23ContinuousSuffix} from './phase23-dataset.ts';
import {buildInvestepTechnicalContext} from './investep-technical-context.ts';
import {calculateBollinger} from './bollinger.ts';
import {calculateVolumeReferences} from './volume-filter.ts';
import {firstCompleteOpportunityBars} from './phase41o-opportunity-engine.ts';
import {newYorkBarParts} from './strategy-validation.ts';

const QUARTER=900_000;
const iso=(time:number)=>new Date(time).toISOString();
export type ContinuityCode='CONNECTED'|'NO_LIVE_DATA'|'NO_REST_CONTEXT'|'WARMUP_REGISTERED_TOO_LATE'|
  'CALENDAR_INCOMPATIBLE'|'MISSING_OFFICIAL_SESSION'|'MISSING_EXPECTED_15M_BAR'|'WARMUP_TO_LIVE_GAP'|'SOURCE_INCOMPATIBLE'|
  'INSUFFICIENT_DAILY_SMA_HISTORY'|'FEED_DISCONNECTED'|'STALE_LIVE_BAR';
export type RestContext={candles:Candle[];calendar:MarketCalendar;registeredAtUtc:string;csvSha256:string;
  manifestSha256:string|null;kind:'38F_WARMUP'|'41P_REST_CONTEXT'};
export type ContinuityAudit={schema:'phase41p-continuity-v1';checkedAtUtc:string;code:ContinuityCode;
  live:{firstBarStartUtc:string|null;lastBarStartUtc:string|null;lastBarEndUtc:string|null;lastReceivedAtUtc:string|null;
    feedStatus:string|null;verified15mBars:number;revisions:number};
  rest:{registeredAtUtc:string|null;earliestBarStartUtc:string|null;latestBarStartUtc:string|null;
    bars:number;manifestSha256:string|null;kind:RestContext['kind']|null};
  bridge:{firstRelevantLiveBarStartUtc:string|null;firstExpectedAfterRestUtc:string|null;
    missingSessions:string[];missing15mCount:number;firstMissing15mUtc:string|null;
    firstActualDiscontinuity:{previousBarStartUtc:string;nextBarStartUtc:string}|null;
    continuousSuffixBars:number;lastContinuousStartUtc:string|null;overlappingBars:number};
  indicators:{timeframes:Record<'15m'|'1h'|'1d',{completeBarsInRun:number;lastBarEndUtc:string|null;
    smas:Record<20|40|100|200,{value:number|null;availableAtUtc:string|null;missingBars:number}>}>;
    bollinger:{middle:number|null;upper:number|null;lower:number|null;availableAtUtc:string|null};
    rvol:{value:number|null;availableAtUtc:string|null}};
  candidate:{lastDetectedAtUtc:string|null;lastEvaluatedEventAtUtc:string|null;lastEligibleEventAtUtc:string|null;
    detectedCount:number;pendingOutcomeCount:number;exclusionCounts:Record<string,number>};
  reasons:string[]};

export function mergeOfficialCalendar(base:MarketCalendar,rest:readonly RestContext[]):MarketCalendar{
  const merged=new Map(base);
  for(const context of rest)for(const [day,hours] of context.calendar){
    const prior=merged.get(day);
    if(prior&&(prior.open!==hours.open||prior.close!==hours.close))throw new Error('CALENDAR_INCOMPATIBLE');
    merged.set(day,hours);
  }
  return merged;
}

/** Latest registered REST version is usable only at or after its recorded acquisition. Live first versions take precedence. */
export function causalIexCandles(live:readonly IexRecord[],rest:readonly RestContext[],asOfUtc:string){
  const at=Date.parse(asOfUtc),sources=new Map<string,{candle:Candle;availableAtUtc:string;hash:string;source:'REST'|'LIVE'}>();
  const validRest=rest.filter(row=>Date.parse(row.registeredAtUtc)<=at).sort((a,b)=>a.registeredAtUtc.localeCompare(b.registeredAtUtc));
  for(const source of validRest)for(const candle of source.candles){
    if(Date.parse(candle.timestamp)+QUARTER>Date.parse(source.registeredAtUtc))throw new Error('SOURCE_INCOMPATIBLE');
    sources.set(candle.timestamp,{candle,availableAtUtc:source.registeredAtUtc,hash:source.csvSha256,source:'REST'});
  }
  const first=firstCompleteOpportunityBars(live,asOfUtc);
  for(const row of first){const bar=row.bar!;
    sources.set(bar.startUtc,{candle:{timestamp:bar.startUtc,open:bar.open,high:bar.high,low:bar.low,
      close:bar.close,volume:bar.volume},availableAtUtc:row.receivedAtUtc,hash:row.recordHash,source:'LIVE'});
  }
  return [...sources.values()].sort((a,b)=>a.candle.timestamp.localeCompare(b.candle.timestamp));
}

export function diagnoseOpportunityContinuity(input:{records:readonly IexRecord[];calendar:MarketCalendar;
  rest?:readonly RestContext[];nowUtc:string;candidateRecords?:readonly {kind:string;registeredAtUtc:string;
    payload?:{candidateId?:string;status?:string;exclusionReasons?:string[]}}[]}):ContinuityAudit{
  const {records,nowUtc}=input,at=Date.parse(nowUtc);
  if(!Number.isFinite(at)||iso(at)!==nowUtc)throw new Error('INVALID_CLOCK');
  const rest=input.rest??[],available=rest.filter(row=>Date.parse(row.registeredAtUtc)<=at);
  const lastRest=available.at(-1)??null;
  let calendar:MarketCalendar;
  try{calendar=mergeOfficialCalendar(input.calendar,available);}catch{
    calendar=input.calendar;
  }
  const first=firstCompleteOpportunityBars(records,nowUtc),latest=first.at(-1)??null;
  const feedStatus=records.filter(row=>row.kind==='status'&&Date.parse(row.receivedAtUtc)<=at).at(-1)?.status??null;
  const allRest=available.flatMap(row=>row.candles).sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
  const restLast=allRest.at(-1)?.timestamp??null,restFirst=allRest[0]?.timestamp??null;
  const relevant=first.find(row=>restLast===null||row.bar!.startUtc>restLast)??null;
  const overlap=first.filter(row=>restLast!==null&&row.bar!.startUtc<=restLast).length;
  let merged:ReturnType<typeof causalIexCandles>=[],suffix:Candle[]=[];
  let sourceInvalid=false,calendarConflict=false;
  try{mergeOfficialCalendar(input.calendar,available);}catch{calendarConflict=true;}
  if(!calendarConflict)try{
    merged=causalIexCandles(records,available,nowUtc);
    suffix=phase23ContinuousSuffix(merged.map(row=>row.candle),calendar);
  }catch{sourceInvalid=true;}
  const firstExpected=restLast!==null?iso(Date.parse(restLast)+QUARTER):null;
  const missing:string[]=[],missingSessions=new Set<string>(),expectedBySession=new Map<string,number>(),
    missingBySession=new Map<string,number>();
  if(restLast&&latest){
    const end=Date.parse(latest.bar!.startUtc),observed=new Set(merged.map(row=>row.candle.timestamp));
    for(const [day,hours] of [...calendar].sort(([a],[b])=>a.localeCompare(b))){
      const open=marketMinuteUtc(day,hours.open);
      for(let minute=hours.open;minute<hours.close;minute+=15){
        const slot=open+(minute-hours.open)*60_000;
        if(slot<=Date.parse(restLast)||slot>end)continue;
        expectedBySession.set(day,(expectedBySession.get(day)??0)+1);
        const key=iso(slot);
        if(!observed.has(key)){missing.push(key);missingSessions.add(day);
          missingBySession.set(day,(missingBySession.get(day)??0)+1);}
      }
    }
  }
  const suffixStart=suffix[0]?.timestamp??null,suffixIndex=suffixStart?merged.findIndex(row=>row.candle.timestamp===suffixStart):-1;
  const discontinuity=suffixIndex>0?{previousBarStartUtc:merged[suffixIndex-1]!.candle.timestamp,nextBarStartUtc:suffixStart!}:null;
  const contextAvailableAt=available.reduce((latest,row)=>Math.max(latest,Date.parse(row.registeredAtUtc)),0);
  const afterContext=(time:string|null)=>time?iso(Math.max(Date.parse(time),contextAvailableAt)):null;
  const blank=()=>({completeBarsInRun:0,lastBarEndUtc:null as string|null,
    smas:Object.fromEntries(([20,40,100,200] as const).map(period=>[period,{value:null as number|null,
      availableAtUtc:null as string|null,missingBars:period}])) as ContinuityAudit['indicators']['timeframes']['15m']['smas']});
  const frames:{'15m':ReturnType<typeof blank>;'1h':ReturnType<typeof blank>;'1d':ReturnType<typeof blank>}={
    '15m':blank(),'1h':blank(),'1d':blank()};
  if(merged.length&&!sourceInvalid&&!calendarConflict){
    try{const context=buildInvestepTechnicalContext({symbol:'NVDA',asOfUtc:nowUtc,
      bars:merged.map(row=>({symbol:'NVDA',timeframe:'15m',startUtc:row.candle.timestamp,
        endUtc:iso(Date.parse(row.candle.timestamp)+QUARTER),open:row.candle.open,high:row.candle.high,
        low:row.candle.low,close:row.candle.close,volume:row.candle.volume,
        provider:'Alpaca Market Data API',adjustment:'raw',receivedAtUtc:row.availableAtUtc,isComplete:true})),
      calendar,provider:'Alpaca Market Data API',feed:'iex',adjustment:'raw',historicalOrSynthetic:'HISTORICAL'});
      for(const frame of ['15m','1h','1d'] as const){const value=context.timeframes[frame];
        frames[frame]={completeBarsInRun:value.completeBarsInRun,lastBarEndUtc:value.lastCompleteBarUtc,
          smas:Object.fromEntries(([20,40,100,200] as const).map(period=>[period,{value:value.smas[period].value,
            availableAtUtc:value.smas[period].value===null?null:afterContext(value.smas[period].availableAtUtc),
            missingBars:Math.max(0,period-value.completeBarsInRun)}])) as typeof frames['15m']['smas']};
      }
    }catch{sourceInvalid=true;}
  }
  const band=suffix.length>=20?calculateBollinger(suffix).at(-1):null;
  const volume=suffix.length>=21?calculateVolumeReferences(suffix).at(-1):null;
  const availabilityFor=(count:number)=>{
    const window=new Set(suffix.slice(-count).map(row=>row.timestamp));
    const times=merged.filter(row=>window.has(row.candle.timestamp)).map(row=>Date.parse(row.availableAtUtc));
    return times.length===count?iso(Math.max(...times)):null;
  };
  const recordsForCandidate=input.candidateRecords??[],detected=recordsForCandidate.filter(row=>row.kind==='DETECTED');
  const outcomes=new Set(recordsForCandidate.filter(row=>row.kind==='UNDERLYING_OUTCOME').map(row=>row.payload?.candidateId));
  const eligible=detected.filter(row=>['TECHNICAL_CANDIDATE','REVIEWABLE_PAPER_CANDIDATE'].includes(row.payload?.status??''));
  const exclusionCounts:Record<string,number>={};
  for(const row of detected)for(const reason of row.payload?.exclusionReasons??[])
    exclusionCounts[reason]=(exclusionCounts[reason]??0)+1;
  const tooLate=lastRest&&latest&&Date.parse(lastRest.registeredAtUtc)>Date.parse(latest.receivedAtUtc);
  const entireSessionMissing=[...missingBySession].some(([day,count])=>count===expectedBySession.get(day));
  const bridgeConnected=!!restLast&&!!suffixStart&&suffixStart<=restLast&&
    !!latest&&suffix.at(-1)?.timestamp===latest.bar?.startUtc;
  const code:ContinuityCode=calendarConflict?'CALENDAR_INCOMPATIBLE':sourceInvalid?'SOURCE_INCOMPATIBLE':
    !latest?'NO_LIVE_DATA':!lastRest?'NO_REST_CONTEXT':tooLate?'WARMUP_REGISTERED_TOO_LATE':
    entireSessionMissing?'MISSING_OFFICIAL_SESSION':missing.length?'MISSING_EXPECTED_15M_BAR':
    !bridgeConnected?'WARMUP_TO_LIVE_GAP':feedStatus!=='SUBSCRIBED'?'FEED_DISCONNECTED':
    at-Date.parse(latest!.receivedAtUtc)>15*60_000?'STALE_LIVE_BAR':
    frames['1d'].smas[200].value===null?'INSUFFICIENT_DAILY_SMA_HISTORY':'CONNECTED';
  const reasons:string[]=[];
  if(missing.length)reasons.push(`${missing.length} intervalos oficiales de 15 minutos no observados entre el REST registrado y la última vela Live; sesiones afectadas: ${[...missingSessions].join(', ')}.`);
  if(overlap)reasons.push(`${overlap} primeras versiones Live solapan barras REST; el diagnóstico utiliza Live en esos timestamps.`);
  if(feedStatus!=='SUBSCRIBED')reasons.push('FEED_DISCONNECTED');
  if(latest&&at-Date.parse(latest.receivedAtUtc)>15*60_000)reasons.push('STALE_LIVE_BAR');
  const contextUsed=lastRest;
  return {schema:'phase41p-continuity-v1',checkedAtUtc:nowUtc,code,
    live:{firstBarStartUtc:first[0]?.bar?.startUtc??null,lastBarStartUtc:latest?.bar?.startUtc??null,
      lastBarEndUtc:latest?.bar?.endUtc??null,lastReceivedAtUtc:latest?.receivedAtUtc??null,
      feedStatus,verified15mBars:first.length,
      revisions:records.filter(row=>row.kind==='quarter').length-first.length},
    rest:{registeredAtUtc:contextUsed?.registeredAtUtc??null,earliestBarStartUtc:restFirst,
      latestBarStartUtc:restLast,bars:allRest.length,manifestSha256:contextUsed?.manifestSha256??null,
      kind:contextUsed?.kind??null},
    bridge:{firstRelevantLiveBarStartUtc:relevant?.bar?.startUtc??null,firstExpectedAfterRestUtc:restLast?
      ([...calendar].sort(([a],[b])=>a.localeCompare(b)).flatMap(([day,hours])=>
        Array.from({length:(hours.close-hours.open)/15},(_,i)=>iso(marketMinuteUtc(day,hours.open)+i*QUARTER)))
        .find(slot=>slot>restLast)??firstExpected):null,
      missingSessions:[...missingSessions],missing15mCount:missing.length,firstMissing15mUtc:missing[0]??null,
      firstActualDiscontinuity:discontinuity,continuousSuffixBars:suffix.length,lastContinuousStartUtc:suffixStart,
      overlappingBars:overlap},
    indicators:{timeframes:frames,bollinger:{middle:band?.middle??null,upper:band?.upper??null,
      lower:band?.lower??null,availableAtUtc:band?.middle!==null&&band?.middle!==undefined?availabilityFor(20):null},
      rvol:{value:volume?.average&&latest?.bar?latest.bar.volume/volume.average:null,
        availableAtUtc:volume?.average?availabilityFor(21):null}},
    candidate:{lastDetectedAtUtc:detected.at(-1)?.registeredAtUtc??null,
      lastEvaluatedEventAtUtc:recordsForCandidate.at(-1)?.registeredAtUtc??null,
      lastEligibleEventAtUtc:eligible.at(-1)?.registeredAtUtc??null,detectedCount:detected.length,
      pendingOutcomeCount:detected.filter(row=>!outcomes.has(row.payload?.candidateId)).length,
      exclusionCounts},reasons};
}

export function warmupAsRestContext(warmup:IexWarmup):RestContext{return {...warmup,
  manifestSha256:warmup.manifestSha256??null,kind:'38F_WARMUP'};}
