import {readFileSync, writeFileSync} from 'node:fs';
import type {Candle} from './domain.ts';
import {loadMetadata, parseBarStart, validateBarTime, type DataMetadata} from './data-contract.ts';

const FIELDS = ['timestamp', 'open', 'high', 'low', 'close', 'volume'] as const;
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export function parseCandlesCsv(content: string, metadata: DataMetadata): Candle[] {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim() !== '');
  const cols = lines.shift()?.split(',').map(s => s.trim().toLowerCase());
  if (!cols || cols.length !== FIELDS.length || new Set(cols).size !== FIELDS.length ||
      FIELDS.some(f => !cols.includes(f))) throw new Error('CSV debe contener exactamente: timestamp,open,high,low,close,volume');
  const candles: Candle[] = [];
  let lastTime = -Infinity;
  for (const [i, line] of lines.entries()) {
    const values = line.split(',');
    if (values.length !== cols.length) throw new Error(`Numero de columnas invalido en linea ${i + 2}`);
    const byName = Object.fromEntries(cols.map((c, j) => [c, values[j]?.trim()])) as Record<string,string>;
    const nums = FIELDS.slice(1).map(key => DECIMAL.test(byName[key] ?? '') ? Number(byName[key]) : NaN);
    let t: number;
    try { t = parseBarStart(byName.timestamp ?? ''); }
    catch (error) { throw new Error(`Timestamp invalido en linea ${i + 2}: ${String(error)}`); }
    const [open, high, low, close, volume] = nums;
    if (t <= lastTime || nums.some(n => !Number.isFinite(n)) || open! <= 0 || close! <= 0 || low! <= 0 || high! <= 0 ||
        high! < Math.max(open!,close!,low!) || low! > Math.min(open!,close!) || volume! < 0 || !Number.isInteger(volume)) {
      throw new Error(`Datos OHLCV invalidos o desordenados en linea ${i + 2}`);
    }
    try { validateBarTime(t, Number.isFinite(lastTime) ? lastTime : null, metadata); }
    catch (error) { throw new Error(`Tiempo invalido en linea ${i + 2}: ${String(error)}`); }
    candles.push({timestamp: new Date(t).toISOString(),open:open!,high:high!,low:low!,close:close!,volume:volume!});
    lastTime = t;
  }
  if (!candles.length) throw new Error('El CSV no contiene velas.');
  return candles;
}

export function loadCandles(filePath: string, metadata: DataMetadata): Candle[] {
  return parseCandlesCsv(readFileSync(filePath, 'utf8'), metadata);
}

export function loadDataset(filePath: string): {candles: Candle[]; metadata: DataMetadata} {
  const metadata = loadMetadata(filePath);
  return {candles: loadCandles(filePath, metadata), metadata};
}

export function saveCandles(path: string, candles: readonly Candle[]) {
  writeFileSync(path, FIELDS.join(',') + '\n' + candles.map(c=>`${c.timestamp},${c.open.toFixed(4)},${c.high.toFixed(4)},${c.low.toFixed(4)},${c.close.toFixed(4)},${Math.round(c.volume)}`).join('\n') + '\n');
}
