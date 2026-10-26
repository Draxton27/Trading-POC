import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Fastify from 'fastify';
import {afterEach,describe,expect,it} from 'vitest';
import {IexProspectiveCoverage,IexProspectiveHistory,IexProspectiveMetrics,IexProspectiveOverview} from '@trading-poc/contracts';
import {activatePhase41i,appendPhase41iDecision,PHASE41I_MODEL_SHA} from '../../trading_poc_001_bollinger/src/phase41i-prospective.ts';
import {appendRecord} from '../../trading_poc_001_bollinger/src/phase16-ledger.ts';
import {DATASET_SPEC,calculatePhase23Features} from '../../trading_poc_001_bollinger/src/phase23-dataset.ts';
import {PHASE31_FEATURES} from '../../trading_poc_001_bollinger/src/phase31-inference.ts';
import type {IexRecord} from '../../trading_poc_001_bollinger/src/phase38-iex.ts';
import type {IexPrediction,IexEvaluation} from '../../trading_poc_001_bollinger/src/phase38f-iex-observation.ts';
import {iexProspectiveDetail,iexProspectiveHistory,readIexProspective,type IexProspectivePaths} from '../../apps/api/src/ml/iex-prospective-reader.ts';
import {registerIexProspectiveRoutes} from '../../apps/api/src/ml/iex-prospective-routes.ts';

