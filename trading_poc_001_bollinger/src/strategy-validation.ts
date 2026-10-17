import type {Candle, Direction, Signal} from './domain.ts';
import {calculateBollinger} from './bollinger.ts';
import {detectSignals} from './signals.ts';

export const HORIZONS = [3, 6, 12] as const;
export type Segment = 'exploracion' | 'evaluacion';
export type MovementSummary = {
  count: number;
  favorableRate: number | null;
  meanSignedPercent: number | null;
  meanGainPercent: number | null;
  meanLossPercent: number | null;
  meanAbsolutePercent: number | null;
};
export type ValidationRow = {
  segment: Segment;
  direction: Direction;
  horizonMinutes: number;
  signals: number;
  excludedNoNextBar: number;
  excludedIncompleteHorizon: number;
  unmatched: number;
  eligible: MovementSummary;
  matchedSignals: MovementSummary;
  matchedBaseline: Pick<MovementSummary, 'favorableRate' | 'meanSignedPercent' | 'meanAbsolutePercent'>;
  baselineObservations: number;
  meanDifferencePercent: number | null;
  differenceInterval99Percent: [number, number] | null;
  distinctSignalDays: number;
  smallSample: boolean;
};
export type ValidationStudy = {
  candles: number;
  firstTimestamp: string;
  lastTimestamp: string;
  splitIndex: number;
  splitTimestamp: string;
  totalSignals: number;
  rows: ValidationRow[];
};

const BAR_MS = 300_000;
const exchangeClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit',
  year: 'numeric', month: '2-digit', day: '2-digit', hourCycle: 'h23',
});

export function newYorkBarParts(timestamp: string): {slot: string; day: string} {
  const parts = Object.fromEntries(exchangeClock.formatToParts(new Date(timestamp)).map(p => [p.type, p.value]));
  return {slot: `${parts.hour}:${parts.minute}`, day: `${parts.year}-${parts.month}-${parts.day}`};
}

export function hypotheticalMovement(candles: readonly Candle[], index: number, horizon: number, end: number,
  direction: Direction): {value: number; reason: null} | {value: null; reason: 'next' | 'horizon'} {
  if (index + 1 >= end || Date.parse(candles[index + 1]!.timestamp) - Date.parse(candles[index]!.timestamp) !== BAR_MS) {
    return {value: null, reason: 'next'};
  }
  if (index + horizon >= end) return {value: null, reason: 'horizon'};
  for (let j = index + 2; j <= index + horizon; j++) {
    if (Date.parse(candles[j]!.timestamp) - Date.parse(candles[j - 1]!.timestamp) !== BAR_MS) {
      return {value: null, reason: 'horizon'};
    }
  }
  const entry = candles[index + 1]!.open;
  const exit = candles[index + horizon]!.close;
  const raw = (exit / entry - 1) * 100;
  return {value: direction === 'CALL_CONTEXT' ? raw : -raw, reason: null};
}

function summary(values: readonly number[]): MovementSummary {
  if (!values.length) return {count: 0, favorableRate: null, meanSignedPercent: null,
    meanGainPercent: null, meanLossPercent: null, meanAbsolutePercent: null};
  const gains = values.filter(n => n > 0);
  const losses = values.filter(n => n < 0);
  const mean = (items: readonly number[]) => items.reduce((a, b) => a + b, 0) / items.length;
  return {count: values.length, favorableRate: gains.length / values.length,
    meanSignedPercent: mean(values), meanGainPercent: gains.length ? mean(gains) : null,
    meanLossPercent: losses.length ? mean(losses) : null,
    meanAbsolutePercent: mean(values.map(Math.abs))};
}

/** Deterministic bootstrap resamples whole NY trading days to retain same-day dependence. */
function dayBootstrap(differences: readonly {day: string; value: number}[]): [number, number] | null {
  const byDay = new Map<string, number[]>();
  for (const item of differences) byDay.set(item.day, [...(byDay.get(item.day) ?? []), item.value]);
  if (differences.length < 30 || byDay.size < 10) return null;
  const days = [...byDay.values()];
  let seed = 82431;
  const random = () => {seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32;};
  const estimates: number[] = [];
  for (let b = 0; b < 2000; b++) {
    let sum = 0, count = 0;
    for (let d = 0; d < days.length; d++) {
      const sampled = days[Math.floor(random() * days.length)]!;
      for (const value of sampled) {sum += value; count++;}
    }
    estimates.push(sum / count);
  }
  estimates.sort((a, b) => a - b);
  // 99.17% per comparison (Bonferroni for 2 directions x 3 horizons).
  return [estimates[8]!, estimates[1991]!];
}

