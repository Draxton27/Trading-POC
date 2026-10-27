/** V2 source assembly. V1 candidates and their ledger remain immutable. */
import {TechnicalContext} from '@trading-poc/contracts';
import type {MarketCalendar} from './alpaca-calendar.ts';
import type {IexRecord} from './phase38-iex.ts';
import type {RestContext} from './phase41p-continuity.ts';
import {causalIexCandles,mergeOfficialCalendar} from './phase41p-continuity.ts';
import {firstCompleteOpportunityBars,opportunityMetrics,type OpportunityPrepared} from './phase41o-opportunity-engine.ts';
import {phase23ContinuousSuffix} from './phase23-dataset.ts';
import {buildInvestepTechnicalContext} from './investep-technical-context.ts';
import {buildInvestepScenarios} from './phase41k-scenarios.ts';
import {opportunityHash} from './phase41o-ledger.ts';

const QUARTER=900_000;
export function prepareOpportunityTechnicalV2(records:readonly IexRecord[],official:MarketCalendar,
  rest:readonly RestContext[],nowUtc:string):OpportunityPrepared{
  const now=Date.parse(nowUtc),first=firstCompleteOpportunityBars(records,nowUtc),last=first.at(-1)??null;
  const base={last,scenarios:[] as OpportunityPrepared['scenarios'],sourceHashes:[] as string[],
    windowHash:null,warmup:'REST_REGISTERED' as const,warmupCsvSha256:null,
    warmupRegisteredAtUtc:null,calendar:official};
  if(!last)return {...base,status:'NO_LIVE_DATA',reason:'NO_LIVE_DATA'};
  const feed=records.filter(row=>row.kind==='status'&&Date.parse(row.receivedAtUtc)<=now).at(-1)?.status;
  if(feed!=='SUBSCRIBED')return {...base,status:'FEED_DISCONNECTED',reason:'FEED_DISCONNECTED'};
  if(now-Date.parse(last.receivedAtUtc)>15*60_000)return {...base,status:'STALE_MARKET_DATA',reason:'STALE_LIVE_BAR'};
  const available=rest.filter(row=>Date.parse(row.registeredAtUtc)<=now);
  const newest=available.at(-1);
  if(!newest||Date.parse(newest.registeredAtUtc)>Date.parse(last.receivedAtUtc))
    return {...base,status:'INSUFFICIENT_DATA',reason:'WARMUP_REGISTERED_TOO_LATE'};
  const calendar=mergeOfficialCalendar(official,available),merged=causalIexCandles(records,available,nowUtc);
  const candles=merged.map(row=>row.candle),continuous=phase23ContinuousSuffix(candles,calendar);
  if(continuous.length<21||continuous.at(-1)?.timestamp!==last.bar?.startUtc)
    return {...base,calendar,status:'INSUFFICIENT_DATA',reason:'MISSING_EXPECTED_15M_BAR'};
  const bars=merged.map(row=>({symbol:'NVDA' as const,timeframe:'15m' as const,
    startUtc:row.candle.timestamp,endUtc:new Date(Date.parse(row.candle.timestamp)+QUARTER).toISOString(),
    open:row.candle.open,high:row.candle.high,low:row.candle.low,close:row.candle.close,
    volume:row.candle.volume,provider:'Alpaca Market Data API',adjustment:'raw',
    receivedAtUtc:row.availableAtUtc,isComplete:true}));
  const context=buildInvestepTechnicalContext({symbol:'NVDA',asOfUtc:nowUtc,bars,calendar,
    provider:'Alpaca Market Data API',feed:'iex',adjustment:'raw',historicalOrSynthetic:'HISTORICAL'});
  if(context.lastCompleteBarUtc!==last.bar?.endUtc||context.dataStatus==='STALE')
    return {...base,calendar,status:'INSUFFICIENT_DATA',reason:'MISSING_EXPECTED_15M_BAR'};
  const metrics=opportunityMetrics(continuous);
  const scenarios=buildInvestepScenarios(TechnicalContext.parse(context),metrics,true,last.receivedAtUtc);
  const newEvents=scenarios.current.filter(s=>s.family!=='BOLLINGER_VOLUME_CONTEXT'&&s.scope==='CURRENT'&&
    s.availableAtUtc!==null&&Date.parse(s.availableAtUtc)<=now&&
    context.timeframes[s.timeframe].lastCompleteBarUtc===last.bar!.endUtc);
  const sourceHashes=merged.map(row=>row.source==='LIVE'?row.hash:opportunityHash([row.hash,row.candle]));
  const windowHash=opportunityHash(merged.map((row,i)=>[sourceHashes[i],row.availableAtUtc]));
  return {status:'READY',reason:'IEX_REST_CONTEXT_SNAPSHOT verificado y causal.',last,
    scenarios:newEvents,sourceHashes,windowHash,warmup:'REST_REGISTERED',
    warmupCsvSha256:opportunityHash(available.map(row=>row.csvSha256)),
    warmupRegisteredAtUtc:newest.registeredAtUtc,calendar};
}
