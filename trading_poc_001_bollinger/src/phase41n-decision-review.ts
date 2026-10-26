import {DecisionReviewCase as CaseSchema,DecisionReviewSummary as SummarySchema,
  type DecisionIdentity,type DecisionEvidence,type ModelContextAtDecision,
  type TechnicalContextAtDecision,type HumanSignalComparison,type PostOutcomeReview,
  type DecisionReviewCase} from '@trading-poc/contracts';
import type {IexProspectivePrediction,IexProspectiveDetail} from '@trading-poc/contracts';

export type ModelCandidate={prediction:IexProspectivePrediction;detail:IexProspectiveDetail};
export type DecisionReviewInput={decision:DecisionIdentity;models:readonly ModelCandidate[];
  sessionDate:(utc:string)=>string|null;technical:TechnicalContextAtDecision|null;
  signalComparison:HumanSignalComparison|null;humanContext:DecisionEvidence|null;
  tradeOutcome:PostOutcomeReview['tradeOutcome'];laterNotes:PostOutcomeReview['laterNotes'];
  technicalLater:PostOutcomeReview['technicalLater'];reviewGeneratedAtUtc:string};
const at=(s:string)=>Date.parse(s);
const known=(e:DecisionEvidence,cutoff:string)=>e.knownAtDecision&&
  e.availableAtUtc!==null&&at(e.availableAtUtc)<=at(cutoff)&&
  e.recordedAtUtc!==null&&at(e.recordedAtUtc)<=at(cutoff)&&
  (e.eventAtUtc===null||at(e.eventAtUtc)<=at(cutoff));
const direction=(value:string)=>value==='bullish'||value==='CALL'||value==='ALCISTA'||value==='ABOVE'||
  value==='ALIGNED_BULLISH'?'UP':
  value==='bearish'||value==='PUT'||value==='BAJISTA'||value==='BELOW'||value==='ALIGNED_BEARISH'?'DOWN':null;

/** Only a reader-verified prospective prediction may enter this selection. No nearest future match. */
export function selectModelAtDecision(candidates:readonly ModelCandidate[],decisionAtUtc:string,
  sessionDate:(utc:string)=>string|null):ModelCandidate|null{
  const session=sessionDate(decisionAtUtc);
  if(!session)return null;
  return candidates.filter(({prediction:p,detail:d})=>
    p.sessionDateNy===session&&sessionDate(p.barStartUtc)===session&&
    p.predictionId===d.predictionId&&p.modelSha256===d.modelSha256&&p.protocolSha256===d.protocolSha256&&
    at(p.barEndUtc)<=at(decisionAtUtc)&&at(p.registeredAtUtc)<=at(decisionAtUtc)&&
    at(p.receivedAtUtc)<=at(p.registeredAtUtc)&&
    at(decisionAtUtc)-at(p.registeredAtUtc)<=900_000)
    .sort((a,b)=>at(b.prediction.registeredAtUtc)-at(a.prediction.registeredAtUtc)||
      a.prediction.predictionId.localeCompare(b.prediction.predictionId))[0]??null;
}

