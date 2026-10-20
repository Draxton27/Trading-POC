import {createHash} from 'node:crypto';
import {lstatSync,readFileSync} from 'node:fs';
import {basename,join} from 'node:path';
import {z} from 'zod';
import {MlMetrics,MlMetricsResponse,MlPrediction,MlPredictionsPage,MlSummary,type MlMetrics as Metrics,type MlPrediction as Prediction} from '@trading-poc/contracts';
import {parseCsvRows} from '../../../../trading_poc_001_bollinger/src/phase17-csv.ts';

const warning='Modelo experimental. Evaluación retrospectiva no independiente. Probabilidades no calibradas para uso operativo. No constituye recomendación CALL o PUT.';
const names=['report.json','model.json','exploratory_predictions.csv','reproduction.json'] as const;
const limits:Record<(typeof names)[number],number>={'report.json':32*1024*1024,'model.json':8*1024*1024,'exploratory_predictions.csv':8*1024*1024,'reproduction.json':128*1024};
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const finite=z.number().finite();
const rawClass=z.object({precision:finite,recall:finite,f1:finite,support:z.number().int().nonnegative()});
const rawMetrics=z.object({accuracy:finite,balanced_accuracy:finite,macro_f1:finite,log_loss:finite,per_class:z.object({ALCISTA:rawClass,BAJISTA:rawClass,LATERAL:rawClass})});
const triple=z.tuple([z.number().finite().min(0).max(1),z.number().finite().min(0).max(1),z.number().finite().min(0).max(1)]).refine(values=>Math.abs(values[0]+values[1]+values[2]-1)<=1e-5);
const oof=z.object({bar_start_utc:z.iso.datetime({offset:true}),session_date_ny:z.string().date(),label:z.enum(['ALCISTA','BAJISTA','LATERAL']),prob_standard:triple,prob_class_weighted:triple,prob_regularized:triple,prob_majority:triple,prob_frequency:triple});
const rawReport=z.object({experimental:z.literal(true),dataset_sha256:hash,class_index:z.object({ALCISTA:z.literal(0),BAJISTA:z.literal(1),LATERAL:z.literal(2)}),
  selection:z.object({selected:z.enum(['standard','class_weighted','regularized'])}),
  model:z.object({variant:z.enum(['standard','class_weighted','regularized']),n_estimators:z.number().int().positive().max(10000)}),
  baselines:z.object({frecuencia:rawMetrics}),xgboost:rawMetrics,
  walk_forward_folds:z.array(z.object({fold:z.number().int().positive(),external_sessions:z.array(z.string().date()).min(1),models:z.object({standard:z.object({metrics:rawMetrics}),class_weighted:z.object({metrics:rawMetrics}),regularized:z.object({metrics:rawMetrics}),frequency:z.object({metrics:rawMetrics})}),out_of_sample_predictions:z.array(oof).max(100000).optional()})).min(1).max(20),
  exploratory_by_year:z.object({'2025':rawMetrics.optional(),'2026':rawMetrics.optional()})
});
const rawReproduction=z.object({dataset_metadata:z.object({schemaVersion:z.literal('nvda-15m-v1'),outputCsvSha256:hash,source:z.object({metadata:z.object({asset:z.literal('NVDA'),bar_minutes:z.literal(15),data_class:z.literal('real')})})}),class_index:z.object({ALCISTA:z.literal(0),BAJISTA:z.literal(1),LATERAL:z.literal(2)})});
const utcStamp=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const csvHeader=['bar_start_utc','session_date_ny','label','prob_ALCISTA','prob_BAJISTA','prob_LATERAL'];
const classes=['ALCISTA','BAJISTA','LATERAL'] as const;
// CSV serializes model probabilities as decimal text.  This tolerance covers that
// round-trip and ordinary floating-point evaluation without accepting material drift.
const metricTolerance=1e-6;
type Ready={status:'READY';summary:MlSummary;metrics:MlMetricsResponse;predictions:Prediction[];modelSha256:string};
type Label=(typeof classes)[number];
type ParsedPrediction={prediction:Prediction;label:Label};
type LoadResult=Ready|{status:'NO_MODEL'|'INVALID_ARTIFACT'|'UNAVAILABLE';reason:string;experimentId:null};
const sha=(content:Buffer)=>createHash('sha256').update(content).digest('hex');
const unavailable=(status:'NO_MODEL'|'INVALID_ARTIFACT'|'UNAVAILABLE',reason:string):Exclude<LoadResult,Ready>=>({status,reason,experimentId:null});
function metric(input:z.infer<typeof rawMetrics>):Metrics{
  const perClass=Object.fromEntries((['ALCISTA','BAJISTA','LATERAL'] as const).map(k=>[k,input.per_class[k]]));
  return MlMetrics.parse({accuracy:input.accuracy,balancedAccuracy:input.balanced_accuracy,macroF1:input.macro_f1,logLoss:input.log_loss,perClass});
}
function recalculatedMetrics(predictions:ParsedPrediction[]):z.infer<typeof rawMetrics>{
  if(!predictions.length)throw new Error('No hay predicciones históricas para validar métricas');
  const index=Object.fromEntries(classes.map((name,position)=>[name,position])) as Record<Label,number>;
  const matrix=Array.from({length:3},()=>Array<number>(3).fill(0));
  let correct=0,loss=0;
  for(const {prediction,label} of predictions){
    const actual=index[label],predicted=index[prediction.dominantClass];
    matrix[actual]![predicted]=matrix[actual]![predicted]!+1;if(actual===predicted)correct++;
    loss-=Math.log(Math.max(prediction.probabilities[label],1e-15));
  }
  const per_class=Object.fromEntries(classes.map((name,row)=>{
    const tp=matrix[row]![row]!,fp=matrix.reduce((sum,values)=>sum+values[row]!,0)-tp,fn=matrix[row]!.reduce((sum,value)=>sum+value,0)-tp;
    const precision=tp+fp?tp/(tp+fp):0,recall=tp+fn?tp/(tp+fn):0,f1=precision+recall?2*precision*recall/(precision+recall):0;
    return [name,{precision,recall,f1,support:matrix[row]!.reduce((sum,value)=>sum+value,0)}];
  })) as z.infer<typeof rawMetrics>['per_class'];
  return {accuracy:correct/predictions.length,balanced_accuracy:classes.reduce((sum,name)=>sum+per_class[name].recall,0)/classes.length,
    macro_f1:classes.reduce((sum,name)=>sum+per_class[name].f1,0)/classes.length,log_loss:loss/predictions.length,per_class};
}
function assertMetricMatch(expected:z.infer<typeof rawMetrics>,actual:z.infer<typeof rawMetrics>,scope:string){
  const compare=(name:string,left:number,right:number)=>{if(Math.abs(left-right)>metricTolerance)throw new Error(`Métrica inconsistente en ${scope}: ${name}`);};
  compare('accuracy',expected.accuracy,actual.accuracy);compare('balanced_accuracy',expected.balanced_accuracy,actual.balanced_accuracy);compare('macro_f1',expected.macro_f1,actual.macro_f1);compare('log_loss',expected.log_loss,actual.log_loss);
  for(const name of classes){const a=expected.per_class[name],b=actual.per_class[name];if(a.support!==b.support)throw new Error(`Métrica inconsistente en ${scope}: ${name}.support`);compare(`${name}.precision`,a.precision,b.precision);compare(`${name}.recall`,a.recall,b.recall);compare(`${name}.f1`,a.f1,b.f1);}
}
function readArtifacts(directory:string){
  const parts={} as Record<(typeof names)[number],Buffer>;
  for(const name of names){
    const path=join(directory,name),stat=lstatSync(path);
    if(!stat.isFile()||stat.size>limits[name]||stat.size===0)throw new Error('Archivo ausente, vacío o fuera de límite');
    const content=readFileSync(path);
    if(content.byteLength>limits[name])throw new Error('Archivo fuera de límite');
    parts[name]=content;
  }
  return parts;
}
function parsePredictions(content:Buffer,version:string):ParsedPrediction[]{
  const rows=parseCsvRows(content.toString('utf8'));
  if(rows.length<2||rows.length>100001||JSON.stringify(rows[0])!==JSON.stringify(csvHeader))throw new Error('CSV histórico inválido');
  let prior=-Infinity;
  return rows.slice(1).map(cells=>{
    if(cells.length!==6||!utcStamp.test(cells[0]??''))throw new Error('Fila histórica inválida');
    const instant=Date.parse(cells[0]!);
    if(!Number.isFinite(instant)||new Date(instant).toISOString()!==cells[0]||instant<=prior||instant>Date.now())throw new Error('Orden o instante histórico inválido');
    prior=instant;
    if(!/^202[56]-\d{2}-\d{2}$/.test(cells[1]??'')||!classes.includes(cells[2] as Label))throw new Error('Sesión o etiqueta inválida');
    const values=cells.slice(3).map(value=>value?.trim()===''?NaN:Number(value));
    if(values.length!==3||values.some(value=>!Number.isFinite(value)||value<0||value>1)||Math.abs(values.reduce((a,b)=>a+b,0)-1)>1e-5)throw new Error('Probabilidades inválidas');
    const dominant=(['ALCISTA','BAJISTA','LATERAL'] as const)[values.indexOf(Math.max(...values))]!;
    return {label:cells[2] as Label,prediction:MlPrediction.parse({symbol:'NVDA',timeframe:'15m',timestampUtc:cells[0],sessionDateNy:cells[1],probabilities:{ALCISTA:values[0],BAJISTA:values[1],LATERAL:values[2]},dominantClass:dominant,origin:'HISTORICAL_EXPLORATORY',modelVersion:version})};
  });
}
export function loadMlRun(directory:string|undefined):LoadResult{
  if(!directory)return unavailable('NO_MODEL','TRADING_POC_ML_RUN_DIR no está configurado.');
  try{
    const stat=lstatSync(directory);
    if(!stat.isDirectory())throw new Error('Directorio de experimento inválido');
    const files=readArtifacts(directory);
    const report=rawReport.parse(JSON.parse(files['report.json'].toString('utf8')));
    for(const fold of report.walk_forward_folds){
      const observations=fold.out_of_sample_predictions;
      if(!observations)continue;
      let prior=-Infinity;
      for(const observation of observations){const instant=Date.parse(observation.bar_start_utc);if(!Number.isFinite(instant)||instant<=prior||instant>Date.now())throw new Error('Predicciones del fold fuera de orden o futuras');prior=instant;}
    }
    const reproduction=rawReproduction.parse(JSON.parse(files['reproduction.json'].toString('utf8')));
    const model=JSON.parse(files['model.json'].toString('utf8')) as unknown;
    const modelShape=z.object({version:z.tuple([z.number().int(),z.number().int(),z.number().int()]),learner:z.object({learner_model_param:z.object({num_class:z.literal('3'),num_feature:z.literal('10')}),gradient_booster:z.object({model:z.object({gbtree_model_param:z.object({num_trees:z.string().regex(/^\d+$/)})})})})}).parse(model);
    if(report.dataset_sha256!==reproduction.dataset_metadata.outputCsvSha256||report.model.variant!==report.selection.selected)throw new Error('Procedencia o selección inconsistente');
    if(Number(modelShape.learner.gradient_booster.model.gbtree_model_param.num_trees)!==report.model.n_estimators*3)throw new Error('Número de árboles inconsistente');
    const stamp=/^(\d{8})T(\d{6})Z-([a-f0-9]{12})$/.exec(basename(directory));
    if(!stamp||stamp[3]!==report.dataset_sha256.slice(0,12))throw new Error('Identidad de experimento inconsistente');
    const createdAtUtc=`${stamp[1]!.slice(0,4)}-${stamp[1]!.slice(4,6)}-${stamp[1]!.slice(6,8)}T${stamp[2]!.slice(0,2)}:${stamp[2]!.slice(2,4)}:${stamp[2]!.slice(4,6)}.000Z`;
    if(!Number.isFinite(Date.parse(createdAtUtc))||new Date(createdAtUtc).toISOString()!==createdAtUtc)throw new Error('Fecha de artefacto inválida');
    const modelVersion=`XGBoost ${modelShape.version.join('.')} · nvda-15m-v1`;
    const parsedPredictions=parsePredictions(files['exploratory_predictions.csv'],modelVersion);
    const recalculated=recalculatedMetrics(parsedPredictions);
    assertMetricMatch(report.xgboost,recalculated,'evaluación exploratoria completa');
    for(const year of ['2025','2026'] as const){
      const observations=parsedPredictions.filter(({prediction})=>prediction.sessionDateNy.startsWith(year));
      const reported=report.exploratory_by_year[year];
      if(!observations.length){
        if(reported)throw new Error(`Métrica anual sin observaciones: ${year}`);
        continue;
      }
      if(!reported)throw new Error(`Falta métrica anual para ${year}`);
      assertMetricMatch(reported,recalculatedMetrics(observations),`evaluación exploratoria ${year}`);
    }
    const predictions=parsedPredictions.map(({prediction})=>prediction);
    const support=(m:z.infer<typeof rawMetrics>)=>Object.values(m.per_class).reduce((sum,item)=>sum+item.support,0);
    if(support(report.xgboost)!==predictions.length||support(report.baselines.frecuencia)!==predictions.length)throw new Error('Cobertura inconsistente');
    const experimentId=createHash('sha256').update(files['report.json']).update(files['model.json']).update(files['exploratory_predictions.csv']).update(files['reproduction.json']).digest('hex').slice(0,24);
    const summary=MlSummary.parse({status:'READY',symbol:'NVDA',timeframe:'15m',origin:'HISTORICAL_EXPLORATORY',experimentId,createdAtUtc,modelVersion,selectedVariant:report.selection.selected,trees:report.model.n_estimators,datasetSha256:report.dataset_sha256,predictionCount:predictions.length});
    const metrics=MlMetricsResponse.parse({status:'READY',model:metric(report.xgboost),frequencyBaseline:metric(report.baselines.frecuencia),walkForward:report.walk_forward_folds.map(fold=>({fold:fold.fold,externalSessions:fold.external_sessions.length,standard:metric(fold.models.standard.metrics),classWeighted:metric(fold.models.class_weighted.metrics),regularized:metric(fold.models.regularized.metrics),frequencyBaseline:metric(fold.models.frequency.metrics)})),exploratoryByYear:Object.fromEntries((['2025','2026'] as const).filter(year=>report.exploratory_by_year[year]).map(year=>[year,metric(report.exploratory_by_year[year]!)])),warning});
    return {status:'READY',summary,metrics,predictions,modelSha256:sha(files['model.json'])};
  }catch(error){
    const code=(error as NodeJS.ErrnoException).code;
    if(code==='ENOENT'){
      try{lstatSync(directory);}catch{return unavailable('NO_MODEL','El experimento configurado no existe.');}
      return unavailable('INVALID_ARTIFACT','Faltan artefactos del experimento configurado.');
    }
    if(code==='EACCES'||code==='EPERM'||code==='EIO'||code==='EBUSY')return unavailable('UNAVAILABLE','No se pueden leer los artefactos configurados.');
    return unavailable('INVALID_ARTIFACT','Artefactos del experimento inválidos o inconsistentes.');
  }
}
export function predictionsPage(run:Ready,offset:number,limit:number):MlPredictionsPage{
  const total=run.predictions.length;
  return MlPredictionsPage.parse({status:'READY',items:run.predictions.slice(offset,offset+limit),total,offset,limit,nextOffset:offset+limit<total?offset+limit:null});
}
export {warning as mlWarning};
