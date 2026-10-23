/** Read-only market radar. All indicator values come from the assistant's causal analysis. */
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import type Database from 'better-sqlite3';
import {RadarResponse,type RadarResponse as Response} from '@trading-poc/contracts';
import {analyzeMarketBars,compareMarketAnalyses} from '../assistant/analysis.ts';
import type {MarketSnapshot} from '../assistant/routes.ts';
import type {Evidence} from '../assistant/routes.ts';
import {academyRanges,selectAcademyReference} from '../academy/service.ts';
import {readNews,readNewsAnalyses,verifyNewsAnalyses} from '../news/store.ts';
import type {NewsPaths} from '../news/service.ts';
import {readIexObservations,type IexPrediction,type IexEvaluation} from '../../../../trading_poc_001_bollinger/src/phase38f-iex-observation.ts';
import {PHASE31_FEATURES} from '../../../../trading_poc_001_bollinger/src/phase31-inference.ts';

type Symbol='NVDA'|'QQQ'|'SMH';
type Paths={observationLog:string;frozenDir?:string;news:NewsPaths};
type Deps={snapshot:(symbol:Symbol,now:number)=>MarketSnapshot;quote:(symbol:Symbol,now:number)=>Evidence;sqlite:Database.Database;paths:Paths;clock?:()=>number};
const SYMBOLS:Symbol[]=['NVDA','QQQ','SMH'];
const SHA=/^[a-f0-9]{64}$/;
const emptyMetrics={close:null,sma20:null,sma40:null,sma100:null,sma200:null,bollingerUpper:null,bollingerMiddle:null,bollingerLower:null,
  relativeVolume20:null,return15mPercent:null,return60mPercent:null};
const unavailablePrediction=(status:'UNAVAILABLE'|'INVALID_LEDGER'|'MODELO_NO_DISPONIBLE',reason:string):Response['assets'][number]['prediction']=>
  ({status,modelSha256:null,modelVersion:null,barStartUtc:null,barEndUtc:null,registeredAtUtc:null,entryAtUtc:null,outcomeAtUtc:null,
    source:null,evaluationStatus:null,probabilities:null,reason});
const time=(value:string)=>{const ms=Date.parse(value);if(!Number.isFinite(ms)||new Date(ms).toISOString()!==value)throw new Error('Timestamp inválido');return ms;};

