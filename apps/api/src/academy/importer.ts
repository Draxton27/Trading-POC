import {basename,extname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type Database from 'better-sqlite3';
import {extractXlsxTables} from './xlsx.ts';

export type ImportedRange={id:string;asset:string;optionRight:null|'CALL'|'PUT';minAskCents:number;maxAskCents:number;currency:'USD';unit:'PER_SHARE';referenceDate:string|null;validFrom:null;validTo:null;documentHash:string;sourceFile:string;sourceLocation:string;versionId:string;extractionMethod:'XLSX_TABLE'|'CSV_TABLE'|'HTML_TABLE';validationStatus:'DOCUMENTED'|'UNVERIFIED';notes:string|null;importedAtUtc:string};
type Table={name:string;rows:Array<Record<string,string>>;method:ImportedRange['extractionMethod']};
const normalized=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const money=(value:string)=>{const values=[...value.replace(/,/g,'').matchAll(/\$?\s*(\d+(?:\.\d{1,2})?)/g)].map(x=>x[1]!);if(values.length!==2)return null;const cents=values.map(v=>Math.round(Number(v)*100));return cents.every(Number.isSafeInteger)&&cents[0]!>0&&cents[1]!>0&&cents[0]!<=cents[1]!?[cents[0]!,cents[1]!] as const:null;};
type ParsedDate={value:string|null;note:string|null};
const date=(raw:string):ParsedDate=>{const value=raw.trim();if(!value)return {value:null,note:null};if(/^\d{4}-\d{2}-\d{2}$/.test(value))return Number.isNaN(Date.parse(value+'T00:00:00Z'))?{value:null,note:'Fecha no interpretable'}:{value,note:null};if(/^\d+(?:\.0+)?$/.test(value)){const days=Number(value);if(days<1||days>100000)return {value:null,note:'Fecha no interpretable'};return {value:new Date(Date.UTC(1899,11,30)+Math.round(days)*86400000).toISOString().slice(0,10),note:null};}
  const m=/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value);if(!m)return {value:null,note:'Fecha no interpretable'};if(Number(m[1])<=12&&Number(m[2])<=12)return {value:null,note:'Fecha ambigua'};const output=`${m[3]}-${m[1]!.padStart(2,'0')}-${m[2]!.padStart(2,'0')}`;return Number.isNaN(Date.parse(output+'T00:00:00Z'))?{value:null,note:'Fecha no interpretable'}:{value:output,note:null};};
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
function htmlRows(input:string){return [...input.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(row=>[...row[1]!.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].reduce<Record<string,string>>((out,cell,index)=>{out[String.fromCharCode(65+index)]=cell[1]!.replace(/<br\s*\/?>/gi,' ').replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').trim();return out;},{}));}
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
    const ticker=columns.TICKER??columns.SYMBOL;const range=columns.RANGOOPTIMO??columns.ASKRANGE;const reference=columns.FECHADEANALISIS??columns.FECHA;
    if(!ticker||!range)continue;
    for(let index=1;index<table.rows.length;index++){
      const record=table.rows[index]!,asset=(record[ticker]??'').trim().toUpperCase(),amount=money(record[range]??'');if(!asset&&!amount)continue;
      if(!/^[A-Z.]{1,12}$/.test(asset)||!amount)throw new Error(`Fila inválida en ${safe}:${table.name}:${index+1}`);
      const parsedDate=reference?date(record[reference]??''):{value:null,note:null};
      rows.push({id:randomUUID(),asset,optionRight:null,minAskCents:amount[0],maxAskCents:amount[1],currency:'USD',unit:'PER_SHARE',referenceDate:parsedDate.value,validFrom:null,validTo:null,documentHash:hash,sourceFile:safe,sourceLocation:`${table.name}!${index+1}`,versionId:hash.slice(0,16),extractionMethod:table.method,validationStatus:'DOCUMENTED',notes:parsedDate.note,importedAtUtc});
    }
  }if(!rows.length)throw new Error('No se encontró una tabla con TICKER y RANGO ÓPTIMO/ASK RANGE');return rows;
}
export function importAcademyDocument(sqlite:Database.Database,input:Buffer,sourceFile:string,importedAtUtc=new Date().toISOString()){
  const ranges=normalizeAcademyRanges(input,sourceFile,importedAtUtc),hash=ranges[0]!.documentHash,existing=sqlite.prepare('SELECT sha256 FROM academy_documents WHERE sha256=?').get(hash);
  if(existing)return {alreadyPresent:true,sha256:hash,recordCount:ranges.length};
  const insertDocument=sqlite.prepare('INSERT INTO academy_documents(sha256,source_file,format,file_name_date,imported_at_utc,record_count,notes) VALUES (?,?,?,?,?,?,?)');
  const insertRange=sqlite.prepare('INSERT INTO academy_ask_ranges(id,asset,option_right,min_ask_cents,max_ask_cents,currency,unit,reference_date,valid_from,valid_to,document_hash,source_file,source_location,version_id,extraction_method,validation_status,notes,imported_at_utc) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const filenameDate=/(20\d{2})[-_](\d{2})[-_](\d{2})/.exec(sourceFile);sqlite.transaction(()=>{insertDocument.run(hash,sourceFile,extname(sourceFile).slice(1).toUpperCase(),filenameDate?`${filenameDate[1]}-${filenameDate[2]}-${filenameDate[3]}`:null,importedAtUtc,ranges.length,'Original privado no copiado al repositorio');for(const range of ranges)insertRange.run(range.id,range.asset,range.optionRight,range.minAskCents,range.maxAskCents,range.currency,range.unit,range.referenceDate,range.validFrom,range.validTo,range.documentHash,range.sourceFile,range.sourceLocation,range.versionId,range.extractionMethod,range.validationStatus,range.notes,range.importedAtUtc);})();
  return {alreadyPresent:false,sha256:hash,recordCount:ranges.length};
}
