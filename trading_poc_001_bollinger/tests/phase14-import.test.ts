import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtempSync, readFileSync, rmSync, unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Candle} from '../src/domain.ts';
import {saveMarketCalendar, type MarketCalendar} from '../src/alpaca-calendar.ts';
import {fetchAlpacaBars, type ImportOptions} from '../src/alpaca.ts';
import {newYorkBarParts} from '../src/strategy-validation.ts';
import {importPhase14Symbol, metadataFor, phase14Range,
  symbolPath} from '../src/phase14-import.ts';

function firstBar(year: number, month: number): Candle {
  for (let day = year === 2021 && month === 10 ? 18 : 2; day <= 26; day++) {
    for (const hour of [13, 14]) {
      const timestamp = new Date(Date.UTC(year, month - 1, day, hour, 30)).toISOString();
      if (newYorkBarParts(timestamp).slot === '09:30' &&
          newYorkBarParts(timestamp).day === timestamp.slice(0, 10) &&
          ![0, 6].includes(new Date(timestamp).getUTCDay())) {
        return {timestamp, open: 100, high: 101, low: 99, close: 100, volume: 1000};
      }
    }
  }
  throw new Error('No se encontró día hábil.');
}

test('importador fase 14 conserva huecos, valida fragmentos y reanuda sin sobrescribir final', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'phase14-import-'));
  try {
    const calendar: MarketCalendar = new Map(), bars = new Map<string, Candle>();
    for (let year = 2021; year <= 2026; year++) {
      for (let month = 1; month <= 12; month++) {
        if (year === 2021 && month < 10 || year === 2026 && month > 10) continue;
        const candle = firstBar(year, month);
        calendar.set(candle.timestamp.slice(0, 10), {open: 570, close: 960});
        bars.set(candle.timestamp.slice(0, 7), candle);
      }
    }
    const calendarPath = join(directory, 'calendar.json');
    saveMarketCalendar(calendarPath, calendar);
    let requested = 0;
    const mock = async (options: ImportOptions) => {
      requested++;
      assert.equal(options.metadata?.bar_minutes, 15);
      assert.equal(options.metadata?.asset, 'SMH');
      const candle = bars.get(options.start.slice(0, 7));
      assert.ok(candle);
      return [candle];
    };
    const options = {symbol: 'SMH' as const, outputDirectory: directory,
      nvdaCalendarPath: calendarPath, apiKey: 'test', secretKey: 'test',
      fetchBars: mock, pause: async () => {}};
    const result = await importPhase14Symbol(options);
    assert.equal(result.candles.length, 61);
    assert.equal(requested, 61);
    assert.equal(result.coverage.partialSessions.length, 61);
    const existing = await importPhase14Symbol(options);
    assert.equal(existing.alreadyComplete, true);
    assert.equal(requested, 61);
    const base = symbolPath(directory, 'SMH');
    for (const suffix of ['', '.meta.json', '.calendar.json', '.provenance.json']) unlinkSync(base + suffix);
    const resumed = await importPhase14Symbol(options);
    assert.equal(resumed.resumedChunks, 61);
    assert.equal(requested, 61);
    assert.equal(readFileSync(base, 'utf8').split('\n').length - 2, 61);
    assert.equal(phase14Range.start, '2021-10-17T00:00:00.000Z');
  } finally {rmSync(directory, {recursive: true, force: true});}
});

test('páginas duplicadas idénticas se cuentan; un duplicado contradictorio aborta', async () => {
  const timestamp = '2026-04-01T13:30:00Z';
  const raw = {t: timestamp, o: 100, h: 101, l: 99, c: 100, v: 1000};
  let calls = 0;
  const get = async () => {
    calls++;
    return new Response(JSON.stringify({bars: {QQQ: [raw]},
      next_page_token: calls === 1 ? 'page-2' : null}), {status: 200});
  };
  const audit = {exact: 0};
  const opts: ImportOptions = {apiKey: 'test', secretKey: 'test',
    start: '2026-04-01T13:30:00.000Z', end: '2026-04-01T13:45:00.000Z',
    now: Date.parse('2026-04-03T00:00:00Z'), metadata: metadataFor('QQQ'),
    httpGet: get, pause: async () => {}, allowExactDuplicates: true,
    allowIntradayGaps: true, duplicateAudit: audit};
  assert.equal((await fetchAlpacaBars(opts)).length, 1);
  assert.equal(audit.exact, 1);
  calls = 0;
  const conflict = async () => {
    calls++;
    return new Response(JSON.stringify({bars: {QQQ: [{...raw, c: calls === 1 ? 100 : 100.5}]},
      next_page_token: calls === 1 ? 'page-2' : null}), {status: 200});
  };
  await assert.rejects(fetchAlpacaBars({...opts, httpGet: conflict}), /duplicada/);
});
