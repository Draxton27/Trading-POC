import {EventEmitter} from 'node:events';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {readIexAutomationStatus} from '../../apps/api/src/ml/iex-daily.ts';
import {createIexDaily,iexCollectorAllowed,iexEvaluationFinalAt,latestFirstIexQuarter,pendingIexEvaluations,readIexDailyState} from '../../scripts/iex-daily.ts';
import {prepareIexObservation,type IexFrozen,type IexObservationRecord} from '../../trading_poc_001_bollinger/src/phase38f-iex-observation.ts';
import {PHASE31_FEATURES} from '../../trading_poc_001_bollinger/src/phase31-inference.ts';
import type {IexRecord} from '../../trading_poc_001_bollinger/src/phase38-iex.ts';

const folders:string[]=[];
afterEach(()=>folders.splice(0).forEach(folder=>rmSync(folder,{recursive:true,force:true})));
const temporary=()=>{const folder=mkdtempSync(join(tmpdir(),'phase38g-'));folders.push(folder);return folder;};
const model:IexFrozen={schema:'phase38f-frozen-v1',modelSha256:'a'.repeat(64),cutoffUtc:'2026-10-22T00:00:00.000Z',frozenAtUtc:'2026-10-22T00:01:00.000Z',
  features:[...PHASE31_FEATURES],classes:['ALCISTA','BAJISTA','LATERAL'],feed:'iex',adjustment:'raw',frequency:[.3,.3,.4]};
function quarter(startUtc:string,receivedAtUtc:string,revision=1):IexRecord{
  const start=Date.parse(startUtc),end=new Date(start+15*60_000).toISOString(),price=100+(start/900_000)%60;
  return {schema:'phase38-iex-v1',id:`${startUtc}-${revision}`,previousHash:null,recordHash:`hash-${startUtc}-${revision}`,
    kind:'quarter',feed:'iex',adjustment:'raw',symbol:'NVDA',eventAtUtc:end,receivedAtUtc,status:'COMPLETE',
    bar:{startUtc,endUtc:end,open:price,high:price+1,low:price-1,close:price+.2,volume:1000,tradeCount:100},
    revision,sourceMessageHash:'synthetic',latencyMs:Date.parse(receivedAtUtc)-Date.parse(end)};
}
function status(value:string,at:string):IexRecord{return {...quarter('2026-10-23T19:45:00.000Z',at),kind:'status',status:value,bar:null,revision:null};}
function friday(){return Array.from({length:24},(_,i)=>quarter(new Date(Date.parse('2026-10-23T14:00:00.000Z')+i*900_000).toISOString(),
  new Date(Date.parse('2026-10-23T14:15:05.000Z')+i*900_000).toISOString()));}

