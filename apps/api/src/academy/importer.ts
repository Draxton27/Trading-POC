import {basename,extname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type Database from 'better-sqlite3';
import {extractXlsxTables} from './xlsx.ts';

export type ImportedRange={id:string;asset:string;optionRight:null|'CALL'|'PUT';minAskCents:number;maxAskCents:number;outerMinCents:number|null;outerMaxCents:number|null;currency:'USD';unit:'PER_SHARE';referenceDate:string|null;validFrom:null;validTo:null;documentHash:string;sourceFile:string;sourceLocation:string;versionId:string;extractionMethod:'XLSX_TABLE'|'CSV_TABLE'|'HTML_TABLE';validationStatus:'DOCUMENTED'|'UNVERIFIED';notes:string|null;importedAtUtc:string};
type Table={name:string;rows:Array<Record<string,string>>;method:ImportedRange['extractionMethod']};
const normalized=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const money=(value:string)=>{const values=[...value.replace(/,/g,'').matchAll(/\$?\s*(\d+(?:\.\d{1,2})?)/g)].map(x=>x[1]!);if(values.length!==2)return null;const cents=values.map(v=>Math.round(Number(v)*100));return cents.every(Number.isSafeInteger)&&cents[0]!>0&&cents[1]!>0&&cents[0]!<=cents[1]!?[cents[0]!,cents[1]!] as const:null;};
// Only accept complete, unambiguous expressions. Never infer a missing bound.
export function parseOuterBounds(value:string):readonly [number,number]|null{
  const amount=String.raw`\$?\s*(\d+(?:\.\d{1,2})?)`;
  const match=new RegExp(String.raw`^\s*MIN\s*${amount}\s*(?:MAX|[-–—])\s*${amount}\s*$`,'i').exec(value);
  if(!match)return null;
  const parse=(raw:string)=>{const [whole,fraction='']=raw.split('.');const result=BigInt(whole!)*100n+BigInt(fraction.padEnd(2,'0'));return result<=BigInt(Number.MAX_SAFE_INTEGER)?Number(result):null;};
  const min=parse(match[1]!),max=parse(match[2]!);
  return min!==null&&max!==null&&min>0&&min<=max?[min,max]:null;
}
type ParsedDate={value:string|null;note:string|null;invalid:boolean};
const validDate=(year:number,month:number,day:number)=>{const parsed=new Date(Date.UTC(year,month-1,day));return parsed.getUTCFullYear()===year&&parsed.getUTCMonth()===month-1&&parsed.getUTCDate()===day;};
const asDate=(year:number,month:number,day:number):ParsedDate=>validDate(year,month,day)?{value:`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`,note:null,invalid:false}:{value:null,note:'Fecha imposible',invalid:true};
const date=(raw:string):ParsedDate=>{const value=raw.trim();if(!value)return {value:null,note:null,invalid:false};const iso=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);if(iso)return asDate(Number(iso[1]),Number(iso[2]),Number(iso[3]));if(/^\d+(?:\.0+)?$/.test(value)){const days=Number(value);if(days<1||days>100000)return {value:null,note:'Fecha no interpretable',invalid:false};const parsed=new Date(Date.UTC(1899,11,30)+Math.round(days)*86400000);return asDate(parsed.getUTCFullYear(),parsed.getUTCMonth()+1,parsed.getUTCDate());}
  const m=/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value);if(!m)return {value:null,note:'Fecha no interpretable',invalid:false};const first=Number(m[1]),second=Number(m[2]),year=Number(m[3]);if(first<=12&&second<=12)return {value:null,note:'Fecha ambigua',invalid:false};if(first>12&&second<=12)return asDate(year,second,first);if(second>12&&first<=12)return asDate(year,first,second);return {value:null,note:'Fecha imposible',invalid:true};};
