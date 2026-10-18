import type {Candle, Direction} from './domain.ts';
import type {MarketCalendar} from './alpaca-calendar.ts';
import {buildDailyCandles} from './multitimeframe.ts';
import {evaluateNvdaHorizon, type HorizonReason} from './nvda-indicators-study.ts';
import {newYorkBarParts} from './strategy-validation.ts';

export type Regime = 'low' | 'medium' | 'high' | 'insufficient';
export type Side = 'bullish' | 'bearish';
export type AtrSession = {
  dateNy: string; complete: boolean; scheduledAbbreviated: boolean;
  close: number | null; trueRange: number | null; atr14: number | null;
  atr14Percent: number | null; regime: Regime;
  priorAtr14: number | null; priorAtr14Percent: number | null;
  referenceCount: number; p33: number | null; p67: number | null;
};
export type IntradayRange = {meanDollar: number | null; meanPercent: number | null;
  referenceClose: number | null; count: number};
export type Scales = {atrDollar: number | null; range20Dollar: number | null};
export type Trajectory = {
  value: number | null; reason: HorizonReason | null;
  entryUtc: string | null; exitUtc: string | null;
  entryPrice: number | null; exitPrice: number | null;
  mfeDollar: number | null; maeDollar: number | null;
  mfePercent: number | null; maePercent: number | null;
  mfeAtrUnits: number | null; maeAtrUnits: number | null;
  mfeRange20Units: number | null; maeRange20Units: number | null;
};

const BAR_MS = 900_000;

export function nearestRank(values: readonly number[], percentile: number): number | null {
  if (!values.length) return null;
  if (!Number.isFinite(percentile) || percentile <= 0 || percentile > 100 ||
      values.some(value => !Number.isFinite(value))) throw new Error('Percentil o muestra inválidos.');
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * percentile / 100) - 1]!;
}

export function classifyAtrPercent(priorAtrPercent: number | null,
  references: readonly number[]): {regime: Regime; p33: number | null; p67: number | null} {
  if (priorAtrPercent === null || !Number.isFinite(priorAtrPercent) || references.length < 120) {
    return {regime: 'insufficient', p33: null, p67: null};
  }
  const sample = references.slice(-120);
  const p33 = nearestRank(sample, 33.33)!;
  const p67 = nearestRank(sample, 66.67)!;
  return {regime: priorAtrPercent <= p33 ? 'low' : priorAtrPercent > p67 ? 'high' : 'medium',
    p33, p67};
}

/** Each daily TR needs the immediately preceding scheduled session's complete regular close. */
export function buildDailyAtr(candles: readonly Candle[], calendar: MarketCalendar): AtrSession[] {
  const daily = new Map(buildDailyCandles(candles, calendar).map(item => [item.dateNy, item]));
  const dates = [...calendar.keys()].sort();
  const trHistory: number[] = [];
  const rows: AtrSession[] = [];
  for (const [index, dateNy] of dates.entries()) {
    const current = daily.get(dateNy), previous = index > 0 ? daily.get(dates[index - 1]!) : undefined;
    const complete = current?.complete ?? false;
    let trueRange: number | null = null;
    if (current?.complete && previous?.complete) {
      trueRange = Math.max(current.high - current.low,
        Math.abs(current.high - previous.close), Math.abs(current.low - previous.close));
    }
    if (trueRange !== null) trHistory.push(trueRange);
    const atr14 = trueRange !== null && trHistory.length >= 14 ?
      trHistory.slice(-14).reduce((sum, value) => sum + value, 0) / 14 : null;
    const atr14Percent = atr14 !== null ? 100 * atr14 / current!.close : null;
    rows.push({dateNy, complete, scheduledAbbreviated: current?.scheduledAbbreviated ?? false,
      close: complete ? current!.close : null, trueRange, atr14, atr14Percent,
      regime: 'insufficient', priorAtr14: null, priorAtr14Percent: null,
      referenceCount: 0, p33: null, p67: null});
  }
  const history: number[] = [];
  for (const [index, row] of rows.entries()) {
    const previous = rows[index - 1];
    const refs = history.slice(-120);
    const classification = classifyAtrPercent(previous?.atr14Percent ?? null, refs);
    row.regime = classification.regime;
    row.priorAtr14 = previous?.atr14 ?? null;
    row.priorAtr14Percent = previous?.atr14Percent ?? null;
    row.referenceCount = refs.length;
    row.p33 = classification.p33;
    row.p67 = classification.p67;
    if (previous?.atr14Percent !== null && previous?.atr14Percent !== undefined) {
      history.push(previous.atr14Percent);
    }
  }
  return rows;
}

function minute(slot: string): number {
  const [hour, part] = slot.split(':').map(Number);
  return hour! * 60 + part!;
}

