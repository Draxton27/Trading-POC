import type {Candle} from './domain.ts';
import {createHash} from 'node:crypto';
import {parseCandlesCsv, serializeCandles} from './csv.ts';
import {isBarInSession, parseBarStart, type DataMetadata} from './data-contract.ts';
import {isCalendarBar, type MarketCalendar} from './alpaca-calendar.ts';

const SAFETY_MS = 20 * 60_000;
// Capture freshness is measured from actual receipt, independent of the historical safety window.
const CAPTURE_CURRENT_MS = 5 * 60_000;
const ENDPOINT = 'https://data.alpaca.markets/v2/stocks/bars';

export const alpacaMetadata: DataMetadata = {
  asset: 'QQQ', provider: 'Alpaca Market Data API', bar_minutes: 5,
  data_class: 'real', session: 'regular', exchange_timezone: 'America/New_York',
  feed: 'sip', adjustment: 'split',
};
export const alpacaNvdaMetadata: DataMetadata = {
  ...alpacaMetadata, asset: 'NVDA', bar_minutes: 15,
};

export type HttpGet = (url: URL, headers: Record<string, string>) => Promise<Response>;
export type ImportOptions = {
  apiKey: string;
  secretKey: string;
  start: string;
  end: string;
  now?: number;
  httpGet?: HttpGet;
  pause?: (milliseconds: number) => Promise<void>;
  minIntervalMs?: number;
  calendar?: MarketCalendar;
  metadata?: DataMetadata;
  /** Phase 14 preserves observed gaps and counts byte-equivalent repeated bars. Defaults preserve older importers. */
  allowIntradayGaps?: boolean;
  allowExactDuplicates?: boolean;
  duplicateAudit?: {exact: number};
};
export type AlpacaCaptureResult={candles:Candle[];receivedAtUtc:string;responseSha256:string;availability:'CURRENT'|'DELAYED';effectiveDelayMs:number;};
export class AlpacaCaptureError extends Error {
  readonly status: 'PERMISSION_DENIED'|'RATE_LIMIT'|'HTTP_ERROR'|'NETWORK_ERROR';
  constructor(status: 'PERMISSION_DENIED'|'RATE_LIMIT'|'HTTP_ERROR'|'NETWORK_ERROR', message: string) { super(message); this.status = status; }
}

export function parseHistoryMonths(args: readonly string[]): number {
  if (args.length === 0) return 3;
  if (args.length !== 2 || args[0] !== '--months' || !/^(?:[1-9]|1[0-2])$/.test(args[1] ?? '')) {
    throw new Error('Uso: npm run import:alpaca -- [--months N], con N entre 1 y 12.');
  }
  return Number(args[1]);
}

/** End is the start of the newest permitted bar; that bar closes at least 20 minutes ago. */
export function historicalWindow(now = Date.now(), months = 3, barMinutes: 5 | 15 = 5): {start: string; end: string} {
  if (!Number.isInteger(months) || months < 1 || months > 12) throw new Error('Meses históricos deben estar entre 1 y 12.');
  const duration = barMinutes * 60_000;
  const end = Math.floor((now - SAFETY_MS - duration) / duration) * duration;
  let start: number;
  if (months === 3) {
    start = end - 90 * 24 * 60 * 60_000; // preserves phase-3 default
  } else {
    const date = new Date(end);
    const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, 1,
      date.getUTCHours(), date.getUTCMinutes()));
    const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    first.setUTCDate(Math.min(date.getUTCDate(), lastDay));
    start = first.getTime();
  }
  return {
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
  };
}

const defaultGet: HttpGet = (url, headers) => fetch(url, {headers});
const defaultPause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function alpacaTimestamp(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Alpaca devolvió un timestamp inválido.');
  // Alpaca can emit RFC3339 nanoseconds. These aggregate bars start on whole minutes.
  const normalized = value.replace(/\.0+Z$/, 'Z');
  return new Date(parseBarStart(normalized)).toISOString();
}

function alpacaCandle(value: unknown): Candle {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Alpaca devolvió una vela inválida.');
  }
  const bar = value as Record<string, unknown>;
  const candle: Candle = {
    timestamp: alpacaTimestamp(bar.t), open: bar.o as number, high: bar.h as number,
    low: bar.l as number, close: bar.c as number, volume: bar.v as number,
  };
  const {open, high, low, close, volume} = candle;
  if ([open, high, low, close, volume].some(n => typeof n !== 'number' || !Number.isFinite(n)) ||
      open <= 0 || high <= 0 || low <= 0 || close <= 0 ||
      high < Math.max(open, close, low) || low > Math.min(open, close) ||
      volume < 0 || !Number.isSafeInteger(volume)) {
    throw new Error(`Alpaca devolvió OHLCV inválido en ${candle.timestamp}.`);
  }
  return candle;
}

function retryWait(response: Response, attempt: number): number {
  const raw = response.headers.get('retry-after');
  if (raw !== null) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(raw);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return Math.min(1000 * 2 ** attempt, 30_000);
}

