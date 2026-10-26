import {randomUUID} from 'node:crypto';
import {SimulatorContract,SimulatorCloseRequest,SimulatorOpenRequest,SimulatorNoteRequest,
  SimulatorPlanRequest,SimulatorAddLotRequest,SimulatorQuoteReference,type SimulatorPlan} from '@trading-poc/contracts';
import {expirationAnalysis,indicativeOptionMark,optionPremiumTotal,optionQuoteQuality,
  replaySimulator,simulatorPerformance,type SimulatorEvent,type SimulatorEventBody,type SimulatorPosition} from '@trading-poc/market-domain';
import {parseOccSymbol} from '../../../../trading_poc_001_bollinger/src/phase17-occ.ts';
import {SimulatorStore,simulatorHash} from './store.ts';

export class SimulatorInputError extends Error{constructor(readonly status:number,message:string){super(message);}}
type RawQuote={conId?:number;bid?:number|null;ask?:number|null;bidSize?:number|null;askSize?:number|null;
  provider?:string|null;feedType?:string;receivedAtUtc?:string|null;marketTimestampUtc?:string|null;
  marketDataStatus?:string|null};
type Dependencies={store:SimulatorStore;mode:'DEMO'|'OFFLINE'|'PAPER';
  contract:(conId:number)=>Record<string,unknown>|null;quote:(conId:number)=>RawQuote|null;
  humanDecision?:(id:string,decisionAtUtc:string)=>boolean};
const prefix=(kind:string)=>`SIM41M:${kind}:${randomUUID()}`;
const lastEconomicAt=(events:readonly SimulatorEvent[],id:string)=>events.filter(e=>e.positionId===id)
  .map(e=>e.kind==='SIM_POSITION_OPENED'||e.kind==='SIM_POSITION_LOT_ADDED'?e.payload.lot.simulatedEntryAtUtc:
    e.kind==='SIM_POSITION_CLOSED'||e.kind==='SIM_POSITION_PARTIALLY_CLOSED'?e.payload.simulatedExitAtUtc:null)
  .filter((time):time is string=>time!==null).at(-1)??null;
const validTime=(decision:string,occurred:string,at:string)=>{
  const d=Date.parse(decision),o=Date.parse(occurred),now=Date.parse(at);
  if(d>now+2000||o>now+2000||d>o+2000)throw new SimulatorInputError(400,'Tiempos de decisión o entrada/salida incompatibles');
};
const classification=(decision:string,occurred:string,at:string,mode:string)=>mode==='DEMO'?'DEMO_SYNTHETIC' as const:
  Date.parse(at)-Date.parse(decision)>60_000||Date.parse(at)-Date.parse(occurred)>60_000?
    'HISTORICAL_SIMULATION' as const:'DOCUMENTED_ON_TIME' as const;
