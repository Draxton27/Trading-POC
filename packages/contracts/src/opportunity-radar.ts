import {z} from 'zod';
import {InvestepScenario} from './investep-scenarios.ts';
import {IexModelProbabilities} from './ml.ts';
import {OptionAnalysisInput,OptionAnalysisResult} from './options-analysis.ts';

const utc=z.iso.datetime({offset:true});
const sha=z.string().regex(/^[a-f0-9]{64}$/);
const note=z.string().min(1).max(500);
export const OpportunityStatus=z.enum(['TECHNICAL_CANDIDATE','AWAITING_CONFIRMATION',
  'CONTRADICTORY_CONTEXT','CONTRACT_DATA_PENDING','CONTRACT_QUOTE_UNVERIFIED',
  'CONTRACT_CONSTRAINT_FAILED','REVIEWABLE_PAPER_CANDIDATE','NO_CANDIDATE',
  'INSUFFICIENT_DATA','STALE_MARKET_DATA']);
export type OpportunityStatus=z.infer<typeof OpportunityStatus>;
export const OpportunityDetected=z.object({candidateId:sha,ruleVersion:z.enum(['41O_V1','41O_V2_REST_CONTEXT']),
  detectedAtUtc:utc,technicalEvidenceAvailableAtUtc:utc,marketSource:z.literal('Alpaca Market Data API'),
  marketFeed:z.literal('IEX Live'),adjustment:z.literal('raw'),symbol:z.literal('NVDA'),
  barStartUtc:utc,barEndUtc:utc,sourceBarHash:sha,sourceWindowHash:sha,calendarHash:sha,
  sourceHashes:z.array(sha).max(256),sourceHashCount:z.number().int().positive(),
  warmup:z.enum(['REST_REGISTERED','LIVE_ONLY']),
  warmupCsvSha256:sha.nullable(),warmupRegisteredAtUtc:utc.nullable(),
  observedUnderlyingPrice:z.number().finite().positive(),directionHypothesis:z.enum(['CALL','PUT']),
  scenario:InvestepScenario,status:OpportunityStatus,exclusionReasons:z.array(note).max(20),
  outcomeScheduledEndUtc:utc.nullable()}).strict();
export type OpportunityDetected=z.infer<typeof OpportunityDetected>;
export const OpportunityContractSnapshot=z.object({candidateId:sha,conId:z.number().int().positive().safe(),
  observedAtUtc:utc,contract:OptionAnalysisInput.shape.contract,
  quoteSnapshot:OptionAnalysisInput.shape.quote,analysis:OptionAnalysisResult,
  status:OpportunityStatus,exclusionReasons:z.array(note).max(20)}).strict();
export type OpportunityContractSnapshot=z.infer<typeof OpportunityContractSnapshot>;
export const OpportunityTechnicalUpdate=z.object({candidateId:sha,scenarioId:sha,
  observedAtUtc:utc,scenarioState:InvestepScenario.shape.state,
  evidenceAvailableAtUtc:utc,sourceBarHash:sha,scenario:InvestepScenario,
  status:OpportunityStatus,exclusionReasons:z.array(note).max(20)}).strict();
export const OpportunityUnderlyingOutcome=z.object({candidateId:sha,evaluatedAtUtc:utc,
  outcomeEndUtc:utc,firstVersionBarHashes:z.array(sha).length(4),
  close:z.number().finite().positive(),movementPercent:z.number().finite()}).strict();
