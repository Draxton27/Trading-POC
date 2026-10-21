import {existsSync,mkdirSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {config as loadEnv} from 'dotenv';
import {evaluateOnce,readEvaluations} from './phase35-evaluation.ts';
import {evaluationReport,frozenDevelopmentBaseline} from './phase35-metrics.ts';

const root=fileURLToPath(new URL('../../',import.meta.url));
loadEnv({path:resolve(root,'.env.local'),override:false,quiet:true});loadEnv({path:resolve(root,'.env'),override:false,quiet:true});
if(process.argv.slice(2).join(' ')!=='--once')throw new Error('Uso: npm.cmd run ml:evaluate -- --once');
const ingestionLog=process.env.TRADING_POC_ALPACA_INGESTION_LOG??resolve(root,'private','alpaca-ingestion','ledger.jsonl');
const observationLog=process.env.TRADING_POC_ML_FORWARD_OBSERVATION_LOG??resolve(root,'private','ml-forward-observation','records.jsonl');
const calendarPath=process.env.TRADING_POC_ALPACA_INGESTION_CALENDAR??`${ingestionLog}.calendar.json`;
const evaluationLog=process.env.TRADING_POC_ML_EVALUATION_LOG??resolve(root,'private','ml-evaluation','records.jsonl');
const statusPath=process.env.TRADING_POC_ML_EVALUATION_STATUS??resolve(root,'private','ml-evaluation','status.json');
const modelDir=process.env.TRADING_POC_ML_RUN_DIR;
const publish=(value:object)=>{mkdirSync(dirname(statusPath),{recursive:true});const temp=`${statusPath}.${randomUUID()}.tmp`;try{writeFileSync(temp,JSON.stringify(value)+'\n',{flag:'wx'});renameSync(temp,statusPath);}catch(error){rmSync(temp,{force:true});throw error;}};
const at=new Date().toISOString();
try{
  if(!modelDir||!existsSync(ingestionLog)||!existsSync(observationLog)||!existsSync(calendarPath)){
    const result={state:'NO_DATA',updatedAtUtc:at,reason:'Falta modelo, calendario o ledgers privados; no se generaron resultados.'};publish(result);process.stdout.write(JSON.stringify(result)+'\n');
  }else{
    const result=evaluateOnce({ingestionLog,observationLog,calendarPath,modelDir,evaluationLog});
    const report=evaluationReport(readEvaluations(evaluationLog),frozenDevelopmentBaseline(modelDir));
    const status={state:result.predictions===0?'NO_DATA':result.nonEvaluable?'PARTIAL':result.pending?'PENDING':'READY',updatedAtUtc:new Date().toISOString(),observations:result.predictions,evaluated:result.evaluated,pending:result.pending,nonEvaluable:result.nonEvaluable,added:result.added,revisionNotices:result.revisionNotices,reason:report.warning};
    publish(status);process.stdout.write(JSON.stringify(status)+'\n');
  }
}catch(error){publish({state:'ERROR',updatedAtUtc:new Date().toISOString(),reason:'No se pudo verificar el ledger, calendario o modelo privado.'});process.stderr.write('Evaluación rechazada: '+(error instanceof Error?error.message:'error desconocido')+'\n');process.exitCode=1;}
