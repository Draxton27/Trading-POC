import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDatabase} from '../../apps/api/src/persistence/db.ts';
import {RealTradeImporter} from '../../apps/api/src/real-trades/service.ts';
import {importFlexFile,parseFlexXml,sha256} from '../../apps/api/src/real-trades/flex.ts';
import {reconcile,reconstruct,rebuildSnapshot} from '../../apps/api/src/real-trades/reconciliation.ts';
import {compareCommission} from '../../apps/api/src/real-trades/commission.ts';
import {createApp} from '../../apps/api/src/server.ts';

const dirs:string[]=[];afterEach(()=>{for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
const trade=(id:string,side='BUY',qty='1',price='1.50',time='20260306;100000',extra='')=>`<Trade accountId="U1234567" ibExecID="${id}" tradeID="T${id}" transactionType="ExchTrade" assetCategory="OPT" symbol="NVDA" underlyingSymbol="NVDA" conid="123" expiry="20260320" strike="180" putCall="C" multiplier="100" currency="USD" buySell="${side}" openCloseIndicator="${side==='BUY'?'O':'C'}" quantity="${side==='SELL'?'-':''}${qty}" tradePrice="${price}" ibCommission="-1" taxes="0" ibCommissionCurrency="USD" dateTime="${time}" levelOfDetail="EXECUTION" ${extra}/>`;
const xml=(...rows:string[])=>`<?xml version="1.0"?><FlexQueryResponse type="AF"><FlexStatements><FlexStatement accountId="U1234567"><Trades>${rows.join('')}</Trades></FlexStatement></FlexStatements></FlexQueryResponse>`;
function fixture(){const dir=mkdtempSync(join(tmpdir(),'phase41w-'));dirs.push(dir);mkdirSync(join(dir,'real-trades','imports'),{recursive:true});return {dir,...openDatabase(join(dir,'data.sqlite'))};}
const record=(id:string,side='BUY',qty=1,price=1.5,time='2026-03-06T15:00:00Z')=>({id:`rec${id.padStart(14,'0')}`,fields:{'ID ejecucion':id,'Fecha y hora':time,'Activo':'NVDA','Lado':side,'Cantidad':qty,'Prima USD':price}});

describe('41W Flex y reconciliación',()=>{
  it('compara convenciones y precisión sin convertir créditos en costos',()=>{
    expect(compareCommission('AIRTABLE','0.35','USD','-0.35000000','USD')).toMatchObject({status:'EXACT',normalizedSourceCashEffect:'-0.35',difference:'0'});
    expect(compareCommission('AIRTABLE','0.35','USD','-0.354','USD')).toMatchObject({status:'POSSIBLE_ROUNDING',difference:'0.004',tolerance:'0.005',assumedDecimalPlaces:2});
    expect(compareCommission('AIRTABLE','0.35','USD','-0.355','USD').status).toBe('POSSIBLE_ROUNDING');
    expect(compareCommission('AIRTABLE','0.35','USD','-0.35500001','USD').status).toBe('MATERIAL_DIFFERENCE');
    expect(compareCommission('AIRTABLE','0.3500','USD','-0.35004','USD')).toMatchObject({status:'POSSIBLE_ROUNDING',tolerance:'0.00005',assumedDecimalPlaces:4});
    expect(compareCommission('AIRTABLE','0.3500','USD','-0.3501','USD').status).toBe('MATERIAL_DIFFERENCE');
    expect(compareCommission('AIRTABLE','-0.35','USD','0.35','USD').status).toBe('EXACT');
    expect(compareCommission('AIRTABLE','-0.35','USD','-0.35','USD').status).toBe('MATERIAL_DIFFERENCE');
    expect(compareCommission('CSV','0.35','USD','-0.35','USD').status).toBe('UNKNOWN_SOURCE_CONVENTION');
    expect(compareCommission('AIRTABLE','0.35','USD','-0.35',null).status).toBe('UNKNOWN_CURRENCY');
    expect(compareCommission('AIRTABLE','0.35','EUR','-0.35','EUR')).toMatchObject({status:'UNKNOWN_CURRENCY',airtableConvention:'NOT_ESTABLISHED'});
    expect(compareCommission('AIRTABLE',null,'USD','-0.35','USD').status).toBe('MISSING');
  });
  it('documenta cuatro fills con convenciones opuestas aun con ejecuciones sin identificar',async()=>{
    const {dir,sqlite}=fixture(),path=join(dir,'real-trades','imports','example.xml');
    const specified=[record('1','BUY',2,1.5,'2026-03-06T15:00:00Z'),record('2','BUY',1,1.7,'2026-03-06T15:15:00Z'),record('3','SELL',1,2,'2026-03-06T15:30:00Z'),record('4','SELL',2,2.3,'2026-03-06T15:45:00Z')]
      .map(r=>({...r,fields:{...r.fields,'Comision USD':0.35}}));
    const other=Array.from({length:45},(_,i)=>record(String(100+i)));
    await new RealTradeImporter(sqlite,'AIRTABLE').run([...specified,...other]);
    const fills=[trade('1','BUY','2','1.50','20260306;100000'),trade('2','BUY','1','1.70','20260306;101500'),trade('3','SELL','1','2.00','20260306;103000'),trade('4','SELL','2','2.30','20260306;104500')]
      .map((s,i)=>s.replace('ibCommission="-1"',`ibCommission="${['-0.35','-0.354','-0.349','-0.35001'][i]}"`));
    writeFileSync(path,xml(...fills));importFlexFile(sqlite,path,dir,'U1234567','America/New_York');
    const before=sqlite.prepare('SELECT normalized FROM real_trade_versions ORDER BY id').all(),result=reconcile(sqlite);
    expect(result.filter(x=>x.status==='DOCUMENTED_CONTRACT')).toHaveLength(4);
    expect(result.filter(x=>x.status==='INCOMPLETE_CONTRACT')).toHaveLength(45);
    expect(result.filter(x=>x.fill).map(x=>x.commissionComparison?.status).sort()).toEqual(['EXACT','POSSIBLE_ROUNDING','POSSIBLE_ROUNDING','POSSIBLE_ROUNDING']);
    const episodes=reconstruct(result);expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({structureStatus:'CANDIDATE_GROUP',status:'INCOMPLETE_HISTORY',economicStatus:'UNKNOWN',grossPnl:null,netPnl:null});
    expect(episodes[0]!.executionIds).toHaveLength(4);
    expect(reconstruct(result,()=>true,()=>true)[0]).toMatchObject({status:'INCOMPLETE_HISTORY',grossPnl:null,netPnl:null});
    expect(sqlite.prepare('SELECT normalized FROM real_trade_versions ORDER BY id').all()).toEqual(before);
    expect(rebuildSnapshot(sqlite)).toMatchObject({executions:49,episodes:1,coverage:'UNVERIFIED'});sqlite.close();
  });
  it('separa una discrepancia material de comisión de una contradicción contractual',async()=>{
    const {dir,sqlite}=fixture(),path=join(dir,'real-trades','imports','example.xml'),base=record('1');
    await new RealTradeImporter(sqlite,'AIRTABLE').run([{...base,fields:{...base.fields,'Comision USD':0.35}}]);
    writeFileSync(path,xml(trade('1').replace('ibCommission="-1"','ibCommission="-0.36"')));importFlexFile(sqlite,path,dir,'U1234567','America/New_York');
    expect(reconcile(sqlite)[0]).toMatchObject({status:'CONFLICTING_CONTRACT',reason:'COMMISSION_MISMATCH',commissionComparison:{status:'MATERIAL_DIFFERENCE',difference:'0.01'}});sqlite.close();
  });
  it.each([
    ['cantidad',(s:string)=>s.replace('quantity="1"','quantity="2"')],
    ['dirección',(s:string)=>s.replace('buySell="BUY"','buySell="SELL"').replace('quantity="1"','quantity="-1"')],
    ['fecha',(s:string)=>s.replace('20260306;100000','20260306;100001')],
    ['precio',(s:string)=>s.replace('tradePrice="1.50"','tradePrice="1.50000001"')],
    ['subyacente',(s:string)=>s.replace('underlyingSymbol="NVDA"','underlyingSymbol="QQQ"')]
  ])('mantiene estricta la comparación de %s',async(_field,modify)=>{
    const {dir,sqlite}=fixture(),path=join(dir,'real-trades','imports','example.xml');
    await new RealTradeImporter(sqlite,'AIRTABLE').run([record('1')]);writeFileSync(path,xml(modify(trade('1'))));importFlexFile(sqlite,path,dir,'U1234567','America/New_York');
    expect(reconcile(sqlite)[0]).toMatchObject({status:'CONFLICTING_CONTRACT',reason:'EXECUTION_OR_CONTRACT_MISMATCH'});sqlite.close();
  });
  it('no documenta un contrato si falta el precio de ejecución necesario para compararlo',async()=>{
    const {dir,sqlite}=fixture(),path=join(dir,'real-trades','imports','example.xml');
    await new RealTradeImporter(sqlite,'AIRTABLE').run([record('1')]);writeFileSync(path,xml(trade('1').replace('tradePrice="1.50"','tradePrice=""')));importFlexFile(sqlite,path,dir,'U1234567','America/New_York');
    expect(reconcile(sqlite)[0]).toMatchObject({status:'INCOMPLETE_CONTRACT',reason:'EXECUTION_PRICE_MISSING'});sqlite.close();
  });
  it('importa XML aislado, conserva hash e impide reimportar contenido idéntico',async()=>{
    const {dir,sqlite}=fixture();const path=join(dir,'real-trades','imports','example.xml');writeFileSync(path,xml(trade('1')));
    await new RealTradeImporter(sqlite,'AIRTABLE').run([record('1')]);
    expect(importFlexFile(sqlite,path,dir,'U1234567','America/New_York')).toMatchObject({records:1,alreadyImported:false});
    expect(importFlexFile(sqlite,path,dir,'U1234567','America/New_York')).toMatchObject({records:1,alreadyImported:true});
    expect(reconcile(sqlite)[0]).toMatchObject({status:'DOCUMENTED_CONTRACT',fill:{conId:123,expiry:'2026-03-20'}});
    expect(reconstruct(reconcile(sqlite))[0]).toMatchObject({status:'INCOMPLETE_HISTORY',grossPnl:null});sqlite.close();
  });
  it('rechaza otros IDs de ejecución, fechas ambiguas y cuentas Paper',()=>{
    expect(()=>parseFlexXml(xml(trade('1')),'DU1234567','America/New_York')).toThrow('REAL_ACCOUNT_REQUIRED');
    expect(()=>parseFlexXml(xml(trade('1','BUY','1','1.5','20261101;013000')),'U1234567','America/New_York')).toThrow('FLEX_AMBIGUOUS_DATETIME');
    expect(()=>parseFlexXml('<!DOCTYPE x><x/>','U1234567','America/New_York')).toThrow('FLEX_INVALID_XML');
  });
  it('usa FIFO exacto sobre inventario inicial conocido y separa comisiones',async()=>{
    const {dir,sqlite}=fixture();const path=join(dir,'real-trades','imports','example.xml');
    const fills=[trade('1','BUY','2','1.50','20260306;100000'),trade('2','BUY','1','1.70','20260306;101500'),trade('3','SELL','1','2.00','20260306;103000'),trade('4','SELL','2','2.30','20260306;104500')];writeFileSync(path,xml(...fills));
    await new RealTradeImporter(sqlite,'AIRTABLE').run([record('1','BUY',2,1.5,'2026-03-06T15:00:00Z'),record('2','BUY',1,1.7,'2026-03-06T15:15:00Z'),record('3','SELL',1,2,'2026-03-06T15:30:00Z'),record('4','SELL',2,2.3,'2026-03-06T15:45:00Z')]);
    importFlexFile(sqlite,path,dir,'U1234567','America/New_York');const episodes=reconstruct(reconcile(sqlite),()=>true,()=>true);
    expect(episodes).toHaveLength(1);expect(episodes[0]).toMatchObject({status:'RECONSTRUCTED',buyQuantity:'3',sellQuantity:'3',grossPnl:'190',commissions:'-4',netPnl:'186'});sqlite.close();
  });
  it('no asocia un ID distinto ni convierte cambios contradictorios en coincidencia',async()=>{
    const {dir,sqlite}=fixture(),path=join(dir,'real-trades','imports','example.xml');
    await new RealTradeImporter(sqlite,'AIRTABLE').run([record('1')]);
    writeFileSync(path,xml(trade('2')));importFlexFile(sqlite,path,dir,'U1234567','America/New_York');
    expect(reconcile(sqlite)[0]).toMatchObject({status:'INCOMPLETE_CONTRACT',reason:'NO_EXACT_EXECUTION_EVIDENCE'});
    writeFileSync(path,xml(trade('1','BUY','1','3.00')));importFlexFile(sqlite,path,dir,'U1234567','America/New_York');
    expect(reconcile(sqlite)[0]).toMatchObject({status:'CONFLICTING_CONTRACT'});
    writeFileSync(path,xml(trade('1')));importFlexFile(sqlite,path,dir,'U1234567','America/New_York');
    expect(reconcile(sqlite)[0]).toMatchObject({status:'AMBIGUOUS_CONTRACT',reason:'MULTIPLE_EVIDENCE_VERSIONS'});sqlite.close();
  });
  it('mantiene una discrepancia material de comisión aunque también difiera la orden',async()=>{
    const {dir,sqlite}=fixture(),path=join(dir,'real-trades','imports','example.xml');
    const base=record('1'),row={...base,fields:{...base.fields,'Comision USD':-2,'ID orden IBKR':'ORDER-A'}};await new RealTradeImporter(sqlite,'AIRTABLE').run([row]);
    writeFileSync(path,xml(trade('1').replace('transactionType="ExchTrade"','transactionType="ExchTrade" ibOrderID="ORDER-B"')));importFlexFile(sqlite,path,dir,'U1234567','America/New_York');
    expect(reconcile(sqlite)[0]).toMatchObject({status:'CONFLICTING_CONTRACT',reason:'COMMISSION_MISMATCH',orderComparison:'DIFFERENT'});
    expect(sqlite.prepare('SELECT count(*) n FROM real_trade_executions').get()).toEqual({n:1});sqlite.close();
  });
  it('señala los IDs de orden distintos sin invalidar el contrato ni autorizar resultados',async()=>{
    const {dir,sqlite}=fixture(),path=join(dir,'real-trades','imports','example.xml'),base=record('1');
    await new RealTradeImporter(sqlite,'AIRTABLE').run([{...base,fields:{...base.fields,'Comision USD':1,'ID orden IBKR':'ORDER-A'}}]);
    writeFileSync(path,xml(trade('1').replace('transactionType="ExchTrade"','transactionType="ExchTrade" ibOrderID="ORDER-B"')));importFlexFile(sqlite,path,dir,'U1234567','America/New_York');
    const items=reconcile(sqlite);expect(items[0]).toMatchObject({status:'DOCUMENTED_CONTRACT',orderComparison:'DIFFERENT',commissionComparison:{status:'EXACT'}});
    expect(reconstruct(items,()=>true,()=>true)[0]).toMatchObject({structureStatus:'CANDIDATE_GROUP',status:'INCOMPLETE_HISTORY',economicStatus:'UNKNOWN',entryDebit:null,grossPnl:null,netPnl:null});sqlite.close();
  });
  it('una venta sin inventario previo nunca produce resultado y una reconstrucción es idempotente',async()=>{
    const {dir,sqlite}=fixture(),path=join(dir,'real-trades','imports','example.xml');
    await new RealTradeImporter(sqlite,'AIRTABLE').run([record('1','SELL',1,2)]);
    writeFileSync(path,xml(trade('1','SELL','1','2')));importFlexFile(sqlite,path,dir,'U1234567','America/New_York');
    expect(reconstruct(reconcile(sqlite),()=>true)[0]).toMatchObject({status:'INCOMPLETE_HISTORY',grossPnl:null,netPnl:null});
    expect(rebuildSnapshot(sqlite)).toMatchObject({inserted:true,coverage:'UNVERIFIED'});
    expect(rebuildSnapshot(sqlite)).toMatchObject({inserted:false,coverage:'UNVERIFIED'});sqlite.close();
  });
  it('ejecuciones sin identidad contractual no se convierten en operaciones individuales',async()=>{
    const {sqlite}=fixture();await new RealTradeImporter(sqlite,'AIRTABLE').run([record('1'),record('2')]);
    expect(reconcile(sqlite)).toHaveLength(2);expect(reconstruct(reconcile(sqlite))).toEqual([]);
    expect(rebuildSnapshot(sqlite)).toMatchObject({executions:2,episodes:0});sqlite.close();
  });
  it('reconoce datos faltantes, apertura corta y fills simultáneos sin calcular PnL',async()=>{
    const {dir,sqlite}=fixture(),path=join(dir,'real-trades','imports','example.xml');
    await new RealTradeImporter(sqlite,'AIRTABLE').run([record('1','BUY',1,1.5),record('2','SELL',1,2,'2026-03-06T15:15:00Z')]);
    writeFileSync(path,xml(trade('1'),trade('2','SELL','1','2','20260306;101500')));importFlexFile(sqlite,path,dir,'U1234567','America/New_York');
    const base=reconcile(sqlite);const first=base.find(x=>x.execution.executionId==='1')!,last=base.find(x=>x.execution.executionId==='2')!;
    const missing={...first,fill:{...first.fill!,commission:null}};
    expect(reconstruct([missing,last],()=>true)[0]).toMatchObject({status:'RECONSTRUCTED',grossPnl:'50',netPnl:null,economicStatus:'GROSS_ONLY'});
    const short={...last,fill:{...last.fill!,openClose:'O' as const}};
    expect(reconstruct([short],()=>true)[0]).toMatchObject({status:'UNSUPPORTED_OPERATION',grossPnl:null});
    const simultaneous={...last,execution:{...last.execution,executedAtUtc:first.execution.executedAtUtc}};
    expect(reconstruct([first,simultaneous],()=>true).every(x=>x.status==='AMBIGUOUS_MATCH'&&x.grossPnl===null)).toBe(true);
    sqlite.close();
  });
  it('un cierre completo seguido de una reapertura crea episodios distintos',async()=>{
    const {dir,sqlite}=fixture(),path=join(dir,'real-trades','imports','example.xml');
    const rows=[record('1'),record('2','SELL',1,2,'2026-03-06T15:15:00Z'),record('3','BUY',1,1.5,'2026-03-06T15:30:00Z')];
    await new RealTradeImporter(sqlite,'AIRTABLE').run(rows);
    writeFileSync(path,xml(trade('1'),trade('2','SELL','1','2','20260306;101500'),trade('3','BUY','1','1.5','20260306;103000')));importFlexFile(sqlite,path,dir,'U1234567','America/New_York');
    const episodes=reconstruct(reconcile(sqlite),()=>true);expect(episodes.map(x=>x.status)).toEqual(['RECONSTRUCTED','PARTIALLY_OPEN']);expect(episodes[1]).toMatchObject({remainingQuantity:'1',grossPnl:null,netPnl:null});sqlite.close();
  });
  it('respeta EST y EDT y rechaza duplicados, XML malformado y zona no declarada',()=>{
    const result=parseFlexXml(xml(trade('1'),trade('2','BUY','1','1.50','20260309;100000')),'U1234567','America/New_York');
    expect(result.map(x=>x.executedAtUtc)).toEqual(['2026-03-06T15:00:00.000Z','2026-03-09T14:00:00.000Z']);
    expect(()=>parseFlexXml(xml(trade('1'),trade('1')),'U1234567','America/New_York')).toThrow('FLEX_DUPLICATE_EXECUTION');
    expect(()=>parseFlexXml('<broken>','U1234567','America/New_York')).toThrow('FLEX_INVALID_XML');
    expect(()=>parseFlexXml(xml(trade('1')),'U1234567','')).toThrow('FLEX_TIMEZONE_REQUIRED');
    expect(()=>parseFlexXml(xml(trade('1')).replace('</FlexStatement>','<OptionEAE><OptionEAE conid="123"/></OptionEAE></FlexStatement>'),'U1234567','America/New_York')).toThrow('FLEX_UNSUPPORTED_EVENTS');
  });
  it('distingue strikes, vencimientos, derechos y multiplicadores sin presumir 100',async()=>{
    const {dir,sqlite}=fixture(),path=join(dir,'real-trades','imports','example.xml');
    const changed=trade('2').replace('conid="123"','conid="124"').replace('strike="180"','strike="181"').replace('putCall="C"','putCall="P"').replace('expiry="20260320"','expiry="20260417"').replace('multiplier="100"','multiplier="10"');
    await new RealTradeImporter(sqlite,'AIRTABLE').run([record('1'),record('2')]);
    writeFileSync(path,xml(trade('1'),changed));importFlexFile(sqlite,path,dir,'U1234567','America/New_York');
    const rows=reconcile(sqlite);expect(rows.map(x=>x.status)).toEqual(['DOCUMENTED_CONTRACT','DOCUMENTED_CONTRACT']);
    expect(new Set(reconstruct(rows,()=>true).map(x=>x.contractKey)).size).toBe(2);
    const adjusted=rows.find(x=>x.fill!.conId===124)!;
    expect(reconstruct([adjusted],()=>true)[0]).toMatchObject({entryDebit:'15',status:'PARTIALLY_OPEN'});sqlite.close();
  });
  it('conid repetido con definiciones incompatibles queda en conflicto',async()=>{
    const {dir,sqlite}=fixture(),path=join(dir,'real-trades','imports','example.xml');
    await new RealTradeImporter(sqlite,'AIRTABLE').run([record('1'),record('2')]);
    writeFileSync(path,xml(trade('1'),trade('2').replace('strike="180"','strike="181"')));importFlexFile(sqlite,path,dir,'U1234567','America/New_York');
    expect(reconcile(sqlite).every(x=>x.status==='CONFLICTING_CONTRACT'&&x.reason==='CONID_MULTIPLE_DEFINITIONS')).toBe(true);sqlite.close();
  });
  it('protege la API con token y lee sin escribir en los tres modos',async()=>{
    for(const mode of ['DEMO','OFFLINE','PAPER'] as const){const dir=mkdtempSync(join(tmpdir(),'phase41w-api-'));dirs.push(dir);const {app,token}=await createApp({mode,privateDir:dir,dbPath:join(dir,'db.sqlite')});
      expect((await app.inject('/api/v1/real-trades/reconciliation')).statusCode).toBe(403);
      const response=await app.inject({url:'/api/v1/real-trades/reconciliation',headers:{'x-local-token':token}});
      expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({status:'NO_RECONSTRUCTION',coverage:'UNVERIFIED'});await app.close();}
  });
  it('expone la proyección paginada y detecta cambios de entrada sin escribir en GET',async()=>{
    const {dir,sqlite}=fixture(),dbPath=join(dir,'data.sqlite'),path=join(dir,'real-trades','imports','example.xml');
    const importer=new RealTradeImporter(sqlite,'AIRTABLE');await importer.run([record('1')]);writeFileSync(path,xml(trade('1')));importFlexFile(sqlite,path,dir,'U1234567','America/New_York');
    rebuildSnapshot(sqlite);const before=sqlite.prepare('SELECT count(*) n FROM real_reconstruction_snapshots').get();
    const {app,token}=await createApp({mode:'OFFLINE',privateDir:dir,dbPath});const headers={'x-local-token':token};
    const page=await app.inject({url:'/api/v1/real-trades/reconciliation?view=executions&limit=1&offset=0',headers});
    expect(page.statusCode).toBe(200);expect(page.json()).toMatchObject({status:'PARTIAL',total:1,items:[{status:'DOCUMENTED_CONTRACT'}]});
    expect(sqlite.prepare('SELECT count(*) n FROM real_reconstruction_snapshots').get()).toEqual(before);
    await importer.run([record('2')]);const stale=await app.inject({url:'/api/v1/real-trades/reconciliation',headers});expect(stale.json()).toMatchObject({status:'STALE'});
    await app.close();sqlite.close();
  });
  it('mantiene legibles las proyecciones previas sin los nuevos campos de comparación',async()=>{
    const {dir,sqlite}=fixture(),dbPath=join(dir,'data.sqlite'),path=join(dir,'real-trades','imports','example.xml');
    await new RealTradeImporter(sqlite,'AIRTABLE').run([record('1')]);writeFileSync(path,xml(trade('1')));importFlexFile(sqlite,path,dir,'U1234567','America/New_York');rebuildSnapshot(sqlite);
    const row=sqlite.prepare('SELECT payload,input_hash FROM real_reconstruction_snapshots').get() as {payload:string;input_hash:string};
    const old=JSON.parse(row.payload);for(const x of old.executions){delete x.commissionComparison;delete x.orderComparison;}for(const x of old.episodes)delete x.structureStatus;
    old.inputHash=sha256(JSON.stringify(old.executions));old.codeHash='0'.repeat(64);
    const payload=JSON.stringify(old),hash=sha256(payload);sqlite.prepare('INSERT INTO real_reconstruction_snapshots(sha256,created_at_utc,algorithm,input_hash,payload) VALUES (?,?,?,?,?)').run(hash,'2026-01-01T00:00:00.000Z','41W-FIFO-1',old.inputHash,payload);
    const {app,token}=await createApp({mode:'OFFLINE',privateDir:dir,dbPath});
    try{const response=await app.inject({url:`/api/v1/real-trades/reconciliation?view=executions&snapshot=${hash}`,headers:{'x-local-token':token}});
      expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({status:'STALE',total:1});
    }finally{await app.close();sqlite.close();}
  });
  it('migra una base anterior preservando registros y tablas de Paper',async()=>{
    const {dir,sqlite}=fixture();await new RealTradeImporter(sqlite,'AIRTABLE').run([record('1')]);
    sqlite.exec("DROP TABLE real_flex_records; DROP TABLE real_flex_documents; DROP TABLE real_reconstruction_snapshots; DELETE FROM __drizzle_migrations WHERE created_at=1793836800000");sqlite.close();
    const reopened=openDatabase(join(dir,'data.sqlite'));expect(reopened.sqlite.prepare('SELECT count(*) n FROM real_trade_executions').get()).toEqual({n:1});
    expect(reopened.sqlite.prepare('SELECT count(*) n FROM broker_executions').get()).toEqual({n:0});
    expect(rebuildSnapshot(reopened.sqlite)).toMatchObject({inserted:true,executions:1,coverage:'UNVERIFIED'});reopened.sqlite.close();
  });
  it('rechaza archivos fuera de imports y conserva ambas versiones de una corrección',async()=>{
    const {dir,sqlite}=fixture(),inside=join(dir,'real-trades','imports','example.xml'),outside=join(dir,'outside.xml');
    writeFileSync(outside,xml(trade('1')));expect(()=>importFlexFile(sqlite,outside,dir,'U1234567','America/New_York')).toThrow('FILE_OUTSIDE_PRIVATE_IMPORTS');
    writeFileSync(inside,xml(trade('1')));importFlexFile(sqlite,inside,dir,'U1234567','America/New_York');
    writeFileSync(inside,xml(trade('1','BUY','1','1.60')));importFlexFile(sqlite,inside,dir,'U1234567','America/New_York');
    expect(sqlite.prepare('SELECT count(*) n FROM real_flex_documents').get()).toEqual({n:2});expect(sqlite.prepare('SELECT count(*) n FROM real_flex_records').get()).toEqual({n:2});sqlite.close();
  });
});
