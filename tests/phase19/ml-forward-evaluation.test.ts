import {afterEach,describe,expect,it} from 'vitest';
import {copyFileSync,mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {appendSuccessfulCapture,readIngestion} from '../../trading_poc_001_bollinger/src/phase32-ingestion.ts';
import {appendForwardObservation,prepareForwardObservation} from '../../trading_poc_001_bollinger/src/phase34-forward-observation.ts';
import {evaluateOnce,evaluatePrediction,readEvaluations} from '../../trading_poc_001_bollinger/src/phase35-evaluation.ts';
import {classifyMovement} from '../../trading_poc_001_bollinger/src/phase23-dataset.ts';
import {evaluationReport,frozenDevelopmentBaseline,scores} from '../../trading_poc_001_bollinger/src/phase35-metrics.ts';
import {frozenModel} from '../../trading_poc_001_bollinger/src/phase31-inference.ts';
import {saveMarketCalendar} from '../../trading_poc_001_bollinger/src/alpaca-calendar.ts';
import {evaluationStatus,evaluationHistory,evaluationMetrics} from '../../apps/api/src/ml/evaluation.ts';
import {createApp} from '../../apps/api/src/server.ts';
import {spawn} from 'node:child_process';

const roots:string[]=[];afterEach(()=>roots.splice(0).forEach(path=>rmSync(path,{recursive:true,force:true})));
const day='2026-01-02',calendar=new Map([[day,{open:570,close:960}]]);
const iso=(minute:number)=>new Date(Date.UTC(2026,0,2,14,30+minute)).toISOString();
const candle=(i:number,close=100+i*.1)=>{const open=100+i*.1;return {timestamp:iso(i*15),open,high:Math.max(open,close)+.3,low:Math.min(open,close)-.3,close,volume:1000+i};};
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'phase35-'));roots.push(dir);
  const ledger=join(dir,'alpaca.jsonl'),observationLog=join(dir,'forward.jsonl'),evaluationLog=join(dir,'evaluations.jsonl'),calendarPath=join(dir,'calendar.json'),run=join(dir,'20250101T000000Z-aaaaaaaaaaaa');
  mkdirSync(run);writeFileSync(join(run,'model.json'),'{}');writeFileSync(join(run,'report.json'),'{}');saveMarketCalendar(calendarPath,calendar);
  const model=frozenModel(run),past=Array.from({length:22},(_,i)=>candle(i));
  appendSuccessfulCapture(ledger,{candles:past,queryAtUtc:'2026-01-02T20:05:00.000Z',receivedAtUtc:'2026-01-02T20:05:00.000Z',responseSha256:'a'.repeat(64),availability:'DELAYED',barAgeMs:20*60_000});
  const prepared=prepareForwardObservation(ledger,calendar,model,'2026-01-02T20:05:00.000Z');
  const prediction=appendForwardObservation(observationLog,{mode:'DELAYED_FORWARD_OBSERVATION',model:{id:model.id,sha256:model.sha256,createdAtUtc:model.createdAtUtc},bar:{startUtc:prepared.prepared.barStartUtc,endUtc:prepared.prepared.barEndUtc,sessionDateNy:prepared.prepared.sessionDateNy,sourceRecordHash:prepared.candidate.recordHash,sourceResponseSha256:prepared.candidate.responseSha256!,revision:prepared.candidate.bar!.revision,receivedAtUtc:prepared.candidate.receivedAtUtc},sourceBars:prepared.sourceBars,features:{spec:'nvda-15m-v1',hash:prepared.prepared.featureHash,values:prepared.prepared.features},prediction:{ALCISTA:.7,BAJISTA:.2,LATERAL:.1,dominantClass:'ALCISTA'},source:{provider:'Alpaca Market Data API',feed:'sip',adjustment:'split',availability:'DELAYED'}},'2026-01-02T20:05:01.000Z').record;
  const addOutcome=(lastClose=103)=>{const future=[candle(22),candle(23),candle(24),candle(25,lastClose)];appendSuccessfulCapture(ledger,{candles:future,queryAtUtc:'2026-01-02T21:30:00.000Z',receivedAtUtc:'2026-01-02T21:30:00.000Z',responseSha256:'b'.repeat(64),availability:'DELAYED',barAgeMs:20*60_000});};
  return {dir,ledger,observationLog,evaluationLog,calendarPath,run,model,prediction,addOutcome};
}
const run=(f:ReturnType<typeof fixture>,clock='2026-01-02T21:31:00.000Z')=>evaluateOnce({ingestionLog:f.ledger,observationLog:f.observationLog,calendarPath:f.calendarPath,modelDir:f.run,evaluationLog:f.evaluationLog,clock:()=>clock});

