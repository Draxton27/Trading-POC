import type {SimulatorContract,SimulatorPlan,SimulatorQuoteReference} from '@trading-poc/contracts';
import {expirationAnalysis,optionQuoteQuality} from './option-analysis.ts';

export type SimulatorLot={lotId:string;quantity:number;premiumPerShare:number;entryFeeUsd:number|null;
  decisionAtUtc:string;simulatedEntryAtUtc:string;priceOrigin:'MANUAL_INPUT'|'OBSERVED_ASK_REFERENCE';
  fillStatus:'HYPOTHETICAL';quoteReference:SimulatorQuoteReference|null;entryReason?:string};
export type SimulatorOpen={contract:SimulatorContract;lot:SimulatorLot;plan:SimulatorPlan;
  classification:'DOCUMENTED_ON_TIME'|'HISTORICAL_SIMULATION'|'DEMO_SYNTHETIC'};
export type SimulatorClose={quantity:number;premiumPerShare:number;exitFeeUsd:number|null;
  decisionAtUtc:string;simulatedExitAtUtc:string;reason:string;
  priceOrigin:'MANUAL_INPUT'|'OBSERVED_BID_REFERENCE';fillStatus:'HYPOTHETICAL';quoteReference:SimulatorQuoteReference|null};
export type SimulatorEventBody=
  |{kind:'SIM_POSITION_OPENED';payload:SimulatorOpen}
  |{kind:'SIM_POSITION_LOT_ADDED';payload:{lot:SimulatorLot}}
  |{kind:'SIM_POSITION_PARTIALLY_CLOSED'|'SIM_POSITION_CLOSED';payload:SimulatorClose}
  |{kind:'SIM_POSITION_NOTE_ADDED';payload:{note:string}}
  |{kind:'SIM_POSITION_PLAN_UPDATED';payload:{plan:SimulatorPlan;reason:string}};
export type SimulatorEvent=SimulatorEventBody&{schemaVersion:1;environment:'INTERNAL_SIMULATOR';
  executionSource:'MANUAL_HYPOTHETICAL';simulationEventId:string;simulationId:string;positionId:string;
  idempotencyKey:string;requestHash:string;recordedAtUtc:string;sequence:number;previousHash:string|null;hash:string};
export type SimulatorPosition={positionId:string;simulationId:string;contract:SimulatorContract;
  classification:SimulatorOpen['classification'];status:'OPEN'|'PARTIALLY_CLOSED'|'CLOSED'|'EXPIRED_UNRESOLVED';
  openedAtUtc:string;lastEventAtUtc:string;plan:SimulatorPlan;notes:string[];initialQuantity:number;
  remainingQuantity:number;closedQuantity:number;grossEntryCostUsd:number;closedCostBasisUsd:number;
  grossExitProceedsUsd:number;realizedGrossPnlUsd:number;realizedGrossPnlPercent:number|null;
  realizedNetPnlUsd:number|null;knownEntryFeesAllocatedUsd:number;knownExitFeesUsd:number;
  feesCompleteForRealized:boolean;remainingPremiumExposureUsd:number;lots:SimulatorLot[]};

const cents=(n:number)=>{
  if(!Number.isFinite(n)||Math.abs(n)*100>Number.MAX_SAFE_INTEGER)throw new Error('Importe monetario fuera de rango seguro');
  return Math.round((n+Number.EPSILON)*100)/100;
};
export function optionPremiumTotal(premiumPerShare:number,multiplier:number,quantity:number){
  return cents(premiumPerShare*multiplier*quantity);
}
type Internal=SimulatorPosition&{remainingByLot:Map<string,number>;closedByLot:Map<string,number>;
  lastEconomicAtUtc:string};
