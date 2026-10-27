import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {IexProspectivePrediction,IexProspectiveDetail,DecisionReviewCase,DecisionReviewSummary,
  type DecisionIdentity,type TechnicalContextAtDecision} from '@trading-poc/contracts';
import {buildDecisionReviewCase,selectModelAtDecision,summarizeDecisionReviews} from '../../trading_poc_001_bollinger/src/phase41n-decision-review.ts';
import {DecisionReviewService} from '../../apps/api/src/research/decision-review-service.ts';
import {SimulatorStore} from '../../apps/api/src/simulator/store.ts';
import {SimulatorService} from '../../apps/api/src/simulator/service.ts';
import {createApp} from '../../apps/api/src/server.ts';
import {appendPhase17Decision,PHASE17_TEMPLATE_COLUMNS} from '../../trading_poc_001_bollinger/src/phase17-journal.ts';
import {appendRecord} from '../../trading_poc_001_bollinger/src/phase16-ledger.ts';
import {csvCell} from '../../trading_poc_001_bollinger/src/phase17-csv.ts';
import {newYorkBarParts} from '../../trading_poc_001_bollinger/src/strategy-validation.ts';

const hash='a'.repeat(64),other='b'.repeat(64),third='c'.repeat(64);
const decisionAt='2026-10-21T15:10:00.000Z',barEnd='2026-10-21T15:00:00.000Z';
const classes={ALCISTA:.5,BAJISTA:.3,LATERAL:.2};
const decision=(changes:Partial<DecisionIdentity>={}):DecisionIdentity=>({id:'F17:human-1',origin:'F17_HUMAN',
  sourceId:'human-1',linkedHumanDecisionId:null,symbol:'NVDA',decisionAtUtc:decisionAt,
  documentedAtUtc:'2026-10-21T15:09:00.000Z',classification:'live_before_primary_outcome',
  direction:'bullish',operationType:'pullback',contractOccSymbol:null,quantity:null,premiumPerShare:null,
  positionId:null,simulationId:null,simulatedEntryAtUtc:null,contract:null,plan:null,quoteReference:null,
  chartCaptureId:null,chartCapturedAtUtc:null,
  priceOrigin:null,reason:'fixture controlada',recordClass:'live_before_primary_outcome',observedMarket:true,
  contextKnownAtUtc:null,sourceIds:['human-1'],sourceHashes:[hash],...changes});
const prediction=(changes:Record<string,unknown>={})=>IexProspectivePrediction.parse({
  predictionId:hash,sessionDateNy:'2026-10-21',barStartUtc:'2026-10-21T14:45:00.000Z',
  barEndUtc:barEnd,receivedAtUtc:'2026-10-21T15:01:00.000Z',registeredAtUtc:'2026-10-21T15:05:00.000Z',
  entryAtUtc:'2026-10-21T15:15:00.000Z',outcomeAtUtc:'2026-10-21T16:15:00.000Z',
  modelSha256:other,protocolSha256:third,probabilities:{xgboost:classes,linear:classes,frequency:classes},
  dominantClass:'ALCISTA',evaluationStatus:'EVALUATED',actualClass:'BAJISTA',
  evaluatedAtUtc:'2026-10-21T16:35:00.000Z',entryOpen:100,outcomeClose:99,movementAtr:-.6,
  matches:{xgboost:false,linear:false,frequency:false},...changes});
const candidate=(changes:Record<string,unknown>={})=>{const p=prediction(changes);
  return {prediction:p,detail:IexProspectiveDetail.parse({...p,predictionRecordHash:hash,featureHash:other,
    atr14PriceUnits:2,sourceBarCount:1,sourceBars:[{startUtc:p.barStartUtc,
      receivedAtUtc:p.receivedAtUtc,recordHash:third,origin:'LIVE'}]})};};
const session=(utc:string)=>utc.startsWith('2026-10-21T')?'2026-10-21':null;
const technical=(changes:Partial<TechnicalContextAtDecision>={}):TechnicalContextAtDecision=>({
  evidence:{id:third,source:'41K SIP split',sourceIds:[third],sourceHashes:[hash],
    eventAtUtc:barEnd,availableAtUtc:null,recordedAtUtc:null,
    verificationStatus:'HISTORICAL_ONLY',knownAtDecision:false,limitations:['Recepción no verificable']},
  alignment:'ALIGNED_BULLISH',sourceFeed:'sip',adjustment:'split',scenarioIds:[third],
  scenarios:[{id:third,family:'SMA_STRUCTURE_BREAK',timeframe:'15m',direction:'ABOVE',state:'OBSERVED',period:20,
    eventAtUtc:barEnd,availableAtUtc:null,confirmations:1,contradictions:0}],
  frames:(['15m','1h','1d'] as const).map(timeframe=>({timeframe,barEndUtc:barEnd,
    shortPair:'BULLISH_ALIGNMENT',longPair:'BULLISH_ALIGNMENT',state:'BULLISH_ALIGNMENT',
    sma20:100,sma40:99,sma100:98,sma200:97})),bollingerPosition:'INSIDE',...changes});
const input=(changes:Record<string,unknown>={})=>({decision:decision(),models:[candidate()],sessionDate:session,
  technical:technical(),signalComparison:null,humanContext:null,tradeOutcome:null,laterNotes:[],technicalLater:[],
  reviewGeneratedAtUtc:'2026-10-21T18:00:00.000Z',...changes});