export const OpportunityLedgerRecord=z.discriminatedUnion('kind',[
  z.object({schema:z.literal('phase41o-opportunity-v1'),kind:z.literal('DETECTED'),recordId:sha,
    previousHash:sha.nullable(),recordHash:sha,registeredAtUtc:utc,payload:OpportunityDetected}).strict(),
  z.object({schema:z.literal('phase41o-opportunity-v1'),kind:z.literal('CONTRACT_OBSERVED'),recordId:sha,
    previousHash:sha.nullable(),recordHash:sha,registeredAtUtc:utc,payload:OpportunityContractSnapshot}).strict(),
  z.object({schema:z.literal('phase41o-opportunity-v1'),kind:z.literal('CONTRACT_ATTEMPT'),recordId:sha,
    previousHash:sha.nullable(),recordHash:sha,registeredAtUtc:utc,payload:z.object({candidateId:sha,attemptId:z.uuid(),attemptAtUtc:utc,
      code:z.enum(['CHECKED','DISCONNECTED','PACING','PERMISSION','TIMEOUT','NOT_FOUND','AMBIGUOUS','LIMIT',
        'INVALID_CONTRACT','BROKER_ERROR','PAGE_TIMEOUT','NO_CONTRACT'])}).strict()}).strict(),
  z.object({schema:z.literal('phase41o-opportunity-v1'),kind:z.literal('TECHNICAL_UPDATE'),recordId:sha,
    previousHash:sha.nullable(),recordHash:sha,registeredAtUtc:utc,payload:OpportunityTechnicalUpdate}).strict(),
  z.object({schema:z.literal('phase41o-opportunity-v1'),kind:z.literal('UNDERLYING_OUTCOME'),recordId:sha,
    previousHash:sha.nullable(),recordHash:sha,registeredAtUtc:utc,payload:OpportunityUnderlyingOutcome}).strict(),
]);
export type OpportunityLedgerRecord=z.infer<typeof OpportunityLedgerRecord>;
export const OpportunityModelContext=z.object({predictionId:z.string().min(1),registeredAtUtc:utc,
  modelSha256:sha,protocolSha256:sha,probabilities:IexModelProbabilities}).strict();
export const OpportunityCase=z.object({candidate:OpportunityDetected,registeredAtUtc:utc,
  technicalUpdates:z.array(OpportunityTechnicalUpdate).max(100),
  contractAttempts:z.array(z.object({candidateId:sha,attemptId:z.uuid(),attemptAtUtc:utc,code:z.string()}).strict()).max(30),
  contracts:z.array(OpportunityContractSnapshot).max(20),
  model:OpportunityModelContext.nullable(),underlyingOutcome:OpportunityUnderlyingOutcome.nullable(),
  optionOutcome:z.literal('OPTION_OUTCOME_UNAVAILABLE'),currentStatus:OpportunityStatus}).strict();
export type OpportunityCase=z.infer<typeof OpportunityCase>;
export const OpportunitySourceState=z.enum(['AVAILABLE','NO_CANDIDATES','UNAVAILABLE','INVALID_SOURCE','DEMO']);
export const OpportunityRadarStatus=z.object({status:OpportunitySourceState,mode:z.enum(['DEMO','OFFLINE','PAPER']),
  collectorStatus:z.string().nullable(),lastCompleteBarEndUtc:utc.nullable(),
  lastCompleteReceivedAtUtc:utc.nullable(),ageMinutes:z.number().finite().nonnegative().nullable(),
  ibkrConnected:z.boolean(),ibkrSimulation:z.boolean(),candidateCount:z.number().int().nonnegative(),
  lastCandidateAtUtc:utc.nullable(),quoteVerification:z.string(),limitations:z.array(note).max(20)}).strict();
export type OpportunityRadarStatus=z.infer<typeof OpportunityRadarStatus>;
export const OpportunityCasePage=z.object({status:OpportunitySourceState,items:z.array(OpportunityCase).max(100),
  total:z.number().int().nonnegative(),offset:z.number().int().nonnegative(),limit:z.number().int().min(1).max(100),
  nextOffset:z.number().int().nonnegative().nullable()}).strict();
export type OpportunityCasePage=z.infer<typeof OpportunityCasePage>;
export const OpportunityLedgerVerification=z.object({status:OpportunitySourceState,records:z.number().int().nonnegative(),
  candidateCount:z.number().int().nonnegative(),headHash:sha.nullable()}).strict();
