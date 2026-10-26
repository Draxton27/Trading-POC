import {z} from 'zod';
import {TechnicalContext,TechnicalLevel} from './technical-context.ts';

const utc=z.iso.datetime({offset:true});
const finite=z.number().finite();
const optionalValue=finite.nullable();
const symbol=z.enum(['NVDA','QQQ','SMH']);
const timeframe=z.enum(['15m','1h','1d']);
const period=z.union([z.literal(20),z.literal(40),z.literal(100),z.literal(200)]);
const pair=z.enum(['BULLISH_ALIGNMENT','BEARISH_ALIGNMENT','MIXED','INSUFFICIENT_DATA']);
const slope=z.enum(['RISING','FALLING','FLAT','UNAVAILABLE']);
export const ScenarioState=z.enum(['OBSERVED','AWAITING_CONFIRMATION','FAILED','EXPIRED','NO_SCENARIO','INSUFFICIENT_DATA']);
export const ScenarioFamily=z.enum(['SMA_PULLBACK_REJECTION','SMA_STRUCTURE_BREAK','SMA_BREAK_RETEST','BOLLINGER_VOLUME_CONTEXT']);
export const ScenarioSource=z.object({name:z.string().min(1),provider:z.string().min(1),feed:z.string().min(1),adjustment:z.string().min(1),
  dataStatus:z.enum(['SYNTHETIC','HISTORICAL','STALE','UNAVAILABLE']),receiptVerified:z.boolean()}).strict();
export const ScenarioTimeframeContext=z.object({timeframe,barEndUtc:utc.nullable(),shortPair:pair,longPair:pair,state:pair,
  smas:z.object({'20':z.object({value:optionalValue,slope,priceDistancePercent:optionalValue,priceAboveSma:z.boolean().nullable(),priceBelowSma:z.boolean().nullable()}).strict(),
    '40':z.object({value:optionalValue,slope,priceDistancePercent:optionalValue,priceAboveSma:z.boolean().nullable(),priceBelowSma:z.boolean().nullable()}).strict(),
    '100':z.object({value:optionalValue,slope,priceDistancePercent:optionalValue,priceAboveSma:z.boolean().nullable(),priceBelowSma:z.boolean().nullable()}).strict(),
    '200':z.object({value:optionalValue,slope,priceDistancePercent:optionalValue,priceAboveSma:z.boolean().nullable(),priceBelowSma:z.boolean().nullable()}).strict()}).strict()}).strict();
export const ScenarioContradiction=z.object({timeframe,component:z.enum(['SMA20_40','SMA100_200','TIMEFRAME']),detail:z.string().min(1)}).strict();
export const ScenarioEvidence=z.object({kind:z.enum(['CROSS','FULL_CANDLE_BREAK','RETEST','REJECTION','RECOVERY','BOLLINGER_VOLUME']),
  description:z.string().min(1),barStartUtc:utc,observedAtUtc:utc,availableAtUtc:utc.nullable()}).strict();
export const ScenarioBollingerVolume=z.object({close:finite.positive(),upper:optionalValue,middle:optionalValue,lower:optionalValue,
  position:z.enum(['ABOVE_UPPER','BELOW_LOWER','INSIDE','ON_BAND','UNAVAILABLE']),relativeVolume20:optionalValue,
  returnOneBarPercent:optionalValue,returnFourBarsPercent:optionalValue}).strict();
export const InvestepScenario=z.object({id:z.string().regex(/^[a-f0-9]{64}$/),symbol,family:ScenarioFamily,timeframe,
  direction:z.enum(['ABOVE','BELOW','NEUTRAL']),state:ScenarioState,scope:z.enum(['CURRENT','HISTORICAL']),period:period.nullable(),
  breakAtUtc:utc.nullable(),barsSinceBreak:z.number().int().nonnegative().nullable(),eventAtUtc:utc,availableAtUtc:utc.nullable(),
  asOfUtc:utc,source:ScenarioSource,feed:z.string().min(1),adjustment:z.string().min(1),dataStatus:ScenarioSource.shape.dataStatus,
  trigger:ScenarioEvidence,context:z.object({alignment:z.enum(['ALIGNED_BULLISH','ALIGNED_BEARISH',
    'SHORT_TERM_PULLBACK','SHORT_TERM_RECOVERY','CONFLICTING','MIXED','INSUFFICIENT_DATA']),
    frames:z.object({'15m':ScenarioTimeframeContext,'1h':ScenarioTimeframeContext,'1d':ScenarioTimeframeContext}).strict()}).strict().nullable(),
  confirmations:z.array(ScenarioEvidence),contradictions:z.array(ScenarioContradiction),limitations:z.array(z.string()),
  relatedLevels:z.array(TechnicalLevel).max(20),bollingerVolume:ScenarioBollingerVolume.nullable()}).strict();
export type InvestepScenario=z.infer<typeof InvestepScenario>;
export const InvestepScenarioResponse=z.object({status:z.enum(['AVAILABLE','NO_SCENARIO','INSUFFICIENT_DATA','UNAVAILABLE']),symbol,
  asOfUtc:utc,source:ScenarioSource,alignment:z.enum(['ALIGNED_BULLISH','ALIGNED_BEARISH','SHORT_TERM_PULLBACK',
    'SHORT_TERM_RECOVERY','CONFLICTING','MIXED','INSUFFICIENT_DATA']),
  frames:z.object({'15m':ScenarioTimeframeContext,'1h':ScenarioTimeframeContext,'1d':ScenarioTimeframeContext}).strict(),
  current:z.array(InvestepScenario).max(40),historical:z.array(InvestepScenario).max(50),
  levels:z.array(TechnicalLevel).max(1000),previousRanges:TechnicalContext.shape.previousRanges,limitations:z.array(z.string()),
  note:z.string().min(1)}).strict();
export type InvestepScenarioResponse=z.infer<typeof InvestepScenarioResponse>;
