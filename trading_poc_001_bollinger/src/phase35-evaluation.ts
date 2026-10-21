/** Fase 35: evaluation of genuine delayed forward observations, never replay rows. */
import {createHash} from 'node:crypto';
import {closeSync,existsSync,mkdirSync,openSync,readFileSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {loadMarketCalendar,type MarketCalendar} from './alpaca-calendar.ts';
import {classifyMovement,calculatePhase23Features,phase23ContinuousSuffix} from './phase23-dataset.ts';
import {readIngestion,type IngestionRecord,BAR_MS} from './phase32-ingestion.ts';
import {readForwardObservations,type ForwardObservation} from './phase34-forward-observation.ts';
import {frozenModel,PHASE31_FEATURES} from './phase31-inference.ts';
import {newYorkBarParts} from './strategy-validation.ts';

export type EvaluationRecord={schema:'phase35-evaluation-v1';kind:'EVALUATED'|'REVISION_NOTICE';recordId:string;previousHash:string|null;recordHash:string;predictionId:string;modelSha256:string;predictedClass:'ALCISTA'|'BAJISTA'|'LATERAL';probabilities:{ALCISTA:number;BAJISTA:number;LATERAL:number};actualClass:'ALCISTA'|'BAJISTA'|'LATERAL'|null;entryOpen:number|null;exitClose:number|null;atr14:number|null;change:number|null;changePct:number|null;barStartUtc:string;entryAtUtc:string;outcomeCloseAtUtc:string;evaluatedAtUtc:string;sessionDateNy:string;outcomeBars:Array<{startUtc:string;endUtc:string;revision:number;recordHash:string;responseSha256:string;receivedAtUtc:string}>;status:'VERIFIED'|'REVISED_AFTER_EVALUATION';supersedes:string|null};
export type EvaluationState='PENDING'|'EVALUATED'|'NON_EVALUABLE';
export type EvaluationDecision={predictionId:string;state:EvaluationState;reason:string;record?:EvaluationRecord};
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const exact=(s:string)=>{const ms=Date.parse(s);if(!Number.isFinite(ms)||new Date(ms).toISOString()!==s)throw new Error('Timestamp UTC inválido.');return ms;};
const minutes=(s:string)=>{const [h,m]=s.split(':').map(Number);return h!*60+m!;};
const labels=['ALCISTA','BAJISTA','LATERAL'] as const;
const validBar=(row:IngestionRecord,calendar:MarketCalendar)=>{
  const b=row.bar;if(row.kind!=='bar'||!b||row.provider!=='Alpaca Market Data API'||row.feed!=='sip'||row.adjustment!=='split'||row.availability!=='DELAYED'||row.status!=='DELAYED'||!row.responseSha256||!Number.isInteger(b.revision)||b.revision<1)throw new Error('Vela sin procedencia SIP retrasada verificable.');
  const start=exact(b.startUtc),end=exact(b.endUtc),received=exact(row.receivedAtUtc),local=newYorkBarParts(b.startUtc),hours=calendar.get(local.day);
  if(end-start!==BAR_MS||received<end||!hours||minutes(local.slot)<hours.open||minutes(local.slot)+15>hours.close||[b.open,b.high,b.low,b.close,b.volume].some(v=>!Number.isFinite(v))||b.open<=0||b.close<=0||b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close,b.high)||b.low<=0||b.volume<0)throw new Error('Vela incompatible con OHLCV, calendario o recepción.');
  return b;
};
export function readEvaluations(path:string):EvaluationRecord[]{
  if(!existsSync(path))return [];let previous:string|null=null;
  return readFileSync(path,'utf8').split(/\r?\n/).filter(Boolean).map(line=>{const row=JSON.parse(line) as EvaluationRecord,{recordHash,...unsigned}=row;
    if(row.schema!=='phase35-evaluation-v1'||row.previousHash!==previous||sha(JSON.stringify(unsigned))!==recordHash||!['EVALUATED','REVISION_NOTICE'].includes(row.kind))throw new Error('Ledger de evaluación alterado.');
    previous=recordHash;return row;
  });
}
function locked<T>(path:string,run:()=>T):T{
  mkdirSync(dirname(path),{recursive:true});const lock=`${path}.lock`,until=Date.now()+5_000;let fd:number|undefined;
  while(fd===undefined)try{fd=openSync(lock,'wx');}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;if(Date.now()>=until)throw new Error('Otra evaluación mantiene el bloqueo.');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);}
  try{return run();}finally{closeSync(fd);unlinkSync(lock);}
}
function append(path:string,input:Omit<EvaluationRecord,'schema'|'recordId'|'previousHash'|'recordHash'>):{record:EvaluationRecord;added:boolean}{
  return locked(path,()=>{const rows=readEvaluations(path),{schema:_schema,recordId:_id,previousHash:_previous,recordHash:_hash,...fields}=input as EvaluationRecord,recordId=sha(JSON.stringify({kind:fields.kind,predictionId:fields.predictionId,outcomeBars:fields.outcomeBars.map(b=>b.recordHash)}));
    const existing=rows.find(row=>row.recordId===recordId);if(existing)return {record:existing,added:false};
    const unsigned={schema:'phase35-evaluation-v1' as const,recordId,previousHash:rows.at(-1)?.recordHash??null,...fields},record={...unsigned,recordHash:sha(JSON.stringify(unsigned))};
    writeFileSync(path,JSON.stringify(record)+'\n',{flag:'a'});return {record,added:true};
  });
}
function originalBars(prediction:ForwardObservation,ingestion:IngestionRecord[],calendar:MarketCalendar){
  if(!prediction.recordedBeforeOutcome||prediction.mode!=='DELAYED_FORWARD_OBSERVATION'||exact(prediction.registeredAtUtc)>=exact(prediction.outcomeCloseAtUtc))throw new Error('Predicción no registrada antes del desenlace.');
  if(exact(prediction.model.createdAtUtc)>=exact(prediction.bar.startUtc))throw new Error('Modelo posterior a la observación.');
  if(prediction.source.provider!=='Alpaca Market Data API'||prediction.source.feed!=='sip'||prediction.source.adjustment!=='split'||prediction.source.availability!=='DELAYED')throw new Error('Procedencia de predicción incompatible.');
  const selected=prediction.sourceBars.map(source=>{const row=ingestion.find(candidate=>candidate.recordHash===source.recordHash);if(!row||row.bar?.startUtc!==source.startUtc||row.bar.endUtc!==source.endUtc||row.bar.revision!==source.revision||row.responseSha256!==source.responseSha256||row.receivedAtUtc!==source.receivedAtUtc||exact(row.receivedAtUtc)>exact(prediction.registeredAtUtc))throw new Error('Revisión original de predicción ausente o posterior.');validBar(row,calendar);return row;});
  if(selected.length<21||selected.at(-1)?.recordHash!==prediction.bar.sourceRecordHash||selected.at(-1)?.bar?.startUtc!==prediction.bar.startUtc||selected.at(-1)?.bar?.endUtc!==prediction.bar.endUtc||selected.at(-1)?.bar?.revision!==prediction.bar.revision||selected.at(-1)?.responseSha256!==prediction.bar.sourceResponseSha256||selected.at(-1)?.receivedAtUtc!==prediction.bar.receivedAtUtc||newYorkBarParts(prediction.bar.startUtc).day!==prediction.bar.sessionDateNy)throw new Error('Historial original de predicción incompleto.');
  const candles=selected.map(row=>({timestamp:row.bar!.startUtc,open:row.bar!.open,high:row.bar!.high,low:row.bar!.low,close:row.bar!.close,volume:row.bar!.volume}));
  if(phase23ContinuousSuffix(candles,calendar).length!==candles.length)throw new Error('Historial original con hueco temporal.');
  const calculated=calculatePhase23Features(candles,calendar).at(-1);if(!calculated)throw new Error('Indicadores originales insuficientes.');
  const local=newYorkBarParts(prediction.bar.startUtc),hours=calendar.get(local.day)!;
  const values={return_1:calculated.return_1,return_4:calculated.return_4,distance_ema9:calculated.distance_ema9,distance_sma20:calculated.distance_sma20,bollinger_position:calculated.bollinger_position,relative_volume_20:calculated.relative_volume_20,candle_range:calculated.candle_range,candle_body:calculated.candle_body,atr14_relative:calculated.atr14_relative,minutes_from_open:minutes(local.slot)-hours.open};
  if(prediction.features.spec!=='nvda-15m-v1'||PHASE31_FEATURES.some(name=>Math.abs(values[name]-prediction.features.values[name])>1e-12)||sha(JSON.stringify({spec:'nvda-15m-v1',names:PHASE31_FEATURES,values}))!==prediction.features.hash)throw new Error('Variables originales no equivalentes a Fase 23.');
  const atr=prediction.features.values.atr14_relative*selected.at(-1)!.bar!.close;if(!Number.isFinite(atr)||atr<=0||Math.abs(atr-calculated.atr14PriceUnits)>1e-10)throw new Error('ATR original incompatible.');
  return atr;
}
export function evaluatePrediction(prediction:ForwardObservation,ingestion:IngestionRecord[],calendar:MarketCalendar,modelSha256:string,nowUtc:string):EvaluationDecision{
  const now=exact(nowUtc),start=exact(prediction.bar.startUtc),end=start+BAR_MS*5;
  if(prediction.model.sha256!==modelSha256)return {predictionId:prediction.recordId,state:'NON_EVALUABLE',reason:'Modelo incompatible.'};
  try{
    if(prediction.outcomeCloseAtUtc!==new Date(end).toISOString()||prediction.entryAtUtc!==new Date(start+BAR_MS).toISOString())throw new Error('Horizonte inconsistente.');
    const atr=originalBars(prediction,ingestion,calendar),local=newYorkBarParts(prediction.bar.startUtc),hours=calendar.get(local.day)!;
    if(minutes(local.slot)+75>hours.close)throw new Error('Horizonte cruza el cierre oficial.');
    if(now<end)return {predictionId:prediction.recordId,state:'PENDING',reason:'Todavía no cerró t+4.'};
    const future:IngestionRecord[]=[];
    for(let i=1;i<=4;i++){
      const stamp=new Date(start+i*BAR_MS).toISOString();
      const candidates=ingestion.filter(row=>row.kind==='bar'&&row.bar?.startUtc===stamp&&exact(row.receivedAtUtc)<=now);
      const selected=candidates.at(-1);if(!selected){const later=ingestion.some(row=>row.kind==='bar'&&row.bar&&exact(row.bar.startUtc)>start+i*BAR_MS&&exact(row.receivedAtUtc)<=now);return {predictionId:prediction.recordId,state:later?'NON_EVALUABLE':'PENDING',reason:later?`Hueco intradía en t+${i}.`:`Falta vela verificada t+${i}.`};}
      validBar(selected,calendar);if(exact(selected.receivedAtUtc)<exact(selected.bar!.endUtc))throw new Error('Resultado recibido antes de cerrar.');future.push(selected);
    }
    const entry=future[0]!.bar!.open,exit=future[3]!.bar!.close,change=exit-entry,probabilities={ALCISTA:prediction.prediction.ALCISTA,BAJISTA:prediction.prediction.BAJISTA,LATERAL:prediction.prediction.LATERAL};
    if(labels.some(name=>!Number.isFinite(probabilities[name])||probabilities[name]<0||probabilities[name]>1)||Math.abs(Object.values(probabilities).reduce((a,b)=>a+b,0)-1)>1e-6||!labels.includes(prediction.prediction.dominantClass)||labels.reduce((best,name)=>probabilities[name]>probabilities[best]?name:best,labels[0])!==prediction.prediction.dominantClass)throw new Error('Probabilidades originales inválidas.');
    const input:Omit<EvaluationRecord,'schema'|'recordId'|'previousHash'|'recordHash'>={kind:'EVALUATED',predictionId:prediction.recordId,modelSha256,predictedClass:prediction.prediction.dominantClass,probabilities,actualClass:classifyMovement(change,atr),entryOpen:entry,exitClose:exit,atr14:atr,change,changePct:change/entry,barStartUtc:prediction.bar.startUtc,entryAtUtc:prediction.entryAtUtc,outcomeCloseAtUtc:prediction.outcomeCloseAtUtc,evaluatedAtUtc:nowUtc,sessionDateNy:local.day,outcomeBars:future.map(row=>({startUtc:row.bar!.startUtc,endUtc:row.bar!.endUtc,revision:row.bar!.revision,recordHash:row.recordHash,responseSha256:row.responseSha256!,receivedAtUtc:row.receivedAtUtc})),status:'VERIFIED',supersedes:null};
    return {predictionId:prediction.recordId,state:'EVALUATED',reason:'Desenlace verificado.',record:{...input,schema:'phase35-evaluation-v1',recordId:'',previousHash:null,recordHash:''}};
  }catch(error){return {predictionId:prediction.recordId,state:'NON_EVALUABLE',reason:error instanceof Error?error.message:'Datos inválidos.'};}
}
export function evaluateOnce(options:{ingestionLog:string;observationLog:string;calendarPath:string;modelDir:string;evaluationLog:string;clock?:()=>string}){
  const now=options.clock?.()??new Date().toISOString(),model=frozenModel(options.modelDir),calendar=loadMarketCalendar(options.calendarPath),ingestion=readIngestion(options.ingestionLog),predictions=readForwardObservations(options.observationLog),existing=readEvaluations(options.evaluationLog);
  const decisions:EvaluationDecision[]=[];let added=0,revisionNotices=0;
  for(const prediction of predictions){
    if(prediction.model.createdAtUtc!==model.createdAtUtc){decisions.push({predictionId:prediction.recordId,state:'NON_EVALUABLE',reason:'Fecha de congelación del modelo incompatible.'});continue;}
    const original=existing.find(row=>row.kind==='EVALUATED'&&row.predictionId===prediction.recordId);
    if(original&&prediction.model.sha256===model.sha256){
      const changed=original.outcomeBars.some(bar=>{
        const latest=ingestion.filter(row=>row.kind==='bar'&&row.bar?.startUtc===bar.startUtc&&exact(row.receivedAtUtc)<=exact(now)).at(-1);
        return latest?.recordHash!==bar.recordHash;
      });
      if(!changed){decisions.push({predictionId:prediction.recordId,state:'EVALUATED',reason:'Primera evaluación inmutable; sin revisiones nuevas.'});continue;}
    }
    const decision=evaluatePrediction(prediction,ingestion,calendar,model.sha256,now);decisions.push(decision);
    if(decision.state!=='EVALUATED'||!decision.record)continue;
    if(original){
      const changed=decision.record.outcomeBars.some((bar,i)=>bar.recordHash!==original.outcomeBars[i]?.recordHash);
      if(changed){const notice={...original,kind:'REVISION_NOTICE' as const,outcomeBars:decision.record.outcomeBars,evaluatedAtUtc:now,status:'REVISED_AFTER_EVALUATION' as const,supersedes:original.recordHash};
        const saved=append(options.evaluationLog,notice);if(saved.added)revisionNotices++;}
      continue;
    }
    if(append(options.evaluationLog,decision.record).added)added++;
  }
  return {predictions:predictions.length,evaluated:readEvaluations(options.evaluationLog).filter(row=>row.kind==='EVALUATED').length,pending:decisions.filter(row=>row.state==='PENDING').length,nonEvaluable:decisions.filter(row=>row.state==='NON_EVALUABLE').length,added,revisionNotices,decisions};
}
