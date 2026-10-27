/** Bounded Paper-only background enrichment. Never called by a GET route. */
import {randomUUID} from 'node:crypto';
import type Database from 'better-sqlite3';
import {analyzeLongOption} from '@trading-poc/market-domain';
import {OptionAnalysisInput,type OpportunityContractSnapshot} from '@trading-poc/contracts';
import {OpportunityStore} from '../../../../trading_poc_001_bollinger/src/phase41o-ledger.ts';
import {academyRanges,evaluateAcademyAskRange,selectAcademyReference} from '../academy/service.ts';

type Inspection={items:Array<{contract:Record<string,unknown>;quote:Record<string,unknown>|null;
  error:{code:string}|null}>;errors:Array<{code:string}>};
type Inspect=(right:'CALL'|'PUT',referencePrice:number,count:number,consumerId:string)=>Promise<Inspection>;
const attemptCodes=new Set(['CHECKED','DISCONNECTED','PACING','PERMISSION','TIMEOUT','NOT_FOUND','AMBIGUOUS','LIMIT',
  'INVALID_CONTRACT','BROKER_ERROR','PAGE_TIMEOUT','NO_CONTRACT']);
const numberOrNull=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:null;
const stringOrNull=(value:unknown)=>typeof value==='string'?value:null;
const utcOrNull=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&
  new Date(Date.parse(value)).toISOString()===value?value:null;
const feed=(value:unknown):'LIVE'|'DELAYED'|'FROZEN'|'DELAYED_FROZEN'|'UNKNOWN'=>
  value==='LIVE'||value==='DELAYED'||value==='FROZEN'||value==='DELAYED_FROZEN'?value:'UNKNOWN';
const marketStatus=(value:unknown):'permission_denied'|'unavailable'|'partial'|null=>
  value==='permission_denied'||value==='unavailable'||value==='partial'?value:null;

export function opportunityContractAnalysis(candidate:{candidateId:string;directionHypothesis:'CALL'|'PUT';
  observedUnderlyingPrice:number;status:string},contract:Record<string,unknown>,raw:Record<string,unknown>|null,
  error:{code:string}|null,sqlite:Database.Database,nowUtc:string,simulation:boolean):OpportunityContractSnapshot{
  const right=candidate.directionHypothesis,reference=selectAcademyReference(academyRanges(sqlite,'NVDA'),nowUtc,right);
  const quote={bid:numberOrNull(raw?.bid),ask:numberOrNull(raw?.ask),bidSize:numberOrNull(raw?.bidSize),
    askSize:numberOrNull(raw?.askSize),receivedAtUtc:utcOrNull(raw?.receivedAtUtc),
    marketTimestampUtc:utcOrNull(raw?.marketTimestampUtc),feedType:feed(raw?.feedType),
    provider:simulation?'PAPER SIMULADO':raw?.provider==='IBKR'?'IBKR':null,
    marketDataStatus:error?.code==='PERMISSION'?'permission_denied' as const:marketStatus(raw?.marketDataStatus),
    permissionDenied:error?.code==='PERMISSION'||raw?.marketDataStatus==='permission_denied'};
  const identity={conId:numberOrNull(contract.conId),symbol:stringOrNull(contract.symbol),
    occSymbol:stringOrNull(contract.occSymbol)??stringOrNull(contract.localSymbol),
    right:contract.right==='CALL'||contract.right==='PUT'?contract.right:null,
    strike:numberOrNull(contract.strike),expiration:stringOrNull(contract.expiration),
    multiplier:numberOrNull(contract.multiplier),currency:stringOrNull(contract.currency)};
  const academy=evaluateAcademyAskRange(reference,{...quote,provider:quote.provider},Date.parse(nowUtc),
    identity.currency??'',identity.multiplier);
  const academyContext={status:academy.status,referenceStatus:academy.referenceStatus,reason:academy.reason,
    minAskCents:reference.range?.minAskCents??null,maxAskCents:reference.range?.maxAskCents??null,
    outerMinCents:reference.range?.outerMinCents??null,outerMaxCents:reference.range?.outerMaxCents??null,
    referenceDate:reference.range?.referenceDate??null,validFrom:reference.range?.validFrom??null,
    validTo:reference.range?.validTo??null,quoteReceivedAtUtc:academy.quoteReceivedAtUtc};
  const input=OptionAnalysisInput.parse({contract:identity,quote,quantity:1,capitalUsd:null,
    entryFeePerContractUsd:null,expirationFeePerContractUsd:null,hypotheticalUnderlyingAtExpirationUsd:null,
    academy:academyContext,asOfUtc:nowUtc});
  const analysis=analyzeLongOption(input),reasons:string[]=[];
  if(error)reasons.push(`IBKR: ${error.code}`);
  if(analysis.contractStatus!=='VALID'||analysis.expiration.status==='INVALID'||analysis.expiration.status==='PASSED')
    reasons.push('Identidad o vencimiento de contrato no elegible.');
  if(analysis.quote.status!=='LIVE_RECENT'||!analysis.quote.askCurrentVerified||analysis.quote.bidAskStatus!=='VALID')
    reasons.push(`Cotización no verificada: ${analysis.quote.status}.`);
  const sizeVerified=quote.bidSize!==null&&quote.askSize!==null&&
    Number.isSafeInteger(quote.bidSize)&&Number.isSafeInteger(quote.askSize)&&quote.bidSize>0&&quote.askSize>0;
  if(!sizeVerified)reasons.push('Tamaños BID/ASK positivos no verificados.');
  if(academy.referenceStatus==='HISTORICAL_ONLY')reasons.push('Referencia Investep histórica, sin vigencia declarada.');
  if(academy.referenceStatus==='CONFLICT')reasons.push('Referencias documentales contradictorias.');
  const bookInvalid=['INVALID','CROSSED','BID_ZERO','ASK_NON_POSITIVE'].includes(analysis.quote.bidAskStatus);
  const status=candidate.status!=='TECHNICAL_CANDIDATE'?'CONTRACT_CONSTRAINT_FAILED':
    analysis.contractStatus!=='VALID'||analysis.expiration.status==='INVALID'||analysis.expiration.status==='PASSED'||bookInvalid?
      'CONTRACT_CONSTRAINT_FAILED':analysis.quote.status!=='LIVE_RECENT'||analysis.quote.bidAskStatus!=='VALID'||!sizeVerified?
        'CONTRACT_QUOTE_UNVERIFIED':'REVIEWABLE_PAPER_CANDIDATE';
  return {candidateId:candidate.candidateId,conId:identity.conId!,observedAtUtc:nowUtc,contract:input.contract,
    quoteSnapshot:input.quote,analysis,status,exclusionReasons:reasons};
}

