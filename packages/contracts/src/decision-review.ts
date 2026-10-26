import {z} from 'zod';
import {IexModelProbabilities} from './ml.ts';
import {SimulatorContract,SimulatorPlan,SimulatorQuoteReference} from './paper-simulator.ts';

const utc=z.iso.datetime({offset:true});
const id=z.string().min(1).max(160);
const text=z.string().max(1000);
export const DecisionVerification=z.enum(['VERIFIED_AVAILABLE','CAUSALLY_RECONSTRUCTED','SELF_REPORTED_UNVERIFIED',
  'HISTORICAL_ONLY','UNAVAILABLE','INVALID_EVIDENCE']);
export const DecisionReviewState=z.enum(['NO_DECISIONS','PARTIAL_EVIDENCE','AVAILABLE','INVALID_SOURCE','UNAVAILABLE']);
export const DecisionOrigin=z.enum(['F17_HUMAN','F41M_SIMULATOR']);
export const DecisionAgreementState=z.enum(['DIRECTIONALLY_COMPATIBLE','DIRECTIONALLY_CONFLICTING',
  'INDETERMINATE','NOT_COMPARABLE','SOURCE_UNAVAILABLE']);
export const DecisionEvidence=z.object({id,source:text,sourceIds:z.array(id).max(20),sourceHashes:z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(20),
  eventAtUtc:utc.nullable(),availableAtUtc:utc.nullable(),recordedAtUtc:utc.nullable(),
  verificationStatus:DecisionVerification,knownAtDecision:z.boolean(),limitations:z.array(text).max(20)}).strict();
export const ModelContextAtDecision=z.object({evidence:DecisionEvidence,predictionId:id,
  modelSha256:z.string().regex(/^[a-f0-9]{64}$/),protocolSha256:z.string().regex(/^[a-f0-9]{64}$/),
  barEndUtc:utc,registeredAtUtc:utc,associationRule:z.literal('LAST_REGISTERED_WITHIN_15_MIN_SAME_NYSE_SESSION'),
  probabilities:IexModelProbabilities,dominantClass:z.enum(['ALCISTA','BAJISTA','LATERAL'])}).strict();
export const TechnicalContextAtDecision=z.object({evidence:DecisionEvidence,alignment:text,
  sourceFeed:text,adjustment:text,scenarioIds:z.array(id).max(40),
  scenarios:z.array(z.object({id,family:text,timeframe:z.enum(['15m','1h','1d']),direction:z.enum(['ABOVE','BELOW','NEUTRAL']),
    state:text,period:z.number().int().nullable(),eventAtUtc:utc,availableAtUtc:utc.nullable(),
    confirmations:z.number().int().nonnegative(),contradictions:z.number().int().nonnegative()}).strict()).max(40),
  frames:z.array(z.object({timeframe:z.enum(['15m','1h','1d']),barEndUtc:utc.nullable(),shortPair:text,longPair:text,
    state:text,sma20:z.number().finite().nullable(),sma40:z.number().finite().nullable(),
    sma100:z.number().finite().nullable(),sma200:z.number().finite().nullable()}).strict()).length(3),
  bollingerPosition:z.enum(['ABOVE_UPPER','BELOW_LOWER','INSIDE','ON_BAND','UNAVAILABLE']).nullable()}).strict();
export const HumanSignalComparison=z.object({status:z.enum(['both','human_only','explicit_rejection','no_trade','system_only','insufficient']),
  reason:text,signals:z.array(z.object({evidence:DecisionEvidence,family:text,direction:z.enum(['bullish','bearish'])}).strict()).max(20)}).strict();
export const DecisionSourceAgreement=z.object({left:text,right:text,state:DecisionAgreementState,reason:text}).strict();
export const DecisionIdentity=z.object({id,origin:DecisionOrigin,sourceId:id,linkedHumanDecisionId:id.nullable(),
  symbol:z.literal('NVDA'),decisionAtUtc:utc,documentedAtUtc:utc,classification:text,
  direction:text,operationType:text,contractOccSymbol:z.string().nullable(),
  positionId:id.nullable(),simulationId:id.nullable(),simulatedEntryAtUtc:utc.nullable(),
  contract:SimulatorContract.nullable(),plan:SimulatorPlan.nullable(),quoteReference:SimulatorQuoteReference.nullable(),
  chartCaptureId:id.nullable(),chartCapturedAtUtc:utc.nullable(),
  quantity:z.number().int().nonnegative().nullable(),premiumPerShare:z.number().finite().nonnegative().nullable(),
  priceOrigin:z.string().nullable(),reason:text.nullable(),recordClass:z.string().nullable(),
  observedMarket:z.boolean().nullable(),contextKnownAtUtc:utc.nullable(),
  sourceIds:z.array(id).max(20),sourceHashes:z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(20)}).strict();
