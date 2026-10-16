import {readFileSync, writeFileSync} from 'node:fs';
import type {Candle} from './domain.ts';

const FIELDS = ['timestamp', 'open', 'high', 'low', 'close', 'volume'] as const;

export function loadCandles(filePath: string): Candle[] {
  const lines = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const cols = lines.shift()?.split(',').map(s => s.trim().toLowerCase());
  if (!cols || FIELDS.some(f => !cols.includes(f))) throw new Error('CSV debe contener: timestamp,open,high,low,close,volume');
  const candles: Candle[] = [];
  let lastTime = -Infinity;
  for (const [i, line] of lines.entries()) {
    const values = line.split(',');
    const byName = Object.fromEntries(cols.map((c, j) => [c, values[j]?.trim()])) as Record<string,string>;
    const nums = FIELDS.slice(1).map(key => Number(byName[key]));
    const t = Date.parse(byName.timestamp ?? '');
    const [open, high, low, close, volume] = nums;
    if (!Number.isFinite(t) || t <= lastTime || nums.some(n => !Number.isFinite(n)) || open! <= 0 || close! <= 0 || low! <= 0 || high! < Math.max(open!,close!,low!) || low! > Math.min(open!,close!) || volume! < 0) {
      throw new Error(`Datos OHLCV invalidos o desordenados en linea ${i + 2}`);
    }
    candles.push({timestamp: new Date(t).toISOString(),open:open!,high:high!,low:low!,close:close!,volume:volume!});
    lastTime = t;
  }
  if (!candles.length) throw new Error('El CSV no contiene velas.');
  return candles;
}

export function saveCandles(path: string, candles: readonly Candle[]) {
  writeFileSync(path, FIELDS.join(',') + '\n' + candles.map(c=>`${c.timestamp},${c.open.toFixed(4)},${c.high.toFixed(4)},${c.low.toFixed(4)},${c.close.toFixed(4)},${Math.round(c.volume)}`).join('\n') + '\n');
}
