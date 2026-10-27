import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {analyzeLongOption,optionQuoteQuality} from '@trading-poc/market-domain';
import {OpportunityCase,OpportunityCasePage,OpportunityLedgerVerification,OpportunityRadarStatus,
  type OpportunityCase as Case} from '@trading-poc/contracts';
import {OpportunityStore} from '../../../../trading_poc_001_bollinger/src/phase41o-ledger.ts';
import {readIexObservations} from '../../../../trading_poc_001_bollinger/src/phase38f-iex-observation.ts';
import {loadPhase41iActivation,phase41iProtocolDir,readPhase41iDecisions} from '../../../../trading_poc_001_bollinger/src/phase41i-prospective.ts';
import {readIexDailyState} from '../../../../scripts/iex-daily.ts';

type Mode='DEMO'|'OFFLINE'|'PAPER';
export type OpportunityPaths={ledger:string;dailyState:string;observations:string;protocolDir:string};
type Broker={status:()=>{connected:boolean;simulation:boolean}};
const query=z.object({offset:z.coerce.number().int().min(0).max(100_000).default(0),
  limit:z.coerce.number().int().min(1).max(100).default(20),
  capitalUsd:z.coerce.number().finite().nonnegative().max(1e12).optional()}).strict();
const identifier=z.string().regex(/^[a-f0-9]{64}$/);

function project(rows:Awaited<ReturnType<OpportunityStore['read']>>,paths:OpportunityPaths,now:number):Case[]{
  if(!rows.some(row=>row.kind==='DETECTED'))return [];
  let predictions:ReturnType<typeof readIexObservations>=[],protocol:string|null=null;
  let decisions:ReturnType<typeof readPhase41iDecisions>=[];
  try{if(existsSync(paths.observations)){
    predictions=readIexObservations(paths.observations);
    const active=loadPhase41iActivation(paths.protocolDir,paths.observations);
    protocol=active?.activation.protocolSha256??null;
    if(active)decisions=readPhase41iDecisions(active.directory);
  }}catch{predictions=[];protocol=null;decisions=[];}
  const cases=rows.filter(row=>row.kind==='DETECTED').map(row=>{
    const id=row.payload.candidateId,updates=rows.flatMap(item=>item.kind==='TECHNICAL_UPDATE'&&item.payload.candidateId===id?[item.payload]:[]);
    const contracts=rows.flatMap(item=>item.kind==='CONTRACT_OBSERVED'&&item.payload.candidateId===id?[item.payload]:[]);
    const attempts=rows.flatMap(item=>item.kind==='CONTRACT_ATTEMPT'&&item.payload.candidateId===id?[item.payload]:[]);
    const outcome=rows.flatMap(item=>item.kind==='UNDERLYING_OUTCOME'&&item.payload.candidateId===id?[item.payload]:[])[0]??null;
    const decision=protocol?decisions.find(item=>item.kind==='iex_eligibility'&&
      item.payload.protocol_sha256===protocol&&item.payload.candidate_bar_start_utc===row.payload.barStartUtc&&
      item.payload.source_bar_sha256===row.payload.sourceBarHash&&item.payload.eligibility_status==='RECORDED'&&
      item.recordedAtUtc<=row.registeredAtUtc):null;
    const prediction=decision?predictions.find(item=>item.kind==='PREDICTION'&&
      item.id===decision.payload.prediction_id_if_recorded&&item.recordHash===decision.payload.prediction_record_hash&&
      item.registeredAtUtc<=row.registeredAtUtc):null;
    const validProbabilities=prediction&&prediction.kind==='PREDICTION'&&
      [prediction.probabilities.xgboost,prediction.probabilities.linear,prediction.probabilities.frequency].every(values=>
        values.length===3&&values.every(value=>Number.isFinite(value)&&value>=0&&value<=1)&&
        Math.abs(values.reduce((a,b)=>a+b,0)-1)<1e-6);
    const model=validProbabilities&&prediction&&prediction.kind==='PREDICTION'?{predictionId:prediction.id,registeredAtUtc:prediction.registeredAtUtc,
      modelSha256:prediction.modelSha256,protocolSha256:protocol!,probabilities:{
        xgboost:{ALCISTA:prediction.probabilities.xgboost[0],BAJISTA:prediction.probabilities.xgboost[1],LATERAL:prediction.probabilities.xgboost[2]},
        linear:{ALCISTA:prediction.probabilities.linear[0],BAJISTA:prediction.probabilities.linear[1],LATERAL:prediction.probabilities.linear[2]},
        frequency:{ALCISTA:prediction.probabilities.frequency[0],BAJISTA:prediction.probabilities.frequency[1],LATERAL:prediction.probabilities.frequency[2]}}}:null;
    const latest=contracts.at(-1),technical=updates.at(-1)?.status??row.payload.status;
    const currentStatus=technical!=='TECHNICAL_CANDIDATE'?technical:
      latest?.status==='REVIEWABLE_PAPER_CANDIDATE'&&
      optionQuoteQuality(latest.quoteSnapshot,now).status!=='LIVE_RECENT'?'CONTRACT_QUOTE_UNVERIFIED':
      latest?.status??'CONTRACT_DATA_PENDING';
    return OpportunityCase.parse({candidate:row.payload,registeredAtUtc:row.registeredAtUtc,
      technicalUpdates:updates.slice(-100),contractAttempts:attempts.slice(-30),
      contracts:contracts.slice(-20),model,underlyingOutcome:outcome,
      optionOutcome:'OPTION_OUTCOME_UNAVAILABLE',currentStatus});
  });
  return cases.sort((a,b)=>b.registeredAtUtc.localeCompare(a.registeredAtUtc));
}

