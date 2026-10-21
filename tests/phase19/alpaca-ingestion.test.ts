import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {describe, expect, it} from 'vitest';
import {AlpacaCalendarError, fetchAlpacaCalendar, loadMarketCalendar, saveMarketCalendar} from '../../trading_poc_001_bollinger/src/alpaca-calendar.ts';
import {AlpacaCaptureError, CAPTURE_BAR_MS, DELAYED_CAPTURE_MS, delayedCaptureWindow, fetchAlpacaCaptureBars} from '../../trading_poc_001_bollinger/src/alpaca.ts';
import {appendSuccessfulCapture, readIngestion, validateCapture} from '../../trading_poc_001_bollinger/src/phase32-ingestion.ts';
import {readAlpacaIngestionStatus} from '../../apps/api/src/ml/ingestion.ts';
import {createApp} from '../../apps/api/src/server.ts';

const day = '2026-10-20', calendar = new Map([[day, {open: 570, close: 960}]]);
const c = (time: string, close = 190) => ({t: `${day}T${time}:00Z`, o: 189, h: 191, l: 188, c: close, v: 1234});
const response = (bars: unknown[]) => new Response(JSON.stringify({bars: {NVDA: bars}}), {status: 200});
const capture = (candles: any[], receivedAtUtc: string, hash: string, queryAtUtc = '2026-10-20T15:00:00.000Z') => ({candles, queryAtUtc, receivedAtUtc, responseSha256: hash.repeat(64).slice(0, 64), availability: 'CURRENT' as const, barAgeMs: 60_000});

