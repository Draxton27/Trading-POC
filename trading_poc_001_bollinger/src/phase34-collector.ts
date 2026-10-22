/** Coordinated, delayed SIP collection. No prediction is made from old or repeated bars. */
import {existsSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {dirname} from 'node:path';
import {type MarketCalendar} from './alpaca-calendar.ts';
import {CAPTURE_BAR_MS, DELAYED_CAPTURE_MS} from './alpaca.ts';
import {readIngestion} from './phase32-ingestion.ts';
import {readForwardObservations} from './phase34-forward-observation.ts';
import {frozenModel} from './phase31-inference.ts';
import {assertPhase31HorizonEligible} from './phase31-inference.ts';
import {ObserverFailure,observerFailure} from './phase34-observer-errors.ts';
import {newYorkBarParts} from './strategy-validation.ts';

export type CollectorCode='RUNNING'|'MARKET_CLOSED'|'NO_NEW_BARS'|'RECORDED'|'DUPLICATE'|'INDICATORS_INSUFFICIENT'|'HORIZON_INELIGIBLE'|'OUTCOME_PASSED'|'MODEL_NOT_CONFIGURED'|'ALPACA_PERMISSION'|'ALPACA_NETWORK'|'ALPACA_RATE_LIMIT'|'LEDGER_INVALID'|'PYTHON_ERROR'|'ERROR'|'STOPPED';
export type CollectorStatus={schema:'phase34-collector-v1';state:CollectorCode;updatedAtUtc:string;lastSuccessfulIngestionAtUtc:string|null;lastBarEndUtc:string|null;lastObservationAtUtc:string|null;nextQueryAtUtc:string|null;lastError:string|null;newObservations:number;retryable?:boolean;retryCount?:number;retryBarEndUtc?:string|null};
export type CaptureOutcome={barsAdded:number;calendar:MarketCalendar};
export type CollectorDeps={ledger:string;observationLog:string;modelDir:string|undefined;statusPath:string;diagnosticPath?:string;calendar:()=>Promise<MarketCalendar>;capture:(calendar:MarketCalendar)=>Promise<CaptureOutcome>;observe:()=>Promise<{alreadyPresent:boolean}>|{alreadyPresent:boolean};clock?:()=>number;stopped?:()=>boolean};
const iso=(time:number)=>new Date(time).toISOString();
const initial=(now:number):CollectorStatus=>({schema:'phase34-collector-v1',state:'STOPPED',updatedAtUtc:iso(now),lastSuccessfulIngestionAtUtc:null,lastBarEndUtc:null,lastObservationAtUtc:null,nextQueryAtUtc:null,lastError:null,newObservations:0,retryable:false,retryCount:0,retryBarEndUtc:null});
export function readCollectorStatus(path:string):CollectorStatus|null{
  if(!existsSync(path))return null;
  const row=JSON.parse(readFileSync(path,'utf8')) as CollectorStatus;
  if(row.schema!=='phase34-collector-v1'||!Number.isSafeInteger(row.newObservations)||row.newObservations<0||!Number.isFinite(Date.parse(row.updatedAtUtc)))throw new Error('Estado del recolector inválido.');
  return row;
}
export function isCollectorActive(path:string):boolean{
  const lock=`${path}.lock`;
  if(!existsSync(lock))return false;
  try{const pid=Number(readFileSync(lock,'utf8'));if(!Number.isSafeInteger(pid)||pid<=0)return false;process.kill(pid,0);return true;}
  catch(error){return (error as NodeJS.ErrnoException).code==='EPERM';}
}
function publish(path:string,status:CollectorStatus){mkdirSync(dirname(path),{recursive:true});const temporary=`${path}.${randomUUID()}.tmp`;try{writeFileSync(temporary,JSON.stringify(status)+'\n',{flag:'wx'});renameSync(temporary,path);}catch(error){rmSync(temporary,{force:true});throw error;}}
function nyUtc(date:string,minute:number):number{
  const noon=Date.parse(`${date}T12:00:00.000Z`),local=newYorkBarParts(iso(noon));
  const [hour,mins]=local.slot.split(':').map(Number);
  return noon+(minute-(hour!*60+mins!))*60_000;
}
/** Official sessions and their true NY offset determine every useful 15m + delay instant. */
export function collectorSchedule(calendar:MarketCalendar,now:number):{latestDue:number|null;next:number|null}{
  const times:number[]=[];
  for(const [date,hours] of calendar)for(let minute=hours.open;minute<hours.close;minute+=15)times.push(nyUtc(date,minute)+CAPTURE_BAR_MS+DELAYED_CAPTURE_MS);
  times.sort((a,b)=>a-b);
  return {latestDue:times.filter(time=>time<=now).at(-1)??null,next:times.find(time=>time>now)??null};
}
export function nextCollectorWake(status:CollectorStatus,now:number):number{
  const scheduled=Date.parse(status.nextQueryAtUtc??'');
  if(Number.isFinite(scheduled)&&scheduled>now)return scheduled;
  return now+(status.retryable?5*60_000:60*60_000);
}
export function shouldEvaluateAfterIngestion(status:CollectorStatus,previous?:{updatedAtUtc?:string;state?:string}|null):boolean{
  const evaluatedAt=Date.parse(previous?.updatedAtUtc??'');
  const ingestedAt=Date.parse(status.lastSuccessfulIngestionAtUtc??'');
  if(Number.isFinite(ingestedAt)&&(!Number.isFinite(evaluatedAt)||ingestedAt>evaluatedAt))return true;
  return previous?.state==='ERROR'&&['RECORDED','DUPLICATE','NO_NEW_BARS','INDICATORS_INSUFFICIENT','HORIZON_INELIGIBLE','OUTCOME_PASSED','PYTHON_ERROR'].includes(status.state);
}
export function collectorError(error:unknown):CollectorCode{
  if(error instanceof ObserverFailure)return error.code;
  if(error instanceof SyntaxError)return 'LEDGER_INVALID';
  const status=typeof error==='object'&&error!==null&&'status'in error?String(error.status):'';
  if(status==='PERMISSION_DENIED'||status==='RECENT_DATA_FORBIDDEN')return 'ALPACA_PERMISSION';
  if(status==='RATE_LIMIT')return 'ALPACA_RATE_LIMIT';
  if(status==='NETWORK_ERROR'||status==='HTTP_ERROR')return 'ALPACA_NETWORK';
  const message=error instanceof Error?error.message:'';
  if(/Indicadores insuficientes|continuidad temporal/i.test(message))return 'INDICATORS_INSUFFICIENT';
  if(/horizonte Fase 23/i.test(message))return 'HORIZON_INELIGIBLE';
  if(/desenlace|backfill/i.test(message))return 'OUTCOME_PASSED';
  if(/modelo|TRADING_POC_ML_RUN_DIR|artefactos/i.test(message))return 'MODEL_NOT_CONFIGURED';
  if(/ledger|registro de ingesta|calendario|hash|secuencial|alterado/i.test(message))return 'LEDGER_INVALID';
  if(/Inferencia XGBoost|Python/i.test(message))return 'PYTHON_ERROR';
  return 'ERROR';
}
/** Diagnostic details stay in a private file; the API receives only lastError codes. */
function appendPythonDiagnostic(path:string,error:unknown,atUtc:string,barEndUtc:string|null){
  const report=observerFailure(error);
  if(report.code!=='PYTHON_ERROR')return;
  mkdirSync(dirname(path),{recursive:true});
  writeFileSync(path,JSON.stringify({schema:'phase34-python-diagnostic-v1',atUtc,barEndUtc,exitCode:report.exitCode,signal:report.signal,cause:report.cause})+'\n',{flag:'a'});
}
/** A process-level lock encloses calendar, capture, ledger inspection and inference. */
export function acquireCollectorLock(path:string):()=>void{
  mkdirSync(dirname(path),{recursive:true});const lock=`${path}.lock`;
  try{const fd=openSync(lock,'wx');writeFileSync(fd,String(process.pid));closeSync(fd);}catch(error){
    if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
    const owner=Number(readFileSync(lock,'utf8'));
    if(Number.isSafeInteger(owner)&&owner>0){try{process.kill(owner,0);}catch(probe){if((probe as NodeJS.ErrnoException).code==='ESRCH'){rmSync(lock,{force:true});return acquireCollectorLock(path);}}}
    throw new Error('El recolector ya está activo.');
  }
  return ()=>rmSync(lock,{force:true});
}
export async function collectOnce(deps:CollectorDeps):Promise<CollectorStatus>{
  const now=deps.clock??Date.now,at=now();let status:CollectorStatus;
  status=readCollectorStatus(deps.statusPath)??initial(at);
  const previous=status;let scheduledNext:string|null=null;
  const update=(state:CollectorCode,fields:Partial<CollectorStatus>={})=>{status={...status,retryable:false,retryCount:0,retryBarEndUtc:null,...fields,state,updatedAtUtc:iso(now())};publish(deps.statusPath,status);return status;};
  const fail=(error:unknown,base:Partial<CollectorStatus>={})=>{
    const code=collectorError(error),barEndUtc=base.lastBarEndUtc??status.lastBarEndUtc;
    if(code==='PYTHON_ERROR')appendPythonDiagnostic(deps.diagnosticPath??`${deps.statusPath}.python.jsonl`,error,iso(now()),barEndUtc??null);
    const transient=code==='ALPACA_NETWORK'||code==='ALPACA_RATE_LIMIT'||(error instanceof ObserverFailure&&error.details.retryable===true);
    const count=transient?(previous.retryBarEndUtc===barEndUtc&&previous.retryable?(previous.retryCount??0)+1:1):0;
    const retryable=transient&&count<3;
    const retryAt=retryable?iso(now()+Math.min(60_000*2**(count-1),240_000)):null;
    return update(code,{...base,lastError:code,retryable,retryCount:count,retryBarEndUtc:barEndUtc??null,
      nextQueryAtUtc:retryAt&&(!scheduledNext||retryAt<scheduledNext)?retryAt:scheduledNext});
  };
  update('RUNNING');
  try{
    // The append-only observation ledger is authoritative after an interrupted status update.
    if(existsSync(deps.observationLog))status.newObservations=Math.max(status.newObservations,readForwardObservations(deps.observationLog).length);
    const calendar=await deps.calendar(),schedule=collectorSchedule(calendar,now());
    const nextQueryAtUtc=schedule.next===null?null:iso(schedule.next);scheduledNext=nextQueryAtUtc;
    if(deps.stopped?.())return update('STOPPED',{nextQueryAtUtc});
    if(schedule.latestDue===null||now()-schedule.latestDue>=CAPTURE_BAR_MS){
      const local=newYorkBarParts(iso(now())),hours=calendar.get(local.day),[hour,minute]=local.slot.split(':').map(Number),nyMinute=hour!*60+minute!;
      return update(hours&&nyMinute>=hours.open&&nyMinute<hours.close?'NO_NEW_BARS':'MARKET_CLOSED',{nextQueryAtUtc,lastError:null});
    }
    const prior=existsSync(deps.ledger)?readIngestion(deps.ledger):[];
    const lastQuery=prior.filter(row=>row.kind==='query').at(-1);
    const alreadyQueried=!!lastQuery&&Date.parse(lastQuery.queryAtUtc??lastQuery.receivedAtUtc)>=schedule.latestDue;
    const latestBefore=prior.filter(row=>row.kind==='bar'&&row.bar).sort((a,b)=>Date.parse(b.bar!.endUtc)-Date.parse(a.bar!.endUtc))[0]?.bar?.startUtc;
    const capture=alreadyQueried?null:await deps.capture(calendar);
    if(deps.stopped?.())return update('STOPPED',{nextQueryAtUtc});
    const ingested=alreadyQueried?prior:readIngestion(deps.ledger),latest=ingested.filter(row=>row.kind==='bar'&&row.bar).sort((a,b)=>Date.parse(b.bar!.endUtc)-Date.parse(a.bar!.endUtc))[0];
    const base={lastSuccessfulIngestionAtUtc:ingested.filter(row=>row.kind==='query').at(-1)?.receivedAtUtc??iso(now()),lastBarEndUtc:latest?.bar?.endUtc??null,nextQueryAtUtc,lastError:null};
    // A crash after appending the bar but before observing it must be recoverable
    // during the same eligible interval, while never promoting an older backfill.
    const dueBar=!!latest?.bar&&Date.parse(latest.bar.endUtc)+DELAYED_CAPTURE_MS===schedule.latestDue;
    if(!latest||(!alreadyQueried&&(capture?.barsAdded===0||latest.bar?.startUtc===latestBefore))||(alreadyQueried&&!dueBar))return update('NO_NEW_BARS',base);
    if(!deps.modelDir)return update('MODEL_NOT_CONFIGURED',{...base,lastError:'MODEL_NOT_CONFIGURED'});
    const model=frozenModel(deps.modelDir);
    if(existsSync(deps.observationLog)&&readForwardObservations(deps.observationLog).some(row=>row.model.sha256===model.sha256&&row.bar.startUtc===latest.bar!.startUtc))return update('DUPLICATE',base);
    if(deps.stopped?.())return update('STOPPED',base);
    try{assertPhase31HorizonEligible(latest.bar!.startUtc,calendar);}catch(error){return fail(error,base);}
    try{
      const observed=await deps.observe();
      if(observed.alreadyPresent)return update('DUPLICATE',base);
      const recorded=readForwardObservations(deps.observationLog).at(-1);
      return update('RECORDED',{...base,lastObservationAtUtc:recorded?.registeredAtUtc??iso(now()),newObservations:status.newObservations+1});
    }catch(error){return fail(error,base);}
  }catch(error){return fail(error);}
}
