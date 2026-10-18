import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {bootstrap, classify, estimate, describe, type Observation} from '../src/phase15-analysis.ts';

const row = (id: string, group: Observation['group'], outcome: number,
  family = 'pullback_bullish', year = '2024', session = id): Observation =>
  ({id, group, outcome, family, year, session, hourBlock: 1,
    regime: 'low', control: .1, mfe: .4, mae: -.2});

test('concordancia estricta por dirección; cero, mixto y faltantes', () => {
  assert.equal(classify('bullish', .1, .2), 'concordance');
  assert.equal(classify('bearish', -.1, -.2), 'concordance');
  assert.equal(classify('bullish', -.1, -.2), 'contradiction');
  assert.equal(classify('bearish', .1, .2), 'contradiction');
  assert.equal(classify('bullish', 0, .2), 'mixed');
  assert.equal(classify('bullish', .1, -.2), 'mixed');
  assert.equal(classify('bullish', null, .2), 'missing');
});

test('el ajuste usa solo estratos con ambos brazos y no extrapola', () => {
  const observations = [row('a', 'concordance', 2),
    row('b', 'contradiction', 1), row('c', 'concordance', 100, 'breakout_bullish')];
  const result = estimate(observations);
  assert.equal(result.rawDifference, 50);
  assert.equal(result.adjustedDifference, 1);
  assert.equal(result.sharedStrata, 1);
  assert.deepEqual(result.matched, {concordance: 1, contradiction: 1});
});

test('remuestreo por sesiones conserva todas las señales de cada sesión y es reproducible', () => {
  const observations = [row('a', 'concordance', 2, 'pullback_bullish', '2024', 'one'),
    row('b', 'contradiction', 1, 'pullback_bullish', '2024', 'one'),
    row('c', 'concordance', 3, 'pullback_bullish', '2024', 'two'),
    row('d', 'contradiction', 2, 'pullback_bullish', '2024', 'two')];
  const x = bootstrap(observations, 20, 15015);
  assert.deepEqual(x, bootstrap(observations, 20, 15015));
  assert.deepEqual(x.adjusted95, [1, 1]);
  assert.equal(x.validAdjusted, 20);
});

test('desenlaces incompletos no entran en medias ni sensibilidad a costos', () => {
  const observations = [row('a', 'concordance', .2), {...row('b', 'concordance', 1), outcome: null}];
  const result = describe(observations);
  assert.equal(result.signals, 2);
  assert.equal(result.eligible, 1);
  assert.equal(result.costSensitivity[2]!.meanNetPercent, .1);
});