export function replaySimulator(events:readonly SimulatorEvent[],asOfUtc:string):SimulatorPosition[]{
  const positions=new Map<string,Internal>();
  for(const event of events){
    if(event.kind==='SIM_POSITION_OPENED'){
      if(positions.has(event.positionId))throw new Error('Apertura duplicada de posición');
      const p=event.payload,{lot}=p;
      if(Date.parse(lot.decisionAtUtc)>Date.parse(lot.simulatedEntryAtUtc)+2000||
          Date.parse(lot.simulatedEntryAtUtc)>Date.parse(event.recordedAtUtc)+2000)
        throw new Error('Entrada fuera de secuencia causal');
      const gross=optionPremiumTotal(lot.premiumPerShare,p.contract.multiplier,lot.quantity);
      positions.set(event.positionId,{positionId:event.positionId,simulationId:event.simulationId,contract:p.contract,
        classification:p.classification,status:'OPEN',openedAtUtc:event.recordedAtUtc,lastEventAtUtc:event.recordedAtUtc,
        plan:p.plan,notes:[],initialQuantity:lot.quantity,remainingQuantity:lot.quantity,closedQuantity:0,
        grossEntryCostUsd:gross,closedCostBasisUsd:0,grossExitProceedsUsd:0,realizedGrossPnlUsd:0,
        realizedGrossPnlPercent:null,realizedNetPnlUsd:null,knownEntryFeesAllocatedUsd:0,knownExitFeesUsd:0,
        feesCompleteForRealized:true,remainingPremiumExposureUsd:gross,lots:[lot],
        remainingByLot:new Map([[lot.lotId,lot.quantity]]),closedByLot:new Map([[lot.lotId,0]]),
        lastEconomicAtUtc:lot.simulatedEntryAtUtc});
      continue;
    }
    const state=positions.get(event.positionId);
    if(!state||state.simulationId!==event.simulationId)throw new Error('Evento sin posición original');
    state.lastEventAtUtc=event.recordedAtUtc;
    if(event.kind==='SIM_POSITION_LOT_ADDED'){
      if(state.remainingQuantity===0)throw new Error('No se agregan lotes a una posición cerrada');
      const lot=event.payload.lot;
      if(Date.parse(lot.decisionAtUtc)>Date.parse(lot.simulatedEntryAtUtc)+2000||
          lot.simulatedEntryAtUtc<state.lastEconomicAtUtc||
          Date.parse(lot.simulatedEntryAtUtc)>Date.parse(event.recordedAtUtc)+2000)
        throw new Error('Lote fuera de secuencia causal');
      if(state.remainingByLot.has(lot.lotId))throw new Error('Lote duplicado');
      state.lastEconomicAtUtc=lot.simulatedEntryAtUtc;
      state.lots.push(lot);state.remainingByLot.set(lot.lotId,lot.quantity);state.closedByLot.set(lot.lotId,0);
      state.initialQuantity+=lot.quantity;state.remainingQuantity+=lot.quantity;
      state.grossEntryCostUsd=cents(state.grossEntryCostUsd+optionPremiumTotal(lot.premiumPerShare,state.contract.multiplier,lot.quantity));
    }else if(event.kind==='SIM_POSITION_PARTIALLY_CLOSED'||event.kind==='SIM_POSITION_CLOSED'){
      const close=event.payload;
      if(Date.parse(close.decisionAtUtc)>Date.parse(close.simulatedExitAtUtc)+2000||
          close.simulatedExitAtUtc<state.lastEconomicAtUtc||
          Date.parse(close.simulatedExitAtUtc)>Date.parse(event.recordedAtUtc)+2000)
        throw new Error('Salida fuera de secuencia causal');
      state.lastEconomicAtUtc=close.simulatedExitAtUtc;
      if(state.classification!=='DEMO_SYNTHETIC'&&
          (Date.parse(event.recordedAtUtc)-Date.parse(close.decisionAtUtc)>60_000||
            Date.parse(event.recordedAtUtc)-Date.parse(close.simulatedExitAtUtc)>60_000))
        state.classification='HISTORICAL_SIMULATION';
      if(!Number.isSafeInteger(close.quantity)||close.quantity<=0||close.quantity>state.remainingQuantity)
        throw new Error('Cantidad de cierre incompatible');
      const final=close.quantity===state.remainingQuantity;
      if((event.kind==='SIM_POSITION_CLOSED')!==final)throw new Error('Tipo de cierre contradictorio');
      let pending=close.quantity;
      for(const lot of state.lots){
        if(pending===0)break;
        const available=state.remainingByLot.get(lot.lotId)??0,used=Math.min(available,pending);
        if(!used)continue;
        const priorClosed=state.closedByLot.get(lot.lotId)??0;
        state.remainingByLot.set(lot.lotId,available-used);state.closedByLot.set(lot.lotId,priorClosed+used);
        state.closedCostBasisUsd=cents(state.closedCostBasisUsd+optionPremiumTotal(lot.premiumPerShare,state.contract.multiplier,used));
        if(lot.entryFeeUsd===null)state.feesCompleteForRealized=false;
        else state.knownEntryFeesAllocatedUsd=cents(state.knownEntryFeesAllocatedUsd+
          (cents(lot.entryFeeUsd*(priorClosed+used)/lot.quantity)-cents(lot.entryFeeUsd*priorClosed/lot.quantity)));
        pending-=used;
      }
      if(pending)throw new Error('FIFO inconsistente');
      state.remainingQuantity-=close.quantity;state.closedQuantity+=close.quantity;
      state.grossExitProceedsUsd=cents(state.grossExitProceedsUsd+
        optionPremiumTotal(close.premiumPerShare,state.contract.multiplier,close.quantity));
      if(close.exitFeeUsd===null)state.feesCompleteForRealized=false;
      else state.knownExitFeesUsd=cents(state.knownExitFeesUsd+close.exitFeeUsd);
    }else if(event.kind==='SIM_POSITION_NOTE_ADDED')state.notes.push(event.payload.note);
    else if(event.kind==='SIM_POSITION_PLAN_UPDATED')state.plan=event.payload.plan;
    state.remainingPremiumExposureUsd=cents(state.grossEntryCostUsd-state.closedCostBasisUsd);
    state.realizedGrossPnlUsd=cents(state.grossExitProceedsUsd-state.closedCostBasisUsd);
    state.realizedGrossPnlPercent=state.closedCostBasisUsd?100*state.realizedGrossPnlUsd/state.closedCostBasisUsd:null;
    state.realizedNetPnlUsd=state.closedQuantity&&state.feesCompleteForRealized?
      cents(state.realizedGrossPnlUsd-state.knownEntryFeesAllocatedUsd-state.knownExitFeesUsd):null;
  }
  return [...positions.values()].map(({remainingByLot:_r,closedByLot:_c,lastEconomicAtUtc:_t,...state})=>{
    const expiration=expirationAnalysis(state.contract.expiration,new Date(asOfUtc));
    return {...state,status:state.remainingQuantity===0?'CLOSED':expiration.status==='PASSED'?'EXPIRED_UNRESOLVED':
      state.closedQuantity>0?'PARTIALLY_CLOSED':'OPEN'};
  });
}