/** Read sequential pages, validate all bars, then hand complete data to the caller. */
export async function fetchAlpacaBars(options: ImportOptions): Promise<Candle[]> {
  const {apiKey, secretKey, httpGet = defaultGet, pause = defaultPause} = options;
  const metadata = options.metadata ?? alpacaMetadata;
  if (metadata.provider !== alpacaMetadata.provider || metadata.data_class !== 'real' ||
      metadata.feed !== 'sip' || metadata.adjustment !== 'split' || metadata.session !== 'regular' ||
      (metadata.asset !== 'QQQ' && metadata.asset !== 'NVDA' && metadata.asset !== 'SMH') ||
      (metadata.asset === 'QQQ' && metadata.bar_minutes !== 5 && metadata.bar_minutes !== 15) ||
      (metadata.asset === 'SMH' && metadata.bar_minutes !== 15) ||
      (metadata.asset === 'NVDA' && metadata.bar_minutes !== 15)) {
    throw new Error('Configuración de importación Alpaca no admitida.');
  }
  const duration = metadata.bar_minutes * 60_000;
  if (!apiKey.trim() || !secretKey.trim()) throw new Error('Faltan APCA_API_KEY_ID o APCA_API_SECRET_KEY.');
  const start = parseBarStart(options.start);
  const end = parseBarStart(options.end);
  const now = options.now ?? Date.now();
  if (start > end || end + duration > now - SAFETY_MS) {
    throw new Error('El rango es inválido o incluye velas demasiado recientes para SIP gratuito.');
  }
  const minIntervalMs = options.minIntervalMs ?? 500; // <= 120 requests/min, below Basic's 200/min.
  if (!Number.isFinite(minIntervalMs) || minIntervalMs < 500) {
    throw new Error('El intervalo mínimo entre solicitudes debe ser >= 500 ms.');
  }

  const candles: Candle[] = [];
  const seenTokens = new Set<string>();
  let pageToken: string | null = null;
  let lastRawTime = -Infinity;
  const seenRaw = new Map<number, Candle>();
  let lastRequestAt = -Infinity;
  do {
    const url = new URL(ENDPOINT);
    url.searchParams.set('symbols', metadata.asset);
    url.searchParams.set('timeframe', `${metadata.bar_minutes}Min`);
    url.searchParams.set('feed', 'sip');
    url.searchParams.set('adjustment', 'split');
    url.searchParams.set('start', new Date(start).toISOString());
    url.searchParams.set('end', new Date(end).toISOString());
    url.searchParams.set('limit', '10000');
    url.searchParams.set('sort', 'asc');
    if (pageToken) url.searchParams.set('page_token', pageToken);
    let response: Response | undefined;
    for (let attempt = 0; attempt < 4; attempt++) {
      const delay = lastRequestAt + minIntervalMs - Date.now();
      if (delay > 0) await pause(delay);
      lastRequestAt = Date.now();
      try {
        response = await httpGet(url, {'APCA-API-KEY-ID': apiKey, 'APCA-API-SECRET-KEY': secretKey});
      } catch (error) {
        if (attempt === 3) throw new Error(`Error de red de Alpaca tras 4 intentos: ${String(error)}`);
        await pause(1000 * 2 ** attempt);
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Alpaca respondió ${response.status}: revise credenciales o permiso para SIP histórico.`);
      }
      if (response.status === 429 || response.status >= 500) {
        if (attempt === 3) throw new Error(`Alpaca respondió ${response.status} tras 4 intentos.`);
        await pause(retryWait(response, attempt));
        continue;
      }
      if (!response.ok) throw new Error(`Alpaca respondió HTTP ${response.status}.`);
      break;
    }
    if (!response?.ok) throw new Error('No se obtuvo una página válida de Alpaca.');
    let body: unknown;
    try { body = await response.json(); }
    catch { throw new Error('Alpaca devolvió JSON inválido.'); }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error('Formato de página inválido.');
    const page = body as Record<string, unknown>;
    const bars = page.bars as Record<string, unknown> | undefined;
    if (typeof bars !== 'object' || bars === null || Array.isArray(bars) || !Array.isArray(bars[metadata.asset])) {
      throw new Error(`Alpaca no devolvió bars.${metadata.asset} como lista.`);
    }
    for (const raw of bars[metadata.asset] as unknown[]) {
      const candle = alpacaCandle(raw);
      const time = Date.parse(candle.timestamp);
      const priorRaw = options.allowExactDuplicates ? seenRaw.get(time) : undefined;
      if (priorRaw && candle.open === priorRaw.open && candle.high === priorRaw.high &&
          candle.low === priorRaw.low && candle.close === priorRaw.close &&
          candle.volume === priorRaw.volume) {
        if (options.duplicateAudit) options.duplicateAudit.exact++;
        continue;
      }
      if (time < start || time > end || time <= lastRawTime) {
        throw new Error(`Vela de Alpaca fuera de rango, duplicada o desordenada: ${candle.timestamp}.`);
      }
      lastRawTime = time;
      if (options.allowExactDuplicates) seenRaw.set(time, candle);
      if (isBarInSession(time, metadata) &&
          (!options.calendar || isCalendarBar(time, options.calendar))) candles.push(candle);
    }
    const next = page.next_page_token;
    if (next !== null && next !== undefined && (typeof next !== 'string' || !next || seenTokens.has(next))) {
      throw new Error('Token de paginación inválido o repetido.');
    }
    pageToken = typeof next === 'string' ? next : null;
    if (pageToken) seenTokens.add(pageToken);
  } while (pageToken);
  if (!candles.length) throw new Error(`Alpaca no devolvió velas ${metadata.asset} de sesión regular en el rango.`);
  // The existing CSV contract rejects missing intraday bars; no synthetic fill is made.
  return parseCandlesCsv(serializeCandles(candles), metadata,
    {allowIntradayGaps: options.allowIntradayGaps});
}

/**
 * Recent SIP capture for Phase 32. It deliberately does not apply the historical
 * 20-minute safety window: each returned bar is instead stamped with the local
 * reception time and its observed delay. It never falls back to IEX.
 */
export async function fetchAlpacaCaptureBars(options:Omit<ImportOptions,'metadata'|'allowIntradayGaps'|'allowExactDuplicates'|'duplicateAudit'>):Promise<AlpacaCaptureResult>{
  const {apiKey,secretKey,httpGet=defaultGet,pause=defaultPause,calendar}=options;
  if(!calendar)throw new AlpacaCaptureError('HTTP_ERROR','La captura requiere el calendario oficial de Alpaca.');
  if(!apiKey.trim()||!secretKey.trim())throw new AlpacaCaptureError('PERMISSION_DENIED','Faltan credenciales Alpaca.');
  const start=parseBarStart(options.start),end=parseBarStart(options.end),now=options.now??Date.now();
  if(start>end||end>now+60_000)throw new AlpacaCaptureError('HTTP_ERROR','Ventana de captura inválida.');
  const url=new URL(ENDPOINT);url.searchParams.set('symbols','NVDA');url.searchParams.set('timeframe','15Min');url.searchParams.set('feed','sip');url.searchParams.set('adjustment','split');url.searchParams.set('start',new Date(start).toISOString());url.searchParams.set('end',new Date(end).toISOString());url.searchParams.set('limit','10000');url.searchParams.set('sort','asc');
  let response:Response|undefined;
  for(let attempt=0;attempt<4;attempt++){
    try{response=await httpGet(url,{'APCA-API-KEY-ID':apiKey,'APCA-API-SECRET-KEY':secretKey});}
    catch(error){if(attempt===3)throw new AlpacaCaptureError('NETWORK_ERROR',`Error de red Alpaca: ${String(error)}`);await pause(1000*2**attempt);continue;}
    if(response.status===401||response.status===403)throw new AlpacaCaptureError('PERMISSION_DENIED',`Alpaca respondió ${response.status}: SIP no autorizado o credenciales inválidas.`);
    if(response.status===429){if(attempt===3)throw new AlpacaCaptureError('RATE_LIMIT','Alpaca limitó la captura tras reintentos.');await pause(retryWait(response,attempt));continue;}
    if(response.status>=500){if(attempt===3)throw new AlpacaCaptureError('HTTP_ERROR',`Alpaca respondió ${response.status} tras reintentos.`);await pause(retryWait(response,attempt));continue;}
    if(!response.ok)throw new AlpacaCaptureError('HTTP_ERROR',`Alpaca respondió HTTP ${response.status}.`);break;
  }
  if(!response?.ok)throw new AlpacaCaptureError('HTTP_ERROR','No se obtuvo una respuesta Alpaca válida.');
  let body:unknown;try{body=await response.json();}catch{throw new AlpacaCaptureError('HTTP_ERROR','Alpaca devolvió JSON inválido.');}
  const bars=(body as {bars?:Record<string,unknown>}).bars?.NVDA;if(!Array.isArray(bars))throw new AlpacaCaptureError('HTTP_ERROR','Alpaca no devolvió bars.NVDA.');
  const candles=bars.map(alpacaCandle).filter(candle=>{const time=Date.parse(candle.timestamp);return time>=start&&time<=end&&isCalendarBar(time,calendar)&&time+15*60_000<=now;});
  for(let i=1;i<candles.length;i++)if(Date.parse(candles[i]!.timestamp)<=Date.parse(candles[i-1]!.timestamp))throw new AlpacaCaptureError('HTTP_ERROR','Alpaca devolvió barras duplicadas o desordenadas.');
  const receivedAtUtc=new Date(now).toISOString(),last=candles.at(-1),effectiveDelayMs=last?Math.max(0,now-(Date.parse(last.timestamp)+15*60_000)):Infinity;
  return {candles,receivedAtUtc,responseSha256:createHash('sha256').update(JSON.stringify(body)).digest('hex'),availability:effectiveDelayMs<=CAPTURE_CURRENT_MS?'CURRENT':'DELAYED',effectiveDelayMs};
}