const folders:string[]=[];afterEach(()=>folders.splice(0).forEach(path=>rmSync(path,{recursive:true,force:true})));
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const stamp=(value:number)=>new Date(value).toISOString();
const start=Date.parse('2026-10-26T13:30:00.000Z');
const at=(index:number)=>stamp(start+index*900_000);
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'phase41j-'));folders.push(dir);
  const paths:IexProspectivePaths={protocolDir:join(dir,'protocol'),modelDir:join(dir,'model'),observationLog:join(dir,'observations.jsonl'),
    iexLog:join(dir,'iex.jsonl'),calendar:join(dir,'calendar.json'),reportDir:join(dir,'report')};
  mkdirSync(paths.modelDir!);
  writeFileSync(paths.calendar,JSON.stringify({provider:'Alpaca Market Calendar',sessions:[{date:'2026-10-26',open:570,close:960}]}));
  const verifyModel=()=>({modelSha256:PHASE41I_MODEL_SHA});
  const active=activatePhase41i(paths.protocolDir,paths.modelDir!,paths.observationLog,
    ()=> '2026-10-25T19:30:00.000Z','31cdf6a1086b8f73039d7b888d6289edcbfd973d',
    ()=>({...verifyModel(),linearSha256:sha('linear'),freezeSha256:sha('freeze'),manifestSha256:sha('manifest'),
      frozenAtUtc:'2026-10-23T12:00:00.000Z'}));
  const deps={verifyModel,clock:()=>Date.parse('2026-10-26T21:00:00.000Z')};
  return {dir,paths,active,deps};
}
function quarters(path:string,count=25):IexRecord[]{
  const rows:IexRecord[]=[];
  for(let index=0;index<count;index++){
    const begin=at(index),end=at(index+1),received=stamp(Date.parse(end)+5_000);
    const price=index<=20?100+index*.1:102.1;
    const unsigned={schema:'phase38-iex-v1' as const,id:sha(begin),previousHash:rows.at(-1)?.recordHash??null,
      kind:'quarter' as const,feed:'iex' as const,adjustment:'raw' as const,symbol:'NVDA' as const,
      eventAtUtc:end,receivedAtUtc:received,status:'COMPLETE',bar:{startUtc:begin,endUtc:end,open:price,
        high:price+.2,low:price-.2,close:price+(index<=20?.05:0),volume:1000+index,tradeCount:10},
      revision:1,sourceMessageHash:sha('message'),
      latencyMs:5_000};
    rows.push({...unsigned,recordHash:sha(JSON.stringify(unsigned))});
  }
  writeFileSync(path,rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
  return rows;
}
function observation(paths:IexProspectivePaths,rows:IexRecord[]):IexPrediction{
  const candidate=rows[20]!,calculated=calculatePhase23Features(rows.slice(0,21).map(row=>({
    timestamp:row.bar!.startUtc,open:row.bar!.open,high:row.bar!.high,low:row.bar!.low,
    close:row.bar!.close,volume:row.bar!.volume})),new Map([['2026-10-26',{open:570,close:960}]])).at(-1)!;
  const values={return_1:calculated.return_1,return_4:calculated.return_4,distance_ema9:calculated.distance_ema9,
    distance_sma20:calculated.distance_sma20,bollinger_position:calculated.bollinger_position,
    relative_volume_20:calculated.relative_volume_20,candle_range:calculated.candle_range,
    candle_body:calculated.candle_body,atr14_relative:calculated.atr14_relative,minutes_from_open:300};
  const unsigned={schema:'phase38f-observation-v1' as const,kind:'PREDICTION' as const,
    id:sha('prediction'),previousHash:null,mode:'IEX_PROSPECTIVE_OBSERVATION' as const,modelSha256:PHASE41I_MODEL_SHA,
    modelCutoffUtc:'2026-10-20T00:00:00.000Z',modelFrozenAtUtc:'2026-10-23T12:00:00.000Z',
    barStartUtc:candidate.bar!.startUtc,barEndUtc:candidate.bar!.endUtc,
    sourceBars:rows.slice(0,21).map(row=>({startUtc:row.bar!.startUtc,receivedAtUtc:row.receivedAtUtc,
      recordHash:row.recordHash,revision:1,origin:'LIVE' as const})),
    features:{spec:DATASET_SPEC,hash:sha(JSON.stringify({spec:DATASET_SPEC,names:PHASE31_FEATURES,values})),values},
    probabilities:{xgboost:[.2,.3,.5],linear:[.3,.3,.4],frequency:[.4,.3,.3]},dominantClass:'LATERAL',
    receivedAtUtc:candidate.receivedAtUtc,registeredAtUtc:'2026-10-26T18:46:00.000Z',entryAtUtc:at(22),
    outcomeAtUtc:at(26),recordedBeforeEntry:true,recordedBeforeOutcome:true,
    source:{symbol:'NVDA' as const,feed:'iex' as const,adjustment:'raw' as const,timeframe:'15m' as const},
    atr14PriceUnits:calculated.atr14PriceUnits,policy:{classification:'argmax' as const,abstention:null}};
  const prediction:IexPrediction={...unsigned,recordHash:sha(JSON.stringify(unsigned))};
  writeFileSync(paths.observationLog,JSON.stringify(prediction)+'\n');
  return prediction;
}
function evaluation(paths:IexProspectivePaths,prediction:IexPrediction,rows:IexRecord[]):IexEvaluation{
  const unsigned={schema:'phase38f-observation-v1' as const,kind:'EVALUATION' as const,id:sha('evaluation'),
    previousHash:prediction.recordHash,predictionId:prediction.id,status:'EVALUATED' as const,
    evaluatedAtUtc:'2026-10-26T20:35:00.000Z',entrySourceHash:rows[22]!.recordHash,
    outcomeSourceHash:rows[25]!.recordHash,entryOpen:rows[22]!.bar!.open,
    outcomeClose:rows[25]!.bar!.close,label:'LATERAL'};
  const result={...unsigned,recordHash:sha(JSON.stringify(unsigned))};
  writeFileSync(paths.observationLog,JSON.stringify(result)+'\n',{flag:'a'});return result;
}
function snapshot(paths:IexProspectivePaths,active:ReturnType<typeof activatePhase41i>,ids:string[],evalCount:number){
  mkdirSync(paths.reportDir);
  const metric=(probabilities:number[])=>{
    const predicted=probabilities.indexOf(Math.max(...probabilities)),correct=predicted===2;
    const per_class=Object.fromEntries(['ALCISTA','BAJISTA','LATERAL'].map((name,index)=>[
      name,{precision:index===2&&correct?1:0,recall:index===2&&correct?1:0,f1:index===2&&correct?1:0,
        support:index===2?1:0}]));
    const confusion_matrix=[[0,0,0],[0,0,0],[0,0,0]];confusion_matrix[2]![predicted]=1;
    return {accuracy:correct?1:0,balanced_accuracy:correct?1/3:0,macro_f1:correct?1/3:0,
      per_class,confusion_matrix,log_loss:-Math.log(probabilities[2]!),
      brier_multiclass:probabilities.reduce((sum,p,index)=>sum+(p-(index===2?1:0))**2,0),
      bearish_prevalence:0,bearish_roc_auc:null,bearish_average_precision:null,
      calibration:{ALCISTA:[],BAJISTA:[],LATERAL:[]}};
  };
  const report={schema:'phase41i-prospective-report-v1',generated_at_utc:'2026-10-26T20:30:00.000Z',
    status:'INSUFFICIENT_EVIDENCE',activation_at_utc:active.activation.activatedAtUtc,
    protocol_sha256:active.activation.protocolSha256,model_sha256:active.activation.modelSha256,
    prior_ledger_tip_hash:active.activation.priorObservationLedger.tipHash,
    predictions_coverage:{cohort_count:ids.length,linked_prediction_ids:ids},evaluation_coverage:{evaluated:evalCount},
    metrics:evalCount?{xgboost:metric([.2,.3,.5]),linear:metric([.3,.3,.4]),frequency:metric([.4,.3,.3])}:null};
  const names=['source-integrity.json','eligibility-coverage.json','predictions-coverage.json','evaluation-coverage.json',
    'metrics.json','metrics-by-session.json','metrics-by-month.json','bearish-analysis.json','report.json','report.md'];
  const hashes:Record<string,string>={};
  for(const name of names){const content=name==='report.json'?JSON.stringify(report):name==='report.md'?'# Reporte':'{}';
    writeFileSync(join(paths.reportDir,name),content);hashes[name]=sha(content);}
  const manifest=JSON.stringify({schema:'phase41i-report-manifest-v1',files:hashes});
  writeFileSync(join(paths.reportDir,'manifest.json'),manifest);
  writeFileSync(join(paths.reportDir,'SHA256SUMS'),
    [...Object.entries(hashes),['manifest.json',sha(manifest)]].map(([name,digest])=>`${digest}  ${name}`).join('\n')+'\n');
}

describe('Fase 41J: proyección prospectiva IEX solo lectura',()=>{
  it('no depende de TRADING_POC_ML_RUN_DIR y no inventa predicciones al faltar el protocolo',()=>{
    const f=fixture();rmSync(f.paths.protocolDir,{recursive:true});
    const projection=readIexProspective(f.paths,f.deps);
    expect(projection.overview.status).toBe('UNAVAILABLE');
    expect(projection.items).toEqual([]);
    expect(IexProspectiveOverview.parse(projection.overview)).toEqual(projection.overview);
  });
  it('reconcilia RECORDED con fallo previo y STALE posterior sin degradar la admisión',()=>{
    const f=fixture(),rows=quarters(f.paths.iexLog,26),p=observation(f.paths,rows);
    appendPhase41iDecision(f.active,rows[20]!,'INFERENCE_FAILED',null,()=> '2026-10-26T18:45:30.000Z');
    const success=appendPhase41iDecision(f.active,rows[20]!,'RECORDED',p,()=>p.registeredAtUtc);
    const payload={...success.payload,decision_at_utc:'2026-10-26T19:03:00.000Z',
      eligibility_status:'STALE_LIVE_DATA',eligibility_reason:'STALE_LIVE_DATA',
      prediction_id_if_recorded:null,prediction_record_hash:null};
    appendRecord(join(f.paths.protocolDir,'eligibility-ledger'),'late-stale','iex_eligibility',payload,'2026-10-26T19:03:00.000Z');
    const original=readFileSync(f.paths.observationLog),decisions=readFileSync(join(f.paths.protocolDir,'eligibility-ledger','00000002.json'));
    const result=readIexProspective(f.paths,f.deps);
    expect(result.overview).toMatchObject({status:'READY',predictions:1,evaluated:0,overdue:1});
    expect(result.coverage).toMatchObject({decisionRecords:3,candidateBars:1,admittedBars:1,
      finallyNotAdmitted:0,failedAttemptsBeforeRecovery:1,abstentionsByReason:{}});
    expect(result.items[0]?.predictionId).toBe(p.id);
    expect(iexProspectiveHistory(result,{limit:1,offset:0}).total).toBe(1);
    expect(iexProspectiveDetail(result,p.id)?.sourceBarCount).toBe(21);
    expect(readFileSync(f.paths.observationLog)).toEqual(original);
    expect(readFileSync(join(f.paths.protocolDir,'eligibility-ledger','00000002.json'))).toEqual(decisions);
  });
  it('vincula evaluación, comparadores y reporte sin exponer rutas; rechaza snapshot alterado',()=>{
    const f=fixture(),rows=quarters(f.paths.iexLog,26),p=observation(f.paths,rows);
    appendPhase41iDecision(f.active,rows[20]!,'RECORDED',p,()=>p.registeredAtUtc);
    evaluation(f.paths,p,rows);snapshot(f.paths,f.active,[p.id],1);
    const projection=readIexProspective(f.paths,f.deps);
    expect(projection.overview).toMatchObject({status:'READY',evaluated:1,sessionsWithResults:1});
    expect(projection.items[0]).toMatchObject({actualClass:'LATERAL',evaluationStatus:'EVALUATED',
      matches:{xgboost:true,linear:true,frequency:false}});
    expect(projection.metrics.snapshotStatus).toBe('READY');
    expect(projection.metrics.scores?.xgboost.perClass.BAJISTA.support).toBe(0);
    expect(IexProspectiveMetrics.parse(projection.metrics)).toEqual(projection.metrics);
    expect(IexProspectiveCoverage.parse(projection.coverage)).toEqual(projection.coverage);
    writeFileSync(join(f.paths.reportDir,'metrics.json'),'alterado');
    const invalid=readIexProspective(f.paths,f.deps);
    expect(invalid.overview.status).toBe('READY');
    expect(invalid.metrics).toMatchObject({snapshotStatus:'INVALID_ARTIFACT',scores:null});
    expect(JSON.stringify(invalid)).not.toContain(f.dir);
  });
  it('detecta hashes de ledger alterados y modelo distinto, ocultando la cohorte',()=>{
    const f=fixture(),rows=quarters(f.paths.iexLog),p=observation(f.paths,rows);
    appendPhase41iDecision(f.active,rows[20]!,'RECORDED',p,()=>p.registeredAtUtc);
    expect(readIexProspective(f.paths,{...f.deps,verifyModel:()=>({modelSha256:sha('different')})}).overview.status).toBe('INVALID_ARTIFACT');
    writeFileSync(f.paths.observationLog,readFileSync(f.paths.observationLog,'utf8').replace('0.2','0.21'));
    expect(readIexProspective(f.paths,f.deps).overview.status).toBe('INVALID_ARTIFACT');
  });
  it('reconoce protocolo alterado, observaciones ausentes y ledger válido vacío',()=>{
    const f=fixture();
    expect(readIexProspective(f.paths,f.deps).overview).toMatchObject({status:'NO_PROSPECTIVE_DATA',predictions:0});
    writeFileSync(f.paths.observationLog,'');
    expect(readIexProspective(f.paths,f.deps).overview.status).toBe('NO_PROSPECTIVE_DATA');
    const protocol=join(f.paths.protocolDir,'protocol.json');
    writeFileSync(protocol,readFileSync(protocol,'utf8').replace('argmax','threshold'));
    expect(readIexProspective(f.paths,f.deps).overview.status).toBe('INVALID_ARTIFACT');
  });
  it('distingue fin de semana de calendario oficial no disponible para un nuevo día hábil',()=>{
    const f=fixture();
    const weekend=readIexProspective(f.paths,{...f.deps,clock:()=>Date.parse('2026-10-31T15:00:00.000Z')});
    expect(weekend.overview.marketStatus).toBe('MARKET_CLOSED');
    const weekday=readIexProspective(f.paths,{...f.deps,clock:()=>Date.parse('2026-10-27T15:00:00.000Z')});
    expect(weekday.overview.marketStatus).toBe('CALENDAR_UNAVAILABLE');
  });
  it('excluye predicción sin decisión RECORDED y rechaza duplicados enlazados',()=>{
    const f=fixture(),rows=quarters(f.paths.iexLog),p=observation(f.paths,rows);
    expect(readIexProspective(f.paths,f.deps).overview.predictions).toBe(0);
    appendPhase41iDecision(f.active,rows[20]!,'RECORDED',p,()=>p.registeredAtUtc);
    const {recordHash,...unsigned}=p;
    const duplicate={...unsigned,previousHash:p.recordHash};
    const second={...duplicate,recordHash:sha(JSON.stringify(duplicate))};
    writeFileSync(f.paths.observationLog,JSON.stringify(second)+'\n',{flag:'a'});
    expect(readIexProspective(f.paths,f.deps).overview.status).toBe('INVALID_ARTIFACT');
  });
  it('rechaza predicciones anteriores a la activación aun con hash y decisión plausibles',()=>{
    const f=fixture(),rows=quarters(f.paths.iexLog),p=observation(f.paths,rows);
    const failure=appendPhase41iDecision(f.active,rows[20]!,'INFERENCE_FAILED',null,()=> '2026-10-26T18:45:30.000Z');
    const unsigned={...p,registeredAtUtc:'2026-10-25T19:29:00.000Z'};
    delete (unsigned as Partial<IexPrediction>).recordHash;
    const altered={...unsigned,recordHash:sha(JSON.stringify(unsigned))};
    writeFileSync(f.paths.observationLog,JSON.stringify(altered)+'\n');
    appendRecord(join(f.paths.protocolDir,'eligibility-ledger'),'old-prediction','iex_eligibility',
      {...failure.payload,eligibility_status:'RECORDED',eligibility_reason:'RECORDED',
        prediction_id_if_recorded:p.id,prediction_record_hash:altered.recordHash,
        decision_at_utc:'2026-10-26T18:46:00.000Z'},'2026-10-26T18:46:00.000Z');
    expect(readIexProspective(f.paths,f.deps).overview.status).toBe('INVALID_ARTIFACT');
  });
  it('mantiene PENDING y MISSING_OUTCOME fuera de la métrica de aciertos',()=>{
    const f=fixture(),rows=quarters(f.paths.iexLog,22),p=observation(f.paths,rows);
    appendPhase41iDecision(f.active,rows[20]!,'RECORDED',p,()=>p.registeredAtUtc);
    const pending=readIexProspective(f.paths,{...f.deps,clock:()=>Date.parse('2026-10-26T19:01:00.000Z')});
    expect(pending.items[0]).toMatchObject({evaluationStatus:'PENDING',actualClass:null,matches:{xgboost:null,linear:null,frequency:null}});
    const unsigned={schema:'phase38f-observation-v1' as const,kind:'EVALUATION' as const,id:sha('missing'),
      previousHash:p.recordHash,predictionId:p.id,status:'MISSING_OUTCOME' as const,
      evaluatedAtUtc:'2026-10-26T20:35:00.000Z',entrySourceHash:null,
      outcomeSourceHash:null,entryOpen:100,outcomeClose:null,label:null};
    writeFileSync(f.paths.observationLog,JSON.stringify({...unsigned,recordHash:sha(JSON.stringify(unsigned))})+'\n',{flag:'a'});
    const result=readIexProspective(f.paths,f.deps);
    expect(result.overview).toMatchObject({evaluated:0,nonEvaluable:1});
    expect(result.items[0]).toMatchObject({evaluationStatus:'MISSING_OUTCOME',actualClass:null,matches:{xgboost:null}});
  });
  it('marca un snapshot íntegro como obsoleto después de una evaluación nueva',()=>{
    const f=fixture(),rows=quarters(f.paths.iexLog,26),p=observation(f.paths,rows);
    appendPhase41iDecision(f.active,rows[20]!,'RECORDED',p,()=>p.registeredAtUtc);
    snapshot(f.paths,f.active,[p.id],0);
    evaluation(f.paths,p,rows);
    const result=readIexProspective(f.paths,f.deps);
    expect(result.overview.evaluated).toBe(1);
    expect(result.metrics).toMatchObject({snapshotStatus:'METRICS_SNAPSHOT_STALE',evaluatedInSnapshot:0,scores:null});
  });
  it('una revisión IEX posterior conserva la primera versión usada por la predicción',()=>{
    const f=fixture(),rows=quarters(f.paths.iexLog),p=observation(f.paths,rows);
    appendPhase41iDecision(f.active,rows[20]!,'RECORDED',p,()=>p.registeredAtUtc);
    const original=readIexProspective(f.paths,f.deps);
    const first=rows[20]!,last=rows.at(-1)!;
    const unsigned={...first,id:sha('revision'),previousHash:last.recordHash,receivedAtUtc:'2026-10-26T20:40:00.000Z',
      revision:2,bar:{...first.bar!,close:first.bar!.close+.1}};
    delete (unsigned as Partial<IexRecord>).recordHash;
    writeFileSync(f.paths.iexLog,JSON.stringify({...unsigned,recordHash:sha(JSON.stringify(unsigned))})+'\n',{flag:'a'});
    const after=readIexProspective(f.paths,f.deps);
    expect(after.overview.status).toBe('READY');
    expect(after.items).toEqual(original.items);
    expect(after.details.get(p.id)?.sourceBars.at(-1)?.recordHash).toBe(first.recordHash);
  });
  it('rechaza una evaluación con etiqueta incompatible con el ATR original',()=>{
    const f=fixture(),rows=quarters(f.paths.iexLog,26),p=observation(f.paths,rows);
    appendPhase41iDecision(f.active,rows[20]!,'RECORDED',p,()=>p.registeredAtUtc);
    const evaluationRecord=evaluation(f.paths,p,rows);
    const {recordHash,...unsigned}={...evaluationRecord,label:'BAJISTA'};
    writeFileSync(f.paths.observationLog,JSON.stringify(p)+'\n'+JSON.stringify({...unsigned,recordHash:sha(JSON.stringify(unsigned))})+'\n');
    expect(readIexProspective(f.paths,f.deps).overview.status).toBe('INVALID_ARTIFACT');
  });
  it('página y filtra en servidor sin leer archivos arbitrarios ni permitir otro símbolo',async()=>{
    const f=fixture(),rows=quarters(f.paths.iexLog),p=observation(f.paths,rows);
    appendPhase41iDecision(f.active,rows[20]!,'RECORDED',p,()=>p.registeredAtUtc);
    const app=Fastify();registerIexProspectiveRoutes(app,f.paths,f.deps);
    try{
      const page=await app.inject('/api/v1/ml/iex/prospective/history?symbol=NVDA&timeframe=15m&limit=1&offset=0');
      expect(page.statusCode).toBe(200);expect(IexProspectiveHistory.parse(page.json()).total).toBe(1);
      const filtered=await app.inject('/api/v1/ml/iex/prospective/history?dominantClass=BAJISTA');
      expect(filtered.json().total).toBe(0);
      expect((await app.inject('/api/v1/ml/iex/prospective/history?symbol=QQQ')).statusCode).toBe(400);
      expect((await app.inject('/api/v1/ml/iex/prospective/history?limit=101')).statusCode).toBe(400);
      expect((await app.inject('/api/v1/ml/iex/prospective/history?file=../../secret')).statusCode).toBe(400);
      expect((await app.inject('/api/v1/ml/iex/prospective/history/../../secret')).statusCode).not.toBe(200);
      const detail=await app.inject(`/api/v1/ml/iex/prospective/history/${p.id}`);
      expect(detail.statusCode).toBe(200);expect(detail.json().item.predictionRecordHash).toBe(p.recordHash);
      writeFileSync(f.paths.observationLog,readFileSync(f.paths.observationLog,'utf8').replace('0.2','0.3'));
      const changed=await app.inject('/api/v1/ml/iex/prospective/overview');
      expect(changed.json().status).toBe('INVALID_ARTIFACT');
    }finally{await app.close();}
  });
});
