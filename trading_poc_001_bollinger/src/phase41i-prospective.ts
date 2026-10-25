/** Immutable protocol anchor and sidecar decisions for the existing 38F IEX observer. */
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,renameSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {appendRecord,verifyLedger,type LedgerRecord} from './phase16-ledger.ts';
import {readIexObservations,type IexObservationRecord,type IexPrediction} from './phase38f-iex-observation.ts';
import type {IexRecord} from './phase38-iex.ts';
import {PHASE31_FEATURES} from './phase31-inference.ts';

const root=fileURLToPath(new URL('../../',import.meta.url));
const templatePath=resolve(root,'ml','phase41i','protocol.json');
export const PHASE41I_MODEL_SHA='b9bbece648544b39e1e4c4946933e4f4de2d65ec5094997938b25791cb1bb684';
const sha=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const exact=(value:string)=>{const time=Date.parse(value);if(!Number.isFinite(time)||new Date(time).toISOString()!==value)throw new Error('Timestamp UTC inválido.');return time;};
const readSmall=(path:string,max:number)=>{if(statSync(path).size>max)throw new Error('Artefacto IEX demasiado grande.');return readFileSync(path);};
export type Phase41iProtocol={schema:'phase41i-prospective-protocol-v1';protocol_version:1;created_at_utc:string|null;git_commit:string|null;
  source_model_sha256:string;model_frozen_at_utc:string|null;prospective_start_at_utc:string|null;
  feature_schema:{id:string;columns:string[]};classes:string[];prediction_policy:{classification:string;abstention:null;models:string[]};
  source_policy:{symbol:string;feed:string;adjustment:string;timeframe:string;candidate:string;rest_warmup:string};
  eligibility_policy:{max_live_age_minutes:number;required_continuous_bars:number;model_frozen_before_bar_start:boolean;new_bar_after_activation:boolean;four_future_bars_in_session:boolean;revalidate_before_append:boolean};
  evaluation_policy:{label_id:string;label_formula:string;entry:string;source:string;missing:string[]};metrics:string[];
  minimum_reporting_requirements:{review_sessions:number;minimum_actual_per_class:number;bootstrap_minimum_sessions:number;minimum_complete_bar_coverage:number;coverage_required:boolean;warning:string}};
export type Phase41iActivation={schema:'phase41i-activation-v1';activatedAtUtc:string;protocolSha256:string;modelSha256:string;
  priorObservationLedger:{state:'ABSENT'|'PRESENT';recordCount:number;tipHash:string|null};
  provenance:{symbol:'NVDA';feed:'iex';adjustment:'raw';timeframe:'15m';collector:'phase38-iex';observer:'phase38f';mode:'read_only'};
  activationHash:string};
export type ActiveProtocol={protocol:Phase41iProtocol;activation:Phase41iActivation;directory:string};
export type EligibilityStatus='RECORDED'|'ALREADY_PRESENT'|'NO_LIVE_DATA'|'PREEXISTING_LIVE_DATA'|'STALE_LIVE_DATA'|
  'INDICATORS_INSUFFICIENT'|'HORIZON_INELIGIBLE'|'MODEL_TOO_RECENT'|'FEED_DISCONNECTED'|'CALENDAR_UNAVAILABLE'|'SOURCE_INVALID'|'INFERENCE_FAILED';

export function verifyPhase41iModel(directory:string){
  const frozenBytes=readSmall(join(directory,'freeze.json'),1024*1024),modelBytes=readSmall(join(directory,'model.json'),64*1024*1024);
  const linearBytes=readSmall(join(directory,'linear.json'),1024*1024),manifest=readSmall(join(directory,'SHA256SUMS'),4096).toString('utf8');
  const frozen=JSON.parse(frozenBytes.toString('utf8')) as Record<string,unknown>;
  const manifestLines=manifest.trim().split(/\r?\n/);
  const digests=new Map(manifestLines.map(line=>{const match=/^([a-f0-9]{64})  (model\.json|linear\.json|freeze\.json)$/.exec(line);if(!match)throw new Error('SHA256SUMS IEX inválido.');return [match[2]!,match[1]!] as const;}));
  if(manifestLines.length!==3||digests.size!==3||digests.get('model.json')!==sha(modelBytes)||digests.get('linear.json')!==sha(linearBytes)||digests.get('freeze.json')!==sha(frozenBytes)||
    frozen.schema!=='phase38f-frozen-v1'||frozen.modelSha256!==PHASE41I_MODEL_SHA||sha(modelBytes)!==PHASE41I_MODEL_SHA||
    frozen.linearSha256!==sha(linearBytes)||frozen.symbol!=='NVDA'||frozen.feed!=='iex'||frozen.adjustment!=='raw'||frozen.timeframe!=='15m'||
    JSON.stringify(frozen.features)!==JSON.stringify(PHASE31_FEATURES)||JSON.stringify(frozen.classes)!==JSON.stringify(['ALCISTA','BAJISTA','LATERAL'])||
    (frozen.policy as {classification?:string;abstention?:unknown}|undefined)?.classification!=='argmax'||
    (frozen.policy as {abstention?:unknown}|undefined)?.abstention!==null||
    typeof frozen.frozenAtUtc!=='string'||typeof frozen.cutoffUtc!=='string'||exact(frozen.cutoffUtc)>=exact(frozen.frozenAtUtc))throw new Error('Modelo IEX 38F incompatible o alterado.');
  return {modelSha256:sha(modelBytes),linearSha256:sha(linearBytes),freezeSha256:sha(frozenBytes),manifestSha256:sha(manifest),frozenAtUtc:frozen.frozenAtUtc};
}

