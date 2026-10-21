import {spawnSync} from 'node:child_process';
import {config as loadEnv} from 'dotenv';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {observeOnce} from './phase34-observer.ts';

const root=fileURLToPath(new URL('../../',import.meta.url));loadEnv({path:resolve(root,'.env.local'),override:false,quiet:true});loadEnv({path:resolve(root,'.env'),override:false,quiet:true});
const args=process.argv.slice(2),value=(name:string)=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
if(args.some((arg,index)=>!['--once','--every-seconds','--log'].includes(arg)&&!(index>0&&['--every-seconds','--log'].includes(args[index-1]!))))throw new Error('Uso: npm run ml:observe -- --once [--every-seconds 60] [--log ruta-privada].');
const every=value('--every-seconds')===undefined?undefined:Number(value('--every-seconds'));if(every!==undefined&&(!Number.isInteger(every)||every<60))throw new Error('--every-seconds debe ser un entero de al menos 60.');
const ledger=process.env.TRADING_POC_ALPACA_INGESTION_LOG??resolve(root,'private','alpaca-ingestion','ledger.jsonl');
const calendarPath=process.env.TRADING_POC_ALPACA_INGESTION_CALENDAR??`${ledger}.calendar.json`;
const log=value('--log')??process.env.TRADING_POC_ML_FORWARD_OBSERVATION_LOG??resolve(root,'private','ml-forward-observation','records.jsonl');
const modelDir=process.env.TRADING_POC_ML_RUN_DIR;if(!modelDir)throw new Error('TRADING_POC_ML_RUN_DIR es obligatorio.');const requiredModelDir=modelDir;
function infer(modelPath:string,features:Record<string,number>){const python=process.env.PYTHON??(process.platform==='win32'?'py':'python3'),launcher=process.platform==='win32'&&/^(py|py\.exe)$/i.test(python.replace(/^.*[\\/]/,''));const result=spawnSync(python,[...(launcher?['-3.12']:[]),resolve(root,'ml/phase31/infer.py')],{input:JSON.stringify({modelPath,features}),encoding:'utf8'});if(result.error)throw result.error;if(result.status!==0)throw new Error('Inferencia XGBoost rechazada.');return JSON.parse(result.stdout) as {modelSha256:string;probabilities:{ALCISTA:number;BAJISTA:number;LATERAL:number};dominantClass:'ALCISTA'|'BAJISTA'|'LATERAL'};}
function once(){const stored=observeOnce({ledger,calendarPath,log,modelDir:requiredModelDir,predict:infer});process.stdout.write(JSON.stringify({recordId:stored.record.recordId,alreadyPresent:stored.alreadyPresent,mode:stored.record.mode,recordedBeforeOutcome:stored.record.recordedBeforeOutcome,recordedBeforeNextEntry:stored.record.recordedBeforeNextEntry})+'\n');}
let stopped=false,active=false;async function run(){if(active||stopped)return;active=true;try{once();}catch(error){process.stderr.write(`${error instanceof Error?error.message:String(error)}\n`);if(every===undefined)process.exitCode=1;}finally{active=false;}}
if(every===undefined)await run();else{await run();const timer=setInterval(()=>void run(),every*1000);const stop=()=>{stopped=true;clearInterval(timer);};process.once('SIGINT',stop);process.once('SIGTERM',stop);}
