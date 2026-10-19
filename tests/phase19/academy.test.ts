import {describe,it,expect,afterEach} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {deflateRawSync} from 'node:zlib';
import Database from 'better-sqlite3';
import {createApp} from '../../apps/api/src/server.ts';
import {extractXlsxTables,readZip} from '../../apps/api/src/academy/xlsx.ts';
import {academyTables,importAcademyDocument,normalizeAcademyRanges} from '../../apps/api/src/academy/importer.ts';
import {academyRanges,evaluateAcademyAskRange,selectAcademyReference} from '../../apps/api/src/academy/service.ts';

const csv=(range='$2.00 - $4.00',date='2026-10-19')=>Buffer.from(`TICKER,RANGO ÓPTIMO,FECHA DE ANÁLISIS\nNVDA,${range},${date}\n`);
function zip(entries:Record<string,string>){
  let offset=0;const local:Buffer[]=[],central:Buffer[]=[];
  for(const [name,value] of Object.entries(entries)){const n=Buffer.from(name),data=Buffer.from(value),part=Buffer.alloc(30+n.length+data.length);part.writeUInt32LE(0x04034b50,0);part.writeUInt16LE(20,4);part.writeUInt32LE(data.length,18);part.writeUInt32LE(data.length,22);part.writeUInt16LE(n.length,26);n.copy(part,30);data.copy(part,30+n.length);local.push(part);
    const c=Buffer.alloc(46+n.length);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);n.copy(c,46);central.push(c);offset+=part.length;}
  const body=Buffer.concat([...local,...central]),end=Buffer.alloc(22),size=Buffer.concat(central).length;end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(central.length,8);end.writeUInt16LE(central.length,10);end.writeUInt32LE(size,12);end.writeUInt32LE(offset,16);return Buffer.concat([body,end]);
}
function workbook(){return zip({'xl/workbook.xml':'<workbook xmlns:r="r"><sheets><sheet name="Rangos" r:id="rId1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>','xl/sharedStrings.xml':'<sst><si><t>TICKER</t></si><si><t>RANGO ÓPTIMO</t></si><si><t>FECHA DE ANÁLISIS</t></si><si><t>NVDA</t></si><si><t>$2.00 - $4.00</t></si></sst>','xl/worksheets/sheet1.xml':'<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row><row><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="C2"><v>46314</v></c></row></sheetData></worksheet>'});}
function deflatedZip(name:string,content:Buffer,declaredSize:number){
  const n=Buffer.from(name),compressed=deflateRawSync(content),local=Buffer.alloc(30+n.length+compressed.length),central=Buffer.alloc(46+n.length),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(declaredSize,22);local.writeUInt16LE(n.length,26);n.copy(local,30);compressed.copy(local,30+n.length);
  central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(declaredSize,24);central.writeUInt16LE(n.length,28);n.copy(central,46);
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(local.length,16);return Buffer.concat([local,central,end]);
}
const liveQuote=(ask:number|null,receivedAtUtc='2026-10-19T11:59:40.000Z')=>({ask,receivedAtUtc,marketTimestampUtc:receivedAtUtc,feedType:'LIVE'});
const cleanup:Array<()=>Promise<void>>=[];afterEach(async()=>{for(const fn of cleanup.splice(0))await fn();});
async function fixture(mode:'DEMO'|'PAPER'='PAPER'){const dir=mkdtempSync(join(tmpdir(),'academy-'));const result=await createApp({mode,privateDir:dir,phase17Private:join(dir,'phase17'),phase16Ledger:join(dir,'phase16'),dbPath:join(dir,'db.sqlite')});cleanup.push(async()=>{await result.app.close();rmSync(dir,{recursive:true,force:true});});return {...result,dir};}