describe('Fase 35: evaluación causal de observaciones adelantadas',()=>{
  it.each([[103,'ALCISTA'],[100,'BAJISTA'],[102.15,'LATERAL']] as const)('clasifica cierre %s como %s exactamente con Fase 23',(close,expected)=>{
    const f=fixture();f.addOutcome(close);const result=run(f),row=readEvaluations(f.evaluationLog)[0]!;
    expect(result).toMatchObject({added:1,evaluated:1});expect(row.actualClass).toBe(expected);
    expect(row.actualClass).toBe(classifyMovement(row.change!,row.atr14!));expect(row.entryOpen).toBe(102.2);
    expect(row.changePct).toBeCloseTo(row.change!/row.entryOpen!,12);expect(row.outcomeBars.map(b=>b.startUtc)).toEqual([22,23,24,25].map(i=>iso(i*15)));
    expect(Date.parse(row.evaluatedAtUtc)).toBeGreaterThan(Date.parse(row.outcomeBars[3]!.receivedAtUtc));
  });
  it('mantiene pendiente el horizonte no cerrado o sin última vela, y señala el gap intradía',()=>{
    const f=fixture();expect(run(f,'2026-01-02T20:40:00.000Z')).toMatchObject({added:0,pending:1});
    expect(run(f)).toMatchObject({added:0,pending:1});
    const later=[candle(23),candle(24),candle(25)];appendSuccessfulCapture(f.ledger,{candles:later,queryAtUtc:'2026-01-02T21:30:00.000Z',receivedAtUtc:'2026-01-02T21:30:00.000Z',responseSha256:'c'.repeat(64),availability:'DELAYED',barAgeMs:20*60_000});
    expect(run(f)).toMatchObject({added:0,nonEvaluable:1});expect(readEvaluations(f.evaluationLog)).toHaveLength(0);
  });
  it('reanuda una observación pendiente al recibir el desenlace sin recrear la predicción',()=>{
    const f=fixture();expect(run(f).pending).toBe(1);const before=readFileSync(f.observationLog,'utf8');
    f.addOutcome();expect(run(f)).toMatchObject({added:1,pending:0});expect(run(f)).toMatchObject({added:0,pending:0});
    expect(readFileSync(f.observationLog,'utf8')).toBe(before);expect(readEvaluations(f.evaluationLog)).toHaveLength(1);
  });
  it('dos procesos simultáneos agregan exactamente una evaluación encadenada',async()=>{
    const f=fixture();f.addOutcome();
    const options={ingestionLog:f.ledger,observationLog:f.observationLog,calendarPath:f.calendarPath,modelDir:f.run,evaluationLog:f.evaluationLog,clock:undefined};
    const script="import {evaluateOnce} from './trading_poc_001_bollinger/src/phase35-evaluation.ts'; evaluateOnce({...JSON.parse(process.argv[1]),clock:()=> '2026-01-02T21:31:00.000Z'});";
    const child=()=>new Promise<number>((done,reject)=>{const proc=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',script,JSON.stringify(options)],{cwd:process.cwd(),windowsHide:true,stdio:'ignore'});proc.once('error',reject);proc.once('close',code=>done(code??1));});
    expect(await Promise.all([child(),child()])).toEqual([0,0]);expect(readEvaluations(f.evaluationLog)).toHaveLength(1);
  });
  it('dos procesos con revisiones distintas conservan una original y un aviso válido',async()=>{
    const f=fixture();f.addOutcome(103);const firstLedger=join(f.dir,'first-ledger.jsonl');copyFileSync(f.ledger,firstLedger);
    appendSuccessfulCapture(f.ledger,{candles:[candle(25,104)],queryAtUtc:'2026-01-02T21:40:00.000Z',receivedAtUtc:'2026-01-02T21:40:00.000Z',responseSha256:'r'.repeat(64),availability:'DELAYED',barAgeMs:20*60_000});
    writeFileSync(join(f.run,'report.json'),JSON.stringify({class_index:{ALCISTA:0,BAJISTA:1,LATERAL:2},walk_forward_folds:[]}));
    const script="import {evaluateOnce} from './trading_poc_001_bollinger/src/phase35-evaluation.ts'; evaluateOnce({...JSON.parse(process.argv[1]),clock:()=> '2026-01-02T21:41:00.000Z'});";
    const child=(ingestionLog:string)=>new Promise<number>((done,reject)=>{const options={ingestionLog,observationLog:f.observationLog,calendarPath:f.calendarPath,modelDir:f.run,evaluationLog:f.evaluationLog};const proc=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',script,JSON.stringify(options)],{cwd:process.cwd(),windowsHide:true,stdio:'ignore'});proc.once('error',reject);proc.once('close',code=>done(code??1));});
    expect(await Promise.all([child(firstLedger),child(f.ledger)])).toEqual([0,0]);
    const rows=readEvaluations(f.evaluationLog),originals=rows.filter(row=>row.kind==='EVALUATED'),notices=rows.filter(row=>row.kind==='REVISION_NOTICE');
    expect(originals).toHaveLength(1);expect(notices).toHaveLength(1);expect(notices[0]).toMatchObject({predictionId:f.prediction.recordId,supersedes:originals[0]!.recordHash,status:'REVISED_AFTER_EVALUATION'});
    expect(evaluationMetrics({observationLog:f.observationLog,evaluationLog:f.evaluationLog,statusPath:undefined,runDir:f.run,modelSha256:f.model.sha256})).toMatchObject({state:'READY',sampleSize:1});
  });
  it('conserva la evaluación original y añade aviso idempotente ante revisión posterior',()=>{
    const f=fixture();f.addOutcome();run(f);const first=readEvaluations(f.evaluationLog)[0]!;
    const revised={...candle(25,104),timestamp:iso(25*15)};appendSuccessfulCapture(f.ledger,{candles:[revised],queryAtUtc:'2026-01-02T21:40:00.000Z',receivedAtUtc:'2026-01-02T21:40:00.000Z',responseSha256:'d'.repeat(64),availability:'DELAYED',barAgeMs:20*60_000});
    expect(run(f,'2026-01-02T21:41:00.000Z')).toMatchObject({added:0,revisionNotices:1});
    expect(run(f,'2026-01-02T21:42:00.000Z')).toMatchObject({added:0,revisionNotices:0});
    const entries=readEvaluations(f.evaluationLog);expect(entries).toHaveLength(2);expect(entries[0]).toEqual(first);expect(entries[1]).toMatchObject({kind:'REVISION_NOTICE',supersedes:first.recordHash});
    expect(evaluationReport(entries,null).sampleSize).toBe(1);
  });
  it('rechaza ledger alterado, modelo incompatible y registro de predicción fuera de tiempo',()=>{
    const f=fixture();f.addOutcome();
    expect(evaluatePrediction({...f.prediction,registeredAtUtc:f.prediction.outcomeCloseAtUtc},readIngestion(f.ledger),calendar,f.model.sha256,'2026-01-02T21:31:00.000Z').state).toBe('NON_EVALUABLE');
    expect(evaluatePrediction(f.prediction,readIngestion(f.ledger),calendar,'f'.repeat(64),'2026-01-02T21:31:00.000Z').state).toBe('NON_EVALUABLE');
    run(f);writeFileSync(f.evaluationLog,readFileSync(f.evaluationLog,'utf8').replace('VERIFIED','BROKEN'));
    expect(()=>readEvaluations(f.evaluationLog)).toThrow(/alterado/);
    expect(evaluationStatus({observationLog:f.observationLog,evaluationLog:f.evaluationLog,statusPath:undefined,runDir:f.run,modelSha256:f.model.sha256}).state).toBe('INVALID_ARTIFACT');
  });
  it('rechaza un ledger previamente válido con dos evaluaciones originales para una predicción',()=>{
    const f=fixture();f.addOutcome();run(f);const first=readEvaluations(f.evaluationLog)[0]!;
    const duplicate={...first,recordId:'d'.repeat(64),previousHash:first.recordHash,evaluatedAtUtc:'2026-01-02T21:32:00.000Z',recordHash:''};
    const {recordHash,...unsigned}=duplicate;duplicate.recordHash=createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
    writeFileSync(f.evaluationLog,readFileSync(f.evaluationLog,'utf8')+JSON.stringify(duplicate)+'\n');
    expect(()=>readEvaluations(f.evaluationLog)).toThrow(/más de una evaluación original/);
    expect(evaluationStatus({observationLog:f.observationLog,evaluationLog:f.evaluationLog,statusPath:undefined,runDir:f.run,modelSha256:f.model.sha256}).state).toBe('INVALID_ARTIFACT');
  });
  it('rechaza cierre anticipado y conserva el ATR de la revisión original de t',()=>{
    const f=fixture();f.addOutcome();
    expect(evaluatePrediction(f.prediction,readIngestion(f.ledger),new Map([[day,{open:570,close:900}]]),f.model.sha256,'2026-01-02T21:31:00.000Z').state).toBe('NON_EVALUABLE');
    appendSuccessfulCapture(f.ledger,{candles:[{...candle(21),close:120,high:121}],queryAtUtc:'2026-01-02T21:35:00.000Z',receivedAtUtc:'2026-01-02T21:35:00.000Z',responseSha256:'e'.repeat(64),availability:'DELAYED',barAgeMs:20*60_000});
    const result=run(f),row=readEvaluations(f.evaluationLog)[0]!;expect(result.added).toBe(1);expect(row.atr14).toBeCloseTo(f.prediction.features.values.atr14_relative*candle(21).close,12);
  });
  it('calcula matriz, Macro F1, calibración y baseline fijo sobre las mismas filas',()=>{
    const f=fixture();f.addOutcome();run(f);const one=readEvaluations(f.evaluationLog)[0]!;
    const rows=[{...one,actualClass:'ALCISTA' as const,predictedClass:'ALCISTA' as const,probabilities:{ALCISTA:.8,BAJISTA:.1,LATERAL:.1}}, {...one,actualClass:'BAJISTA' as const,predictedClass:'ALCISTA' as const,probabilities:{ALCISTA:.6,BAJISTA:.3,LATERAL:.1}}, {...one,actualClass:'LATERAL' as const,predictedClass:'LATERAL' as const,probabilities:{ALCISTA:.1,BAJISTA:.1,LATERAL:.8}}];
    const metric=scores(rows)!;expect(metric.accuracy).toBeCloseTo(2/3);expect(metric.balancedAccuracy).toBeCloseTo(2/3);expect(metric.perClass.ALCISTA).toMatchObject({precision:.5,recall:1,support:1});expect(metric.perClass.BAJISTA.f1).toBe(0);expect(metric.perClass.LATERAL.f1).toBe(1);expect(metric.macroF1).toBeCloseTo((2/3+0+1)/3);expect(metric.logLoss).toBeCloseTo(-(Math.log(.8)+Math.log(.3)+Math.log(.8))/3);expect(metric.brier).toBeGreaterThan(0);
    const report=evaluationReport(rows,{probabilities:{ALCISTA:.2,BAJISTA:.5,LATERAL:.3},source:'pre-2025'});expect(report.baseline?.metrics?.n).toBe(3);expect(metric.calibration.ALCISTA.reduce((n,bin)=>n+bin.n,0)).toBe(3);expect(report.uncertainty).toBeNull();
  });
  it('el baseline procede solo de un fold anterior a 2025, nunca de etiquetas evaluadas',()=>{
    const f=fixture(),report={class_index:{ALCISTA:0,BAJISTA:1,LATERAL:2},walk_forward_folds:[{external_sessions:['2024-06-01'],out_of_sample_predictions:[{prob_frequency:[.2,.5,.3]},{prob_frequency:[.2,.5,.3]}]}],class_distribution:{ALCISTA:9999}};
    writeFileSync(join(f.run,'report.json'),JSON.stringify(report));
    expect(frozenDevelopmentBaseline(f.run)?.probabilities).toEqual({ALCISTA:.2,BAJISTA:.5,LATERAL:.3});
    report.walk_forward_folds[0]!.external_sessions=['2025-06-01'];writeFileSync(join(f.run,'report.json'),JSON.stringify(report));expect(frozenDevelopmentBaseline(f.run)).toBeNull();
  });
  it('el bootstrap pareado remuestrea sesiones completas y es reproducible',()=>{
    const f=fixture();f.addOutcome();run(f);const original=readEvaluations(f.evaluationLog)[0]!;
    const rows=Array.from({length:30},(_,i)=>({...original,predictionId:`${i}`.padStart(64,'0'),sessionDateNy:`2026-01-${String(2+Math.floor(i/3)).padStart(2,'0')}`,actualClass:(['ALCISTA','BAJISTA','LATERAL'] as const)[i%3]!}));
    const baseline={probabilities:{ALCISTA:.2,BAJISTA:.5,LATERAL:.3},source:'pre-2025'};
    const first=evaluationReport(rows,baseline),second=evaluationReport(rows,baseline);
    expect(first.uncertainty).not.toBeNull();expect(first.pairedDifferences).toEqual(second.pairedDifferences);
    expect(first.pairedDifferences?.macroF1.interval95).toHaveLength(2);expect(first.sessions).toBe(10);
  });
  it('API solo lectura informa ausencia real y restringe activo y temporalidad',async()=>{
    const f=fixture(),paths={observationLog:undefined,evaluationLog:f.evaluationLog,statusPath:undefined,runDir:f.run,modelSha256:f.model.sha256};
    expect(evaluationStatus(paths)).toMatchObject({state:'NO_DATA',evaluated:0});expect(evaluationHistory(paths,0,25)).toMatchObject({state:'NO_DATA'});
    f.addOutcome();run(f);expect(evaluationHistory({...paths,observationLog:f.observationLog},0,1)).toMatchObject({total:1,limit:1,nextOffset:null});
    const {app}=await createApp({mode:'DEMO',privateDir:f.dir,dbPath:join(f.dir,'api.sqlite'),mlRunDir:null,mlEvaluationLog:f.evaluationLog});
    try{expect((await app.inject('/api/v1/ml/evaluation/status')).json()).toMatchObject({state:'NO_MODEL'});expect((await app.inject('/api/v1/ml/evaluation/history?symbol=QQQ')).statusCode).toBe(400);expect(app.printRoutes()).not.toMatch(/\/api\/v1\/ml\/.*(evaluate|order).*POST/);}finally{await app.close();}
  });
});