export const DecisionTimeView=z.object({view:z.literal('DECISION_TIME_VIEW'),decision:DecisionIdentity,
  humanContext:DecisionEvidence.nullable(),technical:TechnicalContextAtDecision.nullable(),
  model:ModelContextAtDecision.nullable(),predictionMatch:z.enum(['MATCHED','NONE']),
  signalComparison:HumanSignalComparison.nullable(),agreements:z.array(DecisionSourceAgreement).max(20),
  missing:z.array(text).max(20),limitations:z.array(text).max(30)}).strict();
export const PostOutcomeReview=z.object({view:z.literal('POST_OUTCOME_REVIEW'),
  modelOutcome:z.object({predictionId:id,status:z.enum(['PENDING','OVERDUE_UNEVALUATED','EVALUATED','MISSING_ENTRY','MISSING_OUTCOME']),
    predictedClass:z.enum(['ALCISTA','BAJISTA','LATERAL']),actualClass:z.enum(['ALCISTA','BAJISTA','LATERAL']).nullable(),
    movementAtr:z.number().finite().nullable(),evaluatedAtUtc:utc.nullable(),modelSha256:z.string(),protocolSha256:z.string()}).strict().nullable(),
  technicalLater:z.array(z.object({scenarioId:id,state:text,eventAtUtc:utc}).strict()).max(40),
  tradeOutcome:z.object({source:z.enum(['F17_BROKER_LINKED','F41M_HYPOTHETICAL']),scope:z.enum(['DECISION_LINKED','POSITION_AGGREGATE']),positionId:id,
    status:text,initialQuantity:z.number().int().nonnegative().nullable(),closedQuantity:z.number().int().nonnegative().nullable(),
    remainingQuantity:z.number().int().nonnegative().nullable(),exitPremiumsPerShare:z.array(z.number().finite().nonnegative()).max(100),
    realizedGrossUsd:z.number().finite().nullable(),
    realizedNetUsd:z.number().finite().nullable(),knownCommissionUsd:z.number().finite().nullable(),
    sourceIds:z.array(id).max(100),sourceHashes:z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(100)}).strict().nullable(),
  laterNotes:z.array(z.object({id,recordedAtUtc:utc,kind:text,detail:text}).strict()).max(100),
  dimensions:z.array(z.enum(['MODEL_DIRECTIONAL_OUTCOME','TECHNICAL_SCENARIO_OBSERVATION',
    'OPTION_TRADE_ECONOMIC_OUTCOME'])).max(3),limitations:z.array(text).max(30)}).strict();
export const DecisionReviewCase=z.object({id,reviewGeneratedAtUtc:utc,decisionTimeView:DecisionTimeView,
  postOutcomeReview:PostOutcomeReview,limitations:z.array(text).max(40)}).strict();
export const DecisionReviewSummary=z.object({status:DecisionReviewState,reviewGeneratedAtUtc:utc,
  totalDecisions:z.number().int().nonnegative(),prospectiveQualified:z.number().int().nonnegative(),
  documentedOnTimeSimulator:z.number().int().nonnegative(),historicalDecisions:z.number().int().nonnegative(),
  syntheticDecisions:z.number().int().nonnegative(),withVerifiedMl:z.number().int().nonnegative(),
  withVerifiedTechnical:z.number().int().nonnegative(),withReconstructedTechnical:z.number().int().nonnegative(),
  withHistoricalTechnical:z.number().int().nonnegative(),
  withUnavailableTechnical:z.number().int().nonnegative(),
  withLinkedTradeOutcome:z.number().int().nonnegative(),evaluatedModelAssociations:z.number().int().nonnegative(),
  linkedHumanSimulatorPairs:z.number().int().nonnegative(),sourceStatus:z.record(z.string(),DecisionReviewState),
  limitations:z.array(text).max(40)}).strict();
export const DecisionReviewListItem=z.object({id,origin:DecisionOrigin,decisionAtUtc:utc,documentedAtUtc:utc,
  classification:text,direction:text,technicalStatus:DecisionVerification,predictionMatch:z.enum(['MATCHED','NONE']),
  outcomeStatus:text,linkedHumanDecisionId:id.nullable()}).strict();
export const DecisionReviewPage=z.object({status:DecisionReviewState,items:z.array(DecisionReviewListItem),
  total:z.number().int().nonnegative(),offset:z.number().int().nonnegative(),limit:z.number().int().min(1).max(100),
  nextOffset:z.number().int().nonnegative().nullable(),sourceStatus:z.record(z.string(),DecisionReviewState)}).strict();
export type DecisionReviewCase=z.infer<typeof DecisionReviewCase>;
export type DecisionIdentity=z.infer<typeof DecisionIdentity>;
export type DecisionEvidence=z.infer<typeof DecisionEvidence>;
export type TechnicalContextAtDecision=z.infer<typeof TechnicalContextAtDecision>;
export type ModelContextAtDecision=z.infer<typeof ModelContextAtDecision>;
export type HumanSignalComparison=z.infer<typeof HumanSignalComparison>;
export type PostOutcomeReview=z.infer<typeof PostOutcomeReview>;
export type DecisionReviewSummary=z.infer<typeof DecisionReviewSummary>;
export type DecisionReviewPage=z.infer<typeof DecisionReviewPage>;
