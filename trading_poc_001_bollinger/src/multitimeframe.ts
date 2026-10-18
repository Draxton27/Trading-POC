import type {MarketCalendar} from './alpaca-calendar.ts';
import type {Candle} from './domain.ts';
import {newYorkBarParts} from './strategy-validation.ts';

export const SMA_PERIODS = [20, 40, 100, 200] as const;
export type SmaPeriod = typeof SMA_PERIODS[number];
export type HigherTimeframe = 'hour' | 'day';

export type AggregateCandle = Candle & {
  endTimestamp: string;
  availableAt: string;
  dateNy: string;
  timeframe: HigherTimeframe;
  durationMinutes: number;
  expectedSourceBars: number;
  observedSourceBars: number;
  complete: boolean;
  scheduledAbbreviated: boolean;
};

export type SmaValues = Record<SmaPeriod, number | null>;
export type SmaPoint = {
  candle: AggregateCandle;
  values: SmaValues;
  previous: SmaValues;
};

const SOURCE_MINUTES = 15;
const SOURCE_MS = SOURCE_MINUTES * 60_000;

function localMinute(timestamp: string): number {
  const [hour, minute] = newYorkBarParts(timestamp).slot.split(':').map(Number);
  return hour! * 60 + minute!;
}

function aggregate(source: readonly Candle[], options: {
  dateNy: string; timeframe: HigherTimeframe; start: number; end: number;
  expected: number; abbreviated: boolean;
}): AggregateCandle {
  const first = source[0];
  const last = source.at(-1);
  const complete = source.length === options.expected && source.every((bar, index) =>
    Date.parse(bar.timestamp) === options.start + index * SOURCE_MS);
  const emptyPrice = Number.NaN;
  return {
    timestamp: new Date(options.start).toISOString(),
    endTimestamp: new Date(options.end).toISOString(),
    availableAt: new Date(options.end).toISOString(),
    dateNy: options.dateNy,
    timeframe: options.timeframe,
    durationMinutes: (options.end - options.start) / 60_000,
    expectedSourceBars: options.expected,
    observedSourceBars: source.length,
    complete,
    scheduledAbbreviated: options.abbreviated,
    open: first?.open ?? emptyPrice,
    high: source.length ? Math.max(...source.map(bar => bar.high)) : emptyPrice,
    low: source.length ? Math.min(...source.map(bar => bar.low)) : emptyPrice,
    close: last?.close ?? emptyPrice,
    volume: source.reduce((sum, bar) => sum + bar.volume, 0),
  };
}

function sessions(candles: readonly Candle[]): Map<string, Candle[]> {
  const result = new Map<string, Candle[]>();
  let previous = -Infinity;
  for (const candle of candles) {
    const time = Date.parse(candle.timestamp);
    if (!Number.isFinite(time) || time <= previous) throw new Error('Velas desordenadas o duplicadas para agregación.');
    previous = time;
    const day = newYorkBarParts(candle.timestamp).day;
    result.set(day, [...(result.get(day) ?? []), candle]);
  }
  return result;
}

function sessionOpenInstant(dayBars: readonly Candle[], openMinute: number): number {
  const anchor = dayBars[0];
  if (!anchor) throw new Error('No se puede anclar una sesión vacía.');
  return Date.parse(anchor.timestamp) - (localMinute(anchor.timestamp) - openMinute) * 60_000;
}

/**
 * Builds 60-minute bars anchored at the scheduled NY open. The last scheduled
 * bar may be shorter and is complete when every expected 15-minute bar exists.
 * Missing source bars create an incomplete aggregate that is never fed to an SMA.
 */
export function buildHourlyCandles(candles: readonly Candle[], calendar: MarketCalendar): AggregateCandle[] {
  const result: AggregateCandle[] = [];
  for (const [dateNy, dayBars] of sessions(candles)) {
    const schedule = calendar.get(dateNy);
    if (!schedule) throw new Error(`Sesión ${dateNy} ausente del calendario.`);
    const openInstant = sessionOpenInstant(dayBars, schedule.open);
    for (let startMinute = schedule.open; startMinute < schedule.close; startMinute += 60) {
      const endMinute = Math.min(startMinute + 60, schedule.close);
      const start = openInstant + (startMinute - schedule.open) * 60_000;
      const end = openInstant + (endMinute - schedule.open) * 60_000;
      const source = dayBars.filter(bar => {
        const time = Date.parse(bar.timestamp);
        return time >= start && time < end;
      });
      result.push(aggregate(source, {dateNy, timeframe: 'hour', start, end,
        expected: (endMinute - startMinute) / SOURCE_MINUTES,
        abbreviated: endMinute - startMinute < 60}));
    }
  }
  return result;
}

/** Daily aggregates are retained for auditing but incomplete sessions are excluded from SMA inputs. */
export function buildDailyCandles(candles: readonly Candle[], calendar: MarketCalendar): AggregateCandle[] {
  const bySession = sessions(candles);
  const result: AggregateCandle[] = [];
  for (const [dateNy, dayBars] of bySession) {
    const schedule = calendar.get(dateNy);
    if (!schedule) throw new Error(`Sesión ${dateNy} ausente del calendario.`);
    const start = sessionOpenInstant(dayBars, schedule.open);
    const end = start + (schedule.close - schedule.open) * 60_000;
    result.push(aggregate(dayBars, {dateNy, timeframe: 'day', start, end,
      expected: (schedule.close - schedule.open) / SOURCE_MINUTES,
      abbreviated: schedule.close - schedule.open < 390}));
  }
  return result;
}

export function calculateSmaPoints(candles: readonly AggregateCandle[]): SmaPoint[] {
  const closes: number[] = [];
  const last: SmaValues = {20: null, 40: null, 100: null, 200: null};
  return candles.map(candle => {
    const previous = {...last};
    const values: SmaValues = {20: null, 40: null, 100: null, 200: null};
    if (candle.complete) {
      closes.push(candle.close);
      for (const period of SMA_PERIODS) {
        if (closes.length >= period) {
          values[period] = closes.slice(-period).reduce((sum, close) => sum + close, 0) / period;
        }
        last[period] = values[period];
      }
    }
    return {candle, values, previous};
  });
}

/** The referenced aggregate must be fully closed no later than the 15-minute signal bar start. */
export function lastAvailableSmaPoint(points: readonly SmaPoint[], signalStart: string): SmaPoint | null {
  const cutoff = Date.parse(signalStart);
  let result: SmaPoint | null = null;
  for (const point of points) {
    if (!point.candle.complete) continue;
    if (Date.parse(point.candle.availableAt) > cutoff) break;
    result = point;
  }
  return result;
}
