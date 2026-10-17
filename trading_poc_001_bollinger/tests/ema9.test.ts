import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import type {Candle, Signal} from '../src/domain.ts';
import {calculateEma9, partitionByEma9} from '../src/ema9.ts';

const candles = (closes: number[]): Candle[] => closes.map((close, index) => ({
  timestamp: new Date(Date.UTC(2026, 5, 1, 13, 30 + index * 5)).toISOString(),
  open: close, high: close, low: close, close, volume: 1,
}));
const signal = (index: number, direction: Signal['direction']): Signal => ({
  index, timestamp: '', candleEndTimestamp: '', availableAt: '', direction, close: 0,
  previousBandwidthPercent: 0, currentBandwidthPercent: 0, squeezeThresholdPercent: 0,
});

test('EMA 9 usa SMA inicial y recursión con factor 0,2', () => {
  const values = calculateEma9(candles([1,2,3,4,5,6,7,8,9,10,11]));
  assert.deepEqual(values.slice(0, 8), Array(8).fill(null));
  assert.equal(values[8], 5);
  assert.equal(values[9], 6);
  assert.equal(values[10], 7);
  assert.equal(calculateEma9(candles(Array(12).fill(100)))[11], 100);
  assert.throws(() => calculateEma9(candles([1, 0])));
});

test('filtro conserva alcistas con EMA ascendente y bajistas con EMA descendente; igualdad descarta', () => {
  const up = calculateEma9(candles([1,2,3,4,5,6,7,8,9,10]));
  const upSignals = [signal(9, 'CALL_CONTEXT'), signal(9, 'PUT_CONTEXT')];
  const upResult = partitionByEma9(upSignals, up);
  assert.deepEqual(upResult.retained, [upSignals[0]]);
  assert.deepEqual(upResult.discarded, [upSignals[1]]);
  const down = calculateEma9(candles([10,9,8,7,6,5,4,3,2,1]));
  assert.equal(partitionByEma9([signal(9, 'PUT_CONTEXT')], down).retained.length, 1);
  assert.equal(partitionByEma9([signal(9, 'CALL_CONTEXT')], down).discarded.length, 1);
  const flat = calculateEma9(candles(Array(10).fill(100)));
  assert.equal(partitionByEma9([signal(9, 'CALL_CONTEXT')], flat).discarded.length, 1);
});

test('cambiar cierres futuros no altera EMA ni decisión de una señal anterior', () => {
  const original = candles([1,2,3,4,5,6,7,8,9,10,11,12]);
  const changed = candles([1,2,3,4,5,6,7,8,9,10,1000,2000]);
  const before = calculateEma9(original), after = calculateEma9(changed);
  assert.deepEqual(before.slice(0, 10), after.slice(0, 10));
  assert.equal(partitionByEma9([signal(9, 'CALL_CONTEXT')], before).retained.length,
    partitionByEma9([signal(9, 'CALL_CONTEXT')], after).retained.length);
});