const dirs:string[]=[];
afterEach(()=>{for(const path of dirs.splice(0))rmSync(path,{recursive:true,force:true});});
const temp=()=>{const path=mkdtempSync(join(tmpdir(),'decision41n-'));dirs.push(path);return path;};
const reviewService=(path:string,store=new SimulatorStore(join(path,'simulator')))=>new DecisionReviewService({
  mode:'PAPER',phase17Private:join(path,'f17'),phase16Ledger:join(path,'f16'),simulatorStore:store,
  iexPaths:{protocolDir:join(path,'missing-protocol'),modelDir:join(path,'missing-model'),
    observationLog:join(path,'missing-observation'),iexLog:join(path,'missing-iex'),
    calendar:join(path,'missing-calendar'),reportDir:join(path,'missing-report')},
  technicalDeps:{mode:'PAPER',barsFor:()=>[],metadataFor:()=>{throw new Error('No CSV');},
    calendarFor:()=>null}});

describe('41N: asociación causal y vistas separadas',()=>{
  it('asocia última predicción registrada en misma sesión, con desempate estable',()=>{
    const a=candidate(),b=candidate({predictionId:other});
    expect(selectModelAtDecision([b,a],decisionAt,session)?.prediction.predictionId).toBe(hash);
    const c=candidate({predictionId:third,registeredAtUtc:'2026-10-21T15:06:00.000Z'});
    expect(selectModelAtDecision([a,c],decisionAt,session)?.prediction.predictionId).toBe(third);
  });
  it.each([
    ['registro futuro',{registeredAtUtc:'2026-10-21T15:11:00.000Z'}],
    ['vela futura',{barStartUtc:'2026-10-21T15:00:00.000Z',barEndUtc:'2026-10-21T15:15:00.000Z'}],
    ['recepción posterior al registro',{receivedAtUtc:'2026-10-21T15:06:00.000Z'}],
    ['sesión distinta',{sessionDateNy:'2026-10-20'}],
    ['más de quince minutos',{registeredAtUtc:'2026-10-21T14:54:59.000Z',receivedAtUtc:'2026-10-21T14:54:00.000Z'}],
  ])('rechaza %s',(_label,changes)=>{
    expect(selectModelAtDecision([candidate(changes)],decisionAt,session)).toBeNull();
  });
  it('incluye el límite exacto de 15 minutos y corta en cierre de sesión',()=>{
    expect(selectModelAtDecision([candidate({registeredAtUtc:'2026-10-21T14:55:00.000Z',
      receivedAtUtc:'2026-10-21T14:54:00.000Z'})],decisionAt,session)).not.toBeNull();
    expect(selectModelAtDecision([candidate()],decisionAt,()=>null)).toBeNull();
  });
  it('rechaza modelo o protocolo que no coinciden entre proyección y detalle',()=>{
    const p=candidate(),otherModel={...p,detail:{...p.detail,modelSha256:third}};
    const otherProtocol={...p,detail:{...p.detail,protocolSha256:hash}};
    expect(selectModelAtDecision([otherModel],decisionAt,session)).toBeNull();
    expect(selectModelAtDecision([otherProtocol],decisionAt,session)).toBeNull();
  });
  it('usa sesión de Nueva York tras cambios EDT/EST y excluye festivos',()=>{
    expect(newYorkBarParts('2026-03-06T14:30:00.000Z').slot).toBe('09:30');
    expect(newYorkBarParts('2026-03-09T13:30:00.000Z').slot).toBe('09:30');
    expect(newYorkBarParts('2026-10-30T13:30:00.000Z').slot).toBe('09:30');
    expect(newYorkBarParts('2026-11-02T14:30:00.000Z').slot).toBe('09:30');
    const official=(utc:string)=>{const day=newYorkBarParts(utc).day;return day==='2026-10-21'?day:null;};
    expect(selectModelAtDecision([candidate()],decisionAt,official)).not.toBeNull();
    expect(selectModelAtDecision([candidate()],decisionAt,()=>null)).toBeNull();
  });
  it('no filtra resultados, anotaciones ni revisiones posteriores hacia la vista al decidir',()=>{
    const c=buildDecisionReviewCase(input({technicalLater:[{scenarioId:hash,state:'FAILED',
      eventAtUtc:'2026-10-21T16:00:00.000Z'}],
      laterNotes:[{id:'note',recordedAtUtc:'2026-10-21T17:00:00.000Z',kind:'F17_ANNOTATION',detail:'resultado posterior'}]}));
    expect(c.decisionTimeView.model?.probabilities.xgboost).toEqual(classes);
    expect(c.decisionTimeView.model?.evidence.knownAtDecision).toBe(true);
    expect(c.postOutcomeReview.modelOutcome?.actualClass).toBe('BAJISTA');
    expect(c.postOutcomeReview.technicalLater).toHaveLength(1);
    expect(c.postOutcomeReview.laterNotes).toHaveLength(1);
    expect(JSON.stringify(c.decisionTimeView)).not.toContain('resultado posterior');
    expect(JSON.stringify(c.decisionTimeView)).not.toContain('movementAtr');
    expect(JSON.stringify(c.decisionTimeView)).not.toContain('evaluatedAtUtc');
  });
  it('la reconstrucción SIP sin recepción se etiqueta histórica y no verificada',()=>{
    const c=buildDecisionReviewCase(input());
    expect(c.decisionTimeView.technical?.evidence.verificationStatus).toBe('HISTORICAL_ONLY');
    expect(c.decisionTimeView.technical?.evidence.knownAtDecision).toBe(false);
    expect(c.decisionTimeView.agreements.find(a=>a.left==='F41K contexto')?.state).toBe('INDETERMINATE');
  });
  it('elimina escenarios posteriores y contexto con recepción después de decidir',()=>{
    const t=technical({scenarios:[...technical().scenarios,{...technical().scenarios[0]!,id:hash,
      eventAtUtc:'2026-10-21T15:15:00.000Z'}]});
    expect(buildDecisionReviewCase(input({technical:t})).decisionTimeView.technical?.scenarios).toHaveLength(1);
    const late=technical({evidence:{...technical().evidence,verificationStatus:'CAUSALLY_RECONSTRUCTED',
      availableAtUtc:'2026-10-21T15:11:00.000Z',recordedAtUtc:'2026-10-21T15:11:00.000Z',knownAtDecision:true}});
    expect(buildDecisionReviewCase(input({technical:late})).decisionTimeView.technical).toBeNull();
  });
  it('oculta SMA de temporalidad superior que no había cerrado al decidir',()=>{
    const t=technical({frames:[...technical().frames.slice(0,2),
      {...technical().frames[2]!,barEndUtc:'2026-10-21T20:00:00.000Z'}]});
    const frame=buildDecisionReviewCase(input({technical:t})).decisionTimeView.technical?.frames[2];
    expect(frame?.barEndUtc).toBeNull();expect(frame?.sma200).toBeNull();
    expect(frame?.state).toBe('INSUFFICIENT_DATA');
  });
  it('escenario causal exige su propia hora de disponibilidad, no solo hora del evento',()=>{
    const t=technical({evidence:{...technical().evidence,verificationStatus:'CAUSALLY_RECONSTRUCTED',
      availableAtUtc:'2026-10-21T15:05:00.000Z',recordedAtUtc:'2026-10-21T15:05:00.000Z',knownAtDecision:true},
      scenarios:[{...technical().scenarios[0]!,availableAtUtc:'2026-10-21T15:11:00.000Z'}]});
    const c=buildDecisionReviewCase(input({technical:t}));
    expect(c.decisionTimeView.technical?.scenarios).toEqual([]);
    expect(c.decisionTimeView.technical?.evidence.verificationStatus).toBe('CAUSALLY_RECONSTRUCTED');
  });
  it('alineación 41K y XGBoost solo produce relación descriptiva, sin puntuación',()=>{
    const t=technical({evidence:{...technical().evidence,verificationStatus:'CAUSALLY_RECONSTRUCTED',
      availableAtUtc:'2026-10-21T15:05:00.000Z',recordedAtUtc:'2026-10-21T15:05:00.000Z',
      knownAtDecision:true},scenarios:[{...technical().scenarios[0]!,availableAtUtc:barEnd}]});
    const c=buildDecisionReviewCase(input({technical:t}));
    expect(c.decisionTimeView.agreements.find(a=>a.left==='F41K contexto')?.state).toBe('DIRECTIONALLY_COMPATIBLE');
    expect(JSON.stringify(c)).not.toMatch(/recommendationScore|confidenceScore|buySignal/);
  });
  it('una declaración humana no se convierte en evidencia independiente',()=>{
    const evidence={...technical().evidence,verificationStatus:'SELF_REPORTED_UNVERIFIED' as const,
      source:'F17 declaración',eventAtUtc:barEnd};
    const c=buildDecisionReviewCase(input({humanContext:evidence}));
    expect(c.decisionTimeView.humanContext?.verificationStatus).toBe('SELF_REPORTED_UNVERIFIED');
    expect(c.decisionTimeView.humanContext?.knownAtDecision).toBe(false);
  });
  it('CALL/PUT hipotético no se equipara a la clase de movimiento del subyacente',()=>{
    const c=buildDecisionReviewCase(input({decision:decision({origin:'F41M_SIMULATOR',direction:'CALL',
      recordClass:null,classification:'DOCUMENTED_ON_TIME',quantity:1,premiumPerShare:2})}));
    expect(c.decisionTimeView.agreements[0]?.state).toBe('NOT_COMPARABLE');
  });
  it('mantiene porcentajes, comisiones desconocidas y P&L en revisión posterior',()=>{
    const c=buildDecisionReviewCase(input({tradeOutcome:{source:'F41M_HYPOTHETICAL',scope:'POSITION_AGGREGATE',
      positionId:'p1',status:'PARTIALLY_CLOSED',initialQuantity:2,closedQuantity:1,remainingQuantity:1,
      exitPremiumsPerShare:[3],
      realizedGrossUsd:100,realizedNetUsd:null,knownCommissionUsd:null,sourceIds:['e1'],sourceHashes:[hash]}}));
    expect(c.postOutcomeReview.tradeOutcome?.realizedNetUsd).toBeNull();
    expect(JSON.stringify(c.decisionTimeView)).not.toContain('realizedGrossUsd');
    expect(DecisionReviewCase.safeParse(c).success).toBe(true);
  });
  it('NO_TRADE y ausencia de F16 o ML no producen rechazos inventados',()=>{
    const c=buildDecisionReviewCase(input({decision:decision({direction:'no_trade',operationType:'no_trade'}),
      models:[],signalComparison:{status:'no_trade',reason:'Decisión explícita sin IDs rechazados',signals:[]}}));
    expect(c.decisionTimeView.predictionMatch).toBe('NONE');
    expect(c.decisionTimeView.signalComparison?.signals).toEqual([]);
    expect(c.postOutcomeReview.modelOutcome).toBeNull();
  });
  it('una señal declarada matched con registro futuro no conserva estado both',()=>{
    const sig={evidence:{...technical().evidence,verificationStatus:'VERIFIED_AVAILABLE' as const,
      availableAtUtc:barEnd,recordedAtUtc:'2026-10-21T15:11:00.000Z',knownAtDecision:true},
      family:'pullback_fixture',direction:'bullish' as const};
    const c=buildDecisionReviewCase(input({signalComparison:{status:'both',reason:'fixture',signals:[sig]}}));
    expect(c.decisionTimeView.signalComparison?.status).toBe('insufficient');
    expect(c.decisionTimeView.signalComparison?.signals).toEqual([]);
  });
  it('resume cohortes por separado sin duplicar vínculos F17/41M',()=>{
    const human=buildDecisionReviewCase(input({models:[]})),sim=buildDecisionReviewCase(input({
      decision:decision({id:'F41M:e1',sourceId:'e1',origin:'F41M_SIMULATOR',
        classification:'HISTORICAL_SIMULATION',recordClass:null,linkedHumanDecisionId:'human-1'}),models:[]}));
    const sim2=buildDecisionReviewCase(input({decision:{...sim.decisionTimeView.decision,id:'F41M:e2',sourceId:'e2'},models:[]}));
    const summary=summarizeDecisionReviews([human,sim,sim2],{F17:'AVAILABLE',F16:'UNAVAILABLE',F41M:'AVAILABLE',
      F41I:'UNAVAILABLE',F41K:'UNAVAILABLE',BROKER:'UNAVAILABLE'},decisionAt);
    expect(summary.totalDecisions).toBe(3);expect(summary.linkedHumanSimulatorPairs).toBe(1);
    expect(summary.status).toBe('PARTIAL_EVIDENCE');expect(DecisionReviewSummary.safeParse(summary).success).toBe(true);
  });
});

