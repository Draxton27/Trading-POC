import {createHash} from 'node:crypto';
import {closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import type {Candle} from './domain.ts';
import {newYorkBarParts} from './strategy-validation.ts';
import type {MarketCalendar} from './alpaca-calendar.ts';

export type IngestionStatus = 'READY' | 'NO_DATA' | 'DELAYED' | 'PERMISSION_DENIED' | 'RATE_LIMIT' | 'HTTP_ERROR' | 'NETWORK_ERROR' | 'INVALID_DATA';
export type IngestionRecord = {
  schema: 'phase32-alpaca-v1'; recordId: string; previousHash: string | null; recordHash: string;
  kind: 'bar' | 'status' | 'query'; receivedAtUtc: string; status: IngestionStatus; detail: string;
  provider: 'Alpaca Market Data API'; feed: 'sip'; adjustment: 'split';
  availability: 'CURRENT' | 'DELAYED' | 'UNAVAILABLE'; responseSha256: string | null;
  bar: {startUtc: string; endUtc: string; open: number; high: number; low: number; close: number; volume: number; revision: number} | null;
  effectiveDelayMs: number | null;
  queryAtUtc?: string | null;
};
export type NewRecord = Omit<IngestionRecord, 'schema' | 'recordId' | 'previousHash' | 'recordHash'>;
export type CaptureForLedger = {candles: readonly Candle[]; queryAtUtc: string; receivedAtUtc: string; responseSha256: string; availability: 'CURRENT' | 'DELAYED'; barAgeMs: number};
export const BAR_MS = 15 * 60_000;
export const CURRENT_MAX_AGE_MS = 5 * 60_000;
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const stable = (value: unknown) => JSON.stringify(value);

export function readIngestion(path: string): IngestionRecord[] {
  if (!existsSync(path)) return [];
  let prior: string | null = null;
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).map(line => {
    const row = JSON.parse(line) as IngestionRecord;
    const {recordHash, ...unsigned} = row;
    if (row.schema !== 'phase32-alpaca-v1' || row.previousHash !== prior || sha(stable(unsigned)) !== recordHash) throw new Error('Registro de ingesta alterado o no secuencial.');
    prior = recordHash;
    return row;
  });
}
function withRecordLock<T>(path: string, work: () => T): T {
  mkdirSync(dirname(path), {recursive: true});
  const lockPath = `${path}.lock`, deadline = Date.now() + 5_000;
  let descriptor: number | undefined;
  while (descriptor === undefined) {
    try { descriptor = openSync(lockPath, 'wx'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw new Error('Otra ingesta está activa; reintente.');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try { return work(); } finally { closeSync(descriptor); unlinkSync(lockPath); }
}
function minutes(slot: string): number { const [hour, minute] = slot.split(':').map(Number); return hour! * 60 + minute!; }
function equalBar(a: IngestionRecord['bar'], candle: Candle): boolean { return !!a && a.open === candle.open && a.high === candle.high && a.low === candle.low && a.close === candle.close && a.volume === candle.volume; }
function writeRecords(path: string, prior: readonly IngestionRecord[], inputs: readonly NewRecord[]): IngestionRecord[] {
  const created: IngestionRecord[] = [];
  for (const item of inputs) {
    const signature = stable({kind: item.kind, status: item.status, receivedAtUtc: item.receivedAtUtc, queryAtUtc: item.queryAtUtc ?? null, responseSha256: item.responseSha256, bar: item.bar});
    const recordId = sha(signature);
    if (prior.concat(created).some(row => row.recordId === recordId)) continue;
    const unsigned = {schema: 'phase32-alpaca-v1' as const, recordId, previousHash: (created.at(-1) ?? prior.at(-1))?.recordHash ?? null, ...item};
    const row = {...unsigned, recordHash: sha(stable(unsigned))};
    writeFileSync(path, JSON.stringify(row) + '\n', {flag: 'a'}); created.push(row);
  }
  return created;
}

/** Rejects incomplete, future, off-calendar and unresolved intraday-gap bars. */
export function validateCapture(candles: readonly Candle[], calendar: MarketCalendar, receivedAtUtc: string, clock: () => number = Date.now): void {
  const received = Date.parse(receivedAtUtc); if (!Number.isFinite(received)) throw new Error('Recepción inválida.');
  let prior = -Infinity;
  for (const candle of candles) {
    const at = Date.parse(candle.timestamp), local = newYorkBarParts(candle.timestamp), session = calendar.get(local.day);
    if (!Number.isFinite(at) || at <= prior || at + BAR_MS > received || at > clock() + 60_000 || !session || minutes(local.slot) < session.open || minutes(local.slot) >= session.close) throw new Error('Vela incompatible con calendario, recepción u orden.');
    if (prior > 0 && newYorkBarParts(new Date(prior).toISOString()).day === local.day && at - prior !== BAR_MS) throw new Error('Hueco intradía no resuelto.');
    prior = at;
  }
}
export function availabilityForBarEnd(endUtc: string, now = Date.now()): 'CURRENT' | 'DELAYED' { return now - Date.parse(endUtc) <= CURRENT_MAX_AGE_MS ? 'CURRENT' : 'DELAYED'; }

/** Existing helper retained for compatible private ledgers and status events. */
export function appendIngestion(path: string, input: NewRecord | readonly NewRecord[]): {records: IngestionRecord[]; alreadyPresent: number} {
  return withRecordLock(path, () => { const prior = readIngestion(path), records = writeRecords(path, prior, Array.isArray(input) ? input : [input]); return {records, alreadyPresent: (Array.isArray(input) ? input : [input]).length - records.length}; });
}

/** Atomically writes every successful query and decides revisions while holding the exclusive lock. */
export function appendSuccessfulCapture(path: string, capture: CaptureForLedger): {records: IngestionRecord[]; barsAdded: number} {
  return withRecordLock(path, () => {
    const prior = readIngestion(path);
    const query: NewRecord = {kind: 'query', queryAtUtc: capture.queryAtUtc, receivedAtUtc: capture.receivedAtUtc, status: capture.candles.length ? (capture.availability === 'CURRENT' ? 'READY' : 'DELAYED') : 'NO_DATA', detail: capture.candles.length ? 'Consulta SIP completada.' : 'Consulta SIP completada sin velas cerradas nuevas.', provider: 'Alpaca Market Data API', feed: 'sip', adjustment: 'split', availability: capture.candles.length ? capture.availability : 'UNAVAILABLE', responseSha256: capture.responseSha256, bar: null, effectiveDelayMs: Number.isFinite(capture.barAgeMs) ? capture.barAgeMs : null};
    const created: NewRecord[] = [query];
    const observed = [...prior];
    for (const candle of capture.candles) {
      const matching = observed.filter(row => row.kind === 'bar' && row.bar?.startUtc === candle.timestamp);
      const latest = matching.at(-1);
      // Exact repetition is idempotent only relative to the immediately preceding version.
      if (latest && equalBar(latest.bar, candle)) continue;
      const entry: NewRecord = {kind: 'bar', queryAtUtc: capture.queryAtUtc, receivedAtUtc: capture.receivedAtUtc, status: capture.availability === 'CURRENT' ? 'READY' : 'DELAYED', detail: capture.availability === 'CURRENT' ? 'Vela SIP recibida.' : 'Vela SIP recibida con retraso efectivo.', provider: 'Alpaca Market Data API', feed: 'sip', adjustment: 'split', availability: capture.availability, responseSha256: capture.responseSha256, bar: {startUtc: candle.timestamp, endUtc: new Date(Date.parse(candle.timestamp) + BAR_MS).toISOString(), open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume, revision: matching.length + 1}, effectiveDelayMs: capture.barAgeMs};
      created.push(entry);
      // Include its shape for a possible same-start candle within this response.
      observed.push({...entry, schema: 'phase32-alpaca-v1', recordId: '', previousHash: null, recordHash: ''});
    }
    const records = writeRecords(path, prior, created);
    return {records, barsAdded: records.filter(row => row.kind === 'bar').length};
  });
}
export function latestIngestion(path: string): IngestionRecord | null { return readIngestion(path).at(-1) ?? null; }
export function appendIngestionStatus(path: string, status: IngestionStatus, detail: string, receivedAtUtc = new Date().toISOString()) { return appendIngestion(path, {kind: 'status', queryAtUtc: null, receivedAtUtc, status, detail, provider: 'Alpaca Market Data API', feed: 'sip', adjustment: 'split', availability: 'UNAVAILABLE', responseSha256: null, bar: null, effectiveDelayMs: null}); }
