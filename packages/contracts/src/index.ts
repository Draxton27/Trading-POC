import {z} from 'zod';
export * from './ml.ts';
export {boundedMs,agentRequestBudgets,twsRequestBudgets} from './request-budgets.ts';

export const PROTOCOL_VERSION = 1 as const;
export const utc = z.iso.datetime({offset: true});
export const symbol = z.enum(['NVDA', 'QQQ', 'SMH']);
export const Mode = z.enum(['DEMO', 'OFFLINE', 'PAPER']);
export const FeedType = z.enum(['LIVE', 'DELAYED', 'FROZEN', 'DELAYED_FROZEN', 'UNKNOWN']);
export const MarketDataErrorStatus=z.enum(['permission_denied','unavailable','partial']);
export const AcademyValidationStatus=z.enum(['DOCUMENTED','HYPOTHESIS','DERIVED','UNVERIFIED']);
export const AcademyEvaluationStatus=z.enum(['BELOW_RANGE','WITHIN_RANGE','ABOVE_RANGE','NO_REFERENCE','NO_ASK','STALE_QUOTE','INSUFFICIENT_DATA']);
export const AcademyReferenceStatus=z.enum(['ACTIVE','REFERENCE_DATE','HISTORICAL_ONLY','CONFLICT','NONE']);
export const AcademyAskRange=z.object({id:z.string().min(1),asset:z.string().regex(/^[A-Z.]{1,12}$/),optionRight:z.enum(['CALL','PUT']).nullable(),
  minAskCents:z.number().int().positive(),maxAskCents:z.number().int().positive(),outerMinCents:z.number().int().positive().safe().nullable().optional(),outerMaxCents:z.number().int().positive().safe().nullable().optional(),currency:z.literal('USD'),unit:z.literal('PER_SHARE'),
  referenceDate:z.string().date().nullable(),validFrom:z.string().date().nullable(),validTo:z.string().date().nullable(),
  documentHash:z.string().regex(/^[a-f0-9]{64}$/),sourceFile:z.string().min(1),sourceLocation:z.string().min(1),versionId:z.string().min(1),
  extractionMethod:z.enum(['XLSX_TABLE','CSV_TABLE','HTML_TABLE','MANUAL_REVIEW']),validationStatus:AcademyValidationStatus,
  notes:z.string().nullable(),importedAtUtc:utc});
export type AcademyAskRange=z.infer<typeof AcademyAskRange>;
export const AcademyAskEvaluation=z.object({status:AcademyEvaluationStatus,referenceStatus:AcademyReferenceStatus,
  reference:AcademyAskRange.nullable(),askCents:z.number().int().positive().nullable(),distancePercent:z.number().nullable(),
  reason:z.string().min(1),quoteReceivedAtUtc:utc.nullable()});
export type AcademyAskEvaluation=z.infer<typeof AcademyAskEvaluation>;
export const MarketBar = z.object({symbol, timeframe:z.enum(['15m','1h','1d']), startUtc:utc,endUtc:utc,
  open:z.number().positive(), high:z.number().positive(),low:z.number().positive(),close:z.number().positive(),
  volume:z.number().nonnegative().nullable(),provider:z.string().min(1),adjustment:z.string(),
  receivedAtUtc:utc.nullable(),isComplete:z.boolean()}).refine(b=>b.high>=Math.max(b.open,b.close,b.low)&&b.low<=Math.min(b.open,b.close), 'OHLC inválido');
