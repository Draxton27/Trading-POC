import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync,existsSync,utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../../apps/api/src/server.ts';
import {SimulatorStore} from '../../apps/api/src/simulator/store.ts';
import {SimulatorService} from '../../apps/api/src/simulator/service.ts';
import {indicativeOptionMark} from '@trading-poc/market-domain';

const dirs:string[]=[];const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const fn of cleanup.splice(0))await fn();for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
const dir=()=>{const value=mkdtempSync(join(tmpdir(),'sim41m-'));dirs.push(value);return value;};
const contract=(right:'CALL'|'PUT'='CALL')=>({conId:right==='CALL'?101:102,
  occSymbol:`NVDA  990116${right==='CALL'?'C':'P'}00220000`,symbol:'NVDA',right,strike:220,
  expiration:'2099-01-16',multiplier:100,currency:'USD'});
const quote=(conId=101,feedType='LIVE',provider='IBKR')=>({conId,bid:1.8,ask:2,bidSize:10,askSize:10,
  feedType,provider,receivedAtUtc:new Date(Date.now()-1000).toISOString(),
  marketTimestampUtc:new Date(Date.now()-1500).toISOString()});
const open=(conId=101,changes:Record<string,unknown>={})=>{const at=new Date(Date.now()-500).toISOString();
  return {idempotencyKey:randomUUID(),conId,quantity:2,premiumPerShare:2,priceOrigin:'MANUAL_INPUT',
    entryFeeUsd:0,decisionAtUtc:at,simulatedEntryAtUtc:at,plan:{entryReason:'fixture sintética'},
    confirmHypothetical:true,...changes};};
const close=(quantity:number,premiumPerShare:number,changes:Record<string,unknown>={})=>{
  const at=new Date(Date.now()-500).toISOString();return {idempotencyKey:randomUUID(),quantity,premiumPerShare,
    priceOrigin:'MANUAL_INPUT',exitFeeUsd:0,decisionAtUtc:at,simulatedExitAtUtc:at,
    reason:'prueba sintética',confirmHypothetical:true,...changes};};
const fixture=(store=new SimulatorStore(join(dir(),'paper-simulator')),right:'CALL'|'PUT'='CALL')=>{
  let current=quote(contract(right).conId);
  const service=new SimulatorService({store,mode:'PAPER',contract:id=>id===contract(right).conId?contract(right):null,
    quote:()=>current});
  return {store,service,setQuote:(q:ReturnType<typeof quote>)=>{current=q;}};
};

