import type {Candle, Direction, Signal} from './domain.ts';
import {calculateBollinger} from './bollinger.ts';
import {detectSignals} from './signals.ts';
import {partitionByVolume, VOLUME_LOOKBACK_SESSIONS, VOLUME_MULTIPLIER} from './volume-filter.ts';
import {chronologicalSplitIndex, evaluateStrategy, hypotheticalMovement, newYorkBarParts,
  HORIZONS, type Segment, type ValidationStudy} from './strategy-validation.ts';

export type VolumeComparison = {
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
export type HistoryComparison = Omit<VolumeComparison,
  'originalEligible' | 'retainedMinusOriginalMeanPercent' | 'retainedMinusOriginalFavorableRate'> & {
  historyEligible: number;
  retainedMinusHistoryMeanPercent: number | null;
  retainedMinusHistoryFavorableRate: number | null;
};
export type VolumeStudy = {
  original: ValidationStudy;
  withHistory: ValidationStudy;
  retained: ValidationStudy;
  discarded: ValidationStudy;
  insufficient: ValidationStudy;
  comparisons: VolumeComparison[];
  comparisonsWithHistory: HistoryComparison[];
  originalSignals: number;
  withHistorySignals: number;
  retainedSignals: number;
  discardedSignals: number;
  insufficientSignals: number;
  lookbackSessions: 20;
  multiplier: 1.5;
};

type Observation = {day: string; value: number; retained: boolean};
const mean = (values: readonly number[]): number | null =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

/** Paired bootstrap by NY session; only eligible retained observations enter the subset mean. */
function differenceInterval(observations: readonly Observation[]): [number, number] | null {
  const retained = observations.filter(o => o.retained);
  const byDay = new Map<string, Observation[]>();
  for (const observation of observations) byDay.set(observation.day,
    [...(byDay.get(observation.day) ?? []), observation]);
  if (retained.length < 30 || new Set(retained.map(o => o.day)).size < 10) return null;
  const days = [...byDay.values()];
  let seed = 62497;
  const random = () => {seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32;};
  const estimates: number[] = [];
  for (let b = 0; b < 2000; b++) {
    let allSum = 0, allCount = 0, retainedSum = 0, retainedCount = 0;
    for (let d = 0; d < days.length; d++) {
      for (const observation of days[Math.floor(random() * days.length)]!) {
        allSum += observation.value;
        allCount++;
        if (observation.retained) {retainedSum += observation.value; retainedCount++;}
      }
    }
    if (retainedCount) estimates.push(retainedSum / retainedCount - allSum / allCount);
  }
  if (estimates.length < 1900) return null;
  estimates.sort((a, b) => a - b);
  // Six prespecified comparisons: two directions times three horizons.
  return [estimates[Math.floor(estimates.length * 0.00417)]!,
    estimates[Math.floor(estimates.length * 0.99583)]!];
}

export function studyVolumeFilter(candles: readonly Candle[]): VolumeStudy {
  return evaluateVolumeFilter(candles, detectSignals(calculateBollinger(candles)));
}

function compareSignals(candles: readonly Candle[], referenceSignals: readonly Signal[],
  retainedIndices: ReadonlySet<number>, split: number): VolumeComparison[] {
  const comparisons: VolumeComparison[] = [];
  for (const [segment, from, to] of [
    ['exploracion', 0, split], ['evaluacion', split, candles.length],
  ] as const) {
    for (const direction of ['CALL_CONTEXT', 'PUT_CONTEXT'] as const) {
      const selected = referenceSignals.filter(signal => signal.direction === direction &&
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
  return comparisons;
}

export function evaluateVolumeFilter(candles: readonly Candle[], originalSignals: readonly Signal[]): VolumeStudy {
  if (candles.length < 300) throw new Error('Se requieren al menos 300 velas para investigar volumen.');
  const {retained, discarded, insufficient} = partitionByVolume(originalSignals, candles);
  const insufficientIndices = new Set(insufficient.map(signal => signal.index));
  const withHistorySignals = originalSignals.filter(signal => !insufficientIndices.has(signal.index));
  const split = chronologicalSplitIndex(candles);
  const controls = new Set(originalSignals.map(signal => signal.index));
  const original = evaluateStrategy(candles, originalSignals, split, controls);
  const withHistory = evaluateStrategy(candles, withHistorySignals, split, controls);
  const retainedStudy = evaluateStrategy(candles, retained, split, controls);
  const discardedStudy = evaluateStrategy(candles, discarded, split, controls);
  const insufficientStudy = evaluateStrategy(candles, insufficient, split, controls);
  const retainedIndices = new Set(retained.map(signal => signal.index));
  const comparisons = compareSignals(candles, originalSignals, retainedIndices, split);
  const comparisonsWithHistory: HistoryComparison[] = compareSignals(candles, withHistorySignals,
    retainedIndices, split).map(comparison => {
    const {originalEligible, retainedMinusOriginalMeanPercent,
      retainedMinusOriginalFavorableRate, ...shared} = comparison;
    return {...shared, historyEligible: originalEligible,
      retainedMinusHistoryMeanPercent: retainedMinusOriginalMeanPercent,
      retainedMinusHistoryFavorableRate: retainedMinusOriginalFavorableRate};
  });
  return {original, withHistory, retained: retainedStudy, discarded: discardedStudy, insufficient: insufficientStudy,
    comparisons, comparisonsWithHistory, originalSignals: originalSignals.length,
    withHistorySignals: withHistorySignals.length, retainedSignals: retained.length,
    discardedSignals: discarded.length, insufficientSignals: insufficient.length,
    lookbackSessions: VOLUME_LOOKBACK_SESSIONS, multiplier: VOLUME_MULTIPLIER};
}
