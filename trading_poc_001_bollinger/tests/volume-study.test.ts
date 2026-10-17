import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import type {Candle, Signal} from '../src/domain.ts';
import {evaluateVolumeFilter} from '../src/volume-study.ts';
import {renderVolumeReport} from '../src/volume-report.ts';

function sample(): Candle[] {
  const candles: Candle[] = [];
  const day = new Date('2026-06-01T00:00:00Z');
  while (candles.length < 25 * 78) {
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) {
      for (let minute = 0; minute < 78; minute++) {
        const index = candles.length;
        const close = 100 + index * 0.01;
        candles.push({timestamp: new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(),
          day.getUTCDate(), 13, 30 + minute * 5)).toISOString(),
        open: close, high: close, low: close, close, volume: 100});
      }
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return candles;
}

function signal(candles: Candle[], index: number): Signal {
  const end = new Date(Date.parse(candles[index]!.timestamp) + 300_000).toISOString();
  return {index, timestamp: candles[index]!.timestamp, candleEndTimestamp: end, availableAt: end,
    direction: 'CALL_CONTEXT', close: candles[index]!.close,
    previousBandwidthPercent: 1, currentBandwidthPercent: 2, squeezeThresholdPercent: 1};
}

test('estudio separa retenidas, descartadas y sin historial sin cambiar los controles ni el corte', () => {
  const candles = sample();
  const slot = 20;
  const early = 5 * 78 + slot, kept = 21 * 78 + slot, dropped = 22 * 78 + slot;
  candles[kept]!.volume = 150;
  candles[dropped]!.volume = 149;
  const study = evaluateVolumeFilter(candles, [signal(candles, early), signal(candles, kept), signal(candles, dropped)]);
  assert.deepEqual([study.originalSignals, study.retainedSignals, study.discardedSignals, study.insufficientSignals],
    [3, 1, 1, 1]);
  assert.equal(study.original.splitIndex, study.retained.splitIndex);
  const row = (group: typeof study.original, segment: 'exploracion' | 'evaluacion') =>
    group.rows.find(r => r.segment === segment && r.direction === 'CALL_CONTEXT' && r.horizonMinutes === 15)!;
  assert.equal(row(study.insufficient, 'exploracion').signals, 1);
  assert.equal(row(study.retained, 'evaluacion').signals, 1);
  assert.equal(row(study.discarded, 'evaluacion').signals, 1);
  const original = row(study.original, 'evaluacion');
  assert.equal(original.signals, 2);
  assert.equal(original.eligible.count, row(study.retained, 'evaluacion').eligible.count +
    row(study.discarded, 'evaluacion').eligible.count);
  assert.equal(original.baselineObservations,
    row(study.retained, 'evaluacion').baselineObservations +
    row(study.discarded, 'evaluacion').baselineObservations);
  const comparison = study.comparisons.find(c => c.segment === 'evaluacion' &&
    c.direction === 'CALL_CONTEXT' && c.horizonMinutes === 15)!;
  assert.equal(comparison.originalEligible, 2);
  assert.equal(comparison.retainedEligible, 1);
  assert.equal(comparison.interval99Percent, null);
  const report = renderVolumeReport(study, 'controlado.csv');
  assert.match(report, /conserva \*\*1 \(33\.3%\)\*\*/);
  assert.match(report, /sin historial suficiente/);
  assert.match(report, /Todo el estudio es exploratorio/);
});

test('comando de volumen rechaza el CSV ficticio sin escribir reporte real', () => {
  const project = fileURLToPath(new URL('../', import.meta.url));
  const result = spawnSync(process.execPath,
    ['--experimental-strip-types', 'src/validate-volume.ts', 'data/QQQ_FICTICIO_5min.csv'],
    {cwd: project, encoding: 'utf8'});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requiere QQQ real de Alpaca SIP/);
});
