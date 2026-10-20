/** Fase 31: preparación causal y registro local de inferencias congeladas. */
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import type {Candle} from './domain.ts';
import {loadDataset} from './csv.ts';
import {loadMarketCalendar,type MarketCalendar} from './alpaca-calendar.ts';
import {calculatePhase23Features,DATASET_SPEC} from './phase23-dataset.ts';
import {newYorkBarParts} from './strategy-validation.ts';

export const PHASE31_FEATURES=['return_1','return_4','distance_ema9','distance_sma20','bollinger_position','relative_volume_20','candle_range','candle_body','atr14_relative','minutes_from_open'] as const;
export type Phase31Feature=typeof PHASE31_FEATURES[number];
export type CaptureMode='REPLAY'|'PROSPECTIVE_CAPTURE';
export type PreparedInference={barStartUtc:string;barEndUtc:string;sessionDateNy:string;features:Record<Phase31Feature,number>;featureHash:string;source:{provider:string;feed:'sip';adjustment:'split';receivedAtUtc:string;availability:'VERIFIED'};};
export type InferenceRecord={schema:'phase31-inference-v1';recordId:string;previousHash:string|null;recordHash:string;mode:CaptureMode;model:{id:string;sha256:string;createdAtUtc:string};bar:{startUtc:string;endUtc:string;sessionDateNy:string;receivedAtUtc:string};features:{spec:string;hash:string;values:Record<Phase31Feature,number>};prediction:{ALCISTA:number;BAJISTA:number;LATERAL:number;dominantClass:'ALCISTA'|'BAJISTA'|'LATERAL'};source:{provider:string;feed:'sip';adjustment:'split';availability:'VERIFIED'};registeredAtUtc:string;outcomeKnownAtUtc:string;recordedBeforeOutcome:boolean;recordedBeforeNextEntry:boolean;};
const BAR_MS=15*60_000;
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const canonical=(value:unknown)=>JSON.stringify(value);
function exactIso(value:string,label:string){const at=Date.parse(value);if(!Number.isFinite(at)||new Date(at).toISOString()!==value)throw new Error(`${label} debe ser UTC ISO exacto.`);return at;}
function minutes(slot:string){const [hour,minute]=slot.split(':').map(Number);return hour!*60+minute!;}
function validateSource(metadata:{asset:string;provider:string;bar_minutes:number;data_class:string;session:string;exchange_timezone:string;feed?:string;adjustment?:string}){
  if(metadata.asset!=='NVDA'||metadata.bar_minutes!==15||metadata.data_class!=='real'||metadata.session!=='regular'||metadata.exchange_timezone!=='America/New_York'||metadata.feed!=='sip'||metadata.adjustment!=='split'||!/^alpaca/i.test(metadata.provider))throw new Error('La inferencia exige velas reales NVDA 15m Alpaca SIP ajustadas por split de sesión regular.');
}
function assertCalendarCandle(candle:Candle,calendar:MarketCalendar){
  const local=newYorkBarParts(candle.timestamp),session=calendar.get(local.day);
  if(!session||minutes(local.slot)<session.open||minutes(local.slot)>=session.close)throw new Error('Vela fuera del calendario Alpaca.');
}
/** Uses Fase 23 unchanged. A null feature closes the gate for gaps, incomplete sessions and insufficient history. */
export function preparePhase31Inference(candles:readonly Candle[],calendar:MarketCalendar,metadata:Parameters<typeof validateSource>[0],receivedAtUtc:string,nowUtc:string=new Date().toISOString()):PreparedInference{
  validateSource(metadata);const received=exactIso(receivedAtUtc,'receivedAtUtc'),now=exactIso(nowUtc,'nowUtc');
  if(received>now+5_000)throw new Error('La recepción no puede estar en el futuro.');
  if(!candles.length)throw new Error('No hay velas admisibles.');
  for(const candle of candles)assertCalendarCandle(candle,calendar);
  const last=candles.at(-1)!;const end=Date.parse(last.timestamp)+BAR_MS;
  if(end>now)throw new Error('La última vela aún no cerró.');
  if(received<end)throw new Error('La recepción declarada antecede el cierre de la vela.');
  const calculated=calculatePhase23Features(candles,calendar).at(-1);
  if(!calculated)throw new Error('Indicadores insuficientes o continuidad temporal incompleta.');
  const local=newYorkBarParts(last.timestamp),session=calendar.get(local.day)!;
  const values={return_1:calculated.return_1,return_4:calculated.return_4,distance_ema9:calculated.distance_ema9,distance_sma20:calculated.distance_sma20,
    bollinger_position:calculated.bollinger_position,relative_volume_20:calculated.relative_volume_20,candle_range:calculated.candle_range,candle_body:calculated.candle_body,
    atr14_relative:calculated.atr14_relative,minutes_from_open:minutes(local.slot)-session.open} as Record<Phase31Feature,number>;
  if(Object.values(values).some(value=>!Number.isFinite(value)))throw new Error('Variables no finitas.');
  const featureHash=hash(canonical({spec:DATASET_SPEC,names:PHASE31_FEATURES,values}));
  return {barStartUtc:last.timestamp,barEndUtc:new Date(end).toISOString(),sessionDateNy:local.day,features:values,featureHash,source:{provider:metadata.provider,feed:'sip',adjustment:'split',receivedAtUtc,availability:'VERIFIED'}};
}
export function preparePhase31FromFiles(csvPath:string,receivedAtUtc:string,nowUtc?:string){
  const {candles,metadata}=loadDataset(csvPath);const calendar=loadMarketCalendar(`${csvPath}.calendar.json`);
  return preparePhase31Inference(candles,calendar,metadata,receivedAtUtc,nowUtc);
}
/** Optional local audit against a Fase 23 row. It never creates or changes a dataset. */
export function assertPhase31FeatureEquivalence(values:Record<Phase31Feature,number>,row:Record<string,string>,tolerance=1e-12){
  for(const name of PHASE31_FEATURES){const expected=Number(row[name]);if(!Number.isFinite(expected)||Math.abs(values[name]-expected)>tolerance)throw new Error(`Variable Fase 23 no equivalente: ${name}`);}
}
function readRecords(path:string):InferenceRecord[]{
  if(!existsSync(path))return [];const lines=readFileSync(path,'utf8').split(/\r?\n/).filter(Boolean);let prior:string|null=null;
  return lines.map(line=>{const record=JSON.parse(line) as InferenceRecord;if(record.schema!=='phase31-inference-v1'||record.previousHash!==prior)throw new Error('Registro de inferencias alterado o no secuencial.');
    const {recordHash,...unsigned}=record;if(hash(canonical(unsigned))!==recordHash)throw new Error('Hash inválido en registro de inferencias.');prior=recordHash;return record;});
}
export function appendPhase31Record(path:string,input:Omit<InferenceRecord,'schema'|'recordId'|'previousHash'|'recordHash'|'registeredAtUtc'|'outcomeKnownAtUtc'|'recordedBeforeOutcome'|'recordedBeforeNextEntry'>,registeredAtUtc:string=new Date().toISOString()):{record:InferenceRecord;alreadyPresent:boolean}{
  const registered=exactIso(registeredAtUtc,'registeredAtUtc'),records=readRecords(path);
  const recordId=hash(canonical({model:input.model.sha256,bar:input.bar.startUtc,mode:input.mode,features:input.features.hash}));
  const existing=records.find(record=>record.recordId===recordId);if(existing)return {record:existing,alreadyPresent:true};
  const outcomeKnownAtUtc=new Date(Date.parse(input.bar.startUtc)+BAR_MS*5).toISOString();
  if(input.mode==='PROSPECTIVE_CAPTURE'&&(Date.parse(input.bar.endUtc)<=Date.parse(input.model.createdAtUtc)||registered>Date.parse(outcomeKnownAtUtc)))throw new Error('Captura prospectiva sin evidencia temporal admisible.');
  const unsigned={schema:'phase31-inference-v1' as const,recordId,previousHash:records.at(-1)?.recordHash??null,...input,registeredAtUtc:new Date(registered).toISOString(),outcomeKnownAtUtc,recordedBeforeOutcome:registered<=Date.parse(outcomeKnownAtUtc),recordedBeforeNextEntry:registered<=Date.parse(input.bar.endUtc)};
  const record={...unsigned,recordHash:hash(canonical(unsigned))};mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(record)+'\n',{flag:'a'});return {record,alreadyPresent:false};
}
export function latestPhase31Record(path:string):InferenceRecord|null{return readRecords(path).at(-1)??null;}
export function frozenModel(directory:string){
  const model=join(directory,'model.json'),report=join(directory,'report.json');if(!existsSync(model)||!existsSync(report))throw new Error('Faltan artefactos del modelo congelado.');
  const stamp=/^(\d{8})T(\d{6})Z-/.exec(directory.split(/[\\/]/).at(-1)??'');if(!stamp)throw new Error('Nombre de experimento inválido.');
  const createdAtUtc=`${stamp[1]!.slice(0,4)}-${stamp[1]!.slice(4,6)}-${stamp[1]!.slice(6,8)}T${stamp[2]!.slice(0,2)}:${stamp[2]!.slice(2,4)}:${stamp[2]!.slice(4,6)}.000Z`;
  return {modelPath:model,sha256:hash(readFileSync(model)),id:hash(readFileSync(model)).slice(0,24),createdAtUtc};
}
