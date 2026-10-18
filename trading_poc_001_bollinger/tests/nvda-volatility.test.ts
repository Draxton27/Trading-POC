import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import type {Candle} from '../src/domain.ts';
import type {MarketCalendar} from '../src/alpaca-calendar.ts';
import {buildDailyAtr, buildPrior20Ranges, classifyAtrPercent,
  evaluateVolatilityTrajectory, nearestRank, sessionBlock} from '../src/nvda-volatility.ts';
import {studyNvdaPullbackBreakout} from '../src/nvda-pullback-breakout.ts';
import {studyNvdaFailedBreakouts} from '../src/nvda-failed-breakouts.ts';
import {studyNvdaVolatility} from '../src/nvda-volatility-study.ts';

function dates(count: number): string[] {
  const out: string[] = [];
  for (let instant = Date.UTC(2026, 1, 20); out.length < count; instant += 86_400_000) {
    const day = new Date(instant);
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) out.push(day.toISOString().slice(0, 10));
  }
  return out;
}
function time(date: string, slot: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const offset = date < '2026-03-08' ? 14 : '2026-11-01' <= date ? 14 : 13;
  return new Date(Date.UTC(year!, month! - 1, day!, offset, 30 + 15 * slot)).toISOString();
}
function bar(date: string, slot: number, open: number, high: number, low: number,
  close: number): Candle {
  return {timestamp: time(date, slot), open, high, low, close, volume: 1000};
}
function fixture(sessions: number, early = false): {candles: Candle[]; calendar: MarketCalendar;
  days: string[]} {
  const days = dates(sessions), calendar: MarketCalendar = new Map(), candles: Candle[] = [];
  for (const [index, day] of days.entries()) {
    const slots = early && index === 1 ? 14 : 26;
    calendar.set(day, {open: 570, close: 570 + slots * 15});
    for (let slot = 0; slot < slots; slot++) {
      const price = 100 + index;
      candles.push(bar(day, slot, price, price + 1, price - 1, price));
    }
  }
  return {days, calendar, candles};
}

test('TR includes overnight gap; ATR requires fourteen valid TRs and never uses current day for regime', () => {
  const data = fixture(136);
  const rows = buildDailyAtr(data.candles, data.calendar);
  assert.equal(rows[0]!.trueRange, null);
  assert.equal(rows[1]!.trueRange, 2);
  assert.equal(rows[13]!.atr14, null);
  assert.equal(rows[14]!.atr14, 2);
  const gap = fixture(2);
  for (const candle of gap.candles.slice(26)) {
    candle.open += 10; candle.high += 10; candle.low += 10; candle.close += 10;
  }
  assert.equal(buildDailyAtr(gap.candles, gap.calendar)[1]!.trueRange, 12);
  assert.equal(rows[134]!.regime, 'insufficient');
  assert.equal(rows[135]!.referenceCount, 120);
  const changed = data.candles.map(item => ({...item}));
  const last = changed.at(-1)!;
  last.high = 1000;
  last.close = 1000;
  const after = buildDailyAtr(changed, data.calendar);
  assert.equal(after[135]!.regime, rows[135]!.regime);
  assert.equal(after[135]!.priorAtr14, rows[135]!.priorAtr14);
  assert.notEqual(after[135]!.atr14, rows[135]!.atr14);
});

test('nearest-rank thresholds have exact low/medium/high boundaries and only older 120 references', () => {
  const refs = Array.from({length: 120}, (_, index) => index + 1);
  assert.equal(nearestRank(refs, 33.33), 40);
  assert.equal(nearestRank(refs, 66.67), 81);
  assert.equal(classifyAtrPercent(40, refs).regime, 'low');
  assert.equal(classifyAtrPercent(81, refs).regime, 'medium');
  assert.equal(classifyAtrPercent(82, refs).regime, 'high');
  assert.equal(classifyAtrPercent(40, refs.slice(1)).regime, 'insufficient');
  assert.equal(classifyAtrPercent(40, [...refs, 999]).p33, 41);
});

