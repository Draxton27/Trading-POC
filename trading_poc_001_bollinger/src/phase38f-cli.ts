/** Local, explicit IEX observer. Never reads REST history or modifies SIP ledgers. */
import {config as loadEnv} from 'dotenv';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolvePrivateDir} from '../../apps/api/src/news/paths.ts';
import {loadMarketCalendar} from './alpaca-calendar.ts';
import {readIexLedger} from './phase38-iex.ts';
import {prepareIexObservation,appendIexPrediction,evaluateIexPredictions,readIexObservations,type IexFrozen} from './phase38f-iex-observation.ts';

const root=fileURLToPath(new URL('../../',import.meta.url));
loadEnv({path:resolve(root,'.env.local'),override:false,quiet:true});
loadEnv({path:resolve(root,'.env'),override:false,quiet:true});
if(process.argv.slice(2).some(arg=>arg!=='--once'))throw new Error('Uso: npm run ml:iex:observe -- --once');
const base=resolvePrivateDir({repoRoot:root});
const ledger=process.env.TRADING_POC_IEX_LEDGER??resolve(base,'iex','ledger.jsonl');
const calendarPath=process.env.TRADING_POC_IEX_CALENDAR??resolve(base,'iex','calendar.json');
const output=process.env.TRADING_POC_IEX_OBSERVATION_LEDGER??resolve(base,'ml-iex','observations.jsonl');
const modelDir=process.env.TRADING_POC_IEX_FROZEN_DIR;
if(!modelDir)throw new Error('Configurar TRADING_POC_IEX_FROZEN_DIR con el modelo IEX congelado.');
const frozen=JSON.parse(readFileSync(join(modelDir,'freeze.json'),'utf8')) as IexFrozen;
const hash=createHash('sha256').update(readFileSync(join(modelDir,'model.json'))).digest('hex');
if(hash!==frozen.modelSha256)throw new Error('SHA-256 del modelo IEX incompatible.');
const calendar=loadMarketCalendar(calendarPath),records=readIexLedger(ledger);
const evaluations=evaluateIexPredictions(output,records);
let status='NO_NEW_OBSERVATION';
try{
  const nowUtc=new Date().toISOString(),prepared=prepareIexObservation(records,calendar,frozen,nowUtc);
  const already=readIexObservations(output).some(row=>row.kind==='PREDICTION'&&row.modelSha256===hash&&row.barStartUtc===prepared.candidate.bar!.startUtc);
  if(!already){
    const python=process.env.PYTHON??(process.platform==='win32'?'py':'python3');
    const args=process.platform==='win32'&&/^(?:py|py\.exe)$/i.test(python)?['-3.12']:[];
    const result=spawnSync(python,[...args,'-m','ml.phase38f.frozen','predict','--model-dir',modelDir],{
      cwd:root,input:JSON.stringify(prepared.features),encoding:'utf8',timeout:30_000,maxBuffer:100_000,
      env:{...process.env,TRADING_POC_ML_THREADS:'2'}});
    if(result.error||result.status!==0)throw new Error('Inferencia IEX falló; revisar Python 3.12 y el modelo congelado.');
    const prediction=JSON.parse(result.stdout) as {modelSha256:string;probabilities:{xgboost:number[];frequency:number[];linear:number[]};dominantClass:string};
    if(prediction.modelSha256!==hash)throw new Error('Python cargó otro modelo IEX.');
    const bar=prepared.candidate.bar!;
    const appended=appendIexPrediction(output,{mode:'IEX_PROSPECTIVE_OBSERVATION',modelSha256:hash,modelCutoffUtc:frozen.cutoffUtc,modelFrozenAtUtc:frozen.frozenAtUtc,
      barStartUtc:bar.startUtc,barEndUtc:bar.endUtc,sourceBars:prepared.sourceBars,
      features:{spec:'nvda-15m-v1',hash:prepared.featureHash,values:prepared.features},probabilities:prediction.probabilities,
      dominantClass:prediction.dominantClass,receivedAtUtc:prepared.candidate.receivedAtUtc,
      source:{symbol:'NVDA',feed:'iex',adjustment:'raw',timeframe:'15m'},atr14PriceUnits:prepared.atr14PriceUnits,
      policy:{classification:'argmax',abstention:null}},calendar);
    status=appended.alreadyPresent?'ALREADY_PRESENT':'RECORDED';
  }
}catch(error){const message=error instanceof Error?error.message:'Error controlado';
  if(message.includes('no se permite backfill'))status='MODEL_TOO_RECENT';
  else if(/^(INDICATORS_INSUFFICIENT|HORIZON_INELIGIBLE)/.test(message))status=message.split(':')[0]!;
  else throw error;
}
process.stdout.write(JSON.stringify({status,evaluations:evaluations.length})+'\n');
