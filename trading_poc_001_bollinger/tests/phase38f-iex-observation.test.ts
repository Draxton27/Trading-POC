import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import type {IexRecord} from '../src/phase38-iex.ts';
import {appendIexPrediction,evaluateIexPredictions,prepareIexObservation,readIexObservations,type IexFrozen} from '../src/phase38f-iex-observation.ts';
import {PHASE31_FEATURES} from '../src/phase31-inference.ts';
import {calculatePhase23Features} from '../src/phase23-dataset.ts';
import {createHash} from 'node:crypto';
import {loadIexWarmup,registerIexWarmup} from '../src/phase38f-warmup.ts';

const days=['2026-10-19','2026-10-20','2026-10-21','2026-10-22'];
const calendar=new Map(days.map(day=>[day,{open:570,close:960}] as const));
const model:IexFrozen={schema:'phase38f-frozen-v1',modelSha256:'a'.repeat(64),cutoffUtc:'2026-10-19T00:00:00.000Z',frozenAtUtc:'2026-10-19T00:01:00.000Z',
  features:[...PHASE31_FEATURES],classes:['ALCISTA','BAJISTA','LATERAL'],feed:'iex',adjustment:'raw',frequency:[.3,.3,.4]};
function record(day:string,index:number,revision=1):IexRecord{
  const start=Date.parse(`${day}T13:30:00.000Z`)+index*900_000;
  const at=new Date(start).toISOString(),end=new Date(start+900_000).toISOString(),price=100+days.indexOf(day)*3+index*.1;
  return {schema:'phase38-iex-v1',id:`${day}-${index}-${revision}`,previousHash:null,recordHash:`hash-${day}-${index}-${revision}`,
    kind:'quarter',feed:'iex',adjustment:'raw',symbol:'NVDA',eventAtUtc:end,
    receivedAtUtc:new Date(start+900_000+5_000+revision-1).toISOString(),status:'COMPLETE',
    bar:{startUtc:at,endUtc:end,open:price,high:price+1,low:price-1,close:price+.2+(revision-1)*20,volume:1000+index,tradeCount:100},
    revision,sourceMessageHash:'source',latencyMs:5_000};
}
function history(){return days.flatMap((day,i)=>Array.from({length:i===3?3:26},(_,j)=>record(day,j)));}

test('IEX first versions preserve Fase 23 ten features and ignore late revisions',()=>{
  const rows=history(),now='2026-10-22T14:15:10.000Z';
  const prepared=prepareIexObservation(rows,calendar,model,now);
  assert.equal(prepared.sourceBars.length,81);
  const reference=calculatePhase23Features(rows.map(row=>({timestamp:row.bar!.startUtc,open:row.bar!.open,high:row.bar!.high,
    low:row.bar!.low,close:row.bar!.close,volume:row.bar!.volume})),calendar).at(-1)!;
  for(const key of PHASE31_FEATURES){if(key==='minutes_from_open')assert.equal(prepared.features[key],30);
    else assert.equal(prepared.features[key],reference[key]);}
  rows.push(record('2026-10-20',4,2));
  const revised=prepareIexObservation(rows,calendar,model,now);
  assert.equal(revised.featureHash,prepared.featureHash);
  assert.deepEqual(revised.sourceBars,prepared.sourceBars);
});