export function radarPrediction(paths:Pick<Paths,'observationLog'|'frozenDir'>,now:number):Response['assets'][number]['prediction']{
  if(!paths.frozenDir)return unavailablePrediction('UNAVAILABLE','Modelo IEX congelado no configurado.');
  if(!existsSync(paths.observationLog))return unavailablePrediction('UNAVAILABLE','No hay predicciones IEX prospectivas registradas.');
  try{
    if(statSync(paths.observationLog).size>32*1024*1024)throw new Error('Límite de lectura');
    if(statSync(join(paths.frozenDir,'model.json')).size>64*1024*1024||statSync(join(paths.frozenDir,'freeze.json')).size>1024*1024)throw new Error('Artefacto demasiado grande');
    const model=readFileSync(join(paths.frozenDir,'model.json'));
    const frozen=JSON.parse(readFileSync(join(paths.frozenDir,'freeze.json'),'utf8')) as Record<string,unknown>;
    const modelSha256=createHash('sha256').update(model).digest('hex');
    if(frozen.schema!=='phase38f-frozen-v1'||frozen.feed!=='iex'||frozen.adjustment!=='raw'||frozen.modelSha256!==modelSha256||
      JSON.stringify(frozen.features)!==JSON.stringify(PHASE31_FEATURES)||JSON.stringify(frozen.classes)!==JSON.stringify(['ALCISTA','BAJISTA','LATERAL']))throw new Error('Modelo incompatible');
    const rows=readIexObservations(paths.observationLog);
    if(rows.some(row=>row.kind!=='PREDICTION'&&row.kind!=='EVALUATION'))throw new Error('Tipo de registro inválido');
    const predictions=rows.filter((row):row is IexPrediction=>row.kind==='PREDICTION');
    if(new Set(predictions.map(row=>row.id)).size!==predictions.length)throw new Error('Predicción duplicada');
    for(const row of predictions){
      const p=row.probabilities.xgboost;
      if(row.mode!=='IEX_PROSPECTIVE_OBSERVATION'||row.source.symbol!=='NVDA'||row.source.feed!=='iex'||row.source.adjustment!=='raw'||row.source.timeframe!=='15m'||
        !SHA.test(row.modelSha256)||(['xgboost','frequency','linear'] as const).some(name=>{
          const values=row.probabilities[name];return !Array.isArray(values)||values.length!==3||values.some(v=>!Number.isFinite(v)||v<0||v>1)||Math.abs(values.reduce((a,b)=>a+b,0)-1)>1e-6;
        })||
        row.dominantClass!==['ALCISTA','BAJISTA','LATERAL'][p.indexOf(Math.max(...p))]||time(row.registeredAtUtc)>=time(row.outcomeAtUtc)||
        time(row.modelCutoffUtc)>=time(row.barStartUtc)||time(row.modelFrozenAtUtc)>=time(row.barStartUtc)||
        time(row.barEndUtc)-time(row.barStartUtc)!==15*60_000||time(row.entryAtUtc)<=time(row.barEndUtc)||time(row.outcomeAtUtc)<=time(row.entryAtUtc)||
        !row.recordedBeforeOutcome||time(row.receivedAtUtc)>time(row.registeredAtUtc)||time(row.barEndUtc)>time(row.receivedAtUtc)||
        !row.sourceBars.length||row.sourceBars.at(-1)?.startUtc!==row.barStartUtc||
        row.sourceBars.some(source=>time(source.receivedAtUtc)>time(row.registeredAtUtc)||time(source.startUtc)>time(row.barStartUtc)))throw new Error('Predicción inválida');
    }
    const matching=predictions.filter(row=>row.modelSha256===modelSha256).sort((a,b)=>a.registeredAtUtc.localeCompare(b.registeredAtUtc));
    if(!matching.length)return unavailablePrediction('UNAVAILABLE','No hay observaciones registradas para el modelo configurado.');
    const latest=matching.at(-1)!;
    if(time(latest.registeredAtUtc)>now||latest.modelFrozenAtUtc!==frozen.frozenAtUtc||latest.modelCutoffUtc!==frozen.cutoffUtc)throw new Error('Predicción futura o modelo distinto');
    const evaluations=rows.filter((row):row is IexEvaluation=>row.kind==='EVALUATION'&&row.predictionId===latest.id);
    if(evaluations.length>1)throw new Error('Evaluaciones duplicadas');
    const evaluation=evaluations[0];
    if(evaluation&&(!['EVALUATED','MISSING_ENTRY','MISSING_OUTCOME'].includes(evaluation.status)||time(evaluation.evaluatedAtUtc)<time(latest.outcomeAtUtc)))throw new Error('Evaluación inválida');
    const status=evaluation?'HISTORICAL':now<time(latest.outcomeAtUtc)&&now-time(latest.registeredAtUtc)<=15*60_000?'CURRENT':'STALE';
    const [ALCISTA,BAJISTA,LATERAL]=latest.probabilities.xgboost;
    return {status,modelSha256,modelVersion:'phase38f-frozen-v1',barStartUtc:latest.barStartUtc,barEndUtc:latest.barEndUtc,
      registeredAtUtc:latest.registeredAtUtc,entryAtUtc:latest.entryAtUtc,outcomeAtUtc:latest.outcomeAtUtc,source:'IEX Live',
      evaluationStatus:evaluation?.status??'PENDING',probabilities:{ALCISTA:ALCISTA!,BAJISTA:BAJISTA!,LATERAL:LATERAL!},
      reason:status==='CURRENT'?'Observación experimental registrada antes del desenlace; probabilidades no calibradas.':
        status==='HISTORICAL'?'Observación ya evaluada; no es una predicción vigente.':'Registro pendiente pero obsoleto; no es una señal actual.'};
  }catch{return unavailablePrediction('INVALID_LEDGER','No se pudo verificar la integridad del modelo o del registro IEX.');}
}

