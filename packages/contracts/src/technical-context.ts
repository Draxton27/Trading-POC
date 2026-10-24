import {z} from 'zod';

const utc=z.iso.datetime({offset:true});
const frame=z.enum(['15m','1h','1d']);
const period=z.union([z.literal(20),z.literal(40),z.literal(100),z.literal(200)]);
const pair=z.enum(['BULLISH_ALIGNMENT','BEARISH_ALIGNMENT','MIXED','INSUFFICIENT_DATA']);
const finite=z.number().finite();
const nullableFinite=finite.nullable();
export const TechnicalSma=z.object({period,value:nullableFinite,previousValue:nullableFinite,slopePercent:nullableFinite,
  slope:z.enum(['RISING','FALLING','FLAT','UNAVAILABLE']),priceDistancePercent:nullableFinite,priceAboveSma:z.boolean().nullable(),priceBelowSma:z.boolean().nullable(),
  interactions:z.array(z.enum(['ABOVE','BELOW','EQUAL','CROSSED_ABOVE','CROSSED_BELOW','TOUCHED_FROM_ABOVE','TOUCHED_FROM_BELOW','REJECTED_ABOVE','REJECTED_BELOW','FULL_BODY_BREAK_ABOVE','FULL_BODY_BREAK_BELOW','FULL_CANDLE_BREAK_ABOVE','FULL_CANDLE_BREAK_BELOW'])),
  availableAtUtc:utc.nullable()}).strict();
export const TechnicalTimeframe=z.object({timeframe:frame,lastCompleteBarUtc:utc.nullable(),lastBarStartUtc:utc.nullable(),scheduledAbbreviated:z.boolean().nullable(),
  completeBarsInRun:z.number().int().nonnegative(),smas:z.object({'20':TechnicalSma,'40':TechnicalSma,'100':TechnicalSma,'200':TechnicalSma}).strict(),
  shortPair:pair,longPair:pair,state:pair,limitations:z.array(z.string())}).strict();
export const TechnicalLevel=z.object({symbol:z.enum(['NVDA','QQQ','SMH']),timeframe:frame,kind:z.enum(['MOVING_AVERAGE','PREVIOUS_PERIOD_HIGH','PREVIOUS_PERIOD_LOW','PREVIOUS_SESSION_HIGH','PREVIOUS_SESSION_LOW']),
  period:z.number().int().positive().nullable(),levelPrice:finite.positive(),distancePercent:nullableFinite,referenceStartUtc:utc,referenceEndUtc:utc,availableAtUtc:utc,
  source:z.string(),method:z.string(),status:z.literal('POTENTIAL')}).strict();
export const TechnicalEvent=z.object({timeframe:frame,kind:z.enum(['CROSS','FULL_CANDLE_BREAK','RETEST','REJECTION','RECOVERY']),period,
  atUtc:utc,barStartUtc:utc,direction:z.enum(['ABOVE','BELOW']),status:z.enum(['OBSERVED','PENDING','FAILED','EXPIRED']),breakAtUtc:utc.nullable(),description:z.string()}).strict();
export const TechnicalContext=z.object({symbol:z.enum(['NVDA','QQQ','SMH']),asOfUtc:utc,source:z.string(),provider:z.string(),feed:z.string(),adjustment:z.string(),
  historicalOrSynthetic:z.enum(['HISTORICAL','SYNTHETIC']),dataStatus:z.enum(['HISTORICAL','SYNTHETIC','STALE','UNAVAILABLE']),lastCompleteBarUtc:utc.nullable(),ageMinutes:nullableFinite,
  timeframes:z.object({'15m':TechnicalTimeframe,'1h':TechnicalTimeframe,'1d':TechnicalTimeframe}).strict(),
  alignment:z.enum(['ALIGNED_BULLISH','ALIGNED_BEARISH','SHORT_TERM_PULLBACK','SHORT_TERM_RECOVERY','CONFLICTING','MIXED','INSUFFICIENT_DATA']),
  previousRanges:z.array(z.object({sessions:z.union([z.literal(5),z.literal(20),z.literal(60)]),high:nullableFinite,low:nullableFinite,distanceToHighPercent:nullableFinite,
    distanceToLowPercent:nullableFinite,breakAboveHigh:z.boolean().nullable(),breakBelowLow:z.boolean().nullable(),referenceStartUtc:utc.nullable(),referenceEndUtc:utc.nullable(),status:z.enum(['AVAILABLE','UNAVAILABLE'])}).strict()),
  levels:z.array(TechnicalLevel),events:z.array(TechnicalEvent),limitations:z.array(z.string())}).strict();
export type TechnicalContext=z.infer<typeof TechnicalContext>;
