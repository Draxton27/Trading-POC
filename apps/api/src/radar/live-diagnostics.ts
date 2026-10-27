/** Read-only live projection. GET never fetches Alpaca data, subscribes IBKR or appends a ledger. */
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import type {FastifyInstance} from 'fastify';
import {loadMarketCalendar} from '../../../../trading_poc_001_bollinger/src/alpaca-calendar.ts';
import {readIexLedger} from '../../../../trading_poc_001_bollinger/src/phase38-iex.ts';
import {loadIexWarmup} from '../../../../trading_poc_001_bollinger/src/phase38f-warmup.ts';
import {loadIexRestContext} from '../../../../trading_poc_001_bollinger/src/phase41p-rest-context.ts';
import {diagnoseOpportunityContinuity,warmupAsRestContext,type RestContext} from '../../../../trading_poc_001_bollinger/src/phase41p-continuity.ts';
import {OpportunityStore} from '../../../../trading_poc_001_bollinger/src/phase41o-ledger.ts';

type Mode='DEMO'|'OFFLINE'|'PAPER';
export type LiveDiagnosticPaths={ledger:string;calendar:string;warmup:string|null;context:string|null;opportunities:string};
export const liveDiagnosticPaths=(privateDir:string,env:NodeJS.ProcessEnv=process.env):LiveDiagnosticPaths=>({
  ledger:env.TRADING_POC_IEX_LEDGER??resolve(privateDir,'iex','ledger.jsonl'),
  calendar:env.TRADING_POC_IEX_CALENDAR??resolve(privateDir,'iex','calendar.json'),
  warmup:env.TRADING_POC_IEX_WARMUP_REGISTRY??null,context:env.TRADING_POC_IEX_OPPORTUNITY_CONTEXT_REGISTRY??null,
  opportunities:env.TRADING_POC_OPPORTUNITY_LEDGER??resolve(privateDir,'radar','opportunities.jsonl')});

export function registerLiveDiagnostics(app:FastifyInstance,options:{mode:Mode;paths:LiveDiagnosticPaths;
  broker:()=>{connected:boolean;simulation:boolean};clock?:()=>number}){
  const {mode,paths}=options,clock=options.clock??Date.now;
  const read=async()=>{
    if(mode==='DEMO')return {state:'DEMO' as const,reason:'Fixtures sintéticas; sin IEX Live ni IBKR real.'};
    if(!existsSync(paths.calendar))return {state:'INVALID_SOURCE' as const,reason:'CALENDAR_UNAVAILABLE'};
    const records=readIexLedger(paths.ledger),calendar=loadMarketCalendar(paths.calendar);
    const rest:RestContext[]=[];
    if(paths.warmup){if(!existsSync(paths.warmup))return {state:'INVALID_SOURCE' as const,reason:'WARMUP_REGISTRY_ABSENT'};
      rest.push(warmupAsRestContext(loadIexWarmup(paths.warmup)));}
    if(paths.context){if(!existsSync(paths.context))return {state:'INVALID_SOURCE' as const,reason:'CONTEXT_REGISTRY_ABSENT'};
      rest.push(loadIexRestContext(paths.context));}
    const opportunityRows=await new OpportunityStore(paths.opportunities).read();
    const audit=diagnoseOpportunityContinuity({records,calendar,rest,nowUtc:new Date(clock()).toISOString(),
      candidateRecords:opportunityRows});
    const latest=records.filter(row=>row.kind==='quarter'&&row.status==='COMPLETE'&&row.bar&&
      row.bar.startUtc===audit.live.lastBarStartUtc).find(row=>row.revision===1)??null;
    const age=latest?(clock()-Date.parse(latest.receivedAtUtc))/60_000:null;
    const state=audit.code==='CALENDAR_INCOMPATIBLE'||audit.code==='SOURCE_INCOMPATIBLE'?'INVALID_SOURCE':
      latest===null?(audit.rest.bars>0?'HISTORICAL_ONLY':'INSUFFICIENT_DATA'):
      audit.live.feedStatus!=='SUBSCRIBED'?'FEED_DISCONNECTED':age!==null&&age>15?'STALE':
      audit.indicators.timeframes['15m'].smas[200].value===null||
      audit.indicators.timeframes['1h'].smas[200].value===null||
      audit.indicators.timeframes['1d'].smas[200].value===null?'PARTIAL':'CURRENT';
    const statuses=Object.fromEntries(opportunityRows.filter(row=>row.kind==='DETECTED').map(row=>{
      const updates=opportunityRows.filter(item=>item.kind==='TECHNICAL_UPDATE'&&item.payload.candidateId===row.payload.candidateId);
      const latest=updates.at(-1);
      return [row.payload.candidateId,latest?.kind==='TECHNICAL_UPDATE'?latest.payload.status:row.payload.status];
    }));
    const counts=Object.entries(statuses).reduce((result,[,status])=>{
      result[status]=(result[status]??0)+1;return result;
    },{} as Record<string,number>);
    return {state,reason:audit.code,source:'Alpaca IEX Live',feed:'iex',adjustment:'raw',symbol:'NVDA',
      barStartUtc:latest?.bar?.startUtc??null,barEndUtc:latest?.bar?.endUtc??null,
      receivedAtUtc:latest?.receivedAtUtc??null,registeredAtUtc:null,
      dataKnownAtUtc:latest?.receivedAtUtc??null,close:latest?.bar?.close??null,ageMinutes:age,
      collectorStatus:audit.live.feedStatus,broker:{connected:mode==='PAPER'&&options.broker().connected,
        simulation:options.broker().simulation},
      continuity:audit,abstentions:{detected:audit.candidate.detectedCount,byTechnicalStatus:counts,
        brokerConnected:mode==='PAPER'&&options.broker().connected}};
  };
  const handler=async(_request:unknown,reply:any)=>{
    try{return await read();}catch{return reply.code(503).send({state:'INVALID_SOURCE',reason:'PRIVATE_DATA_VERIFICATION_FAILED'});}
  };
  app.get('/api/v1/ml/iex/continuity',handler);
  app.get('/api/v1/market/live-technical-context',handler);
  app.get('/api/v1/radar/opportunities/diagnostics',handler);
}