describe('Fase 38G: automatización IEX',()=>{
  it('usa las 24 velas completas del viernes y la primera del lunes sin perder continuidad causal',()=>{
    const rows=[...friday(),quarter('2026-10-26T13:30:00.000Z','2026-10-26T13:45:05.000Z')];
    const calendar=new Map([['2026-10-23',{open:570,close:960}],['2026-10-26',{open:570,close:960}]]);
    const prepared=prepareIexObservation(rows,calendar,model,'2026-10-26T13:45:10.000Z');
    expect(prepared.candidate.bar?.startUtc).toBe('2026-10-26T13:30:00.000Z');
    expect(prepared.sourceBars).toHaveLength(25);
    expect(Object.values(prepared.features).every(Number.isFinite)).toBe(true);
    expect(()=>prepareIexObservation(rows,calendar,{...model,frozenAtUtc:'2026-10-26T13:30:00.000Z'},'2026-10-26T13:45:10.000Z')).toThrow(/backfill/);
    expect(prepareIexObservation([...rows,quarter('2026-10-23T17:00:00.000Z','2026-10-26T13:46:00.000Z',2)],calendar,model,'2026-10-26T13:45:10.000Z').featureHash).toBe(prepared.featureHash);
  });

  it('respeta la ventana oficial, EDT/EST, festivo y cierre anticipado',()=>{
    const edtLast=Date.parse('2026-10-26T20:20:00Z'),estLast=Date.parse('2026-11-02T21:20:00Z');
    expect(iexCollectorAllowed({open:570,close:960},edtLast,Date.parse('2026-10-26T12:00:00Z'))).toBe(true);
    expect(iexCollectorAllowed({open:570,close:960},estLast,Date.parse('2026-11-02T13:00:00Z'))).toBe(true);
    expect(iexCollectorAllowed(undefined,null,Date.parse('2026-11-26T15:00:00Z'))).toBe(false);
    expect(iexCollectorAllowed({open:570,close:780},Date.parse('2026-11-27T18:20:00Z'),Date.parse('2026-11-27T18:00:00Z'))).toBe(false);
    expect(iexEvaluationFinalAt(Date.parse('2026-11-27T18:20:00Z'))).toBe(Date.parse('2026-11-27T18:30:00Z'));
  });

  it('reutiliza un recolector manual, observa una vez la primera versión y descarta datos obsoletos tras desconexión',async()=>{
    const folder=temporary(),statePath=join(folder,'state.json'),env={...process.env,TRADING_POC_PRIVATE_DIR:folder};
    let now=Date.parse('2026-10-26T13:45:00Z'),rows=[...friday(),status('SUBSCRIBED','2026-10-26T13:30:00.000Z'),quarter('2026-10-26T13:30:00.000Z','2026-10-26T13:45:05.000Z')];
    const calls:string[]=[];
    const daily=createIexDaily({env,statePath,clock:()=>now,active:()=>true,startCollector:()=>{throw new Error('Nunca debe abrir otra conexión');},
      readLedger:()=>rows,readObservations:()=>[],verifyModel:()=>null,run:async mode=>{calls.push(mode);return {code:0,output:'{"status":"RECORDED","evaluations":0}'};}});
    now+=10_000;
    expect((await daily.tick(true,now+60_000)).owner).toBe('EXTERNAL');
    expect(daily.state.observationStatus).toBe('RECORDED');
    await daily.tick(true,now+60_000);
    expect(calls).toEqual(['--once']);
    rows.push(quarter('2026-10-23T18:00:00.000Z','2026-10-26T13:46:00.000Z',2));
    expect(latestFirstIexQuarter(rows,now)?.receivedAtUtc).toBe('2026-10-26T13:45:05.000Z');
    now=Date.parse('2026-10-26T14:02:00Z');rows.push(status('DISCONNECTED','2026-10-26T13:59:00.000Z'));
    expect((await daily.tick(true,now+60_000)).observationStatus).toBe('STALE_LIVE_DATA');
    expect(daily.state.collector).toBe('DISCONNECTED');
    expect(calls).toEqual(['--once']);
    rows.push(status('SUBSCRIBED','2026-10-26T14:00:01.000Z'),quarter('2026-10-26T13:45:00.000Z','2026-10-26T14:00:05.000Z'));
    expect((await daily.tick(true,now+60_000)).collector).toBe('ACTIVE');
    expect(calls).toEqual(['--once','--once']);
    await daily.stop();expect(readIexDailyState(statePath)?.owner).toBe('EXTERNAL');
    const restart=createIexDaily({env,statePath,clock:()=>now,active:()=>true,readLedger:()=>rows,readObservations:()=>[],verifyModel:()=>null,
      run:async mode=>{calls.push(mode);return {code:0,output:'{"status":"RECORDED"}'};}});
    expect((await restart.tick(true,now+60_000)).observationStatus).toBe('PREEXISTING_LIVE_DATA');
    expect(calls).toEqual(['--once','--once']);await restart.stop();
    expect(readFileSync(statePath,'utf8')).not.toContain(folder);
  });

  it('evalúa resultados vencidos sin una vela fresca ni modelo configurado, incluso al reiniciar',async()=>{
    const folder=temporary(),statePath=join(folder,'state.json'),env={...process.env,TRADING_POC_PRIVATE_DIR:folder};
    let now=Date.parse('2026-10-26T14:00:00Z');
    const prediction={kind:'PREDICTION',id:'p1',outcomeAtUtc:'2026-10-23T20:00:00.000Z',registeredAtUtc:'2026-10-23T18:00:00.000Z'} as IexObservationRecord;
    const evaluations:IexObservationRecord[]=[prediction],calls:string[]=[];
    const options={env,statePath,clock:()=>now,active:()=>false,readLedger:()=>friday(),readObservations:()=>evaluations,
      verifyModel:()=>{throw new Error('No debe consultarse el modelo para una evaluación');},
      run:async(mode:'--once'|'--evaluate-only')=>{calls.push(mode);if(mode==='--evaluate-only')evaluations.push({kind:'EVALUATION',predictionId:'p1'} as IexObservationRecord);return {code:0,output:'{"status":"EVALUATION_ONLY","evaluations":1}'};}};
    expect(pendingIexEvaluations(evaluations,now)).toBe(1);
    const first=createIexDaily(options);expect((await first.tick(false,null)).completedEvaluations).toBe(1);await first.stop();
    const restart=createIexDaily(options);now+=60_000;
    expect((await restart.tick(false,null)).pendingEvaluations).toBe(0);await restart.stop();
    expect(calls).toEqual(['--evaluate-only']);
    expect(readIexAutomationStatus(statePath)).toMatchObject({completedEvaluations:1,freshness:'STALE'});
    expect(Object.keys(readIexAutomationStatus(statePath))).not.toContain('ledgerPath');
  });

  it('inicia como máximo un hijo propio y lo cierra; un fallo tiene reintentos acotados',async()=>{
    const folder=temporary(),statePath=join(folder,'state.json'),env={...process.env,TRADING_POC_PRIVATE_DIR:folder};
    let now=Date.parse('2026-10-26T12:10:00Z'),starts=0,child:EventEmitter|null=null;
    const daily=createIexDaily({env,statePath,clock:()=>now,active:()=>false,readLedger:()=>[],readObservations:()=>[],
      startCollector:()=>{starts++;const next=new EventEmitter();child=next;
        return Object.assign(next,{stdin:{end:()=>next.emit('close',0)},kill:()=>next.emit('close',1)}) as never;}});
    await daily.tick(true,now+60_000);await daily.tick(true,now+60_000);expect(starts).toBe(1);
    (child as EventEmitter|null)?.emit('close',1);now+=30_000;await daily.tick(true,now+60_000);expect(starts).toBe(1);
    now+=31_000;await daily.tick(true,now+60_000);expect(starts).toBe(2);
    await daily.stop();expect(daily.state.collector).toBe('STOPPED');
    const terminal=createIexDaily({env,statePath:join(folder,'terminal.json'),clock:()=>now,active:()=>false,
      readLedger:()=>[status('AUTH_FAILED','2026-10-26T12:00:00.000Z')],readObservations:()=>[],
      startCollector:()=>{starts++;throw new Error('No debe iniciar ante autenticación denegada');}});
    expect((await terminal.tick(true,now+60_000)).lastErrorCode).toBe('IEX_COLLECT_TERMINAL_ERROR');
    expect(starts).toBe(2);await terminal.stop();
  });

  it('no llama a Python si no hay velas, la fuente es tardía o falla el modelo',async()=>{
    const folder=temporary(),env={...process.env,TRADING_POC_PRIVATE_DIR:folder},statePath=join(folder,'state.json');
    let now=Date.parse('2026-10-26T13:45:00Z'),rows:IexRecord[]=[],calls=0;
    const daily=createIexDaily({env,statePath,clock:()=>now,active:()=>true,readLedger:()=>rows,readObservations:()=>[],
      verifyModel:()=> 'MODEL_INCOMPATIBLE',run:async()=>{calls++;return {code:1,output:''};}});
    expect((await daily.tick(false,null)).observationStatus).toBe('NO_LIVE_DATA');
    rows=[quarter('2026-10-26T13:30:00.000Z','2026-10-26T13:45:05.000Z')];
    now+=10_000;
    expect((await daily.tick(false,null)).observationStatus).toBe('MODEL_INCOMPATIBLE');
    rows.push(status('DISCONNECTED','2026-10-26T13:45:08.000Z'));
    expect((await daily.tick(false,null)).observationStatus).toBe('FEED_DISCONNECTED');
    now+=20*60_000;expect((await daily.tick(false,null)).observationStatus).toBe('STALE_LIVE_DATA');
    expect(calls).toBe(0);
  });

  it('limita los reintentos de un fallo Python y publica solo un código estable',async()=>{
    const folder=temporary(),env={...process.env,TRADING_POC_PRIVATE_DIR:folder},statePath=join(folder,'state.json');
    let now=Date.parse('2026-10-26T13:45:00Z'),calls=0;
    const rows=[quarter('2026-10-26T13:30:00.000Z','2026-10-26T13:45:05.000Z')];
    const daily=createIexDaily({env,statePath,clock:()=>now,active:()=>true,readLedger:()=>rows,readObservations:()=>[],verifyModel:()=>null,
      run:async()=>{calls++;return {code:1,output:'private Python traceback and secrets'};}});
    now+=10_000;expect((await daily.tick(false,null)).observationStatus).toBe('OBSERVE_FAILED');
    expect((await daily.tick(false,null)).lastErrorCode).toBe('IEX_OBSERVE_FAILED');expect(calls).toBe(1);
    now+=60_000;await daily.tick(false,null);expect(calls).toBe(2);
    now+=120_000;await daily.tick(false,null);expect(calls).toBe(3);
    await daily.tick(false,null);expect(calls).toBe(3);
    expect(JSON.stringify(readIexAutomationStatus(statePath))).not.toContain('traceback');
    const privateState=JSON.parse(readFileSync(statePath,'utf8')) as Record<string,unknown>;
    writeFileSync(statePath,JSON.stringify({...privateState,lastErrorCode:'PRIVATE_TOKEN',feedStatus:'PRIVATE_ACCOUNT',observationStatus:'PRIVATE_PATH'}));
    const publicState=readIexAutomationStatus(statePath);
    expect(publicState.lastErrorCode).toBeNull();expect(publicState.feedStatus).toBeNull();expect(publicState.observationStatus).toBe('ERROR');
  });

  it('el CLI evalúa sin cargar Python ni exigir el modelo congelado',()=>{
    const folder=temporary();
    const result=spawnSync(process.execPath,['--experimental-strip-types','trading_poc_001_bollinger/src/phase38f-cli.ts','--evaluate-only'],{
      cwd:process.cwd(),encoding:'utf8',timeout:20_000,env:{...process.env,TRADING_POC_PRIVATE_DIR:folder,
        TRADING_POC_IEX_LEDGER:join(folder,'missing-ledger.jsonl'),TRADING_POC_IEX_OBSERVATION_LEDGER:join(folder,'observations.jsonl'),
        TRADING_POC_IEX_FROZEN_DIR:''}});
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({status:'EVALUATION_ONLY',evaluations:0});
  },25_000);
});
