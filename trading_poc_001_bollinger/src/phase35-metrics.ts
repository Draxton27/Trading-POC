import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {EvaluationRecord} from './phase35-evaluation.ts';

export const CLASS_NAMES=['ALCISTA','BAJISTA','LATERAL'] as const;
type ClassName=typeof CLASS_NAMES[number];
type Probabilities=Record<ClassName,number>;
export type Scores={n:number;confusionMatrix:number[][];accuracy:number;balancedAccuracy:number;macroF1:number;logLoss:number;brier:number;perClass:Record<ClassName,{precision:number;recall:number;f1:number;support:number}>;calibration:Record<ClassName,Array<{from:number;to:number;n:number;meanPrediction:number;observedFrequency:number}>>};
const index=(name:ClassName)=>CLASS_NAMES.indexOf(name);
const finiteProbability=(p:Probabilities)=>CLASS_NAMES.every(name=>Number.isFinite(p[name])&&p[name]>=0&&p[name]<=1)&&Math.abs(CLASS_NAMES.reduce((sum,name)=>sum+p[name],0)-1)<1e-6;
export function scores(rows:readonly EvaluationRecord[],baseline?:Probabilities):Scores|null{
  const evaluated=rows.filter(row=>row.kind==='EVALUATED'&&row.status==='VERIFIED'&&row.actualClass!==null);if(!evaluated.length)return null;
  const matrix=Array.from({length:3},()=>[0,0,0]),calibration={} as Scores['calibration'];
  let correct=0,loss=0,brier=0;
  for(const row of evaluated){
    const p=baseline??row.probabilities;if(!finiteProbability(p))throw new Error('Probabilidades de evaluación inválidas.');
    const actual=index(row.actualClass!),predicted=index(CLASS_NAMES.reduce((best,name)=>p[name]>p[best]?name:best,CLASS_NAMES[0]));
    matrix[actual]![predicted]!++;if(actual===predicted)correct++;
    loss-=Math.log(Math.max(p[row.actualClass!],1e-15));
    brier+=CLASS_NAMES.reduce((sum,name)=>sum+(p[name]-(name===row.actualClass?1:0))**2,0);
  }
  const perClass={} as Scores['perClass'];
  for(const [i,name] of CLASS_NAMES.entries()){
    const tp=matrix[i]![i]!,support=matrix[i]!.reduce((a,b)=>a+b,0),predicted=matrix.reduce((sum,line)=>sum+line[i]!,0),precision=predicted?tp/predicted:0,recall=support?tp/support:0;
    perClass[name]={precision,recall,f1:precision+recall?2*precision*recall/(precision+recall):0,support};
    calibration[name]=Array.from({length:5},(_,bin)=>{
      const from=bin/5,to=(bin+1)/5,subset=evaluated.filter(row=>{const p=(baseline??row.probabilities)[name];return p>=from&&(bin===4?p<=to:p<to);});
      return {from,to,n:subset.length,meanPrediction:subset.length?subset.reduce((sum,row)=>sum+(baseline??row.probabilities)[name],0)/subset.length:0,observedFrequency:subset.length?subset.filter(row=>row.actualClass===name).length/subset.length:0};
    });
  }
  return {n:evaluated.length,confusionMatrix:matrix,accuracy:correct/evaluated.length,balancedAccuracy:CLASS_NAMES.reduce((sum,name)=>sum+perClass[name].recall,0)/3,macroF1:CLASS_NAMES.reduce((sum,name)=>sum+perClass[name].f1,0)/3,logLoss:loss/evaluated.length,brier:brier/evaluated.length,perClass,calibration};
}
/** Frequency forecast saved in the final pre-2025 development fold; no evaluation labels are read. */
export function frozenDevelopmentBaseline(runDir:string):{probabilities:Probabilities;source:string}|null{
  const report=JSON.parse(readFileSync(join(runDir,'report.json'),'utf8')) as {class_index?:unknown;walk_forward_folds?:Array<{external_sessions?:string[];out_of_sample_predictions?:Array<{prob_frequency?:number[]}>}>};
  if(JSON.stringify(report.class_index)!==JSON.stringify({ALCISTA:0,BAJISTA:1,LATERAL:2}))throw new Error('Orden de clases incompatible.');
  const folds=report.walk_forward_folds??[],fold=folds.at(-1),row=fold?.out_of_sample_predictions?.[0],values=row?.prob_frequency;
  if(!fold?.external_sessions?.length||fold.external_sessions.some(day=>day>='2025-01-01')||!values||values.length!==3)return null;
  const probabilities={ALCISTA:values[0]!,BAJISTA:values[1]!,LATERAL:values[2]!};
  if(!finiteProbability(probabilities)||fold.out_of_sample_predictions!.some(item=>item.prob_frequency?.some((p,i)=>Math.abs(p-values[i]!)>1e-10)))throw new Error('Baseline de desarrollo inconsistente.');
  return {probabilities,source:'Frecuencias congeladas del último fold causal de desarrollo anterior a 2025'};
}
function bootstrap(rows:EvaluationRecord[],baseline?:Probabilities){
  const sessions=[...new Set(rows.map(row=>row.sessionDateNy))].sort();if(rows.length<30||sessions.length<10)return null;
  let seed=0x35a1b2c3;const next=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/2**32;};
  const bySession=new Map(sessions.map(day=>[day,rows.filter(row=>row.sessionDateNy===day)]));
  const samples:{accuracy:number;balancedAccuracy:number;macroF1:number;logLoss:number;brier:number}[]=[];
  for(let i=0;i<500;i++){
    const draw=sessions.flatMap(()=>bySession.get(sessions[Math.floor(next()*sessions.length)]!)!);const metric=scores(draw,baseline)!;
    samples.push({accuracy:metric.accuracy,balancedAccuracy:metric.balancedAccuracy,macroF1:metric.macroF1,logLoss:metric.logLoss,brier:metric.brier});
  }
  const interval=(key:keyof typeof samples[number])=>{const sorted=samples.map(item=>item[key]).sort((a,b)=>a-b);return [sorted[12]!,sorted[487]!] as const;};
  return {method:'bootstrap por sesiones completas; 500 remuestreos; intervalo percentil 95 %',accuracy:interval('accuracy'),balancedAccuracy:interval('balancedAccuracy'),macroF1:interval('macroF1'),logLoss:interval('logLoss'),brier:interval('brier')};
}
function pairedBootstrap(rows:EvaluationRecord[],baseline:Probabilities){
  const sessions=[...new Set(rows.map(row=>row.sessionDateNy))].sort();if(rows.length<30||sessions.length<10)return null;
  let seed=0x35c0ffee;const next=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/2**32;};
  const groups=new Map(sessions.map(day=>[day,rows.filter(row=>row.sessionDateNy===day)]));
  const keys=['accuracy','balancedAccuracy','macroF1','logLoss','brier'] as const;
  const differences=Object.fromEntries(keys.map(key=>[key,[] as number[]])) as Record<(typeof keys)[number],number[]>;
  for(let i=0;i<500;i++){
    const draw=sessions.flatMap(()=>groups.get(sessions[Math.floor(next()*sessions.length)]!)!),model=scores(draw)!,control=scores(draw,baseline)!;
    for(const key of keys)differences[key].push(model[key]-control[key]);
  }
  const pointModel=scores(rows)!,pointControl=scores(rows,baseline)!;
  return Object.fromEntries(keys.map(key=>{const sorted=differences[key].sort((a,b)=>a-b);return [key,{difference:pointModel[key]-pointControl[key],interval95:[sorted[12]!,sorted[487]!] as const}];})) as Record<(typeof keys)[number],{difference:number;interval95:readonly [number,number]}>;
}
export function evaluationReport(records:readonly EvaluationRecord[],baseline:ReturnType<typeof frozenDevelopmentBaseline>){
  const rows=records.filter(row=>row.kind==='EVALUATED'&&row.status==='VERIFIED');
  const groups=(key:(row:EvaluationRecord)=>string)=>Object.fromEntries([...new Set(rows.map(key))].sort().map(name=>[name,scores(rows.filter(row=>key(row)===name))]));
  return {sampleSize:rows.length,sessions:new Set(rows.map(row=>row.sessionDateNy)).size,model:scores(rows),baseline:baseline?{source:baseline.source,probabilities:baseline.probabilities,metrics:scores(rows,baseline.probabilities)}:null,bySession:groups(row=>row.sessionDateNy),byMonth:groups(row=>row.sessionDateNy.slice(0,7)),uncertainty:bootstrap(rows),pairedDifferences:baseline?pairedBootstrap(rows,baseline.probabilities):null,warning:rows.length<30||new Set(rows.map(row=>row.sessionDateNy)).size<10?'Muestra insuficiente para intervalos por sesión; no hay evidencia de superioridad estadística.':'Intervalos descriptivos; observaciones de la misma sesión son dependientes. Probabilidades no calibradas para uso operativo.'};
}