export function buildDecisionReviewCase(input:DecisionReviewInput):DecisionReviewCase{
  const {decision}=input,cutoff=decision.decisionAtUtc,selected=selectModelAtDecision(input.models,cutoff,input.sessionDate);
  const model:ModelContextAtDecision|null=selected?{
    evidence:{id:selected.prediction.predictionId,source:'F41I IEX Live 15m, raw',
      sourceIds:[selected.prediction.predictionId],sourceHashes:[selected.detail.predictionRecordHash,selected.detail.featureHash],
      eventAtUtc:selected.prediction.barEndUtc,availableAtUtc:selected.prediction.registeredAtUtc,
      recordedAtUtc:selected.prediction.registeredAtUtc,verificationStatus:'VERIFIED_AVAILABLE',knownAtDecision:true,
      limitations:['IEX raw y SIP split son fuentes y ajustes diferentes; no se comparan niveles de precio.',
        'Las probabilidades son experimentales y no representan una recomendación CALL/PUT.']},
    predictionId:selected.prediction.predictionId,modelSha256:selected.prediction.modelSha256,
    protocolSha256:selected.prediction.protocolSha256,barEndUtc:selected.prediction.barEndUtc,
    registeredAtUtc:selected.prediction.registeredAtUtc,associationRule:'LAST_REGISTERED_WITHIN_15_MIN_SAME_NYSE_SESSION',
    probabilities:selected.prediction.probabilities,dominantClass:selected.prediction.dominantClass}:null;
  const technical=input.technical&&(
    (input.technical.evidence.verificationStatus==='HISTORICAL_ONLY'&&
      (input.technical.evidence.eventAtUtc===null||at(input.technical.evidence.eventAtUtc)<=at(cutoff)))||
    known(input.technical.evidence,cutoff))?{
      ...input.technical,
      frames:input.technical.frames.map(frame=>frame.barEndUtc&&at(frame.barEndUtc)>at(cutoff)?
        {...frame,barEndUtc:null,shortPair:'INSUFFICIENT_DATA',longPair:'INSUFFICIENT_DATA',
          state:'INSUFFICIENT_DATA',sma20:null,sma40:null,sma100:null,sma200:null}:frame),
      scenarios:input.technical.scenarios.filter(s=>at(s.eventAtUtc)<=at(cutoff)&&
        (s.availableAtUtc===null?input.technical!.evidence.verificationStatus==='HISTORICAL_ONLY':
          at(s.availableAtUtc)<=at(cutoff))).slice(0,40)}:null;
  const humanContext=input.humanContext&&input.humanContext.eventAtUtc&&
    at(input.humanContext.eventAtUtc)<=at(cutoff)?input.humanContext:null;
  const signalComparison=input.signalComparison?(()=>{const signals=input.signalComparison!.signals.filter(s=>known(s.evidence,cutoff));
    return {...input.signalComparison!,signals,status:!signals.length&&
      (input.signalComparison!.status==='both'||input.signalComparison!.status==='explicit_rejection')?
        'insufficient' as const:input.signalComparison!.status};})():null;
  const agreements:DecisionReviewCase['decisionTimeView']['agreements']=[];
  if(model){
    const human=decision.observedMarket===true&&
      decision.recordClass==='live_before_primary_outcome'?direction(decision.direction):null;
    const predicted=direction(model.dominantClass);
    agreements.push({left:'F17 decisión',right:'F41I clase dominante',
      state:human&&predicted?human===predicted?'DIRECTIONALLY_COMPATIBLE':'DIRECTIONALLY_CONFLICTING':
        decision.origin==='F41M_SIMULATOR'?'NOT_COMPARABLE':'INDETERMINATE',
      reason:decision.origin==='F41M_SIMULATOR'?'El derecho CALL/PUT y el movimiento del subyacente no son resultados equivalentes.':
        'Dirección humana original autodeclarada; compatibilidad descriptiva sin verificar que viera la predicción.'});
  }
  if(technical&&model){
    const state=technical.evidence.knownAtDecision?direction(technical.alignment):null,
      predicted=direction(model.dominantClass);
    agreements.push({left:'F41K contexto',right:'F41I clase dominante',
      state:state&&predicted?state===predicted?'DIRECTIONALLY_COMPATIBLE':'DIRECTIONALLY_CONFLICTING':'INDETERMINATE',
      reason:'Contexto multitemporal descriptivo; temporalidades, fuentes y estados pueden diferir.'});
  }
  if(model&&signalComparison?.signals.length){
    const signalDirection=direction(signalComparison.signals[0]!.direction),predicted=direction(model.dominantClass);
    agreements.push({left:'F16 señal',right:'F41I clase dominante',
      state:signalDirection&&predicted?signalDirection===predicted?'DIRECTIONALLY_COMPATIBLE':
        'DIRECTIONALLY_CONFLICTING':'INDETERMINATE',
      reason:'La coincidencia describe dirección del subyacente; familias, ventanas y objetivos son diferentes.'});
  }
  const missing:string[]=[];
  if(!model)missing.push('NONE: ninguna predicción prospectiva IEX validada dentro de los 15 minutos previos de la misma sesión.');
  if(!technical)missing.push('Contexto 41K no disponible o sin continuidad temporal verificable.');
  if(decision.origin==='F17_HUMAN'&&!signalComparison)missing.push('Comparación F16 no disponible.');
  const limitations=['La vista de decisión excluye desenlaces, fills y anotaciones posteriores.',
    'Asociación por tiempo no demuestra que el operador haya visto la predicción o el escenario.'];
  if(technical?.evidence.verificationStatus==='HISTORICAL_ONLY')limitations.push(
    'El contexto 41K fue reconstruido históricamente sin recepción contemporánea verificada; no se atribuye al operador.');
  if(humanContext?.verificationStatus==='SELF_REPORTED_UNVERIFIED')limitations.push(
    'El contexto humano declarado no tiene verificación independiente de recepción.');
  const trade=input.tradeOutcome;
  const modelOutcome:selectedOutcome=selected?{
    predictionId:selected.prediction.predictionId,status:selected.prediction.evaluationStatus,
    predictedClass:selected.prediction.dominantClass,actualClass:selected.prediction.actualClass,
    movementAtr:selected.prediction.movementAtr,evaluatedAtUtc:selected.prediction.evaluatedAtUtc,
    modelSha256:selected.prediction.modelSha256,protocolSha256:selected.prediction.protocolSha256}:null;
  const post:PostOutcomeReview={view:'POST_OUTCOME_REVIEW',modelOutcome,
    technicalLater:input.technicalLater.filter(s=>at(s.eventAtUtc)>at(cutoff)).slice(0,40),tradeOutcome:trade,
    laterNotes:input.laterNotes.filter(s=>at(s.recordedAtUtc)>at(cutoff)).slice(0,100),
    dimensions:[...(modelOutcome?['MODEL_DIRECTIONAL_OUTCOME'] as const:[]),
      ...(input.technicalLater.length?['TECHNICAL_SCENARIO_OBSERVATION'] as const:[]),
      ...(trade?['OPTION_TRADE_ECONOMIC_OUTCOME'] as const:[])],
    limitations:['El desenlace direccional del modelo, la evolución técnica y el resultado económico de la opción son magnitudes diferentes.',
      'Las aperturas, BID/ASK y primas documentadas no garantizan ejecuciones reales.']};
  return CaseSchema.parse({id:decision.id,reviewGeneratedAtUtc:input.reviewGeneratedAtUtc,
    decisionTimeView:{view:'DECISION_TIME_VIEW',decision,humanContext,technical,model,
      predictionMatch:model?'MATCHED':'NONE',signalComparison,agreements,missing,limitations},
    postOutcomeReview:post,limitations:[...limitations,...post.limitations]});
}
type selectedOutcome=PostOutcomeReview['modelOutcome'];