export function simulatorPerformance(positions:readonly SimulatorPosition[]){
  const cohort=(items:readonly SimulatorPosition[])=>{
    const closed=items.filter(p=>p.status==='CLOSED'),wins=closed.filter(p=>p.realizedGrossPnlUsd>0),
      losses=closed.filter(p=>p.realizedGrossPnlUsd<0),flat=closed.filter(p=>p.realizedGrossPnlUsd===0);
    const netKnown=closed.every(p=>p.realizedNetPnlUsd!==null);
    const sum=(values:readonly number[])=>cents(values.reduce((a,b)=>a+b,0));
    return {closedPositions:closed.length,winningClosedPositions:wins.length,losingClosedPositions:losses.length,
      flatClosedPositions:flat.length,realizedGrossPnlUsd:sum(closed.map(p=>p.realizedGrossPnlUsd)),
      realizedNetPnlUsd:closed.length&&netKnown?sum(closed.map(p=>p.realizedNetPnlUsd!)):null,
      averageRealizedGrossPnlUsd:closed.length?cents(sum(closed.map(p=>p.realizedGrossPnlUsd))/closed.length):null,
      winRatePercent:closed.length?100*wins.length/closed.length:null,
      averageGainUsd:wins.length?cents(sum(wins.map(p=>p.realizedGrossPnlUsd))/wins.length):null,
      averageLossUsd:losses.length?cents(sum(losses.map(p=>p.realizedGrossPnlUsd))/losses.length):null,
      openOrPartialPositions:items.filter(p=>p.status!=='CLOSED').length,
      partialRealizedGrossPnlUsd:sum(items.filter(p=>p.status!=='CLOSED').map(p=>p.realizedGrossPnlUsd))};
  };
  return {documentedOnTime:cohort(positions.filter(p=>p.classification==='DOCUMENTED_ON_TIME')),
    historical:cohort(positions.filter(p=>p.classification==='HISTORICAL_SIMULATION')),
    demo:cohort(positions.filter(p=>p.classification==='DEMO_SYNTHETIC'))};
}

