import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {acquireDailyLock,dailyStatePath,missingSessionWindows,readDailyState,runDay,sessionPlan,shouldRunMl} from '../../scripts/daily-orchestrator.ts';
import {acquireCollectorLock} from '../../trading_poc_001_bollinger/src/phase34-collector.ts';
import {appendSuccessfulCapture} from '../../trading_poc_001_bollinger/src/phase32-ingestion.ts';

const folders:string[]=[];afterEach(()=>folders.splice(0).forEach(path=>rmSync(path,{recursive:true,force:true})));
function temporary(){const path=mkdtempSync(join(tmpdir(),'daily-automation-'));folders.push(path);return path;}
describe('orquestación diaria',()=>{
  it('respeta festivos, cierres anticipados y cambios EST/EDT',()=>{
    const regular=new Map([['2026-03-06',{open:570,close:960}],['2026-03-09',{open:570,close:960}]]);
    expect(sessionPlan(regular,Date.parse('2026-03-08T16:00:00Z'))).toMatchObject({current:null,next:'2026-03-09'});
    expect(sessionPlan(regular,Date.parse('2026-03-06T16:00:00Z')).lastDue).toBe(Date.parse('2026-03-06T21:20:00Z'));
    expect(sessionPlan(regular,Date.parse('2026-03-09T16:00:00Z')).lastDue).toBe(Date.parse('2026-03-09T20:20:00Z'));
    const early=new Map([['2026-11-26',{open:570,close:960}],['2026-11-27',{open:570,close:780}],['2026-11-30',{open:570,close:960}]]);
    expect(sessionPlan(early,Date.parse('2026-11-27T18:00:00Z'))).toMatchObject({current:'2026-11-27',next:'2026-11-30',lastDue:Date.parse('2026-11-27T18:20:00Z')});
  });
  it('respeta el bloqueo manual y recupera una ejecución posterior sin generar observaciones retrospectivas',async()=>{
    const dir=temporary(),collector=join(dir,'collector.json'),release=acquireCollectorLock(collector);
    expect(shouldRunMl(collector)).toBe(false);release();expect(shouldRunMl(collector)).toBe(true);
    const env={...process.env,TRADING_POC_PRIVATE_DIR:dir,TRADING_POC_DAILY_STATUS:join(dir,'daily.json'),TRADING_POC_ML_COLLECTOR_STATUS:collector,APCA_API_KEY_ID:'fixture',APCA_API_SECRET_KEY:'fixture'};
    const calls:string[]=[];
    const calendar=async()=>new Map([['2026-10-21',{open:570,close:960}],['2026-10-22',{open:570,close:960}]]);
    const run=async(_program:string,args:string[])=>{calls.push(args.join(' '));return {code:args.includes('analyze')?1:0,output:''};};
    let recovered=0;
    const result=await runDay({env,now:()=>Date.parse('2026-10-21T21:30:00Z'),calendar:calendar as never,run,once:true,recover:async()=>{recovered++;}});
    expect(recovered).toBe(2);
    expect(calls.some(value=>value.includes('phase35-cli.ts'))).toBe(true);
    expect(calls.some(value=>value.includes('ml-collect.mjs'))).toBe(true);
    expect(calls.some(value=>/news[\\/]cli\.ts/.test(value)&&value.includes('collect'))).toBe(true);
    expect(result).toMatchObject({lastSessionNy:'2026-10-21',nextSessionNy:'2026-10-22',pendingErrors:['NEWS_CLASSIFICATION_PENDING'],newPredictions:0});
    expect(readDailyState(dailyStatePath(env))).toEqual(result);
    expect(readFileSync(dailyStatePath(env),'utf8')).not.toContain('fixture');
  });
  it('impide dos instancias y recupera el bloqueo de un PID terminado',()=>{
    const path=join(temporary(),'status.json'),release=acquireDailyLock(path);
    expect(()=>acquireDailyLock(path)).toThrow(/DAILY_ALREADY_ACTIVE/);release();
    const second=acquireDailyLock(path);second();
    writeFileSync(`${path}.lock`,'99999999');const recovered=acquireDailyLock(path);recovered();
  });
  it('recoge noticias antes y durante la sesión sin esperar a Ollama para consultar Alpaca',async()=>{
    const dir=temporary(),env={...process.env,TRADING_POC_PRIVATE_DIR:dir,TRADING_POC_DAILY_STATUS:join(dir,'daily.json'),TRADING_POC_ML_COLLECTOR_STATUS:join(dir,'collector.json'),APCA_API_KEY_ID:'fixture',APCA_API_SECRET_KEY:'fixture'};
    let current=Date.parse('2026-10-21T13:50:00Z');const calls:{name:string;at:number}[]=[];
    const run=async(_program:string,args:string[])=>{calls.push({name:args.join(' '),at:current});return {code:args.includes('analyze')?1:0,output:''};};
    await runDay({env,now:()=>current,calendar:(async()=>new Map([['2026-10-21',{open:570,close:600}],['2026-10-22',{open:570,close:600}]])) as never,run,recover:async()=>{},wait:async at=>{current=at;}});
    const news=calls.filter(call=>/news[\\/]cli\.ts/.test(call.name)&&call.name.includes('collect'));
    const ml=calls.filter(call=>call.name.includes('ml-collect.mjs'));
    expect(news.length).toBeGreaterThan(1);expect(news[0]!.at).toBe(Date.parse('2026-10-21T13:50:00Z'));
    expect(ml.length).toBe(2);expect(ml[0]!.at).toBe(Date.parse('2026-10-21T14:05:00Z'));
  });
  it('detecta sesiones incompletas de viernes a lunes y varios días sin conexión',()=>{
    const ledger=join(temporary(),'ledger.jsonl');
    appendSuccessfulCapture(ledger,{candles:[{timestamp:'2026-10-15T13:30:00.000Z',open:1,high:2,low:1,close:2,volume:10}],queryAtUtc:'2026-10-15T14:05:00.000Z',receivedAtUtc:'2026-10-15T14:05:00.000Z',responseSha256:'a'.repeat(64),availability:'DELAYED',barAgeMs:20*60_000});
    const calendar=new Map([['2026-10-15',{open:570,close:585}],['2026-10-16',{open:570,close:600}],['2026-10-19',{open:570,close:600}],['2026-10-20',{open:570,close:600}]]);
    expect(missingSessionWindows(calendar,ledger,Date.parse('2026-10-20T21:00:00Z')).map(row=>row.date)).toEqual(['2026-10-16','2026-10-19','2026-10-20']);
  });
});
