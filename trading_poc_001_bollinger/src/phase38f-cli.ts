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
import {prepareIexObservation,appendIexPrediction,evaluateIexPredictions,readIexObservations,type IexFrozen,type IexPrediction} from './phase38f-iex-observation.ts';
import {loadIexWarmup} from './phase38f-warmup.ts';
import {appendPhase41iDecision,classifyPhase41iFailure,firstNewIexCandidate,
  loadPhase41iActivation,phase41iProtocolDir,readPhase41iDecisions,verifyPhase41iModel} from './phase41i-prospective.ts';

const root=fileURLToPath(new URL('../../',import.meta.url));
loadEnv({path:resolve(root,'.env.local'),override:false,quiet:true});
loadEnv({path:resolve(root,'.env'),override:false,quiet:true});
const args=process.argv.slice(2);
if(args.length!==1||!['--once','--evaluate-only'].includes(args[0]!))throw new Error('Uso: npm run ml:iex:observe -- --once|--evaluate-only');
const base=resolvePrivateDir({repoRoot:root});
const ledger=process.env.TRADING_POC_IEX_LEDGER??resolve(base,'iex','ledger.jsonl');
const calendarPath=process.env.TRADING_POC_IEX_CALENDAR??resolve(base,'iex','calendar.json');
const output=process.env.TRADING_POC_IEX_OBSERVATION_LEDGER??resolve(base,'ml-iex','observations.jsonl');
const phase41iDir=phase41iProtocolDir(process.env);
const records=readIexLedger(ledger);
const evaluations=evaluateIexPredictions(output,records);
if(args[0]==='--evaluate-only'){
  process.stdout.write(JSON.stringify({status:'EVALUATION_ONLY',evaluations:evaluations.length})+'\n');
}else{
const active=loadPhase41iActivation(phase41iDir,output);
const newCandidate=active?firstNewIexCandidate(records,active):null;
if(active&&!newCandidate){
  const anyComplete=records.some(row=>row.kind==='quarter'&&row.status==='COMPLETE');
  process.stdout.write(JSON.stringify({status:anyComplete?'PREEXISTING_LIVE_DATA':'NO_LIVE_DATA',evaluations:evaluations.length})+'\n');
}else{
const modelDir=process.env.TRADING_POC_IEX_FROZEN_DIR;
if(!modelDir)throw new Error('Configurar TRADING_POC_IEX_FROZEN_DIR con el modelo IEX congelado.');
if(active&&verifyPhase41iModel(modelDir).modelSha256!==active.activation.modelSha256)throw new Error('Modelo IEX 41I distinto del activado.');
const frozen=JSON.parse(readFileSync(join(modelDir,'freeze.json'),'utf8')) as IexFrozen;
const hash=createHash('sha256').update(readFileSync(join(modelDir,'model.json'))).digest('hex');
if(hash!==frozen.modelSha256)throw new Error('SHA-256 del modelo IEX incompatible.');
let status='NO_NEW_OBSERVATION';
try{
  const feed=records.filter(row=>row.kind==='status').at(-1)?.status;
  if(active&&['DISCONNECTED','OBSERVATION_ENDED','AUTH_FAILED','CONNECTION_LIMIT','SUBSCRIPTION_FAILED'].includes(feed??''))throw new Error('FEED_DISCONNECTED');
  const calendar=loadMarketCalendar(calendarPath);
  const warmup=process.env.TRADING_POC_IEX_WARMUP_REGISTRY?loadIexWarmup(process.env.TRADING_POC_IEX_WARMUP_REGISTRY):undefined;
  const nowUtc=new Date().toISOString(),prepared=prepareIexObservation(records,calendar,frozen,nowUtc,warmup);
  if(active&&prepared.candidate.recordHash!==newCandidate!.recordHash)throw new Error('Candidata Live 41I cambió durante la preparación.');
  const existing=readIexObservations(output).find((row):row is IexPrediction=>row.kind==='PREDICTION'&&row.modelSha256===hash&&row.barStartUtc===prepared.candidate.bar!.startUtc);
  if(existing){
    status='ALREADY_PRESENT';
    if(active&&!readPhase41iDecisions(active.directory).some(row=>row.payload.prediction_id_if_recorded===existing.id&&row.payload.eligibility_status==='RECORDED')&&
      Date.parse(existing.registeredAtUtc)>Date.parse(active.activation.activatedAtUtc))appendPhase41iDecision(active,newCandidate!,'RECORDED',existing);
  }
  else{
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
    if(active&&!appended.alreadyPresent)appendPhase41iDecision(active,newCandidate!,'RECORDED',appended.record);
  }
}catch(error){const message=error instanceof Error?error.message:'Error controlado';
  if(active&&newCandidate){
    const reason=message==='FEED_DISCONNECTED'?'FEED_DISCONNECTED':classifyPhase41iFailure(error);
    const prior=readPhase41iDecisions(active.directory).some(row=>row.payload.source_bar_sha256===newCandidate.recordHash&&row.payload.eligibility_status==='RECORDED');
    if(!prior)appendPhase41iDecision(active,newCandidate,reason);
  }
  if(message.startsWith('STALE_LIVE_DATA'))status='STALE_LIVE_DATA';
  else if(message.startsWith('NO_LIVE_DATA'))status='NO_LIVE_DATA';
  else if(message.includes('no se permite backfill'))status='MODEL_TOO_RECENT';
  else if(/^(INDICATORS_INSUFFICIENT|HORIZON_INELIGIBLE)/.test(message))status=message.split(':')[0]!;
  else if(message==='FEED_DISCONNECTED')status='FEED_DISCONNECTED';
  else throw error;
}
process.stdout.write(JSON.stringify({status,evaluations:evaluations.length})+'\n');
}
}
