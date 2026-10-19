import {describe,it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDatabase} from '../../apps/api/src/persistence/db.ts';
import {createApp} from '../../apps/api/src/server.ts';
import {importAcademyDocument,normalizeAcademyRanges,parseOuterBounds} from '../../apps/api/src/academy/importer.ts';
import {academyRanges,evaluateAcademyAskRange,selectAcademyReference} from '../../apps/api/src/academy/service.ts';
import {AcademyAskRange} from '../../packages/contracts/src/index.ts';

const csv=(bounds='MIN $75 MAX $175')=>Buffer.from(`TICKER,RANGO ÓPTIMO,MÍNIMO Y MÁXIMO,FECHA DE ANÁLISIS\nNVDA,$80 - $170,${bounds},2026-02-17\n`);
function zip(entries:Record<string,string>){
  let offset=0;const local:Buffer[]=[],central:Buffer[]=[];
  for(const [name,value] of Object.entries(entries)){const n=Buffer.from(name),data=Buffer.from(value),p=Buffer.alloc(30+n.length+data.length);p.writeUInt32LE(0x04034b50,0);p.writeUInt16LE(20,4);p.writeUInt32LE(data.length,18);p.writeUInt32LE(data.length,22);p.writeUInt16LE(n.length,26);n.copy(p,30);data.copy(p,30+n.length);local.push(p);const c=Buffer.alloc(46+n.length);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);n.copy(c,46);central.push(c);offset+=p.length;}
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(central.length,8);end.writeUInt16LE(central.length,10);end.writeUInt32LE(Buffer.concat(central).length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,...central,end]);
}
function workbook(){return zip({'xl/workbook.xml':'<workbook xmlns:r="r"><sheets><sheet name="Rangos" r:id="rId1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>','xl/sharedStrings.xml':'<sst><si><t>TICKER</t></si><si><t>RANGO ÓPTIMO</t></si><si><t>MÍNIMO Y MÁXIMO</t></si><si><t>FECHA</t></si><si><t>NVDA</t></si><si><t>$80 - $170</t></si><si><t>MIN $75 MAX $175</t></si><si><t>2026-02-17</t></si></sst>','xl/worksheets/sheet1.xml':'<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row><row><c r="A2" t="s"><v>4</v></c><c r="B2" t="s"><v>5</v></c><c r="C2" t="s"><v>6</v></c><c r="D2" t="s"><v>7</v></c></row></sheetData></worksheet>'});}