test('IEX does not backfill, skip gaps, or use a model frozen after the candle',()=>{
  const rows=history(),now='2026-10-22T14:15:10.000Z';
  assert.throws(()=>prepareIexObservation(rows,calendar,{...model,cutoffUtc:'2026-10-22T14:00:00.000Z'},now),/backfill/);
  assert.throws(()=>prepareIexObservation(rows,calendar,{...model,frozenAtUtc:'2026-10-22T14:00:00.000Z'},now),/backfill/);
  assert.throws(()=>prepareIexObservation(rows.filter(row=>row.bar?.startUtc!=='2026-10-21T17:30:00.000Z'),calendar,model,now),/INDICATORS_INSUFFICIENT/);
  assert.equal(prepareIexObservation(rows,calendar,model,'2026-10-22T14:14:00.000Z').candidate.bar!.startUtc,'2026-10-22T13:45:00.000Z');
  assert.throws(()=>prepareIexObservation(rows,calendar,model,'2026-10-22T14:31:00.000Z'),/STALE_LIVE_DATA/);
  const disconnected=rows.filter(row=>row.bar!.startUtc<'2026-10-22T13:30:00.000Z');
  assert.throws(()=>prepareIexObservation(disconnected,calendar,model,now),/STALE_LIVE_DATA/);
  const reconnected=[...disconnected,record('2026-10-22',0),record('2026-10-22',1),record('2026-10-22',2)];
  assert.equal(prepareIexObservation(reconnected,calendar,model,now).candidate.bar!.startUtc,'2026-10-22T14:00:00.000Z');
});

test('verified REST snapshot registered before the candle warms EMA without producing a REST prediction',()=>{
  const rows=history(),live=rows.filter(row=>row.bar!.startUtc.startsWith('2026-10-22'));
  const historical=rows.filter(row=>!row.bar!.startUtc.startsWith('2026-10-22')).map(row=>({timestamp:row.bar!.startUtc,
    open:row.bar!.open,high:row.bar!.high,low:row.bar!.low,close:row.bar!.close,volume:row.bar!.volume}));
  const warmup={candles:historical,calendar:new Map([...calendar].filter(([day])=>day<'2026-10-22')),
    registeredAtUtc:'2026-10-21T21:00:00.000Z',csvSha256:'b'.repeat(64)};
  const prepared=prepareIexObservation(live,new Map([['2026-10-22',{open:570,close:960}]]),model,'2026-10-22T14:15:10.000Z',warmup);
  assert.equal(prepared.candidate.kind,'quarter');
  assert.equal(prepared.sourceBars.filter(row=>row.origin==='REST_WARMUP').length,78);
  assert.equal(prepared.sourceBars.filter(row=>row.origin==='LIVE').length,3);
  assert.throws(()=>prepareIexObservation(live,calendar,model,'2026-10-22T14:15:10.000Z',
    {...warmup,registeredAtUtc:'2026-10-22T14:00:00.000Z'}),/backfill/);
});

test('warmup registry verifies a synthetic Phase 38D snapshot and detects later changes',()=>{
  const folder=mkdtempSync(join(tmpdir(),'iex-warmup-')),source=join(folder,'source'),registry=join(folder,'registry.json');
  try{
    mkdirSync(source);
    const query={schema:'phase38d-v1',symbol:'NVDA',feed:'iex',timeframe:'1Min',adjustment:'raw'};
    const csv='timestamp,open,high,low,close,volume\n2026-10-20T13:30:00.000Z,100,101,99,100.5,1000\n';
    const calendarFile=JSON.stringify({provider:'Alpaca Market Calendar',sessions:[{date:'2026-10-20',open:570,close:960}]});
    const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
    const report={schema:'phase38d-report-v1',source:query,sha256:{strict15mCsv:sha(csv),calendar:sha(calendarFile)},summary:{strict15m:1}};
    for(const [name,content] of [['query.json',JSON.stringify(query)],['calendar.json',calendarFile],
      ['strict-15m.csv',csv],['report.json',JSON.stringify(report)]] as const)writeFileSync(join(source,name),content);
    writeFileSync(join(source,'SHA256SUMS'),['query.json','calendar.json','strict-15m.csv','report.json']
      .map(name=>`${sha(readFileSync(join(source,name),'utf8'))}  ${name}\n`).join(''));
    assert.throws(()=>registerIexWarmup(source,registry,()=> '2026-10-20T13:40:00.000Z'),/posteriores/);
    const result=registerIexWarmup(source,registry,()=> '2026-10-20T14:00:00.000Z');
    assert.equal(result.rows,1);
    assert.equal(loadIexWarmup(registry).candles.length,1);
    assert.throws(()=>registerIexWarmup(source,registry,()=> '2026-10-20T14:01:00.000Z'));
    writeFileSync(join(source,'strict-15m.csv'),csv+'2026-10-20T13:45:00.000Z,100,101,99,100.5,1000\n');
    assert.throws(()=>loadIexWarmup(registry),/modificado/);
  }finally{rmSync(folder,{recursive:true,force:true});}
});

