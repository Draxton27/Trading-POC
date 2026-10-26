/** Phase 41J: bounded, read-only projection of the existing 38F/41I ledgers. */
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {IexProspectiveCoverage,IexProspectiveDetail,IexProspectiveHistory,IexProspectiveMetrics,IexProspectiveOverview,
  IexProspectivePrediction,type IexProspectiveScore} from '@trading-poc/contracts';
import {loadMarketCalendar,isCalendarBar} from '../../../../trading_poc_001_bollinger/src/alpaca-calendar.ts';
import {loadIexWarmup} from '../../../../trading_poc_001_bollinger/src/phase38f-warmup.ts';
import {readIexLedger,type IexRecord} from '../../../../trading_poc_001_bollinger/src/phase38-iex.ts';
import {readIexObservations,type IexEvaluation,type IexPrediction} from '../../../../trading_poc_001_bollinger/src/phase38f-iex-observation.ts';
import {loadPhase41iActivation,readPhase41iDecisions,verifyPhase41iModel,type ActiveProtocol} from '../../../../trading_poc_001_bollinger/src/phase41i-prospective.ts';
import {classifyMovement,DATASET_SPEC,phase23ContinuousSuffix,calculatePhase23Features} from '../../../../trading_poc_001_bollinger/src/phase23-dataset.ts';
import {scheduledPostDecisionEntry} from '../../../../trading_poc_001_bollinger/src/phase38c-replay.ts';
import {PHASE31_FEATURES} from '../../../../trading_poc_001_bollinger/src/phase31-inference.ts';
import {newYorkBarParts} from '../../../../trading_poc_001_bollinger/src/strategy-validation.ts';

export type IexProspectivePaths={protocolDir:string;modelDir:string|undefined;observationLog:string;iexLog:string;calendar:string;reportDir:string;warmupRegistry?:string};
export type IexProspectiveDependencies={verifyModel?:(directory:string)=>{modelSha256:string;frozenAtUtc?:string};clock?:()=>number};
type Projection={overview:IexProspectiveOverview;coverage:IexProspectiveCoverage;metrics:IexProspectiveMetrics;items:IexProspectivePrediction[];details:Map<string,IexProspectiveDetail>};
const MAX_LEDGER=128*1024*1024,MAX_REPORT=2*1024*1024,MAX_ROWS=250_000;
const classes=['ALCISTA','BAJISTA','LATERAL'] as const;
const eligibilityStatuses=new Set(['RECORDED','ALREADY_PRESENT','NO_LIVE_DATA','PREEXISTING_LIVE_DATA','STALE_LIVE_DATA',
  'INDICATORS_INSUFFICIENT','HORIZON_INELIGIBLE','MODEL_TOO_RECENT','FEED_DISCONNECTED','CALENDAR_UNAVAILABLE',
  'SOURCE_INVALID','INFERENCE_FAILED']);