const contractSnapshot=(raw:Record<string,unknown>|null,conId:number)=>{
  if(!raw)throw new SimulatorInputError(404,'Contrato no resuelto; vuelva a consultarlo en Opciones');
  const parsed=SimulatorContract.safeParse({conId:raw.conId,occSymbol:raw.occSymbol??null,
    underlying:raw.underlying??raw.symbol,right:raw.right,strike:raw.strike,
    expiration:String(raw.expiration??'').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),
    multiplier:raw.multiplier,currency:raw.currency});
  if(!parsed.success||parsed.data.conId!==conId)throw new SimulatorInputError(400,'Identidad de contrato inválida');
  const value=parsed.data;
  if(expirationAnalysis(value.expiration,new Date()).status==='INVALID')throw new SimulatorInputError(400,'Vencimiento inválido');
  if(value.occSymbol){
    let occ:ReturnType<typeof parseOccSymbol>;
    try{occ=parseOccSymbol(value.occSymbol);}catch{throw new SimulatorInputError(400,'OCC inválido');}
    if(occ.underlyingSymbol!=='NVDA'||occ.optionType!==value.right||occ.strike!==value.strike||
        occ.expiration!==value.expiration||occ.multiplier!==value.multiplier)
      throw new SimulatorInputError(400,'OCC contradice los campos del contrato');
  }
  return value;
};
const quoteReference=(quote:RawQuote|null,conId:number,side:'ask'|'bid',price:number,decision:string,at:string)=>{
  if(!quote||quote.conId!==conId||quote[side]===null||quote[side]===undefined||quote[side]!<=0)
    throw new SimulatorInputError(409,'Cotización observada no disponible para ese contrato');
  if(Math.abs(quote[side]!-price)>0.000001)
    throw new SimulatorInputError(409,'El precio observado cambió; confirme de nuevo');
  if(!quote.receivedAtUtc||Date.parse(quote.receivedAtUtc)>Date.parse(decision))
    throw new SimulatorInputError(409,'La cotización se recibió después de la decisión declarada');
  const quality=optionQuoteQuality({bid:quote.bid??null,ask:quote.ask??null,bidSize:quote.bidSize??null,
    askSize:quote.askSize??null,provider:quote.provider??null,
    feedType:(['LIVE','DELAYED','FROZEN','DELAYED_FROZEN','UNKNOWN'].includes(quote.feedType??'')?
      quote.feedType:'UNKNOWN') as 'LIVE'|'DELAYED'|'FROZEN'|'DELAYED_FROZEN'|'UNKNOWN',
    receivedAtUtc:quote.receivedAtUtc??null,marketTimestampUtc:quote.marketTimestampUtc??null,
    marketDataStatus:(quote.marketDataStatus??null) as 'permission_denied'|'unavailable'|'partial'|null,
    permissionDenied:quote.marketDataStatus==='permission_denied'},Date.parse(at));
  if(quality.status==='INVALID')throw new SimulatorInputError(409,'Cotización de referencia inválida');
  return SimulatorQuoteReference.parse({conId,bid:quality.bid,ask:quality.ask,provider:quality.provider,
    feedType:quality.feedType,receivedAtUtc:quality.receivedAtUtc?new Date(quality.receivedAtUtc).toISOString():null,
    marketTimestampUtc:quality.marketTimestampUtc?new Date(quality.marketTimestampUtc).toISOString():null,
    quality:quality.status,capturedAtUtc:at});
};

