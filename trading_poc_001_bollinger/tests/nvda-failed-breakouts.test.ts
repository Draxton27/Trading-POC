import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import type {Candle} from '../src/domain.ts';
import type {MarketCalendar} from '../src/alpaca-calendar.ts';
import {newYorkBarParts} from '../src/strategy-validation.ts';
import {evaluateFailedBreakoutOutcome, observeBreakout,
  studyNvdaFailedBreakouts} from '../src/nvda-failed-breakouts.ts';
import {studyNvdaPullbackBreakout} from '../src/nvda-pullback-breakout.ts';

const BAR_MS = 900_000;
function bar(time: string, close: number, open = 100, high = Math.max(open, close) + .1,
  low = Math.min(open, close) - .1): Candle {
  return {timestamp: time, open, high, low, close, volume: 1000};
}
function time(date: string, slot: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const offset = date < '2026-03-08' ? 14 : 13;
  return new Date(Date.UTC(year!, month! - 1, day!, offset, 30 + slot * 15)).toISOString();
}
function calendarOf(date: string, close = 960): MarketCalendar {
  return new Map([[date, {open: 570, close}]]);
}

test('ruptura alta: igualdad no falla; primera vuelta bajo el máximo confirma al cierre', () => {
  const date = '2026-04-01';
  const candles = [bar(time(date, 0), 100), bar(time(date, 1), 106),
    bar(time(date, 2), 105), bar(time(date, 3), 104)];
  const episode = observeBreakout(candles, 1, 'high', 105, 95, calendarOf(date),
    '2026-03-31', 'first70');
  assert.equal(episode.status, 'confirmed_failed');
  assert.equal(episode.failureLag, 2);
  assert.equal(episode.confirmationIndex, 3);
  assert.equal(episode.confirmationAvailableAtUtc, new Date(Date.parse(candles[3]!.timestamp) + BAR_MS).toISOString());
  assert.equal(episode.firstObservationClose, 105);
});

test('ruptura baja: primera vuelta sobre el mínimo confirma; ausencia de vuelta se distingue', () => {
  const date = '2026-04-01';
  const candles = [bar(time(date, 0), 100), bar(time(date, 1), 94),
    bar(time(date, 2), 96), bar(time(date, 3), 94)];
  const failed = observeBreakout(candles, 1, 'low', 105, 95, calendarOf(date),
    '2026-03-31', 'first70');
  assert.equal(failed.status, 'confirmed_failed');
  assert.equal(failed.failureLag, 1);
  assert.equal(failed.secondObservationIndex, null);
  candles[2] = bar(time(date, 2), 95);
  const notReturned = observeBreakout(candles, 1, 'low', 105, 95, calendarOf(date),
    '2026-03-31', 'first70');
  assert.equal(notReturned.status, 'no_return');
});

test('interrupción y cierre anticipado dejan la observación incompleta', () => {
  const date = '2026-04-01';
  const candles = [bar(time(date, 0), 100), bar(time(date, 1), 106),
    bar(time(date, 3), 104)];
  assert.equal(observeBreakout(candles, 1, 'high', 105, 95, calendarOf(date),
    '2026-03-31', 'first70').observationReason, 'missing_observation');
  const early = [bar(time(date, 11), 100), bar(time(date, 12), 106), bar(time(date, 13), 107)];
  const episode = observeBreakout(early, 1, 'high', 105, 95, calendarOf(date, 780),
    '2026-03-31', 'first70');
  assert.equal(episode.status, 'observation_incomplete');
  assert.equal(episode.observationReason, 'session_close');
});

