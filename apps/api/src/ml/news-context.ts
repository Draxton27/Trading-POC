import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,renameSync,statSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {MlNewsContextSummary} from '@trading-poc/contracts';
import {readForwardObservations,type ForwardObservation} from '../../../../trading_poc_001_bollinger/src/phase34-forward-observation.ts';
import {readEvaluations,type EvaluationRecord} from '../../../../trading_poc_001_bollinger/src/phase35-evaluation.ts';
import {readNews,readNewsAnalyses,verifyNewsAnalyses,type NewsRecord,type NewsAnalysis} from '../news/store.ts';
import {readNewsStatus,type NewsStatus} from '../news/service.ts';
import {newYorkBarParts} from '../../../../trading_poc_001_bollinger/src/strategy-validation.ts';

const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
export const DEFAULT_NEWS_WINDOWS=[30,60,240] as const;
export function parseNewsWindows(raw:string|undefined):number[]{
  if(!raw)return [...DEFAULT_NEWS_WINDOWS];
  const values=raw.split(',').map(part=>Number(part.trim()));
  if(values.length!==3||values.some((value,index)=>!Number.isSafeInteger(value)||value<1||value>1440||index>0&&value<=values[index-1]!))throw new Error('TRADING_POC_ML_NEWS_WINDOWS_MINUTES requiere tres minutos enteros ascendentes entre 1 y 1440.');
  return values;
}
const CLASSES=['ALCISTA','BAJISTA','LATERAL'] as const;
const MAX_BYTES=64*1024*1024;
type ClassName=typeof CLASSES[number];
type UsableNews={articleId:string;newsRecordHash:string;analysisRecordHash:string;providerId:string;firstSeenAtUtc:string;receivedAtUtc:string;analyzedAtUtc:string;publishedAtUtc:string|null;ageMinutes:number;sentiment:NewsAnalysis['classification']['sentiment'];relevance:NewsAnalysis['classification']['relevance'];category:NewsAnalysis['classification']['category'];assets:NewsAnalysis['classification']['assets'];classifierVersion:string;insufficientEvidence:boolean};
export type CoverageStatus='AVAILABLE'|'AVAILABLE_WITH_PENDING'|'PENDING_CLASSIFICATION'|'NO_NEWS'|'PROVIDER_ERROR';
export type ContextRow={predictionId:string;modelSha256:string;modelId:string;modelCreatedAtUtc:string;barStartUtc:string;sessionDateNy:string;registeredAtUtc:string;outcomeCloseAtUtc:string;probabilities:ForwardObservation['prediction'];actualClass:ClassName|null;evaluationRecordHash:string|null;news:UsableNews[];coverageStatus:CoverageStatus;pendingClassifications:number;lateReceived:number;lateClassified:number;countsByWindow:Record<string,number>};
export type NewsContextPaths={observationLog:string;evaluationLog:string;newsLog:string;analysisLog:string;newsStatusPath?:string;outputDir:string;modelSha256:string;windowsMinutes?:number[]};

/** Only these fields are admissible as inputs to a future out-of-sample comparator. */
export function availableNewsContext(row:ContextRow){return {predictionId:row.predictionId,modelSha256:row.modelSha256,registeredAtUtc:row.registeredAtUtc,probabilities:row.probabilities,news:row.news,coverageStatus:row.coverageStatus,pendingClassifications:row.pendingClassifications,countsByWindow:row.countsByWindow};}

