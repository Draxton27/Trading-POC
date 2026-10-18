import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import type {Candle} from '../src/domain.ts';
import type {MarketCalendar} from '../src/alpaca-calendar.ts';
import type {VerifiedEvent} from '../src/phase14-events.ts';
import {buildPhase14Synchronized} from '../src/phase14-sync.ts';

function bar(timestamp: string, open: number, close: number): Candle {
  return {timestamp, open, close, high: Math.max(open, close) + 1,
    low: Math.min(open, close) - 1, volume: 1000};
}
function event(id: string, category: VerifiedEvent['category'], dateNy: string,
  timestampUtc: string | null): VerifiedEvent {
  return {id, category, subtype: 'test', dateNy,
    timeNy: timestampUtc ? '09:45' : null, timeZone: 'America/New_York',
    timestampUtc, sourceUrl: 'https://example.org/source',
    timeSourceUrl: timestampUtc ? 'https://example.org/source' : null,
    verification: timestampUtc ? 'verified_time' : 'date_without_time',
    availableAtUtc: timestampUtc, notes: '', consensus: null,
    releasedValue: null, surprise: null};
}

test('tres símbolos se alinean sin desplazar huecos, en EST/EDT y cierre abreviado', () => {
  const calendar: MarketCalendar = new Map([
    ['2026-03-06', {open: 570, close: 600}],
    ['2026-03-09', {open: 570, close: 615}],
  ]);
  const times = ['2026-03-06T14:30:00.000Z', '2026-03-06T14:45:00.000Z',
    '2026-03-09T13:30:00.000Z', '2026-03-09T13:45:00.000Z',
    '2026-03-09T14:00:00.000Z'];
  const nvda = times.map((time, index) => bar(time, 100 + index, 101 + index));
  const qqq = times.map((time, index) => bar(time, 50 + index, 51 + index));
  const smh = times.filter((_, index) => index !== 3).map((time, index) => bar(time, 200 + index, 201 + index));
  const economic = [event('CPI:1', 'CPI', '2026-03-09', '2026-03-09T12:30:00.000Z'),
    event('FOMC:1', 'FOMC', '2026-03-09', '2026-03-09T13:45:00.000Z'),
    event('FOMC:unknown', 'FOMC', '2026-03-09', null)];
  const corporate = [event('NVIDIA:1', 'NVIDIA_EARNINGS', '2026-03-06',
    '2026-03-06T20:00:00.000Z')];
  const study = buildPhase14Synchronized({NVDA: nvda, QQQ: qqq, SMH: smh},
    calendar, economic, corporate);
  assert.equal(study.rows.length, 5);
  assert.equal(study.audit.completeThree, 4);
  assert.equal(study.audit.missing.SMH, 1);
  assert.equal(study.audit.partialSessions.SMH, 1);
  assert.equal(study.rows[0]!.slotNy, '09:30');
  assert.equal(study.rows[2]!.slotNy, '09:30');
  assert.equal(study.rows[2]!.timestampUtc, '2026-03-09T13:30:00.000Z');
  assert.equal(study.rows[2]!.symbols.NVDA.previousCloseUtc, times[1]);
  assert.ok(Math.abs(study.rows[2]!.symbols.NVDA.sessionReturnPercent! -
    100 * (103 / 102 - 1)) < 1e-10);
  assert.equal(study.rows[2]!.knownEventIds.join(';'), 'CPI:1;NVIDIA:1');
  assert.equal(study.rows[2]!.postEarningsFromPriorClose, true);
  assert.equal(study.rows[2]!.dateOnlyEventIds.join(';'), 'FOMC:unknown');
  assert.equal(study.rows[2]!.knownEventIds.includes('FOMC:1'), false);
  assert.equal(study.rows[3]!.knownEventIds.includes('FOMC:1'), true);
  assert.equal(study.rows[3]!.symbols.SMH.bar, null);
  assert.equal(study.rows[3]!.directionAgreement, 'insufficient');
  assert.equal(study.rows[4]!.symbols.SMH.sessionReturnPercent, null);
  assert.equal(study.rows[4]!.symbols.SMH.fourBarReturnPercent, null);
  const changed = qqq.map(item => ({...item}));
  changed[4]!.close = 400;
  const rerun = buildPhase14Synchronized({NVDA: nvda, QQQ: changed, SMH: smh},
    calendar, economic, corporate);
  assert.deepEqual(rerun.rows[2], study.rows[2]);
});
