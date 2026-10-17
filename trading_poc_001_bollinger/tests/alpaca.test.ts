import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {alpacaMetadata, fetchAlpacaBars, historicalWindow, parseHistoryMonths, type HttpGet} from '../src/alpaca.ts';
import {fetchAlpacaCalendar, isCalendarBar} from '../src/alpaca-calendar.ts';
import {parseCandlesCsv, serializeCandles} from '../src/csv.ts';
import {validateMetadata} from '../src/data-contract.ts';

const now = Date.parse('2026-06-10T20:00:00Z');
const range = {start: '2026-06-01T13:30:00Z', end: '2026-06-09T19:55:00Z', now};
const bar = (t: string, o = 100.123456) => ({t, o, h: 101.123456, l: 99.123456, c: 100.654321, v: 1234});
const page = (bars: unknown[], next: string | null = null) => new Response(JSON.stringify({bars: {QQQ: bars}, next_page_token: next}), {status: 200});
const options = (httpGet: HttpGet) => ({...range, apiKey: 'test-key', secretKey: 'test-secret', httpGet,
  pause: async (_ms: number) => {}});

test('el comando de importación carga .env local sin credenciales reales', () => {
  const packagePath = new URL('../package.json', import.meta.url);
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as {scripts: Record<string, string>};
  assert.match(pkg.scripts['import:alpaca'] ?? '', /--env-file-if-exists=\.env/);
  const dir = mkdtempSync(join(tmpdir(), 'alpaca-env-test-'));
  try {
    writeFileSync(join(dir, '.env'), 'APCA_API_KEY_ID=simulated-key\nAPCA_API_SECRET_KEY=simulated-secret\n');
    const env = {...process.env};
    delete env.APCA_API_KEY_ID;
    delete env.APCA_API_SECRET_KEY;
    const result = spawnSync(process.execPath,
      ['--env-file-if-exists=.env', '-p', 'process.env.APCA_API_KEY_ID + ":" + process.env.APCA_API_SECRET_KEY'],
      {cwd: dir, env, encoding: 'utf8'});
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), 'simulated-key:simulated-secret');
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('ventana inicial cubre 90 días y excluye velas recientes con margen de 20 minutos tras el cierre', () => {
  const time = Date.parse('2026-06-10T20:03:00Z');
  const window = historicalWindow(time);
  assert.equal(window.end, '2026-06-10T19:35:00.000Z');
  assert.equal(Date.parse(window.end) - Date.parse(window.start), 90 * 24 * 60 * 60_000);
  assert.ok(Date.parse(window.end) + 300_000 <= time - 20 * 60_000);
});

test('historial configurable permite doce meses sin alterar el valor predeterminado', () => {
  const time = Date.parse('2026-10-17T20:03:00Z');
  assert.equal(parseHistoryMonths([]), 3);
  assert.equal(parseHistoryMonths(['--months', '12']), 12);
  assert.equal(historicalWindow(time, 3).start, historicalWindow(time).start);
  const twelve = historicalWindow(time, 12);
  assert.equal(twelve.start, '2025-10-17T19:35:00.000Z');
  assert.equal(historicalWindow(Date.parse('2026-03-31T20:03:00Z'), 1).start,
    '2026-02-28T19:35:00.000Z');
  assert.ok(Date.parse(twelve.end) + 300_000 <= time - 20 * 60_000);
  for (const args of [['--months', '0'], ['--months', '13'], ['--months', '1.5'], ['--unknown', '12']]) {
    assert.throws(() => parseHistoryMonths(args));
  }
});

test('calendario Alpaca elimina barras tras cierre temprano y en festivos sin inventarlas', async () => {
  const calendar = await fetchAlpacaCalendar({apiKey: 'test', secretKey: 'test',
    start: '2025-12-24T00:00:00Z', end: '2025-12-26T23:55:00Z',
    httpGet: async url => {
      assert.equal(url.pathname, '/v2/calendar');
      return new Response(JSON.stringify([
        {date: '2025-12-24', open: '09:30', close: '13:00'},
        {date: '2025-12-26', open: '09:30', close: '16:00'},
      ]));
    }});
  assert.equal(isCalendarBar(Date.parse('2025-12-24T17:55:00Z'), calendar), true);
  assert.equal(isCalendarBar(Date.parse('2025-12-24T20:20:00Z'), calendar), false);
  assert.equal(isCalendarBar(Date.parse('2025-12-25T14:30:00Z'), calendar), false);
  const candles = await fetchAlpacaBars({
    ...options(async () => page([
      bar('2025-12-24T17:55:00Z'), bar('2025-12-24T20:20:00Z'),
      bar('2025-12-24T20:30:00Z'), bar('2025-12-26T14:30:00Z'),
    ])),
    start: '2025-12-24T17:55:00Z', end: '2025-12-26T14:30:00Z', calendar,
  });
  assert.equal(candles.length, 2);
  assert.equal(candles[1]!.timestamp, '2025-12-26T14:30:00.000Z');
});

test('calendario reintenta límites temporales y falla por credenciales inválidas', async () => {
  let calls = 0;
  const waits: number[] = [];
  const base = {apiKey: 'test', secretKey: 'test', start: '2025-12-24T00:00:00Z', end: '2025-12-24T23:55:00Z'};
  const calendar = await fetchAlpacaCalendar({...base, pause: async ms => {waits.push(ms);},
    httpGet: async () => ++calls === 1 ? new Response('', {status: 429, headers: {'retry-after': '2'}}) :
      new Response(JSON.stringify([{date: '2025-12-24', open: '09:30', close: '13:00'}]))});
  assert.equal(calls, 2);
  assert.deepEqual(waits, [2000]);
  assert.equal(calendar.size, 1);
  await assert.rejects(fetchAlpacaCalendar({...base, httpGet: async () => new Response('', {status: 401})}), /401/);
});

test('consulta SIP split, pagina, filtra sesión regular y conserva precisión CSV y procedencia', async () => {
  const urls: URL[] = [];
  const headers: Record<string, string>[] = [];
  const httpGet: HttpGet = async (url, auth) => {
    urls.push(new URL(url)); headers.push(auth);
    if (urls.length === 1) return page([
      bar('2026-06-01T12:00:00Z'), // premarket
      bar('2026-06-01T13:30:00.000000000Z'),
    ], 'second');
    return page([bar('2026-06-01T13:35:00Z'), bar('2026-06-01T20:00:00Z')]); // after close
  };
  const candles = await fetchAlpacaBars({...options(httpGet), start: '2026-06-01T12:00:00Z'});
  assert.equal(candles.length, 2);
  assert.equal(candles[0]!.timestamp, '2026-06-01T13:30:00.000Z');
  assert.equal(candles[0]!.open, 100.123456);
  assert.equal(urls.length, 2);
  for (const url of urls) {
    assert.equal(url.origin + url.pathname, 'https://data.alpaca.markets/v2/stocks/bars');
    for (const [key, value] of Object.entries({symbols: 'QQQ', timeframe: '5Min', feed: 'sip', adjustment: 'split', limit: '10000', sort: 'asc'})) {
      assert.equal(url.searchParams.get(key), value);
    }
  }
  assert.equal(urls[1]!.searchParams.get('page_token'), 'second');
  assert.deepEqual(headers[0], {'APCA-API-KEY-ID': 'test-key', 'APCA-API-SECRET-KEY': 'test-secret'});
  assert.deepEqual(parseCandlesCsv(serializeCandles(candles), alpacaMetadata), candles);
  assert.deepEqual(validateMetadata(alpacaMetadata), alpacaMetadata);
  assert.equal(alpacaMetadata.data_class, 'real');
});

test('respeta cambio de horario de verano y acepta fines de semana y sesiones parciales sin inventar velas', async () => {
  const candles = await fetchAlpacaBars({
    ...options(async () => page([
      bar('2026-03-06T20:55:00Z'), // 15:55 EST
      bar('2026-03-09T13:30:00Z'), // 09:30 EDT
      bar('2026-03-09T13:35:00Z'),
    ])),
    start: '2026-03-06T20:55:00Z', end: '2026-03-09T13:35:00Z',
  });
  assert.equal(candles.length, 3);
  const winter = await fetchAlpacaBars({
    ...options(async () => page([
      bar('2026-10-30T19:55:00Z'), // 15:55 EDT
      bar('2026-11-02T14:30:00Z'), // 09:30 EST
    ])),
    start: '2026-10-30T19:55:00Z', end: '2026-11-02T14:30:00Z',
    now: Date.parse('2026-11-03T20:00:00Z'),
  });
  assert.equal(winter.length, 2);
  const partial = await fetchAlpacaBars({
    ...options(async () => page([
      bar('2026-11-27T17:55:00Z'), // 12:55 EST, cierre anticipado simulado
      bar('2026-11-30T14:30:00Z'), // 09:30 EST
    ])),
    start: '2026-11-27T17:55:00Z', end: '2026-11-30T14:30:00Z',
    now: Date.parse('2026-12-01T20:00:00Z'),
  });
  assert.equal(partial.length, 2);
});

test('rechaza vela reciente aun si el servidor la devolvería', async () => {
  const recent = '2026-06-10T19:40:00Z';
  await assert.rejects(fetchAlpacaBars({...options(async () => page([bar(recent)])), end: recent,
    now: Date.parse('2026-06-10T20:00:00Z')}), /demasiado recientes/);
});

test('reintenta 429 y 5xx; falla claramente por autenticación sin cambiar de feed', async () => {
  let calls = 0;
  const waits: number[] = [];
  const httpGet: HttpGet = async () => {
    calls++;
    if (calls === 1) return new Response('', {status: 429, headers: {'retry-after': '2'}});
    if (calls === 2) return new Response('', {status: 503});
    return page([bar('2026-06-01T13:30:00Z')]);
  };
  await fetchAlpacaBars({...options(httpGet), pause: async ms => {waits.push(ms);}});
  assert.equal(calls, 3);
  assert.ok(waits.includes(2000));
  for (const status of [401, 403]) {
    await assert.rejects(fetchAlpacaBars(options(async () => new Response('', {status}))),
      new RegExp(String(status)));
  }
});

test('rechaza huecos intradía, duplicados, páginas repetidas y OHLCV inválido', async () => {
  const cases: Array<[unknown[], string]> = [
    [[bar('2026-06-01T13:30:00Z'), bar('2026-06-01T13:40:00Z')], 'Faltan velas'],
    [[bar('2026-06-01T13:30:00Z'), bar('2026-06-01T13:30:00Z')], 'duplicada'],
    [[{...bar('2026-06-01T13:30:00Z'), h: 99}], 'OHLCV inválido'],
  ];
  for (const [bars, message] of cases) {
    await assert.rejects(fetchAlpacaBars(options(async () => page(bars))), new RegExp(message));
  }
  let call = 0;
  await assert.rejects(fetchAlpacaBars(options(async () => page(call++ === 0 ? [bar('2026-06-01T13:30:00Z')] : [], 'same'))),
    /repetido/);
});