export function summarizeDecisionReviews(cases:readonly DecisionReviewCase[],sourceStatus:Record<string,
  'NO_DECISIONS'|'PARTIAL_EVIDENCE'|'AVAILABLE'|'INVALID_SOURCE'|'UNAVAILABLE'>,atUtc:string){
  const linked=new Set(cases.filter(c=>c.decisionTimeView.decision.origin==='F41M_SIMULATOR'&&
    c.decisionTimeView.decision.linkedHumanDecisionId).map(c=>c.decisionTimeView.decision.linkedHumanDecisionId));
  return SummarySchema.parse({status:Object.values(sourceStatus).includes('INVALID_SOURCE')?'INVALID_SOURCE':
    !cases.length?'NO_DECISIONS':Object.values(sourceStatus).some(s=>s!=='AVAILABLE')?'PARTIAL_EVIDENCE':'AVAILABLE',
    reviewGeneratedAtUtc:atUtc,totalDecisions:cases.length,
    prospectiveQualified:cases.filter(c=>c.decisionTimeView.decision.origin==='F17_HUMAN'&&
      c.decisionTimeView.decision.recordClass==='live_before_primary_outcome').length,
    documentedOnTimeSimulator:cases.filter(c=>c.decisionTimeView.decision.origin==='F41M_SIMULATOR'&&
      c.decisionTimeView.decision.classification==='DOCUMENTED_ON_TIME').length,
    historicalDecisions:cases.filter(c=>c.decisionTimeView.decision.classification==='HISTORICAL_SIMULATION'||
      c.decisionTimeView.decision.origin==='F17_HUMAN'&&
      c.decisionTimeView.decision.recordClass!=='live_before_primary_outcome').length,
    syntheticDecisions:cases.filter(c=>c.decisionTimeView.decision.classification==='DEMO_SYNTHETIC').length,
    withVerifiedMl:cases.filter(c=>c.decisionTimeView.model?.evidence.verificationStatus==='VERIFIED_AVAILABLE').length,
    withVerifiedTechnical:cases.filter(c=>c.decisionTimeView.technical?.evidence.verificationStatus==='VERIFIED_AVAILABLE'||
      c.decisionTimeView.technical?.evidence.verificationStatus==='CAUSALLY_RECONSTRUCTED').length,
    withReconstructedTechnical:cases.filter(c=>c.decisionTimeView.technical?.evidence.verificationStatus==='CAUSALLY_RECONSTRUCTED').length,
    withHistoricalTechnical:cases.filter(c=>c.decisionTimeView.technical?.evidence.verificationStatus==='HISTORICAL_ONLY').length,
    withUnavailableTechnical:cases.filter(c=>!c.decisionTimeView.technical).length,
    withLinkedTradeOutcome:cases.filter(c=>c.postOutcomeReview.tradeOutcome).length,
    evaluatedModelAssociations:cases.filter(c=>c.postOutcomeReview.modelOutcome?.status==='EVALUATED').length,
    linkedHumanSimulatorPairs:linked.size,sourceStatus,
    limitations:['Cohortes, resultados y procedencias diferentes; estos recuentos no son porcentajes de éxito ni evidencia causal.',
      'Una decisión humana explícitamente vinculada al simulador se cuenta una vez en pares enlazados, aunque tenga varias entradas.']});
}
