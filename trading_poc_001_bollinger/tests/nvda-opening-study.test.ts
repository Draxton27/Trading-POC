import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import type {Candle} from '../src/domain.ts';
import type {MarketCalendar} from '../src/alpaca-calendar.ts';
import {studyNvdaOpening} from '../src/nvda-opening-study.ts';
import {renderNvdaOpeningReport} from '../src/nvda-opening-report.ts';

function bar(timestamp: string, open: number, high = open, low = open, close = open): Candle {
  return {timestamp, open, high, low, close, volume: 100};
}

function twoSessions(options: {
  previousCloses?: (index: number) => number;
  opening: Candle;
  following?: Candle[];
  closeMinute?: number;
}): {candles: Candle[]; calendar: MarketCalendar} {
  const previous = Array.from({length: 26}, (_, index) => {
    const close = options.previousCloses?.(index) ?? 100;
    return bar(new Date(Date.UTC(2026, 2, 6, 14, 30 + index * 15)).toISOString(), close);
  });
  const candles = [...previous, options.opening, ...(options.following ?? [])];
  const calendar: MarketCalendar = new Map([
    ['2026-03-06', {open: 570, close: 960}],
    ['2026-03-09', {open: 570, close: options.closeMinute ?? 960}],
  ]);
  return {candles, calendar};
}

const monday = (minute: number, open: number, high = open, low = open, close = open) =>
  bar(new Date(Date.UTC(2026, 2, 9, 13, 30 + minute)).toISOString(), open, high, low, close);
const variableBandCloses = (index: number) => index < 6 ? 200 : index % 2 === 0 ? 99.5 : 100.5;

test('usa solo los 20 cierres previos y congela bandas; rango y cierre tienen tiempos distintos', () => {
  const input = twoSessions({
    previousCloses: variableBandCloses,
    opening: monday(0, 110, 112, 100, 105),
    following: [monday(15, 105, 106, 99.5, 100)], closeMinute: 780,
  });
  const study = studyNvdaOpening(input.candles, input.calendar);
  assert.equal(study.splitDate, '2026-03-09');
  assert.equal(study.sessions[0]!.status, 'sin_20_previas');
  assert.equal(study.events.length, 1);
  const event = study.events[0]!;
  assert.equal(event.direction, 'encima');
  assert.equal(event.upper, 101);
  assert.equal(event.lower, 99);
  assert.ok(Math.abs(event.distanceToBandPercent - (9 / 101 * 100)) < 1e-10);
  assert.equal(event.highVolatility, false);
  assert.deepEqual([event.outcomes['15'].rangeReturned, event.outcomes['15'].closeConfirmed,
    event.outcomes['15'].firstRangeByMinutes, event.outcomes['30'].firstCloseByMinutes],
  [true, false, 15, 30]);
  assert.equal(event.outcomes['60'].evaluable, false);
  assert.equal(event.outcomes.sesion.evaluable, false);
  assert.equal(study.rows.find(row => row.segment === 'total' && row.group === 'encima' &&
    row.horizon === 'sesion')!.neverReturned, null);
  assert.equal(study.sessions[1]!.completeSession, false);
  const changed = structuredClone(input.candles);
  changed[27] = monday(15, 105, 500, 99.5, 400);
  const after = studyNvdaOpening(changed, input.calendar).events[0]!;
  assert.deepEqual([after.direction, after.upper, after.lower, after.distanceToBandPercent],
    [event.direction, event.upper, event.lower, event.distanceToBandPercent]);
});

test('apertura debajo regresa por máximo y solo confirma cuando el cierre entra entre ambas bandas', () => {
  const input = twoSessions({previousCloses: variableBandCloses,
    opening: monday(0, 90, 100, 89, 95),
    following: [monday(15, 95, 101, 94, 100)]});
  const event = studyNvdaOpening(input.candles, input.calendar).events[0]!;
  assert.equal(event.direction, 'debajo');
  assert.equal(event.outcomes['15'].rangeReturned, true);
  assert.equal(event.outcomes['15'].closeConfirmed, false);
  assert.equal(event.outcomes['30'].closeConfirmed, true);
  assert.equal(event.outcomes['30'].firstCloseByMinutes, 30);
});

test('atraviesa ambas bandas desde arriba y cierra debajo: rango sí, cierre no', () => {
  const input = twoSessions({previousCloses: variableBandCloses,
    opening: monday(0, 110, 112, 95, 96),
    following: [monday(15, 96, 100, 95, 100)]});
  const event = studyNvdaOpening(input.candles, input.calendar).events[0]!;
  assert.deepEqual([event.lower, event.upper, event.direction], [99, 101, 'encima']);
  assert.deepEqual([event.outcomes['15'].rangeReturned, event.outcomes['15'].closeConfirmed,
    event.outcomes['15'].firstRangeByMinutes, event.outcomes['15'].firstCloseByMinutes],
  [true, false, 15, null]);
  assert.deepEqual([event.outcomes['30'].rangeReturned, event.outcomes['30'].closeConfirmed,
    event.outcomes['30'].firstRangeByMinutes, event.outcomes['30'].firstCloseByMinutes],
  [true, true, 15, 30]);
});