export function evaluateStrategy(candles: readonly Candle[], signals: readonly Signal[],
  splitIndex = Math.floor(candles.length * 0.7), excludedControlIndices?: ReadonlySet<number>): ValidationStudy {
  if (candles.length < 2 || splitIndex < 1 || splitIndex >= candles.length) throw new Error('División cronológica inválida.');
  const signalIndices = excludedControlIndices ?? new Set(signals.map(s => s.index));
  const rows: ValidationRow[] = [];
  for (const [segment, from, to] of [
    ['exploracion', 0, splitIndex], ['evaluacion', splitIndex, candles.length],
  ] as const) {
    for (const direction of ['CALL_CONTEXT', 'PUT_CONTEXT'] as const) {
      for (const horizon of HORIZONS) {
        const controls = new Map<string, number[]>();
        for (let i = from; i < to; i++) {
          if (signalIndices.has(i)) continue;
          const result = hypotheticalMovement(candles, i, horizon, to, direction);
          if (result.value === null) continue;
          const slot = newYorkBarParts(candles[i]!.timestamp).slot;
          controls.set(slot, [...(controls.get(slot) ?? []), result.value]);
        }
        const selected = signals.filter(s => s.direction === direction && s.index >= from && s.index < to);
        const eligible: number[] = [];
        const matched: number[] = [];
        const baselineRate: number[] = [];
        const baselineMean: number[] = [];
        const baselineAbsolute: number[] = [];
        const differences: {day: string; value: number}[] = [];
        let excludedNoNextBar = 0, excludedIncompleteHorizon = 0, unmatched = 0, baselineObservations = 0;
        for (const signal of selected) {
          const result = hypotheticalMovement(candles, signal.index, horizon, to, direction);
          if (result.value === null) {
            if (result.reason === 'next') excludedNoNextBar++;
            else excludedIncompleteHorizon++;
            continue;
          }
          eligible.push(result.value);
          const {slot, day} = newYorkBarParts(candles[signal.index]!.timestamp);
          const pool = controls.get(slot) ?? [];
          if (!pool.length) {unmatched++; continue;}
          const base = summary(pool);
          matched.push(result.value);
          baselineRate.push(base.favorableRate!);
          baselineMean.push(base.meanSignedPercent!);
          baselineAbsolute.push(base.meanAbsolutePercent!);
          baselineObservations += pool.length;
          differences.push({day, value: result.value - base.meanSignedPercent!});
        }
        const matchedSummary = summary(matched);
        const average = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
        const distinctSignalDays = new Set(differences.map(d => d.day)).size;
        rows.push({segment, direction, horizonMinutes: horizon * 5, signals: selected.length,
          excludedNoNextBar, excludedIncompleteHorizon, unmatched, eligible: summary(eligible),
          matchedSignals: matchedSummary,
          matchedBaseline: {favorableRate: average(baselineRate), meanSignedPercent: average(baselineMean),
            meanAbsolutePercent: average(baselineAbsolute)}, baselineObservations,
          meanDifferencePercent: average(differences.map(d => d.value)),
          differenceInterval99Percent: dayBootstrap(differences), distinctSignalDays,
          smallSample: matched.length < 30 || distinctSignalDays < 10});
      }
    }
  }
  return {candles: candles.length, firstTimestamp: candles[0]!.timestamp,
    lastTimestamp: candles.at(-1)!.timestamp, splitIndex,
    splitTimestamp: candles[splitIndex]!.timestamp, totalSignals: signals.length, rows};
}

export function chronologicalSplitIndex(candles: readonly Candle[]): number {
  const tentative = Math.floor(candles.length * 0.7);
  let split = tentative;
  while (split < candles.length && newYorkBarParts(candles[split - 1]!.timestamp).day === newYorkBarParts(candles[split]!.timestamp).day) {
    split++;
  }
  if (split >= candles.length) split = tentative;
  return split;
}

export function validateBollingerStrategy(candles: readonly Candle[]): ValidationStudy {
  return evaluateStrategy(candles, detectSignals(calculateBollinger(candles)), chronologicalSplitIndex(candles));
}