function verifyProtocol(protocol:Phase41iProtocol,activation?:Phase41iActivation){
  if(protocol.schema!=='phase41i-prospective-protocol-v1'||protocol.protocol_version!==1||protocol.source_model_sha256!==PHASE41I_MODEL_SHA||
    JSON.stringify(protocol.feature_schema.columns)!==JSON.stringify(PHASE31_FEATURES)||JSON.stringify(protocol.classes)!==JSON.stringify(['ALCISTA','BAJISTA','LATERAL'])||
    protocol.prediction_policy.classification!=='argmax'||protocol.prediction_policy.abstention!==null||
    JSON.stringify(protocol.prediction_policy.models)!==JSON.stringify(['xgboost','linear','frequency'])||
    protocol.source_policy.symbol!=='NVDA'||protocol.source_policy.feed!=='iex'||protocol.source_policy.adjustment!=='raw'||protocol.source_policy.timeframe!=='15m'||
    protocol.eligibility_policy.max_live_age_minutes!==15||protocol.minimum_reporting_requirements.review_sessions!==60||
    protocol.minimum_reporting_requirements.minimum_actual_per_class!==20||
    protocol.minimum_reporting_requirements.minimum_complete_bar_coverage!==0.8)throw new Error('Protocolo IEX 41I incompatible.');
  if(activation){if(!protocol.created_at_utc||!protocol.model_frozen_at_utc||!protocol.prospective_start_at_utc||
    !protocol.git_commit||!/^[a-f0-9]{40}$/.test(protocol.git_commit)||
    exact(protocol.created_at_utc)>exact(protocol.prospective_start_at_utc)||
    exact(protocol.model_frozen_at_utc)>=exact(protocol.prospective_start_at_utc)||
    protocol.prospective_start_at_utc!==activation.activatedAtUtc)throw new Error('Ancla temporal IEX 41I inválida.');}
}

export function activatePhase41i(directory:string,modelDir:string,observationPath:string,
  clock:()=>string=()=>new Date().toISOString(),commit?:string,verifyModel=verifyPhase41iModel):ActiveProtocol{
  if(existsSync(directory))throw new Error('El protocolo ya existe; la activación es inmutable.');
  const model=verifyModel(modelDir),observations=readIexObservations(observationPath),now=clock();exact(now);
  if(exact(now)<=exact(model.frozenAtUtc))throw new Error('El modelo debe preceder a la activación.');
  const template=JSON.parse(readSmall(templatePath,64*1024).toString('utf8')) as Phase41iProtocol;verifyProtocol(template);
  const gitCommit=commit??execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  if(!/^[a-f0-9]{40}$/.test(gitCommit))throw new Error('Commit de activación inválido.');
  const protocol={...template,created_at_utc:now,git_commit:gitCommit,model_frozen_at_utc:model.frozenAtUtc,prospective_start_at_utc:now};
  const protocolBytes=JSON.stringify(protocol,null,2)+'\n',prior=observations.at(-1)?.recordHash??null;
  const unsigned={schema:'phase41i-activation-v1' as const,activatedAtUtc:now,protocolSha256:sha(protocolBytes),modelSha256:model.modelSha256,
    priorObservationLedger:{state:observations.length?'PRESENT' as const:'ABSENT' as const,recordCount:observations.length,tipHash:prior},
    provenance:{symbol:'NVDA' as const,feed:'iex' as const,adjustment:'raw' as const,timeframe:'15m' as const,
      collector:'phase38-iex' as const,observer:'phase38f' as const,mode:'read_only' as const}};
  const activation={...unsigned,activationHash:sha(JSON.stringify(unsigned))};verifyProtocol(protocol,activation);
  mkdirSync(dirname(directory),{recursive:true});const staged=`${directory}.tmp-${process.pid}-${Date.now()}`;
  mkdirSync(staged);
  try{
    writeFileSync(join(staged,'protocol.json'),protocolBytes,{flag:'wx'});
    writeFileSync(join(staged,'source-integrity.json'),JSON.stringify({schema:'phase41i-source-integrity-v1',...model,
      templateSha256:sha(readFileSync(templatePath)),observationLedgerState:unsigned.priorObservationLedger},null,2)+'\n',{flag:'wx'});
    writeFileSync(join(staged,'activation.json'),JSON.stringify(activation,null,2)+'\n',{flag:'wx'});
    writeFileSync(join(staged,'SHA256SUMS'),['protocol.json','source-integrity.json','activation.json'].map(name=>`${sha(readFileSync(join(staged,name)))}  ${name}`).join('\n')+'\n',{flag:'wx'});
    renameSync(staged,directory);
  }catch(error){rmSync(staged,{recursive:true,force:true});throw error;}
  return {protocol,activation,directory};
}