describe('documentos de rangos de academia',()=>{
  it('importa CSV de forma idempotente sin guardar el original',()=>{const db=new Database(':memory:');db.exec('CREATE TABLE academy_documents (sha256 text primary key, source_file text, format text, file_name_date text, imported_at_utc text, record_count integer, notes text); CREATE TABLE academy_ask_ranges (id text primary key, asset text, option_right text, min_ask_cents integer, max_ask_cents integer, outer_min_cents integer, outer_max_cents integer, currency text, unit text, reference_date text, valid_from text, valid_to text, document_hash text, source_file text, source_location text, version_id text, extraction_method text, validation_status text, notes text, imported_at_utc text);');
    const first=importAcademyDocument(db,csv(),'ranges_2026-10-19.csv','2026-10-20T00:00:00.000Z'),again=importAcademyDocument(db,csv(),'ranges_2026-10-19.csv','2026-10-20T00:00:00.000Z');
    expect(first).toMatchObject({alreadyPresent:false,recordCount:1});expect(again).toMatchObject({alreadyPresent:true});expect(db.prepare('SELECT count(*) n FROM academy_ask_ranges').get()).toMatchObject({n:1});
  });
  it('soporta XLSX y conserva centavos y fecha Excel',()=>{const tables=extractXlsxTables(workbook());expect(tables[0]?.rows[1]).toMatchObject({A:'NVDA',B:'$2.00 - $4.00',C:'46314'});const range=normalizeAcademyRanges(workbook(),'ranges.xlsx','2026-10-20T00:00:00.000Z')[0]!;expect(range).toMatchObject({minAskCents:200,maxAskCents:400,referenceDate:'2026-10-19',extractionMethod:'XLSX_TABLE'});});
  it('soporta CSV con comillas, HTML de hoja y más de un activo',()=>{
    const quoted=Buffer.from('TICKER,ASK RANGE,FECHA\nNVDA,"$2.00 - $4.00",2026-10-19\nQQQ,"$1.25 - $3.50",2026-10-19\n');
    expect(normalizeAcademyRanges(quoted,'ranges.csv').map(row=>row.asset)).toEqual(['NVDA','QQQ']);
    const html=Buffer.from('<table><tr><th>TICKER</th><th>ASK RANGE</th></tr><tr><td>NVDA</td><td>$2.00 - $4.00</td></tr></table>');
    expect(academyTables(html,'ranges.html')[0]?.method).toBe('HTML_TABLE');
    expect(normalizeAcademyRanges(html,'ranges.html')[0]).toMatchObject({asset:'NVDA',minAskCents:200,maxAskCents:400});
  });
  it('rechaza XLSX con rutas inseguras y CSV mal formado',()=>{
    expect(()=>extractXlsxTables(zip({'../outside.xml':'<x/>'}))).toThrow(/no permitida/);
    expect(()=>normalizeAcademyRanges(Buffer.from('TICKER,ASK RANGE\nNVDA,"$2.00 - $4.00'),'ranges.csv')).toThrow(/comillas/);
  });
  it('limita el contenido descomprimido aunque el ZIP declare un tamaño falso',()=>{
    const oversized=deflatedZip('xl/sharedStrings.xml',Buffer.alloc(5*1024*1024+1),1);
    expect(()=>readZip(oversized)).toThrow(/límite de descompresión/);
    const inconsistent=deflatedZip('xl/sharedStrings.xml',Buffer.from('contenido real'),1);
    expect(()=>readZip(inconsistent)).toThrow(/Tamaño XLSX inconsistente/);
  });
  it('rechaza rangos inválidos y conserva fecha ambigua como incertidumbre',()=>{expect(()=>normalizeAcademyRanges(csv('$4.00 - $2.00'),'ranges.csv')).toThrow(/Fila inválida/);expect(normalizeAcademyRanges(csv('$2.00 - $4.00','sin fecha'),'ranges.csv')[0]?.notes).toMatch(/Fecha/);});
  it('no convierte una versión anterior sin vigencia en referencia actual',()=>{const a=normalizeAcademyRanges(csv('$2.00 - $4.00','2026-01-01'),'a.csv')[0]!,b={...a,id:'other',minAskCents:250,maxAskCents:450,documentHash:'b'.repeat(64),versionId:'b'.repeat(16)};expect(selectAcademyReference([a,b],'2026-01-01')).toMatchObject({status:'CONFLICT'});expect(selectAcademyReference([a],'2026-10-19')).toMatchObject({status:'HISTORICAL_ONLY'});expect(selectAcademyReference([a],'2026-01-01')).toMatchObject({status:'REFERENCE_DATE'});});
  it('deduplica referencias equivalentes y conserva conflicto para rangos distintos',()=>{
    const original=normalizeAcademyRanges(csv(),'a.csv')[0]!;
    const duplicate={...original,id:'duplicate',documentHash:'e'.repeat(64),versionId:'e'.repeat(16),sourceFile:'b.csv'};
    const different={...original,id:'different',documentHash:'f'.repeat(64),versionId:'f'.repeat(16),sourceFile:'c.csv',minAskCents:250};
    expect(selectAcademyReference([original,duplicate],'2026-10-19')).toMatchObject({status:'REFERENCE_DATE',range:{id:original.id}});
    expect(selectAcademyReference([original,different],'2026-10-19')).toMatchObject({status:'CONFLICT'});
  });
  it('no adivina fechas ambiguas o ausentes',()=>{
    const ambiguous=normalizeAcademyRanges(csv('$2.00 - $4.00','01/02/2026'),'ranges.csv')[0]!;
    const absent=normalizeAcademyRanges(Buffer.from('TICKER,ASK RANGE,FECHA\nNVDA,$2.00 - $4.00,\n'),'ranges.csv')[0]!;
    expect(ambiguous).toMatchObject({referenceDate:null,notes:'Fecha ambigua'});
    expect(absent).toMatchObject({referenceDate:null,notes:null});
  });
  it('acepta DD/MM y MM/DD no ambiguos, y rechaza días imposibles',()=>{
    expect(normalizeAcademyRanges(csv('$2.00 - $4.00','31/01/2026'),'ranges.csv')[0]?.referenceDate).toBe('2026-01-31');
    expect(normalizeAcademyRanges(csv('$2.00 - $4.00','01/31/2026'),'ranges.csv')[0]?.referenceDate).toBe('2026-01-31');
    expect(()=>normalizeAcademyRanges(csv('$2.00 - $4.00','2026-02-30'),'ranges.csv')).toThrow(/Fecha inválida/);
  });
  it('mantiene conflictos de la última versión anterior y prefiere un lado documentado',()=>{
    const generic=normalizeAcademyRanges(csv(),'generic.csv')[0]!;
    const conflict={...generic,id:'conflict',documentHash:'c'.repeat(64),versionId:'c'.repeat(16),minAskCents:250};
    const call={...generic,id:'call',optionRight:'CALL' as const,documentHash:'d'.repeat(64),versionId:'d'.repeat(16),minAskCents:250,maxAskCents:450};
    expect(selectAcademyReference([generic,conflict],'2026-10-20')).toMatchObject({status:'CONFLICT'});
    expect(selectAcademyReference([generic,call],'2026-10-19','CALL')).toMatchObject({status:'REFERENCE_DATE',range:{optionRight:'CALL'}});
  });
  it('evalúa ASK sin usar último precio y conserva permisos/obsolescencia',()=>{const range=normalizeAcademyRanges(csv(),'a.csv')[0]!,reference=selectAcademyReference([range],'2026-10-19');const now=Date.parse('2026-10-19T12:00:00.000Z');
    expect(evaluateAcademyAskRange(reference,liveQuote(3),now)).toMatchObject({status:'WITHIN_RANGE',distancePercent:25});
    expect(evaluateAcademyAskRange(reference,liveQuote(2),now).status).toBe('WITHIN_RANGE');
    expect(evaluateAcademyAskRange(reference,{...liveQuote(null),last:3},now).status).toBe('NO_ASK');
    expect(evaluateAcademyAskRange(reference,liveQuote(3,'2026-10-19T11:59:00.000Z'),now).status).toBe('STALE_QUOTE');
    expect(evaluateAcademyAskRange(reference,{...liveQuote(3),marketDataStatus:'permission_denied'},now).status).toBe('INSUFFICIENT_DATA');
  });
  it('distingue ambos lados, decimales, ASK inválido y contrato incompatible',()=>{const range=normalizeAcademyRanges(csv(),'a.csv')[0]!,reference=selectAcademyReference([range],'2026-10-19'),now=Date.parse('2026-10-19T12:00:00.000Z'),fresh=liveQuote(null);
    expect(evaluateAcademyAskRange(reference,{...fresh,ask:1.99},now).status).toBe('BELOW_RANGE');
    expect(evaluateAcademyAskRange(reference,{...fresh,ask:4.01},now).status).toBe('ABOVE_RANGE');
    expect(evaluateAcademyAskRange(reference,{...fresh,ask:0},now).status).toBe('NO_ASK');
    expect(evaluateAcademyAskRange(reference,{...fresh,ask:3,receivedAtUtc:'fecha'},now).status).toBe('STALE_QUOTE');
    expect(evaluateAcademyAskRange(reference,{...fresh,ask:3},now,'EUR',100).status).toBe('INSUFFICIENT_DATA');
    expect(evaluateAcademyAskRange(reference,{...fresh,ask:3},now,'USD',50).status).toBe('INSUFFICIENT_DATA');
    expect(evaluateAcademyAskRange({status:'NONE',range:null,reason:'faltante'},{...fresh,ask:3},now).status).toBe('NO_REFERENCE');
  });
  it('no evalúa feeds retrasados, congelados, desconocidos o simulados',()=>{const range=normalizeAcademyRanges(csv(),'a.csv')[0]!,reference=selectAcademyReference([range],'2026-10-19'),now=Date.parse('2026-10-19T12:00:00.000Z');
    for(const feedType of ['DELAYED','FROZEN','DELAYED_FROZEN','UNKNOWN'])expect(evaluateAcademyAskRange(reference,{...liveQuote(3),feedType},now)).toMatchObject({status:'INSUFFICIENT_DATA',reference:range});
    expect(evaluateAcademyAskRange(reference,{...liveQuote(3),provider:'PAPER SIMULADO'},now)).toMatchObject({status:'INSUFFICIENT_DATA',reference:range});
    expect(evaluateAcademyAskRange(reference,{...liveQuote(3),marketTimestampUtc:'2026-10-19T11:58:00.000Z'},now).status).toBe('STALE_QUOTE');
    expect(evaluateAcademyAskRange(reference,{...liveQuote(3),marketTimestampUtc:null},now).status).toBe('STALE_QUOTE');
  });
  it('no permite que una fecha imposible cause un 500 en la API',async()=>{const {app,database}=await fixture();
    expect(()=>importAcademyDocument(database,csv('$2.00 - $4.00','2026-02-30'),'invalid.csv')).toThrow(/Fecha inválida/);
    const response=await app.inject('/api/v1/academy/ranges?symbol=NVDA&asOf=2026-10-19');expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({items:[],reference:{status:'NONE'}});
    const invalidQuery=await app.inject('/api/v1/academy/ranges?symbol=NVDA&asOf=2026-02-30');expect(invalidQuery.statusCode).toBe(400);
  });
  it('expone historial y referencia por API sin exponer el documento',async()=>{const {app,database}=await fixture();importAcademyDocument(database,csv(),'ranges_2026-10-19.csv');
    const response=await app.inject('/api/v1/academy/ranges?symbol=NVDA&asOf=2026-10-19');expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({items:[{asset:'NVDA',minAskCents:200,maxAskCents:400,sourceFile:'ranges_2026-10-19.csv'}],reference:{status:'REFERENCE_DATE'}});
    expect(JSON.stringify(response.json())).not.toContain('TICKER,RANGO');
  });
  it('identifica los contratos DEMO como sintéticos y conserva endpoints sin referencias',async()=>{const {app}=await fixture('DEMO');
    const contracts=await app.inject('/api/v1/options/contracts');const summary=await app.inject('/api/v1/academy/summary');
    expect(contracts.statusCode).toBe(200);expect(contracts.json().items[0].academyEvaluation).toMatchObject({status:'INSUFFICIENT_DATA',referenceStatus:'NONE'});
    expect(summary.json()).toMatchObject({documentCount:0,recordCount:0});
  });
});
