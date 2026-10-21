/** Fase 34: observaciones retrasadas registradas antes del desenlace t+4. */
import {createHash} from 'node:crypto';
import {closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import type {MarketCalendar} from './alpaca-calendar.ts';
import type {Candle} from './domain.ts';
import {readIngestion, type IngestionRecord} from './phase32-ingestion.ts';
import {phase23ContinuousSuffix} from './phase23-dataset.ts';
import {PHASE31_FEATURES, preparePhase31Inference, type Phase31Feature, type PreparedInference} from './phase31-inference.ts';

const BAR_MS=15*60_000;
/** Twenty prior bars are required by Bollinger and relative volume, plus t. */
const FEATURE_HISTORY_BARS=21;
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const canonical=(value:unknown)=>JSON.stringify(value);
const exact=(value:string,label:string)=>{const at=Date.parse(value);if(!Number.isFinite(at)||new Date(at).toISOString()!==value)throw new Error(`${label} debe ser UTC ISO exacto.`);return at;};
export type ForwardObservation={schema:'phase34-forward-observation-v1';recordId:string;previousHash:string|null;recordHash:string;mode:'DELAYED_FORWARD_OBSERVATION';model:{id:string;sha256:string;createdAtUtc:string};bar:{startUtc:string;endUtc:string;sessionDateNy:string;sourceRecordHash:string;sourceResponseSha256:string;revision:number;receivedAtUtc:string};sourceBars:Array<{startUtc:string;endUtc:string;revision:number;recordHash:string;responseSha256:string;receivedAtUtc:string}>;features:{spec:'nvda-15m-v1';hash:string;values:Record<Phase31Feature,number>};prediction:{ALCISTA:number;BAJISTA:number;LATERAL:number;dominantClass:'ALCISTA'|'BAJISTA'|'LATERAL'};source:{provider:'Alpaca Market Data API';feed:'sip';adjustment:'split';availability:'DELAYED'};registeredAtUtc:string;outcomeKnownAtUtc:string;entryAtUtc:string;outcomeCloseAtUtc:string;hypotheticalNextEntryOpen:null;outcomeT4Close:null;recordedBeforeOutcome:boolean;recordedBeforeNextEntry:boolean;};
export type FrozenModel={id:string;sha256:string;createdAtUtc:string};
export type ForwardPreparation={prepared:PreparedInference;candidate:IngestionRecord;sourceBars:ForwardObservation['sourceBars'];candles:Candle[];};

function lock<T>(path:string,work:()=>T):T{
  mkdirSync(dirname(path),{recursive:true});const lockPath=`${path}.lock`,deadline=Date.now()+5_000;let descriptor:number|undefined;
  while(descriptor===undefined){try{descriptor=openSync(lockPath,'wx');}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;if(Date.now()>=deadline)throw new Error('Otro observador mantiene el registro; reintente.');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);}}
  try{return work();}finally{closeSync(descriptor);unlinkSync(lockPath);}
}
export function readForwardObservations(path:string):ForwardObservation[]{
  if(!existsSync(path))return [];let prior:string|null=null;
  return readFileSync(path,'utf8').split(/\r?\n/).filter(Boolean).map(line=>{const row=JSON.parse(line) as ForwardObservation;const {recordHash,...unsigned}=row;
    if(row.schema!=='phase34-forward-observation-v1'||row.previousHash!==prior||sha(canonical(unsigned))!==recordHash)throw new Error('Registro de observaciones adelantadas alterado o no secuencial.');
    prior=recordHash;return row;
  });
}
function barRows(records:readonly IngestionRecord[],cutoff:number):IngestionRecord[]{
  const selected=new Map<string,IngestionRecord>();
  for(const row of records){
    if(row.kind!=='bar'||!row.bar||Date.parse(row.receivedAtUtc)>cutoff)continue;
    if(row.provider!=='Alpaca Market Data API'||row.feed!=='sip'||row.adjustment!=='split'||row.availability!=='DELAYED'||row.status!=='DELAYED'||!row.responseSha256)throw new Error('El ledger contiene una vela que no es Alpaca SIP retrasada verificable.');
    selected.set(row.bar.startUtc,row);
  }
  return [...selected.values()].sort((a,b)=>Date.parse(a.bar!.startUtc)-Date.parse(b.bar!.startUtc));
}
function asCandle(row:IngestionRecord):Candle{const bar=row.bar!;return {timestamp:bar.startUtc,open:bar.open,high:bar.high,low:bar.low,close:bar.close,volume:bar.volume};}
/** Uses only ledger revisions known at the observer clock and chooses the newest bar, never an older backfill. */
export function prepareForwardObservation(ledgerPath:string,calendar:MarketCalendar,model:FrozenModel,nowUtc:string):ForwardPreparation{
  const now=exact(nowUtc,'nowUtc'),rows=barRows(readIngestion(ledgerPath),now);if(!rows.length)throw new Error('No hay velas SIP retrasadas verificadas en el ledger.');
  const candidate=rows.at(-1)!, bar=candidate.bar!, start=exact(bar.startUtc,'inicio de vela'), outcome=start+BAR_MS*5;
  if(exact(model.createdAtUtc,'creación de modelo')>=start)throw new Error('El modelo congelado es posterior o simultáneo a la vela observada.');
  // A delayed ledger can be stale. Recording after this instant would manufacture a historical observation.
  if(now>=outcome)throw new Error('La vela más nueva ya alcanzó el desenlace t+4; no se realiza backfill.');
  const allCandles=rows.map(asCandle),candles=phase23ContinuousSuffix(allCandles,calendar);
  if(candles.length<FEATURE_HISTORY_BARS)throw new Error('Indicadores insuficientes: período de calentamiento Fase 23 menor de 21 velas continuas.');
  const sourceRows=rows.slice(rows.length-candles.length),prepared=preparePhase31Inference(candles,calendar,{asset:'NVDA',provider:'Alpaca Market Data API',bar_minutes:15,data_class:'real',session:'regular',exchange_timezone:'America/New_York',feed:'sip',adjustment:'split'},candidate.receivedAtUtc,nowUtc);
  if(prepared.barStartUtc!==bar.startUtc)throw new Error('La preparación no coincide con la última vela del ledger.');
  return {prepared,candidate,candles,sourceBars:sourceRows.map(row=>({startUtc:row.bar!.startUtc,endUtc:row.bar!.endUtc,revision:row.bar!.revision,recordHash:row.recordHash,responseSha256:row.responseSha256!,receivedAtUtc:row.receivedAtUtc}))};
}
function validPrediction(value:ForwardObservation['prediction']){const numbers=[value.ALCISTA,value.BAJISTA,value.LATERAL];if(numbers.some(n=>!Number.isFinite(n)||n<0||n>1)||Math.abs(numbers[0]!+numbers[1]!+numbers[2]!-1)>1e-6||!['ALCISTA','BAJISTA','LATERAL'].includes(value.dominantClass))throw new Error('Probabilidades de XGBoost inválidas.');const winner=(['ALCISTA','BAJISTA','LATERAL'] as const)[numbers.indexOf(Math.max(...numbers))]!;if(winner!==value.dominantClass)throw new Error('Clase dominante inconsistente.');}
export function appendForwardObservation(path:string,input:Omit<ForwardObservation,'schema'|'recordId'|'previousHash'|'recordHash'|'registeredAtUtc'|'outcomeKnownAtUtc'|'entryAtUtc'|'outcomeCloseAtUtc'|'recordedBeforeOutcome'|'recordedBeforeNextEntry'|'hypotheticalNextEntryOpen'|'outcomeT4Close'>,registeredAtUtc:string):{record:ForwardObservation;alreadyPresent:boolean}{
  return lock(path,()=>{const registered=exact(registeredAtUtc,'registeredAtUtc'),records=readForwardObservations(path),start=exact(input.bar.startUtc,'inicio de vela'),outcome=start+BAR_MS*5;
    if(registered>=outcome)throw new Error('La observación debe registrarse estrictamente antes del cierre t+4.');
    if(exact(input.model.createdAtUtc,'creación de modelo')>=start)throw new Error('El modelo no estaba congelado antes de la vela.');
    validPrediction(input.prediction);if(input.source.feed!=='sip'||input.source.adjustment!=='split'||input.source.availability!=='DELAYED')throw new Error('Solo se admiten observaciones SIP retrasadas.');
    const recordId=sha(canonical({mode:input.mode,model:input.model.sha256,bar:input.bar.startUtc}));const existing=records.find(row=>row.recordId===recordId);if(existing)return {record:existing,alreadyPresent:true};
    const entry=start+BAR_MS, unsigned={schema:'phase34-forward-observation-v1' as const,recordId,previousHash:records.at(-1)?.recordHash??null,...input,registeredAtUtc:new Date(registered).toISOString(),outcomeKnownAtUtc:new Date(outcome).toISOString(),entryAtUtc:new Date(entry).toISOString(),outcomeCloseAtUtc:new Date(outcome).toISOString(),hypotheticalNextEntryOpen:null,outcomeT4Close:null,recordedBeforeOutcome:true,recordedBeforeNextEntry:registered<entry};
    const record={...unsigned,recordHash:sha(canonical(unsigned))};writeFileSync(path,JSON.stringify(record)+'\n',{flag:'a'});return {record,alreadyPresent:false};
  });
}
export function latestForwardObservation(path:string):ForwardObservation|null{return readForwardObservations(path).at(-1)??null;}
