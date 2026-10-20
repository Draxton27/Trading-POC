import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {describe, expect, it} from 'vitest';
import {AlpacaCaptureError, fetchAlpacaCaptureBars} from '../../trading_poc_001_bollinger/src/alpaca.ts';
import {appendIngestion, readIngestion, recordsForCapture, validateCapture} from '../../trading_poc_001_bollinger/src/phase32-ingestion.ts';
import {readAlpacaIngestionStatus} from '../../apps/api/src/ml/ingestion.ts';
import {createApp} from '../../apps/api/src/server.ts';

const day = '2026-10-20', calendar = new Map([[day, {open: 570, close: 960}]]);
const c = (time: string, close = 190) => ({t: `${day}T${time}:00Z`, o: 189, h: 191, l: 188, c: close, v: 1234});
const fixedNow = Date.parse(`${day}T15:04:00Z`);
const response = (bars: unknown[], next_page_token?: string | null) => new Response(JSON.stringify({bars: {NVDA: bars}, next_page_token}), {status: 200});

describe('ingesta Alpaca SIP Fase 32', () => {
  it('solicita exclusivamente NVDA 15Min SIP split y mide recepciÃƒÂ³n', async () => {
    const urls: URL[] = [];
    const result = await fetchAlpacaCaptureBars({apiKey: 'key', secretKey: 'secret', start: `${day}T14:30:00Z`, end: `${day}T15:00:00Z`, now: fixedNow, calendar, httpGet: async url => { urls.push(url); return response([c('14:30'), c('14:45')]); }});
    expect(urls).toHaveLength(1);
    expect(urls[0]?.searchParams.get('symbols')).toBe('NVDA');
    expect(urls[0]?.searchParams.get('timeframe')).toBe('15Min');
    expect(urls[0]?.searchParams.get('feed')).toBe('sip');
    expect(urls[0]?.searchParams.get('adjustment')).toBe('split');
    expect(urls[0]?.searchParams.get('feed')).not.toBe('iex');
    expect(result.candles).toHaveLength(2);
    expect(result.availability).toBe('CURRENT');
    validateCapture(result.candles, calendar, result.receivedAtUtc);
  });
  it('distingue permisos, lÃƒÂ­mite de tasa y reintentos sin inventar velas', async () => {
    await expect(fetchAlpacaCaptureBars({apiKey: 'key', secretKey: 'secret', start: `${day}T14:30:00Z`, end: `${day}T15:00:00Z`, now: fixedNow, calendar, httpGet: async () => new Response('', {status: 403})})).rejects.toMatchObject({status: 'PERMISSION_DENIED'} satisfies Partial<AlpacaCaptureError>);
    let attempts = 0, pauses = 0;
    const result = await fetchAlpacaCaptureBars({apiKey: 'key', secretKey: 'secret', start: `${day}T14:30:00Z`, end: `${day}T15:00:00Z`, now: fixedNow, calendar, pause: async () => { pauses++; }, httpGet: async () => ++attempts === 1 ? new Response('', {status: 429, headers: {'retry-after': '0'}}) : response([c('14:30')])});
    expect(pauses).toBe(1); expect(result.candles).toHaveLength(1);
  });
  it('rechaza huecos, sesiones incompatibles y vela incompleta', () => {
    expect(() => validateCapture([{timestamp: `${day}T14:30:00.000Z`, open: 1, high: 1, low: 1, close: 1, volume: 1}, {timestamp: `${day}T15:00:00.000Z`, open: 1, high: 1, low: 1, close: 1, volume: 1}], calendar, `${day}T16:00:00.000Z`)).toThrow(/Hueco/);
    expect(() => validateCapture([{timestamp: `${day}T20:00:00.000Z`, open: 1, high: 1, low: 1, close: 1, volume: 1}], calendar, `${day}T21:00:00.000Z`)).toThrow(/calendario/);
    const early = new Map([[day, {open: 570, close: 780}]]);
    expect(() => validateCapture([{timestamp: `${day}T17:00:00.000Z`, open: 1, high: 1, low: 1, close: 1, volume: 1}], early, `${day}T18:00:00.000Z`)).toThrow(/calendario/);
    expect(() => validateCapture([{timestamp: `${day}T15:00:00.000Z`, open: 1, high: 1, low: 1, close: 1, volume: 1}], calendar, `${day}T15:05:00.000Z`)).toThrow(/incompatible/);
  });
  it('conserva revisiones, es idempotente y proyecta un estado sin rutas privadas', () => {
    const root = mkdtempSync(join(tmpdir(), 'phase32-')), ledger = join(root, 'ledger.jsonl');
    try {
      const first = {timestamp: `${day}T14:30:00.000Z`, open: 189, high: 191, low: 188, close: 190, volume: 1234};
      const initial = recordsForCapture([first], `${day}T15:20:00.000Z`, 'a'.repeat(64), 'CURRENT', 300000, []);
      expect(appendIngestion(ledger, initial).records).toHaveLength(1);
      expect(recordsForCapture([first], `${day}T15:25:00.000Z`, 'b'.repeat(64), 'CURRENT', 600000, readIngestion(ledger))).toHaveLength(0);
      const revised = recordsForCapture([{...first, close: 190.5}], `${day}T15:30:00.000Z`, 'c'.repeat(64), 'DELAYED', 1200001, readIngestion(ledger));
      expect(appendIngestion(ledger, revised).records[0]?.bar?.revision).toBe(2);
      expect(readIngestion(ledger)).toHaveLength(2);
      expect(readAlpacaIngestionStatus(ledger)).toMatchObject({status: 'DELAYED', feed: 'sip', revision: 2, lastBarStartUtc: first.timestamp});
    } finally { rmSync(root, {recursive: true, force: true}); }
  });
  it('expone el estado de ingesta mediante una ruta GET de solo lectura', async () => {
    const root = mkdtempSync(join(tmpdir(), 'phase32-api-')), ledger = join(root, 'ledger.jsonl');
    try {
      appendIngestion(ledger, {kind: 'status', receivedAtUtc: `${day}T15:20:00.000Z`, status: 'PERMISSION_DENIED', detail: 'SIP no autorizado.', provider: 'Alpaca Market Data API', feed: 'sip', adjustment: 'split', availability: 'UNAVAILABLE', responseSha256: null, bar: null, effectiveDelayMs: null});
      const {app} = await createApp({mode: 'DEMO', privateDir: root, dbPath: join(root, 'test.sqlite'), mlIngestionLog: ledger});
      try {
        const response = await app.inject('/api/v1/ml/ingestion?symbol=NVDA&timeframe=15m');
        expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({status: 'PERMISSION_DENIED', feed: 'sip'});
        expect((await app.inject('/api/v1/ml/ingestion?symbol=QQQ')).statusCode).toBe(400);
        expect(app.printRoutes()).not.toMatch(/\/api\/v1\/ml\/(capture|ingest|order)/);
      } finally { await app.close(); }
    } finally { rmSync(root, {recursive: true, force: true}); }
  });
});