export function loadPhase41iActivation(directory:string,observationPath:string):ActiveProtocol|null{
  if(!existsSync(directory))return null;
  const listed=readSmall(join(directory,'SHA256SUMS'),4096).toString('utf8').trim().split(/\r?\n/);
  const hashes=new Map(listed.map(line=>{const match=/^([a-f0-9]{64})  (protocol\.json|activation\.json|source-integrity\.json)$/.exec(line);
    if(!match)throw new Error('Manifiesto 41I inválido.');return [match[2]!,match[1]!] as const;}));
  if(listed.length!==3||hashes.size!==3||[...hashes].some(([name,hash])=>sha(readSmall(join(directory,name),64*1024))!==hash))throw new Error('Artefactos de activación 41I alterados.');
  const protocolBytes=readSmall(join(directory,'protocol.json'),64*1024),protocol=JSON.parse(protocolBytes.toString('utf8')) as Phase41iProtocol;
  const activation=JSON.parse(readSmall(join(directory,'activation.json'),16*1024).toString('utf8')) as Phase41iActivation;
  const {activationHash,...body}=activation;
  if(activation.schema!=='phase41i-activation-v1'||activationHash!==sha(JSON.stringify(body))||activation.protocolSha256!==sha(protocolBytes)||
    activation.modelSha256!==PHASE41I_MODEL_SHA)throw new Error('Ancla IEX 41I alterada.');
  verifyProtocol(protocol,activation);
  const prior=activation.priorObservationLedger,observations=readIexObservations(observationPath);
  if(!Number.isSafeInteger(prior.recordCount)||prior.recordCount<0||observations.length<prior.recordCount||
    (prior.recordCount===0)!==(prior.state==='ABSENT')||(prior.recordCount>0&&observations[prior.recordCount-1]?.recordHash!==prior.tipHash)||
    prior.recordCount===0&&prior.tipHash!==null)throw new Error('Prefijo prospectivo anterior a 41I alterado.');
  return {protocol,activation,directory};
}

export function firstNewIexCandidate(records:readonly IexRecord[],active:ActiveProtocol):IexRecord|null{
  const cutoff=exact(active.activation.activatedAtUtc),seen=new Set<string>();let latest:IexRecord|null=null;
  for(const row of records){
    if(row.kind!=='quarter'||!row.bar||row.status!=='COMPLETE')continue;
    if(seen.has(row.bar.startUtc))continue;seen.add(row.bar.startUtc);
    if(row.symbol!=='NVDA'||row.feed!=='iex'||row.adjustment!=='raw')throw new Error('Fuente IEX inválida.');
    if(exact(row.bar.startUtc)<=cutoff||exact(row.receivedAtUtc)<=cutoff)continue;
    if(exact(row.bar.endUtc)-exact(row.bar.startUtc)!==900_000||exact(row.receivedAtUtc)<exact(row.bar.endUtc))throw new Error('Vela IEX parcial o recepción inválida.');
    latest=row;
  }
  return latest;
}

