import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,renameSync,statSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {MlNewsContextSummary} from '@trading-poc/contracts';
import {readForwardObservations,type ForwardObservation} from '../../../../trading_poc_001_bollinger/src/phase34-forward-observation.ts';
import {readEvaluations,type EvaluationRecord} from '../../../../trading_poc_001_bollinger/src/phase35-evaluation.ts';
import {readNews,readNewsAnalyses,verifyNewsAnalyses,type NewsRecord,type NewsAnalysis} from '../news/store.ts';

const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const WINDOWS=[60,180,390] as const;
const CLASSES=['ALCISTA','BAJISTA','LATERAL'] as const;
const MAX_BYTES=64*1024*1024;
type ClassName=typeof CLASSES[number];
type UsableNews={articleId:string;newsRecordHash:string;analysisRecordHash:string;providerId:string;firstSeenAtUtc:string;receivedAtUtc:string;analyzedAtUtc:string;publishedAtUtc:string|null;sentiment:NewsAnalysis['classification']['sentiment'];relevance:NewsAnalysis['classification']['relevance'];category:NewsAnalysis['classification']['category'];insufficientEvidence:boolean};
export type ContextRow={predictionId:string;modelSha256:string;barStartUtc:string;sessionDateNy:string;registeredAtUtc:string;outcomeCloseAtUtc:string;probabilities:ForwardObservation['prediction'];actualClass:ClassName|null;evaluationRecordHash:string|null;news:UsableNews[];countsByWindow:Record<'60'|'180'|'390',number>};
export type NewsContextPaths={observationLog:string;evaluationLog:string;newsLog:string;analysisLog:string;outputDir:string;modelSha256:string};

