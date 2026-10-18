import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fetchAlpacaBars, type ImportOptions} from './alpaca.ts';
import {loadMarketCalendar, type MarketCalendar} from './alpaca-calendar.ts';
import {parseCandlesCsv, serializeCandles} from './csv.ts';
import type {Candle} from './domain.ts';
import type {DataMetadata} from './data-contract.ts';
import {historyCoverage, monthlyChunks, type HistoryCoverage, type HistoryRange} from './nvda-history.ts';

export type Phase14Symbol = 'QQQ' | 'SMH';
export const PHASE14_START = '2021-10-17T00:00:00.000Z';
export const PHASE14_END = '2026-10-17T23:45:00.000Z';
export const PHASE14_NVDA_SHA256 = '7b06d0a493515b18a581963d2d2d488e73a7cd0dc2c961b60a99315e7a9b0ecc';
export const phase14Range: HistoryRange = {start: PHASE14_START, end: PHASE14_END,
  fileStem: 'phase14'};
export const metadataFor = (asset: Phase14Symbol): DataMetadata => ({
  asset, provider: 'Alpaca Market Data API', bar_minutes: 15,
  data_class: 'real', session: 'regular', exchange_timezone: 'America/New_York',
  feed: 'sip', adjustment: 'split',
});
export const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');

export function symbolPath(directory: string, symbol: Phase14Symbol): string {
  return join(directory, `${symbol}_ALPACA_SIP_15min_20211017_20261017.csv`);
}
function atomicWrite(path: string, content: string): void {
  const temporary = `${path}.${process.pid}.partial`;
  writeFileSync(temporary, content, {flag: 'wx'});
  renameSync(temporary, path);
}
function validateBars(candles: readonly Candle[], calendar: MarketCalendar, range: HistoryRange): HistoryCoverage {
  // The CSV parser verifies OHLCV, strict order and session; coverage checks the exchange calendar.
  return historyCoverage(candles, calendar, range);
}
export type Phase14Imported = {filePath: string; candles: Candle[]; coverage: HistoryCoverage;
  duplicateBars: number; resumedChunks: number; alreadyComplete: boolean;
  hashes: {csv: string; metadata: string; calendar: string; provenance: string}};

