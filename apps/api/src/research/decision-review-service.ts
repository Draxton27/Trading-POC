import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {existsSync,readdirSync,statSync} from 'node:fs';
import {DecisionReviewCase as CaseSchema,DecisionReviewPage as PageSchema,
  type DecisionIdentity,type DecisionEvidence,type DecisionReviewCase,type TechnicalContextAtDecision,
  type HumanSignalComparison,type PostOutcomeReview,type MarketBar} from '@trading-poc/contracts';
import {replaySimulator,type SimulatorEvent} from '@trading-poc/market-domain';
import {verifyLedger,type LedgerRecord} from '../../../../trading_poc_001_bollinger/src/phase16-ledger.ts';
import {humanFromLedger,compareHumanToSignals,type ComparedHuman} from '../../../../trading_poc_001_bollinger/src/phase17-comparison.ts';
import {buildTradeCases,type TradeCase} from '../../../../trading_poc_001_bollinger/src/phase17-trade-review.ts';
import {readBrokerStore} from '../../../../trading_poc_001_bollinger/src/phase17-broker-store.ts';
import type {ForwardSignal} from '../../../../trading_poc_001_bollinger/src/phase16-engine.ts';
import {newYorkBarParts} from '../../../../trading_poc_001_bollinger/src/strategy-validation.ts';
import {loadMarketCalendar} from '../../../../trading_poc_001_bollinger/src/alpaca-calendar.ts';
import {buildInvestepScenarios} from '../../../../trading_poc_001_bollinger/src/phase41k-scenarios.ts';
import {buildDecisionReviewCase,type ModelCandidate,summarizeDecisionReviews} from '../../../../trading_poc_001_bollinger/src/phase41n-decision-review.ts';
import {readIexProspective,type IexProspectivePaths} from '../ml/iex-prospective-reader.ts';
import {technicalContextFor,type TechnicalContextDeps} from '../technical-context/routes.ts';
import {analyzeMarketBars} from '../assistant/analysis.ts';
import {SimulatorStore} from '../simulator/store.ts';

type SourceState='NO_DECISIONS'|'PARTIAL_EVIDENCE'|'AVAILABLE'|'INVALID_SOURCE'|'UNAVAILABLE';
type ReviewSource='F17'|'F16'|'F41M'|'F41I'|'F41K'|'BROKER';
export type ReviewSources=Record<ReviewSource,SourceState>;
export type DecisionReviewDeps={mode:'DEMO'|'OFFLINE'|'PAPER';phase17Private:string;phase16Ledger:string;
  simulatorStore:SimulatorStore;iexPaths:IexProspectivePaths;technicalDeps:TechnicalContextDeps;clock?:()=>number};
const sha=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const before=(time:string,cutoff:string)=>Date.parse(time)<=Date.parse(cutoff);
const bounded=(value:string|null|undefined)=>value?.slice(0,1000)??null;
const initialStates=():ReviewSources=>({F17:'UNAVAILABLE',F16:'UNAVAILABLE',F41M:'UNAVAILABLE',F41I:'UNAVAILABLE',F41K:'UNAVAILABLE',BROKER:'UNAVAILABLE'});
const boundedLedger=(directory:string)=>{
  if(!existsSync(directory))return;
  const files=readdirSync(directory).filter(name=>/^\d{8}\.json$/.test(name));
  if(files.length>5000||files.some(name=>statSync(resolve(directory,name)).size>64*1024))
    throw new Error('Ledger fuera del límite de lectura');
};
const emptyEvidence=(id:string,hash:string,time:string,source:string,recorded:string|null,status:DecisionEvidence['verificationStatus']):DecisionEvidence=>({
  id,source,sourceIds:[id],sourceHashes:[hash],eventAtUtc:time,availableAtUtc:time,
  recordedAtUtc:recorded,verificationStatus:status,knownAtDecision:false,limitations:[]});