function readBounded<T>(path:string,reader:(path:string)=>T):T{
  if(existsSync(path)&&statSync(path).size>MAX_BYTES)throw new Error('Ledger privado demasiado grande.');
  return reader(path);
}
function assertObservation(row:ForwardObservation,modelSha256:string){
  const values=CLASSES.map(name=>row.prediction[name]);
  if(row.model.sha256!==modelSha256||row.mode!=='DELAYED_FORWARD_OBSERVATION'||row.source.feed!=='sip'||row.source.adjustment!=='split'||row.source.availability!=='DELAYED'||!row.recordedBeforeOutcome||Date.parse(row.registeredAtUtc)>=Date.parse(row.outcomeCloseAtUtc)||values.some(value=>!Number.isFinite(value)||value<0||value>1)||Math.abs(values.reduce((a,b)=>a+b,0)-1)>1e-6)throw new Error('Observación incompatible con el modelo o la causalidad.');
}
/** Each article is represented by its most recent classified revision already available at prediction registration. */
export function joinNewsContext(observations:readonly ForwardObservation[],evaluations:readonly EvaluationRecord[],news:readonly NewsRecord[],analyses:readonly NewsAnalysis[],modelSha256:string):ContextRow[]{
  verifyNewsAnalyses([...news],[...analyses]);
  const newsByHash=new Map(news.map(row=>[row.recordHash,row]));
  const originals=new Map<string,EvaluationRecord>();
  for(const row of evaluations){if(row.modelSha256!==modelSha256)throw new Error('Evaluación de otro modelo.');if(row.kind==='EVALUATED'){if(originals.has(row.predictionId))throw new Error('Evaluación original duplicada.');originals.set(row.predictionId,row);}}
  const ids=new Set<string>();
  const rows=[...observations].sort((a,b)=>a.registeredAtUtc.localeCompare(b.registeredAtUtc)||a.recordId.localeCompare(b.recordId)).map(observation=>{
    assertObservation(observation,modelSha256);if(ids.has(observation.recordId))throw new Error('Observación duplicada.');ids.add(observation.recordId);
    const cutoff=Date.parse(observation.registeredAtUtc),selected=new Map<string,{news:NewsRecord;analysis:NewsAnalysis}>();
    const latestAtCutoff=new Map<string,NewsRecord>();
    for(const item of news)if(Date.parse(item.firstSeenAtUtc)<cutoff&&Date.parse(item.receivedAtUtc)<cutoff){
      const prior=latestAtCutoff.get(item.articleId);if(!prior||item.revision>prior.revision)latestAtCutoff.set(item.articleId,item);
    }
    for(const analysis of analyses){
      const item=newsByHash.get(analysis.newsRecordHash)!;
      if(latestAtCutoff.get(item.articleId)?.recordHash!==item.recordHash||Date.parse(analysis.analyzedAtUtc)<Date.parse(item.receivedAtUtc)||Date.parse(analysis.analyzedAtUtc)>=cutoff)continue;
      // Only explicit NVDA relevance or macroeconomic context; no post-hoc symbol expansion.
      if(!analysis.classification.assets.includes('NVDA')&&analysis.classification.category!=='MACROECONOMIA')continue;
      const previous=selected.get(item.articleId);
      if(!previous||analysis.analyzedAtUtc>previous.analysis.analyzedAtUtc)selected.set(item.articleId,{news:item,analysis});
    }
    const eligible=[...selected.values()].map(({news:item,analysis}):UsableNews=>({articleId:item.articleId,newsRecordHash:item.recordHash,analysisRecordHash:analysis.recordHash,providerId:item.providerId,firstSeenAtUtc:item.firstSeenAtUtc,receivedAtUtc:item.receivedAtUtc,analyzedAtUtc:analysis.analyzedAtUtc,publishedAtUtc:item.publishedAtUtc,sentiment:analysis.classification.sentiment,relevance:analysis.classification.relevance,category:analysis.classification.category,insufficientEvidence:analysis.classification.insufficientEvidence})).filter(item=>cutoff-Date.parse(item.receivedAtUtc)<=390*60_000).sort((a,b)=>a.articleId.localeCompare(b.articleId));
    const evaluation=originals.get(observation.recordId);
    if(evaluation&&(evaluation.barStartUtc!==observation.bar.startUtc||evaluation.sessionDateNy!==observation.bar.sessionDateNy||evaluation.probabilities.ALCISTA!==observation.prediction.ALCISTA||evaluation.probabilities.BAJISTA!==observation.prediction.BAJISTA||evaluation.probabilities.LATERAL!==observation.prediction.LATERAL))throw new Error('Evaluación no coincide con predicción original.');
    return {predictionId:observation.recordId,modelSha256,barStartUtc:observation.bar.startUtc,sessionDateNy:observation.bar.sessionDateNy,registeredAtUtc:observation.registeredAtUtc,outcomeCloseAtUtc:observation.outcomeCloseAtUtc,probabilities:observation.prediction,actualClass:evaluation?.status==='VERIFIED'?evaluation.actualClass:null,evaluationRecordHash:evaluation?.status==='VERIFIED'?evaluation.recordHash:null,news:eligible,countsByWindow:{'60':eligible.filter(item=>cutoff-Date.parse(item.receivedAtUtc)<=60*60_000).length,'180':eligible.filter(item=>cutoff-Date.parse(item.receivedAtUtc)<=180*60_000).length,'390':eligible.length}};
  });
  if([...originals.keys()].some(id=>!ids.has(id)))throw new Error('Evaluación sin observación original.');
  return rows;
}
type Scored=ContextRow&{actualClass:ClassName};
function metric(rows:readonly Scored[]){
  if(!rows.length)return null;
  const correct=rows.filter(row=>row.probabilities.dominantClass===row.actualClass).length;
  const loss=rows.reduce((sum,row)=>sum-Math.log(Math.max(row.probabilities[row.actualClass],1e-15)),0)/rows.length;
  const meanResidual=Object.fromEntries(CLASSES.map(name=>[name,rows.reduce((sum,row)=>sum+(row.actualClass===name?1:0)-row.probabilities[name],0)/rows.length])) as Record<ClassName,number>;
  return {n:rows.length,sessions:new Set(rows.map(row=>row.sessionDateNy)).size,accuracy:correct/rows.length,logLoss:loss,meanResidual};
}
function interval(rows:readonly Scored[],hasNews:(row:Scored)=>boolean){
  const sessions=[...new Set(rows.map(row=>row.sessionDateNy))].sort();
  if(rows.length<30||sessions.length<10||rows.filter(hasNews).length<10||rows.filter(row=>!hasNews(row)).length<10)return null;
  const groups=new Map(sessions.map(day=>[day,rows.filter(row=>row.sessionDateNy===day)]));
  let seed=0x3700abcd;const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  const draws:number[]=[];
  for(let i=0;i<500;i++){
    const sample=sessions.flatMap(()=>groups.get(sessions[Math.floor(next()*sessions.length)]!)!);
    const covered=metric(sample.filter(hasNews)),uncovered=metric(sample.filter(row=>!hasNews(row)));
    if(covered&&uncovered)draws.push(covered.accuracy-uncovered.accuracy);
  }
  if(draws.length<475)return null;
  draws.sort((a,b)=>a-b);return [draws[Math.floor(draws.length*.025)]!,draws[Math.floor(draws.length*.975)]!] as const;
}
export function summarizeNewsContext(rows:readonly ContextRow[],modelSha256:string){
  const sessions=[...new Set(rows.map(row=>row.sessionDateNy))].sort(),cut=Math.floor(sessions.length*.7),development=new Set(sessions.slice(0,cut));
  const scored=rows.filter((row):row is Scored=>row.actualClass!==null);
  const group=(subset:readonly ContextRow[])=>{
    const valid=subset.filter((row):row is Scored=>row.actualClass!==null),covered=valid.filter(row=>row.news.length>0),uncovered=valid.filter(row=>row.news.length===0);
    const categories=['sentiment','relevance','category'] as const;
    const byDimension=Object.fromEntries(categories.map(key=>[key,Object.fromEntries([...new Set(valid.flatMap(row=>row.news.filter(news=>!news.insufficientEvidence).map(news=>news[key])))].sort().map(value=>[value,metric(valid.filter(row=>row.news.some(news=>!news.insufficientEvidence&&news[key]===value)))]))]));
    return {observations:subset.length,evaluated:valid.length,sessions:new Set(subset.map(row=>row.sessionDateNy)).size,withNews:subset.filter(row=>row.news.length>0).length,baseline:metric(valid),withNewsMetrics:metric(covered),withoutNewsMetrics:metric(uncovered),windows:Object.fromEntries(WINDOWS.map(minutes=>[String(minutes),{observations:subset.filter(row=>row.countsByWindow[String(minutes) as '60'|'180'|'390']>0).length,baseline:metric(valid.filter(row=>row.countsByWindow[String(minutes) as '60'|'180'|'390']>0))}])),byDimension,accuracyDifferenceCoveredMinusUncovered:covered.length&&uncovered.length?metric(covered)!.accuracy-metric(uncovered)!.accuracy:null,sessionBootstrap95:interval(valid,row=>row.news.length>0)};
  };
  return MlNewsContextSummary.parse({schema:'phase37-news-context-v1',status:'READY',symbol:'NVDA',timeframe:'15m',modelSha256,observations:rows.length,evaluated:scored.length,withNews:rows.filter(row=>row.news.length>0).length,sessions:sessions.length,development:group(rows.filter(row=>development.has(row.sessionDateNy))),laterExploratory:group(rows.filter(row=>!development.has(row.sessionDateNy))),warning:'Asociaciones descriptivas, no efecto causal demostrado. Sin pronóstico alternativo ni probabilidades calibradas. La separación 70/30 por sesiones no constituye evaluación independiente del proyecto.'});
}
function boundedFile(path:string,reader:(path:string)=>unknown){return readBounded(path,reader);}
function csvCell(value:unknown){return `"${String(value??'').replaceAll('"','""')}"`;}
export function buildNewsContext(paths:NewsContextPaths){
  if(!existsSync(paths.observationLog))throw new Error('No existe el ledger de observaciones adelantadas; revise TRADING_POC_ML_FORWARD_OBSERVATION_LOG.');
  const observations=boundedFile(paths.observationLog,readForwardObservations) as ForwardObservation[];
  if(!observations.length)throw new Error('Todavía no hay observaciones adelantadas para construir el dataset.');
  const evaluations=boundedFile(paths.evaluationLog,readEvaluations) as EvaluationRecord[];
  const news=boundedFile(paths.newsLog,readNews) as NewsRecord[];
  const analyses=boundedFile(paths.analysisLog,readNewsAnalyses) as NewsAnalysis[];
  if([observations.length,evaluations.length,news.length,analyses.length].some(size=>size>100_000))throw new Error('Demasiadas filas privadas.');
  const rows=joinNewsContext(observations,evaluations,news,analyses,paths.modelSha256);
  const summary=summarizeNewsContext(rows,paths.modelSha256);
  const columns=['predictionId','modelSha256','barStartUtc','sessionDateNy','registeredAtUtc','outcomeCloseAtUtc','ALCISTA','BAJISTA','LATERAL','dominantClass','actualClass','evaluationRecordHash','newsCount60','newsCount180','newsCount390','newsEvidenceJson'];
  const csv=[columns.join(','),...rows.map(row=>[row.predictionId,row.modelSha256,row.barStartUtc,row.sessionDateNy,row.registeredAtUtc,row.outcomeCloseAtUtc,row.probabilities.ALCISTA,row.probabilities.BAJISTA,row.probabilities.LATERAL,row.probabilities.dominantClass,row.actualClass,row.evaluationRecordHash,row.countsByWindow['60'],row.countsByWindow['180'],row.countsByWindow['390'],JSON.stringify(row.news)].map(csvCell).join(','))].join('\n')+'\n';
  const inputHashes=Object.fromEntries([['observations',paths.observationLog],['evaluations',paths.evaluationLog],['news',paths.newsLog],['analyses',paths.analysisLog]].map(([key,path])=>[key,existsSync(path)?sha(readFileSync(path,'utf8')):null]));
  const summaryJson=JSON.stringify(summary,null,2)+'\n';
  const manifest={schema:'phase37-news-context-manifest-v1',columns,modelSha256:paths.modelSha256,inputSha256:inputHashes,csvSha256:sha(csv),summarySha256:sha(summaryJson),rows:rows.length,policy:'Recepción de la revisión y análisis terminados estrictamente antes de registeredAtUtc; ventanas desde recepción; NVDA explícita o categoría macroeconómica; evaluación original Fase 35.'};
  mkdirSync(paths.outputDir,{recursive:true});
  for(const [name,body] of [['dataset.csv',csv],['summary.json',summaryJson],['manifest.json',JSON.stringify(manifest,null,2)+'\n']] as const){const target=join(paths.outputDir,name),temp=target+'.'+process.pid+'.tmp';writeFileSync(temp,body,{flag:'wx'});renameSync(temp,target);}
  return {summary,manifest};
}
export function readNewsContextSummary(path:string,modelSha256:string|undefined){
  if(!modelSha256)return {status:'NO_MODEL' as const,reason:'Modelo congelado no configurado.'};
  if(!existsSync(path))return {status:'NO_DATA' as const,reason:'Aún no se construyó el dataset de contexto informativo.'};
  try{
    if(statSync(path).size>1024*1024)throw new Error('SIZE');
    const base=dirname(path),manifestPath=join(base,'manifest.json'),csvPath=join(base,'dataset.csv');
    if(!existsSync(manifestPath)||!existsSync(csvPath)||statSync(manifestPath).size>1024*1024||statSync(csvPath).size>MAX_BYTES)throw new Error('MISSING');
    const summaryJson=readFileSync(path,'utf8'),manifest=JSON.parse(readFileSync(manifestPath,'utf8')) as Record<string,unknown>;
    const value=MlNewsContextSummary.parse(JSON.parse(summaryJson) as unknown);
    if(value.modelSha256!==modelSha256||manifest.schema!=='phase37-news-context-manifest-v1'||manifest.modelSha256!==modelSha256||manifest.summarySha256!==sha(summaryJson)||manifest.csvSha256!==sha(readFileSync(csvPath,'utf8'))||manifest.rows!==value.observations)throw new Error('MANIFEST');
    return value;
  }
  catch{return {status:'INVALID_ARTIFACT' as const,reason:'El resumen privado no es válido para el modelo configurado.'};}
}