export function createOpportunityBrokerWorker(options:{store:OpportunityStore;inspect:Inspect;
  sqlite:Database.Database;connected:()=>boolean;simulation:()=>boolean;clock?:()=>number;maxContracts?:number}){
  const clock=options.clock??Date.now,limit=Math.max(1,Math.min(4,options.maxContracts??2));
  let busy=false;
  return async()=>{
    if(busy||!options.connected())return;busy=true;
    try{
      const now=clock(),records=await options.store.read();
      for(const found of records.filter(row=>row.kind==='DETECTED').slice(-10)){
        const candidate=found.payload,id=candidate.candidateId;
        const technicalUpdates=records.filter(row=>row.kind==='TECHNICAL_UPDATE'&&row.payload.candidateId===id);
        const latestTechnical=technicalUpdates.at(-1);
        const technicalStatus=latestTechnical?.kind==='TECHNICAL_UPDATE'?latestTechnical.payload.status:candidate.status;
        const lastTechnicalAt=latestTechnical?.kind==='TECHNICAL_UPDATE'?latestTechnical.registeredAtUtc:found.registeredAtUtc;
        if(technicalStatus!=='TECHNICAL_CANDIDATE'||now-Date.parse(lastTechnicalAt)>15*60_000)continue;
        const observations=records.filter(row=>row.kind==='CONTRACT_OBSERVED'&&row.payload.candidateId===id);
        if(observations.length>=3*limit||observations.some(row=>row.kind==='CONTRACT_OBSERVED'&&
          row.payload.quoteSnapshot.bid!==null&&row.payload.quoteSnapshot.ask!==null))continue;
        const persisted=records.filter(row=>row.kind==='CONTRACT_ATTEMPT'&&row.payload.candidateId===id&&
          row.payload.code==='CHECKED');
        const lastAttempt=persisted.at(-1);
        if(persisted.length>=3||lastAttempt&&now-Date.parse(lastAttempt.registeredAtUtc)<60_000)continue;
        const attemptId=randomUUID();
        const note=async(code:string)=>{
          const at=new Date(clock()).toISOString();
          await options.store.append('CONTRACT_ATTEMPT',{candidateId:id,attemptId,attemptAtUtc:at,
            code:(attemptCodes.has(code)?code:'BROKER_ERROR') as 'BROKER_ERROR'},()=>new Date(clock()).toISOString());
        };
        try{
          const at=new Date(clock()).toISOString();
          await options.store.append('CONTRACT_ATTEMPT',{candidateId:id,attemptId,attemptAtUtc:at,code:'CHECKED'},
            ()=>new Date(clock()).toISOString(),rows=>{
              const claimed=rows.filter(row=>row.kind==='CONTRACT_ATTEMPT'&&row.payload.candidateId===id&&
                row.payload.code==='CHECKED');
              if(claimed.length>=3||claimed.length&&clock()-Date.parse(claimed.at(-1)!.registeredAtUtc)<60_000)
                throw new Error('OPPORTUNITY_BROKER_COOLDOWN');
            });
        }catch(error){if((error as Error).message==='OPPORTUNITY_BROKER_COOLDOWN')continue;throw error;}
        let inspected:Inspection;
        try{inspected=await options.inspect(candidate.directionHypothesis,candidate.observedUnderlyingPrice,
          limit,attemptId);}catch{await note('BROKER_ERROR');continue;}
        for(const error of inspected.errors)await note(error.code);
        if(!inspected.items.length&&!inspected.errors.length)await note('NO_CONTRACT');
        for(const item of inspected.items){
          if(!Number.isSafeInteger(item.contract.conId)||Number(item.contract.conId)<=0||
            item.contract.right!==candidate.directionHypothesis||item.contract.symbol!=='NVDA')continue;
          const at=new Date(clock()).toISOString();
          const snapshot=opportunityContractAnalysis({...candidate,status:technicalStatus},item.contract,item.quote,item.error,
            options.sqlite,at,options.simulation());
          await options.store.append('CONTRACT_OBSERVED',snapshot,()=>new Date(clock()).toISOString());
        }
        break; // one candidate per cycle; prevent a burst across the chain
      }
    }finally{busy=false;}
  };
}
