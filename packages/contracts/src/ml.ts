import {z} from 'zod';

export const MlState=z.enum(['READY','NO_MODEL','INVALID_ARTIFACT','UNAVAILABLE']);
export const MlClass=z.enum(['ALCISTA','BAJISTA','LATERAL']);
const probability=z.number().finite().min(0).max(1);
export const MlPrediction=z.object({
  symbol:z.literal('NVDA'),timeframe:z.literal('15m'),timestampUtc:z.iso.datetime({offset:true}),
  sessionDateNy:z.string().date(),probabilities:z.object({ALCISTA:probability,BAJISTA:probability,LATERAL:probability}).strict(),
  dominantClass:MlClass,origin:z.literal('HISTORICAL_EXPLORATORY'),modelVersion:z.string().min(1),
}).strict();
export type MlPrediction=z.infer<typeof MlPrediction>;

export const MlProspectiveStatus=z.enum(['READY','NO_MODEL','SOURCE_ABSENT','HISTORICAL_DATA','STALE_DATA','INDICATORS_INSUFFICIENT','MODEL_INCOMPATIBLE','UNAVAILABLE']);
export const MlIngestionState=z.enum(['READY','NO_DATA','DELAYED','PERMISSION_DENIED','RECENT_DATA_FORBIDDEN','RATE_LIMIT','HTTP_ERROR','NETWORK_ERROR','INVALID_DATA','NOT_CONFIGURED']);
export const MlIngestionStatus=z.object({
  status:MlIngestionState,provider:z.literal('Alpaca Market Data API'),feed:z.literal('sip'),adjustment:z.literal('split'),
  availability:z.enum(['CURRENT','DELAYED','UNAVAILABLE']),lastBarStartUtc:z.iso.datetime({offset:true}).nullable(),
  lastBarEndUtc:z.iso.datetime({offset:true}).nullable(),receivedAtUtc:z.iso.datetime({offset:true}).nullable(),
  effectiveDelayMs:z.number().finite().nonnegative().nullable(),revision:z.number().int().positive().nullable(),
  lastAttemptAtUtc:z.iso.datetime({offset:true}).nullable(),lastSuccessfulQueryAtUtc:z.iso.datetime({offset:true}).nullable(),
  lastBarReceivedAtUtc:z.iso.datetime({offset:true}).nullable(),lastBarAvailability:z.enum(['CURRENT','DELAYED','UNAVAILABLE']),reason:z.string().min(1),
}).strict();
export type MlIngestionStatus=z.infer<typeof MlIngestionStatus>;
export const MlCollectorStatus=z.object({
  state:z.enum(['RUNNING','MARKET_CLOSED','NO_NEW_BARS','RECORDED','DUPLICATE','INDICATORS_INSUFFICIENT','HORIZON_INELIGIBLE','OUTCOME_PASSED','MODEL_NOT_CONFIGURED','ALPACA_PERMISSION','ALPACA_NETWORK','ALPACA_RATE_LIMIT','LEDGER_INVALID','PYTHON_ERROR','ERROR','STOPPED','NOT_CONFIGURED']),
  active:z.boolean(),updatedAtUtc:z.iso.datetime({offset:true}).nullable(),lastSuccessfulIngestionAtUtc:z.iso.datetime({offset:true}).nullable(),
  lastBarEndUtc:z.iso.datetime({offset:true}).nullable(),lastObservationAtUtc:z.iso.datetime({offset:true}).nullable(),
  nextQueryAtUtc:z.iso.datetime({offset:true}).nullable(),lastError:z.string().nullable(),newObservations:z.number().int().nonnegative(),
}).strict();
export type MlCollectorStatus=z.infer<typeof MlCollectorStatus>;
export const MlEvaluationState=z.enum(['NO_MODEL','NO_DATA','NOT_RUN','PENDING','PARTIAL','READY','INVALID_ARTIFACT','ERROR']);
export const MlEvaluationStatus=z.object({state:MlEvaluationState,observations:z.number().int().nonnegative(),pending:z.number().int().nonnegative(),evaluated:z.number().int().nonnegative(),nonEvaluable:z.number().int().nonnegative(),revisionNotices:z.number().int().nonnegative(),updatedAtUtc:z.iso.datetime({offset:true}).nullable(),reason:z.string()}).strict();
export type MlEvaluationStatus=z.infer<typeof MlEvaluationStatus>;
export const MlEvaluationItem=z.object({predictionId:z.string().regex(/^[a-f0-9]{64}$/),barStartUtc:z.iso.datetime({offset:true}),sessionDateNy:z.string().date(),evaluatedAtUtc:z.iso.datetime({offset:true}),predictedClass:MlClass,actualClass:MlClass,entryOpen:z.number().finite().positive(),exitClose:z.number().finite().positive(),change:z.number().finite(),changePct:z.number().finite(),atr14:z.number().finite().positive(),revisionNotice:z.boolean()}).strict();
export type MlEvaluationItem=z.infer<typeof MlEvaluationItem>;
export const MlEvaluationPage=z.object({items:z.array(MlEvaluationItem),total:z.number().int().nonnegative(),offset:z.number().int().nonnegative(),limit:z.number().int().min(1).max(100),nextOffset:z.number().int().nonnegative().nullable()}).strict();
export type MlEvaluationPage=z.infer<typeof MlEvaluationPage>;
export const MlProspectiveRecord=z.object({status:MlProspectiveStatus,mode:z.enum(['REPLAY','PROSPECTIVE_CAPTURE','DELAYED_FORWARD_OBSERVATION']).nullable(),modelId:z.string().nullable(),modelSha256:z.string().regex(/^[a-f0-9]{64}$/).nullable(),source:z.string().nullable(),lastObservationUtc:z.iso.datetime({offset:true}).nullable(),receivedAtUtc:z.iso.datetime({offset:true}).nullable(),registeredAtUtc:z.iso.datetime({offset:true}).nullable(),probabilities:z.object({ALCISTA:z.number().min(0).max(1),BAJISTA:z.number().min(0).max(1),LATERAL:z.number().min(0).max(1)}).nullable(),dominantClass:z.enum(['ALCISTA','BAJISTA','LATERAL']).nullable(),entryAtUtc:z.iso.datetime({offset:true}).nullable(),recordedBeforeNextEntry:z.boolean().nullable(),recordedBeforeOutcome:z.boolean().nullable().default(null),effectiveDelayMs:z.number().finite().nonnegative().nullable().default(null),reason:z.string().min(1)});
export type MlProspectiveRecord=z.infer<typeof MlProspectiveRecord>;
export const MlStatus=z.object({status:MlState,reason:z.string().nullable(),experimentId:z.string().nullable()}).strict();
export type MlStatus=z.infer<typeof MlStatus>;
export const MlClassMetrics=z.object({precision:probability,recall:probability,f1:probability,support:z.number().int().nonnegative()}).strict();
export const MlMetrics=z.object({accuracy:probability,balancedAccuracy:probability,macroF1:probability,logLoss:z.number().finite().nonnegative(),perClass:z.object({ALCISTA:MlClassMetrics,BAJISTA:MlClassMetrics,LATERAL:MlClassMetrics}).strict()}).strict();
export type MlMetrics=z.infer<typeof MlMetrics>;
export const MlSummary=z.object({status:z.literal('READY'),symbol:z.literal('NVDA'),timeframe:z.literal('15m'),origin:z.literal('HISTORICAL_EXPLORATORY'),
  experimentId:z.string().min(1),createdAtUtc:z.iso.datetime({offset:true}),modelVersion:z.string().min(1),selectedVariant:z.enum(['standard','class_weighted','regularized']),
  trees:z.number().int().positive(),datasetSha256:z.string().regex(/^[a-f0-9]{64}$/),predictionCount:z.number().int().nonnegative()}).strict();