export function readPhase41iDecisions(directory:string):LedgerRecord[]{
  const rows=verifyLedger(join(directory,'eligibility-ledger'));
  if(rows.some(row=>row.kind!=='iex_eligibility'))throw new Error('Ledger de elegibilidad 41I con tipos ajenos.');
  return rows;
}
export function appendPhase41iDecision(active:ActiveProtocol,candidate:IexRecord,status:EligibilityStatus,
  prediction:IexPrediction|null=null,clock:()=>string=()=>new Date().toISOString()):LedgerRecord{
  const statuses:EligibilityStatus[]=['RECORDED','ALREADY_PRESENT','NO_LIVE_DATA','PREEXISTING_LIVE_DATA','STALE_LIVE_DATA',
    'INDICATORS_INSUFFICIENT','HORIZON_INELIGIBLE','MODEL_TOO_RECENT','FEED_DISCONNECTED','CALENDAR_UNAVAILABLE','SOURCE_INVALID','INFERENCE_FAILED'];
  if(!statuses.includes(status))throw new Error('Estado de elegibilidad 41I inválido.');
  if(!candidate.bar||candidate.kind!=='quarter'||candidate.status!=='COMPLETE'||candidate.revision!==1||
    exact(candidate.bar.startUtc)<=exact(active.activation.activatedAtUtc)||exact(candidate.receivedAtUtc)<=exact(active.activation.activatedAtUtc))throw new Error('Candidata 41I anterior a activación o no es primera versión Live.');
  if(status==='RECORDED'&&(!prediction||prediction.barStartUtc!==candidate.bar.startUtc||
    prediction.modelSha256!==active.activation.modelSha256||exact(prediction.registeredAtUtc)<=exact(active.activation.activatedAtUtc)))throw new Error('Enlace de predicción 41I inválido.');
  const now=clock();if(exact(now)<exact(candidate.receivedAtUtc))throw new Error('Decisión anterior a recepción IEX.');
  const payload={candidate_bar_start_utc:candidate.bar.startUtc,candidate_bar_end_utc:candidate.bar.endUtc,
    first_received_at_utc:candidate.receivedAtUtc,decision_at_utc:now,source_bar_sha256:candidate.recordHash,
    protocol_sha256:active.activation.protocolSha256,model_sha256:active.activation.modelSha256,
    eligibility_status:status,eligibility_reason:status,prediction_id_if_recorded:prediction?.id??null,
    prediction_record_hash:prediction?.recordHash??null};
  const directory=join(active.directory,'eligibility-ledger'),id=`iex41i:${sha(JSON.stringify({protocol:active.activation.protocolSha256,source:candidate.recordHash,status}))}`;
  const existing=readPhase41iDecisions(active.directory).find(row=>row.id===id);if(existing)return existing;
  try{return appendRecord(directory,id,'iex_eligibility',payload,now);}
  catch(error){const concurrent=readPhase41iDecisions(active.directory).find(row=>row.id===id);if(concurrent)return concurrent;throw error;}
}

export function classifyPhase41iFailure(error:unknown):EligibilityStatus{
  const message=error instanceof Error?error.message:'';
  if(message.startsWith('STALE_LIVE_DATA'))return 'STALE_LIVE_DATA';
  if(message.startsWith('INDICATORS_INSUFFICIENT'))return 'INDICATORS_INSUFFICIENT';
  if(message.startsWith('HORIZON_INELIGIBLE'))return 'HORIZON_INELIGIBLE';
  if(message.includes('no se permite backfill'))return 'MODEL_TOO_RECENT';
  if(message.includes('Calendario'))return 'CALENDAR_UNAVAILABLE';
  if(message.includes('Inferencia IEX')||message.includes('Python cargó'))return 'INFERENCE_FAILED';
  return 'SOURCE_INVALID';
}

export function cohortPredictions(active:ActiveProtocol,rows:IexObservationRecord[],decisions:LedgerRecord[]):IexPrediction[]{
  const linked=new Map(decisions.filter(row=>row.payload.eligibility_status==='RECORDED').map(row=>[row.payload.prediction_id_if_recorded,row.payload]));
  return rows.filter((row):row is IexPrediction=>row.kind==='PREDICTION').filter(row=>{
    const link=linked.get(row.id);return !!link&&row.modelSha256===active.activation.modelSha256&&
      row.recordHash===link.prediction_record_hash&&row.barStartUtc===link.candidate_bar_start_utc&&
      row.sourceBars.at(-1)?.recordHash===link.source_bar_sha256&&
      exact(row.barStartUtc)>exact(active.activation.activatedAtUtc)&&exact(row.registeredAtUtc)>exact(active.activation.activatedAtUtc);
  });
}
