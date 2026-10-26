import {z} from 'zod';

const utc=z.iso.datetime({offset:true}).refine(value=>value.endsWith('Z'),'Se requiere timestamp UTC con Z');
const id=z.uuid();
const premium=z.number().finite().positive().max(1_000_000);
const fee=z.number().finite().nonnegative().max(1_000_000).nullable();
const text=z.string().trim().max(1000);
export const SimulatorPriceOrigin=z.enum(['MANUAL_INPUT','OBSERVED_ASK_REFERENCE','OBSERVED_BID_REFERENCE']);
export const SimulatorPlan=z.object({entryReason:text.optional(),observedTrend:text.optional(),reviewedTimeframes:text.optional(),
  expectedConfirmation:text.optional(),relevantSma:text.optional(),supportResistance:text.optional(),
  invalidation:text.optional(),profitObjective:text.optional(),lossLimit:text.optional(),humanDecisionId:text.optional()}).strict();
export const SimulatorOpenRequest=z.object({idempotencyKey:id,conId:z.number().int().positive().safe(),
  quantity:z.number().int().min(1).max(10_000),premiumPerShare:premium,
  priceOrigin:z.enum(['MANUAL_INPUT','OBSERVED_ASK_REFERENCE']),referencePrice:premium.optional(),
  entryFeeUsd:fee,decisionAtUtc:utc,simulatedEntryAtUtc:utc,plan:SimulatorPlan.optional(),
  confirmHypothetical:z.literal(true)}).strict();
export const SimulatorCloseRequest=z.object({idempotencyKey:id,quantity:z.number().int().min(1).max(10_000),
  premiumPerShare:premium,priceOrigin:z.enum(['MANUAL_INPUT','OBSERVED_BID_REFERENCE']),referencePrice:premium.optional(),
  exitFeeUsd:fee,decisionAtUtc:utc,simulatedExitAtUtc:utc,reason:text.min(1),confirmHypothetical:z.literal(true)}).strict();
export const SimulatorAddLotRequest=SimulatorOpenRequest.omit({conId:true});
export const SimulatorNoteRequest=z.object({idempotencyKey:id,note:text.min(1)}).strict();
export const SimulatorPlanRequest=z.object({idempotencyKey:id,plan:SimulatorPlan,reason:text.min(1)}).strict();
export const SimulatorContract=z.object({conId:z.number().int().positive().safe(),occSymbol:z.string().nullable(),
  underlying:z.literal('NVDA'),right:z.enum(['CALL','PUT']),strike:premium,
  expiration:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),multiplier:z.number().int().positive().max(100_000),
  currency:z.literal('USD')}).strict();
export const SimulatorQuoteReference=z.object({conId:z.number().int().positive().safe(),bid:z.number().nonnegative().nullable(),
  ask:z.number().nonnegative().nullable(),provider:z.string().nullable(),feedType:z.string(),
  receivedAtUtc:utc.nullable(),marketTimestampUtc:utc.nullable(),quality:z.string(),
  capturedAtUtc:utc}).strict();
export const SimulatorLot=z.object({lotId:z.string().min(1),quantity:z.number().int().min(1).max(10_000),
  premiumPerShare:premium,entryFeeUsd:fee,decisionAtUtc:utc,simulatedEntryAtUtc:utc,
  priceOrigin:z.enum(['MANUAL_INPUT','OBSERVED_ASK_REFERENCE']),fillStatus:z.literal('HYPOTHETICAL'),
  quoteReference:SimulatorQuoteReference.nullable(),entryReason:text.optional()}).strict();
export const SimulatorClose=z.object({quantity:z.number().int().min(1).max(10_000),premiumPerShare:premium,
  exitFeeUsd:fee,decisionAtUtc:utc,simulatedExitAtUtc:utc,reason:text.min(1),
  priceOrigin:z.enum(['MANUAL_INPUT','OBSERVED_BID_REFERENCE']),fillStatus:z.literal('HYPOTHETICAL'),
  quoteReference:SimulatorQuoteReference.nullable()}).strict();
const body=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('SIM_POSITION_OPENED'),payload:z.object({contract:SimulatorContract,lot:SimulatorLot,
    plan:SimulatorPlan,classification:z.enum(['DOCUMENTED_ON_TIME','HISTORICAL_SIMULATION','DEMO_SYNTHETIC'])}).strict()}).passthrough(),
  z.object({kind:z.literal('SIM_POSITION_LOT_ADDED'),payload:z.object({lot:SimulatorLot}).strict()}).passthrough(),
  z.object({kind:z.literal('SIM_POSITION_PARTIALLY_CLOSED'),payload:SimulatorClose}).passthrough(),
  z.object({kind:z.literal('SIM_POSITION_CLOSED'),payload:SimulatorClose}).passthrough(),
  z.object({kind:z.literal('SIM_POSITION_NOTE_ADDED'),payload:z.object({note:text.min(1)}).strict()}).passthrough(),
  z.object({kind:z.literal('SIM_POSITION_PLAN_UPDATED'),payload:z.object({plan:SimulatorPlan,reason:text.min(1)}).strict()}).passthrough()]);
export const SimulatorLedgerEvent=z.intersection(body,z.object({schemaVersion:z.literal(1),
  environment:z.literal('INTERNAL_SIMULATOR'),executionSource:z.literal('MANUAL_HYPOTHETICAL'),
  simulationEventId:z.string().min(1),simulationId:z.string().min(1),positionId:z.string().min(1),
  idempotencyKey:id,requestHash:z.string().regex(/^[a-f0-9]{64}$/),recordedAtUtc:utc,
  sequence:z.number().int().positive(),previousHash:z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  hash:z.string().regex(/^[a-f0-9]{64}$/)}).passthrough());
export type SimulatorContract=z.infer<typeof SimulatorContract>;
export type SimulatorQuoteReference=z.infer<typeof SimulatorQuoteReference>;
export type SimulatorPlan=z.infer<typeof SimulatorPlan>;
export type SimulatorOpenRequest=z.infer<typeof SimulatorOpenRequest>;
export type SimulatorCloseRequest=z.infer<typeof SimulatorCloseRequest>;