export class SimulatorService{
  constructor(readonly deps:Dependencies){}
  private async state(at=new Date().toISOString()){
    const events=await this.deps.store.read();
    return {events,positions:replaySimulator(events,at)};
  }
  async positions(offset=0,limit=25){
    const {positions}=await this.state();
    const items=positions.slice().reverse().slice(offset,offset+limit).map(position=>this.withMark(position));
    return {items,total:positions.length,offset,limit,environment:'INTERNAL_SIMULATOR',
      source:this.deps.mode==='DEMO'?'DEMO_SYNTHETIC':'MANUAL_HYPOTHETICAL'};
  }
  async position(id:string,eventOffset=0,eventLimit=100){
    const {events,positions}=await this.state();const position=positions.find(p=>p.positionId===id);
    if(!position)throw new SimulatorInputError(404,'Posición no encontrada');
    const history=events.filter(e=>e.positionId===id);
    return {position:this.withMark(position),events:history.slice(eventOffset,eventOffset+eventLimit),
      totalEvents:history.length,eventOffset,eventLimit};
  }
  async performance(){return simulatorPerformance((await this.state()).positions);}
  async verify(){const {events}=await this.state();return {valid:true,eventCount:events.length,
    headHash:events.at(-1)?.hash??null,environment:'INTERNAL_SIMULATOR'};}
  private withMark(position:SimulatorPosition){
    const quote=this.deps.mode==='PAPER'&&position.status==='OPEN'?this.deps.quote(position.contract.conId):null;
    return {...position,mark:indicativeOptionMark(position,quote?{...quote,conId:quote.conId??position.contract.conId}:null,Date.now())};
  }
  private checkHuman(plan:SimulatorPlan,decisionAtUtc:string){
    if(plan.humanDecisionId&&!this.deps.humanDecision?.(plan.humanDecisionId,decisionAtUtc))
      throw new SimulatorInputError(409,'Decisión humana no verificable antes de la entrada');
  }
  async open(raw:unknown){
    const request=SimulatorOpenRequest.parse(raw),fingerprint=simulatorHash(JSON.stringify({operation:'open',request}));
    const event=await this.deps.store.append(request.idempotencyKey,fingerprint,(_events,at)=>{
      validTime(request.decisionAtUtc,request.simulatedEntryAtUtc,at);
      const contract=contractSnapshot(this.deps.contract(request.conId),request.conId);
      const expiry=expirationAnalysis(contract.expiration,new Date(request.simulatedEntryAtUtc));
      if(this.deps.mode!=='DEMO'&&expiry.status==='PASSED')throw new SimulatorInputError(409,'No se abre un contrato vencido');
      optionPremiumTotal(request.premiumPerShare,contract.multiplier,request.quantity);
      this.checkHuman(request.plan??{},request.decisionAtUtc);
      const reference=request.priceOrigin==='OBSERVED_ASK_REFERENCE'?
        quoteReference(this.deps.quote(contract.conId),contract.conId,'ask',request.referencePrice??request.premiumPerShare,
          request.decisionAtUtc,at):null;
      if(request.priceOrigin==='OBSERVED_ASK_REFERENCE'&&request.premiumPerShare!==request.referencePrice)
        throw new SimulatorInputError(409,'La prima debe coincidir con el ASK copiado');
      const positionId=prefix('POSITION'),simulationId=prefix('SIMULATION'),lotId=prefix('LOT');
      return {positionId,simulationId,body:{kind:'SIM_POSITION_OPENED',payload:{contract,
        classification:classification(request.decisionAtUtc,request.simulatedEntryAtUtc,at,this.deps.mode),
        plan:request.plan??{},lot:{lotId,quantity:request.quantity,premiumPerShare:request.premiumPerShare,
          entryFeeUsd:request.entryFeeUsd,decisionAtUtc:request.decisionAtUtc,
          simulatedEntryAtUtc:request.simulatedEntryAtUtc,priceOrigin:request.priceOrigin,
          fillStatus:'HYPOTHETICAL',quoteReference:reference,entryReason:request.plan?.entryReason}}}};
    });
    return {event,position:(await this.position(event.positionId)).position};
  }
  async addLot(id:string,raw:unknown){
    const request=SimulatorAddLotRequest.parse(raw),fingerprint=simulatorHash(JSON.stringify({operation:'addLot',id,request}));
    const event=await this.deps.store.append(request.idempotencyKey,fingerprint,(events,at)=>{
      const position=replaySimulator(events,at).find(p=>p.positionId===id);
      if(!position)throw new SimulatorInputError(404,'Posición no encontrada');
      if(position.remainingQuantity===0||position.status==='EXPIRED_UNRESOLVED')
        throw new SimulatorInputError(409,'Posición no admite nuevas entradas');
      validTime(request.decisionAtUtc,request.simulatedEntryAtUtc,at);
      if(request.simulatedEntryAtUtc<(lastEconomicAt(events,id)??''))
        throw new SimulatorInputError(409,'Lote fuera de secuencia causal');
      if(classification(request.decisionAtUtc,request.simulatedEntryAtUtc,at,this.deps.mode)!==position.classification)
        throw new SimulatorInputError(409,'No mezclar entradas históricas y documentadas a tiempo');
      optionPremiumTotal(request.premiumPerShare,position.contract.multiplier,request.quantity);
      const reference=request.priceOrigin==='OBSERVED_ASK_REFERENCE'?
        quoteReference(this.deps.quote(position.contract.conId),position.contract.conId,'ask',
          request.referencePrice??request.premiumPerShare,request.decisionAtUtc,at):null;
      if(request.priceOrigin==='OBSERVED_ASK_REFERENCE'&&request.premiumPerShare!==request.referencePrice)
        throw new SimulatorInputError(409,'La prima debe coincidir con el ASK copiado');
      return {positionId:id,simulationId:position.simulationId,body:{kind:'SIM_POSITION_LOT_ADDED',
        payload:{lot:{lotId:prefix('LOT'),quantity:request.quantity,premiumPerShare:request.premiumPerShare,
          entryFeeUsd:request.entryFeeUsd,decisionAtUtc:request.decisionAtUtc,
          simulatedEntryAtUtc:request.simulatedEntryAtUtc,priceOrigin:request.priceOrigin,
          fillStatus:'HYPOTHETICAL',quoteReference:reference,entryReason:request.plan?.entryReason}}}};
    });
    return {event,position:(await this.position(event.positionId)).position};
  }
  async close(id:string,raw:unknown){
    const request=SimulatorCloseRequest.parse(raw),fingerprint=simulatorHash(JSON.stringify({operation:'close',id,request}));
    const event=await this.deps.store.append(request.idempotencyKey,fingerprint,(events,at)=>{
      const position=replaySimulator(events,at).find(p=>p.positionId===id);
      if(!position)throw new SimulatorInputError(404,'Posición no encontrada');
      if(position.remainingQuantity<request.quantity)throw new SimulatorInputError(409,'Cantidad superior a la posición abierta');
      validTime(request.decisionAtUtc,request.simulatedExitAtUtc,at);
      if(request.simulatedExitAtUtc<(lastEconomicAt(events,id)??''))
        throw new SimulatorInputError(409,'Salida fuera de secuencia causal');
      optionPremiumTotal(request.premiumPerShare,position.contract.multiplier,request.quantity);
      const reference=request.priceOrigin==='OBSERVED_BID_REFERENCE'?
        quoteReference(this.deps.quote(position.contract.conId),position.contract.conId,'bid',
          request.referencePrice??request.premiumPerShare,request.decisionAtUtc,at):null;
      if(request.priceOrigin==='OBSERVED_BID_REFERENCE'&&request.premiumPerShare!==request.referencePrice)
        throw new SimulatorInputError(409,'La prima debe coincidir con el BID copiado');
      const body:SimulatorEventBody={kind:request.quantity===position.remainingQuantity?
        'SIM_POSITION_CLOSED':'SIM_POSITION_PARTIALLY_CLOSED',payload:{quantity:request.quantity,
        premiumPerShare:request.premiumPerShare,exitFeeUsd:request.exitFeeUsd,
        decisionAtUtc:request.decisionAtUtc,simulatedExitAtUtc:request.simulatedExitAtUtc,
        reason:request.reason,priceOrigin:request.priceOrigin,fillStatus:'HYPOTHETICAL',quoteReference:reference}};
      return {positionId:id,simulationId:position.simulationId,body};
    });
    return {event,position:(await this.position(event.positionId)).position};
  }
  async note(id:string,raw:unknown){
    const request=SimulatorNoteRequest.parse(raw),fingerprint=simulatorHash(JSON.stringify({operation:'note',id,request}));
    return this.appendSimple(id,request.idempotencyKey,fingerprint,{kind:'SIM_POSITION_NOTE_ADDED',payload:{note:request.note}});
  }
  async plan(id:string,raw:unknown){
    const request=SimulatorPlanRequest.parse(raw),fingerprint=simulatorHash(JSON.stringify({operation:'plan',id,request}));
    const event=await this.deps.store.append(request.idempotencyKey,fingerprint,(events,at)=>{
      const position=replaySimulator(events,at).find(p=>p.positionId===id);
      if(!position)throw new SimulatorInputError(404,'Posición no encontrada');
      const opened=events.find(e=>e.positionId===id&&e.kind==='SIM_POSITION_OPENED');
      if(!opened||opened.kind!=='SIM_POSITION_OPENED')throw new SimulatorInputError(409,'Apertura no verificable');
      this.checkHuman(request.plan,opened.payload.lot.decisionAtUtc);
      return {positionId:id,simulationId:position.simulationId,
        body:{kind:'SIM_POSITION_PLAN_UPDATED' as const,payload:{plan:request.plan,reason:request.reason}}};
    });
    return {event,position:(await this.position(event.positionId)).position};
  }
  private async appendSimple(id:string,key:string,fingerprint:string,body:SimulatorEventBody){
    const event=await this.deps.store.append(key,fingerprint,(events,at)=>{
      const position=replaySimulator(events,at).find(p=>p.positionId===id);
      if(!position)throw new SimulatorInputError(404,'Posición no encontrada');
      return {positionId:id,simulationId:position.simulationId,body};
    });
    return {event,position:(await this.position(event.positionId)).position};
  }
}
