/** Runs inside the existing IEX daily coordinator; it never starts a feed or broker request. */
import type {MarketCalendar} from './alpaca-calendar.ts';
import type {IexRecord} from './phase38-iex.ts';
import type {IexWarmup} from './phase38f-warmup.ts';
import {OpportunityStore} from './phase41o-ledger.ts';
import {buildOpportunityCandidates,candidateStatus,firstCompleteOpportunityBars,prepareOpportunityTechnical} from './phase41o-opportunity-engine.ts';
import {OPPORTUNITY_CONTEXT_RULE_VERSION} from './phase41o-opportunity-engine.ts';
import {prepareOpportunityTechnicalV2} from './phase41p-live-engine.ts';
import {warmupAsRestContext,type RestContext} from './phase41p-continuity.ts';

const QUARTER=900_000;

export async function observeIexOpportunities(input:{records:IexRecord[];calendar:MarketCalendar;warmup?:IexWarmup;
  restContext?:RestContext;store:OpportunityStore;nowUtc:string;processStartedAtUtc:string;feedActive?:boolean}){
  const {records,calendar,warmup,store,nowUtc,processStartedAtUtc}=input;
  const first=firstCompleteOpportunityBars(records,nowUtc);
  const existing=await store.read();
  let outcomes=0;
  for(const detected of existing.filter(row=>row.kind==='DETECTED')){
    const candidate=detected.payload,scheduled=candidate.outcomeScheduledEndUtc;
    if(!scheduled||existing.some(row=>row.kind==='UNDERLYING_OUTCOME'&&row.payload.candidateId===candidate.candidateId))continue;
    const starts=Array.from({length:4},(_,i)=>new Date(Date.parse(candidate.barEndUtc)+i*QUARTER).toISOString());
    const future=starts.map(start=>first.find(row=>row.bar?.startUtc===start));
    if(future.some(row=>!row?.bar)||future.at(-1)!.bar!.endUtc!==scheduled||
      future.some(row=>Date.parse(row!.receivedAtUtc)>Date.parse(nowUtc)))continue;
    const last=future.at(-1)!,close=last.bar!.close;
    await store.append('UNDERLYING_OUTCOME',{candidateId:candidate.candidateId,evaluatedAtUtc:nowUtc,
      outcomeEndUtc:scheduled,firstVersionBarHashes:future.map(row=>row!.recordHash),close,
      movementPercent:100*(close/candidate.observedUnderlyingPrice-1)},()=>nowUtc);
    outcomes++;
  }
  if(input.feedActive===false)return {status:'FEED_DISCONNECTED',reason:'El recolector IEX no está activo.',
    candidates:0,outcomes};
  const prepared=input.restContext?prepareOpportunityTechnicalV2(records,calendar,
    [warmup&&warmupAsRestContext(warmup),input.restContext].filter(x=>x!==undefined),nowUtc):
    prepareOpportunityTechnical(records,calendar,warmup,nowUtc);
  if(prepared.status!=='READY'||!prepared.last||Date.parse(prepared.last.receivedAtUtc)<Date.parse(processStartedAtUtc))
    return {status:prepared.status,reason:prepared.reason,candidates:0,outcomes};
  let candidates=0;
  for(const candidate of buildOpportunityCandidates(prepared,nowUtc,
    input.restContext?OPPORTUNITY_CONTEXT_RULE_VERSION:undefined)){
    const prior=existing.find(row=>row.kind==='DETECTED'&&row.payload.candidateId===candidate.candidateId);
    if(prior&&prior.kind==='DETECTED'){
      const latest=existing.filter(row=>row.kind==='TECHNICAL_UPDATE'&&row.payload.candidateId===candidate.candidateId).at(-1);
      const priorState=latest?.kind==='TECHNICAL_UPDATE'?latest.payload.scenarioState:prior.payload.scenario.state;
      if(priorState!==candidate.scenario.state){
        const classification=candidateStatus(candidate.scenario);
        await store.append('TECHNICAL_UPDATE',{candidateId:candidate.candidateId,scenarioId:candidate.scenario.id,
          observedAtUtc:nowUtc,scenarioState:candidate.scenario.state,
          evidenceAvailableAtUtc:candidate.technicalEvidenceAvailableAtUtc,
          sourceBarHash:candidate.sourceBarHash,scenario:candidate.scenario,
          status:classification.status,exclusionReasons:classification.reasons},()=>nowUtc);
      }
      continue;
    }
    const result=await store.append('DETECTED',candidate,()=>nowUtc).catch(async error=>{
      // Repeated polling and process restart keep the first immutable snapshot.
      if((error as Error).message!=='OPPORTUNITY_DUPLICATE_CANDIDATE')throw error;
      return {alreadyPresent:true};
    });
    if(!result.alreadyPresent)candidates++;
  }
  return {status:prepared.status,reason:prepared.reason,candidates,outcomes};
}
