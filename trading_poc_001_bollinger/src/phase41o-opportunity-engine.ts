/** Causal IEX Live + previously registered raw REST warmup. No broker or model calls. */
import {TechnicalContext,type InvestepScenario,type OpportunityDetected,type OpportunityStatus} from '@trading-poc/contracts';
import type {MarketCalendar} from './alpaca-calendar.ts';
import type {IexRecord} from './phase38-iex.ts';
import type {IexWarmup} from './phase38f-warmup.ts';
import {phase23ContinuousSuffix} from './phase23-dataset.ts';
import {calculateBollinger} from './bollinger.ts';
import {calculateVolumeReferences} from './volume-filter.ts';
import {buildInvestepTechnicalContext} from './investep-technical-context.ts';
import {buildInvestepScenarios} from './phase41k-scenarios.ts';
import {newYorkBarParts} from './strategy-validation.ts';
import {opportunityHash} from './phase41o-ledger.ts';

const QUARTER=900_000,MAX_LIVE_AGE_MS=15*60_000;
export const OPPORTUNITY_RULE_VERSION='41O_V1' as const;
export const OPPORTUNITY_OUTCOME_BARS=4;
const stamp=(n:number)=>new Date(n).toISOString();
const localMinute=(s:string)=>{const [h,m]=newYorkBarParts(s).slot.split(':').map(Number);return h!*60+m!;};
export type OpportunityPrepared={status:'READY'|'NO_LIVE_DATA'|'STALE_MARKET_DATA'|'INSUFFICIENT_DATA'|'FEED_DISCONNECTED';
  reason:string;last:IexRecord|null;scenarios:InvestepScenario[];sourceHashes:string[];
  windowHash:string|null;warmup:'REST_REGISTERED'|'LIVE_ONLY';warmupCsvSha256:string|null;
  warmupRegisteredAtUtc:string|null;calendar:MarketCalendar};

/** The first complete version is immutable for this study, even when later IEX corrections arrive. */
export function firstCompleteOpportunityBars(records:readonly IexRecord[],nowUtc:string){
  const now=Date.parse(nowUtc),first=new Map<string,IexRecord>();
  for(const row of records){
    if(row.kind!=='quarter'||!row.bar||row.status!=='COMPLETE'||Date.parse(row.receivedAtUtc)>now)continue;
    if(row.feed!=='iex'||row.adjustment!=='raw'||row.symbol!=='NVDA'||row.revision===null||row.revision<1||
      Date.parse(row.bar.endUtc)-Date.parse(row.bar.startUtc)!==QUARTER||
      Date.parse(row.receivedAtUtc)<Date.parse(row.bar.endUtc))throw new Error('SOURCE_INCOMPATIBLE');
    if(!first.has(row.bar.startUtc)){
      if(row.revision!==1)throw new Error('FIRST_VERSION_MISSING');
      first.set(row.bar.startUtc,row);
    }
  }
  return [...first.values()].sort((a,b)=>a.bar!.startUtc.localeCompare(b.bar!.startUtc));
}

