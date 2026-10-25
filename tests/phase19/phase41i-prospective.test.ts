import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {activatePhase41i,appendPhase41iDecision,cohortPredictions,firstNewIexCandidate,
  loadPhase41iActivation,PHASE41I_MODEL_SHA,readPhase41iDecisions} from '../../trading_poc_001_bollinger/src/phase41i-prospective.ts';
import type {IexRecord} from '../../trading_poc_001_bollinger/src/phase38-iex.ts';
import type {IexPrediction} from '../../trading_poc_001_bollinger/src/phase38f-iex-observation.ts';
import {officialSessionOpenUtc,taskTimezoneStatus} from '../../scripts/iex-diagnostics.ts';

const folders:string[]=[];afterEach(()=>folders.splice(0).forEach(path=>rmSync(path,{recursive:true,force:true})));
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const clock=()=> '2026-10-25T19:30:00.000Z';
const fakeModel=()=>({modelSha256:PHASE41I_MODEL_SHA,linearSha256:sha('linear'),freezeSha256:sha('freeze'),
  manifestSha256:sha('manifest'),frozenAtUtc:'2026-10-23T12:00:00.000Z'});
const commit='31cdf6a1086b8f73039d7b888d6289edcbfd973d';
function fixture(){const folder=mkdtempSync(join(tmpdir(),'phase41i-'));folders.push(folder);
  const dir=join(folder,'protocol'),observations=join(folder,'observations.jsonl');
  const active=activatePhase41i(dir,'synthetic-model',observations,clock,commit,fakeModel);
  return {folder,dir,observations,active};
}
function quarter(start:string,received:string,revision=1,hash=sha(start)):IexRecord{
  const end=new Date(Date.parse(start)+900_000).toISOString();
  return {schema:'phase38-iex-v1',kind:'quarter',id:sha(start+revision),previousHash:null,recordHash:hash,
    feed:'iex',adjustment:'raw',symbol:'NVDA',eventAtUtc:end,receivedAtUtc:received,status:'COMPLETE',
    bar:{startUtc:start,endUtc:end,open:100,high:101,low:99,close:100.5,volume:1000,tradeCount:10},
    revision,sourceMessageHash:sha('message'),latencyMs:Date.parse(received)-Date.parse(end)};
}
function prediction(candidate:IexRecord):IexPrediction{return {schema:'phase38f-observation-v1',kind:'PREDICTION',id:sha('prediction'),
  previousHash:null,recordHash:sha('prediction-record'),mode:'IEX_PROSPECTIVE_OBSERVATION',modelSha256:PHASE41I_MODEL_SHA,
  modelCutoffUtc:'2026-10-20T00:00:00.000Z',modelFrozenAtUtc:'2026-10-23T12:00:00.000Z',
  barStartUtc:candidate.bar!.startUtc,barEndUtc:candidate.bar!.endUtc,
  sourceBars:[{startUtc:candidate.bar!.startUtc,receivedAtUtc:candidate.receivedAtUtc,recordHash:candidate.recordHash,revision:1,origin:'LIVE'}],
  features:{spec:'nvda-15m-v1',hash:sha('features'),values:{} as IexPrediction['features']['values']},
  probabilities:{xgboost:[.2,.3,.5],linear:[.3,.3,.4],frequency:[.4,.3,.3]},dominantClass:'LATERAL',
  receivedAtUtc:candidate.receivedAtUtc,registeredAtUtc:'2026-10-26T13:47:00.000Z',entryAtUtc:'2026-10-26T14:00:00.000Z',
  outcomeAtUtc:'2026-10-26T15:00:00.000Z',recordedBeforeEntry:true,recordedBeforeOutcome:true,
  source:{symbol:'NVDA',feed:'iex',adjustment:'raw',timeframe:'15m'},atr14PriceUnits:1,
  policy:{classification:'argmax',abstention:null}};}

