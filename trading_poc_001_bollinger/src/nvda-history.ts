import {existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {alpacaNvdaMetadata, fetchAlpacaBars, type ImportOptions} from './alpaca.ts';
import {fetchAlpacaCalendar, loadMarketCalendar, type MarketCalendar} from './alpaca-calendar.ts';
import {parseCandlesCsv, serializeCandles} from './csv.ts';
import type {Candle} from './domain.ts';

const BAR_MS = 15 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const SAFETY_MS = 20 * 60_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type HistoryRange = {start: string; end: string; fileStem: string};
export type HistoryChunk = {id: string; start: string; end: string};
export type HistoryCoverage = {
  calendarSessions: number;
  observedSessions: number;
  missingSessions: string[];
  partialSessions: {date: string; observed: number; expected: number}[];
};

function dateMs(value: string): number {
  if (!DATE.test(value)) throw new Error('Fechas requeridas en formato YYYY-MM-DD.');
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
    throw new Error(`Fecha inválida: ${value}.`);
  }
  return parsed;
}

export function parseHistoryRange(args: readonly string[], now = Date.now()): HistoryRange {
  let startDay: string, endDay: string;
  if (args.length === 2 && args[0] === '--years' && /^[345]$/.test(args[1] ?? '')) {
    const latest = Math.floor((now - SAFETY_MS - BAR_MS) / BAR_MS) * BAR_MS;
    const lastWholeDay = Math.floor(latest / DAY_MS) * DAY_MS - DAY_MS;
    const end = new Date(lastWholeDay);
    endDay = end.toISOString().slice(0, 10);
    const first = new Date(Date.UTC(end.getUTCFullYear() - Number(args[1]), end.getUTCMonth(), 1));
    const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    first.setUTCDate(Math.min(end.getUTCDate(), lastDay));
    startDay = first.toISOString().slice(0, 10);
  } else if (args.length === 4 && args[0] === '--start' && args[2] === '--end') {
    startDay = args[1]!; endDay = args[3]!;
  } else {
    throw new Error('Uso: --years 3|4|5 o --start YYYY-MM-DD --end YYYY-MM-DD.');
  }
  const start = dateMs(startDay);
  const end = dateMs(endDay) + DAY_MS - BAR_MS;
  const latest = Math.floor((now - SAFETY_MS - BAR_MS) / BAR_MS) * BAR_MS;
  if (start > end || end > latest) {
    throw new Error('Rango inválido o fecha final demasiado reciente para los datos SIP históricos.');
  }
  return {start: new Date(start).toISOString(), end: new Date(end).toISOString(),
    fileStem: `NVDA_ALPACA_SIP_15min_${startDay.replaceAll('-', '')}_${endDay.replaceAll('-', '')}`};
}

/** Non-overlapping inclusive UTC chunks. UTC month boundaries cannot split a regular NY session. */
export function monthlyChunks(range: HistoryRange): HistoryChunk[] {
  const chunks: HistoryChunk[] = [];
  const first = Date.parse(range.start), final = Date.parse(range.end);
  for (let start = first; start <= final;) {
    const date = new Date(start);
    const nextMonth = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    const end = Math.min(final, nextMonth - BAR_MS);
    chunks.push({id: date.toISOString().slice(0, 7), start: new Date(start).toISOString(),
      end: new Date(end).toISOString()});
    start = end + BAR_MS;
  }
  return chunks;
}

function atomicWrite(path: string, content: string): void {
  const temporary = `${path}.${process.pid}.partial`;
  writeFileSync(temporary, content, {flag: 'wx'});
  renameSync(temporary, path);
}

function sessionParts(timestamp: string): {date: string; minute: number} {
  const formatter = new Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York', year: 'numeric',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
  const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
  return {date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute)};
}