function radarNews(paths:NewsPaths,symbol:Symbol,now:number):Response['assets'][number]['news']{
  try{
    const articles=readNews(paths.newsLog),analyses=readNewsAnalyses(paths.analysisLog);verifyNewsAnalyses(articles,analyses);
    const known=new Map(articles.map(item=>[item.recordHash,item]));
    const applicable=analyses.filter(item=>item.classification.assets.includes(symbol)&&time(item.analyzedAtUtc)<=now&&
      known.has(item.newsRecordHash)&&time(known.get(item.newsRecordHash)!.firstSeenAtUtc)<=now).sort((a,b)=>a.analyzedAtUtc.localeCompare(b.analyzedAtUtc));
    const last=applicable.at(-1),article=last&&known.get(last.newsRecordHash);
    return {status:applicable.length?'AVAILABLE':'NO_NEWS',count:applicable.length,lastSeenAtUtc:article?.firstSeenAtUtc??null,
      summary:last?`${article!.source}: clasificación ${last.classification.sentiment}, relevancia ${last.classification.relevance}; recibida ${article!.firstSeenAtUtc}, clasificada ${last.analyzedAtUtc}. No implica causalidad ni señal.`:'Sin noticias clasificadas disponibles para este activo.'};
  }catch{return {status:'INVALID_LEDGER',count:0,lastSeenAtUtc:null,summary:'Registro de noticias no verificable.'};}
}

function trend(m:Response['assets'][number]['metrics']):{value:Response['assets'][number]['trend'];reasons:string[]}{
  if(m.close===null||m.sma20===null||m.sma40===null||m.return15mPercent===null||m.return60mPercent===null)
    return {value:'INDETERMINADA',reasons:['Faltan SMA 20/40 o retornos continuos de 15/60 minutos.']};
  if(m.close>m.sma20&&m.sma20>m.sma40&&m.return15mPercent>0&&m.return60mPercent>0)
    return {value:'ALCISTA',reasons:['Cierre > SMA 20 > SMA 40 y retornos de 15 y 60 minutos positivos.']};
  if(m.close<m.sma20&&m.sma20<m.sma40&&m.return15mPercent<0&&m.return60mPercent<0)
    return {value:'BAJISTA',reasons:['Cierre < SMA 20 < SMA 40 y retornos de 15 y 60 minutos negativos.']};
  if(m.close===m.sma20&&m.sma20===m.sma40&&m.return15mPercent===0&&m.return60mPercent===0)
    return {value:'LATERAL',reasons:['Cierre igual a SMA 20 y SMA 40; retornos de ambos horizontes nulos.']};
  return {value:'INDETERMINADA',reasons:['Medias y retornos no confirman una misma dirección; lectura mixta.']};
}