describe('Fase 41I: protocolo, elegibilidad y ancla causal',()=>{
  it('activa con hora real inyectada, SHA y ausencia explícita de ledger previo',()=>{
    const f=fixture();expect(f.active.activation).toMatchObject({activatedAtUtc:clock(),modelSha256:PHASE41I_MODEL_SHA,
      priorObservationLedger:{state:'ABSENT',recordCount:0,tipHash:null}});
    expect(f.active.protocol.git_commit).toBe(commit);
    expect(loadPhase41iActivation(f.dir,f.observations)?.activation.protocolSha256).toBe(f.active.activation.protocolSha256);
    expect(()=>activatePhase41i(f.dir,'synthetic-model',f.observations,clock,commit,fakeModel)).toThrow(/inmutable/);
    expect(readdirSync(f.dir).sort()).toEqual(['SHA256SUMS','activation.json','protocol.json','source-integrity.json']);
  });
  it('rechaza alteración de protocolo y mantiene el prefijo original inmutable',()=>{
    const f=fixture(),path=join(f.dir,'protocol.json');
    writeFileSync(path,readFileSync(path,'utf8').replace('argmax','threshold'));
    expect(()=>loadPhase41iActivation(f.dir,f.observations)).toThrow(/alterados/);
  });
  it('solo elige primeras versiones Live posteriores a activación, sin promover warmup o revisiones',()=>{
    const f=fixture(),old=quarter('2026-10-23T13:30:00.000Z','2026-10-23T13:45:05.000Z');
    const fresh=quarter('2026-10-26T13:30:00.000Z','2026-10-26T13:45:05.000Z');
    const revision=quarter(fresh.bar!.startUtc,'2026-10-26T13:46:00.000Z',2,sha('revision'));
    expect(firstNewIexCandidate([old,fresh,revision],f.active)?.recordHash).toBe(fresh.recordHash);
    expect(firstNewIexCandidate([old],f.active)).toBeNull();
    expect(()=>appendPhase41iDecision(f.active,old,'PREEXISTING_LIVE_DATA')).toThrow(/anterior/);
    expect(()=>appendPhase41iDecision(f.active,revision,'RECORDED')).toThrow(/primera versión/);
    expect(()=>firstNewIexCandidate([quarter('2026-10-26T13:30:00.000Z','2026-10-26T13:35:00.000Z')],f.active)).toThrow(/parcial/);
  });
  it('registra una decisión por estado y candidata; enlaza predicción y rechaza alteraciones',()=>{
    const f=fixture(),bar=quarter('2026-10-26T13:30:00.000Z','2026-10-26T13:45:05.000Z'),p=prediction(bar);
    const now=()=> '2026-10-26T13:46:00.000Z';
    const first=appendPhase41iDecision(f.active,bar,'INDICATORS_INSUFFICIENT',null,now);
    expect(appendPhase41iDecision(f.active,bar,'INDICATORS_INSUFFICIENT',null,()=> '2026-10-26T13:49:00.000Z').id).toBe(first.id);
    appendPhase41iDecision(f.active,bar,'RECORDED',p,()=>p.registeredAtUtc);
    const rows=readPhase41iDecisions(f.dir);expect(rows).toHaveLength(2);
    expect(cohortPredictions(f.active,[p],rows)).toEqual([p]);
    expect(cohortPredictions(f.active,[{...p,registeredAtUtc:clock()}],rows)).toEqual([]);
    expect(()=>appendPhase41iDecision(f.active,bar,'RECORDED',{...p,modelSha256:sha('wrong')})).toThrow(/Enlace/);
    const second=join(f.dir,'eligibility-ledger','00000002.json');
    writeFileSync(second,readFileSync(second,'utf8').replace('RECORDED','REJECTED'));
    expect(()=>readPhase41iDecisions(f.dir)).toThrow(/alterado/);
  });
  it('usa aperturas oficiales EDT/EST, omite festivos y acepta cierre anticipado',()=>{
    const calendar=new Map([['2026-03-06',{open:570,close:960}],['2026-03-09',{open:570,close:960}],
      ['2026-11-02',{open:570,close:960}],['2026-11-27',{open:570,close:780}],['2026-12-28',{open:570,close:960}]]);
    expect(officialSessionOpenUtc(calendar,Date.parse('2026-03-06T10:00:00Z'))).toBe('2026-03-06T14:30:00.000Z');
    expect(officialSessionOpenUtc(calendar,Date.parse('2026-03-07T10:00:00Z'))).toBe('2026-03-09T13:30:00.000Z');
    expect(officialSessionOpenUtc(calendar,Date.parse('2026-11-01T10:00:00Z'))).toBe('2026-11-02T14:30:00.000Z');
    expect(officialSessionOpenUtc(calendar,Date.parse('2026-11-27T10:00:00Z'))).toBe('2026-11-27T14:30:00.000Z');
    expect(officialSessionOpenUtc(calendar,Date.parse('2026-12-25T10:00:00Z'))).toBe('2026-12-28T14:30:00.000Z');
    expect(taskTimezoneStatus(450,360)).toBe('EXPECTED');expect(taskTimezoneStatus(510,360)).toBe('EXPECTED');
    expect(taskTimezoneStatus(360,360)).toBe('TIMEZONE_UNEXPECTED');
  });
});
