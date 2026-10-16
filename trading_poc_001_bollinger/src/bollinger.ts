import type {Candle, BollingerPoint} from './domain.ts';

/** Bandas de Bollinger sobre precios de cierre, SMA(period) +- desviaciones*std poblacional. */
export function calculateBollinger(candles: readonly Candle[], period = 20, deviations = 2): BollingerPoint[] {
  if (!Number.isInteger(period) || period < 2 || !Number.isFinite(deviations) || deviations <= 0) {
    throw new Error('Parametros de Bollinger invalidos.');
  }
  return candles.map((candle, i) => {
    if (i + 1 < period) {
      return {timestamp: candle.timestamp, close: candle.close, middle: null, upper: null, lower: null, bandwidth: null};
    }
    const window = candles.slice(i + 1 - period, i + 1).map(c => c.close);
    const middle = window.reduce((a, b) => a + b, 0) / period;
    const variance = window.reduce((a, x) => a + (x - middle) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    const upper = middle + deviations * std;
    const lower = middle - deviations * std;
    const bandwidth = middle > 0 ? (upper - lower) / middle : null;
    return {timestamp: candle.timestamp, close: candle.close, middle, upper, lower, bandwidth};
  });
}
