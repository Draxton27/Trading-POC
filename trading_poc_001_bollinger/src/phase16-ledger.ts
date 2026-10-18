import {createHash} from 'node:crypto';
import {closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync,
  readdirSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

export const FORWARD_START = '2026-10-19T13:30:00.000Z';
export const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
export type Kind = 'bar_receipt' | 'bar_assessment' | 'signal' | 'settlement' | 'correction' | 'human_decision';
export type LedgerRecord = {sequence: number; id: string; kind: Kind; recordedAtUtc: string;
  previousHash: string | null; payload: Record<string, unknown>; hash: string};
const canonical = (record: Omit<LedgerRecord, 'hash'>): string => JSON.stringify(record);

export function verifyLedger(directory: string): LedgerRecord[] {
  if (!existsSync(directory)) return [];
  const names = readdirSync(directory).filter(n => /^\d{8}\.json$/.test(n)).sort();
  const records: LedgerRecord[] = [];
  const ids = new Set<string>();
  for (const [index, name] of names.entries()) {
    if (name !== `${String(index + 1).padStart(8, '0')}.json`) throw new Error('Secuencia del diario incompleta.');
    const value = JSON.parse(readFileSync(join(directory, name), 'utf8')) as LedgerRecord;
    const {hash, ...body} = value;
    if (value.sequence !== index + 1 || value.previousHash !== (records.at(-1)?.hash ?? null) ||
      hash !== sha256(canonical(body)) || ids.has(value.id)) throw new Error(`Diario alterado: ${name}`);
    if (value.kind === 'correction' && !ids.has(String(value.payload.correctsId ?? ''))) {
      throw new Error('Corrección sin registro original.');
    }
    ids.add(value.id); records.push(value);
  }
  return records;
}

export function appendRecord(directory: string, id: string, kind: Kind,
  payload: Record<string, unknown>, recordedAtUtc = new Date().toISOString()): LedgerRecord {
  mkdirSync(directory, {recursive: true});
  const lockPath = join(directory, '.write-lock');
  const lock = openSync(lockPath, 'wx');
  try {
    const records = verifyLedger(directory);
    const prior = records.find(r => r.id === id);
    if (prior) {
      if (prior.kind !== kind || JSON.stringify(prior.payload) !== JSON.stringify(payload)) {
        throw new Error(`ID duplicado con contenido distinto: ${id}`);
      }
      return prior;
    }
    const body = {sequence: records.length + 1, id, kind, recordedAtUtc,
      previousHash: records.at(-1)?.hash ?? null, payload};
    const record = {...body, hash: sha256(canonical(body))};
    const name = `${String(record.sequence).padStart(8, '0')}.json`;
    const temporary = join(directory, `.${name}.${process.pid}.partial`);
    const fd = openSync(temporary, 'wx');
    try {writeFileSync(fd, JSON.stringify(record) + '\n'); fsyncSync(fd);} finally {closeSync(fd);}
    renameSync(temporary, join(directory, name));
    const dirFd = openSync(directory, 'r');
    try {fsyncSync(dirFd);} finally {closeSync(dirFd);}
    return record;
  } finally {closeSync(lock); unlinkSync(lockPath);}
}

export function appendCorrection(directory: string, originalId: string, correctionId: string,
  reason: string, patch: Record<string, unknown>, at = new Date().toISOString()): LedgerRecord {
  if (!reason.trim() || !verifyLedger(directory).some(r => r.id === originalId)) {
    throw new Error('Corrección requiere motivo y registro original.');
  }
  return appendRecord(directory, correctionId, 'correction',
    {correctsId: originalId, reason, patch}, at);
}

export type HumanDecision = {symbol: string; direction: 'bullish' | 'bearish' | 'no_trade';
  operationType: 'pullback' | 'breakout' | 'reversal' | 'other' | 'no_trade';
  timeframe: string | null; decisionAtUtc: string; documentedAtUtc: string;
  sma20: string | null; sma40: string | null; sma100: string | null; sma200: string | null;
  plannedEntry: number | null; plannedInvalidation: number | null;
  exitCriterion: string | null; selectionReason: string;
  chartCaptureId: string | null; observedMarket: boolean | null;
  outcomeKnownAtUtc: string | null};

export function validateHumanDecision(decision: HumanDecision, now: string):
  'prospective' | 'retrospective' | 'timing_unverified' {
  if (decision.symbol !== 'NVDA' || !Number.isFinite(Date.parse(decision.decisionAtUtc)) ||
      !Number.isFinite(Date.parse(decision.documentedAtUtc)) ||
      Date.parse(decision.decisionAtUtc) > Date.parse(now) ||
      Date.parse(decision.documentedAtUtc) > Date.parse(now) ||
      !decision.selectionReason.trim()) throw new Error('Decisión humana incompleta o fechada en el futuro.');
  if (decision.direction === 'no_trade' && decision.operationType !== 'no_trade') {
    throw new Error('No operar requiere tipo no_trade.');
  }
  if (decision.documentedAtUtc <= decision.decisionAtUtc) return 'prospective';
  if (!decision.outcomeKnownAtUtc) return 'timing_unverified';
  if (!Number.isFinite(Date.parse(decision.outcomeKnownAtUtc))) throw new Error('Hora de resultado inválida.');
  return decision.documentedAtUtc < decision.outcomeKnownAtUtc ? 'prospective' : 'retrospective';
}

export function matchHumanSignal(signal: {direction: string; family: string; availableAtUtc: string},
  human: HumanDecision): 'both' | 'human_only' | 'system_only' | 'no_trade' {
  if (human.direction === 'no_trade') return 'no_trade';
  const kind = signal.family.startsWith('failed_') ? 'reversal' :
    signal.family.startsWith('pullback_') ? 'pullback' : 'breakout';
  return human.symbol === 'NVDA' && human.direction === signal.direction &&
    human.operationType === kind &&
    Math.abs(Date.parse(human.decisionAtUtc) - Date.parse(signal.availableAtUtc)) <= 900_000 &&
    human.documentedAtUtc < new Date(Date.parse(signal.availableAtUtc) + 1_800_000).toISOString() ?
    'both' : 'system_only';
}

export function operationalStatus(receivedAtUtc: string, recordedAtUtc: string,
  nextOpenUtc: string, recovered: boolean, historical: boolean) {
  if (recovered) return 'recovered_after_failure';
  if (historical) return 'historical_reconstruction';
  return receivedAtUtc <= nextOpenUtc && recordedAtUtc <= nextOpenUtc ? 'on_time' : 'delayed';
}