test('prospective predictions are append-only, idempotent and evaluated separately',()=>{
  const folder=mkdtempSync(join(tmpdir(),'iex-phase38f-')),path=join(folder,'observations.jsonl');
  try{
    const prepared=prepareIexObservation(history(),calendar,model,'2026-10-22T14:15:10.000Z');
    const input={mode:'IEX_PROSPECTIVE_OBSERVATION' as const,modelSha256:model.modelSha256,modelCutoffUtc:model.cutoffUtc,modelFrozenAtUtc:model.frozenAtUtc,
      barStartUtc:prepared.candidate.bar!.startUtc,barEndUtc:prepared.candidate.bar!.endUtc,
      sourceBars:prepared.sourceBars,features:{spec:'nvda-15m-v1',hash:prepared.featureHash,values:prepared.features},
      probabilities:{xgboost:[.2,.6,.2],frequency:[.3,.3,.4],linear:[.2,.4,.4]},dominantClass:'BAJISTA',
      receivedAtUtc:prepared.candidate.receivedAtUtc,source:{symbol:'NVDA' as const,feed:'iex' as const,adjustment:'raw' as const,timeframe:'15m' as const},
      atr14PriceUnits:prepared.atr14PriceUnits,policy:{classification:'argmax' as const,abstention:null}};
    const first=appendIexPrediction(path,input,calendar,()=> '2026-10-22T14:15:30.000Z');
    assert.equal(first.alreadyPresent,false);
    assert.equal(first.record.kind,'PREDICTION');
    if(first.record.kind!=='PREDICTION')throw new Error('Predicción ausente.');
    assert.equal(first.record.entryAtUtc,'2026-10-22T14:30:00.000Z');
    const stalePath=join(folder,'stale.jsonl');
    const staleInput={...input,barStartUtc:'2026-10-22T13:30:00.000Z',barEndUtc:'2026-10-22T13:45:00.000Z',
      receivedAtUtc:'2026-10-22T13:45:05.000Z',sourceBars:input.sourceBars.filter(row=>row.startUtc<='2026-10-22T13:30:00.000Z')};
    assert.throws(()=>appendIexPrediction(stalePath,staleInput,calendar,()=> '2026-10-22T14:15:30.000Z'),/STALE_LIVE_DATA/);
    assert.equal(appendIexPrediction(path,{...input,probabilities:{...input.probabilities,xgboost:[.8,.1,.1]},dominantClass:'ALCISTA'},calendar,()=> '2026-10-22T14:18:00.000Z').alreadyPresent,true);
    assert.equal(readIexObservations(path).length,1);
    const future=[...history(),...Array.from({length:4},(_,i)=>record('2026-10-22',4+i))];
    const evaluated=evaluateIexPredictions(path,future,()=> '2026-10-22T16:00:00.000Z');
    assert.equal(evaluated.length,1);
    assert.equal(evaluated[0]!.status,'EVALUATED');
    assert.equal(evaluateIexPredictions(path,future,()=> '2026-10-22T16:01:00.000Z').length,0);
    const before=readFileSync(path,'utf8');
    future.push(record('2026-10-22',4,2));
    assert.equal(evaluateIexPredictions(path,future,()=> '2026-10-22T16:02:00.000Z').length,0);
    assert.equal(readFileSync(path,'utf8'),before);
  }finally{rmSync(folder,{recursive:true,force:true});}
});
