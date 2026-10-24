import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {saveMarketCalendar} from '../../trading_poc_001_bollinger/src/alpaca-calendar.ts';
import {readIexLedger,type IexRecord} from '../../trading_poc_001_bollinger/src/phase38-iex.ts';
import type {IexFrozen,IexPrediction,IexEvaluation} from '../../trading_poc_001_bollinger/src/phase38f-iex-observation.ts';
import {PHASE31_FEATURES} from '../../trading_poc_001_bollinger/src/phase31-inference.ts';
import {diagnoseIex,exportPrivateReport,type DoctorOptions,type TaskInspection} from '../../scripts/iex-diagnostics.ts';

const folders:string[]=[];
afterEach(()=>folders.splice(0).forEach(path=>rmSync(path,{recursive:true,force:true})));
const iso=(value:number)=>new Date(value).toISOString();
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const days=new Map([['2026-10-23',{open:570,close:960}],['2026-10-26',{open:570,close:960}],['2026-11-02',{open:570,close:960}]]);
const model:IexFrozen={schema:'phase38f-frozen-v1',modelSha256:'b9bbece648544b39e1e4c4946933e4f4de2d65ec5094997938b25791cb1bb684',
  cutoffUtc:'2026-10-20T00:00:00.000Z',frozenAtUtc:'2026-10-21T00:00:00.000Z',features:[...PHASE31_FEATURES],
  classes:['ALCISTA','BAJISTA','LATERAL'],feed:'iex',adjustment:'raw',frequency:[.3,.3,.4]};
const task:TaskInspection={state:'VALID',enabled:true,running:false,node:true,script:true,workdir:true,once:true,startWhenAvailable:true,
  ignoreNew:true,localOpenMinutes:450,triggerMinutes:360,lastRunUtc:null,nextRunUtc:'2026-10-26T12:00:00.000Z',lastResult:null};
function fixture(now='2026-10-26T13:45:10.000Z'){
  const folder=mkdtempSync(join(tmpdir(),'iex-doctor-'));folders.push(folder);
  const env={TRADING_POC_PRIVATE_DIR:folder,APCA_API_KEY_ID:'synthetic-key',APCA_API_SECRET_KEY:'synthetic-secret'} as NodeJS.ProcessEnv;
  const base:DoctorOptions={repoRoot:folder,env,now:()=>Date.parse(now),task,python:{status:'AVAILABLE'},nodeVersion:'v24.0.0',tsxAvailable:true,
    modelCheck:{check:{status:'VERIFIED'},model}};
  const iex=join(folder,'iex');mkdirSync(iex,{recursive:true});saveMarketCalendar(join(iex,'calendar.json'),days);
  return {folder,env,base,ledger:join(iex,'ledger.jsonl'),observations:join(folder,'ml-iex','observations.jsonl')};
}
function append(path:string,record:Omit<IexRecord,'recordHash'|'previousHash'|'id'>){
  const previous=(()=>{try{return JSON.parse(readFileSync(path,'utf8').trim().split('\n').at(-1)!) as IexRecord;}catch{return null;}})();
  const unsigned={...record,id:sha(JSON.stringify(record)),previousHash:previous?.recordHash??null};
  const row={...unsigned,recordHash:sha(JSON.stringify(unsigned))};writeFileSync(path,JSON.stringify(row)+'\n',{flag:'a'});return row;
}
function bar(path:string,start:string,received:string,revision=1,price=100){
  const end=iso(Date.parse(start)+900_000);
  return append(path,{schema:'phase38-iex-v1',kind:'quarter',feed:'iex',adjustment:'raw',symbol:'NVDA',eventAtUtc:end,receivedAtUtc:received,
    status:'COMPLETE',bar:{startUtc:start,endUtc:end,open:price,high:price+1,low:price-1,close:price+.2,volume:1000,tradeCount:100},
    revision,sourceMessageHash:sha(start),latencyMs:Date.parse(received)-Date.parse(end)});
}
function status(path:string,name:string,at:string){return append(path,{schema:'phase38-iex-v1',kind:'status',feed:'iex',adjustment:'raw',symbol:'NVDA',eventAtUtc:null,
  receivedAtUtc:at,status:name,bar:null,revision:null,sourceMessageHash:null,latencyMs:null});}