function csvRows(input:string){
  const records:string[][]=[];let row:string[]=[],field='',quoted=false;const source=input.replace(/^\uFEFF/,'');
  for(let index=0;index<source.length;index++){const char=source[index]!;
    if(char==='"'){if(quoted&&source[index+1]==='"'){field+='"';index++;}else quoted=!quoted;continue;}
    if(char===','&&!quoted){row.push(field.trim());field='';continue;}
    if((char==='\n'||char==='\r')&&!quoted){if(char==='\r'&&source[index+1]==='\n')index++;row.push(field.trim());if(row.some(Boolean))records.push(row);row=[];field='';continue;}
    field+=char;
  }
  if(quoted)throw new Error('CSV documental con comillas sin cerrar');row.push(field.trim());if(row.some(Boolean))records.push(row);
  return records.map(values=>values.reduce<Record<string,string>>((out,value,index)=>{out[String.fromCharCode(65+index)]=value;return out;},{}));
}
function htmlText(value:string){const named:Record<string,string>={nbsp:' ',amp:'&',aacute:'á',Aacute:'Á',eacute:'é',Eacute:'É',iacute:'í',Iacute:'Í',oacute:'ó',Oacute:'Ó',uacute:'ú',Uacute:'Ú'};return value.replace(/&(#x[0-9a-f]+|#\d+|[A-Za-z]+);/gi,(full,key:string)=>{if(key[0]==='#'){const n=key[1]?.toLowerCase()==='x'?parseInt(key.slice(2),16):parseInt(key.slice(1),10);return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):full;}return named[key]??full;});}
function htmlRows(input:string){return [...input.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(row=>[...row[1]!.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].reduce<Record<string,string>>((out,cell,index)=>{out[String.fromCharCode(65+index)]=htmlText(cell[1]!.replace(/<br\s*\/?>/gi,' ').replace(/<[^>]+>/g,'')).trim();return out;},{}));}
export function academyTables(input:Buffer,sourceFile:string):Table[]{const extension=extname(sourceFile).toLowerCase();
  if(extension==='.xlsx')return extractXlsxTables(input).map(sheet=>({name:sheet.name,rows:sheet.rows,method:'XLSX_TABLE'}));
  if(extension==='.csv')return [{name:'CSV',rows:csvRows(input.toString('utf8')),method:'CSV_TABLE'}];
  if(extension==='.htm'||extension==='.html')return [{name:'HTML',rows:htmlRows(input.toString('utf8')),method:'HTML_TABLE'}];
  throw new Error('Formato documental no permitido; use XLSX, CSV o HTML');
}
export function normalizeAcademyRanges(input:Buffer,sourceFile:string,importedAtUtc=new Date().toISOString()):ImportedRange[]{
  const safe=basename(sourceFile);if(!safe||safe.includes('..'))throw new Error('Nombre documental inseguro');
  const hash=createHash('sha256').update(input).digest('hex'),rows:ImportedRange[]=[];
  for(const table of academyTables(input,safe)){
    const header=table.rows[0];if(!header)continue;const columns=Object.fromEntries(Object.entries(header).map(([key,value])=>[normalized(value),key]));
    const ticker=columns.TICKER??columns.SYMBOL;const range=columns.RANGOOPTIMO??columns.ASKRANGE;const reference=columns.FECHADEANALISIS??columns.FECHA;const outer=columns.MINIMOYMAXIMO;
    if(!ticker||!range)continue;
    for(let index=1;index<table.rows.length;index++){
      const record=table.rows[index]!,asset=(record[ticker]??'').trim().toUpperCase(),amount=money(record[range]??'');if(!asset&&!amount)continue;
      if(!/^[A-Z.]{1,12}$/.test(asset)||!amount)throw new Error(`Fila inválida en ${safe}:${table.name}:${index+1}`);
      const parsedDate=reference?date(record[reference]??''):{value:null,note:null,invalid:false};
      if(parsedDate.invalid)throw new Error(`Fecha inválida en ${safe}:${table.name}:${index+1}`);
      const rawOuter=outer?(record[outer]??'').trim():'';const bounds=parseOuterBounds(rawOuter);
      rows.push({id:randomUUID(),asset,optionRight:null,minAskCents:amount[0],maxAskCents:amount[1],outerMinCents:bounds?.[0]??null,outerMaxCents:bounds?.[1]??null,currency:'USD',unit:'PER_SHARE',referenceDate:parsedDate.value,validFrom:null,validTo:null,documentHash:hash,sourceFile:safe,sourceLocation:`${table.name}!${index+1}`,versionId:hash.slice(0,16),extractionMethod:table.method,validationStatus:'DOCUMENTED',notes:[parsedDate.note,rawOuter&&!bounds?'Límites documentales no interpretables':null].filter(Boolean).join('; ')||null,importedAtUtc});
    }
  }if(!rows.length)throw new Error('No se encontró una tabla con TICKER y RANGO ÓPTIMO/ASK RANGE');return rows;
}
export function importAcademyDocument(sqlite:Database.Database,input:Buffer,sourceFile:string,importedAtUtc=new Date().toISOString(),options:{existingOnly?:boolean}={}){
  const ranges=normalizeAcademyRanges(input,sourceFile,importedAtUtc),hash=ranges[0]!.documentHash,existing=sqlite.prepare('SELECT sha256 FROM academy_documents WHERE sha256=?').get(hash);
  const unparsedOuterCount=ranges.filter(r=>r.notes?.includes('Límites documentales no interpretables')).length;
  if(existing){
    const find=sqlite.prepare('SELECT * FROM academy_ask_ranges WHERE document_hash=? AND source_location=? AND asset=? AND option_right IS ?');
    const update=sqlite.prepare('UPDATE academy_ask_ranges SET outer_min_cents=?, outer_max_cents=? WHERE id=?');
    let updatedCount=0;
    sqlite.transaction(()=>{
      const count=sqlite.prepare('SELECT COUNT(*) AS n FROM academy_ask_ranges WHERE document_hash=?').get(hash) as {n:number};
      if(count.n!==ranges.length)throw new Error('El documento existente no coincide con sus filas normalizadas');
      for(const range of ranges){
        const found=find.all(hash,range.sourceLocation,range.asset,range.optionRight) as Array<{id:string;min_ask_cents:number;max_ask_cents:number;reference_date:string|null;outer_min_cents:number|null;outer_max_cents:number|null}>;
        const row=found[0];
        if(found.length!==1||!row||row.min_ask_cents!==range.minAskCents||row.max_ask_cents!==range.maxAskCents||row.reference_date!==range.referenceDate)throw new Error(`No coincide la fila existente ${range.sourceLocation}`);
        if(range.outerMinCents===null||range.outerMaxCents===null)continue;
        if((row.outer_min_cents!==null&&row.outer_min_cents!==range.outerMinCents)||(row.outer_max_cents!==null&&row.outer_max_cents!==range.outerMaxCents))throw new Error(`Límites existentes incompatibles en ${range.sourceLocation}`);
        if(row.outer_min_cents===null||row.outer_max_cents===null){update.run(range.outerMinCents,range.outerMaxCents,row.id);updatedCount++;}
      }
    })();
    return {alreadyPresent:true,sha256:hash,recordCount:ranges.length,updatedCount,unparsedOuterCount};
  }
  if(options.existingOnly)throw new Error('El SHA-256 no corresponde a un documento ya registrado; no se importó');
  const insertDocument=sqlite.prepare('INSERT INTO academy_documents(sha256,source_file,format,file_name_date,imported_at_utc,record_count,notes) VALUES (?,?,?,?,?,?,?)');
  const insertRange=sqlite.prepare('INSERT INTO academy_ask_ranges(id,asset,option_right,min_ask_cents,max_ask_cents,outer_min_cents,outer_max_cents,currency,unit,reference_date,valid_from,valid_to,document_hash,source_file,source_location,version_id,extraction_method,validation_status,notes,imported_at_utc) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const filenameDate=/(20\d{2})[-_](\d{2})[-_](\d{2})/.exec(sourceFile);sqlite.transaction(()=>{insertDocument.run(hash,sourceFile,extname(sourceFile).slice(1).toUpperCase(),filenameDate?`${filenameDate[1]}-${filenameDate[2]}-${filenameDate[3]}`:null,importedAtUtc,ranges.length,'Original privado no copiado al repositorio');for(const range of ranges)insertRange.run(range.id,range.asset,range.optionRight,range.minAskCents,range.maxAskCents,range.outerMinCents,range.outerMaxCents,range.currency,range.unit,range.referenceDate,range.validFrom,range.validTo,range.documentHash,range.sourceFile,range.sourceLocation,range.versionId,range.extractionMethod,range.validationStatus,range.notes,range.importedAtUtc);})();
  return {alreadyPresent:false,sha256:hash,recordCount:ranges.length,updatedCount:0,unparsedOuterCount};
}
