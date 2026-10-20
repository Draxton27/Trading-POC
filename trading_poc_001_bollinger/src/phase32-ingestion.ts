import {createHash} from 'node:crypto';
import {closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import type {Candle} from './domain.ts';
import {newYorkBarParts} from './strategy-validation.ts';
import type {MarketCalendar} from './alpaca-calendar.ts';

export type IngestionStatus = 'READY' | 'NO_DATA' | 'DELAYED' | 'PERMISSION_DENIED' | 'RATE_LIMIT' | 'HTTP_ERROR' | 'NETWORK_ERROR' | 'INVALID_DATA';
export type IngestionRecord = {
  schema: 'phase32-alpaca-v1'; recordId: string; previousHash: string | null; recordHash: string;
  kind: 'bar' | 'status'; receivedAtUtc: string; status: IngestionStatus; detail: string;
  provider: 'Alpaca Market Data API'; feed: 'sip'; adjustment: 'split';
  availability: 'CURRENT' | 'DELAYED' | 'UNAVAILABLE'; responseSha256: string | null;
  bar: {startUtc: string; endUtc: string; open: number; high: number; low: number; close: number; volume: number; revision: number} | null;
  effectiveDelayMs: number | null;
};
export type NewRecord = Omit<IngestionRecord, 'schema' | 'recordId' | 'previousHash' | 'recordHash'>;
const BAR_MS = 15 * 60_000;
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

/** Rejects incomplete, future, off-calendar and unresolved intraday-gap bars. */
export function validateCapture(candles: readonly Candle[], calendar: MarketCalendar, receivedAtUtc: string): void {
  const received = Date.parse(receivedAtUtc); if (!Number.isFinite(received)) throw new Error('Recepción inválida.');
  let prior = -Infinity;
  for (const candle of candles) {
    const at = Date.parse(candle.timestamp), local = newYorkBarParts(candle.timestamp), session = calendar.get(local.day);
    if (!Number.isFinite(at) || at <= prior || at + BAR_MS > received || at > Date.now() + 60_000 || !session || minutes(local.slot) < session.open || minutes(local.slot) >= session.close) throw new Error('Vela incompatible con calendario, recepción u orden.');
    if (prior > 0 && newYorkBarParts(new Date(prior).toISOString()).day === local.day && at - prior !== BAR_MS) throw new Error('Hueco intradía no resuelto.');
    prior = at;
  }
}

/** Appends a hash-chained record set atomically under a short exclusive lock. */
export function appendIngestion(path: string, input: NewRecord | readonly NewRecord[]): {records: IngestionRecord[]; alreadyPresent: number} {
  return withRecordLock(path, () => {
    const prior = readIngestion(path), created: IngestionRecord[] = []; let alreadyPresent = 0;
    for (const item of Array.isArray(input) ? input : [input]) {
      const signature = stable({kind: item.kind, status: item.status, receivedAtUtc: item.receivedAtUtc, responseSha256: item.responseSha256, bar: item.bar});
      const recordId = sha(signature);
      if (prior.concat(created).some(row => row.recordId === recordId)) { alreadyPresent++; continue; }
      const unsigned = {schema: 'phase32-alpaca-v1' as const, recordId, previousHash: (created.at(-1) ?? prior.at(-1))?.recordHash ?? null, ...item};
      const row = {...unsigned, recordHash: sha(stable(unsigned))}; writeFileSync(path, JSON.stringify(row) + '\n', {flag: 'a'}); created.push(row);
    }
    return {records: created, alreadyPresent};
  });
}

/** Identical provider observations are idempotent; changed OHLCV is a later revision. */
export function recordsForCapture(candles: readonly Candle[], receivedAtUtc: string, responseSha256: string, availability: 'CURRENT' | 'DELAYED', effectiveDelayMs: number, prior: readonly IngestionRecord[]): NewRecord[] {
  return candles.flatMap(candle => {
    const same = prior.filter(row => row.kind === 'bar' && row.bar?.startUtc === candle.timestamp);
    const exact = same.find(row => row.bar?.open === candle.open && row.bar?.high === candle.high && row.bar?.low === candle.low && row.bar?.close === candle.close && row.bar?.volume === candle.volume);
    if (exact) return [];
    return [{kind: 'bar' as const, receivedAtUtc, status: availability === 'CURRENT' ? 'READY' as const : 'DELAYED' as const, detail: availability === 'CURRENT' ? 'Vela SIP recibida.' : 'Vela SIP recibida con retraso efectivo.', provider: 'Alpaca Market Data API' as const, feed: 'sip' as const, adjustment: 'split' as const, availability, responseSha256, bar: {startUtc: candle.timestamp, endUtc: new Date(Date.parse(candle.timestamp) + BAR_MS).toISOString(), open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume, revision: same.length + 1}, effectiveDelayMs}];
  });
}
export function latestIngestion(path: string): IngestionRecord | null { return readIngestion(path).at(-1) ?? null; }
export function appendIngestionStatus(path: string, status: IngestionStatus, detail: string, receivedAtUtc = new Date().toISOString()) { return appendIngestion(path, {kind: 'status', receivedAtUtc, status, detail, provider: 'Alpaca Market Data API', feed: 'sip', adjustment: 'split', availability: 'UNAVAILABLE', responseSha256: null, bar: null, effectiveDelayMs: null}); }
