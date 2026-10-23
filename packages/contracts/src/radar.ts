import {z} from 'zod';

const utc=z.iso.datetime({offset:true});
const nullableNumber=z.number().finite().nullable();
export const RadarSymbol=z.enum(['NVDA','QQQ','SMH']);
export const RadarMetrics=z.object({close:nullableNumber,sma20:nullableNumber,sma40:nullableNumber,sma100:nullableNumber,sma200:nullableNumber,
  bollingerUpper:nullableNumber,bollingerMiddle:nullableNumber,bollingerLower:nullableNumber,relativeVolume20:nullableNumber,
  return15mPercent:nullableNumber,return60mPercent:nullableNumber}).strict();
export const RadarPrediction=z.object({status:z.enum(['CURRENT','HISTORICAL','STALE','UNAVAILABLE','INVALID_LEDGER','MODELO_NO_DISPONIBLE']),
  modelSha256:z.string().regex(/^[a-f0-9]{64}$/).nullable(),modelVersion:z.string().nullable(),barStartUtc:utc.nullable(),barEndUtc:utc.nullable(),
  registeredAtUtc:utc.nullable(),entryAtUtc:utc.nullable(),outcomeAtUtc:utc.nullable(),source:z.literal('IEX Live').nullable(),
  evaluationStatus:z.enum(['PENDING','EVALUATED','MISSING_ENTRY','MISSING_OUTCOME']).nullable(),
  probabilities:z.object({ALCISTA:z.number().min(0).max(1),BAJISTA:z.number().min(0).max(1),LATERAL:z.number().min(0).max(1)}).strict().nullable(),reason:z.string()}).strict();
export const RadarAcademy=z.object({status:z.enum(['ACTIVE','REFERENCE_DATE','HISTORICAL_ONLY','CONFLICT','NONE']),right:z.enum(['CALL','PUT']).nullable(),
  referenceDate:z.string().date().nullable(),validFrom:z.string().date().nullable(),validTo:z.string().date().nullable(),
  minAskCents:z.number().int().positive().nullable(),maxAskCents:z.number().int().positive().nullable(),
  outerMinCents:z.number().int().positive().nullable(),outerMaxCents:z.number().int().positive().nullable(),
  liveAskCents:z.number().int().positive().nullable(),reason:z.string()}).strict();
export const RadarAsset=z.object({symbol:RadarSymbol,source:z.string(),feed:z.string(),dataType:z.enum(['SYNTHETIC','HISTORICAL']),
  availability:z.enum(['AVAILABLE','HISTORICAL_ONLY','STALE','UNAVAILABLE']),timestampUtc:utc.nullable(),ageMinutes:nullableNumber,
  quote:z.object({source:z.string(),feedType:z.enum(['LIVE','DELAYED','FROZEN','DELAYED_FROZEN','UNKNOWN','SYNTHETIC']),
    availability:z.enum(['AVAILABLE','STALE','UNAVAILABLE']),marketTimestampUtc:utc.nullable(),receivedAtUtc:utc.nullable(),
    last:nullableNumber,bid:nullableNumber,ask:nullableNumber}).strict(),
  trend:z.enum(['ALCISTA','BAJISTA','LATERAL','INDETERMINADA']),reasons:z.array(z.string()),risks:z.array(z.string()),metrics:RadarMetrics,
  prediction:RadarPrediction,news:z.object({status:z.enum(['AVAILABLE','NO_NEWS','INVALID_LEDGER']),count:z.number().int().nonnegative(),lastSeenAtUtc:utc.nullable(),summary:z.string()}).strict(),
  academy:RadarAcademy.nullable()}).strict();
export const RadarResponse=z.object({asOfUtc:utc,assets:z.array(RadarAsset).min(1).max(3),comparison:z.object({timestampUtc:utc.nullable(),source:z.string().nullable(),items:z.array(z.string()),reason:z.string()}).strict(),
  note:z.string()}).strict();
export type RadarResponse=z.infer<typeof RadarResponse>;