describe('ingesta Alpaca SIP Fase 32', () => {
  it('inicializa atómicamente el calendario privado y conserva el anterior si falla la publicación', () => {
    const root = mkdtempSync(join(tmpdir(), 'phase32-calendar-')), path = join(root, 'private', 'alpaca', 'ledger.jsonl.calendar.json');
    try {
      saveMarketCalendar(path, calendar); expect(loadMarketCalendar(path)).toEqual(calendar);
      const prior = readFileSync(path, 'utf8');
      expect(() => saveMarketCalendar(path, new Map([[day, {open: 600, close: 900}]]), {
        mkdirSync: () => undefined, writeFileSync: () => { throw new Error('disco lleno'); }, renameSync: () => {}, rmSync: () => {}, randomUUID: () => 'write-failure',
      })).toThrow(/disco lleno/);
      expect(readFileSync(path, 'utf8')).toBe(prior);
      expect(() => saveMarketCalendar(path, new Map([[day, {open: 600, close: 900}]]), {
        mkdirSync: () => undefined, writeFileSync: () => {}, renameSync: () => { throw new Error('renombrado bloqueado'); }, rmSync: () => {}, randomUUID: () => 'test',
      })).toThrow(/renombrado bloqueado/);
      expect(readFileSync(path, 'utf8')).toBe(prior); expect(loadMarketCalendar(path)).toEqual(calendar);
    } finally { rmSync(root, {recursive: true, force: true}); }
  });
  it('alinea el límite retrasado a 15 minutos y exige cierres con 20 minutos de antigüedad', () => {
    const now = Date.parse(`${day}T15:35:00.000Z`), window = delayedCaptureWindow(now, 20, 2 * CAPTURE_BAR_MS);
    expect(window).toMatchObject({start: `${day}T14:30:00.000Z`, end: `${day}T15:00:00.000Z`, delayMs: DELAYED_CAPTURE_MS});
    expect(Date.parse(window.start) % CAPTURE_BAR_MS).toBe(0);
    expect(Date.parse(window.end) % CAPTURE_BAR_MS).toBe(0);
    expect(Date.parse(window.end) + CAPTURE_BAR_MS).toBe(now - DELAYED_CAPTURE_MS);
    expect(() => delayedCaptureWindow(now, 19)).toThrow(/delay-minutes/);
    expect(() => delayedCaptureWindow(now, 20, CAPTURE_BAR_MS + 1)).toThrow(/delay-minutes/);
  });
  it('solicita únicamente NVDA 15Min SIP split y registra recepción tras leer HTTP', async () => {
    let clock = Date.parse(`${day}T15:00:00Z`); const urls: URL[] = [];
    const result = await fetchAlpacaCaptureBars({apiKey: 'key', secretKey: 'secret', start: `${day}T14:30:00Z`, end: `${day}T15:00:00Z`, calendar, clock: () => clock, httpGet: async url => { urls.push(url); clock = Date.parse(`${day}T15:04:00Z`); return response([c('14:30'), c('14:45')]); }});
    expect(urls[0]?.searchParams.get('symbols')).toBe('NVDA'); expect(urls[0]?.searchParams.get('timeframe')).toBe('15Min');
    expect(urls[0]?.searchParams.get('feed')).toBe('sip'); expect(urls[0]?.searchParams.get('adjustment')).toBe('split');
    expect(result.queryAtUtc).toBe(`${day}T15:00:00.000Z`); expect(result.receivedAtUtc).toBe(`${day}T15:04:00.000Z`); expect(result.barAgeMs).toBe(240000);
    validateCapture(result.candles, calendar, result.receivedAtUtc, () => clock);
  });
  it('etiqueta la captura retrasada y valida el límite antes de consultar Market Data', async () => {
    let clock = Date.parse(`${day}T15:35:00.000Z`); const urls: URL[] = [];
    const result = await fetchAlpacaCaptureBars({apiKey: 'key', secretKey: 'secret', start: `${day}T14:30:00Z`, end: `${day}T15:00:00Z`, calendar, minimumBarAgeMs: DELAYED_CAPTURE_MS, clock: () => clock, httpGet: async url => { urls.push(url); clock = Date.parse(`${day}T15:36:00.000Z`); return response([c('14:30'), c('14:45'), c('15:00')]); }});
    expect(result).toMatchObject({queryAtUtc: `${day}T15:35:00.000Z`, receivedAtUtc: `${day}T15:36:00.000Z`, availability: 'DELAYED', barAgeMs: 21 * 60_000, effectiveDelayMs: 21 * 60_000});
    expect(urls[0]?.searchParams.get('feed')).toBe('sip'); expect(urls[0]?.searchParams.get('adjustment')).toBe('split');
    validateCapture(result.candles, calendar, result.receivedAtUtc, () => clock, DELAYED_CAPTURE_MS, result.queryAtUtc);
    const root = mkdtempSync(join(tmpdir(), 'phase32-delayed-')), ledger = join(root, 'ledger.jsonl');
    try { appendSuccessfulCapture(ledger, result); expect(readIngestion(ledger).every(row => row.kind === 'status' || row.availability === 'DELAYED')).toBe(true); }
    finally { rmSync(root, {recursive: true, force: true}); }
    await expect(fetchAlpacaCaptureBars({apiKey: 'key', secretKey: 'secret', start: `${day}T14:30:00Z`, end: `${day}T15:15:00Z`, calendar, minimumBarAgeMs: DELAYED_CAPTURE_MS, now: Date.parse(`${day}T15:35:00Z`)})).rejects.toMatchObject({status: 'RECENT_DATA_FORBIDDEN'} satisfies Partial<AlpacaCaptureError>);
  });
  it('distingue 403 de calendario, datos recientes, permisos SIP retrasados y límite de tasa', async () => {
    await expect(fetchAlpacaCalendar({apiKey: 'key', secretKey: 'secret', start: `${day}T00:00:00Z`, end: `${day}T23:00:00Z`, httpGet: async () => new Response('', {status: 403})})).rejects.toMatchObject({status: 'PERMISSION_DENIED'} satisfies Partial<AlpacaCalendarError>);
    await expect(fetchAlpacaCaptureBars({apiKey: 'key', secretKey: 'secret', start: `${day}T14:30:00Z`, end: `${day}T15:00:00Z`, now: Date.parse(`${day}T15:01:00Z`), calendar, httpGet: async () => new Response('', {status: 403})})).rejects.toMatchObject({status: 'RECENT_DATA_FORBIDDEN'} satisfies Partial<AlpacaCaptureError>);
    await expect(fetchAlpacaCaptureBars({apiKey: 'key', secretKey: 'secret', start: `${day}T14:30:00Z`, end: `${day}T15:00:00Z`, now: Date.parse(`${day}T15:35:00Z`), calendar, minimumBarAgeMs: DELAYED_CAPTURE_MS, httpGet: async () => new Response('', {status: 403})})).rejects.toMatchObject({status: 'PERMISSION_DENIED'} satisfies Partial<AlpacaCaptureError>);
    await expect(fetchAlpacaCaptureBars({apiKey: 'key', secretKey: 'secret', start: `${day}T14:30:00Z`, end: `${day}T15:00:00Z`, now: Date.parse(`${day}T15:35:00Z`), calendar, minimumBarAgeMs: DELAYED_CAPTURE_MS, httpGet: async () => new Response('', {status: 401})})).rejects.toMatchObject({status: 'PERMISSION_DENIED'} satisfies Partial<AlpacaCaptureError>);
    let attempts = 0; const result = await fetchAlpacaCaptureBars({apiKey: 'key', secretKey: 'secret', start: `${day}T14:30:00Z`, end: `${day}T15:00:00Z`, now: Date.parse(`${day}T15:04:00Z`), calendar, pause: async () => {}, httpGet: async () => ++attempts === 1 ? new Response('', {status: 429}) : response([c('14:30')])});
    expect(attempts).toBe(2); expect(result.candles).toHaveLength(1);
  });
  it('respeta un cierre anticipado al filtrar una captura retrasada', async () => {
    const early = new Map([[day, {open: 570, close: 780}]]), clock = Date.parse(`${day}T18:00:00.000Z`);
    const result = await fetchAlpacaCaptureBars({apiKey: 'key', secretKey: 'secret', start: `${day}T16:30:00Z`, end: `${day}T17:00:00Z`, calendar: early, minimumBarAgeMs: DELAYED_CAPTURE_MS, now: clock, httpGet: async () => response([c('16:30'), c('16:45'), c('17:00')])});
    expect(result.candles.map(bar => bar.timestamp)).toEqual([`${day}T16:30:00.000Z`, `${day}T16:45:00.000Z`]);
    expect(result.availability).toBe('DELAYED');
  });
  it('rechaza huecos, sesiones incompatibles y cierre anticipado', () => {
    expect(() => validateCapture([{timestamp: `${day}T14:30:00.000Z`, open: 1, high: 1, low: 1, close: 1, volume: 1}, {timestamp: `${day}T15:00:00.000Z`, open: 1, high: 1, low: 1, close: 1, volume: 1}], calendar, `${day}T16:00:00.000Z`)).toThrow(/Hueco/);
    const early = new Map([[day, {open: 570, close: 780}]]);
    expect(() => validateCapture([{timestamp: `${day}T17:00:00.000Z`, open: 1, high: 1, low: 1, close: 1, volume: 1}], early, `${day}T18:00:00.000Z`)).toThrow(/incompatible/);
  });
  it('decide duplicados y revisiones dentro del bloqueo, incluso A-B-A', async () => {
    const root = mkdtempSync(join(tmpdir(), 'phase32-')), ledger = join(root, 'ledger.jsonl');
    try {
      const a = {timestamp: `${day}T14:30:00.000Z`, open: 189, high: 191, low: 188, close: 190, volume: 1234}; const b = {...a, close: 190.5};
      // Calls may originate independently; each reads and decides under its own exclusive lock.
      await Promise.all([Promise.resolve().then(() => appendSuccessfulCapture(ledger, capture([a], `${day}T15:01:00.000Z`, 'a'))), Promise.resolve().then(() => appendSuccessfulCapture(ledger, capture([b], `${day}T15:02:00.000Z`, 'b')))]);
      appendSuccessfulCapture(ledger, capture([a], `${day}T15:03:00.000Z`, 'c'));
      const bars = readIngestion(ledger).filter(row => row.kind === 'bar');
      expect(bars.map(row => row.bar?.revision)).toEqual([1, 2, 3]); expect(bars.map(row => row.bar?.close)).toEqual([190, 190.5, 190]);
    } finally { rmSync(root, {recursive: true, force: true}); }
  });
  it('registra consultas exitosas sin novedades y recalcula obsolescencia al leer', () => {
    const root = mkdtempSync(join(tmpdir(), 'phase32-')), ledger = join(root, 'ledger.jsonl');
    try {
      const bar = {timestamp: `${day}T14:30:00.000Z`, open: 189, high: 191, low: 188, close: 190, volume: 1234};
      appendSuccessfulCapture(ledger, capture([bar], `${day}T14:46:00.000Z`, 'a', `${day}T14:45:00.000Z`));
      appendSuccessfulCapture(ledger, capture([bar], `${day}T14:47:00.000Z`, 'b', `${day}T14:46:00.000Z`));
      const records = readIngestion(ledger); expect(records.filter(row => row.kind === 'query')).toHaveLength(2); expect(records.filter(row => row.kind === 'bar')).toHaveLength(1);
      const status = readAlpacaIngestionStatus(ledger, () => Date.parse(`${day}T15:30:00.000Z`));
      expect(status).toMatchObject({status: 'DELAYED', lastAttemptAtUtc: `${day}T14:46:00.000Z`, lastSuccessfulQueryAtUtc: `${day}T14:46:00.000Z`, lastBarAvailability: 'DELAYED'});
    } finally { rmSync(root, {recursive: true, force: true}); }
  });
  it('conserva la vela mÃ¡s nueva aunque una revisiÃ³n de una vela anterior llegue despuÃ©s', () => {
    const root = mkdtempSync(join(tmpdir(), 'phase32-order-')), ledger = join(root, 'ledger.jsonl');
    try {
      const earlier = {timestamp: `${day}T13:00:00.000Z`, open: 188, high: 189, low: 187, close: 188.5, volume: 1000};
      const newer = {timestamp: `${day}T14:45:00.000Z`, open: 190, high: 191, low: 189, close: 190.5, volume: 1200};
      appendSuccessfulCapture(ledger, capture([earlier], `${day}T13:16:00.000Z`, 'a', `${day}T13:15:00.000Z`));
      appendSuccessfulCapture(ledger, capture([newer], `${day}T15:01:00.000Z`, 'b', `${day}T15:00:00.000Z`));
      appendSuccessfulCapture(ledger, capture([{...earlier, close: 188.75}], `${day}T15:02:00.000Z`, 'c', `${day}T15:01:00.000Z`));
      const status = readAlpacaIngestionStatus(ledger, () => Date.parse(`${day}T15:05:00.000Z`));
      expect(status).toMatchObject({lastBarStartUtc: `${day}T14:45:00.000Z`, lastBarEndUtc: `${day}T15:00:00.000Z`, revision: 1});
      expect(readIngestion(ledger).filter(row => row.kind === 'bar')).toHaveLength(3);
    } finally { rmSync(root, {recursive: true, force: true}); }
  });
  it('expone estado de solo lectura sin rutas privadas', async () => {
    const root = mkdtempSync(join(tmpdir(), 'phase32-api-')), ledger = join(root, 'ledger.jsonl');
    try {
      appendSuccessfulCapture(ledger, capture([], `${day}T15:20:00.000Z`, 'd'));
      const {app} = await createApp({mode: 'DEMO', privateDir: root, dbPath: join(root, 'test.sqlite'), mlIngestionLog: ledger});
      try { const response = await app.inject('/api/v1/ml/ingestion?symbol=NVDA&timeframe=15m'); expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({status: 'NO_DATA', feed: 'sip'}); expect(app.printRoutes()).not.toMatch(/\/api\/v1\/ml\/(capture|ingest|order)/); } finally { await app.close(); }
    } finally { rmSync(root, {recursive: true, force: true}); }
  });
});
