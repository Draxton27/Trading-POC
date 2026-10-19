import type Database from 'better-sqlite3';
import {AcademyAskEvaluation,AcademyAskRange,type AcademyAskRange as Range} from '@trading-poc/contracts';

type ReferenceStatus='ACTIVE'|'REFERENCE_DATE'|'HISTORICAL_ONLY'|'CONFLICT'|'NONE';
export type Reference={status:ReferenceStatus;range:Range|null;reason:string};
const day=(value:string)=>value.slice(0,10);
const cents=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>0&&Number.isSafeInteger(Math.round(value*100))?Math.round(value*100):null;
const rowToRange=(row:Record<string,unknown>):Range=>AcademyAskRange.parse({id:row.id,asset:row.asset,optionRight:row.option_right,minAskCents:row.min_ask_cents,maxAskCents:row.max_ask_cents,currency:row.currency,unit:row.unit,referenceDate:row.reference_date,validFrom:row.valid_from,validTo:row.valid_to,documentHash:row.document_hash,sourceFile:row.source_file,sourceLocation:row.source_location,versionId:row.version_id,extractionMethod:row.extraction_method,validationStatus:row.validation_status,notes:row.notes,importedAtUtc:row.imported_at_utc});
export function academyRanges(sqlite:Database.Database,asset:string){return sqlite.prepare('SELECT * FROM academy_ask_ranges WHERE asset=? ORDER BY reference_date DESC, imported_at_utc DESC').all(asset).map(x=>rowToRange(x as Record<string,unknown>));}
function distinctReferences(ranges:Range[]){
  const values=new Map<string,Range>();
  for(const range of ranges){
    const key=[range.asset,range.optionRight??'',range.minAskCents,range.maxAskCents,range.currency,range.unit].join('|');
    if(!values.has(key))values.set(key,range);
  }
  return [...values.values()];
}
export function selectAcademyReference(ranges:Range[],asOf:string,right:'CALL'|'PUT'|null=null):Reference{
  const at=day(asOf),documented=ranges.filter(range=>range.validationStatus==='DOCUMENTED');
  const specific=right===null?[]:documented.filter(range=>range.optionRight===right);
  const candidates=specific.length?specific:documented.filter(range=>range.optionRight===null);
  const active=distinctReferences(candidates.filter(range=>range.validFrom!==null&&range.validTo!==null&&range.validFrom<=at&&at<=range.validTo));
  if(active.length===1)return {status:'ACTIVE',range:active[0]!,reason:'Vigencia documental explícita'};
  if(active.length>1)return {status:'CONFLICT',range:null,reason:'Hay varias referencias documentales vigentes'};
  const exact=distinctReferences(candidates.filter(range=>range.referenceDate===at));
  if(exact.length===1)return {status:'REFERENCE_DATE',range:exact[0]!,reason:'Fecha de referencia documental'};
  if(exact.length>1)return {status:'CONFLICT',range:null,reason:'Hay referencias contradictorias para la fecha consultada'};
  const historical=candidates.filter(range=>range.referenceDate!==null&&range.referenceDate<at).sort((a,b)=>b.referenceDate!.localeCompare(a.referenceDate!));
  if(historical.length){const latest=distinctReferences(historical.filter(range=>range.referenceDate===historical[0]!.referenceDate));if(latest.length>1)return {status:'CONFLICT',range:null,reason:'Hay varias referencias contradictorias en la última fecha anterior'};return {status:'HISTORICAL_ONLY',range:latest[0]!,reason:'La fuente no declara vigencia para aplicar esta referencia en otra fecha'};}
  return {status:'NONE',range:null,reason:'No existe una referencia documental aplicable'};
}
export function evaluateAcademyAskRange(reference:Reference,quote:{ask?:unknown;last?:unknown;receivedAtUtc?:unknown;marketTimestampUtc?:unknown;feedType?:unknown;marketDataStatus?:unknown;provider?:unknown}|null,now=Date.now(),currency='USD',multiplier:number|null=100){
  const receivedRaw=typeof quote?.receivedAtUtc==='string'?quote.receivedAtUtc:null;
  const receivedAt=receivedRaw?Date.parse(receivedRaw):Number.NaN;
  const received=Number.isFinite(receivedAt)?receivedRaw:null;
  const marketRaw=typeof quote?.marketTimestampUtc==='string'?quote.marketTimestampUtc:null;
  const marketAt=marketRaw?Date.parse(marketRaw):Number.NaN;
  const base={referenceStatus:reference.status,reference:reference.range,askCents:null,distancePercent:null,quoteReceivedAtUtc:received};
  if(reference.status==='NONE')return AcademyAskEvaluation.parse({...base,status:'NO_REFERENCE',reason:reference.reason});
  if(reference.status==='CONFLICT'||reference.status==='HISTORICAL_ONLY')return AcademyAskEvaluation.parse({...base,status:'INSUFFICIENT_DATA',reason:reference.reason});
  if(currency!=='USD'||multiplier!==100)return AcademyAskEvaluation.parse({...base,status:'INSUFFICIENT_DATA',reason:'Moneda o multiplicador incompatibles con la referencia documental'});
  if(quote?.marketDataStatus==='permission_denied'||quote?.marketDataStatus==='unavailable'||quote?.marketDataStatus==='partial')return AcademyAskEvaluation.parse({...base,status:'INSUFFICIENT_DATA',reason:'La cotización IBKR no está disponible con permisos verificables'});
  if(quote?.provider==='DEMO sintético'||quote?.provider==='PAPER SIMULADO')return AcademyAskEvaluation.parse({...base,status:'INSUFFICIENT_DATA',reason:'La cotización simulada no es un precio de mercado ejecutable'});
  const feed=typeof quote?.feedType==='string'?quote.feedType:'UNKNOWN';
  if(feed==='DELAYED'||feed==='DELAYED_FROZEN')return AcademyAskEvaluation.parse({...base,status:'INSUFFICIENT_DATA',reason:'El ASK procede de un feed retrasado y no se evalúa como precio actual'});
  if(feed==='FROZEN')return AcademyAskEvaluation.parse({...base,status:'INSUFFICIENT_DATA',reason:'El ASK procede de un feed congelado y no se evalúa como precio actual'});
  if(feed!=='LIVE')return AcademyAskEvaluation.parse({...base,status:'INSUFFICIENT_DATA',reason:'No se puede comprobar un feed LIVE para el ASK'});
  const ask=cents(quote?.ask);if(ask===null)return AcademyAskEvaluation.parse({...base,status:'NO_ASK',reason:'No hay ASK válido para evaluar el contrato'});
  if(!Number.isFinite(receivedAt)||receivedAt>now||now-receivedAt>30000)return AcademyAskEvaluation.parse({...base,askCents:ask,status:'STALE_QUOTE',reason:'El ASK no tiene una recepción reciente'});
  if(!Number.isFinite(marketAt)||marketAt>now||now-marketAt>30000)return AcademyAskEvaluation.parse({...base,askCents:ask,status:'STALE_QUOTE',reason:'El ASK LIVE no tiene un timestamp de mercado reciente'});
  const range=reference.range!;
  if(ask<range.minAskCents)return AcademyAskEvaluation.parse({...base,askCents:ask,status:'BELOW_RANGE',distancePercent:(range.minAskCents-ask)/range.minAskCents*100,reason:'ASK por debajo del mínimo documental'});
  if(ask>range.maxAskCents)return AcademyAskEvaluation.parse({...base,askCents:ask,status:'ABOVE_RANGE',distancePercent:(ask-range.maxAskCents)/range.maxAskCents*100,reason:'ASK por encima del máximo documental'});
  const nearest=Math.min((ask-range.minAskCents)/range.minAskCents*100,(range.maxAskCents-ask)/range.maxAskCents*100);
  return AcademyAskEvaluation.parse({...base,askCents:ask,status:'WITHIN_RANGE',distancePercent:nearest,reason:'ASK dentro del rango documental'});
}
export function academySummary(sqlite:Database.Database){return sqlite.prepare('SELECT COUNT(*) AS documentCount, COALESCE(SUM(record_count),0) AS recordCount, MAX(imported_at_utc) AS lastImportUtc FROM academy_documents').get();}