export function prepareOpportunityTechnical(records:readonly IexRecord[],official:MarketCalendar,
  warmup:IexWarmup|undefined,nowUtc:string):OpportunityPrepared{
  const now=Date.parse(nowUtc);
  if(!Number.isFinite(now)||new Date(now).toISOString()!==nowUtc)throw new Error('INVALID_CLOCK');
  const rows=firstCompleteOpportunityBars(records,nowUtc),last=rows.at(-1)??null;
  const base={last,scenarios:[] as InvestepScenario[],sourceHashes:[] as string[],windowHash:null as string|null,
    warmup:'LIVE_ONLY' as 'REST_REGISTERED'|'LIVE_ONLY',warmupCsvSha256:null as string|null,
    warmupRegisteredAtUtc:null as string|null,calendar:official};
  if(!last)return {...base,status:'NO_LIVE_DATA',reason:'No hay una primera versión IEX Live completa.'};
  const feed=records.filter(r=>r.kind==='status'&&Date.parse(r.receivedAtUtc)<=now).at(-1)?.status;
  if(feed!=='SUBSCRIBED')
    return {...base,status:'FEED_DISCONNECTED',reason:'No hay suscripción IEX Live activa y verificable.'};
  if(now-Date.parse(last.receivedAtUtc)>MAX_LIVE_AGE_MS)
    return {...base,status:'STALE_MARKET_DATA',reason:'La última vela completa IEX tiene más de 15 minutos desde su recepción.'};
  const firstLive=rows[0]!.bar!.startUtc,calendar=new Map(official),historical=warmup?.registeredAtUtc&&
    Date.parse(warmup.registeredAtUtc)<=Date.parse(last.receivedAtUtc)?warmup:undefined;
  if(historical){
    for(const [day,hours] of historical.calendar){const current=calendar.get(day);
      if(current&&(current.open!==hours.open||current.close!==hours.close))throw new Error('CALENDAR_CONFLICT');
      calendar.set(day,hours);
    }
  }
  const old=historical?.candles.filter(b=>b.timestamp<firstLive&&
    Date.parse(b.timestamp)+QUARTER<=Date.parse(historical.registeredAtUtc))??[];
  const candles=[...old,...rows.map(row=>({timestamp:row.bar!.startUtc,open:row.bar!.open,
    high:row.bar!.high,low:row.bar!.low,close:row.bar!.close,volume:row.bar!.volume}))];
  const continuous=phase23ContinuousSuffix(candles,calendar);
  if(continuous.length<21||continuous.at(-1)?.timestamp!==last.bar!.startUtc)
    return {...base,status:'INSUFFICIENT_DATA',reason:'Serie causal IEX continua menor de 21 velas o última vela ausente.',calendar};
  const liveByStart=new Map(rows.map(row=>[row.bar!.startUtc,row]));
  const bars=continuous.map(candle=>{
    const live=liveByStart.get(candle.timestamp),receivedAtUtc=live?.receivedAtUtc??historical?.registeredAtUtc;
    if(!receivedAtUtc||Date.parse(receivedAtUtc)>now)throw new Error('SOURCE_NOT_AVAILABLE');
    return {symbol:'NVDA' as const,timeframe:'15m' as const,startUtc:candle.timestamp,
      endUtc:stamp(Date.parse(candle.timestamp)+QUARTER),open:candle.open,high:candle.high,low:candle.low,
      close:candle.close,volume:candle.volume,provider:'Alpaca Market Data API',adjustment:'raw',
      receivedAtUtc,isComplete:true};
  });
  const sourceHashes=continuous.map(candle=>liveByStart.get(candle.timestamp)?.recordHash??
    opportunityHash([historical!.csvSha256,candle]));
  const context=buildInvestepTechnicalContext({symbol:'NVDA',asOfUtc:nowUtc,bars,calendar,
    provider:'Alpaca Market Data API',feed:'iex',adjustment:'raw',historicalOrSynthetic:'HISTORICAL'});
  const lastEnd=last.bar!.endUtc;
  if(context.lastCompleteBarUtc!==lastEnd||context.dataStatus==='STALE')
    return {...base,status:'INSUFFICIENT_DATA',reason:'El motor técnico detectó un hueco o una vela programada faltante.',calendar};
  const band=calculateBollinger(continuous).at(-1)!,reference=calculateVolumeReferences(continuous).at(-1)!;
  const current=continuous.at(-1)!,sameSession=(count:number)=>continuous.length>count&&
    newYorkBarParts(continuous.at(-1-count)!.timestamp).day===newYorkBarParts(current.timestamp).day;
  const one=sameSession(1)?100*(current.close/continuous.at(-2)!.close-1):null;
  const four=sameSession(4)?100*(current.close/continuous.at(-5)!.close-1):null;
  const metrics={close:current.close,bollingerUpper:band.upper,bollingerMiddle:band.middle,
    bollingerLower:band.lower,relativeVolume20:reference.average!==null&&reference.average>0?
      current.volume/reference.average:null,returnOneBarPercent:one,returnFourBarsPercent:four};
  const scenarios=buildInvestepScenarios(TechnicalContext.parse(context),metrics,true,last.receivedAtUtc);
  const newEvents=scenarios.current.filter(s=>s.family!=='BOLLINGER_VOLUME_CONTEXT'&&s.scope==='CURRENT'&&
    s.availableAtUtc!==null&&Date.parse(s.availableAtUtc)<=now&&
    context.timeframes[s.timeframe].lastCompleteBarUtc===lastEnd);
  return {status:'READY',reason:'Primera versión IEX Live y contexto 41K verificados.',last,
    scenarios:newEvents,sourceHashes,windowHash:opportunityHash(sourceHashes.map((hash,i)=>[hash,bars[i]!.receivedAtUtc])),
    warmup:old.length?'REST_REGISTERED':'LIVE_ONLY',warmupCsvSha256:old.length?historical!.csvSha256:null,
    warmupRegisteredAtUtc:old.length?historical!.registeredAtUtc:null,calendar};
}

