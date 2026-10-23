/** Prospective IEX research: only first complete Live ledger versions are eligible. */
import {createHash} from 'node:crypto';
import {closeSync,existsSync,mkdirSync,openSync,readFileSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import type {Candle} from './domain.ts';
import type {MarketCalendar} from './alpaca-calendar.ts';
import {readIexLedger,type IexRecord} from './phase38-iex.ts';
import {phase23ContinuousSuffix,calculatePhase23Features,DATASET_SPEC,classifyMovement} from './phase23-dataset.ts';
import {PHASE31_FEATURES,type Phase31Feature} from './phase31-inference.ts';
import {scheduledPostDecisionEntry} from './phase38c-replay.ts';
import {newYorkBarParts} from './strategy-validation.ts';
import type {IexWarmup} from './phase38f-warmup.ts';

const QUARTER=900_000;
export const MAX_LIVE_AGE_MS=15*60_000;
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const exact=(value:string)=>{const time=Date.parse(value);if(!Number.isFinite(time)||new Date(time).toISOString()!==value)throw new Error('Timestamp UTC inválido.');return time;};
const minute=(slot:string)=>{const [h,m]=slot.split(':').map(Number);return h!*60+m!;};
const stamp=(time:number)=>new Date(time).toISOString();
export type IexFrozen={schema:'phase38f-frozen-v1';modelSha256:string;cutoffUtc:string;frozenAtUtc:string;features:string[];classes:string[];feed:'iex';adjustment:'raw';frequency:number[]};
export type IexPrediction={schema:'phase38f-observation-v1';kind:'PREDICTION';id:string;previousHash:string|null;recordHash:string;
  mode:'IEX_PROSPECTIVE_OBSERVATION';modelSha256:string;modelCutoffUtc:string;modelFrozenAtUtc:string;barStartUtc:string;barEndUtc:string;
  sourceBars:{startUtc:string;receivedAtUtc:string;recordHash:string;revision:number;origin:'LIVE'|'REST_WARMUP'}[];
  features:{spec:string;hash:string;values:Record<Phase31Feature,number>};
  probabilities:{xgboost:number[];frequency:number[];linear:number[]};dominantClass:string;
  receivedAtUtc:string;registeredAtUtc:string;entryAtUtc:string;outcomeAtUtc:string;
  recordedBeforeEntry:boolean;recordedBeforeOutcome:boolean;source:{symbol:'NVDA';feed:'iex';adjustment:'raw';timeframe:'15m'};
  atr14PriceUnits:number;policy:{classification:'argmax';abstention:null};};
export type IexEvaluation={schema:'phase38f-observation-v1';kind:'EVALUATION';id:string;previousHash:string|null;recordHash:string;
  predictionId:string;status:'EVALUATED'|'MISSING_ENTRY'|'MISSING_OUTCOME';evaluatedAtUtc:string;
  entrySourceHash:string|null;outcomeSourceHash:string|null;entryOpen:number|null;outcomeClose:number|null;label:string|null;};
export type IexObservationRecord=IexPrediction|IexEvaluation;

function lock<T>(path:string,work:()=>T):T{
  mkdirSync(dirname(path),{recursive:true});const file=`${path}.lock`,deadline=Date.now()+5000;let fd:number|undefined;
  while(fd===undefined){try{fd=openSync(file,'wx');}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'||Date.now()>deadline)throw error;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);}}
  try{return work();}finally{closeSync(fd);unlinkSync(file);}
}
export function readIexObservations(path:string):IexObservationRecord[]{
  if(!existsSync(path))return [];
  let previous:string|null=null;
  return readFileSync(path,'utf8').split(/\r?\n/).filter(Boolean).map(line=>{
    const row=JSON.parse(line) as IexObservationRecord,{recordHash,...unsigned}=row;
    if(row.schema!=='phase38f-observation-v1'||row.previousHash!==previous||sha(JSON.stringify(unsigned))!==recordHash)throw new Error('Integridad del ledger prospectivo IEX inválida.');
    previous=recordHash;return row;
  });
}
function firstQuarters(records:readonly IexRecord[],at:number){
  const first=new Map<string,IexRecord>();
  for(const row of records){
    if(row.kind!=='quarter'||!row.bar||exact(row.receivedAtUtc)>at)continue;
    if(row.feed!=='iex'||row.adjustment!=='raw'||row.symbol!=='NVDA'||row.status!=='COMPLETE'||row.revision===null||row.revision<1)throw new Error('Procedencia de vela IEX incompatible.');
    if(!first.has(row.bar.startUtc))first.set(row.bar.startUtc,row);
  }
  return [...first.values()].sort((a,b)=>a.bar!.startUtc.localeCompare(b.bar!.startUtc));
}
function candle(row:IexRecord):Candle{const b=row.bar!;return {timestamp:b.startUtc,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume};}
export function prepareIexObservation(records:readonly IexRecord[],calendar:MarketCalendar,model:IexFrozen,nowUtc:string,warmup?:IexWarmup){
  const now=exact(nowUtc),rows=firstQuarters(records,now);
  if(model.schema!=='phase38f-frozen-v1'||model.feed!=='iex'||model.adjustment!=='raw'||
     JSON.stringify(model.features)!==JSON.stringify(PHASE31_FEATURES)||JSON.stringify(model.classes)!==JSON.stringify(['ALCISTA','BAJISTA','LATERAL']))throw new Error('Modelo IEX incompatible.');
  if(!rows.length)throw new Error('NO_LIVE_DATA: no hay velas IEX Live completas; no se emite predicción.');
  const candidate=rows.at(-1)!,bar=candidate.bar!,start=exact(bar.startUtc),end=exact(bar.endUtc);
  if(now-exact(candidate.receivedAtUtc)>MAX_LIVE_AGE_MS)throw new Error('STALE_LIVE_DATA: last complete Live bar exceeded the 15-minute freshness window.');
  if(end-start!==QUARTER||end>now||exact(candidate.receivedAtUtc)<end)throw new Error('Vela IEX incompleta o recepción imposible.');
  if(exact(model.cutoffUtc)>=start||exact(model.frozenAtUtc)>=start)throw new Error('El modelo se congeló después de la vela; no se permite backfill.');
  const firstLive=rows[0]!.bar!.startUtc;
  const mergedCalendar=new Map(calendar);
  let historical:Candle[]=[];
  if(warmup){
    const registered=exact(warmup.registeredAtUtc);
    if(registered>=start)throw new Error('Snapshot REST registrado después de la vela; no se permite backfill.');
    for(const [day,hours] of warmup.calendar){const present=mergedCalendar.get(day);
      if(present&&(present.open!==hours.open||present.close!==hours.close))throw new Error('Calendarios oficiales IEX contradictorios.');
      mergedCalendar.set(day,hours);}
    historical=warmup.candles.filter(bar=>bar.timestamp<firstLive&&exact(bar.timestamp)+QUARTER<=registered);
    if(warmup.candles.some(bar=>bar.timestamp<firstLive&&exact(bar.timestamp)+QUARTER>registered))throw new Error('Snapshot REST contiene velas aún no cerradas al registrarse.');
  }
  const all=[...historical,...rows.map(candle)],continuous=phase23ContinuousSuffix(all,mergedCalendar);
  if(continuous.length<21)throw new Error('INDICATORS_INSUFFICIENT: calentamiento causal IEX menor de 21 velas.');
  const selectedLive=rows.filter(row=>row.bar!.startUtc>=continuous[0]!.timestamp);
  for(const row of selectedLive){if(!row.bar||exact(row.receivedAtUtc)>now||row.bar.endUtc>nowUtc)throw new Error('Fuente IEX posterior a la decisión.');}
  const calculated=calculatePhase23Features(continuous,mergedCalendar).at(-1);
  if(!calculated)throw new Error('INDICATORS_INSUFFICIENT: indicadores IEX incompletos.');
  const local=newYorkBarParts(bar.startUtc),session=mergedCalendar.get(local.day);
  if(!session)throw new Error('Calendario Alpaca insuficiente.');
  const values={return_1:calculated.return_1,return_4:calculated.return_4,distance_ema9:calculated.distance_ema9,
    distance_sma20:calculated.distance_sma20,bollinger_position:calculated.bollinger_position,
    relative_volume_20:calculated.relative_volume_20,candle_range:calculated.candle_range,candle_body:calculated.candle_body,
    atr14_relative:calculated.atr14_relative,minutes_from_open:minute(local.slot)-session.open} as Record<Phase31Feature,number>;
  if(PHASE31_FEATURES.some(name=>!Number.isFinite(values[name])))throw new Error('Indicadores IEX no finitos.');
  const schedule=scheduledPostDecisionEntry(bar.startUtc,nowUtc,minute(local.slot),session);
  if(!schedule.entryAtUtc||!schedule.horizonEndUtc||now>=exact(schedule.horizonEndUtc))throw new Error('HORIZON_INELIGIBLE: no caben cuatro velas posteriores a la decisión.');
  const sourceBars=[...continuous.filter(bar=>bar.timestamp<firstLive).map(bar=>({startUtc:bar.timestamp,
    receivedAtUtc:warmup!.registeredAtUtc,recordHash:sha(JSON.stringify({csv:warmup!.csvSha256,bar})),revision:0,origin:'REST_WARMUP' as const})),
    ...selectedLive.map(row=>({startUtc:row.bar!.startUtc,receivedAtUtc:row.receivedAtUtc,recordHash:row.recordHash,revision:row.revision!,origin:'LIVE' as const}))];
  return {candidate,sourceBars,features:values,featureHash:sha(JSON.stringify({spec:DATASET_SPEC,names:PHASE31_FEATURES,values})),
    atr14PriceUnits:calculated.atr14PriceUnits,schedule};
}
function validProbabilities(value:IexPrediction['probabilities']){
  for(const name of ['xgboost','frequency','linear'] as const){const p=value[name];if(p.length!==3||p.some(n=>!Number.isFinite(n)||n<0||n>1)||Math.abs(p.reduce((a,b)=>a+b,0)-1)>1e-6)throw new Error('Probabilidades inválidas.');}
}
export function appendIexPrediction(path:string,input:Omit<IexPrediction,'schema'|'kind'|'id'|'previousHash'|'recordHash'|'registeredAtUtc'|'entryAtUtc'|'outcomeAtUtc'|'recordedBeforeEntry'|'recordedBeforeOutcome'>,calendar:MarketCalendar,clock:()=>string=()=>new Date().toISOString()){
  return lock(path,()=>{
    const existing=readIexObservations(path),prior=existing.find(row=>row.kind==='PREDICTION'&&row.modelSha256===input.modelSha256&&row.barStartUtc===input.barStartUtc);
    if(prior)return {record:prior,alreadyPresent:true};
    validProbabilities(input.probabilities);
    const nowUtc=clock(),now=exact(nowUtc),bar=exact(input.barStartUtc),local=newYorkBarParts(input.barStartUtc),session=calendar.get(local.day);
    if(!session||exact(input.modelCutoffUtc)>=bar||exact(input.modelFrozenAtUtc)>=bar||input.source.feed!=='iex'||input.source.adjustment!=='raw'||input.source.symbol!=='NVDA'||input.source.timeframe!=='15m')throw new Error('Modelo, fuente o calendario incompatible.');
    if(now<exact(input.receivedAtUtc)||input.sourceBars.some(row=>exact(row.receivedAtUtc)>now||row.startUtc>input.barStartUtc))throw new Error('Datos posteriores al registro.');
    if(now-exact(input.receivedAtUtc)>MAX_LIVE_AGE_MS)throw new Error('STALE_LIVE_DATA: Live data expired before append.');
    const schedule=scheduledPostDecisionEntry(input.barStartUtc,nowUtc,minute(local.slot),session);
    if(!schedule.entryAtUtc||!schedule.horizonEndUtc||now>=exact(schedule.horizonEndUtc))throw new Error('HORIZON_INELIGIBLE: decisión demasiado tardía.');
    const p=input.probabilities.xgboost,winner=['ALCISTA','BAJISTA','LATERAL'][p.indexOf(Math.max(...p))];
    if(input.dominantClass!==winner)throw new Error('Clase argmax inconsistente.');
    const id=sha(JSON.stringify({model:input.modelSha256,bar:input.barStartUtc}));
    const unsigned={schema:'phase38f-observation-v1' as const,kind:'PREDICTION' as const,id,previousHash:existing.at(-1)?.recordHash??null,
      ...input,registeredAtUtc:nowUtc,entryAtUtc:schedule.entryAtUtc,outcomeAtUtc:schedule.horizonEndUtc,
      recordedBeforeEntry:now<exact(schedule.entryAtUtc),recordedBeforeOutcome:true};
    const record={...unsigned,recordHash:sha(JSON.stringify(unsigned))};
    writeFileSync(path,JSON.stringify(record)+'\n',{flag:'a'});return {record,alreadyPresent:false};
  });
}
export function evaluateIexPredictions(path:string,source:IexRecord[],clock:()=>string=()=>new Date().toISOString()){
  return lock(path,()=>{
    const rows=readIexObservations(path),nowUtc=clock(),now=exact(nowUtc),first=firstQuarters(source,now),byStart=new Map(first.map(row=>[row.bar!.startUtc,row]));
    const added:IexEvaluation[]=[];
    for(const prediction of rows.filter((r):r is IexPrediction=>r.kind==='PREDICTION')){
      // Wait for the complete quarter to arrive; an absent bar at its scheduled close is not a missing outcome.
      if(rows.some(row=>row.kind==='EVALUATION'&&row.predictionId===prediction.id)||now<exact(prediction.outcomeAtUtc)+30*60_000)continue;
      const entry=byStart.get(prediction.entryAtUtc),last=byStart.get(stamp(exact(prediction.outcomeAtUtc)-QUARTER));
      const intermediate=Array.from({length:4},(_,i)=>byStart.get(stamp(exact(prediction.entryAtUtc)+i*QUARTER)));
      const status:IexEvaluation['status']=!entry?'MISSING_ENTRY':intermediate.some(row=>!row)||!last?'MISSING_OUTCOME':'EVALUATED';
      const unsigned={schema:'phase38f-observation-v1' as const,kind:'EVALUATION' as const,
        id:sha(JSON.stringify({prediction:prediction.id,kind:'EVALUATION'})),previousHash:(added.at(-1)??rows.at(-1))?.recordHash??null,
        predictionId:prediction.id,status,evaluatedAtUtc:nowUtc,entrySourceHash:entry?.recordHash??null,
        outcomeSourceHash:last?.recordHash??null,entryOpen:entry?.bar?.open??null,outcomeClose:last?.bar?.close??null,
        label:status==='EVALUATED'?classifyMovement(last!.bar!.close-entry!.bar!.open,prediction.atr14PriceUnits):null};
      const record={...unsigned,recordHash:sha(JSON.stringify(unsigned))};writeFileSync(path,JSON.stringify(record)+'\n',{flag:'a'});added.push(record);
    }
    return added;
  });
}
