import {z} from 'zod';

const utc=z.iso.datetime({offset:true});
const decimal=z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d{1,8})?$/);
export const RealTradeExecution=z.object({
  environment:z.literal('REAL'),accountAlias:z.literal('Primary'),executionId:z.string().min(1).max(120),orderId:z.string().max(120).nullable(),
  conId:z.number().int().positive().safe().nullable(),contract:z.string().max(240).nullable(),asset:z.string().regex(/^[A-Z0-9.]{1,20}$/),instrument:z.string().max(40).nullable(),
  side:z.enum(['BUY','SELL']),quantity:decimal,unitPrice:decimal.nullable(),multiplier:decimal.nullable(),grossAmount:decimal.nullable(),currency:z.string().regex(/^[A-Z]{3}$/),
  commission:decimal.nullable(),reportedRealizedPnl:decimal.nullable(),executedAtUtc:utc,executedAtNewYork:z.string().min(1),
  quality:z.enum(['COMPLETE','INCOMPLETE_CONTRACT','INCOMPLETE_PRICE','INCOMPLETE_CONTRACT_AND_PRICE']),sourceOriginal:z.string().max(120).nullable()
}).strict();
export type RealTradeExecution=z.infer<typeof RealTradeExecution>;
export const RealTradeImportStatus=z.enum(['SUCCESS_COVERAGE_UNVERIFIED','PARTIAL_COVERAGE_UNVERIFIED','FAILED','RUNNING']);
export const RealTradeDiagnostic=z.object({configured:z.boolean(),lastRun:z.object({status:RealTradeImportStatus,activity:z.enum(['ACTIVE','INTERRUPTED','COMPLETED','UNKNOWN']),source:z.string(),startedAtUtc:utc,lastActivityAtUtc:utc.nullable(),finishedAtUtc:utc.nullable(),received:z.number().int(),inserted:z.number().int(),unchanged:z.number().int(),revised:z.number().int(),conflicts:z.number().int(),rejected:z.number().int(),errorCode:z.string().nullable(),coverage:z.literal('UNVERIFIED')}).nullable(),interruptedRunCount:z.number().int().nonnegative(),executionCount:z.number().int(),incompleteIdentityCount:z.number().int(),conflictCount:z.number().int(),pendingReconciliationCount:z.number().int(),coverage:z.literal('UNVERIFIED')}).strict();
