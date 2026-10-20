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