describe('Simulador 41M: contratos, causalidad y economía',()=>{
  it.each(['CALL','PUT'] as const)('abre %s largo, separa precio manual y cobra multiplicador',async right=>{
    const {service}=fixture(undefined,right);const result=await service.open(open(contract(right).conId));
    expect(result.position.contract.right).toBe(right);expect(result.position.grossEntryCostUsd).toBe(400);
    expect(result.position.classification).toBe('DOCUMENTED_ON_TIME');
    expect(result.event.environment).toBe('INTERNAL_SIMULATOR');
    expect(result.event.executionSource).toBe('MANUAL_HYPOTHETICAL');
    if(result.event.kind!=='SIM_POSITION_OPENED')throw new Error('Apertura esperada');
    expect(result.event.payload.lot.quoteReference).toBeNull();
    expect(result.event.payload.lot.fillStatus).toBe('HYPOTHETICAL');
  });
  it('rechaza OCC contradictorio, vencimiento pasado, moneda, cantidad y primas inválidas',async()=>{
    const store=new SimulatorStore(join(dir(),'ledger'));
    const bad=new SimulatorService({store,mode:'PAPER',contract:()=>({...contract(),occSymbol:'NVDA  990116P00220000'}),quote:()=>null});
    await expect(bad.open(open())).rejects.toThrow(/OCC/);
    const expired=new SimulatorService({store,mode:'PAPER',contract:()=>({...contract(),occSymbol:null,expiration:'2020-01-01'}),quote:()=>null});
    await expect(expired.open(open())).rejects.toThrow(/vencido/);
    const currency=new SimulatorService({store,mode:'PAPER',contract:()=>({...contract(),currency:'EUR'}),quote:()=>null});
    await expect(currency.open(open())).rejects.toThrow(/contrato inválida/);
    const valid=fixture(store).service;
    for(const changes of [{quantity:0},{quantity:1.5},{premiumPerShare:0},{premiumPerShare:Infinity}])
      await expect(valid.open(open(101,changes))).rejects.toThrow();
  });
  it('clasifica una entrada documentada tarde como histórica',async()=>{
    const {service}=fixture(),past=new Date(Date.now()-3_600_000).toISOString();
    const result=await service.open(open(101,{decisionAtUtc:past,simulatedEntryAtUtc:past}));
    expect(result.position.classification).toBe('HISTORICAL_SIMULATION');
    expect((await service.performance()).documentedOnTime.closedPositions).toBe(0);
  });
  it('excluye de la cohorte puntual una salida documentada retrospectivamente',async()=>{
    const {service,store}=fixture();const id=(await service.open(open(101,{quantity:1}))).position.positionId;
    await service.close(id,close(1,3));
    const events=await store.read();
    const late={...events[1]!,recordedAtUtc:new Date(Date.parse(events[1]!.recordedAtUtc)+120_000).toISOString()};
    const {replaySimulator,simulatorPerformance}=await import('@trading-poc/market-domain');
    const positions=replaySimulator([events[0]!,late],new Date(Date.parse(late.recordedAtUtc)+1000).toISOString());
    expect(positions[0]?.classification).toBe('HISTORICAL_SIMULATION');
    expect(simulatorPerformance(positions).documentedOnTime.closedPositions).toBe(0);
    expect(simulatorPerformance(positions).historical.closedPositions).toBe(1);
  });
  it('conserva calidad sin inventarla: ASK observado no verificado y precio manual',async()=>{
    const {service,setQuote}=fixture();setQuote(quote(101,'UNKNOWN','otro proveedor'));
    const manual=await service.open(open());
    if(manual.event.kind!=='SIM_POSITION_OPENED')throw new Error('Apertura esperada');
    expect(manual.event.payload.lot.quoteReference).toBeNull();
    const observed=await service.open(open(101,{priceOrigin:'OBSERVED_ASK_REFERENCE',referencePrice:2}));
    if(observed.event.kind!=='SIM_POSITION_OPENED')throw new Error('Apertura esperada');
    expect(observed.event.payload.lot.quoteReference?.quality).toBe('UNKNOWN');
    await expect(service.open(open(101,{priceOrigin:'OBSERVED_ASK_REFERENCE',referencePrice:3,premiumPerShare:3})))
      .rejects.toThrow(/cambió/);
    const after=quote();after.receivedAtUtc=new Date(Date.now()+30_000).toISOString();setQuote(after);
    await expect(service.open(open(101,{priceOrigin:'OBSERVED_ASK_REFERENCE',referencePrice:2})))
      .rejects.toThrow(/después/);
  });
  it('registra salida parcial y final con resultado bruto/neto y sin inventar comisiones',async()=>{
    const {service}=fixture(),id=(await service.open(open(101,{entryFeeUsd:null}))).position.positionId;
    const partial=await service.close(id,close(1,3,{exitFeeUsd:0}));
    expect(partial.position.remainingQuantity).toBe(1);expect(partial.position.status).toBe('PARTIALLY_CLOSED');
    if(partial.event.kind!=='SIM_POSITION_PARTIALLY_CLOSED')throw new Error('Cierre parcial esperado');
    expect(partial.event.payload.fillStatus).toBe('HYPOTHETICAL');
    expect(partial.position.realizedGrossPnlUsd).toBe(100);expect(partial.position.realizedNetPnlUsd).toBeNull();
    const full=await service.close(id,close(1,1,{exitFeeUsd:0}));
    expect(full.position.status).toBe('CLOSED');expect(full.position.realizedGrossPnlUsd).toBe(0);
    expect((await service.performance()).documentedOnTime.flatClosedPositions).toBe(1);
    await expect(service.close(id,close(1,2))).rejects.toThrow(/Cantidad/);
  });
  it('separa ganancia, pérdida y comisiones desconocidas de un cero explícito',async()=>{
    const {service}=fixture();
    const gain=(await service.open(open(101,{quantity:1,entryFeeUsd:0}))).position.positionId;
    const loss=(await service.open(open(101,{quantity:1,entryFeeUsd:0}))).position.positionId;
    const a=await service.close(gain,close(1,3,{exitFeeUsd:0}));
    const b=await service.close(loss,close(1,1,{exitFeeUsd:0}));
    expect(a.position.realizedNetPnlUsd).toBe(100);expect(b.position.realizedNetPnlUsd).toBe(-100);
    const stats=(await service.performance()).documentedOnTime;
    expect(stats.closedPositions).toBe(2);expect(stats.winningClosedPositions).toBe(1);
    expect(stats.losingClosedPositions).toBe(1);expect(stats.winRatePercent).toBe(50);
    expect(stats.realizedGrossPnlUsd).toBe(0);expect(stats.averageGainUsd).toBe(100);
    expect(stats.averageLossUsd).toBe(-100);
  });
  it('conserva una posición vencida sin inventar liquidación ni P&L',async()=>{
    const {service,store}=fixture();await service.open(open());
    const {replaySimulator}=await import('@trading-poc/market-domain');
    const position=replaySimulator(await store.read(),'2100-01-20T12:00:00.000Z')[0]!;
    expect(position.status).toBe('EXPIRED_UNRESOLVED');
    expect(position.remainingQuantity).toBe(2);expect(position.realizedGrossPnlUsd).toBe(0);
  });
  it('rechaza cierres retroactivos y referencias F17 no verificadas',async()=>{
    const {service}=fixture(),id=(await service.open(open())).position.positionId;
    const past=new Date(Date.now()-3_600_000).toISOString();
    await expect(service.close(id,close(1,3,{decisionAtUtc:past,simulatedExitAtUtc:past})))
      .rejects.toThrow(/secuencia causal/);
    await expect(service.plan(id,{idempotencyKey:randomUUID(),plan:{humanDecisionId:'human17:falso'},
      reason:'agregar referencia'})).rejects.toThrow(/no verificable/);
  });
  it('dos salidas simultáneas no cierran más contratos que los abiertos',async()=>{
    const base=join(dir(),'paper-simulator'),a=fixture(new SimulatorStore(base)).service,b=fixture(new SimulatorStore(base)).service;
    const id=(await a.open(open(101,{quantity:1}))).position.positionId;
    const results=await Promise.allSettled([a.close(id,close(1,3)),b.close(id,close(1,1))]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
    expect((await new SimulatorStore(base).read()).filter(e=>e.kind==='SIM_POSITION_CLOSED')).toHaveLength(1);
  });
  it('asigna FIFO y comisiones de entrada proporcionalmente entre lotes',async()=>{
    const {service}=fixture(),id=(await service.open(open(101,{quantity:2,premiumPerShare:2,entryFeeUsd:4}))).position.positionId;
    const {conId:_unused,...secondLot}=open(101,{quantity:2,premiumPerShare:1,entryFeeUsd:2});
    const added=await service.addLot(id,secondLot);
    expect(added.position.initialQuantity).toBe(4);
    const first=await service.close(id,close(3,3,{exitFeeUsd:3}));
    expect(first.position.closedCostBasisUsd).toBe(500);
    expect(first.position.realizedGrossPnlUsd).toBe(400);
    expect(first.position.knownEntryFeesAllocatedUsd).toBe(5);
    expect(first.position.realizedNetPnlUsd).toBe(392);
    const final=await service.close(id,close(1,.5,{exitFeeUsd:0}));
    expect(final.position.status).toBe('CLOSED');expect(final.position.realizedGrossPnlUsd).toBe(350);
    expect(final.position.realizedNetPnlUsd).toBe(341);
  });
  it('rechaza el cálculo monetario fuera de rango seguro',async()=>{
    const store=new SimulatorStore(join(dir(),'ledger'));
    const service=new SimulatorService({store,mode:'PAPER',contract:()=>({...contract(),occSymbol:null,multiplier:100_000}),quote:()=>null});
    await expect(service.open(open(101,{premiumPerShare:1_000_000,quantity:10_000})))
      .rejects.toThrow(/rango seguro/);
  });
  it('valora solo BID LIVE verificable del mismo conId y distingue feed/ausencia',async()=>{
    const {service}=fixture(),p=(await service.open(open())).position;
    expect(indicativeOptionMark(p,quote(),Date.now()).status).toBe('MARK_AVAILABLE');
    expect(indicativeOptionMark(p,null,Date.now()).markValueUsd).toBeNull();
    expect(indicativeOptionMark(p,quote(999),Date.now()).status).toBe('MARK_MISSING');
    expect(indicativeOptionMark(p,{...quote(),bid:0},Date.now()).status).toBe('MARK_MISSING');
    expect(indicativeOptionMark(p,quote(101,'DELAYED'),Date.now()).status).toBe('MARK_STALE');
    expect(indicativeOptionMark(p,quote(101,'FROZEN'),Date.now()).status).toBe('MARK_STALE');
    expect(indicativeOptionMark(p,quote(101,'LIVE','DEMO sintético'),Date.now()).status).toBe('MARK_SIMULATED');
    expect(indicativeOptionMark(p,quote(101,'UNKNOWN'),Date.now()).status).toBe('MARK_UNVERIFIED');
    expect(indicativeOptionMark(p,{...quote(),marketTimestampUtc:new Date(Date.now()+60_000).toISOString()},Date.now()).status).toBe('MARK_UNVERIFIED');
    expect(indicativeOptionMark(p,{...quote(),receivedAtUtc:new Date(Date.now()-60_000).toISOString(),
      marketTimestampUtc:new Date(Date.now()-61_000).toISOString()},Date.now()).status).toBe('MARK_STALE');
  });
});

describe('Ledger privado y API aislada',()=>{
  it('reconstruye tras reinicio, verifica hashes y detecta alteración/truncamiento',async()=>{
    const base=join(dir(),'paper-simulator'),store=new SimulatorStore(base),service=fixture(store).service;
    await service.open(open());expect((await new SimulatorStore(base).read())).toHaveLength(1);
    const path=join(base,'00000001.json'),original=readFileSync(path,'utf8');
    writeFileSync(path,original.replace('fixture sintética','contenido alterado'));
    await expect(store.read()).rejects.toThrow(/hashes/);
    writeFileSync(path,'{"incompleto":');await expect(store.read()).rejects.toThrow(/truncado/);
    writeFileSync(path,original);expect((await store.read())).toHaveLength(1);
  });
  it('recupera un lock de proceso muerto y omite un archivo temporal incompleto',async()=>{
    const base=join(dir(),'paper-simulator'),store=new SimulatorStore(base),service=fixture(store).service;
    await service.open(open());
    writeFileSync(join(base,'.00000002.json.interrupted.partial'),'{');
    writeFileSync(join(base,'.write-lock'),JSON.stringify({pid:99999999,at:'2000-01-01T00:00:00Z'}));
    utimesSync(join(base,'.write-lock'),new Date('2000-01-01'),new Date('2000-01-01'));
    await service.open(open());
    expect((await store.read()).map(e=>e.sequence)).toEqual([1,2]);
  });
  it('misma clave es idempotente, clave contradictoria es conflicto y dos escritores no pierden eventos',async()=>{
    const base=join(dir(),'paper-simulator'),a=fixture(new SimulatorStore(base)).service,b=fixture(new SimulatorStore(base)).service;
    const request=open(),first=await a.open(request),same=await b.open(request);
    expect(same.event.hash).toBe(first.event.hash);
    await expect(a.open({...request,premiumPerShare:3})).rejects.toThrow(/idempotencia/);
    await Promise.all([a.open(open()),b.open(open())]);
    expect((await new SimulatorStore(base).read()).map(e=>e.sequence)).toEqual([1,2,3]);
  });
  it('API DEMO exige token, no toca el ledger PAPER ni los endpoints de IBKR',async()=>{
    const root=dir(),result=await createApp({mode:'DEMO',privateDir:root,dbPath:join(root,'db.sqlite')});
    cleanup.push(async()=>result.app.close());
    const {app,token}=result,headers={'x-local-token':token,origin:'http://127.0.0.1:5173'};
    const row=(await app.inject('/api/v1/options/contracts')).json().items[0];
    const request=open(row.conId,{premiumPerShare:2});
    expect((await app.inject({method:'POST',url:'/api/v1/simulator/positions',payload:request})).statusCode).toBe(403);
    const response=await app.inject({method:'POST',url:'/api/v1/simulator/positions',headers,payload:request});
    expect(response.statusCode).toBe(201);
    expect(response.json().position.classification).toBe('DEMO_SYNTHETIC');
    const id=response.json().position.positionId;
    expect((await app.inject({method:'POST',url:`/api/v1/simulator/positions/${id}/close`,headers,
      payload:close(1,3)})).statusCode).toBe(201);
    expect((await app.inject('/api/v1/simulator/performance')).json().demo.closedPositions).toBe(0);
    expect((await app.inject('/api/v1/simulator/positions')).json().total).toBe(1);
    expect((await app.inject('/api/v1/simulator/positions?offset=1&limit=1')).json().items).toHaveLength(0);
    expect((await app.inject('/api/v1/simulator/positions?limit=0')).statusCode).toBe(400);
    expect((await app.inject({method:'POST',url:'/api/v1/simulator/positions',headers,
      payload:{...open(row.conId),quantity:0}})).statusCode).toBe(400);
    expect((await app.inject({method:'POST',url:'/api/v1/simulator/positions',headers,
      payload:{...open(row.conId),claimedQuoteQuality:'LIVE_RECENT'}})).statusCode).toBe(400);
    expect((await app.inject({method:'POST',url:'/api/v1/simulator/positions',headers,
      payload:{...open(999999)}})).statusCode).toBe(404);
    expect((await app.inject('/api/v1/simulator/ledger/verify')).json().eventCount).toBe(2);
    expect(existsSync(join(root,'paper-simulator'))).toBe(false);
    expect((await app.inject('/api/v1/trades')).json().items).toHaveLength(0);
    expect((await app.inject('/api/v1/executions')).json().items).toHaveLength(0);
  });
  it('API rechaza un ledger PAPER corrupto sin mostrar posiciones vacías ni rutas privadas',async()=>{
    const root=dir(),ledger=join(root,'paper-simulator');mkdirSync(ledger);
    writeFileSync(join(ledger,'00000001.json'),'{');
    const result=await createApp({mode:'PAPER',privateDir:root,dbPath:join(root,'db.sqlite'),agentSecret:'test'});
    cleanup.push(async()=>result.app.close());
    const response=await result.app.inject('/api/v1/simulator/positions');
    expect(response.statusCode).toBe(503);expect(response.json().code).toBe('INVALID_LEDGER');
    expect(response.body).not.toContain(root);
  });
});
