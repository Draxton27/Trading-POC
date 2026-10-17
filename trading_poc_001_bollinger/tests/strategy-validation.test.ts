import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import type {Candle, Signal} from '../src/domain.ts';
import {evaluateStrategy, validateBollingerStrategy} from '../src/strategy-validation.ts';
import {renderValidationReport} from '../src/validation-report.ts';

function day(start: string, exitClose: number, signalClose = 100): Candle[] {
  const base = Date.parse(start);
  return Array.from({length: 4}, (_, i) => {
    const open = i === 1 ? 100 : 100;
    const close = i === 0 ? signalClose : i === 3 ? exitClose : 100;
    return {timestamp: new Date(base + i * 300_000).toISOString(), open,
      high: Math.max(open, close), low: Math.min(open, close), close, volume: 100};
  });
}

function signal(candles: Candle[], index: number, direction: Signal['direction'] = 'CALL_CONTEXT'): Signal {
  const end = new Date(Date.parse(candles[index]!.timestamp) + 300_000).toISOString();
  return {index, timestamp: candles[index]!.timestamp, candleEndTimestamp: end,
    availableAt: end, direction, close: candles[index]!.close,
    previousBandwidthPercent: 1, currentBandwidthPercent: 2, squeezeThresholdPercent: 1};
}
const near = (actual: number | null, expected: number) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-10);

test('mide desde la apertura siguiente, compara el mismo horario y separa exploración de evaluación', () => {
  const candles = [
    ...day('2026-06-01T13:30:00Z', 106, 110), // señal: +6% desde 100, no desde cierre 110
    ...day('2026-06-02T13:30:00Z', 102),      // referencia: +2%
    ...day('2026-06-03T13:30:00Z', 98),       // señal posterior: -2%
    ...day('2026-06-04T13:30:00Z', 101),      // referencia posterior: +1%
  ];
  const study = evaluateStrategy(candles, [signal(candles, 0), signal(candles, 8)], 8);
  const first = study.rows.find(r => r.segment === 'exploracion' && r.direction === 'CALL_CONTEXT' && r.horizonMinutes === 15)!;
  const later = study.rows.find(r => r.segment === 'evaluacion' && r.direction === 'CALL_CONTEXT' && r.horizonMinutes === 15)!;
  near(first.eligible.meanSignedPercent, 6);
  near(first.matchedBaseline.meanSignedPercent, 2);
  near(first.meanDifferencePercent, 4);
  near(later.eligible.meanSignedPercent, -2);
  near(later.matchedBaseline.meanSignedPercent, 1);
  near(later.meanDifferencePercent, -3);
  assert.equal(later.eligible.favorableRate, 0);
  near(later.eligible.meanLossPercent, -2);
  near(later.eligible.meanAbsolutePercent, 2);
  assert.equal(first.baselineObservations, 1);
  assert.equal(first.smallSample, true);
  assert.equal(first.differenceInterval99Percent, null);
  assert.match(renderValidationReport(study, 'ejemplo-controlado.csv'), /No hay base suficiente/);
});

test('no usa la apertura de otra sesión ni horizontes que crucen el corte cronológico', () => {
  const candles = [
    ...day('2026-06-01T13:30:00Z', 101),
    ...day('2026-06-02T13:30:00Z', 102),
    ...day('2026-06-03T13:30:00Z', 103),
    ...day('2026-06-04T13:30:00Z', 104),
  ];
  const study = evaluateStrategy(candles, [signal(candles, 3), signal(candles, 6)], 8);
  const first = study.rows.find(r => r.segment === 'exploracion' && r.direction === 'CALL_CONTEXT' && r.horizonMinutes === 15)!;
  assert.equal(first.excludedNoNextBar, 1); // index 3 -> overnight
  assert.equal(first.excludedIncompleteHorizon, 1); // index 6 -> split at 8
  assert.equal(first.eligible.count, 0);
});

test('empareja horas locales aunque cambie el horario de verano y firma bajista correctamente', () => {
  const candles = [
    ...day('2026-03-06T14:30:00Z', 98), // 09:30 EST
    ...day('2026-03-09T13:30:00Z', 99), // 09:30 EDT
    ...day('2026-03-10T13:30:00Z', 100),
    ...day('2026-03-11T13:30:00Z', 100),
  ];
  const study = evaluateStrategy(candles, [signal(candles, 0, 'PUT_CONTEXT')], 8);
  const row = study.rows.find(r => r.segment === 'exploracion' && r.direction === 'PUT_CONTEXT' && r.horizonMinutes === 15)!;
  near(row.eligible.meanSignedPercent, 2);
  near(row.matchedBaseline.meanSignedPercent, 1);
  assert.equal(row.matchedSignals.count, 1);
});

test('la separación 70/30 comienza en una nueva sesión de Nueva York', () => {
  const candles = [
    ...day('2026-06-01T13:30:00Z', 100), ...day('2026-06-02T13:30:00Z', 100),
    ...day('2026-06-03T13:30:00Z', 100), ...day('2026-06-04T13:30:00Z', 100),
  ];
  const study = validateBollingerStrategy(candles);
  assert.equal(study.splitIndex, 12);
  assert.equal(study.splitTimestamp, '2026-06-04T13:30:00.000Z');
});

test('el comando de validación rechaza los datos ficticios de la demostración', () => {
  const project = fileURLToPath(new URL('../', import.meta.url));
  const result = spawnSync(process.execPath,
    ['--experimental-strip-types', 'src/validate-strategy.ts', 'data/QQQ_FICTICIO_5min.csv'],
    {cwd: project, encoding: 'utf8'});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requiere QQQ real de Alpaca SIP/);
});