test('missing preceding session blocks TR; complete early close remains valid', () => {
  const data = fixture(4, true);
  let rows = buildDailyAtr(data.candles, data.calendar);
  assert.equal(rows[1]!.scheduledAbbreviated, true);
  assert.equal(rows[1]!.complete, true);
  assert.equal(rows[2]!.trueRange, 2);
  data.candles.splice(26, 1);
  rows = buildDailyAtr(data.candles, data.calendar);
  assert.equal(rows[1]!.complete, false);
  assert.equal(rows[1]!.trueRange, null);
  assert.equal(rows[2]!.trueRange, null);
});

test('intraday 20-bar range excludes current bar, traverses complete nights, resets on gaps and DST', () => {
  const data = fixture(12);
  let ranges = buildPrior20Ranges(data.candles, data.calendar);
  assert.equal(ranges[20]!.meanDollar, 2);
  assert.equal(ranges[26]!.meanDollar, 2);
  assert.equal(data.candles.find(item => item.timestamp === time('2026-03-09', 0))?.timestamp.slice(11,16), '13:30');
  assert.equal(sessionBlock('15:30'), 6);
  const modified = data.candles.map(item => ({...item}));
  modified[26]!.high = 1000;
  ranges = buildPrior20Ranges(modified, data.calendar);
  assert.equal(ranges[26]!.meanDollar, 2);
  modified.splice(25, 1);
  ranges = buildPrior20Ranges(modified, data.calendar);
  assert.equal(ranges[25]!.meanDollar, null);
  assert.equal(ranges[25]!.count, 0);
});

test('trajectory uses next open, 30-minute exit, both excursions, normalizations and session exclusion', () => {
  const day = '2026-04-01';
  const calendar: MarketCalendar = new Map([[day, {open: 570, close: 615}]]);
  const candles = [bar(day, 0, 100, 101, 99, 100),
    bar(day, 1, 100, 103, 96, 101), bar(day, 2, 100, 104, 95, 99)];
  const scales = {atrDollar: 5, range20Dollar: 2};
  const bull = evaluateVolatilityTrajectory(candles, 0, 2, 'bullish', calendar, scales);
  const bear = evaluateVolatilityTrajectory(candles, 0, 2, 'bearish', calendar, scales);
  assert.equal(bull.entryUtc, candles[1]!.timestamp);
  assert.equal(bull.exitUtc, new Date(Date.parse(candles[2]!.timestamp) + 900_000).toISOString());
  assert.ok(Math.abs(bull.value! + 1) < 1e-10);
  assert.equal(bull.mfePercent, 4);
  assert.equal(bull.maePercent, -5);
  assert.equal(bull.mfeAtrUnits, .8);
  assert.equal(bull.maeRange20Units, -2.5);
  assert.equal(bear.mfePercent, 5);
  assert.equal(bear.maePercent, -4);
  assert.equal(evaluateVolatilityTrajectory(candles, 0, 4, 'bullish', calendar, scales).reason,
    'session_close');
  assert.equal(evaluateVolatilityTrajectory(candles, 2, 1, 'bullish', calendar, scales).reason,
    'session_close');
});

test('phase 13 reuses old events and outcomes exactly; altered originals fail closed', () => {
  const data = fixture(18);
  const phase11 = studyNvdaPullbackBreakout(data.candles, data.calendar);
  const phase12 = studyNvdaFailedBreakouts(data.candles, data.calendar);
  const result = studyNvdaVolatility(data.candles, data.calendar, phase11, phase12);
  assert.equal(result.events.length, phase11.events.length + phase12.signals.length);
  assert.equal(result.baselineWindows.length, data.candles.length);
  assert.equal(result.baselineWindows[0]!.bullish.value,
    -result.baselineWindows[0]!.bearish.value!);
  if (phase12.signals.length) {
    const tampered = structuredClone(phase12);
    tampered.signals[0]!.horizons['30'].value = 777;
    assert.throws(() => studyNvdaVolatility(data.candles, data.calendar, phase11, tampered),
      /Desenlace original modificado/);
  }
  assert.throws(() => studyNvdaVolatility(data.candles, data.calendar, phase11, phase12,
    Date.parse(data.candles.at(-1)!.timestamp) + 899_000), /aún no terminó/);
});
