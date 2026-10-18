import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import type {Candle} from '../src/domain.ts';
import type {MarketCalendar} from '../src/alpaca-calendar.ts';
import {buildHourlyCandles, calculateSmaPoints, type SmaPoint} from '../src/multitimeframe.ts';
import {newYorkBarParts} from '../src/strategy-validation.ts';
import {classifyTrend, isBreakout, isPullback, studyNvdaPullbackBreakout} from '../src/nvda-pullback-breakout.ts';
import {studyNvdaIndicators} from '../src/nvda-indicators-study.ts';

const candle = (open: number, high: number, low: number, close: number): Candle =>
  ({timestamp: '2026-04-01T14:30:00.000Z', open, high, low, close, volume: 1000});
const point = (close: number, sma20: number | null, sma100: number | null,
  complete = true): SmaPoint => ({
  candle: {close, complete},
  values: {20: sma20, 40: null, 100: sma100, 200: null},
} as SmaPoint);

test('A exige tocar, recuperar y confirmar en una vela, en ambos sentidos', () => {
  const priorBull = candle(101, 103, 100, 102), bull = candle(99, 103, 98, 102);
  assert.equal(isPullback(priorBull, bull, 'bullish', 100), true);
  assert.equal(isPullback(priorBull, {...bull, close: 99}, 'bullish', 100), false);
  assert.equal(isPullback(priorBull, {...bull, open: 102}, 'bullish', 100), false);
  assert.equal(isPullback({...priorBull, close: 100}, bull, 'bullish', 100), false);
  const priorBear = candle(99, 100, 97, 98), bear = candle(101, 102, 97, 98);
  assert.equal(isPullback(priorBear, bear, 'bearish', 100), true);
  assert.equal(isPullback(priorBear, {...bear, high: 99}, 'bearish', 100), false);
  assert.equal(isPullback(priorBear, {...bear, close: 101}, 'bearish', 100), false);
});

test('B exige cierre previo dentro de sus bandas y cierre actual estrictamente fuera', () => {
  const previous = {lower: 98, upper: 102};
  assert.equal(isBreakout(102, previous, 104, {lower: 97, upper: 103}, 'bullish'), true);
  assert.equal(isBreakout(98, previous, 96, {lower: 97, upper: 103}, 'bearish'), true);
  assert.equal(isBreakout(103, previous, 104, {lower: 97, upper: 103}, 'bullish'), false);
  assert.equal(isBreakout(100, previous, 103, {lower: 97, upper: 103}, 'bullish'), false);
  assert.equal(isBreakout(100, previous, 97, {lower: 97, upper: 103}, 'bearish'), false);
  assert.equal(isBreakout(100, previous, 104, {lower: null, upper: 103}, 'bullish'), false);
});

test('el contexto distingue agregación incompleta, contradicción, igualdad y dos tendencias', () => {
  assert.equal(classifyTrend(point(110, 100, 100), point(110, 100, 100)), 'bullish');
  assert.equal(classifyTrend(point(90, 100, 100), point(90, 100, 100)), 'bearish');
  assert.equal(classifyTrend(point(110, 100, 100), point(90, 100, 100)), 'contradictory');
  assert.equal(classifyTrend(point(100, 100, 100), point(110, 100, 100)), 'neutral');
  assert.equal(classifyTrend(point(110, 100, 100), point(110, 100, 100, false)), 'insufficient');
  assert.equal(classifyTrend(null, point(110, 100, 100)), 'insufficient');
});

function fixture(lastEarlyClose = false): {bars: Candle[]; calendar: MarketCalendar; target: number} {
  const bars: Candle[] = [], calendar: MarketCalendar = new Map();
  const dates: string[] = [];
  for (let time = Date.UTC(2026, 1, 20); dates.length < 35; time += 86_400_000) {
    const date = new Date(time);
    if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;
    dates.push(date.toISOString().slice(0, 10));
  }
  for (const [dayIndex, date] of dates.entries()) {
    const [year, month, day] = date.split('-').map(Number);
    const utcHour = date < '2026-03-08' ? 14 : 13;
    const limit = lastEarlyClose && dayIndex === dates.length - 1 ? 14 : 26;
    calendar.set(date, {open: 570, close: limit === 14 ? 780 : 960});
    for (let slot = 0; slot < limit; slot++) {
      const close = 100 + dayIndex * .5 + slot * .01;
      bars.push({timestamp: new Date(Date.UTC(year!, month! - 1, day!, utcHour, 30 + slot * 15)).toISOString(),
        open: close - .2, high: close + .1, low: close - .3, close, volume: 1000 + slot});
    }
  }
  return {bars, calendar, target: bars.length - (lastEarlyClose ? 14 : 26) + (lastEarlyClose ? 12 : 8)};
}
function addPullback(data: ReturnType<typeof fixture>, index = data.target): number {
  const hourly = calculateSmaPoints(buildHourlyCandles(data.bars, data.calendar));
  const start = Date.parse(data.bars[index]!.timestamp);
  const reference = hourly.filter(p => p.candle.complete && Date.parse(p.candle.availableAt) <= start).at(-1);
  assert.ok(reference?.values[20] !== null && reference?.values[20] !== undefined);
  const sma = reference.values[20]!;
  assert.ok(data.bars[index - 1]!.close > sma);
  data.bars[index]!.low = sma - .1;
  return sma;
}

