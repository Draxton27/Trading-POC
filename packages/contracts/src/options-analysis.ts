import {z} from 'zod';

const money=z.number().finite().nullable();
const utc=z.iso.datetime({offset:true});
const feed=z.enum(['LIVE','DELAYED','FROZEN','DELAYED_FROZEN','UNKNOWN']);
const right=z.enum(['CALL','PUT']);

export const OptionAcademyContext=z.object({
  status:z.enum(['BELOW_RANGE','WITHIN_RANGE','ABOVE_RANGE','NO_REFERENCE','NO_ASK','STALE_QUOTE','INSUFFICIENT_DATA']),
  referenceStatus:z.enum(['ACTIVE','REFERENCE_DATE','HISTORICAL_ONLY','CONFLICT','NONE']),
  reason:z.string(),minAskCents:z.number().int().positive().nullable(),maxAskCents:z.number().int().positive().nullable(),
  outerMinCents:z.number().int().positive().nullable(),outerMaxCents:z.number().int().positive().nullable(),
  referenceDate:z.string().nullable(),validFrom:z.string().nullable(),validTo:z.string().nullable(),
  quoteReceivedAtUtc:z.string().nullable()
}).strict();

export const OptionAnalysisInput=z.object({
  contract:z.object({conId:money,symbol:z.string().nullable(),occSymbol:z.string().nullable(),right:right.nullable(),
    strike:money,expiration:z.string().nullable(),multiplier:money,currency:z.string().nullable()}).strict(),
  quote:z.object({bid:money,ask:money,bidSize:money,askSize:money,receivedAtUtc:z.string().nullable(),
    marketTimestampUtc:z.string().nullable(),feedType:feed,provider:z.string().nullable(),
    marketDataStatus:z.enum(['permission_denied','unavailable','partial']).nullable(),permissionDenied:z.boolean()}).strict(),
  quantity:z.number().finite(),capitalUsd:money,entryFeePerContractUsd:money,expirationFeePerContractUsd:money,
  hypotheticalUnderlyingAtExpirationUsd:money,academy:OptionAcademyContext.nullable(),asOfUtc:utc
}).strict();
export type OptionAnalysisInput=z.infer<typeof OptionAnalysisInput>;

export const OptionQuoteQuality=z.object({status:z.enum(['LIVE_RECENT','LIVE_STALE','LIVE_UNVERIFIED','DELAYED','FROZEN',
  'DELAYED_FROZEN','UNKNOWN','PARTIAL','MISSING','PERMISSION_DENIED','SIMULATED','INVALID']),
  bidAskStatus:z.enum(['VALID','BID_MISSING','ASK_MISSING','BOTH_MISSING','BID_ZERO','ASK_NON_POSITIVE','CROSSED','INVALID']),
  feedType:feed,provider:z.string().nullable(),receivedAtUtc:z.string().nullable(),marketTimestampUtc:z.string().nullable(),
  bid:money,ask:money,bidSize:money,askSize:money,askCurrentVerified:z.boolean(),reason:z.string()}).strict();
export const OptionExpirationAnalysis=z.object({status:z.enum(['TODAY','FUTURE','PASSED','INVALID']),
  expirationDate:z.string().nullable(),daysCalendar:z.number().int().nonnegative().nullable(),asOfDateNy:z.string()}).strict();
export const OptionPremiumAnalysis=z.object({grossPremiumUsd:money,maximumPremiumLossUsd:money,entryFeesUsd:money,
  maximumNetLossWithEntryFeesUsd:money,breakEvenGrossUsd:money,breakEvenWithProvidedFeesUsd:money,
  feesCompleteForNet:z.boolean(),cashOutlayWithKnownEntryFeesUsd:money}).strict();
export const OptionSpreadAnalysis=z.object({absolutePerShareUsd:money,percentOfMidpoint:money,
  immediateGrossDifferenceUsd:money,immediateDifferencePercentOfPremium:money,reason:z.string()}).strict();
export const OptionCapitalExposure=z.object({status:z.enum(['AVAILABLE','BUDGET_EXCEEDED','NO_CAPITAL','NO_VALID_COST']),
  capitalUsd:money,quantity:z.number().int().positive().nullable(),grossPremiumUsd:money,
  cashOutlayWithKnownEntryFeesUsd:money,committedPercent:money,remainingUsd:money,
  maximumWholeContracts:z.number().int().nonnegative().nullable(),feesExcludedFromBudget:z.boolean()}).strict();
export const OptionExpirationPayoff=z.object({underlyingPriceUsd:money,intrinsicPerShareUsd:money,
  totalIntrinsicUsd:money,grossPnlUsd:money,netPnlUsd:money,returnOnGrossPremiumPercent:money}).strict();
export const OptionAnalysisResult=z.object({status:z.enum(['READY','PARTIAL','INVALID_CONTRACT','INVALID_INPUT']),
  contractStatus:z.enum(['VALID','INVALID']),contractIssues:z.array(z.string()),inputIssues:z.array(z.string()),
  identity:z.object({conId:money,symbol:z.string().nullable(),occSymbol:z.string().nullable(),right:right.nullable(),
    strike:money,expiration:z.string().nullable(),multiplier:money,currency:z.string().nullable()}).strict(),
  quantity:z.number().int().positive().nullable(),asOfUtc:utc,expiration:OptionExpirationAnalysis,
  quote:OptionQuoteQuality,premium:OptionPremiumAnalysis,spread:OptionSpreadAnalysis,
  capital:OptionCapitalExposure,payoff:OptionExpirationPayoff,academy:OptionAcademyContext.nullable(),
  limitations:z.array(z.string())}).strict();
export type OptionAnalysisResult=z.infer<typeof OptionAnalysisResult>;
