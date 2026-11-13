import {createHash} from 'node:crypto';
import type {InputRecord} from '../../apps/api/src/real-trades/normalize.ts';

const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
/** Find a unique New York wall-clock instant; do not silently choose a DST overlap or gap. */
export function newYorkLocalToUtc(value:string):string {
  const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if(!m)throw new Error('LOCAL_TIME_INVALID');
  const [,y,month,day,hour,minute,second]=m;
  const nominal=Date.UTC(Number(y),Number(month)-1,Number(day),Number(hour),Number(minute),Number(second));
  const date=new Date(nominal);
  if(date.getUTCFullYear()!==Number(y)||date.getUTCMonth()!==Number(month)-1||date.getUTCDate()!==Number(day)||
    Number(hour)>23||Number(minute)>59||Number(second)>59)throw new Error('LOCAL_TIME_INVALID');
  const matches:number[]=[];
  for(let offset=-14*60;offset<=14*60;offset+=15){
    const candidate=nominal+offset*60_000;
    const p=Object.fromEntries(formatter.formatToParts(new Date(candidate)).map(x=>[x.type,x.value]));
    if(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`===value)matches.push(candidate);
  }
  if(matches.length!==1)throw new Error('LOCAL_TIME_AMBIGUOUS_OR_NONEXISTENT');
  return new Date(matches[0]!).toISOString();
}

export type QueueItem={sourceRecordId:string; sourceTradeIds:string[]; sourceKey:string|null; symbol:string|null;
  entryLocal:string|null; entryUtc:string|null; image:string|null; priority:string|null;
  status:'NO_VERIFICABLE'|'IDENTITY_CONFLICT'; reasons:string[]; hypotheses:readonly string[];
  observed:never[]; supportingEvidence:never[]; contradictingEvidence:never[]; laterEvolution:null};
const hypotheses=['FORTALEZA_RELATIVA','CATALIZADOR','RETESTEO','VWAP','APERTURA_ANTICIPATORIA','PROMEDIADO'] as const;
const text=(value:unknown)=>typeof value==='string'&&value.trim()?value.trim():null;
export function buildPendingQueue(records:readonly InputRecord[]):QueueItem[]{
  const seenIds=new Set<string>();
  const queue=records.map(record=>{
    if(!record.id||seenIds.has(record.id))throw new Error('SOURCE_ID_INVALID_OR_DUPLICATE');seenIds.add(record.id);
    const f=record.fields, symbol=text(f['Ticker'])?.toUpperCase()??null, entryLocal=text(f['Fecha entrada ET']);
    const image=text(f['Lote imagen numero']),priority=text(f['Prioridad']);
    const sourceTradeIds=Array.isArray(f['Trade reconstruido']) ? f['Trade reconstruido'].filter((id):id is string=>typeof id==='string') : [];
    let entryUtc:string|null=null;const reasons:string[]=[];
    try {if(entryLocal)entryUtc=newYorkLocalToUtc(entryLocal);else reasons.push('HORA_DE_ENTRADA_AUSENTE');}
    catch {reasons.push('HORA_LOCAL_INVALIDA_O_AMBIGUA');}
    if(!symbol||!/^[A-Z][A-Z0-9.]{0,9}$/.test(symbol))reasons.push('ACTIVO_INVALIDO');
    if(!image||!/^\d+$/.test(image))reasons.push('IMAGEN_DE_ENTRADA_NO_IDENTIFICADA');
    if(!sourceTradeIds.length)reasons.push('TRADE_ORIGEN_NO_ENLAZADO');
    reasons.push('HISTORIAL_Y_RECEPCION_NO_VERIFICADOS');
    const sourceKey=symbol&&/^[A-Z][A-Z0-9.]{0,9}$/.test(symbol)&&entryLocal&&entryUtc&&image&&/^\d+$/.test(image)?`${symbol}|${entryLocal}|${image}`:null;
    return {sourceRecordId:record.id,sourceTradeIds,sourceKey,symbol,entryLocal,entryUtc,image,priority,
      status:'NO_VERIFICABLE' as const,reasons,hypotheses,observed:[],supportingEvidence:[],contradictingEvidence:[],laterEvolution:null};
  });
  const counts=new Map<string,number>();for(const item of queue)if(item.sourceKey)counts.set(item.sourceKey,(counts.get(item.sourceKey)??0)+1);
  const priority=(v:string|null)=>v?.toLowerCase()==='alta'?0:v?.toLowerCase()==='media'?1:2;
  return queue.map(item=>item.sourceKey&&(counts.get(item.sourceKey)??0)>1?
    {...item,status:'IDENTITY_CONFLICT' as const,reasons:[...item.reasons,'CLAVE_DE_LOTE_REPETIDA']} : item)
    .sort((a,b)=>priority(a.priority)-priority(b.priority)||(a.entryUtc??'9999').localeCompare(b.entryUtc??'9999')||a.sourceRecordId.localeCompare(b.sourceRecordId));
}
export function stableQueueHash(queue:readonly QueueItem[]):string{return createHash('sha256').update(JSON.stringify(queue)).digest('hex');}