test('usa solo horas/días cerrados y ninguna vela futura cambia una señal pasada', () => {
  const data = fixture();
  const sma = addPullback(data);
  assert.equal(newYorkBarParts(data.bars[0]!.timestamp).slot, '09:30');
  const afterDst = data.bars.find(bar => bar.timestamp.startsWith('2026-03-09'));
  assert.ok(afterDst);
  assert.equal(newYorkBarParts(afterDst.timestamp).slot, '09:30');
  assert.equal(data.bars[0]!.timestamp.slice(11,16), '14:30');
  assert.equal(afterDst.timestamp.slice(11,16), '13:30');
  const original = studyNvdaPullbackBreakout(data.bars, data.calendar);
  const event = original.events.find(e => e.index === data.target && e.strategy === 'pullback');
  assert.ok(event);
  assert.ok(event.controls['30'].controls >= 10);
  assert.notEqual(event.controls['30'].meanPercent, null);
  assert.equal(event.hourSma20, sma);
  assert.equal(event.availableAtUtc, new Date(Date.parse(data.bars[data.target]!.timestamp) + 900_000).toISOString());
  assert.equal(event.horizons['30'].entryUtc, data.bars[data.target + 1]!.timestamp);
  assert.equal(event.horizons['30'].exitUtc,
    new Date(Date.parse(data.bars[data.target + 2]!.timestamp) + 900_000).toISOString());
  const expected = (data.bars[data.target + 2]!.close / data.bars[data.target + 1]!.open - 1) * 100;
  assert.equal(event.horizons['30'].value, expected);
  const altered = data.bars.map(bar => ({...bar}));
  altered[data.target + 5] = {...altered[data.target + 5]!, open: 200, high: 201, low: 199, close: 200};
  const again = studyNvdaPullbackBreakout(altered, data.calendar).events.find(e =>
    e.index === data.target && e.strategy === 'pullback');
  assert.ok(again);
  assert.equal(again.hourSma20, event.hourSma20);
  assert.equal(again.daySma20, event.daySma20);
  assert.equal(again.horizons['30'].value, event.horizons['30'].value);
});

test('una hora incompleta no hereda contexto viejo ni genera el retroceso', () => {
  const data = fixture();
  addPullback(data);
  const missing = data.bars.splice(data.target - 2, 1)[0]!;
  assert.ok(missing);
  const result = studyNvdaPullbackBreakout(data.bars, data.calendar);
  assert.ok(result.aggregation.hourlyIncomplete > 0);
  assert.equal(result.events.some(e => e.barStartUtc === data.bars[data.target - 1]!.timestamp &&
    e.strategy === 'pullback'), false);
});

test('rechaza una última vela de 15 minutos todavía abierta', () => {
  const data = fixture();
  const lastStart = Date.parse(data.bars.at(-1)!.timestamp);
  assert.throws(() => studyNvdaPullbackBreakout(data.bars, data.calendar, lastStart + 14 * 60_000),
    /aún no terminó/);
  assert.doesNotThrow(() => studyNvdaPullbackBreakout(data.bars, data.calendar, lastStart + 15 * 60_000));
});

test('cierre anticipado excluye 30 minutos y las señales próximas se auditan', () => {
  const data = fixture(true);
  addPullback(data);
  addPullback(data, data.target + 1);
  const result = studyNvdaPullbackBreakout(data.bars, data.calendar);
  const pair = result.events.filter(e => e.strategy === 'pullback' &&
    e.dateNy === newYorkBarParts(data.bars[data.target]!.timestamp).day &&
    e.index >= data.target);
  assert.equal(pair.length, 2);
  assert.equal(pair[0]!.horizons['30'].reason, 'session_close');
  assert.equal(pair[1]!.horizons['30'].reason, 'session_close');
  assert.equal(pair[0]!.controls['30'].reason, 'horizon_incomplete');
  assert.equal(pair[1]!.repeatedWithinFourBars, true);
  assert.equal(pair[1]!.dedupRetained, false);
  assert.equal(pair[1]!.overlappingPrimaryOutcome, true);
  assert.equal(result.calendarAudit.partialSessions.length, 0);
});

test('quitar repeticiones cambia la sensibilidad descriptiva sin alterar el conteo principal', () => {
  const data = fixture();
  addPullback(data);
  addPullback(data, data.target + 1);
  const result = studyNvdaPullbackBreakout(data.bars, data.calendar);
  const sensitivity = result.repeatSensitivity.find(item =>
    item.strategy === 'pullback' && item.direction === 'bullish')!;
  assert.ok(sensitivity.raw.count >= 2);
  assert.ok(sensitivity.deduplicated.count < sensitivity.raw.count);
  const row = result.rows.find(item => item.scope === 'total' &&
    item.strategy === 'pullback' && item.direction === 'bullish' && item.horizonMinutes === 30)!;
  assert.equal(row.eligible.count, sensitivity.raw.count);
  assert.equal(row.costSensitivity.find(item => item.bps === 10)!.netMeanPercent!,
    row.eligible.meanSignedPercent! - .1);
});

test('la Fase 11 no altera el cálculo previo de señales Bollinger de la Fase 9', () => {
  const data = fixture();
  addPullback(data);
  const before = studyNvdaIndicators(data.bars, data.calendar).signals.map(r => r.signal.timestamp);
  studyNvdaPullbackBreakout(data.bars, data.calendar);
  const after = studyNvdaIndicators(data.bars, data.calendar).signals.map(r => r.signal.timestamp);
  assert.deepEqual(after, before);
});
