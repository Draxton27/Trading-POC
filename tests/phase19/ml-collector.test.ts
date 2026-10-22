import {existsSync,mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {appendSuccessfulCapture,readIngestion} from '../../trading_poc_001_bollinger/src/phase32-ingestion.ts';
import {acquireCollectorLock,collectOnce,collectorSchedule,nextCollectorWake,readCollectorStatus,shouldEvaluateAfterIngestion} from '../../trading_poc_001_bollinger/src/phase34-collector.ts';
import {ObserverFailure,observerFailure,encodeObserverFailure,decodeObserverFailure} from '../../trading_poc_001_bollinger/src/phase34-observer-errors.ts';
import {runObserverProcess} from '../../trading_poc_001_bollinger/src/phase34-observer-process.ts';
import {runFrozenPython} from '../../trading_poc_001_bollinger/src/phase34-python.ts';
import {readMlCollectorStatus} from '../../apps/api/src/ml/collector.ts';
import {createApp} from '../../apps/api/src/server.ts';
import {appendForwardObservation} from '../../trading_poc_001_bollinger/src/phase34-forward-observation.ts';
import {frozenModel,PHASE31_FEATURES} from '../../trading_poc_001_bollinger/src/phase31-inference.ts';

const folders:string[]=[];
afterEach(()=>{for(const folder of folders.splice(0))rmSync(folder,{recursive:true,force:true});});
function fixture(){const root=mkdtempSync(join(tmpdir(),'ml-collector-'));folders.push(root);const modelDir=join(root,'20250101T000000Z-aaaaaaaaaaaa');mkdirSync(modelDir);writeFileSync(join(modelDir,'model.json'),'{}');writeFileSync(join(modelDir,'report.json'),'{}');return {root,modelDir,ledger:join(root,'ledger.jsonl'),observationLog:join(root,'observations.jsonl'),statusPath:join(root,'status.json')};}
const bar=(start:string)=>({timestamp:start,open:100,high:101,low:99,close:100.5,volume:1000});
function capture(ledger:string,start:string,query:string){const output=appendSuccessfulCapture(ledger,{candles:[bar(start)],queryAtUtc:query,receivedAtUtc:query,responseSha256:'a'.repeat(64),availability:'DELAYED',barAgeMs:20*60_000});return {barsAdded:output.barsAdded,calendar:new Map()};}
function recordObservation(paths:ReturnType<typeof fixture>){
  const model=frozenModel(paths.modelDir),start='2026-10-20T13:30:00.000Z',end='2026-10-20T13:45:00.000Z';
  appendForwardObservation(paths.observationLog,{mode:'DELAYED_FORWARD_OBSERVATION',model:{id:model.id,sha256:model.sha256,createdAtUtc:model.createdAtUtc},bar:{startUtc:start,endUtc:end,sessionDateNy:'2026-10-20',sourceRecordHash:'a'.repeat(64),sourceResponseSha256:'b'.repeat(64),revision:1,receivedAtUtc:'2026-10-20T14:05:00.000Z'},sourceBars:[{startUtc:start,endUtc:end,revision:1,recordHash:'a'.repeat(64),responseSha256:'b'.repeat(64),receivedAtUtc:'2026-10-20T14:05:00.000Z'}],features:{spec:'nvda-15m-v1',hash:'c'.repeat(64),values:Object.fromEntries(PHASE31_FEATURES.map(name=>[name,0])) as any},prediction:{ALCISTA:.2,BAJISTA:.3,LATERAL:.5,dominantClass:'LATERAL'},source:{provider:'Alpaca Market Data API',feed:'sip',adjustment:'split',availability:'DELAYED'}},'2026-10-20T14:06:00.000Z');
}
const regular=new Map([['2026-10-20',{open:570,close:960}],['2026-10-21',{open:570,close:960}]]);

describe('recolector coordinado Fase 34.1',()=>{
  it('distingue 19:00 elegible de 19:15 no elegible el 21 de octubre de 2026',async()=>{
    const eligible=fixture();let calls=0;
    const first=await collectOnce({...eligible,clock:()=>Date.parse('2026-10-21T19:21:00Z'),calendar:async()=>regular,
      capture:async()=>capture(eligible.ledger,'2026-10-21T18:45:00.000Z','2026-10-21T19:21:00.000Z'),
      observe:()=>{calls++;throw new ObserverFailure('INDICATORS_INSUFFICIENT','Historial insuficiente.');}});
    expect(first.state).toBe('INDICATORS_INSUFFICIENT');expect(calls).toBe(1);
    const late=fixture();const second=await collectOnce({...late,clock:()=>Date.parse('2026-10-21T19:36:00Z'),calendar:async()=>regular,
      capture:async()=>capture(late.ledger,'2026-10-21T19:00:00.000Z','2026-10-21T19:36:00.000Z'),
      observe:()=>{calls++;return {alreadyPresent:false};}});
    expect(second).toMatchObject({state:'HORIZON_INELIGIBLE',lastBarEndUtc:'2026-10-21T19:15:00.000Z',nextQueryAtUtc:'2026-10-21T19:50:00.000Z',retryable:false});
    expect(calls).toBe(1);
    expect(nextCollectorWake(second,Date.parse('2026-10-21T19:37:00Z'))).toBe(Date.parse('2026-10-21T19:50:00Z'));
    expect(shouldEvaluateAfterIngestion(second,{updatedAtUtc:'2026-10-21T19:20:00.000Z',state:'OK'})).toBe(true);
  });
  it('conserva códigos estructurados y diagnóstico privado de un fallo Python real',async()=>{
    const paths=fixture(),script=join(paths.root,'failing-python.mjs');
    writeFileSync(script,"process.stderr.write('ModuleNotFoundError: No module named xgboost\\n');process.exit(37);");
    let failure:unknown;
    try{runFrozenPython('unused',{}, {root:paths.root,python:process.execPath,script});}catch(error){failure=error;}
    expect(observerFailure(failure)).toMatchObject({code:'PYTHON_ERROR',exitCode:37,cause:'ModuleNotFoundError: No module named xgboost',retryable:false});
    const python=join(process.cwd(),'.venv','phase28-py312','Scripts','python.exe');
    if(existsSync(python)){
      const failing=join(paths.root,'failing-python.py');writeFileSync(failing,"raise RuntimeError('controlled inference failure')\n");
      let realPythonFailure:unknown;
      try{runFrozenPython('unused',{}, {root:paths.root,python,script:failing});}catch(error){realPythonFailure=error;}
      expect(observerFailure(realPythonFailure)).toMatchObject({code:'PYTHON_ERROR',exitCode:1,cause:'RuntimeError: controlled inference failure'});
    }
    const encoded=encodeObserverFailure(failure);expect(decodeObserverFailure(encoded)).toMatchObject({code:'PYTHON_ERROR',exitCode:37});
    const wrapper=join(paths.root,'observer.mjs');writeFileSync(wrapper,`process.stderr.write(${JSON.stringify(encoded+'\n')});process.exit(1);`);
    await expect(runObserverProcess({root:paths.root,script:wrapper})).rejects.toMatchObject({code:'PYTHON_ERROR',details:{exitCode:37}});
    await expect(runObserverProcess({root:process.cwd(),env:{...process.env,
      TRADING_POC_ALPACA_INGESTION_LOG:join(paths.root,'missing-ledger.jsonl'),
      TRADING_POC_ALPACA_INGESTION_CALENDAR:join(paths.root,'missing-calendar.json'),
      TRADING_POC_ML_RUN_DIR:paths.modelDir}})).rejects.toMatchObject({code:'LEDGER_INVALID'});
    const result=await collectOnce({...paths,clock:()=>Date.parse('2026-10-21T14:06:00Z'),calendar:async()=>regular,
      capture:async()=>capture(paths.ledger,'2026-10-21T13:30:00.000Z','2026-10-21T14:06:00.000Z'),observe:()=>{throw failure;}});
    expect(result).toMatchObject({state:'PYTHON_ERROR',lastError:'PYTHON_ERROR',retryable:false});
    const diagnostic=JSON.parse(readFileSync(`${paths.statusPath}.python.jsonl`,'utf8').trim());
    expect(diagnostic).toMatchObject({exitCode:37,cause:'ModuleNotFoundError: No module named xgboost'});
    expect(readFileSync(paths.statusPath,'utf8')).not.toContain('ModuleNotFoundError');
    const {app}=await createApp({mode:'DEMO',privateDir:paths.root,dbPath:join(paths.root,'test.sqlite'),mlCollectorStatus:paths.statusPath});
    try{expect((await app.inject('/api/v1/ml/collector')).json().lastError).toBe('PYTHON_ERROR');
      expect((await app.inject('/api/v1/ml/collector')).body).not.toContain('ModuleNotFoundError');}finally{await app.close();}
  });
  it('limita los reintentos transitorios y nunca reintenta el horizonte cada minuto',async()=>{
    const paths=fixture();let calls=0;
    const retry=async(minute:number)=>collectOnce({...paths,clock:()=>Date.parse(`2026-10-21T14:${String(minute).padStart(2,'0')}:00Z`),calendar:async()=>regular,
      capture:async()=>capture(paths.ledger,'2026-10-21T13:30:00.000Z','2026-10-21T14:06:00.000Z'),
      observe:()=>{calls++;throw new ObserverFailure('PYTHON_ERROR','Python temporalmente ocupado.',{exitCode:null,cause:'EAGAIN',retryable:true});}});
    expect(await retry(6)).toMatchObject({retryable:true,retryCount:1,nextQueryAtUtc:'2026-10-21T14:07:00.000Z'});
    expect(await retry(7)).toMatchObject({retryable:true,retryCount:2,nextQueryAtUtc:'2026-10-21T14:09:00.000Z'});
    expect(await retry(9)).toMatchObject({retryable:false,retryCount:3,nextQueryAtUtc:'2026-10-21T14:20:00.000Z'});
    expect(calls).toBe(3);
  });
  it('calcula instantes útiles con horario NY, fin de semana y cierre anticipado',()=>{
    expect(collectorSchedule(regular,Date.parse('2026-10-20T14:49:00Z'))).toMatchObject({latestDue:Date.parse('2026-10-20T14:35:00Z'),next:Date.parse('2026-10-20T14:50:00Z')});
    const early=new Map([['2026-11-27',{open:570,close:780}],['2026-11-30',{open:570,close:960}]]);
    expect(collectorSchedule(early,Date.parse('2026-11-27T19:00:00Z')).next).toBe(Date.parse('2026-11-30T15:05:00Z'));
    const spring=new Map([['2026-03-06',{open:570,close:960}],['2026-03-09',{open:570,close:960}]]);
    expect(collectorSchedule(spring,Date.parse('2026-03-08T16:00:00Z')).next).toBe(Date.parse('2026-03-09T14:05:00Z'));
  });
  it('distingue la sesión abierta antes del primer cierre SIP disponible',async()=>{
    const paths=fixture();let requested=0;
    const result=await collectOnce({...paths,clock:()=>Date.parse('2026-10-20T13:45:00Z'),calendar:async()=>regular,capture:async()=>{requested++;return {barsAdded:0,calendar:regular};},observe:()=>({alreadyPresent:false})});
    expect(result.state).toBe('NO_NEW_BARS');expect(result.nextQueryAtUtc).toBe('2026-10-20T14:05:00.000Z');expect(requested).toBe(0);
  });
  it('registra una vela nueva una sola vez y conserva ledger y estado al reiniciar',async()=>{
    const paths=fixture(),now=()=>Date.parse('2026-10-20T14:06:00.000Z');let requested=0,inferred=0;
    const deps={...paths,clock:now,calendar:async()=>regular,capture:async()=>{requested++;return capture(paths.ledger,'2026-10-20T13:30:00.000Z','2026-10-20T14:06:00.000Z');},observe:()=>{inferred++;recordObservation(paths);return {alreadyPresent:false};}};
    expect((await collectOnce(deps)).state).toBe('RECORDED');
    expect((await collectOnce(deps)).state).toBe('DUPLICATE');
    expect([requested,inferred,readIngestion(paths.ledger).filter(row=>row.kind==='bar').length]).toEqual([1,1,1]);
    expect(readCollectorStatus(paths.statusPath)?.newObservations).toBe(1);
    expect(readMlCollectorStatus(paths.statusPath)).toMatchObject({state:'DUPLICATE',newObservations:1});
  });
  it('omite Python cuando no hay velas, ya existe observación o el modelo no está configurado',async()=>{
    const paths=fixture(),now=()=>Date.parse('2026-10-20T14:06:00.000Z');let inferred=0;
    const none={...paths,clock:now,calendar:async()=>regular,capture:async()=>({barsAdded:0,calendar:regular}),observe:()=>{inferred++;return {alreadyPresent:false};}};
    appendSuccessfulCapture(paths.ledger,{candles:[],queryAtUtc:'2026-10-20T13:51:00.000Z',receivedAtUtc:'2026-10-20T13:51:00.000Z',responseSha256:'a'.repeat(64),availability:'DELAYED',barAgeMs:Infinity});
    expect((await collectOnce(none)).state).toBe('NO_NEW_BARS');expect(inferred).toBe(0);
    const missing=fixture();expect((await collectOnce({...none,...missing,modelDir:undefined,capture:async()=>capture(missing.ledger,'2026-10-20T13:30:00.000Z','2026-10-20T14:06:00.000Z')})).state).toBe('MODEL_NOT_CONFIGURED');
    expect(inferred).toBe(0);
  });
  it('clasifica mercado cerrado, permiso denegado y error Python sin exponer credenciales',async()=>{
    const paths=fixture(),now=()=>Date.parse('2026-10-24T17:00:00.000Z');let requested=0;
    const base={...paths,clock:now,calendar:async()=>regular,capture:async()=>{requested++;return {barsAdded:0,calendar:regular};},observe:()=>({alreadyPresent:false})};
    expect((await collectOnce(base)).state).toBe('MARKET_CLOSED');expect(requested).toBe(0);
    const sessionNow=()=>Date.parse('2026-10-20T14:06:00.000Z');
    expect((await collectOnce({...base,clock:sessionNow,capture:async()=>{throw Object.assign(new Error('secret-value'),{status:'PERMISSION_DENIED'});}})).state).toBe('ALPACA_PERMISSION');
    expect(readFileSync(paths.statusPath,'utf8')).not.toContain('secret-value');
    expect((await collectOnce({...base,clock:sessionNow,capture:async()=>capture(paths.ledger,'2026-10-20T13:30:00.000Z','2026-10-20T14:06:00.000Z'),observe:()=>{throw new Error('Inferencia XGBoost rechazada.');}})).state).toBe('PYTHON_ERROR');
  });
  it('distingue horizonte, desenlace e historial insuficiente antes de invocar Python',async()=>{
    for(const [message,state] of [
      ['La vela no tiene horizonte Fase 23 completo dentro de la sesión.','HORIZON_INELIGIBLE'],
      ['La vela más nueva ya alcanzó el desenlace t+4; no se realiza backfill.','OUTCOME_PASSED'],
      ['Indicadores insuficientes: período de calentamiento Fase 23 menor de 21 velas continuas.','INDICATORS_INSUFFICIENT'],
    ] as const){
      const paths=fixture();
      const result=await collectOnce({...paths,clock:()=>Date.parse('2026-10-20T14:06:00Z'),calendar:async()=>regular,capture:async()=>capture(paths.ledger,'2026-10-20T13:30:00.000Z','2026-10-20T14:06:00.000Z'),observe:()=>{throw new Error(message);}});
      expect(result.state).toBe(state);expect(result.newObservations).toBe(0);
    }
  });
  it('rechaza ledger corrupto sin sustituir registros previos',async()=>{
    const paths=fixture();writeFileSync(paths.ledger,'{"alterado":true}\n');
    let requested=0;const result=await collectOnce({...paths,clock:()=>Date.parse('2026-10-20T14:06:00Z'),calendar:async()=>regular,capture:async()=>{requested++;return {barsAdded:0,calendar:regular};},observe:()=>({alreadyPresent:false})});
    expect(result.state).toBe('LEDGER_INVALID');expect(requested).toBe(0);expect(readFileSync(paths.ledger,'utf8')).toContain('alterado');
  });
  it('no reinicia contadores ni sobrescribe un estado privado corrupto',async()=>{
    const paths=fixture();writeFileSync(paths.statusPath,'{"schema":"incorrecto","newObservations":42}');
    await expect(collectOnce({...paths,clock:()=>Date.parse('2026-10-20T14:06:00Z'),calendar:async()=>regular,capture:async()=>({barsAdded:0,calendar:regular}),observe:()=>({alreadyPresent:false})})).rejects.toThrow(/inválido/);
    expect(readFileSync(paths.statusPath,'utf8')).toContain('42');
    expect(readMlCollectorStatus(paths.statusPath)).toMatchObject({state:'ERROR',active:false});
  });
  it('recupera el total desde el ledger append-only tras una interrupción',async()=>{
    const paths=fixture();recordObservation(paths);
    appendSuccessfulCapture(paths.ledger,{candles:[],queryAtUtc:'2026-10-20T14:06:00.000Z',receivedAtUtc:'2026-10-20T14:06:00.000Z',responseSha256:'d'.repeat(64),availability:'DELAYED',barAgeMs:Infinity});
    const result=await collectOnce({...paths,clock:()=>Date.parse('2026-10-20T14:06:00Z'),calendar:async()=>regular,capture:async()=>({barsAdded:0,calendar:regular}),observe:()=>({alreadyPresent:false})});
    expect(result.state).toBe('NO_NEW_BARS');expect(result.newObservations).toBe(1);
  });
  it('retoma una vela recién ingerida si se interrumpió antes de observarla',async()=>{
    const paths=fixture();capture(paths.ledger,'2026-10-20T13:30:00.000Z','2026-10-20T14:06:00.000Z');let recaptured=0,inferred=0;
    const result=await collectOnce({...paths,clock:()=>Date.parse('2026-10-20T14:07:00Z'),calendar:async()=>regular,capture:async()=>{recaptured++;return {barsAdded:0,calendar:regular};},observe:()=>{inferred++;recordObservation(paths);return {alreadyPresent:false};}});
    expect(result.state).toBe('RECORDED');expect([recaptured,inferred,result.newObservations]).toEqual([0,1,1]);
  });
  it('Ctrl+C lógico impide avanzar de calendario a ingesta',async()=>{
    const paths=fixture();let requested=0;
    const result=await collectOnce({...paths,clock:()=>Date.parse('2026-10-20T14:06:00Z'),calendar:async()=>regular,stopped:()=>true,capture:async()=>{requested++;return {barsAdded:0,calendar:regular};},observe:()=>({alreadyPresent:false})});
    expect(result.state).toBe('STOPPED');expect(requested).toBe(0);
  });
  it('impide procesos simultáneos y recupera un bloqueo de PID terminado',()=>{
    const paths=fixture(),release=acquireCollectorLock(paths.statusPath);
    expect(()=>acquireCollectorLock(paths.statusPath)).toThrow(/activo/);
    release();expect(()=>acquireCollectorLock(paths.statusPath)).not.toThrow();
    rmSync(`${paths.statusPath}.lock`,{force:true});writeFileSync(`${paths.statusPath}.lock`,'99999999');
    const recovered=acquireCollectorLock(paths.statusPath);recovered();
  });
  it('expone estado por GET y rechaza activos o temporalidades distintos',async()=>{
    const paths=fixture();
    const {app}=await createApp({mode:'DEMO',privateDir:paths.root,dbPath:join(paths.root,'test.sqlite'),mlCollectorStatus:paths.statusPath});
    try{
      expect((await app.inject('/api/v1/ml/collector?symbol=NVDA&timeframe=15m')).json()).toMatchObject({state:'NOT_CONFIGURED',newObservations:0});
      expect((await app.inject('/api/v1/ml/collector?symbol=QQQ&timeframe=15m')).statusCode).toBe(400);
      expect((await app.inject({method:'POST',url:'/api/v1/ml/collector'})).statusCode).toBe(403);
    }finally{await app.close();}
  });
});