test('entrada siguiente vela, salida a 30 minutos y MFE/MAE usan extremos sin orden intravela', () => {
  const date = '2026-04-01';
  const candles = [bar(time(date, 0), 100), bar(time(date, 1), 101, 100, 103, 96),
    bar(time(date, 2), 99, 100, 104, 95)];
  const high = evaluateFailedBreakoutOutcome(candles, 0, 2, 'high', calendarOf(date));
  assert.equal(high.entryUtc, candles[1]!.timestamp);
  assert.equal(high.exitUtc, new Date(Date.parse(candles[2]!.timestamp) + BAR_MS).toISOString());
  assert.ok(Math.abs(high.value! - 1) < 1e-10);
  assert.equal(high.mfePercent, 5);
  assert.equal(high.maePercent, -4);
  const low = evaluateFailedBreakoutOutcome(candles, 0, 2, 'low', calendarOf(date));
  assert.ok(Math.abs(low.value! + 1) < 1e-10);
  assert.equal(low.mfePercent, 4);
  assert.equal(low.maePercent, -5);
  assert.equal(evaluateFailedBreakoutOutcome(candles, 1, 2, 'high', calendarOf(date)).reason,
    'missing_intermediate');
});

function fixture(sessions = 18): {candles: Candle[]; calendar: MarketCalendar; dates: string[]} {
  const candles: Candle[] = [], calendar: MarketCalendar = new Map(), dates: string[] = [];
  for (let day = Date.UTC(2026, 1, 20); dates.length < sessions; day += 86_400_000) {
    const instant = new Date(day);
    if (instant.getUTCDay() === 0 || instant.getUTCDay() === 6) continue;
    dates.push(instant.toISOString().slice(0, 10));
  }
  let previousHigh = 101;
  for (const [dayIndex, date] of dates.entries()) {
    calendar.set(date, {open: 570, close: 960});
    const dayBars = Array.from({length: 26}, (_, slot) => bar(time(date, slot), 100, 100, 101, 99));
    if (dayIndex > 0) {
      const breakClose = previousHigh + 1;
      dayBars[4] = bar(time(date, 4), breakClose, 100, breakClose + .1, 99);
      dayBars[5] = bar(time(date, 5), dayIndex === 1 ? previousHigh - .1 : previousHigh + .3,
        100, Math.max(100, previousHigh + .4), 99);
      if (dayIndex > 1) dayBars[6] = bar(time(date, 6), previousHigh - .1,
        100, Math.max(100, previousHigh), 99);
      previousHigh = breakClose + .1;
    }
    candles.push(...dayBars);
  }
  return {candles, calendar, dates};
}

test('controles de la primera observación no usan el resultado de la segunda', () => {
  const data = fixture();
  const study = studyNvdaFailedBreakouts(data.candles, data.calendar);
  const first = study.signals.find(item => item.dateNy === data.dates[1] && item.side === 'high');
  assert.ok(first);
  assert.equal(first.failureLag, 1);
  assert.equal(first.controls['30'].reason, null);
  assert.ok(first.controls['30'].sessions >= 10);
  assert.ok(study.episodes.some(item => item.failureLag === 2));
  const row = study.rows.find(item => item.scope === 'total' && item.side === 'high' &&
    item.horizonMinutes === 30)!;
  assert.ok(Math.abs(row.matchedSignalMeanPercent! - row.referenceMeanPercent! -
    row.differenceMeanPercent!) < 1e-10);
  assert.equal(newYorkBarParts(data.candles[0]!.timestamp).slot, '09:30');
  const afterDst = data.candles.find(item => item.timestamp.startsWith('2026-03-09'))!;
  assert.equal(newYorkBarParts(afterDst.timestamp).slot, '09:30');
  assert.equal(afterDst.timestamp.slice(11, 16), '13:30');
});

test('el estudio completo detecta la falla del mínimo sin exigir contexto SMA', () => {
  const data = fixture(2);
  const day = data.dates[1]!;
  data.candles[26 + 4] = bar(time(day, 4), 98, 100, 100.1, 97.9);
  data.candles[26 + 5] = bar(time(day, 5), 99.1, 100, 100.1, 99);
  const study = studyNvdaFailedBreakouts(data.candles, data.calendar);
  const signal = study.signals.find(item => item.dateNy === day && item.side === 'low');
  assert.ok(signal);
  assert.equal(signal.failureLag, 1);
  assert.equal(signal.sma.trend, 'insufficient');
  assert.equal(signal.horizons['30'].entryUtc, data.candles[26 + 6]!.timestamp);
  assert.equal(study.episodes.filter(item => item.dateNy === day && item.side === 'low').length, 1);
});

