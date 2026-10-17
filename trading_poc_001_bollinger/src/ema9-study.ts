import type {Candle, Direction, Signal} from './domain.ts';
import {calculateBollinger} from './bollinger.ts';
import {detectSignals} from './signals.ts';
import {calculateEma9, partitionByEma9} from './ema9.ts';
import {chronologicalSplitIndex, evaluateStrategy, hypotheticalMovement, newYorkBarParts,
  HORIZONS, type Segment, type ValidationStudy} from './strategy-validation.ts';

export type Ema9Comparison = {
  segment: Segment;
  direction: Direction;
  horizonMinutes: number;
  originalEligible: number;
  retainedEligible: number;
  retainedMinusOriginalMeanPercent: number | null;
  retainedMinusOriginalFavorableRate: number | null;
  interval99Percent: [number, number] | null;
  identicalSamples: boolean;
  retainedDays: number;
  smallSample: boolean;
};
export type Ema9Study = {
  original: ValidationStudy;
  retained: ValidationStudy;
  discarded: ValidationStudy;
  comparisons: Ema9Comparison[];
  originalSignals: number;
  retainedSignals: number;
  discardedSignals: number;
  emaPeriod: 9;
  emaSeed: 'sma9';
};

type Observation = {day: string; value: number; retained: boolean};
function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/** Paired day bootstrap: retained observations are a subset of the original sample. */
function differenceInterval(observations: readonly Observation[]): [number, number] | null {
  const retained = observations.filter(o => o.retained);
  const byDay = new Map<string, Observation[]>();
  for (const observation of observations) byDay.set(observation.day,
    [...(byDay.get(observation.day) ?? []), observation]);
  if (retained.length < 30 || new Set(retained.map(o => o.day)).size < 10) return null;
  const days = [...byDay.values()];
  let seed = 53491;
  const random = () => {seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32;};
  const estimates: number[] = [];
  for (let b = 0; b < 2000; b++) {
    let originalSum = 0, originalCount = 0, retainedSum = 0, retainedCount = 0;
    for (let d = 0; d < days.length; d++) {
      for (const observation of days[Math.floor(random() * days.length)]!) {
        originalSum += observation.value;
        originalCount++;
        if (observation.retained) {retainedSum += observation.value; retainedCount++;}
      }
    }
    if (retainedCount) estimates.push(retainedSum / retainedCount - originalSum / originalCount);
  }
  if (estimates.length < 1900) return null;
  estimates.sort((a, b) => a - b);
  // Six prespecified comparisons: two directions times three horizons.
  return [estimates[Math.floor(estimates.length * 0.00417)]!,
    estimates[Math.floor(estimates.length * 0.99583)]!];
}

export function studyEma9Filter(candles: readonly Candle[]): Ema9Study {
  return evaluateEma9Filter(candles, detectSignals(calculateBollinger(candles)));
}

export function evaluateEma9Filter(candles: readonly Candle[], originalSignals: readonly Signal[]): Ema9Study {
  if (candles.length < 300) throw new Error('Se requieren al menos 300 velas para investigar EMA 9.');
  const {retained, discarded} = partitionByEma9(originalSignals, calculateEma9(candles));
  const split = chronologicalSplitIndex(candles);
  const controlExclusion = new Set(originalSignals.map(signal => signal.index));
  const original = evaluateStrategy(candles, originalSignals, split, controlExclusion);
  const retainedStudy = evaluateStrategy(candles, retained, split, controlExclusion);
  const discardedStudy = evaluateStrategy(candles, discarded, split, controlExclusion);
  const retainedIndices = new Set(retained.map(signal => signal.index));
  const comparisons: Ema9Comparison[] = [];
  for (const [segment, from, to] of [
    ['exploracion', 0, split], ['evaluacion', split, candles.length],
  ] as const) {
    for (const direction of ['CALL_CONTEXT', 'PUT_CONTEXT'] as const) {
      const selected = originalSignals.filter(signal => signal.direction === direction &&
        signal.index >= from && signal.index < to);
      for (const horizon of HORIZONS) {
        const observations: Observation[] = [];
        for (const signal of selected) {
          const result = hypotheticalMovement(candles, signal.index, horizon, to, direction);
          if (result.value === null) continue;
          observations.push({day: newYorkBarParts(candles[signal.index]!.timestamp).day,
            value: result.value, retained: retainedIndices.has(signal.index)});
        }
        const kept = observations.filter(o => o.retained);
        const allMean = mean(observations.map(o => o.value));
        const keptMean = mean(kept.map(o => o.value));
        const allRate = mean(observations.map(o => Number(o.value > 0)));
        const keptRate = mean(kept.map(o => Number(o.value > 0)));
        const retainedDays = new Set(kept.map(o => o.day)).size;
        const identicalSamples = observations.length > 0 && kept.length === observations.length;
        comparisons.push({segment, direction, horizonMinutes: horizon * 5,
          originalEligible: observations.length, retainedEligible: kept.length,
          retainedMinusOriginalMeanPercent: keptMean === null || allMean === null ? null : keptMean - allMean,
          retainedMinusOriginalFavorableRate: keptRate === null || allRate === null ? null : keptRate - allRate,
          interval99Percent: identicalSamples ? null : differenceInterval(observations), identicalSamples, retainedDays,
          smallSample: kept.length < 30 || retainedDays < 10});
      }
    }
  }
  return {original, retained: retainedStudy, discarded: discardedStudy, comparisons,
    originalSignals: originalSignals.length, retainedSignals: retained.length,
    discardedSignals: discarded.length, emaPeriod: 9, emaSeed: 'sma9'};
}
