import type {Candle, Signal} from './domain.ts';
import {newYorkBarParts} from './strategy-validation.ts';

export const VOLUME_LOOKBACK_SESSIONS = 20;
export const VOLUME_MULTIPLIER = 1.5;

export type VolumeReference = {
  average: number | null;
  priorSessions: number;
  matchingSessions: number;
};

/** Uses only completed, observed NY sessions; the current session is never in the reference. */
export function calculateVolumeReferences(candles: readonly Candle[]): VolumeReference[] {
  const result: VolumeReference[] = [];
  const history: Map<string, number>[] = [];
  let day = '';
  let current = new Map<string, number>();
  let lastTimestamp = -Infinity;
  for (const candle of candles) {
    const timestamp = Date.parse(candle.timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= lastTimestamp ||
        !Number.isFinite(candle.volume) || candle.volume < 0) {
      throw new Error('Velas desordenadas o volumen inválido para el filtro.');
    }
    lastTimestamp = timestamp;
    const parts = newYorkBarParts(candle.timestamp);
    if (parts.day !== day) {
      if (day) {
        history.push(current);
        if (history.length > VOLUME_LOOKBACK_SESSIONS) history.shift();
      }
      day = parts.day;
      current = new Map();
    }
    if (current.has(parts.slot)) throw new Error('Horario local duplicado en una sesión.');
    const volumes = history.map(session => session.get(parts.slot));
    const matchingSessions = volumes.filter((volume): volume is number => volume !== undefined).length;
    result.push({average: history.length === VOLUME_LOOKBACK_SESSIONS &&
      matchingSessions === VOLUME_LOOKBACK_SESSIONS ?
      volumes.reduce<number>((sum, volume) => sum + volume!, 0) / VOLUME_LOOKBACK_SESSIONS : null,
    priorSessions: history.length, matchingSessions});
    current.set(parts.slot, candle.volume);
  }
  return result;
}

export function partitionByVolume(signals: readonly Signal[], candles: readonly Candle[],
  references = calculateVolumeReferences(candles)): {retained: Signal[]; discarded: Signal[]; insufficient: Signal[]} {
  if (references.length !== candles.length) throw new Error('Referencias de volumen incompletas.');
  const retained: Signal[] = [], discarded: Signal[] = [], insufficient: Signal[] = [];
  for (const signal of signals) {
    if (!Number.isInteger(signal.index) || signal.index < 0 || signal.index >= candles.length) {
      throw new Error('Índice de señal fuera de las velas.');
    }
    const average = references[signal.index]!.average;
    if (average === null) insufficient.push(signal);
    else if (candles[signal.index]!.volume >= VOLUME_MULTIPLIER * average) retained.push(signal);
    else discarded.push(signal);
  }
  return {retained, discarded, insufficient};
}