export function registerOpportunityRoutes(app:FastifyInstance,options:{mode:Mode;paths:OpportunityPaths;
  broker:Broker;clock?:()=>number;store?:OpportunityStore}){
  const {mode,paths,broker}=options,store=options.store??new OpportunityStore(mode==='DEMO'?null:paths.ledger),clock=options.clock??Date.now;
  const read=async()=>mode==='DEMO'?[]:project(await store.read(),paths,clock());
  const withCapital=(item:Case,capitalUsd:number|undefined):Case=>capitalUsd===undefined?item:{...item,
    contracts:item.contracts.map(contract=>({...contract,analysis:analyzeLongOption({contract:contract.contract,
      quote:contract.quoteSnapshot,quantity:1,capitalUsd,entryFeePerContractUsd:null,
      expirationFeePerContractUsd:null,hypotheticalUnderlyingAtExpirationUsd:null,
      academy:contract.analysis.academy,asOfUtc:contract.observedAtUtc})}))};
  const unavailable=(reply:any)=>reply.code(503).send({status:'INVALID_SOURCE',error:'El radar no puede verificar sus registros privados.'});
  app.get('/api/v1/radar/opportunities/status',async(_request,reply)=>{
    try{
      const items=await read(),daily=mode==='DEMO'?null:readIexDailyState(paths.dailyState),brokerState=broker.status();
      const last=daily?.lastCompleteReceivedAtUtc;
      if(last&&(!Number.isFinite(Date.parse(last))||Date.parse(last)>clock()))throw new Error('FUTURE_RECEIPT');
      const age=last?(clock()-Date.parse(last))/60_000:null;
      return OpportunityRadarStatus.parse({status:mode==='DEMO'?'DEMO':items.length?'AVAILABLE':
        existsSync(paths.ledger)?'NO_CANDIDATES':'UNAVAILABLE',mode,collectorStatus:daily?.collector??null,
        lastCompleteBarEndUtc:daily?.lastCompleteBarEndUtc??null,lastCompleteReceivedAtUtc:last??null,
        ageMinutes:age,ibkrConnected:mode==='PAPER'&&brokerState.connected,ibkrSimulation:brokerState.simulation,
        candidateCount:items.length,lastCandidateAtUtc:items[0]?.registeredAtUtc??null,
        quoteVerification:'El adaptador TWS no acredita la hora de mercado BID/ASK; no se eleva a LIVE verificado.',
        limitations:['Candidatos experimentales; no son señales operativas ni órdenes.',
          age!==null&&age>15?'La última vela IEX está obsoleta; no se generan candidatos nuevos.':'La cobertura IEX depende de sus minutos completos.']});
    }catch{return unavailable(reply);}
  });
  app.get('/api/v1/radar/opportunities/ledger/verify',async(_request,reply)=>{
    try{const rows=mode==='DEMO'?[]:await store.read();return OpportunityLedgerVerification.parse({
      status:mode==='DEMO'?'DEMO':rows.length?'AVAILABLE':existsSync(paths.ledger)?'NO_CANDIDATES':'UNAVAILABLE',
      records:rows.length,candidateCount:rows.filter(row=>row.kind==='DETECTED').length,headHash:rows.at(-1)?.recordHash??null});}
    catch{return unavailable(reply);}
  });
  const page=async(request:any,reply:any,current:boolean)=>{
    const parsed=query.safeParse(request.query);if(!parsed.success)return reply.code(400).send({error:'Paginación inválida.'});
    try{const all=await read(),now=clock(),items=current?all.filter(item=>{
      const activity=Math.max(Date.parse(item.registeredAtUtc),
        ...item.technicalUpdates.map(update=>Date.parse(update.observedAtUtc)),
        ...item.contractAttempts.map(attempt=>Date.parse(attempt.attemptAtUtc)),
        ...item.contracts.map(contract=>Date.parse(contract.observedAtUtc)));
      return now-activity<15*60_000&&item.underlyingOutcome===null;
    }):all;
      const {offset,limit}=parsed.data;
      return OpportunityCasePage.parse({status:mode==='DEMO'?'DEMO':items.length?'AVAILABLE':
        existsSync(paths.ledger)?'NO_CANDIDATES':'UNAVAILABLE',items:items.slice(offset,offset+limit).map(item=>withCapital(item,parsed.data.capitalUsd)),total:items.length,
        offset,limit,nextOffset:offset+limit<items.length?offset+limit:null});
    }catch{return unavailable(reply);}
  };
  app.get('/api/v1/radar/opportunities/current',(request,reply)=>page(request,reply,true));
  app.get('/api/v1/radar/opportunities/history',(request,reply)=>page(request,reply,false));
  app.get('/api/v1/radar/opportunities/:id',async(request,reply)=>{
    const parsed=identifier.safeParse((request.params as {id:string}).id);
    if(!parsed.success)return reply.code(400).send({error:'Identificador inválido.'});
    try{const item=(await read()).find(value=>value.candidate.candidateId===parsed.data);
      return item?{item}:reply.code(404).send({error:'Candidato no encontrado.'});}
    catch{return unavailable(reply);}
  });
  return store;
}

export function opportunityPaths(privateDir:string,env:NodeJS.ProcessEnv=process.env):OpportunityPaths{
  return {ledger:env.TRADING_POC_OPPORTUNITY_LEDGER??resolve(privateDir,'radar','opportunities.jsonl'),
    dailyState:env.TRADING_POC_IEX_AUTOMATION_STATUS??resolve(privateDir,'ml-iex','daily-status.json'),
    observations:env.TRADING_POC_IEX_OBSERVATION_LEDGER??resolve(privateDir,'ml-iex','observations.jsonl'),
    protocolDir:phase41iProtocolDir(env)};
}
