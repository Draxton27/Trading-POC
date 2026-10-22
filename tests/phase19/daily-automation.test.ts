import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {dailyStatePath,readDailyState,runDay,sessionPlan,shouldRunMl} from '../../scripts/daily-orchestrator.ts';
import {acquireCollectorLock} from '../../trading_poc_001_bollinger/src/phase34-collector.ts';

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
    const result=await runDay({env,now:()=>Date.parse('2026-10-21T21:30:00Z'),calendar:calendar as never,run,once:true});
    expect(calls.some(value=>value.includes('phase32-cli.ts'))).toBe(true);
    expect(calls.some(value=>value.includes('phase35-cli.ts'))).toBe(true);
    expect(calls.some(value=>value.includes('ml-collect.mjs'))).toBe(true);
    expect(calls.some(value=>/news[\\/]cli\.ts/.test(value)&&value.includes('collect'))).toBe(true);
    expect(result).toMatchObject({lastSessionNy:'2026-10-21',nextSessionNy:'2026-10-22',pendingErrors:['NEWS_CLASSIFICATION_PENDING'],newPredictions:0});
    expect(readDailyState(dailyStatePath(env))).toEqual(result);
    expect(readFileSync(dailyStatePath(env),'utf8')).not.toContain('fixture');
  });
});
