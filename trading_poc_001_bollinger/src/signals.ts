import type {BollingerPoint, Signal} from './domain.ts';
import {barEndTimestamp} from './data-contract.ts';

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lo = Math.floor(position);
  const hi = Math.ceil(position);
  const alpha = position - lo;
  return sorted[lo]! * (1 - alpha) + sorted[hi]! * alpha;
}

/**
 * Ejemplo de hipotesis, NO estrategia probada:
 *  - la amplitud anterior estaba entre el 20 % de valores mas bajos de las ultimas 100 velas;
 *  - la amplitud actual crece al menos un 5 % respecto a la anterior;
 *  - el cierre actual supera la banda superior o cae bajo la banda inferior.
 * Solo usa datos en o antes de la vela actual.
 */
export function detectSignals(
  points: readonly BollingerPoint[],
  lookback = 100,
  lowQuantile = 0.20,
  minExpansion = 1.05,
  cooldownBars = 12,
  barMinutes: 5 | 15 = 5
): Signal[] {
  if (lookback < 20 || lowQuantile <= 0 || lowQuantile >= 1 || minExpansion <= 1 || cooldownBars < 0) {
    throw new Error('Parametros de deteccion invalidos.');
  }
  const results: Signal[] = [];
  let lastSignalIndex = -Infinity;
  for (let i = lookback + 20; i < points.length; i++) {
    if (i - lastSignalIndex <= cooldownBars) continue;
    const current = points[i]!;
    const previous = points[i - 1]!;
    if (current.bandwidth === null || previous.bandwidth === null || current.upper === null || current.lower === null) continue;
    const history = points.slice(i - lookback, i).map(p => p.bandwidth).filter((n): n is number => n !== null);
    if (history.length < lookback) continue;
    const threshold = quantile(history, lowQuantile);
    if (previous.bandwidth > threshold || current.bandwidth <= previous.bandwidth * minExpansion) continue;
    const direction = current.close > current.upper ? 'CALL_CONTEXT' : current.close < current.lower ? 'PUT_CONTEXT' : null;
    if (!direction) continue;
    results.push({
      index: i,
      timestamp: current.timestamp,
      candleEndTimestamp: barEndTimestamp(current.timestamp, barMinutes),
      availableAt: barEndTimestamp(current.timestamp, barMinutes),
      direction,
      close: current.close,
      previousBandwidthPercent: previous.bandwidth * 100,
      currentBandwidthPercent: current.bandwidth * 100,
      squeezeThresholdPercent: threshold * 100,
    });
    lastSignalIndex = i;
  }
  return results;
}
