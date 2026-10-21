import {existsSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {MlEvaluationItem,MlEvaluationPage,MlEvaluationStatus} from '@trading-poc/contracts';
import {readForwardObservations} from '../../../../trading_poc_001_bollinger/src/phase34-forward-observation.ts';
import {readEvaluations} from '../../../../trading_poc_001_bollinger/src/phase35-evaluation.ts';
import {evaluationReport,frozenDevelopmentBaseline} from '../../../../trading_poc_001_bollinger/src/phase35-metrics.ts';

type Paths={observationLog:string|undefined;evaluationLog:string|undefined;statusPath:string|undefined;runDir:string|undefined;modelSha256:string|undefined};
let cachedReport:{key:string;value:ReturnType<typeof evaluationReport>}|null=null;
function load(paths:Paths){
  if(!paths.modelSha256||!paths.runDir)return {state:'NO_MODEL' as const,reason:'Modelo congelado no configurado.'};
  if(!paths.observationLog||!existsSync(paths.observationLog))return {state:'NO_DATA' as const,reason:'No hay observaciones adelantadas verificables.'};
  try{
    if(statSync(paths.observationLog).size>64*1024*1024||(paths.evaluationLog&&existsSync(paths.evaluationLog)&&statSync(paths.evaluationLog).size>64*1024*1024))throw new Error('Archivo demasiado grande.');
    const observations=readForwardObservations(paths.observationLog);
    if(observations.length>100_000)throw new Error('Demasiadas observaciones.');
    if(observations.some(row=>row.model.sha256!==paths.modelSha256))return {state:'INVALID_ARTIFACT' as const,reason:'Hay observaciones de un modelo incompatible.'};
    const evaluations=paths.evaluationLog?readEvaluations(paths.evaluationLog):[];
    if(evaluations.length>200_000)throw new Error('Demasiadas evaluaciones.');
    if(evaluations.some(row=>row.modelSha256!==paths.modelSha256))return {state:'INVALID_ARTIFACT' as const,reason:'Hay evaluaciones de un modelo incompatible.'};
    const ids=new Set(observations.map(row=>row.recordId)),originals=new Map(evaluations.filter(row=>row.kind==='EVALUATED').map(row=>[row.predictionId,row]));
    if(originals.size!==evaluations.filter(row=>row.kind==='EVALUATED').length||evaluations.some(row=>!ids.has(row.predictionId)||row.kind==='REVISION_NOTICE'&&(!row.supersedes||row.supersedes!==originals.get(row.predictionId)?.recordHash)))throw new Error('Evaluación sin predicción original o revisión incompatible.');
    type LastRun={state?:string;updatedAtUtc?:string;nonEvaluable?:number;reason?:string};
    let lastRun:LastRun|null=null;
    if(paths.statusPath&&existsSync(paths.statusPath))lastRun=JSON.parse(readFileSync(paths.statusPath,'utf8')) as LastRun;
    if(lastRun&&(lastRun.updatedAtUtc!==undefined&&(new Date(lastRun.updatedAtUtc).toISOString()!==lastRun.updatedAtUtc)||lastRun.nonEvaluable!==undefined&&(!Number.isSafeInteger(lastRun.nonEvaluable)||lastRun.nonEvaluable<0)))throw new Error('Estado de evaluación inválido.');
    return {state:'READY' as const,observations,evaluations,lastRun};
  }catch{return {state:'INVALID_ARTIFACT' as const,reason:'No se pudo verificar el registro privado.'};}
}
export function evaluationStatus(paths:Paths){
  const result=load(paths);
  if(result.state!=='READY')return MlEvaluationStatus.parse({state:result.state,observations:0,pending:0,evaluated:0,nonEvaluable:0,revisionNotices:0,updatedAtUtc:null,reason:result.reason});
  const evaluated=result.evaluations.filter(row=>row.kind==='EVALUATED').length,nonEvaluable=Math.max(0,result.lastRun?.nonEvaluable??0);
  const state=result.observations.length===0?'NO_DATA':!result.lastRun?'NOT_RUN':result.lastRun.state==='ERROR'?'ERROR':nonEvaluable?'PARTIAL':evaluated<result.observations.length?'PENDING':'READY';
  return MlEvaluationStatus.parse({state,observations:result.observations.length,pending:Math.max(0,result.observations.length-evaluated-nonEvaluable),evaluated,nonEvaluable,revisionNotices:result.evaluations.filter(row=>row.kind==='REVISION_NOTICE').length,updatedAtUtc:result.lastRun?.updatedAtUtc??null,reason:state==='READY'?'Evaluación observacional; la apertura t+1 ya había ocurrido al registrar la predicción.':state==='ERROR'?'La última evaluación falló; consulte el diagnóstico local.':'El evaluador todavía no resolvió todas las observaciones.'});
}
export function evaluationMetrics(paths:Paths){
  const result=load(paths);if(result.state!=='READY')return {state:result.state,reason:result.reason};
  try{
    const key=`${paths.runDir}:${paths.modelSha256}:${statSync(join(paths.runDir!,'report.json')).mtimeMs}:${result.evaluations.at(-1)?.recordHash??'empty'}`;
    if(cachedReport?.key===key)return {state:'READY',...cachedReport.value};
    const value=evaluationReport(result.evaluations,frozenDevelopmentBaseline(paths.runDir!));cachedReport={key,value};
    return {state:'READY',...value};
  }
  catch{return {state:'INVALID_ARTIFACT',reason:'No se pueden validar métricas o baseline del modelo.'};}
}
export function evaluationClasses(paths:Paths){const result=evaluationMetrics(paths);return result.state==='READY'&&'model'in result?{state:'READY',sampleSize:result.sampleSize,perClass:result.model?.perClass??null,calibration:result.model?.calibration??null,warning:result.warning}:result;}
export function evaluationHistory(paths:Paths,offset:number,limit:number){
  const result=load(paths);if(result.state!=='READY')return {state:result.state,reason:result.reason};
  const rows=result.evaluations.filter(row=>row.kind==='EVALUATED').sort((a,b)=>a.barStartUtc.localeCompare(b.barStartUtc));
  return MlEvaluationPage.parse({items:rows.slice(offset,offset+limit).map(row=>MlEvaluationItem.parse({predictionId:row.predictionId,barStartUtc:row.barStartUtc,sessionDateNy:row.sessionDateNy,evaluatedAtUtc:row.evaluatedAtUtc,predictedClass:row.predictedClass,actualClass:row.actualClass,entryOpen:row.entryOpen,exitClose:row.exitClose,change:row.change,changePct:row.changePct,atr14:row.atr14,revisionNotice:result.evaluations.some(item=>item.kind==='REVISION_NOTICE'&&item.predictionId===row.predictionId)})),total:rows.length,offset,limit,nextOffset:offset+limit<rows.length?offset+limit:null});
}