const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const fail=(reason:string):Projection=>{
  const overview=IexProspectiveOverview.parse({status:'INVALID_ARTIFACT',evidenceStatus:null,protocolVersion:'41I v2',modelLabel:'XGBoost 38F',
    symbol:'NVDA',timeframe:'15m',feed:'IEX Live',adjustment:'raw',experimental:true,activatedAtUtc:null,protocolSha256:null,
    modelSha256:null,predictions:0,evaluated:0,pending:0,overdue:0,nonEvaluable:0,sessionsWithResults:0,
    lastPredictionAtUtc:null,lastEvaluationAtUtc:null,receivedCompleteBars:null,expectedCompleteBars:null,coverage:null,
    marketStatus:'CALENDAR_UNAVAILABLE',reason});
  return {overview,coverage:IexProspectiveCoverage.parse({status:overview.status,decisionRecords:0,candidateBars:0,admittedBars:0,
    finallyNotAdmitted:0,failedAttemptsBeforeRecovery:0,abstentionsByReason:{},expectedCompleteBars:null,receivedCompleteBars:null,
    scheduledSessions:null,sessionsWithCapture:null,coverage:null,marketStatus:overview.marketStatus,reason}),
    metrics:IexProspectiveMetrics.parse({status:overview.status,snapshotStatus:'INVALID_ARTIFACT',reportStatus:null,generatedAtUtc:null,
      evaluatedInSnapshot:0,scores:null,warning:reason}),items:[],details:new Map()};
};
const absent=(status:'UNAVAILABLE'|'NO_PROSPECTIVE_DATA',reason:string):Projection=>{
  const result=fail(reason);return {overview:{...result.overview,status,marketStatus:'CALENDAR_UNAVAILABLE'},
    coverage:{...result.coverage,status},metrics:{...result.metrics,status,snapshotStatus:'NO_SNAPSHOT'},items:[],details:new Map()};
};
const bounded=(path:string,max:number)=>{if(statSync(path).size>max)throw new Error('Artefacto privado excede el límite de lectura.');};
const exact=(value:string)=>{const time=Date.parse(value);if(!Number.isFinite(time)||new Date(time).toISOString()!==value)throw new Error('Timestamp de ledger inválido.');return time;};
const probabilities=(values:number[])=>{
  if(values.length!==3||values.some(value=>!Number.isFinite(value)||value<0||value>1)||Math.abs(values.reduce((a,b)=>a+b,0)-1)>1e-6)
    throw new Error('Probabilidades prospectivas incompatibles.');
  return {ALCISTA:values[0]!,BAJISTA:values[1]!,LATERAL:values[2]!};
};
const winner=(values:number[])=>classes[values.indexOf(Math.max(...values))]!;
function firstBars(records:IexRecord[]){
  const first=new Map<string,IexRecord>();
  for(const row of records){
    if(row.kind!=='quarter')continue;
    if(!row.bar||row.status!=='COMPLETE'||row.feed!=='iex'||row.adjustment!=='raw'||row.symbol!=='NVDA'||
      row.revision===null||row.revision<1||exact(row.bar.endUtc)-exact(row.bar.startUtc)!==900_000||
      exact(row.receivedAtUtc)<exact(row.bar.endUtc)||
      [row.bar.open,row.bar.high,row.bar.low,row.bar.close,row.bar.volume,row.bar.tradeCount].some(value=>!Number.isFinite(value))||
      row.bar.open<=0||row.bar.low<=0||row.bar.high<Math.max(row.bar.open,row.bar.close,row.bar.low)||
      row.bar.low>Math.min(row.bar.open,row.bar.close)||!Number.isSafeInteger(row.bar.volume)||
      !Number.isSafeInteger(row.bar.tradeCount)||row.bar.volume<0||row.bar.tradeCount<0)
      throw new Error('Primera vela IEX incompatible.');
    if(first.has(row.bar.startUtc)&&row.revision===1)throw new Error('Dos primeras versiones de la misma vela IEX.');
    if(!first.has(row.bar.startUtc)){
      if(row.revision!==1)throw new Error('Falta la primera versión IEX.');
      first.set(row.bar.startUtc,row);
    }
  }
  return first;
}
function marketCoverage(calendar:ReturnType<typeof loadMarketCalendar>,first:Map<string,IexRecord>,activation:string,now:number){
  let expected=0,received=0,sessions=0,captured=0;const activationAt=exact(activation);
  for(const [day] of calendar){
    const midnight=Date.parse(`${day}T00:00:00.000Z`);let expectedDay=0,receivedDay=0;
    for(let at=midnight;at<midnight+86_400_000;at+=900_000){
      if(at<=activationAt||at+900_000>now||!isCalendarBar(at,calendar)||
        newYorkBarParts(new Date(at).toISOString()).day!==day)continue;
      expected++;expectedDay++;
      const row=first.get(new Date(at).toISOString());
      if(row&&exact(row.receivedAtUtc)>=activationAt&&exact(row.receivedAtUtc)<=now){received++;receivedDay++;}
    }
    if(expectedDay){sessions++;if(receivedDay)captured++;}
  }
  return {expected,received,sessions,captured,ratio:expected?received/expected:null};
}
function readSnapshot(directory:string,active:ActiveProtocol,cohort:Set<string>,evaluated:number,now:number){
  if(!existsSync(directory))return {status:'NO_SNAPSHOT' as const,generatedAtUtc:null,reportStatus:null,evalCount:0,scores:null};
  const required=['source-integrity.json','eligibility-coverage.json','predictions-coverage.json','evaluation-coverage.json',
    'metrics.json','metrics-by-session.json','metrics-by-month.json','bearish-analysis.json','report.json','report.md','manifest.json'];
  const sums=join(directory,'SHA256SUMS');bounded(sums,4096);
  const lines=readFileSync(sums,'utf8').trim().split(/\r?\n/),hashes=new Map<string,string>();
  for(const line of lines){const match=/^([a-f0-9]{64})  ([a-z-]+\.(?:json|md))$/.exec(line);
    if(!match||hashes.has(match[2]!))throw new Error('Manifiesto 41I inválido.');hashes.set(match[2]!,match[1]!);}
  if(lines.length!==required.length||required.some(name=>!hashes.has(name)))throw new Error('Reporte 41I incompleto.');
  for(const name of required){const file=join(directory,name);bounded(file,MAX_REPORT);
    if(sha(readFileSync(file))!==hashes.get(name))throw new Error('SHA del reporte 41I alterado.');}
  const manifest=JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8')) as {files:Record<string,string>};
  if(manifest.files['manifest.json']||required.filter(name=>name!=='manifest.json').some(name=>manifest.files[name]!==hashes.get(name))||
    Object.keys(manifest.files).length!==required.length-1)throw new Error('Índice del reporte 41I alterado.');
  const report=JSON.parse(readFileSync(join(directory,'report.json'),'utf8')) as Record<string,any>;
  if(report.schema!=='phase41i-prospective-report-v1'||report.protocol_sha256!==active.activation.protocolSha256||
    report.model_sha256!==active.activation.modelSha256||report.activation_at_utc!==active.activation.activatedAtUtc||
    report.prior_ledger_tip_hash!==active.activation.priorObservationLedger.tipHash||
    exact(report.generated_at_utc)>now||!['NO_PROSPECTIVE_DATA','COLLECTING','INSUFFICIENT_EVIDENCE',
      'DESCRIPTIVE_PROSPECTIVE_RESULTS','PROSPECTIVE_REVIEW_GATE_REACHED'].includes(report.status))
    throw new Error('Snapshot 41I pertenece a otro protocolo.');
  const ids=report.predictions_coverage?.linked_prediction_ids;
  const evalCount=report.evaluation_coverage?.evaluated;
  if(!Array.isArray(ids)||ids.length!==report.predictions_coverage.cohort_count||new Set(ids).size!==ids.length||
    ids.some(id=>!cohort.has(id))||!Number.isSafeInteger(evalCount)||evalCount<0||evalCount>evaluated)
    throw new Error('Snapshot 41I no coincide con la cohorte actual.');
  const convert=(value:any):IexProspectiveScore=>({
    accuracy:value.accuracy,balancedAccuracy:value.balanced_accuracy,macroF1:value.macro_f1,logLoss:value.log_loss,
    brier:value.brier_multiclass,perClass:value.per_class,confusionMatrix:value.confusion_matrix,
    bearishPrevalence:value.bearish_prevalence,bearishRocAuc:value.bearish_roc_auc,
    bearishAveragePrecision:value.bearish_average_precision,calibration:Object.fromEntries(classes.map(name=>[
      name,(value.calibration?.[name]??[]).map((bin:any)=>({n:bin.rows,meanProbability:bin.predicted_mean,
        observedFrequency:bin.observed_frequency}))])) as IexProspectiveScore['calibration']});
  const raw=report.metrics;
  const scores=raw?{xgboost:convert(raw.xgboost),linear:convert(raw.linear),frequency:convert(raw.frequency)}:null;
  const validated=IexProspectiveMetrics.shape.scores.parse(scores);
  if((evalCount>0)!==(validated!==null))throw new Error('Snapshot 41I sin métricas coherentes con las evaluaciones.');
  if(validated&&Object.values(validated).some(score=>classes.reduce((count,name)=>count+score.perClass[name].support,0)!==evalCount))
    throw new Error('Métricas 41I con muestra incongruente.');
  return {status:(evalCount<evaluated||ids.length<cohort.size?'METRICS_SNAPSHOT_STALE':'READY') as 'READY'|'METRICS_SNAPSHOT_STALE',
    generatedAtUtc:report.generated_at_utc as string,reportStatus:report.status as IexProspectiveMetrics['reportStatus'],
    evalCount,scores:validated};
}
export function readIexProspective(paths:IexProspectivePaths,deps:IexProspectiveDependencies={}):Projection{
  const now=(deps.clock??Date.now)();
  if(!existsSync(paths.protocolDir))return absent('UNAVAILABLE','El protocolo prospectivo 41I v2 no está disponible.');
  if(!paths.modelDir||!existsSync(paths.modelDir))return absent('UNAVAILABLE','El modelo IEX 38F congelado no está configurado.');
  try{
    for(const file of [paths.observationLog,paths.iexLog])if(existsSync(file))bounded(file,MAX_LEDGER);
    if(existsSync(join(paths.protocolDir,'eligibility-ledger'))&&
      readdirSync(join(paths.protocolDir,'eligibility-ledger')).length>MAX_ROWS)throw new Error('Ledger de elegibilidad demasiado grande.');
    const model=(deps.verifyModel??verifyPhase41iModel)(paths.modelDir);
    const observations=readIexObservations(paths.observationLog);
    const active=loadPhase41iActivation(paths.protocolDir,paths.observationLog);
    if(!active||active.activation.modelSha256!==model.modelSha256)
      throw new Error('Protocolo y modelo IEX incompatibles.');
    if(!existsSync(paths.calendar))throw new Error('Calendario oficial IEX no disponible.');
    bounded(paths.calendar,MAX_REPORT);
    const calendar=loadMarketCalendar(paths.calendar),live=readIexLedger(paths.iexLog),decisions=readPhase41iDecisions(paths.protocolDir);
    if(observations.length>MAX_ROWS||live.length>MAX_ROWS||decisions.length>MAX_ROWS)throw new Error('Ledger IEX demasiado grande.');
    const first=firstBars(live),predictions=new Map<string,IexPrediction>(),evaluations=new Map<string,IexEvaluation>();
    if([...first.values()].some(row=>exact(row.receivedAtUtc)>now))throw new Error('Recepción Live posterior al reloj del servidor.');
    let warmup:ReturnType<typeof loadIexWarmup>|null=null;
    let warmupMap:Map<string,ReturnType<typeof loadIexWarmup>['candles'][number]>|null=null;
    const warmupBar=(startUtc:string)=>{
      if(!warmup){
        if(!paths.warmupRegistry)throw new Error('Falta el registro inmutable de calentamiento IEX.');
        bounded(paths.warmupRegistry,4096);
        const registry=JSON.parse(readFileSync(paths.warmupRegistry,'utf8')) as {sourceDir:string};
        if(typeof registry.sourceDir!=='string')throw new Error('Registro de calentamiento IEX inválido.');
        for(const file of ['query.json','calendar.json','strict-15m.csv','report.json','SHA256SUMS'])
          bounded(join(registry.sourceDir,file),MAX_LEDGER);
        warmup=loadIexWarmup(paths.warmupRegistry);
        warmupMap=new Map(warmup.candles.map(bar=>[bar.timestamp,bar]));
      }
      return {bar:warmupMap!.get(startUtc),registeredAtUtc:warmup.registeredAtUtc,
        csvSha256:warmup.csvSha256,calendar:warmup.calendar};
    };
    for(const row of observations){
      if(row.kind==='PREDICTION'){if(predictions.has(row.id))throw new Error('Predicción IEX duplicada.');predictions.set(row.id,row);}
      else {if(evaluations.has(row.predictionId))throw new Error('Evaluación IEX duplicada.');evaluations.set(row.predictionId,row);}
    }
    if([...evaluations.values()].some(row=>!predictions.has(row.predictionId)||exact(row.evaluatedAtUtc)>now))
      throw new Error('Evaluación IEX huérfana o posterior al reloj del servidor.');
    const byBar=new Map<string,typeof decisions>(),linked=new Map<string,IexPrediction>(),startIds=new Set<string>();
    for(const decision of decisions){
      const p=decision.payload,source=first.get(String(p.candidate_bar_start_utc));
      if(!eligibilityStatuses.has(String(p.eligibility_status))||
        p.protocol_sha256!==active.activation.protocolSha256||p.model_sha256!==active.activation.modelSha256||
        !source||source.recordHash!==p.source_bar_sha256||source.bar!.endUtc!==p.candidate_bar_end_utc||
        source.receivedAtUtc!==p.first_received_at_utc||exact(source.bar!.startUtc)<=exact(active.activation.activatedAtUtc)||
        exact(source.receivedAtUtc)<=exact(active.activation.activatedAtUtc)||
        exact(String(p.decision_at_utc))<exact(source.receivedAtUtc)||exact(String(p.decision_at_utc))>now||
        !isCalendarBar(exact(source.bar!.startUtc),calendar))
        throw new Error('Decisión 41I sin primera vela Live válida.');
      const key=`${source.bar!.startUtc}|${source.recordHash}`,attempts=byBar.get(key)??[];attempts.push(decision);byBar.set(key,attempts);
      if(p.eligibility_status==='RECORDED'){
        const prediction=predictions.get(String(p.prediction_id_if_recorded));
        if(!prediction||prediction.recordHash!==p.prediction_record_hash||prediction.barStartUtc!==source.bar!.startUtc||
          prediction.sourceBars.at(-1)?.recordHash!==source.recordHash||
          prediction.modelSha256!==active.activation.modelSha256||linked.has(prediction.id)||startIds.has(prediction.barStartUtc)||
          exact(prediction.registeredAtUtc)<=exact(active.activation.activatedAtUtc)||
          exact(prediction.registeredAtUtc)>=exact(prediction.outcomeAtUtc))
          throw new Error('Enlace de predicción 41I inválido.');
        linked.set(prediction.id,prediction);startIds.add(prediction.barStartUtc);
      }
    }
    let admitted=0,recovered=0;const abstentions:Record<string,number>={};
    for(const attempts of byBar.values()){
      const success=attempts.findIndex(row=>row.payload.eligibility_status==='RECORDED');
      if(success>=0){if(attempts.filter(row=>row.payload.eligibility_status==='RECORDED').length!==1)
        throw new Error('Éxito 41I duplicado.');admitted++;recovered+=attempts.slice(0,success).length;}
      else {const reason=String(attempts.at(-1)!.payload.eligibility_status);abstentions[reason]=(abstentions[reason]??0)+1;}
    }
    if(admitted!==linked.size)throw new Error('Admisiones y predicciones no concuerdan.');
    const items:IexProspectivePrediction[]=[],details=new Map<string,IexProspectiveDetail>();let evaluated=0,pending=0,overdue=0,nonEvaluable=0;
    let lastEvaluationAtUtc:string|null=null;const sessions=new Set<string>();
    for(const prediction of linked.values()){
      if(prediction.source.feed!=='iex'||prediction.source.adjustment!=='raw'||prediction.source.symbol!=='NVDA'||
        prediction.source.timeframe!=='15m'||prediction.policy.classification!=='argmax'||prediction.policy.abstention!==null||
        prediction.modelFrozenAtUtc>=prediction.barStartUtc||prediction.modelCutoffUtc>=prediction.barStartUtc||
        model.frozenAtUtc!==undefined&&prediction.modelFrozenAtUtc!==model.frozenAtUtc||
        exact(prediction.registeredAtUtc)>now||
        !prediction.recordedBeforeOutcome||prediction.sourceBars.length<21||
        prediction.sourceBars.at(-1)?.startUtc!==prediction.barStartUtc||
        prediction.sourceBars.some(source=>exact(source.receivedAtUtc)>exact(prediction.registeredAtUtc))||
        prediction.features.spec!==DATASET_SPEC||
        JSON.stringify(Object.keys(prediction.features.values))!==JSON.stringify(PHASE31_FEATURES)||
        PHASE31_FEATURES.some(name=>!Number.isFinite(prediction.features.values[name]))||
        prediction.features.hash!==sha(JSON.stringify({spec:DATASET_SPEC,names:PHASE31_FEATURES,values:prediction.features.values})))
        throw new Error('Predicción prospectiva incompatible.');
      const local=newYorkBarParts(prediction.barStartUtc),session=calendar.get(local.day);
      if(!session)throw new Error('Sesión oficial de predicción ausente.');
      const [hour,minute]=local.slot.split(':').map(Number),scheduled=scheduledPostDecisionEntry(
        prediction.barStartUtc,prediction.registeredAtUtc,hour!*60+minute!,session);
      if(!scheduled.entryAtUtc||!scheduled.horizonEndUtc||scheduled.entryAtUtc!==prediction.entryAtUtc||
        scheduled.horizonEndUtc!==prediction.outcomeAtUtc||prediction.barEndUtc!==new Date(exact(prediction.barStartUtc)+900_000).toISOString())
        throw new Error('Horizonte prospectivo incompatible con el calendario 41I.');
      let previousSource:string|null=null;
      const sourceCandles:{timestamp:string;open:number;high:number;low:number;close:number;volume:number}[]=[];
      const sourceCalendar=new Map(calendar);
      for(const source of prediction.sourceBars){
        if(previousSource!==null&&source.startUtc<=previousSource)throw new Error('Orden causal de variables IEX inválido.');
        previousSource=source.startUtc;
        if(source.origin==='LIVE'){
          const row=first.get(source.startUtc);
          if(!row||row.recordHash!==source.recordHash||row.receivedAtUtc!==source.receivedAtUtc||row.revision!==source.revision)
            throw new Error('Variable Live no usa primera versión.');
          sourceCandles.push({timestamp:source.startUtc,open:row.bar!.open,high:row.bar!.high,low:row.bar!.low,
            close:row.bar!.close,volume:row.bar!.volume});
        }else{
          const verified=warmupBar(source.startUtc),bar=verified.bar;
          if(!bar||source.revision!==0||source.receivedAtUtc!==verified.registeredAtUtc||
            source.recordHash!==sha(JSON.stringify({csv:verified.csvSha256,bar}))||
            exact(source.receivedAtUtc)>=exact(prediction.barStartUtc))
            throw new Error('Calentamiento IEX incompatible.');
          sourceCandles.push(bar);
          for(const [day,hours] of verified.calendar){
            const present=sourceCalendar.get(day);
            if(present&&(present.open!==hours.open||present.close!==hours.close))
              throw new Error('Calendarios oficiales IEX contradictorios.');
            sourceCalendar.set(day,hours);
          }
        }
      }
      if(sourceCandles.some(bar=>!isCalendarBar(exact(bar.timestamp),sourceCalendar))||
        phase23ContinuousSuffix(sourceCandles,sourceCalendar).length!==sourceCandles.length)
        throw new Error('Velas fuente discontinuas o fuera de calendario.');
      const calculated=calculatePhase23Features(sourceCandles,sourceCalendar).at(-1);
      if(!calculated)throw new Error('Indicadores prospectivos insuficientes.');
      const derived={return_1:calculated.return_1,return_4:calculated.return_4,distance_ema9:calculated.distance_ema9,
        distance_sma20:calculated.distance_sma20,bollinger_position:calculated.bollinger_position,
        relative_volume_20:calculated.relative_volume_20,candle_range:calculated.candle_range,
        candle_body:calculated.candle_body,atr14_relative:calculated.atr14_relative,
        minutes_from_open:hour!*60+minute!-session.open};
      if(PHASE31_FEATURES.some(name=>Math.abs(derived[name]-prediction.features.values[name])>1e-10)||
        Math.abs(calculated.atr14PriceUnits-prediction.atr14PriceUnits)>1e-10)
        throw new Error('Variables IEX no equivalentes a Fase 23.');
      const probabilitiesByModel={xgboost:probabilities(prediction.probabilities.xgboost),
        linear:probabilities(prediction.probabilities.linear),frequency:probabilities(prediction.probabilities.frequency)};
      if(winner(prediction.probabilities.xgboost)!==prediction.dominantClass)throw new Error('Argmax IEX incompatible.');
      const evaluation=evaluations.get(prediction.id),end=exact(prediction.outcomeAtUtc);
      const evaluationStatus=evaluation?.status??(now<end+30*60_000?'PENDING':'OVERDUE_UNEVALUATED');
      if(evaluationStatus==='PENDING')pending++;else if(evaluationStatus==='OVERDUE_UNEVALUATED')overdue++;
      else if(evaluationStatus==='EVALUATED')evaluated++;else nonEvaluable++;
      if(evaluation){
        if(exact(evaluation.evaluatedAtUtc)<end+30*60_000)throw new Error('Evaluación anterior a disponibilidad IEX.');
        if(evaluation.status==='EVALUATED'){
          if(!lastEvaluationAtUtc||evaluation.evaluatedAtUtc>lastEvaluationAtUtc)lastEvaluationAtUtc=evaluation.evaluatedAtUtc;
          const entry=first.get(prediction.entryAtUtc),last=first.get(new Date(end-900_000).toISOString());
          const four=Array.from({length:4},(_,i)=>first.get(new Date(exact(prediction.entryAtUtc)+i*900_000).toISOString()));
          if(!entry||!last||four.some(value=>!value)||evaluation.entrySourceHash!==entry.recordHash||
            evaluation.outcomeSourceHash!==last.recordHash||evaluation.entryOpen!==entry.bar!.open||
            evaluation.outcomeClose!==last.bar!.close||
            evaluation.label!==classifyMovement(last.bar!.close-entry.bar!.open,prediction.atr14PriceUnits)||
            four.some(value=>exact(value!.receivedAtUtc)>exact(evaluation.evaluatedAtUtc)))
            throw new Error('Evaluación IEX no coincide con primeras versiones y ATR original.');
          sessions.add(newYorkBarParts(prediction.barStartUtc).day);
        }else if(evaluation.label!==null)throw new Error('Resultado no evaluable con etiqueta.');
      }
      const actualClass=evaluation?.status==='EVALUATED'?evaluation.label as typeof classes[number]:null;
      const item=IexProspectivePrediction.parse({predictionId:prediction.id,sessionDateNy:newYorkBarParts(prediction.barStartUtc).day,
        barStartUtc:prediction.barStartUtc,barEndUtc:prediction.barEndUtc,receivedAtUtc:prediction.receivedAtUtc,
        registeredAtUtc:prediction.registeredAtUtc,entryAtUtc:prediction.entryAtUtc,outcomeAtUtc:prediction.outcomeAtUtc,
        modelSha256:prediction.modelSha256,protocolSha256:active.activation.protocolSha256,probabilities:probabilitiesByModel,
        dominantClass:prediction.dominantClass,evaluationStatus,actualClass,evaluatedAtUtc:evaluation?.evaluatedAtUtc??null,
        entryOpen:evaluation?.entryOpen??null,outcomeClose:evaluation?.outcomeClose??null,
        movementAtr:actualClass&&prediction.atr14PriceUnits>0?
          (evaluation!.outcomeClose!-evaluation!.entryOpen!)/prediction.atr14PriceUnits:null,
        matches:Object.fromEntries(['xgboost','linear','frequency'].map(name=>[
          name,actualClass?winner(prediction.probabilities[name as keyof typeof prediction.probabilities])===actualClass:null]))});
      items.push(item);
      details.set(prediction.id,IexProspectiveDetail.parse({...item,predictionRecordHash:prediction.recordHash,
        featureHash:prediction.features.hash,atr14PriceUnits:prediction.atr14PriceUnits,sourceBarCount:prediction.sourceBars.length,
        sourceBars:prediction.sourceBars.slice(-40).map(({startUtc,receivedAtUtc,recordHash,origin})=>({startUtc,receivedAtUtc,recordHash,origin}))}));
    }
    items.sort((a,b)=>b.barStartUtc.localeCompare(a.barStartUtc)||b.predictionId.localeCompare(a.predictionId));
    const market=marketCoverage(calendar,first,active.activation.activatedAtUtc,now);
    const todayNy=newYorkBarParts(new Date(now).toISOString()).day;
    const weekday=new Date(`${todayNy}T00:00:00.000Z`).getUTCDay();
    const calendarEndsBeforeToday=[...calendar.keys()].every(day=>day<todayNy);
    const marketStatus=calendarEndsBeforeToday&&weekday!==0&&weekday!==6?'CALENDAR_UNAVAILABLE':
      isCalendarBar(now,calendar)?'OPEN':'MARKET_CLOSED';
    const status=items.length?'READY':'NO_PROSPECTIVE_DATA';
    const coverage=IexProspectiveCoverage.parse({status,decisionRecords:decisions.length,candidateBars:byBar.size,admittedBars:admitted,
      finallyNotAdmitted:byBar.size-admitted,failedAttemptsBeforeRecovery:recovered,abstentionsByReason:abstentions,
      expectedCompleteBars:market.expected,receivedCompleteBars:market.received,scheduledSessions:market.sessions,
      sessionsWithCapture:market.captured,coverage:market.ratio,marketStatus,
      reason:'Cobertura de primeras versiones IEX Live; ausencia de captura no equivale a ausencia de transacciones.'});
    let snapshot:ReturnType<typeof readSnapshot>|null=null,snapshotError=false;
    try{snapshot=readSnapshot(paths.reportDir,active,new Set(linked.keys()),evaluated,now);}
    catch{snapshotError=true;}
    const metrics=IexProspectiveMetrics.parse({status,snapshotStatus:snapshotError?'INVALID_ARTIFACT':snapshot!.status,
      reportStatus:snapshotError?null:snapshot!.reportStatus,generatedAtUtc:snapshotError?null:snapshot!.generatedAtUtc,
      evaluatedInSnapshot:snapshotError?0:snapshot!.evalCount,scores:snapshotError?null:snapshot!.scores,
      warning:snapshotError?'El snapshot de métricas no superó la verificación de integridad.':
        snapshot!.status==='METRICS_SNAPSHOT_STALE'?'El snapshot no incluye las evaluaciones más recientes.':
        'Métricas retrospectivas prospectivas descriptivas; sin utilidad operativa demostrada.'});
    const overview=IexProspectiveOverview.parse({status,evidenceStatus:snapshotError?null:snapshot!.status==='READY'?
      snapshot!.reportStatus:items.length?'COLLECTING':'NO_PROSPECTIVE_DATA',protocolVersion:'41I v2',modelLabel:'XGBoost 38F',
      symbol:'NVDA',timeframe:'15m',feed:'IEX Live',adjustment:'raw',experimental:true,
      activatedAtUtc:active.activation.activatedAtUtc,protocolSha256:active.activation.protocolSha256,
      modelSha256:active.activation.modelSha256,predictions:items.length,evaluated,pending,overdue,nonEvaluable,
      sessionsWithResults:sessions.size,lastPredictionAtUtc:items.reduce<string|null>((latest,item)=>
        !latest||item.registeredAtUtc>latest?item.registeredAtUtc:latest,null),
      lastEvaluationAtUtc,receivedCompleteBars:market.received,expectedCompleteBars:market.expected,coverage:market.ratio,
      marketStatus,reason:items.length?'Cohorte prospectiva verificable; investigación experimental.':
        'El protocolo está activo, pero no hay predicciones elegibles registradas.'});
    return {overview,coverage,metrics,items,details};
  }catch{return fail('Los artefactos prospectivos IEX no superaron la verificación local.');}
}
export function iexProspectiveHistory(projection:Projection,query:{offset:number;limit:number;from?:string;to?:string;
  dominantClass?:string;actualClass?:string;evaluationStatus?:string;evaluatedOnly?:boolean}):IexProspectiveHistory{
  const filtered=projection.items.filter(item=>(!query.from||item.sessionDateNy>=query.from)&&(!query.to||item.sessionDateNy<=query.to)&&
    (!query.dominantClass||item.dominantClass===query.dominantClass)&&(!query.actualClass||item.actualClass===query.actualClass)&&
    (!query.evaluationStatus||item.evaluationStatus===query.evaluationStatus)&&(!query.evaluatedOnly||item.evaluationStatus==='EVALUATED'));
  const items=filtered.slice(query.offset,query.offset+query.limit);
  return IexProspectiveHistory.parse({status:projection.overview.status,items,total:filtered.length,offset:query.offset,limit:query.limit,
    nextOffset:query.offset+query.limit<filtered.length?query.offset+query.limit:null});
}
export function iexProspectiveDetail(projection:Projection,id:string){return projection.details.get(id)??null;}
