/** IEX Live coordination for the existing daily task. The stream and inference remain separate processes. */
import {spawn,type ChildProcess} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolvePrivateDir} from '../apps/api/src/news/paths.ts';
import {isIexProcessActive} from '../trading_poc_001_bollinger/src/phase38-iex-lock.ts';
import {readIexLedger,type IexRecord} from '../trading_poc_001_bollinger/src/phase38-iex.ts';
import {MAX_LIVE_AGE_MS,readIexObservations,type IexObservationRecord,type IexFrozen} from '../trading_poc_001_bollinger/src/phase38f-iex-observation.ts';

const root=fileURLToPath(new URL('../',import.meta.url));
export const IEX_FROZEN_SHA='b9bbece648544b39e1e4c4946933e4f4de2d65ec5094997938b25791cb1bb684';
export const IEX_POLL_MS=60_000;
/** collectorSchedule's last due time is the official close plus SIP's 20-minute delay. */
export function iexCollectorAllowed(session:{open:number;close:number}|undefined,lastDue:number|null,now:number){
  if(!session||lastDue===null)return false;
  const close=lastDue-20*60_000,open=close-(session.close-session.open)*60_000;
  return now>=open-90*60_000&&now<close;
}
export const iexEvaluationFinalAt=(lastDue:number)=>lastDue+10*60_000;
export type IexDailyState={schema:'phase38g-iex-daily-v1';updatedAtUtc:string;collector:'ACTIVE'|'DISCONNECTED'|'STOPPED';owner:'MANAGED'|'EXTERNAL'|'NONE';
  feedStatus:string|null;lastCompleteBarEndUtc:string|null;lastCompleteReceivedAtUtc:string|null;lastPredictionAtUtc:string|null;
  pendingEvaluations:number;completedEvaluations:number;lastErrorCode:string|null;freshness:'FRESH'|'STALE'|'NO_LIVE_DATA';
  observationStatus:string;nextCheckAtUtc:string|null;lastAttemptedBarStartUtc:string|null;attemptCount:number;retryAtUtc:string|null};
type RunResult={code:number|null;output:string};
type OwnedCollector=Pick<ChildProcess,'stdin'|'kill'|'once'>;
export type IexDailyOptions={env?:NodeJS.ProcessEnv;clock?:()=>number;run?:(mode:'--once'|'--evaluate-only')=>Promise<RunResult>;
  startCollector?:()=>OwnedCollector;active?:(path:string)=>boolean;readLedger?:(path:string)=>IexRecord[];
  readObservations?:(path:string)=>IexObservationRecord[];verifyModel?:(barStartUtc:string)=>string|null;
  statePath?:string};
export const iexDailyStatePath=(env:NodeJS.ProcessEnv=process.env)=>env.TRADING_POC_IEX_AUTOMATION_STATUS??resolve(resolvePrivateDir({repoRoot:root,env}),'ml-iex','daily-status.json');
export const iexLedgerPath=(env:NodeJS.ProcessEnv=process.env)=>env.TRADING_POC_IEX_LEDGER??resolve(resolvePrivateDir({repoRoot:root,env}),'iex','ledger.jsonl');
export const iexObservationPath=(env:NodeJS.ProcessEnv=process.env)=>env.TRADING_POC_IEX_OBSERVATION_LEDGER??resolve(resolvePrivateDir({repoRoot:root,env}),'ml-iex','observations.jsonl');
const iso=(time:number)=>new Date(time).toISOString();
const initial=(now:number):IexDailyState=>({schema:'phase38g-iex-daily-v1',updatedAtUtc:iso(now),collector:'STOPPED',owner:'NONE',feedStatus:null,
  lastCompleteBarEndUtc:null,lastCompleteReceivedAtUtc:null,lastPredictionAtUtc:null,pendingEvaluations:0,completedEvaluations:0,
  lastErrorCode:null,freshness:'NO_LIVE_DATA',observationStatus:'NO_LIVE_DATA',nextCheckAtUtc:null,
  lastAttemptedBarStartUtc:null,attemptCount:0,retryAtUtc:null});
