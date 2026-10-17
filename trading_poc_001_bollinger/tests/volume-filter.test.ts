import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import type {Candle, Signal} from '../src/domain.ts';
import {calculateVolumeReferences, partitionByVolume} from '../src/volume-filter.ts';

function sessions(count: number, slots = 2): Candle[] {
  const candles: Candle[] = [];
  const day = new Date('2026-03-02T00:00:00Z');
  while (new Set(candles.map(c => c.timestamp.slice(0, 10))).size < count) {
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) {
      const hour = day.toISOString().slice(0, 10) < '2026-03-09' ? 14 : 13;
      for (let slot = 0; slot < slots; slot++) {
        candles.push({timestamp: new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(),
          day.getUTCDate(), hour, 30 + slot * 5)).toISOString(),
        open: 100, high: 100, low: 100, close: 100, volume: slot === 0 ? 100 : 1000});
      }
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return candles;
}

function signal(index: number): Signal {
  return {index, timestamp: '', candleEndTimestamp: '', availableAt: '', direction: 'CALL_CONTEXT', close: 100,
    previousBandwidthPercent: 1, currentBandwidthPercent: 2, squeezeThresholdPercent: 1};
}

test('promedia exactamente las 20 sesiones previas en el mismo horario NY, incluso tras horario de verano', () => {
  const candles = sessions(21);
  candles[40]!.volume = 150;
  candles[41]!.volume = 1499;
  const references = calculateVolumeReferences(candles);
  assert.equal(references[38]!.average, null);
  assert.equal(references[38]!.priorSessions, 19);
  assert.deepEqual(references[40], {average: 100, priorSessions: 20, matchingSessions: 20});
  assert.deepEqual(references[41], {average: 1000, priorSessions: 20, matchingSessions: 20});
  assert.deepEqual(partitionByVolume([signal(38), signal(40), signal(41)], candles, references), {
    retained: [signal(40)], discarded: [signal(41)], insufficient: [signal(38)],
  });
  assert.equal(candles[0]!.timestamp.includes('14:30'), true);
  assert.equal(candles[40]!.timestamp.includes('13:30'), true);
});

test('un horario ausente en una de las 20 sesiones no se sustituye por otro más antiguo', () => {
  const candles = sessions(22).filter((_, index) => index !== 11);
  const references = calculateVolumeReferences(candles);
  const last = candles.length - 2;
  assert.equal(references[last]!.average, 100);
  assert.equal(references[last + 1]!.average, null);
  assert.equal(references[last + 1]!.priorSessions, 20);
  assert.equal(references[last + 1]!.matchingSessions, 19);
  assert.equal(partitionByVolume([signal(last + 1)], candles, references).insufficient.length, 1);
});

test('vela actual, otras velas de su sesión y velas futuras no modifican su referencia', () => {
  const candles = sessions(22);
  candles[40]!.volume = 150;
  const reference = calculateVolumeReferences(candles)[40]!.average;
  const decision = partitionByVolume([signal(40)], candles).retained.length;
  candles[41]!.volume = 99999;
  candles[42]!.volume = 99999;
  assert.equal(partitionByVolume([signal(40)], candles).retained.length, decision);
  candles[40]!.volume = 99999;
  assert.equal(calculateVolumeReferences(candles)[40]!.average, reference);
  assert.equal(reference, 100);
  assert.equal(partitionByVolume([signal(40)], candles).retained.length, 1);
  assert.throws(() => calculateVolumeReferences([...candles].reverse()), /desordenadas/);
});