type ReviewRaw={decision:DecisionIdentity;human:ComparedHuman|null;ledger:LedgerRecord|null;
  simulatorEvent:SimulatorEvent|null;trade:TradeCase|null;positionId:string|null;limitations:string[]};

export class DecisionReviewService{
  constructor(readonly deps:DecisionReviewDeps){}
  private technical(decision:DecisionIdentity,allBars:MarketBar[]|null):TechnicalContextAtDecision|null{
    if(this.deps.mode==='DEMO'||!allBars?.length)return null;
    const cutoff=decision.decisionAtUtc;
    const bars=allBars.filter(bar=>bar.isComplete&&before(bar.endUtc,cutoff)&&
      (bar.receivedAtUtc===null||before(bar.receivedAtUtc,cutoff))).slice(-8000);
    if(!bars.length)return null;
    if(bars.some(bar=>bar.receivedAtUtc!==null&&
      Date.parse(bar.receivedAtUtc)<Date.parse(bar.endUtc)))
      throw new Error('Recepción anterior al cierre físico de una vela');
    const context=technicalContextFor(this.deps.technicalDeps,'NVDA',cutoff,bars);
    const receiptVerified=bars.every(bar=>bar.receivedAtUtc!==null);
    const lastEnd=context.timeframes['15m'].lastCompleteBarUtc;
    const dataAvailableAtUtc=receiptVerified&&lastEnd?new Date(Math.max(...bars.filter(bar=>
      bar.isComplete&&before(bar.endUtc,lastEnd)).map(bar=>Date.parse(bar.receivedAtUtc!)))).toISOString():null;
    const analysis=analyzeMarketBars('NVDA',context.source,context.historicalOrSynthetic,bars,cutoff,
      this.deps.technicalDeps.calendarFor('NVDA'));
    const metrics=analysis.dateUtc===lastEnd?analysis.metrics:null;
    const scenarios=buildInvestepScenarios(context,metrics,receiptVerified,dataAvailableAtUtc);
    const selected=[...scenarios.current,...scenarios.historical].filter(item=>before(item.eventAtUtc,cutoff)&&
      (item.availableAtUtc===null||before(item.availableAtUtc,cutoff))).slice(0,40);
    const state:DecisionEvidence['verificationStatus']=receiptVerified?'CAUSALLY_RECONSTRUCTED':'HISTORICAL_ONLY';
    const evidence:DecisionEvidence={id:sha(['41K',cutoff,bars.map(b=>b.startUtc)]),source:`41K ${context.provider} ${context.feed}`,
      sourceIds:selected.map(s=>s.id).slice(0,20),sourceHashes:[sha(bars)],eventAtUtc:lastEnd,
      availableAtUtc:dataAvailableAtUtc,recordedAtUtc:dataAvailableAtUtc,
      verificationStatus:state,knownAtDecision:receiptVerified&&dataAvailableAtUtc!==null&&before(dataAvailableAtUtc,cutoff),
      limitations:receiptVerified?['Reconstrucción al corte a partir de velas con recepción conocida; no prueba que el operador la haya observado.']:
        ['La recepción contemporánea de las velas SIP históricas no está verificada. Contexto solo retrospectivo.']};
    return {evidence,alignment:scenarios.alignment,sourceFeed:context.feed,adjustment:context.adjustment,
      scenarioIds:selected.map(s=>s.id),scenarios:selected.map(s=>({id:s.id,family:s.family,timeframe:s.timeframe,
        direction:s.direction,state:s.state,period:s.period,eventAtUtc:s.eventAtUtc,availableAtUtc:s.availableAtUtc,
        confirmations:s.confirmations.length,contradictions:s.contradictions.length})),
      frames:(['15m','1h','1d'] as const).map(timeframe=>{const frame=scenarios.frames[timeframe];return {
        timeframe,barEndUtc:frame.barEndUtc,shortPair:frame.shortPair,longPair:frame.longPair,state:frame.state,
        sma20:frame.smas[20].value,sma40:frame.smas[40].value,sma100:frame.smas[100].value,
        sma200:frame.smas[200].value};}),
      bollingerPosition:selected.find(s=>s.family==='BOLLINGER_VOLUME_CONTEXT')?.bollingerVolume?.position??null};
  }
  private humanSignal(human:ComparedHuman,signals:LedgerRecord[]):HumanSignalComparison{
    const cutoff=human.decision.decisionAtUtc;
    const available=signals.filter(row=>row.kind==='signal'&&before(row.recordedAtUtc,cutoff))
      .filter(row=>{const signal=row.payload as unknown as ForwardSignal;
        return before(signal.availableAtUtc,cutoff)&&before(signal.firstDetectedAtUtc,cutoff);});
    const rows=compareHumanToSignals(available.map(row=>row.payload as unknown as ForwardSignal),[human]);
    const match=rows.filter(row=>row.humanDecisionId===human.id)
      .sort((a,b)=>Number(b.status==='explicit_rejection'||b.status==='both')-
        Number(a.status==='explicit_rejection'||a.status==='both'))[0];
    const matched=available.find(row=>(row.payload as unknown as ForwardSignal).id===match?.signalId);
    const signal=matched?.payload as ForwardSignal|undefined;
    return {status:match?.status??'insufficient',reason:bounded(match?.reason)??'Sin cobertura de F16 verificable.',
      signals:matched&&signal?[{evidence:{id:signal.id,source:'F16 señal congelada',sourceIds:[matched.id],
        sourceHashes:[matched.hash],eventAtUtc:signal.barStartUtc,availableAtUtc:signal.availableAtUtc,
        recordedAtUtc:matched.recordedAtUtc,verificationStatus:'VERIFIED_AVAILABLE',knownAtDecision:true,
        limitations:['La coincidencia F16 usa la ventana propia de ±15 minutos.']},
        family:signal.family,direction:signal.direction}]:[]};
  }
  private laterTechnical(decision:DecisionIdentity,allBars:MarketBar[]|null,now:string):PostOutcomeReview['technicalLater']{
    if(this.deps.mode==='DEMO'||!allBars?.length)return [];
    const day=newYorkBarParts(decision.decisionAtUtc).day;
    const later=allBars.filter(bar=>bar.isComplete&&newYorkBarParts(bar.startUtc).day===day&&
      Date.parse(bar.endUtc)>Date.parse(decision.decisionAtUtc)&&before(bar.endUtc,now)&&
      (bar.receivedAtUtc===null||before(bar.receivedAtUtc,now)));
    if(!later.length)return [];
    const followupAt=later.at(-1)!.endUtc;
    const available=allBars.filter(bar=>bar.isComplete&&before(bar.endUtc,followupAt)&&
      (bar.receivedAtUtc===null||before(bar.receivedAtUtc,now))).slice(-8000);
    const context=technicalContextFor(this.deps.technicalDeps,'NVDA',followupAt,available);
    const scenarios=buildInvestepScenarios(context,null,false,null);
    return [...scenarios.current,...scenarios.historical]
      .filter(item=>Date.parse(item.eventAtUtc)>Date.parse(decision.decisionAtUtc)&&before(item.eventAtUtc,followupAt))
      .slice(0,40).map(item=>({scenarioId:item.id,state:item.state,eventAtUtc:item.eventAtUtc}));
  }
  async read(){
    const now=new Date((this.deps.clock??Date.now)()).toISOString(),sourceStatus=initialStates();
    const demo=this.deps.mode==='DEMO';
    let humans:LedgerRecord[]=[];if(!demo)try{const path=resolve(this.deps.phase17Private,'ledger');boundedLedger(path);
      humans=verifyLedger(path);
      sourceStatus.F17=humans.some(r=>r.kind==='human_decision')?'AVAILABLE':'NO_DECISIONS';}
    catch{sourceStatus.F17='INVALID_SOURCE';}
    let signals:LedgerRecord[]=[];if(!demo)try{boundedLedger(this.deps.phase16Ledger);
      signals=verifyLedger(this.deps.phase16Ledger);
      sourceStatus.F16=signals.some(r=>r.kind==='signal')?'AVAILABLE':'UNAVAILABLE';}
    catch{sourceStatus.F16='INVALID_SOURCE';}
    let simulator:SimulatorEvent[]=[];let positions:ReturnType<typeof replaySimulator>=[];
    try{simulator=await this.deps.simulatorStore.read();
      positions=replaySimulator(simulator,now);
      sourceStatus.F41M=simulator.some(e=>e.kind==='SIM_POSITION_OPENED')?'AVAILABLE':'NO_DECISIONS';}
    catch{simulator=[];positions=[];sourceStatus.F41M='INVALID_SOURCE';}
    let trades:TradeCase[]=[];if(!demo)try{const broker=readBrokerStore(this.deps.phase17Private);
      trades=buildTradeCases(humans,broker,signals.filter(r=>r.kind==='signal').map(r=>r.payload as unknown as ForwardSignal));
      sourceStatus.BROKER=broker.sourceFiles.length?'AVAILABLE':'UNAVAILABLE';}
    catch{sourceStatus.BROKER='INVALID_SOURCE';}
    const projection=demo?null:readIexProspective(this.deps.iexPaths);
    sourceStatus.F41I=projection?.overview.status==='READY'?'AVAILABLE':
      projection?.overview.status==='INVALID_ARTIFACT'?'INVALID_SOURCE':'UNAVAILABLE';
    const models:ModelCandidate[]=sourceStatus.F41I==='AVAILABLE'&&projection?projection.items.flatMap(prediction=>{
      const detail=projection.details.get(prediction.predictionId);return detail?[{prediction,detail}]:[];}):[];
    let sessionDate=(_utc:string):string|null=>null;
    if(sourceStatus.F41I==='AVAILABLE'){
      try{const calendar=loadMarketCalendar(this.deps.iexPaths.calendar);
        sessionDate=(utc:string)=>{const {day,slot}=newYorkBarParts(utc),session=calendar.get(day);
          const [hour,minute]=slot.split(':').map(Number),local=hour!*60+minute!;
          return session&&local>=session.open&&local<=session.close?day:null;};}
      catch{sourceStatus.F41I='INVALID_SOURCE';}
    }
    const modelsBySession=new Map<string,ModelCandidate[]>();
    if(sourceStatus.F41I==='AVAILABLE')for(const model of models){
      const session=model.prediction.sessionDateNy,items=modelsBySession.get(session)??[];
      items.push(model);modelsBySession.set(session,items);
    }
    let bars:MarketBar[]|null=null;
    if(!demo)try{bars=this.deps.technicalDeps.barsFor('NVDA');
      const metadata=this.deps.technicalDeps.metadataFor('NVDA'),calendar=this.deps.technicalDeps.calendarFor('NVDA');
      sourceStatus.F41K=!bars.length||!calendar?'UNAVAILABLE':metadata.asset==='NVDA'&&
        metadata.provider==='Alpaca Market Data API'&&metadata.feed==='sip'&&metadata.adjustment==='split'&&
        metadata.session==='regular'&&metadata.bar_minutes===15&&metadata.data_class==='real'&&
        metadata.exchange_timezone==='America/New_York'?'AVAILABLE':'INVALID_SOURCE';}
    catch{sourceStatus.F41K='UNAVAILABLE';}
    if(sourceStatus.F41K!=='AVAILABLE')bars=null;
    const primary=humanFromLedger(humans).filter(h=>!h.phase17.relatedDecisionId&&h.decision.symbol==='NVDA');
    const humanIds=new Set(primary.map(h=>h.id));
    const raw:ReviewRaw[]=[];
    for(const h of primary){const ledger=humans.find(r=>r.id===h.id)??null;
      raw.push({decision:{id:`F17:${h.id}`,origin:'F17_HUMAN',sourceId:h.id,linkedHumanDecisionId:null,
        symbol:'NVDA',decisionAtUtc:h.decision.decisionAtUtc,documentedAtUtc:h.decision.documentedAtUtc,
        classification:h.recordClass,direction:h.decision.direction,operationType:h.decision.operationType,
        contractOccSymbol:h.phase17.contractOccSymbol,positionId:null,simulationId:null,simulatedEntryAtUtc:null,
        contract:null,plan:null,quoteReference:null,quantity:null,premiumPerShare:null,priceOrigin:null,
        chartCaptureId:h.decision.chartCaptureId&&h.phase17.chartCapturedAtUtc&&
          before(h.phase17.chartCapturedAtUtc,h.decision.decisionAtUtc)?h.decision.chartCaptureId:null,
        chartCapturedAtUtc:h.phase17.chartCapturedAtUtc&&before(h.phase17.chartCapturedAtUtc,h.decision.decisionAtUtc)?
          h.phase17.chartCapturedAtUtc:null,
        reason:bounded(h.decision.selectionReason),recordClass:h.recordClass,observedMarket:h.decision.observedMarket,
        contextKnownAtUtc:h.phase17.contextKnownAtUtc,sourceIds:[h.id],sourceHashes:ledger?[ledger.hash]:[]},
        human:h,ledger,simulatorEvent:null,trade:trades.find(t=>t.decisionId===h.id)??null,positionId:null,limitations:[]});}
    const opened=new Map(simulator.filter(e=>e.kind==='SIM_POSITION_OPENED').map(e=>[e.positionId,e]));
    for(const event of simulator){
      if(event.kind!=='SIM_POSITION_OPENED'&&event.kind!=='SIM_POSITION_LOT_ADDED')continue;
      const parent=opened.get(event.positionId);
      if(!parent||parent.kind!=='SIM_POSITION_OPENED')continue;
      const lot=event.payload.lot,link=parent.payload.plan.humanDecisionId??null;
      const validLink=link&&humanIds.has(link)&&primary.some(h=>h.id===link&&
        before(h.decision.documentedAtUtc,lot.decisionAtUtc))?link:null;
      const classified=event.kind==='SIM_POSITION_OPENED'?parent.payload.classification:
        Date.parse(event.recordedAtUtc)-Date.parse(lot.decisionAtUtc)<=60_000&&
        Date.parse(event.recordedAtUtc)-Date.parse(lot.simulatedEntryAtUtc)<=60_000?
          'DOCUMENTED_ON_TIME':'HISTORICAL_SIMULATION';
      raw.push({decision:{id:`F41M:${event.simulationEventId}`,origin:'F41M_SIMULATOR',sourceId:event.simulationEventId,
        linkedHumanDecisionId:validLink,symbol:'NVDA',decisionAtUtc:lot.decisionAtUtc,
        documentedAtUtc:event.recordedAtUtc,classification:classified,direction:parent.payload.contract.right,
        operationType:'HYPOTHETICAL_LONG_OPTION',contractOccSymbol:parent.payload.contract.occSymbol,
        positionId:event.positionId,simulationId:event.simulationId,simulatedEntryAtUtc:lot.simulatedEntryAtUtc,
        contract:parent.payload.contract,plan:parent.payload.plan,quoteReference:lot.quoteReference,
        chartCaptureId:null,chartCapturedAtUtc:null,
        quantity:lot.quantity,premiumPerShare:lot.premiumPerShare,priceOrigin:lot.priceOrigin,
        reason:bounded(event.kind==='SIM_POSITION_OPENED'?parent.payload.plan.entryReason:lot.entryReason),
        recordClass:null,observedMarket:null,contextKnownAtUtc:null,
        sourceIds:[event.simulationEventId,lot.lotId],sourceHashes:[event.hash]},
        human:null,ledger:null,simulatorEvent:event,trade:null,positionId:event.positionId,
        limitations:link&&!validLink?['El humanDecisionId declarado no se vinculó: falta el registro F17 anterior correspondiente.']:[]});
    }
    if(raw.length>1000)throw new Error('Demasiadas decisiones para una revisión acotada');
    const cases:DecisionReviewCase[]=[];
    for(const entry of raw){
      const d=entry.decision,cutoff=d.decisionAtUtc;
      let technical:TechnicalContextAtDecision|null=null;
      if(bars){try{technical=this.technical(d,bars);}catch{sourceStatus.F41K='PARTIAL_EVIDENCE';}}
      const contextAt=entry.human?.phase17.contextKnownAtUtc;
      const humanContext=entry.ledger&&contextAt&&before(contextAt,cutoff)?
        emptyEvidence(entry.ledger.id,entry.ledger.hash,contextAt,'F17 declaración del operador',
          entry.ledger.recordedAtUtc,'SELF_REPORTED_UNVERIFIED'):null;
      const signalComparison=entry.human&&sourceStatus.F16==='AVAILABLE'?this.humanSignal(entry.human,signals):null;
      const position=positions.find(p=>p.positionId===entry.positionId);
      const trade:PostOutcomeReview['tradeOutcome']=entry.trade?.positionId?{
        source:'F17_BROKER_LINKED',scope:'DECISION_LINKED',positionId:entry.trade.positionId,status:entry.trade.status,
        initialQuantity:entry.trade.boughtQuantity,closedQuantity:entry.trade.soldQuantity,
        remainingQuantity:entry.trade.remainingQuantity,exitPremiumsPerShare:[],realizedGrossUsd:entry.trade.realizedGross,
        realizedNetUsd:entry.trade.realizedNet,knownCommissionUsd:entry.trade.realizedCommission,
        sourceIds:entry.trade.linkedExecutionIds.slice(0,100),sourceHashes:Object.values(entry.trade.sourceHashesByExecution).flat().slice(0,100)}:
        position?{source:'F41M_HYPOTHETICAL',scope:'POSITION_AGGREGATE',positionId:position.positionId,
          status:position.status,initialQuantity:position.initialQuantity,closedQuantity:position.closedQuantity,
          remainingQuantity:position.remainingQuantity,exitPremiumsPerShare:simulator.filter(e=>e.positionId===position.positionId)
            .flatMap(e=>e.kind==='SIM_POSITION_CLOSED'||e.kind==='SIM_POSITION_PARTIALLY_CLOSED'?
              [e.payload.premiumPerShare]:[]).slice(0,100),realizedGrossUsd:position.realizedGrossPnlUsd,
          realizedNetUsd:position.realizedNetPnlUsd,knownCommissionUsd:position.feesCompleteForRealized?
            position.knownEntryFeesAllocatedUsd+position.knownExitFeesUsd:null,
          sourceIds:simulator.filter(e=>e.positionId===position.positionId).map(e=>e.simulationEventId).slice(0,100),
          sourceHashes:simulator.filter(e=>e.positionId===position.positionId).map(e=>e.hash).slice(0,100)}:null;
      const notes:PostOutcomeReview['laterNotes']=entry.human?[...humans.filter(r=>r.kind==='human_decision'&&
        (r.payload.phase17 as {relatedDecisionId?:string}|undefined)?.relatedDecisionId===entry.human!.id&&
        !before(r.recordedAtUtc,cutoff)).map(r=>({id:r.id,recordedAtUtc:r.recordedAtUtc,
          kind:'F17_ANNOTATION',detail:bounded((r.payload.phase17 as {exitReason?:string;planChangeReason?:string})
            ?.exitReason||(r.payload.phase17 as {planChangeReason?:string})?.planChangeReason)??
            'Anotación o actualización posterior'})),
        ...(entry.human.decision.chartCaptureId&&entry.human.phase17.chartCapturedAtUtc&&
          !before(entry.human.phase17.chartCapturedAtUtc,cutoff)?[{id:entry.human.decision.chartCaptureId,
            recordedAtUtc:entry.ledger?.recordedAtUtc??entry.human.decision.documentedAtUtc,
            kind:'F17_CHART_CAPTURE',detail:'Captura posterior a la decisión; no forma parte del contexto inicial.'}]:[])]:
        simulator.filter(e=>e.positionId===entry.positionId&&!before(e.recordedAtUtc,cutoff)&&
          (e.kind==='SIM_POSITION_NOTE_ADDED'||e.kind==='SIM_POSITION_PLAN_UPDATED'))
          .map(e=>({id:e.simulationEventId,recordedAtUtc:e.recordedAtUtc,kind:e.kind,
            detail:bounded(e.kind==='SIM_POSITION_NOTE_ADDED'?e.payload.note:
              e.kind==='SIM_POSITION_PLAN_UPDATED'?e.payload.reason:null)??
              'Actualización posterior del simulador'}));
      let technicalLater:PostOutcomeReview['technicalLater']=[];
      if(bars){try{technicalLater=this.laterTechnical(d,bars,now);}catch{sourceStatus.F41K='PARTIAL_EVIDENCE';}}
      const result=buildDecisionReviewCase({decision:d,
        models:modelsBySession.get(sessionDate(cutoff)??'')??[],sessionDate,
        technical,signalComparison,humanContext,tradeOutcome:trade,laterNotes:notes,
        technicalLater,reviewGeneratedAtUtc:now});
      cases.push(CaseSchema.parse({...result,limitations:[...result.limitations,...entry.limitations]}));
    }
    cases.sort((a,b)=>b.decisionTimeView.decision.decisionAtUtc.localeCompare(a.decisionTimeView.decision.decisionAtUtc)||
      a.id.localeCompare(b.id));
    return {cases,sourceStatus,now,summary:summarizeDecisionReviews(cases,sourceStatus,now)};
  }
  async summary(){return (await this.read()).summary;}
  async page(filters:{from?:string;to?:string;source?:'F17_HUMAN'|'F41M_SIMULATOR';classification?:string;
    hasPrediction?:boolean;hasTechnicalContext?:boolean;outcomeStatus?:string;offset:number;limit:number}){
    const data=await this.read();
    const all=data.cases.filter(c=>{const d=c.decisionTimeView.decision;
      return (!filters.from||d.decisionAtUtc.slice(0,10)>=filters.from)&&
        (!filters.to||d.decisionAtUtc.slice(0,10)<=filters.to)&&(!filters.source||d.origin===filters.source)&&
        (!filters.classification||d.classification===filters.classification)&&
        (filters.hasPrediction===undefined||!!c.decisionTimeView.model===filters.hasPrediction)&&
        (filters.hasTechnicalContext===undefined||!!c.decisionTimeView.technical===filters.hasTechnicalContext)&&
        (!filters.outcomeStatus||c.postOutcomeReview.tradeOutcome?.status===filters.outcomeStatus||
          c.postOutcomeReview.modelOutcome?.status===filters.outcomeStatus);});
    const page=all.slice(filters.offset,filters.offset+filters.limit);
    return PageSchema.parse({status:data.summary.status,items:page.map(c=>({id:c.id,
      origin:c.decisionTimeView.decision.origin,decisionAtUtc:c.decisionTimeView.decision.decisionAtUtc,
      documentedAtUtc:c.decisionTimeView.decision.documentedAtUtc,
      classification:c.decisionTimeView.decision.classification,direction:c.decisionTimeView.decision.direction,
      technicalStatus:c.decisionTimeView.technical?.evidence.verificationStatus??'UNAVAILABLE',
      predictionMatch:c.decisionTimeView.predictionMatch,
      outcomeStatus:c.postOutcomeReview.tradeOutcome?.status??c.postOutcomeReview.modelOutcome?.status??'UNAVAILABLE',
      linkedHumanDecisionId:c.decisionTimeView.decision.linkedHumanDecisionId})),total:all.length,
      offset:filters.offset,limit:filters.limit,nextOffset:filters.offset+filters.limit<all.length?
        filters.offset+filters.limit:null,sourceStatus:data.sourceStatus});
  }
  async detail(id:string){return (await this.read()).cases.find(c=>c.id===id)??null;}
}
