import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,openSync,closeSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {config as loadEnv} from 'dotenv';
import {fetchAlpacaCalendar} from '../trading_poc_001_bollinger/src/alpaca-calendar.ts';
import {collectorSchedule,isCollectorActive,readCollectorStatus} from '../trading_poc_001_bollinger/src/phase34-collector.ts';
import {readEvaluations} from '../trading_poc_001_bollinger/src/phase35-evaluation.ts';
import {readIngestion} from '../trading_poc_001_bollinger/src/phase32-ingestion.ts';
import {captureOnce} from '../trading_poc_001_bollinger/src/phase32-capture-once.ts';
import {readForwardObservations} from '../trading_poc_001_bollinger/src/phase34-forward-observation.ts';
import {newsPaths} from '../apps/api/src/news/paths.ts';
import {readNews,readNewsAnalyses} from '../apps/api/src/news/store.ts';

const root=fileURLToPath(new URL('../',import.meta.url));
export type DailyState={schema:'daily-automation-v1';updatedAtUtc:string;lastRunAtUtc:string|null;lastSessionNy:string|null;nextSessionNy:string|null;pendingErrors:string[];barsReceived:number;newPredictions:number;evaluationsCompleted:number;newsCollected:number;classifications:number};
export const dailyStatePath=(env:NodeJS.ProcessEnv=process.env)=>env.TRADING_POC_DAILY_STATUS??resolve(env.TRADING_POC_PRIVATE_DIR??resolve(root,'private'),'daily-automation','status.json');
const state=(at:string):DailyState=>({schema:'daily-automation-v1',updatedAtUtc:at,lastRunAtUtc:null,lastSessionNy:null,nextSessionNy:null,pendingErrors:[],barsReceived:0,newPredictions:0,evaluationsCompleted:0,newsCollected:0,classifications:0});
export function readDailyState(path:string):DailyState|null{if(!existsSync(path))return null;const row=JSON.parse(readFileSync(path,'utf8')) as DailyState;if(row.schema!=='daily-automation-v1'||!Array.isArray(row.pendingErrors))throw new Error('Estado diario inválido.');return row;}
export function saveDailyState(path:string,row:DailyState){mkdirSync(dirname(path),{recursive:true});const temp=`${path}.${randomUUID()}.tmp`;try{writeFileSync(temp,JSON.stringify(row)+'\n',{flag:'wx'});renameSync(temp,path);}catch(error){rmSync(temp,{force:true});throw error;}}
export function sessionPlan(calendar:Map<string,{open:number;close:number}>,now:number){
  const dates=[...calendar.keys()].sort();const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now)).map(part=>[part.type,part.value]));
  const today=`${parts.year}-${parts.month}-${parts.day}`;
  const current=calendar.has(today)?today:null;
  const next=dates.find(date=>date>today)??null;
  const last=current?collectorSchedule(new Map([[current,calendar.get(current)!]]),Number.MAX_SAFE_INTEGER).latestDue:null;
  return {current,next,lastDue:last};
}
export function shouldRunMl(statusPath:string){return !isCollectorActive(statusPath);}
export function acquireDailyLock(path:string):()=>void{
  mkdirSync(dirname(path),{recursive:true});const lock=`${path}.lock`;
  try{const fd=openSync(lock,'wx');writeFileSync(fd,String(process.pid));closeSync(fd);}
  catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
    const owner=Number(readFileSync(lock,'utf8'));
    if(Number.isSafeInteger(owner)&&owner>0){try{process.kill(owner,0);}catch(probe){if((probe as NodeJS.ErrnoException).code==='ESRCH'){rmSync(lock,{force:true});return acquireDailyLock(path);}}}
    throw new Error('DAILY_ALREADY_ACTIVE');
  }
  return ()=>rmSync(lock,{force:true});
}
function nyDate(utc:string){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(utc)).map(part=>[part.type,part.value]));return `${parts.year}-${parts.month}-${parts.day}`;}
/** Bounded one-session queries; the Alpaca endpoint limit of 10,000 exceeds 26 regular 15m bars. */
export function missingSessionWindows(calendar:Map<string,{open:number;close:number}>,ledgerPath:string,now:number){
  const bars=existsSync(ledgerPath)?readIngestion(ledgerPath).filter(row=>row.kind==='bar'&&row.bar):[];
  if(!bars.length)return [];
  const first=bars.map(row=>row.bar!.startUtc).sort()[0]!,seen=new Set(bars.map(row=>row.bar!.startUtc));
  const output:{date:string;start:string;end:string}[]=[];
  for(const [date,hours] of [...calendar].sort(([a],[b])=>a.localeCompare(b))){
    const count=(hours.close-hours.open)/15,last=collectorSchedule(new Map([[date,hours]]),Number.MAX_SAFE_INTEGER).latestDue;
    if(last===null||last>now||date<nyDate(first))continue;
    const start=last-(count-1)*900_000-35*60_000,end=last-35*60_000;
    if(Array.from({length:count},(_,i)=>new Date(start+i*900_000).toISOString()).some(at=>!seen.has(at)))output.push({date,start:new Date(start).toISOString(),end:new Date(end).toISOString()});
  }
  if(output.length>30)throw new Error('ML_CATCHUP_RANGE_EXCEEDED');
  return output;
}
type RunResult={code:number|null;output:string};
export function runChild(program:string,args:string[],timeoutMs=180_000):Promise<RunResult>{return new Promise((done)=>{
  const child=spawn(program,args,{cwd:root,env:process.env,windowsHide:true,stdio:['ignore','pipe','ignore']});let output='';
  child.stdout.on('data',(chunk:Buffer)=>{if(output.length<8192)output+=chunk.toString('utf8').slice(0,8192-output.length);});
  const timer=setTimeout(()=>child.kill(),timeoutMs);
  child.once('error',()=>{clearTimeout(timer);done({code:-1,output:''});});child.once('close',code=>{clearTimeout(timer);done({code,output});});
});}
function count(path:string,reader:(path:string)=>unknown[]){return existsSync(path)?reader(path).length:0;}
function waitUntil(at:number){return new Promise<void>(done=>setTimeout(done,Math.max(0,Math.min(at-Date.now(),2_147_000_000))));}
export async function runDay(options:{now?:()=>number;calendar?:typeof fetchAlpacaCalendar;run?:typeof runChild;wait?:typeof waitUntil;env?:NodeJS.ProcessEnv;once?:boolean;recover?:()=>Promise<void>}={}){
  const env=options.env??process.env,now=options.now??Date.now,run=options.run??runChild,wait=options.wait??waitUntil;
  const statusPath=dailyStatePath(env),collectorPath=env.TRADING_POC_ML_COLLECTOR_STATUS??resolve(root,'private','ml-collector','status.json');
  const unlock=acquireDailyLock(statusPath);
  try{return await runLockedDay();}finally{unlock();}
  async function runLockedDay(){
  const ledger=env.TRADING_POC_ALPACA_INGESTION_LOG??resolve(root,'private','alpaca-ingestion','ledger.jsonl');
  const observations=env.TRADING_POC_ML_FORWARD_OBSERVATION_LOG??resolve(root,'private','ml-forward-observation','records.jsonl');
  const evaluations=env.TRADING_POC_ML_EVALUATION_LOG??resolve(root,'private','ml-evaluation','records.jsonl');
  const news=newsPaths({repoRoot:root,env});let row=readDailyState(statusPath)??state(new Date(now()).toISOString());
  const errors:string[]=[];const counts=()=>({bars:count(ledger,p=>readIngestion(p).filter(r=>r.kind==='bar')),predictions:count(observations,readForwardObservations),evaluations:count(evaluations,p=>readEvaluations(p).filter(r=>r.kind==='EVALUATED')),news:count(news.newsLog,readNews),classifications:count(news.analysisLog,readNewsAnalyses)});
  const before=counts();
  let newsCollection:Promise<void>|null=null,classification:Promise<void>|null=null;
  const newsTick=()=>{
    if(!newsCollection)newsCollection=run(process.execPath,['--experimental-strip-types',resolve(root,'apps/api/src/news/cli.ts'),'collect','--once']).then(result=>{if(result.code!==0)errors.push('NEWS_COLLECT_FAILED');}).finally(()=>{newsCollection=null;});
    if(!classification)classification=run(process.execPath,['--experimental-strip-types',resolve(root,'apps/api/src/news/cli.ts'),'analyze','--once']).then(result=>{if(result.code!==0)errors.push('NEWS_CLASSIFICATION_PENDING');}).finally(()=>{classification=null;});
  };
  newsTick();const newsTimer=options.once?null:setInterval(newsTick,15*60_000);
  try{
    const key=env.APCA_API_KEY_ID,secret=env.APCA_API_SECRET_KEY;
    if(!key||!secret)throw new Error('ALPACA_CREDENTIALS_MISSING');
    const calendar=await (options.calendar??fetchAlpacaCalendar)({apiKey:key,secretKey:secret,start:new Date(now()-30*86_400_000).toISOString(),end:new Date(now()+14*86_400_000).toISOString()});
    let plan=sessionPlan(calendar,now());row={...row,nextSessionNy:plan.next};saveDailyState(statusPath,row);
    const earliest=[...calendar.keys()].sort()[0];
    if(row.lastSessionNy&&earliest&&row.lastSessionNy<earliest)errors.push('ML_CATCHUP_RANGE_EXCEEDED');
    const recover=options.recover??(async()=>{for(const window of missingSessionWindows(calendar,ledger,now()))await captureOnce({ledgerPath:ledger,calendarPath:env.TRADING_POC_ALPACA_INGESTION_CALENDAR??`${ledger}.calendar.json`,apiKey:key,secretKey:secret,delayMinutes:20,calendar:new Map([[window.date,calendar.get(window.date)!]]),historicalWindow:window});});
    // Restore delayed history and evaluate existing predictions after a missed day.
    // This path never invokes the observer, so old bars cannot become forward predictions.
    if(row.lastSessionNy!==plan.current&&shouldRunMl(collectorPath)){
      try{await recover();}catch{errors.push('ML_CATCHUP_FAILED');}
      const evaluation=await run(process.execPath,['--experimental-strip-types',resolve(root,'trading_poc_001_bollinger/src/phase35-cli.ts'),'--once']);
      if(evaluation.code!==0)errors.push('ML_EVALUATION_FAILED');
    }
    if(plan.current){
      // Schedule every delayed 15-minute close. On a resumed computer, process only
      // current eligible bars; the existing collector refuses historical backfill.
      let previous=0;
      while(true){
        const current=now(),schedule=collectorSchedule(new Map([[plan.current,calendar.get(plan.current)!]]),current);
        if(schedule.latestDue!==null&&schedule.latestDue>previous){
          if(shouldRunMl(collectorPath)){
            let result=await run(process.execPath,[resolve(root,'scripts/ml-collect.mjs'),'--once']);
            for(let attempt=0;result.code!==0&&attempt<2&&!options.once;attempt++){
              const status=readCollectorStatus(collectorPath),retryAt=Date.parse(status?.nextQueryAtUtc??'');
              if(!status?.retryable||!Number.isFinite(retryAt)||retryAt<=now()||retryAt>(plan.lastDue??retryAt))break;
              await wait(retryAt);if(!shouldRunMl(collectorPath))break;
              result=await run(process.execPath,[resolve(root,'scripts/ml-collect.mjs'),'--once']);
            }
            if(result.code!==0)errors.push('ML_COLLECT_FAILED');
          }else errors.push('ML_COLLECT_ALREADY_ACTIVE');
          previous=schedule.latestDue;
        }
        if(options.once||plan.lastDue===null||now()>=plan.lastDue)break;
        await wait(schedule.next??plan.lastDue);
        newsTick();
      }
      // Recovery after suspend: ingest permitted delayed history for evaluation
      // only. The observer never receives these historical bars as new predictions.
      if(now()>=plan.lastDue!&&shouldRunMl(collectorPath)){
        try{await recover();}catch{errors.push('ML_CATCHUP_FAILED');}
        const evaluation=await run(process.execPath,['--experimental-strip-types',resolve(root,'trading_poc_001_bollinger/src/phase35-cli.ts'),'--once']);
        if(evaluation.code!==0)errors.push('ML_EVALUATION_FAILED');
      }
      row.lastSessionNy=plan.current;
    }
  }catch{errors.push('CALENDAR_OR_CONFIGURATION_FAILED');}
  if(newsTimer)clearInterval(newsTimer);
  await Promise.all([newsCollection,classification]);
  const after=counts();row={...row,updatedAtUtc:new Date(now()).toISOString(),lastRunAtUtc:new Date(now()).toISOString(),pendingErrors:errors,barsReceived:Math.max(0,after.bars-before.bars),newPredictions:Math.max(0,after.predictions-before.predictions),evaluationsCompleted:Math.max(0,after.evaluations-before.evaluations),newsCollected:Math.max(0,after.news-before.news),classifications:Math.max(0,after.classifications-before.classifications)};
  saveDailyState(statusPath,row);return row;
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  loadEnv({path:resolve(root,'.env.local'),override:false,quiet:true});loadEnv({path:resolve(root,'.env'),override:false,quiet:true});
  if(process.argv.slice(2).join(' ')!=='--once')throw new Error('Uso: npm.cmd run daily:run -- --once');
  try{const result=await runDay();process.stdout.write(JSON.stringify(result)+'\n');if(result.pendingErrors.length)process.exitCode=1;}
  catch{process.stderr.write('Orquestación diaria fallida. Consulte el estado privado.\n');process.exitCode=1;}
}