export async function importPhase14Symbol(options: {
  symbol: Phase14Symbol; outputDirectory: string; nvdaCalendarPath: string;
  apiKey: string; secretKey: string; now?: number;
  fetchBars?: typeof fetchAlpacaBars;
  pause?: (milliseconds: number) => Promise<void>;
}): Promise<Phase14Imported> {
  const {symbol, outputDirectory, nvdaCalendarPath, apiKey, secretKey,
    now = Date.now(), fetchBars = fetchAlpacaBars} = options;
  if (!apiKey.trim() || !secretKey.trim()) throw new Error('Faltan credenciales Alpaca del entorno seguro.');
  const pause = options.pause ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const calendarBytes = readFileSync(nvdaCalendarPath);
  const calendar = loadMarketCalendar(nvdaCalendarPath);
  const base = symbolPath(outputDirectory, symbol);
  const targets = [base, `${base}.meta.json`, `${base}.calendar.json`, `${base}.provenance.json`];
  const metadata = metadataFor(symbol);
  const hashes = () => ({csv: sha256(readFileSync(base)), metadata: sha256(readFileSync(targets[1]!)),
    calendar: sha256(readFileSync(targets[2]!)), provenance: sha256(readFileSync(targets[3]!))});
  if (targets.some(existsSync)) {
    if (!targets.every(existsSync)) throw new Error(`Archivos finales parciales para ${symbol}; no se sobrescriben.`);
    const meta = JSON.parse(readFileSync(targets[1]!, 'utf8')) as Record<string, unknown>;
    const provenance = JSON.parse(readFileSync(targets[3]!, 'utf8')) as Record<string, unknown>;
    if (meta.asset !== symbol || meta.bar_minutes !== 15 || meta.feed !== 'sip' ||
        meta.adjustment !== 'split' || meta.session !== 'regular' ||
        provenance.requested_start !== PHASE14_START || provenance.requested_end !== PHASE14_END ||
        sha256(readFileSync(targets[2]!)) !== sha256(calendarBytes) ||
        provenance.credentials_recorded !== false) throw new Error(`Historial final ${symbol} no válido; no se sobrescribe.`);
    const candles = parseCandlesCsv(readFileSync(base, 'utf8'), metadata,
      {allowIntradayGaps: true});
    const coverage = validateBars(candles, calendar, phase14Range);
    return {filePath: base, candles, coverage, duplicateBars: Number(provenance.duplicate_bars ?? 0),
      resumedChunks: 0, alreadyComplete: true, hashes: hashes()};
  }
  mkdirSync(outputDirectory, {recursive: true});
  const staging = `${base}.parts`;
  mkdirSync(staging, {recursive: true});
  let resumedChunks = 0, duplicateBars = 0;
  const all: Candle[] = [];
  for (const [chunkIndex, chunk] of monthlyChunks(phase14Range).entries()) {
    const chunkFile = join(staging, `${chunk.id}.csv`);
    const manifestFile = join(staging, `${chunk.id}.json`);
    let bars: Candle[];
    if (existsSync(chunkFile) !== existsSync(manifestFile)) {
      if (existsSync(chunkFile)) unlinkSync(chunkFile);
      if (existsSync(manifestFile)) unlinkSync(manifestFile);
    }
    if (existsSync(chunkFile)) {
      const raw = readFileSync(chunkFile);
      const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as Record<string, unknown>;
      if (manifest.symbol !== symbol || manifest.start !== chunk.start || manifest.end !== chunk.end ||
          manifest.calendar_sha256 !== sha256(calendarBytes) || manifest.csv_sha256 !== sha256(raw)) {
        throw new Error(`Fragmento reanudado inválido: ${symbol} ${chunk.id}.`);
      }
      bars = parseCandlesCsv(raw.toString('utf8'), metadata, {allowIntradayGaps: true});
      duplicateBars += Number(manifest.duplicate_bars ?? 0);
      resumedChunks++;
    } else {
      if (chunkIndex > 0) await pause(1000);
      const audit = {exact: 0};
      bars = await fetchBars({apiKey, secretKey, start: chunk.start, end: chunk.end,
        now, metadata, calendar, allowIntradayGaps: true, allowExactDuplicates: true,
        duplicateAudit: audit} as ImportOptions);
      duplicateBars += audit.exact;
      const raw = serializeCandles(bars);
      atomicWrite(chunkFile, raw);
      atomicWrite(manifestFile, JSON.stringify({symbol, start: chunk.start, end: chunk.end,
        csv_sha256: sha256(raw), calendar_sha256: sha256(calendarBytes),
        duplicate_bars: audit.exact}, null, 2) + '\n');
    }
    validateBars(bars, calendar, {start: chunk.start, end: chunk.end, fileStem: chunk.id});
    for (const bar of bars) {
      const instant = Date.parse(bar.timestamp);
      if (instant < Date.parse(chunk.start) || instant > Date.parse(chunk.end) ||
          (all.length && instant <= Date.parse(all.at(-1)!.timestamp))) {
        throw new Error(`Fragmentos ${symbol} duplicados, desordenados o fuera de rango.`);
      }
      all.push(bar);
    }
  }
  if (!all.length) throw new Error(`Historial ${symbol} vacío.`);
  const combined = serializeCandles(all);
  const verified = parseCandlesCsv(combined, metadata, {allowIntradayGaps: true});
  const coverage = validateBars(verified, calendar, phase14Range);
  const savedMetadata = {...metadata, requested_start: PHASE14_START,
    requested_end: PHASE14_END, calendar_source: 'Alpaca Market Calendar API', coverage};
  const provenance = {provider: 'Alpaca Market Data API', bars_endpoint: '/v2/stocks/bars',
    feed: 'sip', adjustment: 'split', timeframe: '15Min', session: 'regular',
    requested_start: PHASE14_START, requested_end: PHASE14_END,
    calendar_sha256: sha256(calendarBytes), imported_at: new Date(now).toISOString(),
    chunks: monthlyChunks(phase14Range).length, resumed_chunks: resumedChunks,
    duplicate_bars: duplicateBars, coverage, credentials_recorded: false};
  atomicWrite(targets[1]!, JSON.stringify(savedMetadata, null, 2) + '\n');
  atomicWrite(targets[2]!, calendarBytes.toString('utf8'));
  atomicWrite(targets[3]!, JSON.stringify(provenance, null, 2) + '\n');
  atomicWrite(base, combined);
  return {filePath: base, candles: verified, coverage, duplicateBars, resumedChunks,
    alreadyComplete: false, hashes: hashes()};
}