test('el episodio inicial se cuenta una vez y una nueva entrada al rango permite otro', () => {
  const data = fixture(3);
  const day = data.dates[1]!;
  const start = 26;
  const high = data.candles[start + 4]!.close - 1;
  data.candles[start + 6] = bar(time(day, 6), high + 1, 100, high + 1.1, 99);
  data.candles[start + 7] = bar(time(day, 7), high - .1, 100, high, 99);
  const study = studyNvdaFailedBreakouts(data.candles, data.calendar);
  const episodes = study.episodes.filter(item => item.dateNy === day && item.side === 'high');
  assert.equal(episodes.length, 2);
  assert.ok(study.signals.some(item => item.dateNy === day && item.repeatedWithinFourBars));
  assert.ok(study.signals.some(item => item.dateNy === day && !item.dedupRetained));
});

test('una sesión previa faltante o parcial no permite niveles viejos', () => {
  const data = fixture(4);
  const removed = data.dates[1]!;
  const missing = data.candles.filter(item => newYorkBarParts(item.timestamp).day !== removed);
  const missingStudy = studyNvdaFailedBreakouts(missing, data.calendar);
  assert.equal(missingStudy.episodes.some(item => item.dateNy === data.dates[2]), false);
  const partial = data.candles.filter(item => item.timestamp !== time(removed, 0));
  const partialStudy = studyNvdaFailedBreakouts(partial, data.calendar);
  assert.equal(partialStudy.episodes.some(item => item.dateNy === data.dates[2]), false);
  assert.ok(partialStudy.calendarAudit.partialSessions.length > 0);
});

test('no usa la vela futura para confirmar ni altera el estudio de Fase 11', () => {
  const data = fixture();
  const before = studyNvdaPullbackBreakout(data.candles, data.calendar);
  const original = studyNvdaFailedBreakouts(data.candles, data.calendar);
  const first = original.signals.find(item => item.dateNy === data.dates[1])!;
  const changed = data.candles.map(item => ({...item}));
  const next = first.confirmationIndex + 5;
  changed[next] = {...changed[next]!, high: 200, close: 199};
  const rerun = studyNvdaFailedBreakouts(changed, data.calendar);
  const same = rerun.signals.find(item => item.episodeId === first.episodeId)!;
  assert.equal(same.availableAtUtc, first.availableAtUtc);
  assert.equal(same.confirmationClose, first.confirmationClose);
  assert.equal(same.horizons['30'].value, first.horizons['30'].value);
  const after = studyNvdaPullbackBreakout(data.candles, data.calendar);
  assert.deepEqual(after.rows, before.rows);
  assert.deepEqual(after.events, before.events);
});

test('rechaza la última vela no cerrada y el cierre anticipado excluye horizontes', () => {
  const data = fixture(2);
  const lastStart = Date.parse(data.candles.at(-1)!.timestamp);
  assert.throws(() => studyNvdaFailedBreakouts(data.candles, data.calendar, lastStart + 14 * 60_000),
    /aún no terminó/);
  const day = data.dates[1]!;
  data.calendar.set(day, {open: 570, close: 780});
  data.candles = data.candles.filter(item => newYorkBarParts(item.timestamp).day !== day ||
    newYorkBarParts(item.timestamp).slot < '13:00');
  const start = 26;
  data.candles[start + 12] = bar(time(day, 12), 102, 100, 102.1, 99);
  data.candles[start + 13] = bar(time(day, 13), 100, 100, 101, 99);
  const study = studyNvdaFailedBreakouts(data.candles, data.calendar);
  const signal = study.signals.find(item => item.dateNy === day && item.confirmationIndex === start + 13);
  assert.ok(signal);
  assert.equal(signal.horizons['30'].reason, 'session_close');
});