export function buildRadar(deps:Deps,symbols:readonly Symbol[]=SYMBOLS,right?:'CALL'|'PUT'):Response{
  const now=(deps.clock??Date.now)(),snapshots=symbols.map(symbol=>deps.snapshot(symbol,now));
  const prediction=radarPrediction(deps.paths,now);
  const assets=snapshots.map(snapshot=>{
    const {analysis}=snapshot,m=analysis.metrics;
    const metrics=m?{close:m.close,sma20:m.sma20,sma40:m.sma40,sma100:m.sma100,sma200:m.sma200,
      bollingerUpper:m.bollingerUpper,bollingerMiddle:m.bollingerMiddle,bollingerLower:m.bollingerLower,
      relativeVolume20:m.relativeVolume20,return15mPercent:m.returnOneBarPercent,return60mPercent:m.returnFourBarsPercent}:emptyMetrics;
    const observed=analysis.dateUtc?time(analysis.dateUtc):null,ageMinutes=observed===null?null:Math.max(0,(now-observed)/60_000);
    const stale=ageMinutes!==null&&ageMinutes>30;
    const risks=[...analysis.limitations];
    if(stale)risks.push('El cierre tiene más de 30 minutos; no describe necesariamente el mercado actual.');
    if(snapshot.dataType==='SYNTHETIC')risks.push('Datos sintéticos: solo demostración.');
    const t=trend(metrics);
    const q=deps.quote(snapshot.symbol,now),v=q.values;
    const num=(item:unknown)=>typeof item==='number'&&Number.isFinite(item)&&item>0?item:null;
    const stamp=(item:unknown)=>typeof item==='string'&&Number.isFinite(Date.parse(item))?item:null;
    const quote={source:q.source,feedType:q.dataType==='LIVE'||q.dataType==='DELAYED'||q.dataType==='FROZEN'||q.dataType==='DELAYED_FROZEN'||q.dataType==='SYNTHETIC'?q.dataType:'UNKNOWN',
      availability:q.availability==='AVAILABLE'||q.availability==='STALE'?q.availability:'UNAVAILABLE',marketTimestampUtc:stamp(v.marketTimestampUtc),receivedAtUtc:stamp(v.receivedAtUtc),
      last:num(v.last),bid:num(v.bid),ask:num(v.ask)};
    const reference=right?selectAcademyReference(academyRanges(deps.sqlite,snapshot.symbol),new Date(now).toISOString().slice(0,10),right):null;
    const r=reference?.range;
    return {symbol:snapshot.symbol,source:snapshot.source,feed:snapshot.dataType==='SYNTHETIC'?'DEMO':snapshot.source.includes('SIP')?'SIP':'NO_VERIFICADO',
      dataType:snapshot.dataType,availability:analysis.availability==='UNAVAILABLE'?'UNAVAILABLE':stale?'STALE':analysis.availability,
      timestampUtc:analysis.dateUtc,ageMinutes,quote,trend:t.value,reasons:t.reasons,risks,metrics,
      prediction:snapshot.symbol==='NVDA'?prediction:unavailablePrediction('MODELO_NO_DISPONIBLE','No existe modelo propio para este activo.'),
      news:radarNews(deps.paths.news,snapshot.symbol,now),
      academy:reference?{status:reference.status,right,referenceDate:r?.referenceDate??null,validFrom:r?.validFrom??null,validTo:r?.validTo??null,
        minAskCents:r?.minAskCents??null,maxAskCents:r?.maxAskCents??null,outerMinCents:r?.outerMinCents??null,outerMaxCents:r?.outerMaxCents??null,
        liveAskCents:null,reason:`${reference.reason}. ASK actual N/D: no se seleccionó ni verificó una cotización LIVE de contrato. Referencia documental, no recomendación.`}:null};
  });
  let comparison:Response['comparison']={timestampUtc:null,source:null,items:[],reason:'Se requieren al menos dos activos con fuente y timestamp comparables.'};
  if(snapshots.length>=2&&snapshots.every(s=>s.source===snapshots[0]!.source&&s.dataType===snapshots[0]!.dataType)){
    const first=new Set(snapshots[0]!.bars.filter(b=>b.isComplete).map(b=>b.endUtc));
    const common=[...first].filter(t=>snapshots.slice(1).every(s=>s.bars.some(b=>b.isComplete&&b.endUtc===t))).sort().at(-1);
    if(common){
      const aligned=snapshots.map(s=>analyzeMarketBars(s.symbol,s.source,s.dataType,s.bars,common,s.calendar));
      const available=aligned.every(a=>a.dateUtc===common&&a.metrics?.returnOneBarPercent!==null&&a.metrics?.returnFourBarsPercent!==null);
      comparison={timestampUtc:common,source:snapshots[0]!.source,items:available?aligned.map(a=>`${a.asset}: retorno 15 min ${a.metrics!.returnOneBarPercent!.toFixed(2)}%; 60 min ${a.metrics!.returnFourBarsPercent!.toFixed(2)}%.`):[],
        reason:available?'Retornos descriptivos del mismo corte UTC y la misma fuente; no predicen movimientos futuros.':'Faltan ventanas continuas equivalentes para comparar fortaleza relativa.'};
      if(available&&aligned.length===2)comparison.items.push(...compareMarketAnalyses(aligned[0]!,aligned[1]!).items.slice(-1));
    }
  }
  return RadarResponse.parse({asOfUtc:new Date(now).toISOString(),assets,comparison,
    note:'Radar descriptivo de solo lectura. Histórico, retraso y DEMO no equivalen a cotización LIVE. Probabilidades IEX experimentales no calibradas; no son recomendación de opciones.'});
}