describe('límites documentales de academia',()=>{
  it.each([['MIN $75 MAX $175',7500,17500],['MIN $55 - $95',5500,9500],['MIN $25MAX $70',2500,7000],['MIN $ 75 MAX 155',7500,15500],['min 1.23 max 2.05',123,205]])('interpreta %s',(s,min,max)=>expect(parseOuterBounds(s)).toEqual([min,max]));
  it.each(['MIN $75','75 - 175','MIN -75 MAX 175','MIN 0 MAX 1','MIN 175 MAX 75','MIN 1.001 MAX 2','MIN 1,000 MAX 2,000','MIN 999999999999999999 MAX 999999999999999999','MIN 75 MAX 175 aprox',''])('no inventa límites: %s',s=>expect(parseOuterBounds(s)).toBeNull());
  it('procesa encabezados normalizados y límites en CSV, HTML y XLSX',()=>{
    const html=Buffer.from('<table><tr><th>TICKER</th><th>RANGO &Oacute;PTIMO</th><th>M&Iacute;NIMO Y M&#193;XIMO</th><th>FECHA</th></tr><tr><td>NVDA</td><td>$80 - $170</td><td>MIN $75 MAX $175</td><td>2026-02-17</td></tr></table>');
    for(const [input,name] of [[csv(),'data.csv'],[html,'data.html'],[workbook(),'data.xlsx']] as const)expect(normalizeAcademyRanges(input,name)[0]).toMatchObject({asset:'NVDA',minAskCents:8000,maxAskCents:17000,outerMinCents:7500,outerMaxCents:17500,referenceDate:'2026-02-17',validFrom:null,validTo:null});
    expect(normalizeAcademyRanges(csv('MIN $75'),'data.csv')[0]).toMatchObject({outerMinCents:null,outerMaxCents:null,notes:'Límites documentales no interpretables'});
  });
  it('migra registros anteriores preservando ID y reimporta de forma idempotente',()=>{
    const dir=mkdtempSync(join(tmpdir(),'bounds-')),path=join(dir,'test.sqlite');
    try{let {sqlite}=openDatabase(path);const first=importAcademyDocument(sqlite,csv(),'sample.csv');const before=sqlite.prepare('SELECT * FROM academy_ask_ranges').get();
      sqlite.exec('ALTER TABLE academy_ask_ranges DROP COLUMN outer_min_cents; ALTER TABLE academy_ask_ranges DROP COLUMN outer_max_cents; DELETE FROM __drizzle_migrations WHERE created_at=1792600000000');sqlite.close();
      ({sqlite}=openDatabase(path));const migrated=sqlite.prepare('SELECT * FROM academy_ask_ranges').get() as Record<string,unknown>;expect(migrated).toEqual({...before as object,outer_min_cents:null,outer_max_cents:null});
      expect(importAcademyDocument(sqlite,csv(),'sample.csv',undefined,{existingOnly:true})).toMatchObject({alreadyPresent:true,updatedCount:1,recordCount:1,sha256:first.sha256});
      expect(importAcademyDocument(sqlite,csv(),'sample.csv',undefined,{existingOnly:true})).toMatchObject({alreadyPresent:true,updatedCount:0});
      expect(sqlite.prepare('SELECT * FROM academy_ask_ranges').all()).toEqual([before]);
      expect(()=>importAcademyDocument(sqlite,csv('MIN $10 MAX $20'),'other.csv',undefined,{existingOnly:true})).toThrow(/SHA-256/);
      expect(sqlite.prepare('SELECT count(*) n FROM academy_documents').get()).toEqual({n:1});sqlite.close();
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
  it('cancela la reimportación si una fila existente contradice el documento',()=>{
    const {sqlite}=openDatabase(':memory:');try{importAcademyDocument(sqlite,csv(),'sample.csv');sqlite.prepare('UPDATE academy_ask_ranges SET outer_min_cents=1').run();expect(()=>importAcademyDocument(sqlite,csv(),'sample.csv')).toThrow(/incompatibles/);expect(sqlite.prepare('SELECT outer_min_cents n FROM academy_ask_ranges').get()).toEqual({n:1});}finally{sqlite.close();}
  });
  it('actualiza 53 filas sintéticas sin duplicarlas y revierte cambios ante una discrepancia tardía',()=>{
    const rows=Array.from({length:53},(_,i)=>`N${String.fromCharCode(65+Math.floor(i/26))}${String.fromCharCode(65+i%26)},$80 - $170,MIN $75 MAX $175,2026-02-17`);
    const input=Buffer.from(`TICKER,RANGO ÓPTIMO,MÍNIMO Y MÁXIMO,FECHA\n${rows.join('\n')}\n`),{sqlite}=openDatabase(':memory:');
    try{importAcademyDocument(sqlite,input,'sample.csv');const ids=sqlite.prepare('SELECT id FROM academy_ask_ranges ORDER BY source_location').all();sqlite.exec('UPDATE academy_ask_ranges SET outer_min_cents=NULL, outer_max_cents=NULL');
      sqlite.prepare("UPDATE academy_ask_ranges SET outer_max_cents=999 WHERE source_location='CSV!54'").run();
      expect(()=>importAcademyDocument(sqlite,input,'sample.csv')).toThrow(/incompatibles/);expect(sqlite.prepare('SELECT count(*) n FROM academy_ask_ranges WHERE outer_min_cents IS NOT NULL').get()).toEqual({n:0});
      sqlite.exec('UPDATE academy_ask_ranges SET outer_max_cents=NULL');expect(importAcademyDocument(sqlite,input,'sample.csv')).toMatchObject({recordCount:53,updatedCount:53});expect(importAcademyDocument(sqlite,input,'sample.csv')).toMatchObject({recordCount:53,updatedCount:0});expect(sqlite.prepare('SELECT id FROM academy_ask_ranges ORDER BY source_location').all()).toEqual(ids);
      const range=academyRanges(sqlite,'NAA')[0]!;const {outerMinCents:_min,outerMaxCents:_max,...oldPayload}=range;expect(AcademyAskRange.safeParse(oldPayload).success).toBe(true);
    }finally{sqlite.close();}
  });
  it('expone ambos intervalos sin cambiar la selección histórica ni la evaluación del ASK',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'bounds-api-'));const {app,database}=await createApp({mode:'PAPER',privateDir:dir,phase17Private:join(dir,'phase17'),phase16Ledger:join(dir,'phase16'),dbPath:join(dir,'db.sqlite')});
    try{importAcademyDocument(database,csv(),'sample.csv');const response=await app.inject('/api/v1/academy/ranges?symbol=NVDA&asOf=2026-10-19');expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({items:[{minAskCents:8000,maxAskCents:17000,outerMinCents:7500,outerMaxCents:17500,validFrom:null,validTo:null}],reference:{status:'HISTORICAL_ONLY'}});
      const range=academyRanges(database,'NVDA')[0]!,reference=selectAcademyReference([range],'2026-02-17');const now=Date.parse('2026-02-17T15:00:00Z');expect(evaluateAcademyAskRange(reference,{ask:77,feedType:'LIVE',receivedAtUtc:new Date(now).toISOString(),marketTimestampUtc:new Date(now).toISOString()},now).status).toBe('BELOW_RANGE');
    }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
  });
});