export function candidateStatus(scenario:InvestepScenario):{status:OpportunityStatus;reasons:string[]}{
  const reasons:string[]=[];
  if(scenario.state==='AWAITING_CONFIRMATION')return {status:'AWAITING_CONFIRMATION',reasons:['El retesteo todavía no está confirmado.']};
  if(scenario.state!=='OBSERVED'||!scenario.confirmations.length)
    return {status:'NO_CANDIDATE',reasons:['El escenario no conserva una confirmación observada.']};
  if(scenario.context===null||(['15m','1h','1d'] as const).some(frame=>{
    const f=scenario.context!.frames[frame];return f.barEndUtc===null||
      ([20,40,100,200] as const).some(period=>f.smas[period].value===null);
  }))return {status:'INSUFFICIENT_DATA',reasons:['Faltan 15m/1h/1d completos o SMA20/40/100/200 disponibles.']};
  if(scenario.contradictions.length)return {status:'CONTRADICTORY_CONTEXT',
    reasons:['Existen contradicciones técnicas explícitas entre temporalidades o parejas SMA.']};
  const expected=scenario.direction==='ABOVE'?'BULLISH_ALIGNMENT':'BEARISH_ALIGNMENT';
  if((['15m','1h','1d'] as const).some(frame=>{
    const f=scenario.context!.frames[frame];return f.shortPair!==expected||f.longPair!==expected;
  }))return {status:'CONTRADICTORY_CONTEXT',reasons:['Las parejas SMA20/40 y SMA100/200 no están alineadas en las tres temporalidades.']};
  return {status:'TECHNICAL_CANDIDATE',reasons:['Hipótesis experimental para revisión humana; la geometría no demuestra rentabilidad.']};
}

export function buildOpportunityCandidates(prepared:OpportunityPrepared,nowUtc:string):OpportunityDetected[]{
  if(prepared.status!=='READY'||!prepared.last?.bar||!prepared.windowHash)return [];
  const bar=prepared.last.bar,session=prepared.calendar.get(newYorkBarParts(bar.startUtc).day);
  if(!session)throw new Error('CALENDAR_MISSING');
  const end=Date.parse(bar.endUtc),outcome=end+OPPORTUNITY_OUTCOME_BARS*QUARTER;
  const scheduled=localMinute(stamp(outcome))<=session.close&&
    newYorkBarParts(stamp(outcome)).day===newYorkBarParts(bar.startUtc).day?stamp(outcome):null;
  return prepared.scenarios.map(scenario=>{
    const result=candidateStatus(scenario);
    return {candidateId:opportunityHash([OPPORTUNITY_RULE_VERSION,scenario.id]),ruleVersion:OPPORTUNITY_RULE_VERSION,
      detectedAtUtc:nowUtc,technicalEvidenceAvailableAtUtc:scenario.availableAtUtc!,
      marketSource:'Alpaca Market Data API',marketFeed:'IEX Live',adjustment:'raw',symbol:'NVDA',
      barStartUtc:bar.startUtc,barEndUtc:bar.endUtc,sourceBarHash:prepared.last!.recordHash,
      sourceWindowHash:prepared.windowHash!,calendarHash:opportunityHash([...prepared.calendar.entries()]),
      sourceHashes:prepared.sourceHashes.slice(-256),sourceHashCount:prepared.sourceHashes.length,
      warmup:prepared.warmup,
      warmupCsvSha256:prepared.warmupCsvSha256,warmupRegisteredAtUtc:prepared.warmupRegisteredAtUtc,
      observedUnderlyingPrice:bar.close,
      directionHypothesis:scenario.direction==='ABOVE'?'CALL':'PUT',scenario,
      status:result.status,exclusionReasons:result.reasons,outcomeScheduledEndUtc:scheduled};
  });
}