function readBounded<T>(path:string,reader:(path:string)=>T):T{
  if(existsSync(path)&&statSync(path).size>MAX_BYTES)throw new Error('Ledger privado demasiado grande.');
  return reader(path);
}
function assertObservation(row:ForwardObservation,modelSha256:string){
  const values=CLASSES.map(name=>row.prediction[name]);
  const start=Date.parse(row.bar.startUtc),end=Date.parse(row.bar.endUtc),registered=Date.parse(row.registeredAtUtc),outcome=Date.parse(row.outcomeCloseAtUtc);
  if(!Number.isFinite(start)||!Number.isFinite(registered)||end!==start+15*60_000||outcome!==start+75*60_000||Date.parse(row.bar.receivedAtUtc)>registered||newYorkBarParts(row.bar.startUtc).day!==row.bar.sessionDateNy)throw new Error('Horizonte o sesión de observación incompatibles.');
  if(row.model.sha256!==modelSha256||row.mode!=='DELAYED_FORWARD_OBSERVATION'||row.source.feed!=='sip'||row.source.adjustment!=='split'||row.source.availability!=='DELAYED'||!row.recordedBeforeOutcome||Date.parse(row.registeredAtUtc)>=Date.parse(row.outcomeCloseAtUtc)||values.some(value=>!Number.isFinite(value)||value<0||value>1)||Math.abs(values.reduce((a,b)=>a+b,0)-1)>1e-6)throw new Error('Observación incompatible con el modelo o la causalidad.');
}
/** Each article is represented by its most recent classified revision already available at prediction registration. */
export function joinNewsContext(observations:readonly ForwardObservation[],evaluations:readonly EvaluationRecord[],news:readonly NewsRecord[],analyses:readonly NewsAnalysis[],modelSha256:string,windowsMinutes:readonly number[]=DEFAULT_NEWS_WINDOWS,providerStatus:NewsStatus|null=null):ContextRow[]{
  const windows=parseNewsWindows(windowsMinutes.join(',')),maxWindow=windows.at(-1)!;
  verifyNewsAnalyses([...news],[...analyses]);
  const newsByHash=new Map(news.map(row=>[row.recordHash,row]));
  const originals=new Map<string,EvaluationRecord>();
  for(const row of evaluations){if(row.modelSha256!==modelSha256)throw new Error('Evaluación de otro modelo.');if(row.kind==='EVALUATED'){if(originals.has(row.predictionId))throw new Error('Evaluación original duplicada.');originals.set(row.predictionId,row);}}
  const ids=new Set<string>();
  const rows=[...observations].sort((a,b)=>a.registeredAtUtc.localeCompare(b.registeredAtUtc)||a.recordId.localeCompare(b.recordId)).map(observation=>{
    assertObservation(observation,modelSha256);if(ids.has(observation.recordId))throw new Error('Observación duplicada.');ids.add(observation.recordId);
    const cutoff=Date.parse(observation.registeredAtUtc),selected=new Map<string,{news:NewsRecord;analysis:NewsAnalysis}>(),classifiedAtCutoff=new Set<string>();
    const latestAtCutoff=new Map<string,NewsRecord>();
    for(const item of news)if(Date.parse(item.firstSeenAtUtc)<=cutoff&&Date.parse(item.receivedAtUtc)<=cutoff){
      const prior=latestAtCutoff.get(item.articleId);if(!prior||item.revision>prior.revision)latestAtCutoff.set(item.articleId,item);
    }
    for(const analysis of analyses){
      const item=newsByHash.get(analysis.newsRecordHash)!;
      if(latestAtCutoff.get(item.articleId)?.recordHash!==item.recordHash||Date.parse(analysis.analyzedAtUtc)<Date.parse(item.receivedAtUtc)||Date.parse(analysis.analyzedAtUtc)>cutoff)continue;
      classifiedAtCutoff.add(item.articleId);
      // Only explicit NVDA relevance or macroeconomic context; no post-hoc symbol expansion.
      if(!analysis.classification.assets.includes('NVDA')&&analysis.classification.category!=='MACROECONOMIA')continue;
      const previous=selected.get(item.articleId);
      if(!previous||analysis.analyzedAtUtc>previous.analysis.analyzedAtUtc)selected.set(item.articleId,{news:item,analysis});
    }
    const eligible=[...selected.values()].map(({news:item,analysis}):UsableNews=>({articleId:item.articleId,newsRecordHash:item.recordHash,analysisRecordHash:analysis.recordHash,providerId:item.providerId,firstSeenAtUtc:item.firstSeenAtUtc,receivedAtUtc:item.receivedAtUtc,analyzedAtUtc:analysis.analyzedAtUtc,publishedAtUtc:item.publishedAtUtc,ageMinutes:(cutoff-Date.parse(item.receivedAtUtc))/60_000,sentiment:analysis.classification.sentiment,relevance:analysis.classification.relevance,category:analysis.classification.category,assets:analysis.classification.assets,classifierVersion:analysis.modelVersion,insufficientEvidence:analysis.classification.insufficientEvidence})).filter(item=>item.ageMinutes>=0&&item.ageMinutes<=maxWindow).sort((a,b)=>a.articleId.localeCompare(b.articleId));
    const recent=[...latestAtCutoff.values()].filter(item=>cutoff-Date.parse(item.receivedAtUtc)<=maxWindow*60_000);
    const pendingClassifications=recent.filter(item=>!classifiedAtCutoff.has(item.articleId)).length;
    const lateReceived=new Set(news.filter(item=>item.publishedAtUtc&&Date.parse(item.publishedAtUtc)<=cutoff&&Date.parse(item.receivedAtUtc)>cutoff&&Date.parse(item.receivedAtUtc)<=cutoff+maxWindow*60_000).map(item=>item.articleId)).size;
    const lateClassified=recent.filter(item=>analyses.some(analysis=>analysis.newsRecordHash===item.recordHash&&Date.parse(analysis.analyzedAtUtc)>cutoff)).length;
    const providerError=providerStatus&&Date.parse(providerStatus.atUtc)<=cutoff&&providerStatus.state!=='OK'&&providerStatus.errorCode!==null;
    const coverageStatus:CoverageStatus=eligible.length?pendingClassifications?'AVAILABLE_WITH_PENDING':'AVAILABLE':pendingClassifications?'PENDING_CLASSIFICATION':providerError?'PROVIDER_ERROR':'NO_NEWS';
    const evaluation=originals.get(observation.recordId);
    if(evaluation&&(evaluation.barStartUtc!==observation.bar.startUtc||evaluation.sessionDateNy!==observation.bar.sessionDateNy||evaluation.probabilities.ALCISTA!==observation.prediction.ALCISTA||evaluation.probabilities.BAJISTA!==observation.prediction.BAJISTA||evaluation.probabilities.LATERAL!==observation.prediction.LATERAL))throw new Error('Evaluación no coincide con predicción original.');
    return {predictionId:observation.recordId,modelSha256,modelId:observation.model.id,modelCreatedAtUtc:observation.model.createdAtUtc,barStartUtc:observation.bar.startUtc,sessionDateNy:observation.bar.sessionDateNy,registeredAtUtc:observation.registeredAtUtc,outcomeCloseAtUtc:observation.outcomeCloseAtUtc,probabilities:observation.prediction,actualClass:evaluation?.status==='VERIFIED'?evaluation.actualClass:null,evaluationRecordHash:evaluation?.status==='VERIFIED'?evaluation.recordHash:null,news:eligible,coverageStatus,pendingClassifications,lateReceived,lateClassified,countsByWindow:Object.fromEntries(windows.map(minutes=>[String(minutes),eligible.filter(item=>item.ageMinutes<=minutes).length]))};
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
  const matrix=CLASSES.map(actual=>CLASSES.map(predicted=>rows.filter(row=>row.actualClass===actual&&row.probabilities.dominantClass===predicted).length));
  const perClass=Object.fromEntries(CLASSES.map((name,i)=>{const tp=matrix[i]![i]!,support=matrix[i]!.reduce((a,b)=>a+b,0),predicted=matrix.reduce((sum,line)=>sum+line[i]!,0),precision=predicted?tp/predicted:0,recall=support?tp/support:0;return [name,{support,precision,recall,f1:precision+recall?2*precision*recall/(precision+recall):0}];})) as Record<ClassName,{support:number;precision:number;recall:number;f1:number}>;
  const calibration=Object.fromEntries(CLASSES.map(name=>[name,Array.from({length:5},(_,bin)=>{const subset=rows.filter(row=>Math.min(4,Math.floor(row.probabilities[name]*5))===bin);return {n:subset.length,meanProbability:subset.length?subset.reduce((sum,row)=>sum+row.probabilities[name],0)/subset.length:null,observedFrequency:subset.length?subset.filter(row=>row.actualClass===name).length/subset.length:null};})])) as Record<ClassName,Array<{n:number;meanProbability:number|null;observedFrequency:number|null}>>;
  return {n:rows.length,sessions:new Set(rows.map(row=>row.sessionDateNy)).size,accuracy:correct/rows.length,balancedAccuracy:CLASSES.reduce((sum,name)=>sum+perClass[name].recall,0)/3,macroF1:CLASSES.reduce((sum,name)=>sum+perClass[name].f1,0)/3,logLoss:loss,brier:rows.reduce((sum,row)=>sum+CLASSES.reduce((subtotal,name)=>subtotal+(row.probabilities[name]-(row.actualClass===name?1:0))**2,0),0)/rows.length,perClass,calibration,meanResidual};
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
export function summarizeNewsContext(rows:readonly ContextRow[],modelSha256:string,windowsMinutes:readonly number[]=DEFAULT_NEWS_WINDOWS){
  const windows=parseNewsWindows(windowsMinutes.join(',')),sessions=[...new Set(rows.map(row=>row.sessionDateNy))].sort(),cut=Math.floor(sessions.length*.7),development=new Set(sessions.slice(0,cut));
  const scored=rows.filter((row):row is Scored=>row.actualClass!==null);
  const group=(subset:readonly ContextRow[])=>{
    const valid=subset.filter((row):row is Scored=>row.actualClass!==null),covered=valid.filter(row=>row.news.length>0),uncovered=valid.filter(row=>row.news.length===0);
    const categories=['sentiment','relevance','category'] as const;
    const byDimension=Object.fromEntries(categories.map(key=>[key,Object.fromEntries([...new Set(valid.flatMap(row=>row.news.filter(news=>!news.insufficientEvidence).map(news=>news[key])))].sort().map(value=>[value,metric(valid.filter(row=>row.news.some(news=>!news.insufficientEvidence&&news[key]===value)))]))]));
    const direction=(row:ContextRow)=>{const values=[...new Set(row.news.filter(item=>!item.insufficientEvidence&&['POSITIVO','NEGATIVO'].includes(item.sentiment)).map(item=>item.sentiment))];if(values.length!==1||row.probabilities.dominantClass==='LATERAL')return null;return values[0]===(row.probabilities.dominantClass==='ALCISTA'?'POSITIVO':'NEGATIVO')?'CONCORDANTE':'CONTRADICTORIO';};
    byDimension.concordance=Object.fromEntries(['CONCORDANTE','CONTRADICTORIO'].map(value=>[value,metric(valid.filter(row=>direction(row)===value))]));
    const bySession=Object.fromEntries([...new Set(valid.map(row=>row.sessionDateNy))].sort().map(day=>[day,metric(valid.filter(row=>row.sessionDateNy===day))]));
    return {observations:subset.length,evaluated:valid.length,sessions:new Set(subset.map(row=>row.sessionDateNy)).size,withNews:subset.filter(row=>row.news.length>0).length,pendingClassifications:subset.reduce((sum,row)=>sum+row.pendingClassifications,0),lateReceived:subset.reduce((sum,row)=>sum+row.lateReceived,0),lateClassified:subset.reduce((sum,row)=>sum+row.lateClassified,0),providerErrors:subset.filter(row=>row.coverageStatus==='PROVIDER_ERROR').length,baseline:metric(valid),withNewsMetrics:metric(covered),withoutNewsMetrics:metric(uncovered),windows:Object.fromEntries(windows.map(minutes=>[String(minutes),{observations:subset.filter(row=>(row.countsByWindow[String(minutes)]??0)>0).length,baseline:metric(valid.filter(row=>(row.countsByWindow[String(minutes)]??0)>0))}])),byDimension,bySession,accuracyDifferenceCoveredMinusUncovered:covered.length&&uncovered.length?metric(covered)!.accuracy-metric(uncovered)!.accuracy:null,sessionBootstrap95:interval(valid,row=>row.news.length>0)};
  };
  const developmentGroup=group(rows.filter(row=>development.has(row.sessionDateNy))),laterGroup=group(rows.filter(row=>!development.has(row.sessionDateNy)));
  const evidenceState=scored.length<30||sessions.length<10||rows.filter(row=>row.news.length>0).length<10||laterGroup.sessionBootstrap95===null?'INSUFFICIENT_EVIDENCE':'DESCRIPTIVE_ONLY';
  return MlNewsContextSummary.parse({schema:'phase37-news-context-v1',status:'READY',symbol:'NVDA',timeframe:'15m',modelSha256,windowsMinutes:windows,evidenceState,observations:rows.length,evaluated:scored.length,withNews:rows.filter(row=>row.news.length>0).length,sessions:sessions.length,development:developmentGroup,laterExploratory:laterGroup,warning:'Asociaciones descriptivas, no efecto causal demostrado. Sin pronóstico alternativo ni probabilidades calibradas. La separación 70/30 por sesiones no constituye evaluación independiente del proyecto.'});
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
  const windows=parseNewsWindows(paths.windowsMinutes?.join(',')),providerStatus=paths.newsStatusPath?readNewsStatus(paths.newsStatusPath):null;
  const rows=joinNewsContext(observations,evaluations,news,analyses,paths.modelSha256,windows,providerStatus);
  const summary=summarizeNewsContext(rows,paths.modelSha256,windows);
  const columns=['predictionId','modelId','modelSha256','modelCreatedAtUtc','barStartUtc','sessionDateNy','registeredAtUtc','outcomeCloseAtUtc','ALCISTA','BAJISTA','LATERAL','dominantClass','actualClass','evaluationRecordHash','coverageStatus','pendingClassifications','auditLateReceived','auditLateClassified',...windows.map(minutes=>`newsCount${minutes}`),'newsEvidenceJson'];
  const csv=[columns.join(','),...rows.map(row=>[row.predictionId,row.modelId,row.modelSha256,row.modelCreatedAtUtc,row.barStartUtc,row.sessionDateNy,row.registeredAtUtc,row.outcomeCloseAtUtc,row.probabilities.ALCISTA,row.probabilities.BAJISTA,row.probabilities.LATERAL,row.probabilities.dominantClass,row.actualClass,row.evaluationRecordHash,row.coverageStatus,row.pendingClassifications,row.lateReceived,row.lateClassified,...windows.map(minutes=>row.countsByWindow[String(minutes)]),JSON.stringify(row.news)].map(csvCell).join(','))].join('\n')+'\n';
  const inputHashes=Object.fromEntries([['observations',paths.observationLog],['evaluations',paths.evaluationLog],['news',paths.newsLog],['analyses',paths.analysisLog],['newsStatus',paths.newsStatusPath]].map(([key,path])=>[key,path&&existsSync(path)?sha(readFileSync(path,'utf8')):null]));
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