export function indicativeOptionMark(position:SimulatorPosition,
  quote:({conId:number;bid?:number|null;ask?:number|null;bidSize?:number|null;askSize?:number|null;
    provider?:string|null;feedType?:string;receivedAtUtc?:string|null;marketTimestampUtc?:string|null;
    marketDataStatus?:string|null})|null,nowMs:number){
  const empty={status:'MARK_MISSING' as const,bid:null,ask:null,marketTimestampUtc:null,receivedAtUtc:null,
    feedType:'UNKNOWN',provider:null,quality:'MISSING',markSource:'NONE',
    markValueUsd:null,unrealizedGrossPnlUsd:null};
  if(!quote||quote.conId!==position.contract.conId||position.remainingQuantity===0)return empty;
  const bid=quote.bid??null,ask=quote.ask??null;
  const quality=optionQuoteQuality({bid,ask,bidSize:quote.bidSize??null,askSize:quote.askSize??null,
    receivedAtUtc:quote.receivedAtUtc??null,marketTimestampUtc:quote.marketTimestampUtc??null,
    feedType:(['LIVE','DELAYED','FROZEN','DELAYED_FROZEN','UNKNOWN'].includes(quote.feedType??'')?
      quote.feedType:'UNKNOWN') as 'LIVE'|'DELAYED'|'FROZEN'|'DELAYED_FROZEN'|'UNKNOWN',
    provider:quote.provider??null,marketDataStatus:(quote.marketDataStatus??null) as 'permission_denied'|'unavailable'|'partial'|null,
    permissionDenied:quote.marketDataStatus==='permission_denied'},nowMs);
  const status=quality.status==='SIMULATED'?'MARK_SIMULATED':quality.status==='LIVE_STALE'||quality.status==='DELAYED'||
    quality.status==='FROZEN'||quality.status==='DELAYED_FROZEN'?'MARK_STALE':
    quality.status==='LIVE_RECENT'&&bid!==null&&bid>0?'MARK_AVAILABLE':
    bid===null||bid<=0?'MARK_MISSING':'MARK_UNVERIFIED';
  const markValueUsd=status==='MARK_AVAILABLE'?optionPremiumTotal(bid!,position.contract.multiplier,position.remainingQuantity):null;
  return {status,bid,ask,marketTimestampUtc:quality.marketTimestampUtc,receivedAtUtc:quality.receivedAtUtc,
    feedType:quality.feedType,provider:quality.provider,quality:quality.status,
    markSource:status==='MARK_SIMULATED'?'SIMULATED_OPTION_QUOTE':'EXISTING_OPTION_QUOTE',markValueUsd,
    unrealizedGrossPnlUsd:markValueUsd===null?null:cents(markValueUsd-position.remainingPremiumExposureUsd)};
}
