import {createHash} from 'node:crypto';
import {RealTradeExecution,type RealTradeExecution as Execution} from '@trading-poc/contracts';

export const DEFAULT_FIELDS={executionId:'ID ejecucion',executedAtUtc:'Fecha y hora',asset:'Activo',contract:'Contrato',instrument:'Instrumento',side:'Lado',quantity:'Cantidad',unitPrice:'Prima USD',grossAmount:'Importe bruto USD',commission:'Comision USD',reportedRealizedPnl:'PnL realizado IBKR USD',orderId:'ID orden IBKR',sourceOriginal:'Origen',conId:'conId',multiplier:'Multiplicador',currency:'Moneda',sourceRecordId:'ID registro Airtable'} as const;
export type FieldMap=Record<keyof typeof DEFAULT_FIELDS,string>;
export type InputRecord={id?:string;fields:Record<string,unknown>};
const pick=(fields:Record<string,unknown>,mapping:FieldMap,key:keyof FieldMap)=>fields[mapping[key]];
const optionalString=(value:unknown,max=240)=>value===undefined||value===null||value===''?null:typeof value==='string'&&value.trim().length<=max?value.trim():invalid('INVALID_FIELD');
function invalid(code:string):never{throw new Error(code);}
function decimal(value:unknown,required=false,allowUsdFormatting=false):string|null{
  if(value===null||value===undefined||value===''){if(required)invalid('MISSING_DECIMAL');return null;}
  if(typeof value!=='number'&&typeof value!=='string')invalid('INVALID_DECIMAL');
  let raw=String(value).trim();
  if(allowUsdFormatting&&typeof value==='string'){
    const usd=/^(-?)\$((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,8})?)$/.exec(raw);
    if(usd)raw=`${usd[1]}${usd[2]!.replaceAll(',','')}`;
  }
  if(typeof value==='string'&&/^-?\d{1,3}(?:,\d{3})+(?:\.\d{1,8})?$/.test(raw))raw=raw.replaceAll(',','');
  if(raw.length>32||!/^-?(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(raw))invalid('INVALID_DECIMAL');
  return raw;
}
function utcExact(value:unknown):string{
  if(typeof value!=='string')invalid('INVALID_TIMESTAMP');
  const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if(!m)invalid('INVALID_TIMESTAMP');
  const offset=m[7]==='Z'?0:(m[8]==='+'?1:-1)*(Number(m[9])*60+Number(m[10]));
  if(Math.abs(offset)>14*60||Number(m[9]??0)>14||Number(m[10]??0)>59)invalid('INVALID_TIMESTAMP');
  const at=Date.parse(value);if(!Number.isFinite(at))invalid('INVALID_TIMESTAMP');
  const roundtrip=new Date(at+offset*60000).toISOString();
  if(roundtrip.slice(0,19)!==value.slice(0,19))invalid('INVALID_TIMESTAMP');
  return new Date(at).toISOString();
}
const ny=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZoneName:'shortOffset'});
function nyTime(utc:string){const parts=Object.fromEntries(ny.formatToParts(new Date(utc)).map(x=>[x.type,x.value]));const offset=/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(parts.timeZoneName??'');if(!offset)throw new Error('NEW_YORK_TIMEZONE_UNAVAILABLE');return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset[1]}${offset[2]!.padStart(2,'0')}:${offset[3]??'00'}`;}
const selectText=(v:unknown)=>typeof v==='string'?v:typeof v==='object'&&v!==null&&'name' in v&&typeof v.name==='string'?v.name:null;
export function normalizeExecution(record:InputRecord,mapping:FieldMap=DEFAULT_FIELDS):Execution{
  const f=record.fields;
  const declaredEnvironment=f.environment??f.Environment??f.Entorno;
  const declaredAccount=f.accountAlias??f['Alias de cuenta']??f.Cuenta;
  if(declaredEnvironment!==undefined&&declaredEnvironment!==null&&String(declaredEnvironment).toUpperCase()!=='REAL')invalid('WRONG_ENVIRONMENT');
  if(declaredAccount!==undefined&&declaredAccount!==null&&String(declaredAccount)!=='Primary')invalid('WRONG_ACCOUNT');
  const executionId=optionalString(pick(f,mapping,'executionId'),120);if(!executionId)invalid('MISSING_EXECUTION_ID');
  const asset=optionalString(pick(f,mapping,'asset'),20)?.toUpperCase();if(!asset||!/^[A-Z0-9.]{1,20}$/.test(asset))invalid('INVALID_ASSET');
  const rawSide=selectText(pick(f,mapping,'side'))?.toUpperCase();if(rawSide!=='BUY'&&rawSide!=='SELL')invalid('INVALID_SIDE');
  const quantity=decimal(pick(f,mapping,'quantity'),true)!;if(Number(quantity)<=0)invalid('INVALID_QUANTITY');
  const unitPrice=decimal(pick(f,mapping,'unitPrice'),false,true);if(unitPrice!==null&&Number(unitPrice)<0)invalid('INVALID_PRICE');
  const at=utcExact(pick(f,mapping,'executedAtUtc'));
  const conRaw=pick(f,mapping,'conId');const conId=conRaw===null||conRaw===undefined||conRaw===''?null:Number(conRaw);
  if(conId!==null&&(!Number.isSafeInteger(conId)||conId<=0))invalid('INVALID_CON_ID');
  const currency=optionalString(pick(f,mapping,'currency'),3)?.toUpperCase()??'USD';
  const result={environment:'REAL',accountAlias:'Primary',executionId,orderId:optionalString(pick(f,mapping,'orderId'),120),conId,
    contract:optionalString(pick(f,mapping,'contract')),asset,instrument:optionalString(selectText(pick(f,mapping,'instrument')),40),side:rawSide,quantity,unitPrice,
    multiplier:decimal(pick(f,mapping,'multiplier')),grossAmount:decimal(pick(f,mapping,'grossAmount'),false,true),currency,
    commission:decimal(pick(f,mapping,'commission'),false,true),reportedRealizedPnl:decimal(pick(f,mapping,'reportedRealizedPnl'),false,true),
    executedAtUtc:at,executedAtNewYork:nyTime(at),quality:conId===null&&unitPrice===null?'INCOMPLETE_CONTRACT_AND_PRICE':conId===null?'INCOMPLETE_CONTRACT':unitPrice===null?'INCOMPLETE_PRICE':'COMPLETE',
    sourceOriginal:optionalString(pick(f,mapping,'sourceOriginal'),120)};
  if(result.multiplier!==null&&Number(result.multiplier)<=0)invalid('INVALID_MULTIPLIER');
  return RealTradeExecution.parse(result);
}
export function executionHash(value:Execution){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function mappedRecordId(record:InputRecord,mapping:FieldMap){const raw=pick(record.fields,mapping,'sourceRecordId');return typeof raw==='string'&&raw.trim().length>0&&raw.length<=120?raw.trim():null;}
export function sourceRecordId(record:InputRecord,mapping:FieldMap=DEFAULT_FIELDS){return record.id??mappedRecordId(record,mapping)??`execution:${String(pick(record.fields,mapping,'executionId')??'unknown')}`;}
export function hasStableSourceRecordId(record:InputRecord,mapping:FieldMap=DEFAULT_FIELDS){return !!(record.id??mappedRecordId(record,mapping));}