export type MlSummary=z.infer<typeof MlSummary>;
export const MlMetricsResponse=z.object({status:z.literal('READY'),model:MlMetrics,frequencyBaseline:MlMetrics,
  walkForward:z.array(z.object({fold:z.number().int().positive(),externalSessions:z.number().int().positive(),standard:MlMetrics,classWeighted:MlMetrics,regularized:MlMetrics,frequencyBaseline:MlMetrics})).min(1),
  exploratoryByYear:z.object({'2025':MlMetrics.optional(),'2026':MlMetrics.optional()}).strict(),
  warning:z.string().min(1)}).strict();
export type MlMetricsResponse=z.infer<typeof MlMetricsResponse>;
export const MlPredictionsPage=z.object({status:z.literal('READY'),items:z.array(MlPrediction),total:z.number().int().nonnegative(),offset:z.number().int().nonnegative(),limit:z.number().int().min(1).max(100),nextOffset:z.number().int().nonnegative().nullable()}).strict();
export type MlPredictionsPage=z.infer<typeof MlPredictionsPage>;

const ContextMetric=z.object({n:z.number().int().nonnegative(),sessions:z.number().int().nonnegative(),accuracy:probability,balancedAccuracy:probability,macroF1:probability,logLoss:z.number().finite().nonnegative(),brier:z.number().finite().nonnegative(),perClass:z.record(MlClass,z.object({support:z.number().int().nonnegative(),precision:probability,recall:probability,f1:probability})),calibration:z.record(MlClass,z.array(z.object({n:z.number().int().nonnegative(),meanProbability:probability.nullable(),observedFrequency:probability.nullable()})).length(5)),meanResidual:z.object({ALCISTA:z.number().finite(),BAJISTA:z.number().finite(),LATERAL:z.number().finite()}).strict()}).strict();
const ContextGroup=z.object({observations:z.number().int().nonnegative(),evaluated:z.number().int().nonnegative(),sessions:z.number().int().nonnegative(),withNews:z.number().int().nonnegative(),pendingClassifications:z.number().int().nonnegative(),lateReceived:z.number().int().nonnegative(),lateClassified:z.number().int().nonnegative(),providerErrors:z.number().int().nonnegative(),baseline:ContextMetric.nullable(),withNewsMetrics:ContextMetric.nullable(),withoutNewsMetrics:ContextMetric.nullable(),windows:z.record(z.string(),z.object({observations:z.number().int().nonnegative(),baseline:ContextMetric.nullable()})),byDimension:z.record(z.string(),z.record(z.string(),ContextMetric.nullable())),bySession:z.record(z.string(),ContextMetric.nullable()),accuracyDifferenceCoveredMinusUncovered:z.number().finite().nullable(),sessionBootstrap95:z.tuple([z.number().finite(),z.number().finite()]).nullable()}).strict();
export const MlNewsContextSummary=z.object({schema:z.literal('phase37-news-context-v1'),status:z.literal('READY'),symbol:z.literal('NVDA'),timeframe:z.literal('15m'),modelSha256:z.string().regex(/^[a-f0-9]{64}$/),windowsMinutes:z.array(z.number().int().min(1).max(1440)).length(3),evidenceState:z.enum(['INSUFFICIENT_EVIDENCE','DESCRIPTIVE_ONLY']),observations:z.number().int().nonnegative(),evaluated:z.number().int().nonnegative(),withNews:z.number().int().nonnegative(),sessions:z.number().int().nonnegative(),development:ContextGroup,laterExploratory:ContextGroup,warning:z.string().min(1)}).strict();
export type MlNewsContextSummary=z.infer<typeof MlNewsContextSummary>;
