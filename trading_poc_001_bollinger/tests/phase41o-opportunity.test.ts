import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {InvestepScenario,OpportunityDetected} from '@trading-poc/contracts';
import type {IexRecord} from '../src/phase38-iex.ts';
import {OpportunityStore,opportunityHash,readOpportunityLedger} from '../src/phase41o-ledger.ts';
import {firstCompleteOpportunityBars,prepareOpportunityTechnical,candidateStatus,
  buildOpportunityCandidates} from '../src/phase41o-opportunity-engine.ts';
import {observeIexOpportunities} from '../src/phase41o-observer.ts';

const start='2026-10-21T13:30:00.000Z',quarter=900_000,at=(n:number)=>new Date(Date.parse(start)+n*quarter).toISOString();
const calendar=new Map([['2026-10-21',{open:570,close:960}]]);
const H='a'.repeat(64),frame=(timeframe:'15m'|'1h'|'1d',barEndUtc:string,pair='BULLISH_ALIGNMENT')=>({
  timeframe,barEndUtc,shortPair:pair,longPair:pair,state:pair,
  smas:Object.fromEntries([20,40,100,200].map(period=>[period,{value:100,slope:'RISING',priceDistancePercent:1,
    priceAboveSma:true,priceBelowSma:false}]))});
function scenario(direction:'ABOVE'|'BELOW'='ABOVE',state='OBSERVED',pair='BULLISH_ALIGNMENT'){
  const trigger={kind:'CROSS',description:'Cruce sintético',barStartUtc:at(0),observedAtUtc:at(1),availableAtUtc:at(1)};
  return InvestepScenario.parse({id:H,symbol:'NVDA',family:'SMA_STRUCTURE_BREAK',timeframe:'15m',direction,state,scope:'CURRENT',
    period:20,breakAtUtc:null,barsSinceBreak:null,eventAtUtc:at(1),availableAtUtc:at(1),asOfUtc:at(1),
    source:{name:'fixture sintética',provider:'fixture',feed:'iex',adjustment:'raw',dataStatus:'HISTORICAL',receiptVerified:true},
    feed:'iex',adjustment:'raw',dataStatus:'HISTORICAL',trigger,
    context:{alignment:'ALIGNED_BULLISH',frames:{'15m':frame('15m',at(1),pair),'1h':frame('1h',at(1),pair),
      '1d':frame('1d',at(1),pair)}},confirmations:[trigger],contradictions:[],limitations:[],relatedLevels:[],bollingerVolume:null});
}
function candidate(direction:'ABOVE'|'BELOW'='ABOVE'){
  const s=scenario(direction,direction==='BELOW'?'AWAITING_CONFIRMATION':'OBSERVED');
  return OpportunityDetected.parse({candidateId:opportunityHash(['candidate',direction]),ruleVersion:'41O_V1',
    detectedAtUtc:at(2),technicalEvidenceAvailableAtUtc:at(1),marketSource:'Alpaca Market Data API',marketFeed:'IEX Live',
    adjustment:'raw',symbol:'NVDA',barStartUtc:at(0),barEndUtc:at(1),sourceBarHash:H,sourceWindowHash:H,calendarHash:H,
    sourceHashes:[H],sourceHashCount:1,warmup:'LIVE_ONLY',warmupCsvSha256:null,warmupRegisteredAtUtc:null,
    observedUnderlyingPrice:100,directionHypothesis:direction==='ABOVE'?'CALL':'PUT',
    scenario:s,status:candidateStatus(s).status,exclusionReasons:candidateStatus(s).reasons,outcomeScheduledEndUtc:at(5)});
}
function quarterRow(index:number,revision=1,receivedAtUtc=at(index+1),close=100+index):IexRecord{
  return {schema:'phase38-iex-v1',id:opportunityHash([index,revision]),previousHash:null,
    recordHash:opportunityHash(['row',index,revision]),kind:'quarter',feed:'iex',adjustment:'raw',symbol:'NVDA',
    eventAtUtc:at(index+1),receivedAtUtc,status:'COMPLETE',revision,sourceMessageHash:H,latencyMs:0,
    bar:{startUtc:at(index),endUtc:at(index+1),open:close,high:close+1,low:close-1,close,volume:1000,tradeCount:100}};
}
const subscribed=():IexRecord=>({...quarterRow(0),kind:'status',bar:null,status:'SUBSCRIBED',revision:null,
  receivedAtUtc:at(0)});

