import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {appendAnalysis,appendNews,readNews,readNewsAnalyses,type NewsArticle,type NewsRecord} from '../../apps/api/src/news/store.ts';
import {FED_MONETARY} from '../../apps/api/src/news/providers.ts';
import {joinNewsContext,summarizeNewsContext,buildNewsContext,readNewsContextSummary} from '../../apps/api/src/ml/news-context.ts';
import type {ForwardObservation} from '../../trading_poc_001_bollinger/src/phase34-forward-observation.ts';
import type {EvaluationRecord} from '../../trading_poc_001_bollinger/src/phase35-evaluation.ts';
import {createApp} from '../../apps/api/src/server.ts';

const model='a'.repeat(64),cutoff='2026-10-21T15:00:00.000Z';
const dirs:string[]=[];afterEach(()=>dirs.splice(0).forEach(dir=>rmSync(dir,{recursive:true,force:true})));
function fixture(){const dir=mkdtempSync(join(tmpdir(),'phase37-'));dirs.push(dir);return {dir,newsLog:join(dir,'news.jsonl'),analysisLog:join(dir,'analysis.jsonl')};}
function article(description='Política monetaria'):NewsArticle{return {providerId:FED_MONETARY.id,source:FED_MONETARY.name,canonicalUrl:'https://www.federalreserve.gov/newsevents/pressreleases/monetary20261021a.htm',stableId:'fed-context',title:'Comunicado de la Reserva Federal',description,publishedAtUtc:'2026-10-21T12:00:00.000Z',publicationStatus:'KNOWN',updatedAtUtc:null};}
function classify(f:ReturnType<typeof fixture>,record:NewsRecord,at:string){return appendAnalysis(f.analysisLog,{articleId:record.articleId,newsRecordHash:record.recordHash,contentSha256:record.contentSha256,model:'llama3.2:3b',modelVersion:'llama3.2:3b-local',promptVersion:'news-v1',analyzedAtUtc:at,timeoutMs:10000,classification:{assets:[],category:'MACROECONOMIA',sentiment:'NEUTRAL',relevance:'MEDIA',justification:'Comunicado macroeconómico',evidence:'Comunicado de la Reserva Federal',insufficientEvidence:false}}).record;}
function observation(at=cutoff):ForwardObservation{return {schema:'phase34-forward-observation-v1',recordId:'b'.repeat(64),previousHash:null,recordHash:'c'.repeat(64),mode:'DELAYED_FORWARD_OBSERVATION',model:{id:'frozen',sha256:model,createdAtUtc:'2026-10-20T10:00:00.000Z'},bar:{startUtc:'2026-10-21T14:30:00.000Z',endUtc:'2026-10-21T14:45:00.000Z',sessionDateNy:'2026-10-21',sourceRecordHash:'d'.repeat(64),sourceResponseSha256:'e'.repeat(64),revision:1,receivedAtUtc:'2026-10-21T14:50:00.000Z'},sourceBars:[],features:{spec:'nvda-15m-v1',hash:'f'.repeat(64),values:{} as ForwardObservation['features']['values']},prediction:{ALCISTA:.7,BAJISTA:.2,LATERAL:.1,dominantClass:'ALCISTA'},source:{provider:'Alpaca Market Data API',feed:'sip',adjustment:'split',availability:'DELAYED'},registeredAtUtc:at,outcomeKnownAtUtc:'2026-10-21T15:45:00.000Z',entryAtUtc:'2026-10-21T14:45:00.000Z',outcomeCloseAtUtc:'2026-10-21T15:45:00.000Z',hypotheticalNextEntryOpen:null,outcomeT4Close:null,recordedBeforeOutcome:true,recordedBeforeNextEntry:false};}
function evaluation():EvaluationRecord{return {schema:'phase35-evaluation-v1',kind:'EVALUATED',recordId:'1'.repeat(64),previousHash:null,recordHash:'2'.repeat(64),predictionId:'b'.repeat(64),modelSha256:model,predictedClass:'ALCISTA',probabilities:{ALCISTA:.7,BAJISTA:.2,LATERAL:.1},actualClass:'ALCISTA',entryOpen:100,exitClose:101,atr14:1,change:1,changePct:1,barStartUtc:'2026-10-21T14:30:00.000Z',entryAtUtc:'2026-10-21T14:45:00.000Z',outcomeCloseAtUtc:'2026-10-21T15:45:00.000Z',evaluatedAtUtc:'2026-10-21T16:10:00.000Z',sessionDateNy:'2026-10-21',outcomeBars:[],status:'VERIFIED',supersedes:null};}

