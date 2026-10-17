import type {Candle, Direction, Outcome, Signal} from './domain.ts';
import {barEndTimestamp} from './data-contract.ts';

/** Evita evaluar una vela futura si hubo un salto de sesion o falta alguna vela 5-min. */
function hasContiguousBars(candles: readonly Candle[], at: number, horizon: number): boolean {
  for (let j = at + 1; j <= at + horizon; j++) {
    const a = new Date(candles[j - 1]!.timestamp).getTime();
    const b = new Date(candles[j]!.timestamp).getTime();
    if (b - a !== 300_000) return false;
  }
  return true;
}

export function evaluateSignals(candles: readonly Candle[], signals: readonly Signal[], horizons = [3, 6, 12], fromIndex = 0, toIndex = candles.length): Outcome[] {
  const outcomes: Outcome[] = [];
  for (const signal of signals) {
    if (signal.index < fromIndex || signal.index >= toIndex) continue;
    for (const horizon of horizons) {
      const target = signal.index + horizon;
      if (target >= toIndex || target >= candles.length || !hasContiguousBars(candles, signal.index, horizon)) continue;
      const priceReturn = (candles[target]!.close / candles[signal.index]!.close - 1) * 100;
      const signedReturnPercent = signal.direction === 'CALL_CONTEXT' ? priceReturn : -priceReturn;
      outcomes.push({signal, horizon, signedReturnPercent, favored: signedReturnPercent > 0});
    }
  }
  return outcomes;
}

export function evaluateBaseline(candles: readonly Candle[], horizon: number, direction: Direction, fromIndex: number, toIndex: number): {samples: number; positiveRate: number; averageSignedReturnPercent: number} {
  let samples = 0;
  let positive = 0;
  let sum = 0;
  const all = [] as Signal[];
  for (let i = fromIndex; i + horizon < toIndex; i++) {
    all.push({index:i,timestamp:candles[i]!.timestamp,candleEndTimestamp:barEndTimestamp(candles[i]!.timestamp),availableAt:barEndTimestamp(candles[i]!.timestamp),direction,close:candles[i]!.close,previousBandwidthPercent:0,currentBandwidthPercent:0,squeezeThresholdPercent:0});
  }
  const observations = evaluateSignals(candles,all,[horizon],fromIndex,toIndex);
  for (const obs of observations) {samples++; positive += Number(obs.favored); sum += obs.signedReturnPercent;}
  return {samples,positiveRate: samples ? positive/samples : 0,averageSignedReturnPercent:samples?sum/samples:0};
}

// Wilson 95% CI for a binomial rate; summary of observed success frequency, not a future-trade guarantee.
export function wilson95(successes: number, total: number): [number, number] | null {
  if (total === 0) return null;
  const z = 1.96;
  const p = successes / total;
  const denom = 1 + z*z/total;
  const center = (p + z*z/(2*total)) / denom;
  const half = z*Math.sqrt((p*(1-p)+z*z/(4*total))/total)/denom;
  return [Math.max(0,center-half),Math.min(1,center+half)];
}