export function historyCoverage(candles: readonly Candle[], calendar: MarketCalendar,
  range: HistoryRange): HistoryCoverage {
  const counts = new Map<string, number>();
  for (const candle of candles) {
    const {date, minute} = sessionParts(candle.timestamp);
    const schedule = calendar.get(date);
    if (!schedule || minute < schedule.open || minute + 15 > schedule.close ||
        (minute - schedule.open) % 15 !== 0) {
      throw new Error(`Vela fuera de calendario o cierre anticipado: ${candle.timestamp}.`);
    }
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  const first = range.start.slice(0, 10), last = range.end.slice(0, 10);
  const expected = [...calendar].filter(([date]) => date >= first && date <= last);
  const missingSessions = expected.filter(([date]) => !counts.has(date)).map(([date]) => date);
  const partialSessions = expected.flatMap(([date, schedule]) => {
    const observed = counts.get(date), planned = (schedule.close - schedule.open) / 15;
    return observed !== undefined && observed !== planned ? [{date, observed, expected: planned}] : [];
  });
  return {calendarSessions: expected.length, observedSessions: counts.size, missingSessions, partialSessions};
}

export type ImportHistoryOptions = {
  range: HistoryRange;
  outputDirectory: string;
  apiKey: string;
  secretKey: string;
  now?: number;
  fetchCalendar?: typeof fetchAlpacaCalendar;
  fetchBars?: typeof fetchAlpacaBars;
  pause?: (milliseconds: number) => Promise<void>;
};

/** Stage validated monthly pieces and resume after interruption; publish only a complete merged dataset. */
export async function importNvdaHistory(options: ImportHistoryOptions): Promise<{
  filePath: string; candles: number; coverage: HistoryCoverage; resumedChunks: number;
}> {
  const {range, outputDirectory, apiKey, secretKey, now = Date.now(),
    fetchCalendar = fetchAlpacaCalendar, fetchBars = fetchAlpacaBars} = options;
  const pause = options.pause ?? ((milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds)));
  if (!apiKey.trim() || !secretKey.trim()) throw new Error('Faltan secretos Alpaca en el entorno seguro.');
  const filePath = join(outputDirectory, `${range.fileStem}.csv`);
  const targets = [filePath, `${filePath}.meta.json`, `${filePath}.calendar.json`, `${filePath}.provenance.json`];
  if (targets.some(existsSync)) throw new Error(`Ya existe algún archivo final para ${range.fileStem}; no se sobrescribe.`);
  mkdirSync(outputDirectory, {recursive: true});
  const staging = `${filePath}.parts`;
  mkdirSync(staging, {recursive: true});
  const chunks = monthlyChunks(range);
  const allCandles: Candle[] = [];
  const calendar: MarketCalendar = new Map();
  let resumedChunks = 0;
  let requestedChunks = 0;
  for (const chunk of chunks) {
    const chunkCsv = join(staging, `${chunk.id}.csv`);
    const chunkCalendar = join(staging, `${chunk.id}.calendar.json`);
    const hasCsv = existsSync(chunkCsv), hasCalendar = existsSync(chunkCalendar);
    if (hasCsv !== hasCalendar) {
      // A process can stop between the two atomic renames. Re-fetch this one chunk.
      unlinkSync(hasCsv ? chunkCsv : chunkCalendar);
    }
    let bars: Candle[], schedule: MarketCalendar;
    if (hasCsv && hasCalendar) {
      bars = parseCandlesCsv(readFileSync(chunkCsv, 'utf8'), alpacaNvdaMetadata);
      schedule = loadMarketCalendar(chunkCalendar);
      resumedChunks++;
    } else {
      // Calendar and bars both consume API requests; leave room under Basic's limit across chunks.
      if (requestedChunks > 0) await pause(1000);
      schedule = await fetchCalendar({apiKey, secretKey, start: chunk.start, end: chunk.end});
      await pause(500);
      bars = await fetchBars({apiKey, secretKey, start: chunk.start, end: chunk.end,
        now, metadata: alpacaNvdaMetadata, calendar: schedule} as ImportOptions);
      requestedChunks++;
      atomicWrite(chunkCsv, serializeCandles(bars));
      atomicWrite(chunkCalendar, JSON.stringify({provider: 'Alpaca Market Calendar',
        sessions: [...schedule].map(([date, hours]) => ({date, ...hours}))}, null, 2) + '\n');
    }
    historyCoverage(bars, schedule, {start: chunk.start, end: chunk.end, fileStem: range.fileStem});
    const start = Date.parse(chunk.start), end = Date.parse(chunk.end);
    for (const bar of bars) {
      const time = Date.parse(bar.timestamp);
      if (time < start || time > end) throw new Error(`Fragmento ${chunk.id} contiene vela fuera de rango.`);
      const prior = allCandles.at(-1);
      if (prior && time <= Date.parse(prior.timestamp)) throw new Error('Fragmentos duplicados o desordenados.');
      allCandles.push(bar);
    }
    for (const [date, hours] of schedule) {
      if (calendar.has(date)) throw new Error(`Sesión duplicada entre fragmentos: ${date}.`);
      calendar.set(date, hours);
    }
  }
  if (!allCandles.length) throw new Error('El historial combinado está vacío.');
  const combined = parseCandlesCsv(serializeCandles(allCandles), alpacaNvdaMetadata);
  const coverage = historyCoverage(combined, calendar, range);
  const metadata = {...alpacaNvdaMetadata, requested_start: range.start, requested_end: range.end,
    calendar_source: 'Alpaca Market Calendar API', coverage};
  const provenance = {provider: 'Alpaca Market Data API', bars_endpoint: '/v2/stocks/bars',
    calendar_endpoint: '/v2/calendar', feed: 'sip', adjustment: 'split', timeframe: '15Min',
    session: 'regular', requested_start: range.start, requested_end: range.end,
    imported_at: new Date(now).toISOString(), chunks: chunks.length, resumed_chunks: resumedChunks,
    coverage, credentials_recorded: false};
  atomicWrite(`${filePath}.meta.json`, JSON.stringify(metadata, null, 2) + '\n');
  atomicWrite(`${filePath}.calendar.json`, JSON.stringify({provider: 'Alpaca Market Calendar',
    sessions: [...calendar].map(([date, hours]) => ({date, ...hours}))}, null, 2) + '\n');
  atomicWrite(`${filePath}.provenance.json`, JSON.stringify(provenance, null, 2) + '\n');
  atomicWrite(filePath, serializeCandles(combined));
  return {filePath, candles: combined.length, coverage, resumedChunks};
}