describe('Fase 37: disponibilidad causal de noticias',()=>{
  it('incluye clasificación terminada antes del registro y conserva evidencia y baseline original',()=>{
    const f=fixture(),saved=appendNews(f.newsLog,article(),'2026-10-21T14:20:00.000Z').record;
    classify(f,saved,'2026-10-21T14:25:00.000Z');
    const rows=joinNewsContext([observation()],[evaluation()],readNewsFile(f),readAnalysisFile(f),model);
    expect(rows[0]?.news).toMatchObject([{newsRecordHash:saved.recordHash,receivedAtUtc:'2026-10-21T14:20:00.000Z'}]);
    expect(rows[0]?.countsByWindow).toEqual({'60':1,'180':1,'390':1});
    expect(rows[0]?.probabilities.ALCISTA).toBe(.7);expect(rows[0]?.actualClass).toBe('ALCISTA');
    expect(summarizeNewsContext(rows,model)).toMatchObject({observations:1,evaluated:1,withNews:1});
  });
  it('excluye noticia publicada antes pero recibida después, aun si Ollama la clasificó',()=>{
    const f=fixture(),saved=appendNews(f.newsLog,article(),'2026-10-21T15:01:00.000Z').record;
    classify(f,saved,'2026-10-21T15:02:00.000Z');
    expect(joinNewsContext([observation()],[evaluation()],readNewsFile(f),readAnalysisFile(f),model)[0]?.news).toEqual([]);
  });
  it('excluye una clasificación diferida y una clasificación exactamente al instante de predicción',()=>{
    const f=fixture(),saved=appendNews(f.newsLog,article(),'2026-10-21T14:20:00.000Z').record;
    classify(f,saved,cutoff);
    expect(joinNewsContext([observation()],[evaluation()],readNewsFile(f),readAnalysisFile(f),model)[0]?.news).toEqual([]);
  });
  it('una revisión nueva sin clasificación no reutiliza la interpretación anterior y no cambia predicciones previas',()=>{
    const f=fixture(),first=appendNews(f.newsLog,article(),'2026-10-21T14:20:00.000Z').record;
    classify(f,first,'2026-10-21T14:25:00.000Z');
    const before=joinNewsContext([observation()],[evaluation()],readNewsFile(f),readAnalysisFile(f),model);
    appendNews(f.newsLog,article('Texto revisado'),'2026-10-21T15:10:00.000Z');
    expect(joinNewsContext([observation()],[evaluation()],readNewsFile(f),readAnalysisFile(f),model)).toEqual(before);
  });
  it('una revisión recibida antes del corte exige su propia clasificación previa',()=>{
    const f=fixture(),first=appendNews(f.newsLog,article(),'2026-10-21T14:20:00.000Z').record;
    classify(f,first,'2026-10-21T14:25:00.000Z');
    const revised=appendNews(f.newsLog,article('Texto revisado'),'2026-10-21T14:40:00.000Z').record;
    expect(joinNewsContext([observation()],[],readNewsFile(f),readAnalysisFile(f),model)[0]?.news).toEqual([]);
    classify(f,revised,'2026-10-21T14:50:00.000Z');
    expect(joinNewsContext([observation()],[],readNewsFile(f),readAnalysisFile(f),model)[0]?.news[0]?.newsRecordHash).toBe(revised.recordHash);
  });
  it('sin noticias y sin evaluación conserva la observación, pero no inventa métricas',()=>{
    const rows=joinNewsContext([observation()],[],[],[],model),summary=summarizeNewsContext(rows,model);
    expect(rows[0]).toMatchObject({news:[],actualClass:null,evaluationRecordHash:null});
    expect(summary).toMatchObject({observations:1,evaluated:0,withNews:0});
    expect(summary.laterExploratory.baseline).toBeNull();
  });
  it('separa sesiones completas 70/30 y condiciona el bootstrap a tamaño suficiente',()=>{
    const sample=joinNewsContext([observation()],[evaluation()],[],[],model)[0]!;
    const dates=Array.from({length:50},(_,i)=>new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10)).filter(day=>![0,6].includes(new Date(day+'T12:00:00.000Z').getUTCDay())).slice(0,30);
    const rows=dates.flatMap((day,index)=>[0,1].map((item)=>({...sample,predictionId:`${index}-${item}`,sessionDateNy:day,actualClass:'ALCISTA' as const,news:item?[{articleId:'news',newsRecordHash:'n',analysisRecordHash:'a',providerId:'fed-monetary',firstSeenAtUtc:cutoff,receivedAtUtc:cutoff,analyzedAtUtc:cutoff,publishedAtUtc:null,sentiment:'NEUTRAL' as const,relevance:'MEDIA' as const,category:'MACROECONOMIA' as const,insufficientEvidence:false}]:[],countsByWindow:{'60':item,'180':item,'390':item}})));
    const summary=summarizeNewsContext(rows,model);
    expect(summary.development).toMatchObject({sessions:21,observations:42});
    expect(summary.laterExploratory).toMatchObject({sessions:9,observations:18});
    expect(summary.laterExploratory.sessionBootstrap95).toBeNull();
    expect(summary.development.sessionBootstrap95).not.toBeNull();
  });
  it('rechaza evaluaciones de otro modelo y artefactos de resumen inconsistentes',()=>{
    expect(()=>joinNewsContext([observation()],[{...evaluation(),modelSha256:'f'.repeat(64)}],[],[],model)).toThrow();
    const f=fixture(),path=join(f.dir,'summary.json');
    expect(readNewsContextSummary(path,model)).toMatchObject({status:'NO_DATA'});
    expect(readNewsContextSummary(path,undefined)).toMatchObject({status:'NO_MODEL'});
  });
  it('genera artefactos privados reproducibles y detecta alteración del CSV',()=>{
    const f=fixture(),outputDir=join(f.dir,'output'),paths={observationLog:join(f.dir,'observations.jsonl'),evaluationLog:join(f.dir,'evaluations.jsonl'),newsLog:f.newsLog,analysisLog:f.analysisLog,outputDir,modelSha256:model};
    expect(()=>buildNewsContext(paths)).toThrow('No existe el ledger');
    const {recordHash:_ignored,...unsigned}=observation(),record={...unsigned,recordHash:createHash('sha256').update(JSON.stringify(unsigned)).digest('hex')};
    writeFileSync(paths.observationLog,JSON.stringify(record)+'\n');
    const first=buildNewsContext(paths),csvPath=join(outputDir,'dataset.csv'),summaryPath=join(outputDir,'summary.json');
    const csv=readFileSync(csvPath,'utf8');expect(first.summary).toMatchObject({observations:1,evaluated:0});
    expect(readNewsContextSummary(summaryPath,model)).toMatchObject({status:'READY'});
    expect(buildNewsContext(paths).manifest.csvSha256).toBe(first.manifest.csvSha256);
    writeFileSync(csvPath,csv+'manipulado');
    expect(readNewsContextSummary(summaryPath,model)).toMatchObject({status:'INVALID_ARTIFACT'});
  });
  it('la API de solo lectura no expone rutas ni acepta otros activos',async()=>{
    const f=fixture(),created=await createApp({mode:'DEMO',privateDir:f.dir,dbPath:join(f.dir,'db.sqlite'),mlRunDir:null});
    try{
      const response=await created.app.inject('/api/v1/ml/news-context?symbol=NVDA&timeframe=15m');
      expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({status:'NO_MODEL'});
      expect(response.body).not.toContain(f.dir);
      expect((await created.app.inject('/api/v1/ml/news-context?symbol=QQQ&timeframe=15m')).statusCode).toBe(400);
    }finally{await created.app.close();}
  });
});
function readNewsFile(f:ReturnType<typeof fixture>){return readNews(f.newsLog);}
function readAnalysisFile(f:ReturnType<typeof fixture>){return readNewsAnalyses(f.analysisLog);}