export type MarketBar=z.infer<typeof MarketBar>;
export const MarketQuote=z.object({symbol, bid:z.number().nonnegative().nullable(),ask:z.number().nonnegative().nullable(),last:z.number().nonnegative().nullable(),marketTimestampUtc:utc.nullable(),receivedAtUtc:utc,feedType:FeedType,provider:z.string(),marketDataStatus:MarketDataErrorStatus.optional(),ibkrErrorCode:z.number().int().optional()});
export type MarketQuote=z.infer<typeof MarketQuote>;
export const OptionContract=z.object({conId:z.number().int().positive(),occSymbol:z.string().nullable(),underlying:symbol,right:z.enum(['CALL','PUT']),strike:z.number().positive(),expiration:z.string(),multiplier:z.number().positive().default(100),tradingClass:z.string().nullable()});
export type OptionContract=z.infer<typeof OptionContract>;
export const OptionQuote=z.object({conId:z.number().int().positive(),occSymbol:z.string().nullable(),bid:z.number().nonnegative().nullable(),ask:z.number().nonnegative().nullable(),bidSize:z.number().nonnegative().nullable(),askSize:z.number().nonnegative().nullable(),last:z.number().nonnegative().nullable(),delta:z.number().nullable(),gamma:z.number().nullable(),theta:z.number().nullable(),vega:z.number().nullable(),impliedVolatility:z.number().nonnegative().nullable(),greeksSource:z.string().nullable(),marketTimestampUtc:utc.nullable(),receivedAtUtc:utc,feedType:FeedType,provider:z.literal('IBKR'),marketDataStatus:MarketDataErrorStatus.optional(),ibkrErrorCode:z.number().int().optional()});
export const OptionComparisonRequest=z.object({conId:z.number().int().positive().safe(),consumerId:z.uuid()}).strict();
export type OptionQuote=z.infer<typeof OptionQuote>;
export const BrokerPosition=z.object({accountAlias:z.string(),environment:z.enum(['PAPER','LIVE']),conId:z.number().int(),occSymbol:z.string().nullable(),quantity:z.number(),averageCost:z.number().nullable(),asOfUtc:utc});
export const BrokerExecution=z.object({executionId:z.string(),accountAlias:z.string(),environment:z.enum(['PAPER','LIVE']),conId:z.number().int(),occSymbol:z.string().nullable(),side:z.enum(['BUY','SELL']),quantity:z.number().positive(),price:z.number().nonnegative(),commission:z.number().nullable(),executedAtUtc:utc,receivedAtUtc:utc});
export const BrokerConnectionStatus=z.object({connected:z.boolean(),environment:z.enum(['PAPER','LIVE','UNKNOWN']),accountVerified:z.boolean(),feedType:FeedType,asOfUtc:utc,detail:z.string().nullable()});
export const MarketDataStatus=z.object({mode:Mode,provider:z.string(),feedType:FeedType,asOfUtc:utc,stale:z.boolean(),detail:z.string().nullable()});
export const TradingSignal=z.object({id:z.string(),family:z.string(),direction:z.enum(['bullish','bearish']),confirmationUtc:utc,receivedAtUtc:utc.nullable(),observability:z.string(),theoreticalReturn30m:z.number().nullable(),source:z.string()});
export const HumanDecision=z.object({id:z.string().min(1),symbol,decisionAtUtc:utc,documentedAtUtc:utc,direction:z.enum(['CALL','PUT','no_trade']),reason:z.string().min(1),trend:z.string().optional(),smaNotes:z.string().optional(),levels:z.string().optional(),expectedConfirmation:z.string().optional(),invalidation:z.string().optional(),contractOcc:z.string().optional(),target:z.string().optional(),captureId:z.string().optional(),recordMode:z.enum(['live','historical_reconstruction','post_outcome_annotation'])});
export const TradeReview=z.object({id:z.string(),tradeId:z.string(),documentedAtUtc:utc,reason:z.string(),outcomeKnownAtUtc:utc.nullable()});
export const EconomicEvent=z.object({id:z.string(),category:z.string(),publishedAtUtc:utc.nullable(),sourceUrl:z.url(),verification:z.string()});
export const MarketSubscription=z.object({symbol,kind:z.enum(['stock','option']),conId:z.number().int().optional()});
export const AgentKind=z.enum(['agent.hello','agent.heartbeat','agent.status','agent.error','market.subscribe','market.unsubscribe','market.quote','market.bar','option.resolve','option.parameters','option.quote','broker.positions.request','broker.positions.snapshot','broker.executions.request','broker.executions.snapshot']);
export const AgentMessage=z.object({protocolVersion:z.literal(PROTOCOL_VERSION),messageId:z.uuid(),requestId:z.uuid().nullable(),agentId:z.string().min(1),connectionId:z.uuid(),sequence:z.number().int().nonnegative(),issuedAtUtc:utc,kind:AgentKind,payload:z.record(z.string(),z.unknown()).default({})});
export type AgentMessage=z.infer<typeof AgentMessage>;
export const allowedRequestKinds = ['market.subscribe','market.unsubscribe','option.resolve','option.parameters','broker.positions.request','broker.executions.request'] as const;
export {NewsClassification,NewsCategory,NewsSentiment,NewsRelevance} from './news.ts';