test('atraviesa ambas bandas desde abajo y cierra encima: rango sí, cierre no', () => {
  const input = twoSessions({previousCloses: variableBandCloses,
    opening: monday(0, 90, 105, 89, 104),
    following: [monday(15, 104, 105, 99, 100)]});
  const event = studyNvdaOpening(input.candles, input.calendar).events[0]!;
  assert.deepEqual([event.lower, event.upper, event.direction], [99, 101, 'debajo']);
  assert.deepEqual([event.outcomes['15'].rangeReturned, event.outcomes['15'].closeConfirmed,
    event.outcomes['15'].firstRangeByMinutes, event.outcomes['15'].firstCloseByMinutes],
  [true, false, 15, null]);
  assert.deepEqual([event.outcomes['30'].rangeReturned, event.outcomes['30'].closeConfirmed,
    event.outcomes['30'].firstRangeByMinutes, event.outcomes['30'].firstCloseByMinutes],
  [true, true, 15, 30]);
});

test('un hueco al lado opuesto sin intersección no cuenta como regreso por rango', () => {
  const above = twoSessions({previousCloses: variableBandCloses,
    opening: monday(0, 110, 112, 105, 106),
    following: [monday(15, 96, 98, 95, 96)]});
  const below = twoSessions({previousCloses: variableBandCloses,
    opening: monday(0, 90, 95, 89, 94),
    following: [monday(15, 104, 105, 102, 104)]});
  for (const input of [above, below]) {
    const outcome = studyNvdaOpening(input.candles, input.calendar).events[0]!.outcomes['30'];
    assert.equal(outcome.rangeReturned, false);
    assert.equal(outcome.closeConfirmed, false);
  }
});

test('un cierre exactamente en cualquiera de las bandas no confirma regreso', () => {
  const input = twoSessions({previousCloses: variableBandCloses,
    opening: monday(0, 110, 112, 100, 101),
    following: [monday(15, 101, 101, 99, 99), monday(30, 99, 100, 99, 100),
      monday(45, 100)]});
  const event = studyNvdaOpening(input.candles, input.calendar).events[0]!;
  assert.equal(event.outcomes['15'].closeConfirmed, false);
  assert.equal(event.outcomes['30'].closeConfirmed, false);
  assert.equal(event.outcomes['60'].evaluable, true);
  assert.equal(event.outcomes['60'].closeConfirmed, true);
  assert.equal(event.outcomes['60'].firstCloseByMinutes, 45);
});

test('tocar la banda no es regreso ni apertura fuera; sesión completa puede no regresar', () => {
  const touched = twoSessions({opening: monday(0, 100)});
  assert.equal(studyNvdaOpening(touched.candles, touched.calendar).events.length, 0);
  const bars = Array.from({length: 26}, (_, index) => monday(index * 15, 110, 111, 100, 110));
  const input = twoSessions({opening: bars[0]!, following: bars.slice(1)});
  const study = studyNvdaOpening(input.candles, input.calendar);
  const event = study.events[0]!;
  assert.equal(event.sessionComplete, true);
  assert.equal(event.outcomes.sesion.evaluable, true);
  assert.equal(event.outcomes.sesion.rangeReturned, false); // mínimo == banda
  assert.equal(event.outcomes.sesion.closeConfirmed, false);
  assert.equal(study.rows.find(row => row.segment === 'total' && row.group === 'encima' &&
    row.horizon === 'sesion')!.neverReturned, 1);
  assert.match(renderNvdaOpeningReport(study, 'ficticio.csv'), /no regresaron/);
});

test('volatilidad elevada se decide con ancho anterior a la apertura y reconoce cierre temprano', () => {
  const bars = Array.from({length: 14}, (_, index) => monday(index * 15, 125, 126, 124, 125));
  const input = twoSessions({previousCloses: index => index < 6 ? 100 : index % 2 ? 90 : 110,
    opening: bars[0]!, following: bars.slice(1), closeMinute: 780});
  const study = studyNvdaOpening(input.candles, input.calendar);
  const event = study.events[0]!;
  assert.equal(event.upper, 120);
  assert.equal(event.lower, 80);
  assert.equal(event.highVolatility, true);
  assert.equal(event.sessionComplete, true);
  assert.equal(event.outcomes['120'].evaluable, true);
  assert.equal(event.outcomes.sesion.evaluable, true);
  assert.equal(study.rows.find(row => row.segment === 'total' &&
    row.group === 'alta_vol_encima' && row.horizon === 'sesion')!.openings, 1);
  assert.equal(study.rows.find(row => row.segment === 'total' &&
    row.group === 'alta_vol_encima' && row.horizon === 'sesion')!.rangeRate, 0);
});

test('festivo ausente, horario de verano y barra de apertura faltante no generan señales inventadas', () => {
  const input = twoSessions({opening: monday(15, 110), closeMinute: 780});
  const study = studyNvdaOpening(input.candles, input.calendar);
  assert.equal(study.events.length, 0);
  assert.equal(study.sessions[1]!.status, 'sin_apertura_0930');
  assert.equal(input.candles[0]!.timestamp, '2026-03-06T14:30:00.000Z');
  assert.equal(monday(0, 100).timestamp, '2026-03-09T13:30:00.000Z');
  assert.equal(study.calendarSessions, 2); // fin de semana omitido por calendario
});

test('comando NVDA rechaza datos ficticios de cinco minutos', () => {
  const project = fileURLToPath(new URL('../', import.meta.url));
  const result = spawnSync(process.execPath,
    ['--experimental-strip-types', 'src/validate-nvda-opening.ts', 'data/QQQ_FICTICIO_5min.csv'],
    {cwd: project, encoding: 'utf8'});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requiere NVDA real de Alpaca SIP/);
});