test('primera vela IEX completa es inmutable; incompleta y revisión tardía no sustituyen la fuente',()=>{
  const rows=[quarterRow(0),quarterRow(0,2,at(3),200),{...quarterRow(1),status:'PARTIAL'}];
  assert.equal(firstCompleteOpportunityBars(rows,at(4)).length,1);
  assert.equal(firstCompleteOpportunityBars(rows,at(4))[0]!.bar!.close,100);
  assert.throws(()=>firstCompleteOpportunityBars([quarterRow(0,2)],at(4)),/FIRST_VERSION_MISSING/);
});

test('filtros técnicos conservadores no convierten cruce en oportunidad sin contexto',()=>{
  assert.equal(candidateStatus(scenario()).status,'TECHNICAL_CANDIDATE');
  assert.equal(candidateStatus(scenario('ABOVE','AWAITING_CONFIRMATION')).status,'AWAITING_CONFIRMATION');
  assert.equal(candidateStatus(scenario('ABOVE','OBSERVED','BEARISH_ALIGNMENT')).status,'CONTRADICTORY_CONTEXT');
  assert.equal(candidate('BELOW').directionHypothesis,'PUT');
});

test('feed desconectado, vela tardía y hueco no crean candidato; 1h y 1d no se inventan',()=>{
  const candles=[subscribed(),...Array.from({length:21},(_,i)=>quarterRow(i))];
  const disconnected:IexRecord={...quarterRow(21),kind:'status',bar:null,status:'DISCONNECTED',revision:null};
  assert.equal(prepareOpportunityTechnical([...candles,disconnected],calendar,undefined,at(22)).status,'FEED_DISCONNECTED');
  assert.equal(prepareOpportunityTechnical(candles,calendar,undefined,at(23)).status,'STALE_MARKET_DATA');
  const missing=candles.filter((_,i)=>i!==6);
  assert.equal(prepareOpportunityTechnical(missing,calendar,undefined,at(21)).status,'INSUFFICIENT_DATA');
  const ready=prepareOpportunityTechnical(candles,calendar,undefined,at(21));
  assert.equal(ready.status,'READY');
  assert.equal(ready.warmup,'LIVE_ONLY');
  assert.ok(buildOpportunityCandidates(ready,at(21)).every(c=>c.status==='INSUFFICIENT_DATA'||
    c.status==='CONTRADICTORY_CONTEXT'||c.status==='AWAITING_CONFIRMATION'));
});

test('calentamiento IEX raw solo participa si fue registrado antes de la vela Live',()=>{
  const prior=Date.parse('2026-10-20T13:30:00.000Z');
  const candles=Array.from({length:26},(_,i)=>({timestamp:new Date(prior+i*quarter).toISOString(),
    open:100,high:101,low:99,close:100,volume:1000}));
  const official=new Map([['2026-10-20',{open:570,close:960}],...calendar]);
  const live=[subscribed(),...Array.from({length:21},(_,i)=>quarterRow(i))];
  const warmup={candles,calendar:official,registeredAtUtc:'2026-10-20T20:30:00.000Z',csvSha256:H};
  const before=prepareOpportunityTechnical(live,official,warmup,at(21));
  const after=prepareOpportunityTechnical(live,official,{...warmup,registeredAtUtc:at(22)},at(21));
  assert.equal(before.status,'READY');assert.equal(before.warmup,'REST_REGISTERED');
  assert.equal(before.warmupCsvSha256,H);assert.equal(before.sourceHashes.length,47);
  assert.equal(after.status,'READY');assert.equal(after.warmup,'LIVE_ONLY');
  assert.equal(after.sourceHashes.length,21);
});

test('horizonte congela el cierre oficial y no atraviesa un cierre anticipado',()=>{
  const base={status:'READY' as const,reason:'fixture',scenarios:[scenario()],sourceHashes:[H],windowHash:H,
    warmup:'LIVE_ONLY' as const,warmupCsvSha256:null,warmupRegisteredAtUtc:null};
  const early=buildOpportunityCandidates({...base,last:quarterRow(13),
    calendar:new Map([['2026-10-21',{open:570,close:780}]])},at(14));
  const regular=buildOpportunityCandidates({...base,last:quarterRow(20),calendar},at(21));
  assert.equal(early[0]!.outcomeScheduledEndUtc,null);
  assert.equal(regular[0]!.outcomeScheduledEndUtc,at(25));
});

