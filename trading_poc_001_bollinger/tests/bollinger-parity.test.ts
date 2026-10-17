import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {fileURLToPath} from 'node:url';
import {BollingerBands, BollingerBandsWidth} from 'trading-signals';
import {calculateBollinger} from '../src/bollinger.ts';
import {loadDataset} from '../src/csv.ts';
import type {Candle} from '../src/domain.ts';

const fixturePath = fileURLToPath(new URL('../data/QQQ_FICTICIO_5min.csv', import.meta.url));
const candlesFromCloses = (closes: readonly number[]): Candle[] => closes.map((close, i) => ({
  timestamp: new Date(Date.UTC(2026, 5, 1, 13, 30 + i * 5)).toISOString(),
  open: close, high: close, low: close, close, volume: 1,
}));

function assertNear(actual: number | null, expected: number, label: string): void {
  assert.notEqual(actual, null, `${label}: el POC aún no produjo un valor`);
  const tolerance = 1e-12 * Math.max(1, Math.abs(expected));
  assert.ok(Math.abs(actual! - expected) <= tolerance,
    `${label}: POC=${actual}, trading-signals=${expected}, tolerancia=${tolerance}`);
}

function compareEveryBar(candles: readonly Candle[], period: number, deviations: number): void {
  const local = calculateBollinger(candles, period, deviations);
  const externalBands = new BollingerBands(period, deviations);
  // BBW actualiza internamente su propia instancia de BBANDS: no reutilizar la anterior.
  const externalWidth = new BollingerBandsWidth(new BollingerBands(period, deviations));

  assert.equal(local.length, candles.length);
  for (const [i, candle] of candles.entries()) {
    const bands = externalBands.add(candle.close);
    const width = externalWidth.add(candle.close);
    const point = local[i]!;
    assert.equal(point.timestamp, candle.timestamp, `timestamp en vela ${i}`);
    if (i < period - 1) {
      assert.equal(bands, null, `BBANDS antes de completar ventana en vela ${i}`);
      assert.equal(width, null, `BBW antes de completar ventana en vela ${i}`);
      assert.equal(point.middle, null, `media local antes de completar ventana en vela ${i}`);
      assert.equal(point.upper, null, `banda superior local antes de completar ventana en vela ${i}`);
      assert.equal(point.lower, null, `banda inferior local antes de completar ventana en vela ${i}`);
      assert.equal(point.bandwidth, null, `ancho local antes de completar ventana en vela ${i}`);
      continue;
    }
    assert.ok(bands !== null && width !== null, `la biblioteca debe producir resultado en vela ${i}`);
    assertNear(point.middle, bands.middle, `media en vela ${i}`);
    assertNear(point.upper, bands.upper, `banda superior en vela ${i}`);
    assertNear(point.lower, bands.lower, `banda inferior en vela ${i}`);
    assertNear(point.bandwidth, width, `ancho en vela ${i}`);
  }
}

test('paridad vela por vela: 7.800 velas ficticias, Bollinger 20/2', () => {
  const {candles, metadata} = loadDataset(fixturePath);
  assert.equal(metadata.data_class, 'synthetic');
  assert.equal(candles.length, 7800);
  compareEveryBar(candles, 20, 2);
});

test('paridad vela por vela: series controladas y ventanas/multiplicadores distintos', () => {
  const closes = [
    ...Array(25).fill(100),
    ...Array.from({length: 30}, (_, i) => 100 + i * 0.15),
    ...Array.from({length: 25}, (_, i) => 104 + (i % 2 ? -0.8 : 0.9)),
  ] as number[];
  const candles = candlesFromCloses(closes);
  for (const [period, deviations] of [[2, 1], [5, 2.5], [20, 2]] as const) {
    compareEveryBar(candles, period, deviations);
  }
});

test('diferencia documentada fuera del contrato CSV: media cero', () => {
  const candles = candlesFromCloses([0, 0, 0, 0, 0]);
  const local = calculateBollinger(candles, 5, 2);
  const externalWidth = new BollingerBandsWidth(new BollingerBands(5, 2));
  const widths = candles.map(candle => externalWidth.add(candle.close));
  assert.equal(local[4]!.bandwidth, null);
  assert.ok(Number.isNaN(widths[4]));
});