function session(path:string,day='2026-10-23',count=26){const start=Date.parse(day==='2026-10-23'?'2026-10-23T13:30:00Z':day==='2026-10-26'?'2026-10-26T13:30:00Z':'2026-11-02T14:30:00Z');
  for(let i=0;i<count;i++)bar(path,iso(start+i*900_000),iso(start+(i+1)*900_000+5000));}
function appendObservation(path:string,record:Record<string,unknown>){mkdirSync(join(path,'..'),{recursive:true});
  const previous=(()=>{try{return JSON.parse(readFileSync(path,'utf8').trim().split('\n').at(-1)!) as {recordHash:string};}catch{return null;}})();
  const unsigned={...record,previousHash:previous?.recordHash??null};
  const row={...unsigned,recordHash:sha(JSON.stringify(unsigned))};writeFileSync(path,JSON.stringify(row)+'\n',{flag:'a'});return row;
}
function prediction(path:string,at='2026-10-26T13:30:00.000Z'){
  return appendObservation(path,{schema:'phase38f-observation-v1',kind:'PREDICTION',id:'p1',mode:'IEX_PROSPECTIVE_OBSERVATION',modelSha256:model.modelSha256,
    modelCutoffUtc:model.cutoffUtc,modelFrozenAtUtc:model.frozenAtUtc,barStartUtc:at,barEndUtc:iso(Date.parse(at)+900_000),sourceBars:[],
    features:{spec:'nvda-15m-v1',hash:'a',values:{}},probabilities:{xgboost:[.3,.3,.4],frequency:[.3,.3,.4],linear:[.3,.3,.4]},dominantClass:'LATERAL',
    receivedAtUtc:iso(Date.parse(at)+900_000+5000),registeredAtUtc:iso(Date.parse(at)+900_000+10000),entryAtUtc:iso(Date.parse(at)+1800_000),
    outcomeAtUtc:iso(Date.parse(at)+5400_000),recordedBeforeEntry:true,recordedBeforeOutcome:true,
    source:{symbol:'NVDA',feed:'iex',adjustment:'raw',timeframe:'15m'},atr14PriceUnits:1,policy:{classification:'argmax',abstention:null}}) as IexPrediction;
}
function evaluation(path:string,p:IexPrediction,state:IexEvaluation['status'],ledger?:string){
  const bars=ledger?readIexLedger(ledger).filter(row=>row.kind==='quarter'):[];
  const entry=bars.find(row=>row.bar?.startUtc===p.entryAtUtc),outcome=bars.find(row=>row.bar?.endUtc===p.outcomeAtUtc);
  return appendObservation(path,{schema:'phase38f-observation-v1',kind:'EVALUATION',id:'e1',predictionId:p.id,status:state,
    evaluatedAtUtc:'2026-10-26T16:00:00.000Z',entrySourceHash:state==='MISSING_ENTRY'?null:entry?.recordHash??'source-entry',
    outcomeSourceHash:state==='EVALUATED'?outcome?.recordHash??'source-outcome':null,entryOpen:state==='MISSING_ENTRY'?null:entry?.bar?.open??100,
    outcomeClose:state==='EVALUATED'?outcome?.bar?.close??101:null,label:state==='EVALUATED'?'ALCISTA':null});
}

