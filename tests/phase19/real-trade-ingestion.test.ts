import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDatabase} from '../../apps/api/src/persistence/db.ts';
import {createApp} from '../../apps/api/src/server.ts';
import {RealTradeImporter,realTradeDiagnostic} from '../../apps/api/src/real-trades/service.ts';
import {normalizeExecution,type InputRecord} from '../../apps/api/src/real-trades/normalize.ts';
import {airtableRecords,readImportFile} from '../../apps/api/src/real-trades/sources.ts';

const dirs:string[]=[];afterEach(()=>{for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
function fixture(){const dir=mkdtempSync(join(tmpdir(),'real-trades-'));dirs.push(dir);return {dir,...openDatabase(join(dir,'db.sqlite'))};}
const fields=(patch:Record<string,unknown>={})=>({'ID ejecucion':'EX-1','Fecha y hora':'2026-03-06T23:55:00Z','Activo':'NVDA','Lado':'BUY','Cantidad':1,'Prima USD':2.375,'Importe bruto USD':237.5,'Comision USD':null,'PnL realizado IBKR USD':null,'ID orden IBKR':'ORD-1',...patch});
const record=(patch:Record<string,unknown>={},id='rec12345678901234'):InputRecord=>({id,fields:fields(patch)});

describe('Fase 41V: historial real aislado',()=>{
  it('primera importación, reimportación e identidad incompleta sin inventar conId',async()=>{
    const {sqlite}=fixture(),importer=new RealTradeImporter(sqlite,'AIRTABLE');
    expect(await importer.run([record()])).toMatchObject({inserted:1,status:'SUCCESS_COVERAGE_UNVERIFIED'});
    expect(await importer.run([record()])).toMatchObject({unchanged:1,inserted:0});
    expect(sqlite.prepare('SELECT COUNT(*) n FROM real_trade_versions').get()).toMatchObject({n:1});
    const value=JSON.parse((sqlite.prepare('SELECT normalized FROM real_trade_versions').get() as {normalized:string}).normalized);
    expect(value).toMatchObject({conId:null,quality:'INCOMPLETE_CONTRACT',commission:null,reportedRealizedPnl:null,unitPrice:'2.375'});
    expect(realTradeDiagnostic(sqlite,false)).toMatchObject({executionCount:1,incompleteIdentityCount:1,coverage:'UNVERIFIED'});
    sqlite.close();
  });
  it('fills parciales del mismo contrato siguen separados por ID de ejecución',async()=>{
    const {sqlite}=fixture(),rows=[record({'conId':123,'ID ejecucion':'EX-1','Cantidad':1}),record({'conId':123,'ID ejecucion':'EX-2','Cantidad':2},'rec12345678901235')];
    expect(await new RealTradeImporter(sqlite,'AIRTABLE').run(rows)).toMatchObject({inserted:2});
    expect(sqlite.prepare('SELECT COUNT(*) n FROM real_trade_executions').get()).toMatchObject({n:2});sqlite.close();
  });
  it('conserva una ejecución sin prima como dato incompleto, sin inventar cero',async()=>{
    const {sqlite}=fixture();expect(await new RealTradeImporter(sqlite,'AIRTABLE').run([record({'Prima USD':null,conId:123})])).toMatchObject({inserted:1});
    const value=JSON.parse((sqlite.prepare('SELECT normalized FROM real_trade_versions').get() as {normalized:string}).normalized);
    expect(value).toMatchObject({unitPrice:null,quality:'INCOMPLETE_PRICE'});
    expect(realTradeDiagnostic(sqlite,false)).toMatchObject({pendingReconciliationCount:1});sqlite.close();
  });
  it('corrige comisión como revisión, conserva original y detecta identidad externa contradictoria',async()=>{
    const {sqlite}=fixture(),importer=new RealTradeImporter(sqlite,'AIRTABLE');
    await importer.run([record({'Comision USD':null})]);
    expect(await importer.run([record({'Comision USD':-1.25})])).toMatchObject({revised:1});
    expect(await importer.run([record({'Comision USD':-2},'rec12345678901236')])).toMatchObject({conflicts:1,status:'PARTIAL_COVERAGE_UNVERIFIED'});
    expect(sqlite.prepare('SELECT revision,kind FROM real_trade_versions ORDER BY revision').all()).toMatchObject([{revision:1,kind:'ORIGINAL'},{revision:2,kind:'REVISION'},{revision:3,kind:'CONFLICT'}]);
    expect(sqlite.prepare('SELECT normalized FROM real_trade_versions WHERE id=(SELECT latest_version_id FROM real_trade_executions)').get()).toMatchObject({normalized:expect.stringContaining('"commission":"-1.25"')});sqlite.close();
  });
  it('CSV sin ID de registro no convierte cambios de contenido en revisión confiable',async()=>{
    const {sqlite}=fixture(),importer=new RealTradeImporter(sqlite,'CSV');
    await importer.run([{fields:fields()}]);
    expect(await importer.run([{fields:fields({'Comision USD':-1})}])).toMatchObject({conflicts:1,revised:0});
    sqlite.close();
  });
  it('no mezcla una ejecución Paper existente con el mismo ID',async()=>{
    const {sqlite}=fixture();sqlite.prepare('INSERT INTO broker_executions(id,environment,account_alias,execution_id,con_id,payload) VALUES (?,?,?,?,?,?)').run('paper','PAPER','Primary','EX-1',123,'{}');
    await new RealTradeImporter(sqlite,'CSV').run([record()]);
    expect(sqlite.prepare('SELECT payload FROM broker_executions WHERE id=?').get('paper')).toEqual({payload:'{}'});
    expect(sqlite.prepare('SELECT environment FROM real_trade_executions').get()).toEqual({environment:'REAL'});sqlite.close();
  });
  it('fechas EST/EDT y cruce de medianoche UTC, fecha imposible rechazada',()=>{
    expect(normalizeExecution(record({'Fecha y hora':'2026-01-15T00:05:00Z'})).executedAtNewYork).toBe('2026-01-14T19:05:00-05:00');
    expect(normalizeExecution(record({'Fecha y hora':'2026-07-15T00:05:00Z'})).executedAtNewYork).toBe('2026-07-14T20:05:00-04:00');
    expect(normalizeExecution(record({'Fecha y hora':'2026-11-01T05:30:00Z'})).executedAtNewYork).toBe('2026-11-01T01:30:00-04:00');
    expect(normalizeExecution(record({'Fecha y hora':'2026-11-01T06:30:00Z'})).executedAtNewYork).toBe('2026-11-01T01:30:00-05:00');
    expect(()=>normalizeExecution(record({'Fecha y hora':'2026-02-30T12:00:00Z'}))).toThrow('INVALID_TIMESTAMP');
  });
  it('rechaza filas inválidas y declaraciones Paper sin guardar datos crudos',async()=>{
    const {sqlite}=fixture();const result=await new RealTradeImporter(sqlite,'CSV').run([record({'Lado':'HOLD'}),record({environment:'PAPER'},'rec12345678901235'),record({accountAlias:'DU123456'},'rec12345678901236')]);
    expect(result).toMatchObject({rejected:3,inserted:0,status:'PARTIAL_COVERAGE_UNVERIFIED'});
    expect(sqlite.prepare('SELECT reason FROM real_trade_rejections ORDER BY reason').all()).toEqual([{reason:'INVALID_SIDE'},{reason:'WRONG_ACCOUNT'},{reason:'WRONG_ENVIRONMENT'}]);
    expect(sqlite.prepare('SELECT COUNT(*) n FROM real_trade_executions').get()).toEqual({n:0});sqlite.close();
  });
  it('CSV y JSON usan el mismo normalizador; se rechazan rutas externas y archivos malformados',async()=>{
    const {dir,sqlite}=fixture(),imports=join(dir,'real-trades','imports');mkdirSync(imports,{recursive:true});
    const csv=join(imports,'sample.csv');writeFileSync(csv,'ID ejecucion,Fecha y hora,Activo,Lado,Cantidad,Prima USD\nEX-1,2026-03-06T23:55:00Z,NVDA,BUY,1,2.375\n');
    const json=join(imports,'sample.json');writeFileSync(json,JSON.stringify([{'ID ejecucion':'EX-1','Fecha y hora':'2026-03-06T23:55:00Z','Activo':'NVDA','Lado':'BUY','Cantidad':1,'Prima USD':'2.375'}]));
    const a=readImportFile(csv,dir),b=readImportFile(json,dir);expect(normalizeExecution(a.records[0]!)).toEqual(normalizeExecution(b.records[0]!));
    await new RealTradeImporter(sqlite,'CSV').run(a.records);expect(await new RealTradeImporter(sqlite,'JSON').run(b.records)).toMatchObject({unchanged:1});
    expect(()=>readImportFile(join(dir,'db.sqlite'),dir)).toThrow('FILE_OUTSIDE_PRIVATE_IMPORTS');
    writeFileSync(join(imports,'bad.csv'),'a,b\n"broken');expect(()=>readImportFile(join(imports,'bad.csv'),dir)).toThrow('CSV_INVALID');sqlite.close();
  });
  it('lee importes USD formateados de CSV sin redondear ni calcular importes',()=>{
    const value=normalizeExecution(record({'Cantidad':'1,000','Prima USD':'$2.375','Importe bruto USD':'$1,237.50','Comision USD':'-$1.25'}));
    expect(value).toMatchObject({quantity:'1000',unitPrice:'2.375',grossAmount:'1237.50',commission:'-1.25'});
    expect(()=>normalizeExecution(record({'Prima USD':'$1,23'}))).toThrow('INVALID_DECIMAL');
  });
  it('lote parcial conserva filas previas y permite recuperar tras fallo',async()=>{
    const {sqlite}=fixture(),importer=new RealTradeImporter(sqlite,'AIRTABLE');
    async function* broken(){yield record();throw new Error('NETWORK_ERROR');}
    expect(await importer.run(broken())).toMatchObject({inserted:1,errorCode:'NETWORK_ERROR',status:'PARTIAL_COVERAGE_UNVERIFIED'});
    expect(await importer.run([record(),record({'ID ejecucion':'EX-2'},'rec12345678901235')])).toMatchObject({unchanged:1,inserted:1});sqlite.close();
  });
  it('API local exige token y expone solo diagnósticos aun en DEMO/OFFLINE/PAPER',async()=>{
    for(const mode of ['DEMO','OFFLINE','PAPER'] as const){
      const dir=mkdtempSync(join(tmpdir(),'real-api-'));dirs.push(dir);const {app,token}=await createApp({mode,privateDir:dir,dbPath:join(dir,'db.sqlite')});
      expect((await app.inject('/api/v1/real-trades/diagnostics')).statusCode).toBe(403);
      const response=await app.inject({url:'/api/v1/real-trades/diagnostics',headers:{'x-local-token':token}});
      expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({executionCount:0,coverage:'UNVERIFIED'});await app.close();
    }
  });
});

describe('Airtable REST de solo lectura',()=>{
  const base={token:'fixture-token',baseId:'appRLKun7tUrD1eI2',table:'Ejecuciones IBKR'};
  it('página con offset y registros equivalentes',async()=>{
    const urls:string[]=[];const fake=async(input:URL|RequestInfo)=>{urls.push(String(input));return Response.json(urls.length===1?{records:[{...record(),createdTime:'2026-03-06T23:50:00.000Z'}],offset:'next'}:{records:[record({'ID ejecucion':'EX-2'},'rec12345678901235')]});};
    const records=[];for await(const row of airtableRecords({...base,fetchImpl:fake as typeof fetch}))records.push(row);
    expect(records).toHaveLength(2);expect(urls[1]).toContain('offset=next');
  });
  it('429 espera y reintenta; 403 y timeout entregan códigos acotados',async()=>{
    let calls=0;const waits:number[]=[];
    const fake=async()=>++calls===1?new Response('',{status:429}):Response.json({records:[record()]});
    const rows=[];for await(const row of airtableRecords({...base,fetchImpl:fake as typeof fetch,sleep:async ms=>{waits.push(ms);}}))rows.push(row);
    expect(rows).toHaveLength(1);expect(waits).toEqual([30000]);
    await expect((async()=>{for await(const _ of airtableRecords({...base,fetchImpl:(async()=>new Response('',{status:403})) as typeof fetch})){} })()).rejects.toThrow('PERMISSION_DENIED');
    await expect((async()=>{for await(const _ of airtableRecords({...base,fetchImpl:(async()=>{throw new DOMException('timeout','TimeoutError');}) as typeof fetch,sleep:async()=>{}})){} })()).rejects.toThrow('TIMEOUT');
    await expect((async()=>{for await(const _ of airtableRecords({...base,token:''})){} })()).rejects.toThrow('TOKEN_MISSING');
  });
});