test('ledger append-only idempotente entre escritores, desenlace único y hash verificable',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'phase41o-')),path=join(directory,'opportunities.jsonl');
  try{
    const a=new OpportunityStore(path),b=new OpportunityStore(path),c=candidate();
    const results=await Promise.all([a.append('DETECTED',c,()=>at(2)),b.append('DETECTED',c,()=>at(2))]);
    assert.equal(results.filter(x=>!x.alreadyPresent).length,1);
    assert.equal((await readOpportunityLedger(path)).length,1);
    const outcome={candidateId:c.candidateId,evaluatedAtUtc:at(6),outcomeEndUtc:at(5),
      firstVersionBarHashes:[H,H,H,H],close:101,movementPercent:1};
    await a.append('UNDERLYING_OUTCOME',outcome,()=>at(6));
    assert.equal((await b.append('UNDERLYING_OUTCOME',outcome,()=>at(6))).alreadyPresent,true);
    await assert.rejects(()=>b.append('UNDERLYING_OUTCOME',{...outcome,close:102},()=>at(6)),/ALREADY_RECORDED/);
    const raw=await readFile(path,'utf8');
    await writeFile(path,raw.replace('TECHNICAL_CANDIDATE','REVIEWABLE_PAPER_CANDIDATE'));
    await assert.rejects(()=>readOpportunityLedger(path),/INTEGRITY/);
    await writeFile(path,raw.trimEnd());
    await assert.rejects(()=>readOpportunityLedger(path),/TRUNCATED/);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('confirmación posterior se añade sin degradar ni reescribir el estado inicial',async()=>{
  const store=new OpportunityStore(null),initial=candidate('BELOW'),confirmed=scenario('BELOW','OBSERVED','BEARISH_ALIGNMENT');
  await store.append('DETECTED',initial,()=>at(2));
  const classification=candidateStatus(confirmed);
  await store.append('TECHNICAL_UPDATE',{candidateId:initial.candidateId,scenarioId:confirmed.id,
    observedAtUtc:at(3),scenarioState:confirmed.state,evidenceAvailableAtUtc:confirmed.availableAtUtc!,
    sourceBarHash:H,scenario:confirmed,status:classification.status,exclusionReasons:classification.reasons},()=>at(3));
  const records=await store.read();
  assert.equal(records.length,2);assert.equal(records[0]!.kind,'DETECTED');
  if(records[0]!.kind==='DETECTED')assert.equal(records[0]!.payload.status,'AWAITING_CONFIRMATION');
  assert.equal(records[1]!.kind,'TECHNICAL_UPDATE');
  if(records[1]!.kind==='TECHNICAL_UPDATE')assert.equal(records[1]!.payload.status,'TECHNICAL_CANDIDATE');
});

test('observador no hace backfill tras reinicio y conserva revisiones históricas',async()=>{
  const store=new OpportunityStore(null),rows=[subscribed(),...Array.from({length:21},(_,i)=>quarterRow(i))];
  const result=await observeIexOpportunities({records:rows,calendar,store,nowUtc:at(21),
    processStartedAtUtc:at(22)});
  assert.equal(result.candidates,0);
  assert.equal((await store.read()).length,0);
  const withRevision=[...rows,quarterRow(0,2,at(21),500)];
  assert.equal(firstCompleteOpportunityBars(withRevision,at(21))[0]!.bar!.close,100);
});

test('vela nueva genera un evento prospectivo causal; el desenlace usa solo primeras versiones posteriores',async()=>{
  const store=new OpportunityStore(null);
  const rows=[subscribed(),...Array.from({length:21},(_,i)=>quarterRow(i,1,at(i+1),i===20?120:100-i*.1))];
  const first=await observeIexOpportunities({records:rows,calendar,store,nowUtc:at(21),processStartedAtUtc:at(20)});
  assert.equal(first.status,'READY');assert.ok(first.candidates>0);
  const original=(await store.read()).filter(row=>row.kind==='DETECTED');
  assert.ok(original.every(row=>row.payload.status==='INSUFFICIENT_DATA'||row.payload.status==='AWAITING_CONFIRMATION'));
  assert.ok(original.every(row=>row.payload.technicalEvidenceAvailableAtUtc<=row.registeredAtUtc));
  const duplicate=await observeIexOpportunities({records:rows,calendar,store,nowUtc:at(21),processStartedAtUtc:at(20)});
  assert.equal(duplicate.candidates,0);
  const future=Array.from({length:4},(_,i)=>quarterRow(21+i,1,at(22+i),130+i));
  await observeIexOpportunities({records:[...rows,...future,quarterRow(21,2,at(25),900)],calendar,
    store,nowUtc:at(25),processStartedAtUtc:at(20)});
  const outcomes=(await store.read()).filter(row=>row.kind==='UNDERLYING_OUTCOME');
  assert.equal(outcomes.length,original.filter(row=>row.payload.outcomeScheduledEndUtc!==null).length);
  assert.ok(outcomes.every(row=>row.payload.close===133));
  assert.deepEqual((await store.read()).filter(row=>row.kind==='DETECTED').slice(0,original.length),original);
});
