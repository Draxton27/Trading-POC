import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import type {Candle, Signal} from '../src/domain.ts';
import {evaluateEma9Filter} from '../src/ema9-study.ts';
import {renderEma9Report} from '../src/ema9-report.ts';

function sample(): Candle[] {
  const candles: Candle[] = [];
  let day = new Date('2026-06-01T00:00:00Z');
  while (candles.length < 780) {
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) {
      for (let minute = 0; minute < 78; minute++) {
        const index = candles.length;
        const close = index < 300 ? 100 + index * 0.01 : 106 - (index - 300) * 0.01;
        candles.push({timestamp: new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(),
          day.getUTCDate(), 13, 30 + minute * 5)).toISOString(),
        open: close, high: close, low: close, close, volume: 100});
      }
    }
    day = new Date(day.getTime() + 86_400_000);
  }
  return candles;
}

function signal(candles: Candle[], index: number): Signal {
  const end = new Date(Date.parse(candles[index]!.timestamp) + 300_000).toISOString();
  return {index, timestamp: candles[index]!.timestamp, candleEndTimestamp: end, availableAt: end,
    direction: 'CALL_CONTEXT', close: candles[index]!.close, previousBandwidthPercent: 1,
    currentBandwidthPercent: 2, squeezeThresholdPercent: 1};
}

test('tres grupos particionan las señales Bollinger y comparten controles horarios', () => {
  const candles = sample();
  const study = evaluateEma9Filter(candles, [signal(candles, 200), signal(candles, 434)]);
  assert.equal(study.originalSignals, 2);
  assert.equal(study.retainedSignals, 1);
  assert.equal(study.discardedSignals, 1);
  const row = (group: typeof study.original) => group.rows.find(r => r.segment === 'exploracion' &&
    r.direction === 'CALL_CONTEXT' && r.horizonMinutes === 15)!;
  const original = row(study.original), kept = row(study.retained), dropped = row(study.discarded);
  assert.equal(original.eligible.count, 2);
  assert.equal(kept.eligible.count, 1);
  assert.equal(dropped.eligible.count, 1);
  assert.ok(Math.abs(original.matchedBaseline.meanSignedPercent! - kept.matchedBaseline.meanSignedPercent!) < 1e-12);
  assert.ok(Math.abs(original.matchedBaseline.meanSignedPercent! - dropped.matchedBaseline.meanSignedPercent!) < 1e-12);
  assert.equal(original.baselineObservations, kept.baselineObservations + dropped.baselineObservations);
  const comparison = study.comparisons.find(c => c.segment === 'exploracion' &&
    c.direction === 'CALL_CONTEXT' && c.horizonMinutes === 15)!;
  assert.equal(comparison.originalEligible, 2);
  assert.equal(comparison.retainedEligible, 1);
  assert.ok(Math.abs(comparison.retainedMinusOriginalMeanPercent! -
    (kept.eligible.meanSignedPercent! - original.eligible.meanSignedPercent!)) < 1e-12);
  assert.equal(comparison.interval99Percent, null);
  const report = renderEma9Report(study, 'controlado.csv');
  assert.match(report, /EMA 9 conserva 1 y descarta 1 \(50\.0%\)/);
  assert.match(report, /No hay evidencia suficiente/);
});

test('el comando EMA 9 rechaza el CSV ficticio', () => {
  const project = fileURLToPath(new URL('../', import.meta.url));
  const result = spawnSync(process.execPath,
    ['--experimental-strip-types', 'src/validate-ema9.ts', 'data/QQQ_FICTICIO_5min.csv'],
    {cwd: project, encoding: 'utf8'});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requiere QQQ real de Alpaca SIP/);
});

test('si EMA retiene todas las señales, el reporte identifica grupos idénticos', () => {
  const candles = sample();
  const study = evaluateEma9Filter(candles, [signal(candles, 200)]);
  assert.equal(study.discardedSignals, 0);
  const comparison = study.comparisons.find(c => c.segment === 'exploracion' &&
    c.direction === 'CALL_CONTEXT' && c.horizonMinutes === 15)!;
  assert.equal(comparison.identicalSamples, true);
  assert.equal(comparison.retainedMinusOriginalMeanPercent, 0);
  assert.equal(comparison.interval99Percent, null);
  assert.match(renderEma9Report(study, 'controlado.csv'), /Los grupos original y filtrado son exactamente iguales/);
});