/** A 20-bar sequence may cross an overnight boundary only after a fully observed prior session. */
export function buildPrior20Ranges(candles: readonly Candle[], calendar: MarketCalendar): IntradayRange[] {
  const completeDates = new Set(buildDailyCandles(candles, calendar)
    .filter(item => item.complete).map(item => item.dateNy));
  const scheduled = [...calendar.keys()].sort();
  const priorDate = new Map(scheduled.slice(1).map((date, index) => [date, scheduled[index]!]));
  const result: IntradayRange[] = [];
  let window: number[] = [];
  for (const [index, candle] of candles.entries()) {
    const current = newYorkBarParts(candle.timestamp);
    const previous = candles[index - 1];
    if (previous) {
      const before = newYorkBarParts(previous.timestamp);
      const sameSession = before.day === current.day &&
        Date.parse(candle.timestamp) - Date.parse(previous.timestamp) === BAR_MS;
      const previousSchedule = calendar.get(before.day);
      const currentSchedule = calendar.get(current.day);
      const scheduledBoundary = before.day !== current.day &&
        priorDate.get(current.day) === before.day && completeDates.has(before.day) &&
        previousSchedule !== undefined && currentSchedule !== undefined &&
        minute(before.slot) + 15 === previousSchedule.close &&
        minute(current.slot) === currentSchedule.open;
      if (!sameSession && !scheduledBoundary) window = [];
    }
    const referenceClose = previous?.close ?? null;
    const meanDollar = window.length >= 20 ?
      window.reduce((sum, value) => sum + value, 0) / 20 : null;
    result.push({meanDollar, meanPercent: meanDollar !== null && referenceClose !== null ?
      100 * meanDollar / referenceClose : null,
    referenceClose, count: Math.min(window.length, 20)});
    window.push(candle.high - candle.low);
    if (window.length > 20) window.shift();
  }
  return result;
}

export function evaluateVolatilityTrajectory(candles: readonly Candle[], index: number,
  bars: 1 | 2 | 4, side: Side, calendar: MarketCalendar, scales: Scales): Trajectory {
  const direction: Direction = side === 'bullish' ? 'CALL_CONTEXT' : 'PUT_CONTEXT';
  const result = evaluateNvdaHorizon(candles, index, bars, direction, calendar);
  if (result.value === null) return {...result, entryPrice: null, exitPrice: null,
    mfeDollar: null, maeDollar: null, mfePercent: null, maePercent: null,
    mfeAtrUnits: null, maeAtrUnits: null, mfeRange20Units: null, maeRange20Units: null};
  const entryPrice = candles[index + 1]!.open;
  const passage = candles.slice(index + 1, index + bars + 1);
  const high = Math.max(...passage.map(candle => candle.high));
  const low = Math.min(...passage.map(candle => candle.low));
  const mfeDollar = side === 'bullish' ? high - entryPrice : entryPrice - low;
  const maeDollar = side === 'bullish' ? low - entryPrice : entryPrice - high;
  const divide = (value: number, scale: number | null): number | null =>
    scale !== null && scale > 0 ? value / scale : null;
  return {...result, entryPrice, exitPrice: candles[index + bars]!.close,
    mfeDollar, maeDollar, mfePercent: 100 * mfeDollar / entryPrice,
    maePercent: 100 * maeDollar / entryPrice,
    mfeAtrUnits: divide(mfeDollar, scales.atrDollar),
    maeAtrUnits: divide(maeDollar, scales.atrDollar),
    mfeRange20Units: divide(mfeDollar, scales.range20Dollar),
    maeRange20Units: divide(maeDollar, scales.range20Dollar)};
}

export function sessionBlock(slot: string): number {
  return Math.floor((minute(slot) - 570) / 60);
}

export function sessionBootstrap(items: readonly {date: string; value: number}[]): [number, number] | null {
  const grouped = new Map<string, number[]>();
  for (const item of items) {
    const group = grouped.get(item.date) ?? [];
    group.push(item.value);
    grouped.set(item.date, group);
  }
  if (items.length < 30 || grouped.size < 10) return null;
  const sessions = [...grouped.values()];
  let state = 13013;
  const random = () => {state = (1664525 * state + 1013904223) >>> 0; return state / 2 ** 32;};
  const draws: number[] = [];
  for (let iteration = 0; iteration < 2000; iteration++) {
    let sum = 0, count = 0;
    for (let sample = 0; sample < sessions.length; sample++) {
      for (const value of sessions[Math.floor(random() * sessions.length)]!) {sum += value; count++;}
    }
    draws.push(sum / count);
  }
  draws.sort((a, b) => a - b);
  return [draws[50]!, draws[1949]!];
}
