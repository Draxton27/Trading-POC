import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {alpacaNvdaMetadata, fetchAlpacaBars, historicalWindow, type HttpGet} from '../src/alpaca.ts';
import {loadMarketCalendar, saveMarketCalendar, type MarketCalendar} from '../src/alpaca-calendar.ts';
import {parseCandlesCsv, serializeCandles} from '../src/csv.ts';
import {validateMetadata} from '../src/data-contract.ts';

const bar = (t: string) => ({t, o: 100, h: 101, l: 99, c: 100.5, v: 1000});

test('NVDA 15 minutos usa SIP split, paginación y calendario sin alterar QQQ', async () => {
  const seen: URL[] = [];
  const calendar: MarketCalendar = new Map([['2026-06-01', {open: 570, close: 780}]]);
  const httpGet: HttpGet = async url => {
    seen.push(new URL(url));
    const bars = seen.length === 1 ? [bar('2026-06-01T13:30:00Z')] :
      [bar('2026-06-01T13:45:00Z'), bar('2026-06-01T17:00:00Z')];
    return new Response(JSON.stringify({bars: {NVDA: bars}, next_page_token: seen.length === 1 ? 'p2' : null}));
  };
  const candles = await fetchAlpacaBars({apiKey: 'fake', secretKey: 'fake',
    start: '2026-06-01T13:30:00Z', end: '2026-06-01T17:00:00Z',
    now: Date.parse('2026-06-02T20:00:00Z'), metadata: alpacaNvdaMetadata, calendar,
    httpGet, pause: async () => {}});
  assert.equal(candles.length, 2);
  assert.equal(seen.length, 2);
  assert.equal(seen[1]!.searchParams.get('page_token'), 'p2');
  for (const url of seen) {
    assert.equal(url.searchParams.get('symbols'), 'NVDA');
    assert.equal(url.searchParams.get('timeframe'), '15Min');
    assert.equal(url.searchParams.get('feed'), 'sip');
    assert.equal(url.searchParams.get('adjustment'), 'split');
  }
  assert.deepEqual(parseCandlesCsv(serializeCandles(candles), alpacaNvdaMetadata), candles);
  assert.deepEqual(validateMetadata(alpacaNvdaMetadata), alpacaNvdaMetadata);
});

test('contrato 15 minutos rechaza desalineación y huecos; ventana deja cerrar la última vela', async () => {
  const csv = 'timestamp,open,high,low,close,volume\n' +
    '2026-06-01T13:30:00Z,100,101,99,100,1000\n' +
    '2026-06-01T13:40:00Z,100,101,99,100,1000\n';
  assert.throws(() => parseCandlesCsv(csv, alpacaNvdaMetadata), /no alineada/);
  assert.throws(() => parseCandlesCsv(csv.replace('13:40', '14:00'), alpacaNvdaMetadata), /Faltan velas de 15/);
  const now = Date.parse('2026-10-17T20:03:00Z');
  const window = historicalWindow(now, 12, 15);
  assert.equal(Date.parse(window.end) % 900_000, 0);
  assert.ok(Date.parse(window.end) + 900_000 <= now - 20 * 60_000);
  const httpGet: HttpGet = async () => new Response(JSON.stringify({bars: {NVDA: [bar('2026-06-01T13:30:00Z')]}}));
  await assert.rejects(fetchAlpacaBars({apiKey: 'fake', secretKey: 'fake',
    start: '2026-06-01T13:30:00Z', end: '2026-06-01T13:30:00Z',
    now: Date.parse('2026-06-01T13:55:00Z'), metadata: alpacaNvdaMetadata, httpGet}),
  /demasiado recientes/);
});

test('calendario de cierres anticipados se conserva en el sidecar local', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nvda-calendar-'));
  try {
    const path = join(dir, 'calendar.json');
    const calendar: MarketCalendar = new Map([
      ['2026-11-27', {open: 570, close: 780}],
      ['2026-11-30', {open: 570, close: 960}],
    ]);
    saveMarketCalendar(path, calendar);
    assert.deepEqual(loadMarketCalendar(path), calendar);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
