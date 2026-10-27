import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../../apps/api/src/server.ts';
import {createOpportunityBrokerWorker,opportunityContractAnalysis} from '../../apps/api/src/radar/opportunity-broker.ts';
import {OpportunityStore,opportunityHash} from '../../trading_poc_001_bollinger/src/phase41o-ledger.ts';
import {InvestepScenario,OpportunityDetected} from '@trading-poc/contracts';
import Fastify from 'fastify';
import {registerOptionRoutes} from '../../apps/api/src/options/routes.ts';
import type {AgentHub} from '../../apps/api/src/streams/agent-hub.ts';

const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const fn of cleanup.splice(0).reverse())await fn();});
async function fixture(mode:'DEMO'|'PAPER'='DEMO'){
  const dir=mkdtempSync(join(tmpdir(),'phase41o-api-'));
  const result=await createApp({mode,privateDir:dir,phase17Private:join(dir,'phase17'),phase16Ledger:join(dir,'phase16'),
    dbPath:join(dir,'db.sqlite'),iexProspectivePaths:{protocolDir:join(dir,'protocol'),modelDir:undefined,
      observationLog:join(dir,'observations.jsonl'),iexLog:join(dir,'iex.jsonl'),calendar:join(dir,'calendar.json'),
      reportDir:join(dir,'reports')}});
  cleanup.push(async()=>{await result.app.close();rmSync(dir,{recursive:true,force:true});});
  return {...result,dir};
}
const candidate={candidateId:'a'.repeat(64),directionHypothesis:'CALL' as const,observedUnderlyingPrice:100,
  status:'TECHNICAL_CANDIDATE'};
const contract={conId:12345,symbol:'NVDA',occSymbol:null,right:'CALL',strike:100,expiration:'20261120',multiplier:100,currency:'USD'};
const at='2026-10-26T15:00:10.000Z',received='2026-10-26T15:00:05.000Z',market='2026-10-26T15:00:04.000Z';
const sourceHash='b'.repeat(64);
function detected(index:number){
  const time=`2026-10-26T14:${String(index).padStart(2,'0')}:00.000Z`;
  const trigger={kind:'RETEST',description:'Retesteo sintético pendiente',barStartUtc:'2026-10-26T13:30:00.000Z',
    observedAtUtc:'2026-10-26T13:45:00.000Z',availableAtUtc:'2026-10-26T13:45:00.000Z'};
  const scenario=InvestepScenario.parse({id:opportunityHash(['scenario',index]),symbol:'NVDA',family:'SMA_BREAK_RETEST',
    timeframe:'15m',direction:'ABOVE',state:'AWAITING_CONFIRMATION',scope:'CURRENT',period:20,breakAtUtc:null,
    barsSinceBreak:null,eventAtUtc:trigger.observedAtUtc,availableAtUtc:trigger.availableAtUtc,asOfUtc:time,
    source:{name:'fixture',provider:'fixture',feed:'iex',adjustment:'raw',dataStatus:'HISTORICAL',receiptVerified:true},
    feed:'iex',adjustment:'raw',dataStatus:'HISTORICAL',trigger,context:null,confirmations:[],contradictions:[],
    limitations:[],relatedLevels:[],bollingerVolume:null});
  return OpportunityDetected.parse({candidateId:opportunityHash(['candidate',index]),ruleVersion:'41O_V1',
    detectedAtUtc:time,technicalEvidenceAvailableAtUtc:trigger.availableAtUtc,marketSource:'Alpaca Market Data API',
    marketFeed:'IEX Live',adjustment:'raw',symbol:'NVDA',barStartUtc:trigger.barStartUtc,
    barEndUtc:trigger.observedAtUtc,sourceBarHash:sourceHash,sourceWindowHash:sourceHash,calendarHash:sourceHash,
    sourceHashes:[sourceHash],sourceHashCount:1,warmup:'LIVE_ONLY',warmupCsvSha256:null,warmupRegisteredAtUtc:null,
    observedUnderlyingPrice:100,directionHypothesis:'CALL',scenario,
    status:'AWAITING_CONFIRMATION',exclusionReasons:['Fixture sintética.'],outcomeScheduledEndUtc:null});
}