describe('Fase 40D1: diagnóstico IEX de solo lectura',()=>{
  it('distingue tarea ausente, instalada sin ejecuciones y acción o zona incorrecta',()=>{
    const f=fixture();
    expect(diagnoseIex({...f.base,task:{state:'ABSENT'}}).checks.windowsTask.status).toBe('NOT_INSTALLED');
    const good=diagnoseIex(f.base);expect(good.checks.windowsTask.status).toBe('CONFIGURED');expect(good.checks.taskLastResult.status).toBe('NEVER_RUN');
    expect(diagnoseIex({...f.base,task:{...task,script:false}}).checks.windowsTask.status).toBe('MISCONFIGURED');
    expect(diagnoseIex({...f.base,task:{...task,localOpenMinutes:360}}).checks.windowsTask.status).toBe('MISCONFIGURED');
  });
  it('separa credenciales, Python, modelo ausente e incompatibilidad sin revelar valores',()=>{
    const f=fixture();
    const missing=diagnoseIex({...f.base,env:{TRADING_POC_PRIVATE_DIR:f.folder},python:{status:'UNAVAILABLE'},modelCheck:undefined});
    expect(missing.checks.alpacaCredentials.status).toBe('MISSING');expect(missing.checks.frozenModel.status).toBe('NOT_CONFIGURED');
    expect(missing.checks.python.status).toBe('UNAVAILABLE');expect(JSON.stringify(missing)).not.toContain('synthetic-secret');
    const absent=diagnoseIex({...f.base,env:{...f.env,TRADING_POC_IEX_FROZEN_DIR:join(f.folder,'missing')},modelCheck:undefined});
    expect(absent.checks.frozenModel.status).toBe('ABSENT');
    const wrong=join(f.folder,'wrong');mkdirSync(wrong);writeFileSync(join(wrong,'freeze.json'),JSON.stringify(model));writeFileSync(join(wrong,'model.json'),'wrong hash');
    expect(diagnoseIex({...f.base,env:{...f.env,TRADING_POC_IEX_FROZEN_DIR:wrong},modelCheck:undefined}).checks.frozenModel.status).toBe('INCOMPATIBLE');
  });
  it('distingue estado inexistente, válido detenido e inválido',()=>{
    const f=fixture();expect(diagnoseIex(f.base).checks.automationState.status).toBe('ABSENT');
    const path=join(f.folder,'ml-iex','daily-status.json');mkdirSync(join(f.folder,'ml-iex'));
    writeFileSync(path,JSON.stringify({schema:'phase38g-iex-daily-v1',collector:'STOPPED',owner:'NONE',freshness:'NO_LIVE_DATA',observationStatus:'NO_LIVE_DATA'}));
    expect(diagnoseIex(f.base).checks.automationState).toMatchObject({status:'VALID',detail:'STOPPED/NONE/NO_LIVE_DATA'});
    writeFileSync(path,'{');expect(diagnoseIex(f.base).checks.automationState.status).toBe('INVALID');
  });
  it('audita ledger vacío, cadena válida, revisiones, desconexiones y corrupción',()=>{
    const f=fixture();writeFileSync(f.ledger,'');expect(diagnoseIex(f.base).checks.iexLedger.status).toBe('EMPTY');
    status(f.ledger,'SUBSCRIBED','2026-10-23T13:29:00.000Z');session(f.ledger,'2026-10-23',26);
    bar(f.ledger,'2026-10-23T19:45:00.000Z','2026-10-23T20:01:00.000Z',2,101);
    status(f.ledger,'DISCONNECTED','2026-10-23T20:02:00.000Z');
    const good=diagnoseIex(f.base);expect(good.checks.iexLedger.status).toBe('VALID');expect(good.counts.completeQuarters).toBe(26);
    expect(good.counts.quarterRevisions).toBe(1);expect(good.checks.iexLedger.detail).toContain('1 desconexiones');
    writeFileSync(f.ledger,readFileSync(f.ledger,'utf8').replace('"volume":1000','"volume":999'));
    expect(diagnoseIex(f.base).checks.iexLedger.status).toBe('INVALID');
  });
  it('rechaza barras contradictorias, revisiones mal numeradas y recepción fuera de orden',()=>{
    const f=fixture();bar(f.ledger,'2026-10-23T13:30:00.000Z','2026-10-23T13:45:05.000Z');
    bar(f.ledger,'2026-10-23T13:30:00.000Z','2026-10-23T13:46:00.000Z',3,101);
    expect(diagnoseIex(f.base).checks.iexLedger.status).toBe('INVALID');
    rmSync(f.ledger);bar(f.ledger,'2026-10-23T13:30:00.000Z','2026-10-23T13:45:05.000Z');
    bar(f.ledger,'2026-10-23T13:45:00.000Z','2026-10-23T13:45:01.000Z');
    expect(diagnoseIex(f.base).checks.iexLedger.status).toBe('INVALID');
  });
  it('exige 21 velas continuas; detecta hueco y conserva viernes a lunes y EDT a EST',()=>{
    const f=fixture();session(f.ledger,'2026-10-23',20);
    expect(diagnoseIex(f.base).checks.continuity.status).toBe('INSUFFICIENT');
    rmSync(f.ledger);session(f.ledger,'2026-10-23',26);bar(f.ledger,'2026-10-26T13:30:00.000Z','2026-10-26T13:45:05.000Z');
    expect(diagnoseIex(f.base).checks.continuity).toMatchObject({status:'SUFFICIENT',detail:expect.stringContaining('27 velas')});
    rmSync(f.ledger);session(f.ledger,'2026-10-23',25);bar(f.ledger,'2026-10-26T13:30:00.000Z','2026-10-26T13:45:05.000Z');
    expect(diagnoseIex(f.base).checks.continuity.detail).toContain('1 velas');
    rmSync(f.ledger);session(f.ledger,'2026-11-02',26);
    expect(diagnoseIex({...f.base,now:()=>Date.parse('2026-11-02T21:00:10Z')}).checks.continuity.status).toBe('SUFFICIENT');
  });
  it('distingue vela obsoleta, horizonte inválido, modelo posterior y predicción presente',()=>{
    const f=fixture();session(f.ledger,'2026-10-23',26);
    expect(diagnoseIex(f.base).checks.candidate.status).toBe('STALE_LIVE_DATA');
    const late=diagnoseIex({...f.base,now:()=>Date.parse('2026-10-23T20:00:10Z')});expect(late.checks.candidate.status).toBe('HORIZON_INELIGIBLE');
    bar(f.ledger,'2026-10-26T13:30:00.000Z','2026-10-26T13:45:05.000Z');
    expect(diagnoseIex(f.base).checks.candidate.status).toBe('FRESH_BAR_REQUIRES_RUNNING_OBSERVER');
    expect(diagnoseIex({...f.base,modelCheck:{check:{status:'VERIFIED'},model:{...model,frozenAtUtc:'2026-10-26T13:30:00.000Z'}}}).checks.candidate.status).toBe('MODEL_TOO_RECENT');
    prediction(f.observations);
    expect(diagnoseIex(f.base).checks.candidate.status).toBe('ALREADY_PRESENT');
  });
  it('separa predicción, vencimiento y los tres tipos de evaluación; rechaza duplicados y huérfanos',()=>{
    const f=fixture(),p=prediction(f.observations);
    expect(diagnoseIex(f.base).counts.outcomeNotDue).toBe(1);
    const late={...f.base,now:()=>Date.parse('2026-10-26T16:00:01Z')};
    expect(diagnoseIex(late).counts.dueUnevaluated).toBe(1);
    session(f.ledger,'2026-10-26',7);
    evaluation(f.observations,p,'EVALUATED',f.ledger);expect(diagnoseIex(late).counts.evaluated).toBe(1);
    evaluation(f.observations,p,'EVALUATED',f.ledger);expect(diagnoseIex(late).checks.observationLedger.status).toBe('INVALID');
    for(const state of ['MISSING_ENTRY','MISSING_OUTCOME'] as const){
      rmSync(f.observations);const prior=prediction(f.observations);evaluation(f.observations,prior,state);
      expect(diagnoseIex(late).counts[state==='MISSING_ENTRY'?'missingEntry':'missingOutcome']).toBe(1);
    }
    rmSync(f.observations);evaluation(f.observations,p,'MISSING_ENTRY');expect(diagnoseIex(late).checks.observationLedger.status).toBe('INVALID');
  });
  it('no escribe ni inicia recolector/modelo, y exporta solo con destino nuevo',()=>{
    const f=fixture();session(f.ledger,'2026-10-23',26);
    const before=readdirSync(f.folder,{recursive:true}).map(String).sort();
    const report=diagnoseIex(f.base);
    expect(readdirSync(f.folder,{recursive:true}).map(String).sort()).toEqual(before);
    expect(JSON.stringify(report)).not.toContain(f.folder);expect(JSON.stringify(report)).not.toContain('synthetic-secret');
    const out=join(f.folder,'report');exportPrivateReport(report,out);
    expect(readdirSync(out).sort()).toEqual(['SHA256SUMS','report.json','report.md']);
    expect(()=>exportPrivateReport(report,out)).toThrow();
  });
});