describe('41N: API y ledgers aislados',()=>{
  it('DEMO no lee datos privados ni inventa decisiones o predicciones',async()=>{
    const path=temp(),{app,token}=await createApp({mode:'DEMO',privateDir:path,dbPath:join(path,'db.sqlite')});
    try{const summary=await app.inject('/api/v1/research/decision-review/summary');
      expect(summary.statusCode).toBe(200);expect(summary.json().status).toBe('NO_DECISIONS');
      const page=await app.inject('/api/v1/research/decision-review/cases?limit=2');
      expect(page.statusCode).toBe(200);expect(page.json().items).toEqual([]);
      expect((await app.inject('/api/v1/research/decision-review/cases/F17:unknown')).statusCode).toBe(404);
      expect((await app.inject('/api/v1/research/decision-review/cases?limit=200')).statusCode).toBe(400);
      expect((await app.inject('/api/v1/research/decision-review/cases?hasPrediction=maybe')).statusCode).toBe(400);
      expect((await app.inject('/api/v1/research/decision-review/cases?from=2026-10-22&to=2026-10-21')).statusCode).toBe(400);
      expect([400,414]).toContain((await app.inject('/api/v1/research/decision-review/cases/'+('x'.repeat(161)))).statusCode);
      expect((await app.inject({method:'POST',url:'/api/v1/research/decision-review/cases',
        headers:{'x-local-token':token},payload:{}})).statusCode).toBe(404);
    }finally{await app.close();}
  });
  it('reconstruye apertura hipotética y cierre parcial sin fuentes de broker reales',async()=>{
    const path=temp(),store=new SimulatorStore(join(path,'simulator'));
    const sim=new SimulatorService({store,mode:'PAPER',contract:()=>({conId:101,
      occSymbol:'NVDA  990116C00220000',symbol:'NVDA',right:'CALL',strike:220,
      expiration:'2099-01-16',multiplier:100,currency:'USD'}),quote:()=>null});
    const at=new Date(Date.now()-500).toISOString(),opened=await sim.open({idempotencyKey:randomUUID(),conId:101,
      quantity:2,premiumPerShare:2,priceOrigin:'MANUAL_INPUT',entryFeeUsd:null,decisionAtUtc:at,
      simulatedEntryAtUtc:at,plan:{entryReason:'fixture'},confirmHypothetical:true});
    await sim.close(opened.position.positionId,{idempotencyKey:randomUUID(),quantity:1,premiumPerShare:3,
      priceOrigin:'MANUAL_INPUT',exitFeeUsd:0,decisionAtUtc:new Date().toISOString(),
      simulatedExitAtUtc:new Date().toISOString(),reason:'fixture',confirmHypothetical:true});
    const service=reviewService(path,store);
    const data=await service.read();
    expect(data.sourceStatus.F41M).toBe('AVAILABLE');expect(data.cases).toHaveLength(1);
    const item=data.cases[0]!;
    expect(item.decisionTimeView.model).toBeNull();
    expect(item.decisionTimeView.decision.classification).toBe('DOCUMENTED_ON_TIME');
    expect(item.postOutcomeReview.tradeOutcome?.source).toBe('F41M_HYPOTHETICAL');
    expect(item.postOutcomeReview.tradeOutcome?.remainingQuantity).toBe(1);
    expect(item.postOutcomeReview.tradeOutcome?.realizedNetUsd).toBeNull();
    expect((await service.page({offset:0,limit:1})).total).toBe(1);
    expect((await service.page({offset:0,limit:1,source:'F17_HUMAN'})).total).toBe(0);
    expect((await service.page({offset:0,limit:1,source:'F41M_SIMULATOR',hasPrediction:false})).total).toBe(1);
    expect((await service.page({offset:1,limit:1})).items).toEqual([]);
    expect((await service.detail(item.id))?.decisionTimeView.decision.simulationId).toBeTruthy();
    expect(item.decisionTimeView.decision.contract?.right).toBe('CALL');
    expect(item.decisionTimeView.decision.plan?.entryReason).toBe('fixture');
    await sim.close(opened.position.positionId,{idempotencyKey:randomUUID(),quantity:1,premiumPerShare:1,
      priceOrigin:'MANUAL_INPUT',exitFeeUsd:0,decisionAtUtc:new Date().toISOString(),
      simulatedExitAtUtc:new Date().toISOString(),reason:'cierre final',confirmHypothetical:true});
    expect((await service.detail(item.id))?.postOutcomeReview.tradeOutcome?.status).toBe('CLOSED');
  });
  it('una entrada histórica no se reetiqueta como prospectiva y no se vincula por similitud temporal',async()=>{
    const path=temp(),store=new SimulatorStore(join(path,'simulator'));
    const sim=new SimulatorService({store,mode:'PAPER',contract:()=>({conId:101,occSymbol:null,
      symbol:'NVDA',right:'PUT',strike:220,expiration:'2099-01-16',multiplier:100,currency:'USD'}),quote:()=>null});
    const old='2026-10-21T15:10:00.000Z';
    await sim.open({idempotencyKey:randomUUID(),conId:101,quantity:1,premiumPerShare:1,
      priceOrigin:'MANUAL_INPUT',entryFeeUsd:0,decisionAtUtc:old,simulatedEntryAtUtc:old,
      plan:{entryReason:'reconstrucción'},confirmHypothetical:true});
    const data=await reviewService(path,store).read();
    expect(data.cases[0]?.decisionTimeView.decision.classification).toBe('HISTORICAL_SIMULATION');
    expect(data.cases[0]?.decisionTimeView.decision.linkedHumanDecisionId).toBeNull();
    expect(data.summary.prospectiveQualified).toBe(0);
  });
  it('cada lote 41M es una entrada distinguible y el P&L permanece agregado a la posición',async()=>{
    const path=temp(),store=new SimulatorStore(join(path,'simulator'));
    const sim=new SimulatorService({store,mode:'PAPER',contract:()=>({conId:101,occSymbol:null,
      symbol:'NVDA',right:'CALL',strike:220,expiration:'2099-01-16',multiplier:100,currency:'USD'}),quote:()=>null});
    const at=new Date().toISOString(),opened=await sim.open({idempotencyKey:randomUUID(),conId:101,
      quantity:1,premiumPerShare:2,priceOrigin:'MANUAL_INPUT',entryFeeUsd:0,decisionAtUtc:at,
      simulatedEntryAtUtc:at,confirmHypothetical:true});
    await sim.addLot(opened.position.positionId,{idempotencyKey:randomUUID(),quantity:2,premiumPerShare:3,
      priceOrigin:'MANUAL_INPUT',entryFeeUsd:0,decisionAtUtc:new Date().toISOString(),
      simulatedEntryAtUtc:new Date().toISOString(),plan:{entryReason:'segundo lote'},confirmHypothetical:true});
    const cases=(await reviewService(path,store).read()).cases;
    expect(cases).toHaveLength(2);
    expect(new Set(cases.map(c=>c.id)).size).toBe(2);
    expect(cases.map(c=>c.decisionTimeView.decision.quantity).sort()).toEqual([1,2]);
    expect(cases.every(c=>c.postOutcomeReview.tradeOutcome?.scope==='POSITION_AGGREGATE')).toBe(true);
    expect(cases.every(c=>c.postOutcomeReview.tradeOutcome?.initialQuantity===3)).toBe(true);
    expect(cases.find(c=>c.decisionTimeView.decision.quantity===2)?.decisionTimeView.decision.reason).toBe('segundo lote');
  });
  it('DEMO presenta simulación sintética, sin abrir fuentes reales ni crear evidencia ML',async()=>{
    const path=temp(),store=new SimulatorStore(null);
    const sim=new SimulatorService({store,mode:'DEMO',contract:()=>({conId:101,occSymbol:null,
      symbol:'NVDA',right:'CALL',strike:220,expiration:'2099-01-16',multiplier:100,currency:'USD'}),quote:()=>null});
    const at=new Date().toISOString();await sim.open({idempotencyKey:randomUUID(),conId:101,quantity:1,
      premiumPerShare:2,priceOrigin:'MANUAL_INPUT',entryFeeUsd:0,decisionAtUtc:at,simulatedEntryAtUtc:at,
      confirmHypothetical:true});
    const base=reviewService(path,store),service=new DecisionReviewService({...base.deps,mode:'DEMO'});
    const data=await service.read();
    expect(data.cases[0]?.decisionTimeView.decision.classification).toBe('DEMO_SYNTHETIC');
    expect(data.cases[0]?.decisionTimeView.model).toBeNull();
    expect(data.sourceStatus.F17).toBe('UNAVAILABLE');
  });
  it('el vínculo 41M/F17 exige humanDecisionId explícito y conserva ambas decisiones',async()=>{
    const path=temp(),ledger=join(path,'f17','ledger');
    const csv=PHASE17_TEMPLATE_COLUMNS.join(',')+'\n'+PHASE17_TEMPLATE_COLUMNS.map(key=>csvCell(({
      symbol:'NVDA',direction:'bullish',operationType:'pullback',timeframe:'15Min',
      decisionAtUtc:decisionAt,selectionReason:'fixture',observedMarket:'true',recordMode:'live'} as Record<string,string>)[key]??'')).join(',')+'\n';
    const human=appendPhase17Decision(ledger,csv,'2026-10-21T15:11:00.000Z');
    const store=new SimulatorStore(join(path,'simulator'));
    const sim=new SimulatorService({store,mode:'PAPER',contract:()=>({conId:101,occSymbol:null,
      symbol:'NVDA',right:'CALL',strike:220,expiration:'2099-01-16',multiplier:100,currency:'USD'}),
      quote:()=>null,humanDecision:id=>id===human.id});
    const at=new Date().toISOString();
    await sim.open({idempotencyKey:randomUUID(),conId:101,quantity:1,premiumPerShare:2,
      priceOrigin:'MANUAL_INPUT',entryFeeUsd:0,decisionAtUtc:at,simulatedEntryAtUtc:at,
      plan:{humanDecisionId:human.id},confirmHypothetical:true});
    await sim.open({idempotencyKey:randomUUID(),conId:101,quantity:1,premiumPerShare:2,
      priceOrigin:'MANUAL_INPUT',entryFeeUsd:0,decisionAtUtc:at,simulatedEntryAtUtc:at,
      plan:{entryReason:'similar, pero sin ID'},confirmHypothetical:true});
    const data=await reviewService(path,store).read();
    expect(data.cases).toHaveLength(3);
    expect(data.summary.linkedHumanSimulatorPairs).toBe(1);
    expect(data.cases.filter(c=>c.decisionTimeView.decision.linkedHumanDecisionId===human.id)).toHaveLength(1);
    expect(data.cases.filter(c=>c.decisionTimeView.decision.origin==='F41M_SIMULATOR'&&
      c.decisionTimeView.decision.linkedHumanDecisionId===null)).toHaveLength(1);
  });
  it('mantiene vencimiento sin resolución y no infiere liquidación',async()=>{
    const path=temp(),store=new SimulatorStore(join(path,'simulator'));
    const sim=new SimulatorService({store,mode:'PAPER',contract:()=>({conId:101,occSymbol:null,
      symbol:'NVDA',right:'CALL',strike:220,expiration:'2026-10-27',multiplier:100,currency:'USD'}),quote:()=>null});
    const at=new Date().toISOString();await sim.open({idempotencyKey:randomUUID(),conId:101,quantity:1,
      premiumPerShare:2,priceOrigin:'MANUAL_INPUT',entryFeeUsd:0,decisionAtUtc:at,simulatedEntryAtUtc:at,
      confirmHypothetical:true});
    const base=reviewService(path,store),future=new DecisionReviewService({...base.deps,
      clock:()=>Date.parse('2026-10-30T20:00:00.000Z')});
    const item=(await future.read()).cases[0]!;
    expect(item.postOutcomeReview.tradeOutcome?.status).toBe('EXPIRED_UNRESOLVED');
    expect(item.postOutcomeReview.tradeOutcome?.realizedGrossUsd).toBe(0);
    expect(item.postOutcomeReview.tradeOutcome?.remainingQuantity).toBe(1);
  });
  it('una cadena 41M dañada se informa como INVALID_SOURCE y no como cartera vacía',async()=>{
    const path=temp(),directory=join(path,'simulator'),store=new SimulatorStore(directory);
    const sim=new SimulatorService({store,mode:'PAPER',contract:()=>({conId:101,occSymbol:null,
      symbol:'NVDA',right:'CALL',strike:220,expiration:'2099-01-16',multiplier:100,currency:'USD'}),quote:()=>null});
    const at=new Date().toISOString();await sim.open({idempotencyKey:randomUUID(),conId:101,quantity:1,
      premiumPerShare:2,priceOrigin:'MANUAL_INPUT',entryFeeUsd:0,decisionAtUtc:at,simulatedEntryAtUtc:at,
      confirmHypothetical:true});
    writeFileSync(join(directory,'00000001.json'),'{"alterado":true}');
    const data=await reviewService(path,store).read();
    expect(data.sourceStatus.F41M).toBe('INVALID_SOURCE');
    expect(data.summary.status).toBe('INVALID_SOURCE');
    expect(data.cases).toEqual([]);
  });
  it('GET lógico no escribe ledgers, inicia inferencias ni consulta proveedores',async()=>{
    const path=temp(),directory=join(path,'simulator'),store=new SimulatorStore(directory);
    const sim=new SimulatorService({store,mode:'PAPER',contract:()=>({conId:101,occSymbol:null,
      symbol:'NVDA',right:'CALL',strike:220,expiration:'2099-01-16',multiplier:100,currency:'USD'}),quote:()=>null});
    const at=new Date().toISOString();await sim.open({idempotencyKey:randomUUID(),conId:101,quantity:1,
      premiumPerShare:2,priceOrigin:'MANUAL_INPUT',entryFeeUsd:0,decisionAtUtc:at,simulatedEntryAtUtc:at,
      confirmHypothetical:true});
    const names=readdirSync(directory).sort(),before=names.map(name=>readFileSync(join(directory,name),'utf8'));
    const oldFetch=globalThis.fetch,requests:string[]=[];
    globalThis.fetch=((...args:Parameters<typeof fetch>)=>{requests.push(String(args[0]));
      throw new Error('Red no autorizada');}) as typeof fetch;
    try{const service=reviewService(path,store),page=await service.page({offset:0,limit:25});
      await service.summary();await service.detail(page.items[0]!.id);
    }finally{globalThis.fetch=oldFetch;}
    expect(requests).toEqual([]);
    expect(readdirSync(directory).sort()).toEqual(names);
    expect(names.map(name=>readFileSync(join(directory,name),'utf8'))).toEqual(before);
  });
  it('conserva decisión F17 original, ignora anotación como nueva decisión y usa ±15m solo para F16',async()=>{
    const path=temp(),ledger=join(path,'f17','ledger');
    const csv=(values:Record<string,string>)=>PHASE17_TEMPLATE_COLUMNS.join(',')+'\n'+
      PHASE17_TEMPLATE_COLUMNS.map(key=>csvCell(values[key]??'')).join(',')+'\n';
    const original=appendPhase17Decision(ledger,csv({symbol:'NVDA',direction:'bullish',operationType:'pullback',
      timeframe:'15Min',decisionAtUtc:decisionAt,selectionReason:'fixture F17',observedMarket:'true',
      recordMode:'live',contextKnownAtUtc:'2026-10-21T15:09:00.000Z'}),
      '2026-10-21T15:11:00.000Z');
    appendPhase17Decision(ledger,csv({symbol:'NVDA',direction:'bullish',operationType:'pullback',
      timeframe:'15Min',decisionAtUtc:'2026-10-21T16:00:00.000Z',selectionReason:'anotación posterior',
      observedMarket:'true',recordMode:'post_outcome_annotation',relatedDecisionId:original.id}),
      '2026-10-21T16:01:00.000Z');
    appendRecord(join(path,'f16'),'signal:s1','signal',{id:'s1',symbol:'NVDA',family:'pullback_test',
      direction:'bullish',barStartUtc:'2026-10-21T14:45:00.000Z',
      availableAtUtc:'2026-10-21T15:00:00.000Z',firstDetectedAtUtc:'2026-10-21T15:01:00.000Z',
      primaryOutcomeEndUtc:'2026-10-21T16:00:00.000Z',indicators:{sma20:100},regime:'test',
      marketGroup:'test',knownEventIds:[]},'2026-10-21T15:02:00.000Z');
    const data=await reviewService(path).read();
    expect(data.cases).toHaveLength(1);
    const c=data.cases[0]!;
    expect(c.decisionTimeView.decision.sourceId).toBe(original.id);
    expect(c.decisionTimeView.signalComparison?.status).toBe('both');
    expect(c.decisionTimeView.signalComparison?.signals[0]?.evidence.sourceHashes).toHaveLength(1);
    expect(c.decisionTimeView.humanContext?.verificationStatus).toBe('SELF_REPORTED_UNVERIFIED');
    expect(c.postOutcomeReview.laterNotes).toHaveLength(1);
    expect(JSON.stringify(c.decisionTimeView)).not.toContain('anotación posterior');
  });
  it('no_trade con ID F16 explícito conserva explicit_rejection bajo la regla congelada',async()=>{
    const path=temp(),ledger=join(path,'f17','ledger');
    const values:Record<string,string>={symbol:'NVDA',direction:'no_trade',operationType:'no_trade',
      timeframe:'15Min',decisionAtUtc:decisionAt,selectionReason:'no operar por fixture',
      observedMarket:'true',recordMode:'live',rejectedSignalIds:'s1'};
    const csv=PHASE17_TEMPLATE_COLUMNS.join(',')+'\n'+PHASE17_TEMPLATE_COLUMNS.map(key=>csvCell(values[key]??'')).join(',')+'\n';
    appendPhase17Decision(ledger,csv,'2026-10-21T15:11:00.000Z');
    appendRecord(join(path,'f16'),'signal:s1','signal',{id:'s1',symbol:'NVDA',family:'pullback_test',
      direction:'bullish',barStartUtc:'2026-10-21T14:45:00.000Z',
      availableAtUtc:'2026-10-21T15:00:00.000Z',firstDetectedAtUtc:'2026-10-21T15:01:00.000Z',
      primaryOutcomeEndUtc:'2026-10-21T16:00:00.000Z',indicators:{},regime:'test',marketGroup:'test',
      knownEventIds:[]},'2026-10-21T15:02:00.000Z');
    const c=(await reviewService(path).read()).cases[0]!;
    expect(c.decisionTimeView.signalComparison?.status).toBe('explicit_rejection');
    expect(c.decisionTimeView.decision.direction).toBe('no_trade');
  });
  it('decisión F17 reconstruida conserva clasificación histórica',async()=>{
    const path=temp(),ledger=join(path,'f17','ledger');
    const values:Record<string,string>={symbol:'NVDA',direction:'bearish',operationType:'reversal',
      timeframe:'15Min',decisionAtUtc:'2026-10-21T14:00:00.000Z',
      selectionReason:'reconstrucción documentada',observedMarket:'true',recordMode:'historical_reconstruction'};
    const csv=PHASE17_TEMPLATE_COLUMNS.join(',')+'\n'+PHASE17_TEMPLATE_COLUMNS.map(key=>csvCell(values[key]??'')).join(',')+'\n';
    appendPhase17Decision(ledger,csv,'2026-10-23T17:00:00.000Z');
    const data=await reviewService(path).read();
    expect(data.cases[0]?.decisionTimeView.decision.classification).toBe('historical_reconstruction');
    expect(data.summary.prospectiveQualified).toBe(0);
    expect(data.summary.historicalDecisions).toBe(1);
  });
  it.each([false,true])('reconstruye 41K al corte con recepción verificada=%s',async receiptVerified=>{
    const path=temp(),ledger=join(path,'f17','ledger'),cutoff='2026-10-21T19:15:00.000Z';
    const values:Record<string,string>={symbol:'NVDA',direction:'bullish',operationType:'pullback',
      timeframe:'15Min',decisionAtUtc:cutoff,selectionReason:'contexto sintético',observedMarket:'true',
      recordMode:'live'};
    appendPhase17Decision(ledger,PHASE17_TEMPLATE_COLUMNS.join(',')+'\n'+
      PHASE17_TEMPLATE_COLUMNS.map(key=>csvCell(values[key]??'')).join(',')+'\n',
      '2026-10-21T19:16:00.000Z');
    const start=Date.parse('2026-10-21T13:30:00.000Z');
    const bars=Array.from({length:26},(_,i)=>{const t=start+i*900_000,v=100+i*.1;
      return {symbol:'NVDA' as const,timeframe:'15m' as const,startUtc:new Date(t).toISOString(),
        endUtc:new Date(t+900_000).toISOString(),open:v,high:v+.2,low:v-.2,close:v+.05,
        volume:1000,provider:'Alpaca Market Data API',adjustment:'split',isComplete:true,
        receivedAtUtc:receiptVerified?new Date(t+960_000).toISOString():null};});
    if(receiptVerified)bars[22]!.receivedAtUtc='2026-10-21T19:16:00.000Z';
    const base=reviewService(path),service=new DecisionReviewService({...base.deps,technicalDeps:{
      mode:'PAPER',barsFor:()=>bars,metadataFor:()=>({asset:'NVDA',provider:'Alpaca Market Data API',
        bar_minutes:15,data_class:'real',session:'regular',exchange_timezone:'America/New_York',
        feed:'sip',adjustment:'split'}),calendarFor:()=>new Map([['2026-10-21',{open:570,close:960}]])}});
    const data=await service.read(),technical=data.cases[0]?.decisionTimeView.technical;
    expect(data.sourceStatus.F41K).toBe('AVAILABLE');
    expect(technical?.sourceFeed).toBe('sip');expect(technical?.adjustment).toBe('split');
    expect(technical?.evidence.verificationStatus).toBe(receiptVerified?'CAUSALLY_RECONSTRUCTED':'HISTORICAL_ONLY');
    expect(technical?.evidence.knownAtDecision).toBe(receiptVerified);
    expect(technical?.frames[0]?.barEndUtc).toBe(receiptVerified?'2026-10-21T19:00:00.000Z':cutoff);
    expect(technical?.scenarios.every(s=>s.eventAtUtc<=cutoff)).toBe(true);
    if(receiptVerified){
      bars[0]!.receivedAtUtc=bars[0]!.startUtc;
      const invalid=await service.read();
      expect(invalid.sourceStatus.F41K).toBe('PARTIAL_EVIDENCE');
      expect(invalid.cases[0]?.decisionTimeView.technical).toBeNull();
    }
  });
  it('no permite señal F16 registrada después de la decisión aunque declare disponibilidad anterior',async()=>{
    const path=temp(),ledger=join(path,'f17','ledger');
    const csv=PHASE17_TEMPLATE_COLUMNS.join(',')+'\n'+PHASE17_TEMPLATE_COLUMNS.map(key=>csvCell(({
      symbol:'NVDA',direction:'bullish',operationType:'pullback',timeframe:'15Min',
      decisionAtUtc:decisionAt,selectionReason:'fixture',observedMarket:'true',recordMode:'live'} as Record<string,string>)[key]??'')).join(',')+'\n';
    appendPhase17Decision(ledger,csv,'2026-10-21T15:11:00.000Z');
    appendRecord(join(path,'f16'),'signal:s-late','signal',{id:'s-late',symbol:'NVDA',family:'pullback_test',
      direction:'bullish',barStartUtc:'2026-10-21T14:45:00.000Z',
      availableAtUtc:'2026-10-21T15:00:00.000Z',firstDetectedAtUtc:'2026-10-21T15:01:00.000Z',
      primaryOutcomeEndUtc:'2026-10-21T16:00:00.000Z',indicators:{},regime:'test',marketGroup:'test',
      knownEventIds:[]},'2026-10-21T15:11:00.000Z');
    const item=(await reviewService(path).read()).cases[0]!;
    expect(item.decisionTimeView.signalComparison?.status).toBe('human_only');
    expect(item.decisionTimeView.signalComparison?.signals).toEqual([]);
  });
  it('señala integridad inválida de F17 sin publicar rutas privadas',async()=>{
    const path=temp(),ledger=join(path,'f17','ledger');mkdirSync(ledger,{recursive:true});
    writeFileSync(join(ledger,'00000001.json'),'{"malformed":true}');
    const data=await reviewService(path).read();
    expect(data.sourceStatus.F17).toBe('INVALID_SOURCE');
    expect(data.summary.status).toBe('INVALID_SOURCE');
    expect(JSON.stringify(data.summary)).not.toContain(path);
  });
});
