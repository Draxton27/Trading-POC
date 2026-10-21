import {spawn,type ChildProcess} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {config as loadEnv} from 'dotenv';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fetchAlpacaCalendar} from './alpaca-calendar.ts';
import {captureOnce} from './phase32-capture-once.ts';
import {acquireCollectorLock,collectOnce,type CollectorStatus} from './phase34-collector.ts';

const root=fileURLToPath(new URL('../../',import.meta.url));
loadEnv({path:resolve(root,'.env.local'),override:false,quiet:true});
loadEnv({path:resolve(root,'.env'),override:false,quiet:true});
const args=process.argv.slice(2);
if(args.length!==1||!['--once','--continuous'].includes(args[0]!))throw new Error('Uso: npm.cmd run ml:collect -- --once|--continuous');
const ledger=process.env.TRADING_POC_ALPACA_INGESTION_LOG??resolve(root,'private','alpaca-ingestion','ledger.jsonl');
const calendarPath=process.env.TRADING_POC_ALPACA_INGESTION_CALENDAR??`${ledger}.calendar.json`;
const observationLog=process.env.TRADING_POC_ML_FORWARD_OBSERVATION_LOG??resolve(root,'private','ml-forward-observation','records.jsonl');
const statusPath=process.env.TRADING_POC_ML_COLLECTOR_STATUS??resolve(root,'private','ml-collector','status.json');
const key=process.env.APCA_API_KEY_ID??'',secret=process.env.APCA_API_SECRET_KEY??'';
if(!key||!secret)throw new Error('Faltan APCA_API_KEY_ID o APCA_API_SECRET_KEY en .env.local.');
const release=acquireCollectorLock(statusPath);
let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,wake:(()=>void)|undefined,activeChild:ChildProcess|undefined;
let childCleanup:Promise<void>|undefined;
const stop=()=>{
  stopped=true;if(timer)clearTimeout(timer);wake?.();
  if(activeChild?.pid){
    if(process.platform==='win32')childCleanup=new Promise(done=>{const killer=spawn('taskkill.exe',['/PID',String(activeChild!.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.once('close',()=>done());killer.once('error',()=>done());});
    else activeChild.kill('SIGTERM');
  }
};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
function observe():Promise<{alreadyPresent:boolean}>{
  return new Promise((done,reject)=>{
    const child=spawn(process.execPath,[resolve(root,'scripts/ml-observe.mjs'),'--once'],{cwd:root,env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    activeChild=child;
    let output='',errorOutput='';
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',(chunk:string)=>{output+=chunk;if(output.length>16_384)child.kill();});
    child.stderr.on('data',(chunk:string)=>{errorOutput+=chunk;if(errorOutput.length>16_384)child.kill();});
    const timeout=setTimeout(()=>child.kill(),120_000);
    child.once('error',error=>{clearTimeout(timeout);activeChild=undefined;reject(error);});
    child.once('close',code=>{
      clearTimeout(timeout);activeChild=undefined;
      if(code!==0)return reject(new Error(errorOutput.includes('TRADING_POC_ML_RUN_DIR')?'Modelo no configurado.':'Inferencia XGBoost rechazada.'));
      try{done(JSON.parse(output.trim().split(/\r?\n/).at(-1)!) as {alreadyPresent:boolean});}catch{reject(new Error('Inferencia XGBoost devolvió una respuesta inválida.'));}
    });
  });
}
async function evaluateAfterIngestion():Promise<void>{
  await new Promise<void>(done=>{
    const child=spawn(process.execPath,['--experimental-strip-types',resolve(root,'trading_poc_001_bollinger/src/phase35-cli.ts'),'--once'],{cwd:root,env:process.env,windowsHide:true,stdio:'ignore'});
    activeChild=child;
    const timeout=setTimeout(()=>child.kill(),120_000);
    child.once('error',()=>{clearTimeout(timeout);activeChild=undefined;done();});
    child.once('close',()=>{clearTimeout(timeout);activeChild=undefined;done();});
  });
}
async function cycle():Promise<CollectorStatus>{
  const now=Date.now();
  const status=await collectOnce({ledger,observationLog,modelDir:process.env.TRADING_POC_ML_RUN_DIR,statusPath,stopped:()=>stopped,
    calendar:()=>fetchAlpacaCalendar({apiKey:key,secretKey:secret,start:new Date(now-7*86_400_000).toISOString(),end:new Date(now+14*86_400_000).toISOString()}),
    capture:async calendar=>{
      const result=await captureOnce({ledgerPath:ledger,calendarPath,apiKey:key,secretKey:secret,delayMinutes:20,calendar});
      return {barsAdded:result.barsAdded,calendar};
    },
    observe});
  // Evaluation has its own status and failure domain; never prevent a new capture.
  const evaluationStatusPath=process.env.TRADING_POC_ML_EVALUATION_STATUS??resolve(root,'private','ml-evaluation','status.json');
  type PreviousEvaluation={updatedAtUtc?:string;state?:string};
  let priorEvaluation:PreviousEvaluation|null=null;
  try{if(existsSync(evaluationStatusPath))priorEvaluation=JSON.parse(readFileSync(evaluationStatusPath,'utf8')) as PreviousEvaluation;}catch{}
  const previousAt=Date.parse(priorEvaluation?.updatedAtUtc??'');
  const newDataSinceEvaluation=!!status.lastSuccessfulIngestionAtUtc&&(!Number.isFinite(previousAt)||Date.parse(status.lastSuccessfulIngestionAtUtc)>previousAt);
  if(['RECORDED','DUPLICATE','NO_NEW_BARS','INDICATORS_INSUFFICIENT','HORIZON_INELIGIBLE','OUTCOME_PASSED'].includes(status.state)&&(newDataSinceEvaluation||priorEvaluation?.state==='ERROR'))await evaluateAfterIngestion();
  process.stdout.write(JSON.stringify({state:status.state,lastBarEndUtc:status.lastBarEndUtc,nextQueryAtUtc:status.nextQueryAtUtc,newObservations:status.newObservations,lastError:status.lastError})+'\n');
  if(args[0]==='--once'&&['ALPACA_PERMISSION','ALPACA_NETWORK','ALPACA_RATE_LIMIT','LEDGER_INVALID','PYTHON_ERROR','ERROR','MODEL_NOT_CONFIGURED'].includes(status.state))process.exitCode=1;
  return status;
}
try{
  do{
    const status=await cycle();
    if(args[0]==='--once'||stopped)break;
    // A failed request is retried after a bounded delay; normal cycles wait for the next official bar.
    const failed=['ALPACA_PERMISSION','ALPACA_NETWORK','ALPACA_RATE_LIMIT','LEDGER_INVALID','PYTHON_ERROR','ERROR'].includes(status.state);
    const next=failed?Date.now()+Math.min(status.state==='ALPACA_PERMISSION'?300_000:60_000,300_000):Math.max(Date.now()+1_000,Date.parse(status.nextQueryAtUtc??'')+1_000||Date.now()+300_000);
    await new Promise<void>(done=>{wake=done;timer=setTimeout(done,Math.min(Math.max(1_000,next-Date.now()),86_400_000));});wake=undefined;
  }while(!stopped);
}catch{process.stderr.write('El estado privado del recolector no se pudo leer o guardar; revise su integridad y permisos.\n');process.exitCode=1;}
finally{stop();if(childCleanup)await childCleanup;release();}
