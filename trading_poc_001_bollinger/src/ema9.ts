import type {Candle, Signal} from './domain.ts';

/** EMA(9) de cierres; primera salida = SMA de nueve cierres, luego factor 2/(9+1). */
export function calculateEma9(candles: readonly Candle[]): (number | null)[] {
  const values: (number | null)[] = [];
  let sum = 0;
  let previous: number | null = null;
  for (const [index, candle] of candles.entries()) {
    if (!Number.isFinite(candle.close) || candle.close <= 0) throw new Error('Cierre inválido para EMA 9.');
    if (index < 9) sum += candle.close;
    if (index < 8) {values.push(null); continue;}
    const current: number = index === 8 ? sum / 9 : (candle.close - previous!) * 0.2 + previous!;
    values.push(current);
    previous = current;
  }
  return values;
}

export function partitionByEma9(signals: readonly Signal[], ema: readonly (number | null)[]): {
  retained: Signal[]; discarded: Signal[];
} {
  const retained: Signal[] = [], discarded: Signal[] = [];
  for (const signal of signals) {
    if (!Number.isInteger(signal.index) || signal.index < 0 || signal.index >= ema.length) {
      throw new Error('Índice de señal fuera de la serie EMA 9.');
    }
    const current = ema[signal.index], previous = ema[signal.index - 1];
    const passes = current !== null && current !== undefined && previous !== null && previous !== undefined &&
      (signal.direction === 'CALL_CONTEXT' ? current > previous : current < previous);
    (passes ? retained : discarded).push(signal);
  }
  return {retained, discarded};
}