export function readIexDailyState(path:string):IexDailyState|null{
  if(!existsSync(path))return null;
  const row=JSON.parse(readFileSync(path,'utf8')) as IexDailyState;
  if(row.schema!=='phase38g-iex-daily-v1'||!['ACTIVE','DISCONNECTED','STOPPED'].includes(row.collector)||
    !['FRESH','STALE','NO_LIVE_DATA'].includes(row.freshness))throw new Error('IEX_AUTOMATION_STATE_INVALID');
  return row;
}
function save(path:string,row:IexDailyState){mkdirSync(dirname(path),{recursive:true});const temporary=`${path}.${randomUUID()}.tmp`;
  try{writeFileSync(temporary,JSON.stringify(row)+'\n',{flag:'wx'});renameSync(temporary,path);}
  catch(error){rmSync(temporary,{force:true});throw error;}}
/** Choose the latest quarter by bar time, retaining its first complete Live version. */
export function latestFirstIexQuarter(records:readonly IexRecord[],now:number):IexRecord|null{
  const first=new Map<string,IexRecord>();
  for(const row of records){if(row.kind!=='quarter'||row.status!=='COMPLETE'||!row.bar||Date.parse(row.receivedAtUtc)>now)continue;
    if(!first.has(row.bar.startUtc))first.set(row.bar.startUtc,row);}
  return [...first.values()].sort((a,b)=>a.bar!.endUtc.localeCompare(b.bar!.endUtc)).at(-1)??null;
}
export function pendingIexEvaluations(records:readonly IexObservationRecord[],now:number){
  const done=new Set(records.filter(row=>row.kind==='EVALUATION').map(row=>row.predictionId));
  return records.filter(row=>row.kind==='PREDICTION'&&!done.has(row.id)&&now>=Date.parse(row.outcomeAtUtc)+30*60_000).length;
}
/** The configured model is the frozen IEX experiment, not a later run selected at startup. */
export function verifyIexDailyModel(env:NodeJS.ProcessEnv,barStartUtc:string):string|null{
  const directory=env.TRADING_POC_IEX_FROZEN_DIR;if(!directory)return 'MODEL_NOT_CONFIGURED';
  try{const frozen=JSON.parse(readFileSync(join(directory,'freeze.json'),'utf8')) as IexFrozen;
    const actual=createHash('sha256').update(readFileSync(join(directory,'model.json'))).digest('hex');
    if(frozen.schema!=='phase38f-frozen-v1'||frozen.modelSha256!==IEX_FROZEN_SHA||actual!==IEX_FROZEN_SHA)return 'MODEL_INCOMPATIBLE';
    if(Date.parse(frozen.cutoffUtc)>=Date.parse(barStartUtc)||Date.parse(frozen.frozenAtUtc)>=Date.parse(barStartUtc))return 'MODEL_TOO_RECENT';
    return null;
  }catch{return 'MODEL_INCOMPATIBLE';}
}
function defaultCollector(env:NodeJS.ProcessEnv):OwnedCollector{
  // Direct Node child: no npm/cmd descendants. Closing stdin also stops it if the task exits unexpectedly.
  return spawn(process.execPath,['--import','tsx',resolve(root,'trading_poc_001_bollinger/src/phase38-iex-cli.ts'),'--continuous'],
    {cwd:root,env:{...env,TRADING_POC_IEX_MANAGED:'1'},stdio:['pipe','ignore','ignore'],windowsHide:true});
}
export function createIexDaily(options:IexDailyOptions={}){
  const env=options.env??process.env,clock=options.clock??Date.now,ledger=iexLedgerPath(env),observations=iexObservationPath(env),path=options.statePath??iexDailyStatePath(env);
  const active=options.active??isIexProcessActive,readLedger=options.readLedger??readIexLedger,readObservations=options.readObservations??readIexObservations;
  const verifyModel=options.verifyModel??((bar:string)=>verifyIexDailyModel(env,bar));
  const startedAt=clock();
  const run=options.run??(async(mode:'--once'|'--evaluate-only')=>{
    const child=spawn(process.execPath,['--experimental-strip-types',resolve(root,'trading_poc_001_bollinger/src/phase38f-cli.ts'),mode],
      {cwd:root,env,stdio:['ignore','pipe','ignore'],windowsHide:true});
    return await new Promise<RunResult>(done=>{let output='',settled=false;const finish=(code:number|null)=>{if(settled)return;settled=true;clearTimeout(timer);done({code,output});};
      child.stdout?.on('data',(part:Buffer)=>{if(output.length<2048)output+=part.toString('utf8').slice(0,2048-output.length);});
      const timer=setTimeout(()=>{child.kill();finish(-1);},45_000);child.once('error',()=>finish(-1));child.once('close',code=>finish(code));});
  });
  let owned:OwnedCollector|null=null,ownedDone:Promise<void>|null=null,stopRequested=false,collectorFailures=0,retryCollectorAt=0;
  let row:IexDailyState;
  try{row=readIexDailyState(path)??initial(clock());}
  catch{row={...initial(clock()),lastErrorCode:'IEX_AUTOMATION_STATE_INVALID'};}
  const start=()=>{
    try{const child=(options.startCollector??(()=>defaultCollector(env)))();owned=child;
      ownedDone=new Promise<void>(done=>{let settled=false;const close=()=>{if(settled)return;settled=true;owned=null;ownedDone=null;
        if(!stopRequested){collectorFailures++;retryCollectorAt=clock()+Math.min(collectorFailures*60_000,120_000);row.lastErrorCode='IEX_COLLECT_EXITED';}done();};
        child.once('error',close);child.once('close',close);});
    }catch{collectorFailures++;retryCollectorAt=clock()+60_000;row.lastErrorCode='IEX_COLLECT_START_FAILED';}
  };
  const tick=async(allowCollector:boolean,nextCheckAt:number|null)=>{
    const now=clock();row={...row,updatedAtUtc:iso(now),nextCheckAtUtc:nextCheckAt===null?null:iso(nextCheckAt)};
    try{
      const records=readLedger(ledger);let prior=readObservations(observations);
      const candidate=latestFirstIexQuarter(records,now),lastFeed=records.filter(r=>r.kind==='status').at(-1)?.status??null;
      const disconnectedAt=records.filter(r=>r.kind==='status'&&r.status==='DISCONNECTED').reduce((latest,r)=>Math.max(latest,Date.parse(r.receivedAtUtc)),0);
      row.feedStatus=lastFeed;row.lastCompleteBarEndUtc=candidate?.bar?.endUtc??null;row.lastCompleteReceivedAtUtc=candidate?.receivedAtUtc??null;
      const due=pendingIexEvaluations(prior,now);
      if(due){const result=await run('--evaluate-only');if(result.code!==0)row.lastErrorCode='IEX_EVALUATION_FAILED';
        else prior=readObservations(observations);}
      const predictions=prior.filter(r=>r.kind==='PREDICTION'),evaluations=prior.filter(r=>r.kind==='EVALUATION');
      row.lastPredictionAtUtc=predictions.at(-1)?.registeredAtUtc??null;row.completedEvaluations=evaluations.length;
      row.pendingEvaluations=predictions.length-evaluations.length;
      const collectorActive=active(ledger)||owned!==null;
      row.owner=owned?'MANAGED':collectorActive?'EXTERNAL':'NONE';
      row.collector=!collectorActive?'STOPPED':lastFeed==='DISCONNECTED'?'DISCONNECTED':'ACTIVE';
      if(allowCollector&&!collectorActive&&!stopRequested){
        if(['AUTH_FAILED','CONNECTION_LIMIT','SUBSCRIPTION_FAILED','INVALID_MESSAGE','CALENDAR_UNAVAILABLE'].includes(lastFeed??''))row.lastErrorCode='IEX_COLLECT_TERMINAL_ERROR';
        else if(collectorFailures>=3)row.lastErrorCode='IEX_COLLECT_RETRIES_EXHAUSTED';
        else if(now>=retryCollectorAt){start();if(owned){row.owner='MANAGED';row.collector='ACTIVE';}}
      }
      if(!candidate){row.freshness='NO_LIVE_DATA';row.observationStatus='NO_LIVE_DATA';}
      else if(now-Date.parse(candidate.receivedAtUtc)>MAX_LIVE_AGE_MS){row.freshness='STALE';row.observationStatus='STALE_LIVE_DATA';}
      else{
        row.freshness='FRESH';
        if(!collectorActive||['DISCONNECTED','OBSERVATION_ENDED','AUTH_FAILED','CONNECTION_LIMIT','SUBSCRIPTION_FAILED'].includes(lastFeed??'')){
          row.observationStatus='FEED_DISCONNECTED';save(path,row);return row;
        }
        if(Date.parse(candidate.receivedAtUtc)<startedAt||Date.parse(candidate.receivedAtUtc)<disconnectedAt){
          row.observationStatus='PREEXISTING_LIVE_DATA';save(path,row);return row;
        }
        const bar=candidate.bar!.startUtc;
        if(row.lastAttemptedBarStartUtc!==bar){row.lastAttemptedBarStartUtc=bar;row.attemptCount=0;row.retryAtUtc=null;}
        if(row.attemptCount===0||(row.observationStatus==='OBSERVE_FAILED'&&row.attemptCount<3&&now>=Date.parse(row.retryAtUtc??''))){
          const modelError=verifyModel(bar);
          if(modelError){row.observationStatus=modelError;row.lastErrorCode=modelError;row.attemptCount=1;}
          else{
            row.attemptCount++;const result=await run('--once');
            if(result.code!==0){row.observationStatus='OBSERVE_FAILED';row.lastErrorCode='IEX_OBSERVE_FAILED';row.retryAtUtc=iso(clock()+row.attemptCount*60_000);}
            else{let parsed:{status?:string}|null=null;try{parsed=JSON.parse(result.output) as {status?:string};}catch{}
              const allowed=['RECORDED','ALREADY_PRESENT','NO_LIVE_DATA','STALE_LIVE_DATA','INDICATORS_INSUFFICIENT','HORIZON_INELIGIBLE','MODEL_TOO_RECENT'];
              row.observationStatus=parsed?.status&&allowed.includes(parsed.status)?parsed.status:'OBSERVE_FAILED';
              if(row.observationStatus==='OBSERVE_FAILED')row.lastErrorCode='IEX_OBSERVE_OUTPUT_INVALID';
              prior=readObservations(observations);row.pendingEvaluations=prior.filter(r=>r.kind==='PREDICTION').length-prior.filter(r=>r.kind==='EVALUATION').length;
              row.lastPredictionAtUtc=prior.filter(r=>r.kind==='PREDICTION').at(-1)?.registeredAtUtc??row.lastPredictionAtUtc;
            }
          }
        }
      }
    }catch{row.lastErrorCode='IEX_LEDGER_OR_CALENDAR_INVALID';row.observationStatus='ERROR';}
    save(path,row);return row;
  };
  const stop=async()=>{
    stopRequested=true;const child=owned,completion=ownedDone;
    const closedWithin=(done:Promise<void>,ms:number)=>new Promise<boolean>(resolve=>{
      const timer=setTimeout(()=>resolve(false),ms);done.then(()=>{clearTimeout(timer);resolve(true);});
    });
    if(child&&completion){child.stdin?.end();if(!await closedWithin(completion,5_000)){child.kill();await closedWithin(completion,5_000);}}
    row={...row,collector:active(ledger)?'ACTIVE':'STOPPED',owner:active(ledger)?'EXTERNAL':'NONE',nextCheckAtUtc:null,updatedAtUtc:iso(clock())};save(path,row);
  };
  return {tick,stop,get state(){return row;}};
}