describe('41O: consultas y calidad de contratos',()=>{
  it('GET DEMO nunca genera candidatos reales ni suscripciones y valida paginación/rutas',async()=>{
    const {app,dir}=await fixture();
    const status=await app.inject({method:'GET',url:'/api/v1/radar/opportunities/status'});
    expect(status.statusCode).toBe(200);expect(status.json().status).toBe('DEMO');
    const current=await app.inject({method:'GET',url:'/api/v1/radar/opportunities/current'});
    expect(current.json()).toMatchObject({status:'DEMO',total:0,items:[]});
    expect((await app.inject({method:'GET',url:'/api/v1/radar/opportunities/history?limit=101'})).statusCode).toBe(400);
    expect((await app.inject({method:'GET',url:'/api/v1/radar/opportunities/history?file=private'})).statusCode).toBe(400);
    expect((await app.inject({method:'GET',url:'/api/v1/radar/opportunities/../secret'})).statusCode).not.toBe(200);
    expect((await app.inject({method:'GET',url:'/api/v1/radar/opportunities/ledger/verify'})).json()).toMatchObject({status:'DEMO',records:0});
    expect((await app.inject({method:'GET',url:'/api/v1/radar/opportunities/'+candidate.candidateId})).statusCode).toBe(404);
  });
  it('sin contrato, BID cero, ASK ausente y libro cruzado no ascienden a candidato verificable',async()=>{
    const {database}=await fixture();
    const analyse=(raw:Record<string,unknown>|null)=>opportunityContractAnalysis(candidate,contract,raw,null,database,at,false);
    expect(analyse(null).status).toBe('CONTRACT_QUOTE_UNVERIFIED');
    expect(analyse({bid:0,ask:1,feedType:'LIVE',provider:'IBKR',receivedAtUtc:received,marketTimestampUtc:market}).analysis.quote.bidAskStatus).toBe('BID_ZERO');
    expect(analyse({bid:1,ask:null,feedType:'LIVE',provider:'IBKR',receivedAtUtc:received,marketTimestampUtc:market}).analysis.quote.bidAskStatus).toBe('ASK_MISSING');
    expect(analyse({bid:2,ask:1,feedType:'LIVE',provider:'IBKR',receivedAtUtc:received,marketTimestampUtc:market}).analysis.quote.status).toBe('INVALID');
  });
  it('procedencia, hora de mercado y permisos determinan elegibilidad sin confiar en recepción local',async()=>{
    const {database}=await fixture();
    const analyse=(overrides:Record<string,unknown>,simulation=false)=>opportunityContractAnalysis(candidate,contract,
      {bid:1,ask:1.2,bidSize:10,askSize:12,feedType:'LIVE',receivedAtUtc:received,marketTimestampUtc:market,...overrides},
      null,database,at,simulation);
    expect(analyse({provider:'IBKR'}).status).toBe('REVIEWABLE_PAPER_CANDIDATE');
    expect(analyse({provider:'UNKNOWN'}).analysis.quote.status).toBe('LIVE_UNVERIFIED');
    expect(analyse({provider:'IBKR',marketTimestampUtc:null}).analysis.quote.status).toBe('LIVE_UNVERIFIED');
    expect(analyse({provider:'IBKR',marketTimestampUtc:'2026-10-26T15:00:06.000Z'}).analysis.quote.status).toBe('INVALID');
    expect(analyse({provider:'IBKR',feedType:'DELAYED'}).analysis.quote.status).toBe('DELAYED');
    expect(analyse({provider:'IBKR',marketDataStatus:'permission_denied'}).analysis.quote.status).toBe('PERMISSION_DENIED');
    expect(analyse({provider:'IBKR'},true).analysis.quote.status).toBe('SIMULATED');
    expect(analyse({provider:'IBKR',receivedAtUtc:'2026-10-26T14:59:00.000Z'}).analysis.quote.status).toBe('INVALID');
  });
  it('vencimiento no válido bloquea el contrato aunque exista cotización',async()=>{
    const {database}=await fixture();
    const result=opportunityContractAnalysis(candidate,{...contract,expiration:'20260230'},
      {bid:1,ask:1.2,feedType:'LIVE',provider:'IBKR',receivedAtUtc:received,marketTimestampUtc:market},
      null,database,at,false);
    expect(result.status).toBe('CONTRACT_CONSTRAINT_FAILED');
  });
  it('proyección PAPER pagina y verifica ledger sin consultar IBKR ni mutar GET',async()=>{
    const {app,dir,database}=await fixture('PAPER'),path=join(dir,'radar','opportunities.jsonl'),store=new OpportunityStore(path);
    for(let i=0;i<3;i++)await store.append('DETECTED',i===0?{...detected(i),status:'TECHNICAL_CANDIDATE'}:detected(i),
      ()=>`2026-10-26T14:${String(i).padStart(2,'0')}:01.000Z`);
    const snapshot=opportunityContractAnalysis({...candidate,candidateId:detected(0).candidateId},contract,
      {bid:1,ask:1.2,bidSize:10,askSize:12,feedType:'LIVE',provider:'IBKR',receivedAtUtc:received,
        marketTimestampUtc:market},null,database,at,false);
    expect(snapshot.status).toBe('REVIEWABLE_PAPER_CANDIDATE');
    await store.append('CONTRACT_OBSERVED',snapshot,()=>at);
    const before=readFileSync(path,'utf8');
    const page=await app.inject({method:'GET',url:'/api/v1/radar/opportunities/history?limit=2&offset=0&capitalUsd=1000'});
    expect(page.statusCode).toBe(200);
    expect(page.json()).toMatchObject({total:3,nextOffset:2,status:'AVAILABLE'});
    expect(page.json().items).toHaveLength(2);
    const id=detected(1).candidateId;
    expect((await app.inject({method:'GET',url:`/api/v1/radar/opportunities/${id}`})).json().item.candidate.candidateId).toBe(id);
    const aged=(await app.inject({method:'GET',url:`/api/v1/radar/opportunities/${detected(0).candidateId}`})).json().item;
    expect(aged.contracts[0].status).toBe('REVIEWABLE_PAPER_CANDIDATE');
    expect(aged.currentStatus).toBe('CONTRACT_QUOTE_UNVERIFIED');
    expect((await app.inject({method:'GET',url:'/api/v1/radar/opportunities/ledger/verify'})).json()).toMatchObject({records:4,candidateCount:3});
    expect(readFileSync(path,'utf8')).toBe(before);
    writeFileSync(path,before.replace('AWAITING_CONFIRMATION','REVIEWABLE_PAPER_CANDIDATE'));
    const invalid=await app.inject({method:'GET',url:'/api/v1/radar/opportunities/history'});
    expect(invalid.statusCode).toBe(503);expect(invalid.json().status).toBe('INVALID_SOURCE');
    expect(JSON.stringify(invalid.json())).not.toContain(dir);
  });
  it('inspección automática tiene límite, backoff y no usa el broker desconectado',async()=>{
    const {database}=await fixture('PAPER'),store=new OpportunityStore(null);
    const item={...detected(0),status:'TECHNICAL_CANDIDATE' as const};
    await store.append('DETECTED',item,()=> '2026-10-26T14:00:01.000Z');
    let now=Date.parse('2026-10-26T14:00:10.000Z'),connected=false,calls=0;
    const inspect=async(_right:'CALL'|'PUT',_price:number,count:number)=>{
      calls++;expect(count).toBe(4);return {items:[],errors:[{code:'PACING'}]};
    };
    const worker=createOpportunityBrokerWorker({store,inspect,sqlite:database,connected:()=>connected,
      simulation:()=>false,clock:()=>now,maxContracts:4});
    await worker();expect(calls).toBe(0);
    connected=true;await worker();await worker();expect(calls).toBe(1);
    now+=60_000;await worker();now+=60_000;await worker();now+=60_000;await worker();
    expect(calls).toBe(3);expect((await store.read()).filter(row=>row.kind==='CONTRACT_OBSERVED')).toHaveLength(0);
    expect((await store.read()).filter(row=>row.kind==='CONTRACT_ATTEMPT')).toHaveLength(6);
  });
  it('Radar y cadena aceptan idéntica definición IBKR normalizada y Radar libera sus suscripciones',async()=>{
    const {database}=await fixture('DEMO'),app=Fastify();
    cleanup.push(async()=>app.close());
    const requests:string[]=[],subscriptions:number[]=[],releases:string[]=[];
    const hub={status:()=>({connected:true,simulation:false,connectionId:'test'}),optionPageTimeoutMs:()=>10_000,
      request:async(kind:string,payload:Record<string,unknown>)=>{
        requests.push(kind);
        if(kind==='option.parameters')return {payload:{items:[{exchange:'SMART',tradingClass:'NVDA',multiplier:100,
          expirations:['20271119'],strikes:[90,100,110]}]}};
        return {requestId:'test',payload:{contract:{conId:10000+Number(payload.strike),symbol:'NVDA',secType:'OPT',
          tradingClass:'NVDA',localSymbol:null,right:payload.right==='PUT'?'P':'C',strike:String(payload.strike),
          expiration:`${payload.expiration} 16:00:00`,multiplier:'100',currency:'USD'}}};
      },subscribe:async(value:{conId:number})=>{subscriptions.push(value.conId);},
      release:async(key:string)=>{releases.push(key);},latestQuote:()=>null} as unknown as AgentHub;
    const routes=registerOptionRoutes(app,hub,'PAPER',()=>[],database);
    const result=await routes.inspectOpportunity('CALL',102,2,'8e54c6e3-b6c7-4217-b026-0de8ff8b9fe5');
    expect(result.items).toHaveLength(2);expect(result.items.every(row=>row.quote===null)).toBe(true);
    expect(result.items.map(row=>row.contract)).toEqual(expect.arrayContaining([
      expect.objectContaining({right:'CALL',expiration:'20271119',strike:100,multiplier:100}),
      expect.objectContaining({right:'CALL',expiration:'20271119',strike:110,multiplier:100})]));
    expect(requests.filter(kind=>kind==='option.parameters')).toHaveLength(1);
    expect(requests.filter(kind=>kind==='option.resolve')).toHaveLength(2);
    expect(requests.some(kind=>kind.startsWith('broker.'))).toBe(false);
    expect(releases).toEqual(subscriptions.map(String));
    // A second route instance has an empty cache: the chain must independently accept the same raw definition.
    const chain=Fastify();cleanup.push(async()=>chain.close());
    registerOptionRoutes(chain,hub,'PAPER',()=>[],database);
    const response=await chain.inject('/api/v1/options/contracts?expiration=20271119&centerStrike=102&limit=2&consumerId=8e54c6e3-b6c7-4217-b026-0de8ff8b9fe5');
    expect(response.statusCode).toBe(200);expect(response.json().errors).toEqual([]);
    expect(response.json().items.map((row:any)=>row.conId)).toEqual(result.items.map(row=>row.contract.conId));
    expect(requests.filter(kind=>kind==='option.resolve')).toHaveLength(4);
    expect(releases).toHaveLength(2); // Chain retains its visible consumer until the UI releases it.
  });
  it('Radar y cadena rechazan la misma definición incompatible con errores por campo',async()=>{
    const {database}=await fixture('DEMO'),app=Fastify();cleanup.push(async()=>app.close());
    const subscriptions:number[]=[],releases:string[]=[];
    const hub={status:()=>({connected:true,simulation:false,connectionId:'test'}),optionPageTimeoutMs:()=>10_000,
      request:async(kind:string,payload:Record<string,unknown>)=>kind==='option.parameters'?{payload:{items:[{
        exchange:'SMART',tradingClass:'NVDA',multiplier:100,expirations:['20271119'],strikes:[100,110]}]}}:
        {requestId:'identity-test',payload:{contract:{conId:10000+Number(payload.strike),symbol:payload.strike===110?'QQQ':'NVDA',
          secType:'OPT',tradingClass:'NVDA',currency:'USD',right:'C',expiration:payload.strike===110?'20271126':'20271119 16:00:00',
          strike:payload.strike===110?'111':'100',multiplier:'100'}}},
      subscribe:async(value:{conId:number})=>{subscriptions.push(value.conId);},
      release:async(key:string)=>{releases.push(key);},latestQuote:()=>null} as unknown as AgentHub;
    const routes=registerOptionRoutes(app,hub,'PAPER',()=>[],database);
    const inspected=await routes.inspectOpportunity('CALL',102,2,'8e54c6e3-b6c7-4217-b026-0de8ff8b9fe5');
    expect(inspected.items).toHaveLength(1);
    expect(inspected.errors).toMatchObject([{code:'INVALID_CONTRACT',strike:110,
      mismatchFields:['symbol','expiration','strike']}]);
    expect(subscriptions).toEqual([10100]);expect(releases).toEqual(['10100']);
    const chain=Fastify();cleanup.push(async()=>chain.close());registerOptionRoutes(chain,hub,'PAPER',()=>[],database);
    const response=await chain.inject('/api/v1/options/contracts?expiration=20271119&centerStrike=102&limit=2&consumerId=8e54c6e3-b6c7-4217-b026-0de8ff8b9fe5');
    expect(response.json().items).toHaveLength(1);
    expect(response.json().errors).toMatchObject([{code:'INVALID_CONTRACT',strike:110,
      mismatchFields:['symbol','expiration','strike']}]);
  });
  it('dos trabajadores reclaman un solo presupuesto de inspección dentro del bloqueo',async()=>{
    const {dir,database}=await fixture('PAPER'),path=join(dir,'radar','opportunities.jsonl');
    const first=new OpportunityStore(path),second=new OpportunityStore(path),item={...detected(0),status:'TECHNICAL_CANDIDATE' as const};
    await first.append('DETECTED',item,()=> '2026-10-26T14:00:01.000Z');
    let calls=0;const inspect=async()=>{calls++;await new Promise(done=>setTimeout(done,50));return {items:[],errors:[]};};
    const options={inspect,sqlite:database,connected:()=>true,simulation:()=>false,
      clock:()=>Date.parse('2026-10-26T14:00:10.000Z'),maxContracts:2};
    await Promise.all([createOpportunityBrokerWorker({...options,store:first})(),
      createOpportunityBrokerWorker({...options,store:second})()]);
    expect(calls).toBe(1);
    expect((await first.read()).filter(row=>row.kind==='CONTRACT_ATTEMPT'&&row.payload.code==='CHECKED')).toHaveLength(1);
  });
});
