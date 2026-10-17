import {readFileSync, writeFileSync} from 'node:fs';
import type {HttpGet} from './alpaca.ts';

export type MarketCalendar = Map<string, {open: number; close: number}>;
export function saveMarketCalendar(path: string, calendar: MarketCalendar): void {
  const sessions = [...calendar].sort(([a], [b]) => a.localeCompare(b))
    .map(([date, hours]) => ({date, ...hours}));
  writeFileSync(path, JSON.stringify({provider: 'Alpaca Market Calendar', sessions}, null, 2) + '\n');
}

export function loadMarketCalendar(path: string): MarketCalendar {
  const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('Calendario local inválido.');
  const document = data as Record<string, unknown>;
  if (document.provider !== 'Alpaca Market Calendar' || !Array.isArray(document.sessions) ||
      !document.sessions.length) throw new Error('Calendario local inválido.');
  const calendar: MarketCalendar = new Map();
  for (const entry of document.sessions) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new Error('Sesión local inválida.');
    const row = entry as Record<string, unknown>;
    if (typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
        calendar.has(row.date) || !Number.isInteger(row.open) || !Number.isInteger(row.close) ||
        (row.open as number) < 0 || (row.close as number) > 1440 || (row.open as number) >= (row.close as number)) {
      throw new Error('Sesión local inválida.');
    }
    calendar.set(row.date, {open: row.open as number, close: row.close as number});
  }
  return calendar;
}
const clock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function minutes(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) throw new Error('Hora inválida en calendario Alpaca.');
  const [hour, minute] = value.split(':').map(Number);
  if (hour! > 23 || minute! > 59) throw new Error('Hora inválida en calendario Alpaca.');
  return hour! * 60 + minute!;
}

export function isCalendarBar(timestamp: number, calendar: MarketCalendar): boolean {
  const parts = Object.fromEntries(clock.formatToParts(new Date(timestamp)).map(p => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const session = calendar.get(date);
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  return session !== undefined && minute >= session.open && minute < session.close;
}

/** Alpaca's US trading calendar gives the actual open/close, including early closes. */
export async function fetchAlpacaCalendar(options: {
  apiKey: string; secretKey: string; start: string; end: string; httpGet?: HttpGet;
  pause?: (milliseconds: number) => Promise<void>;
}): Promise<MarketCalendar> {
  const url = new URL('https://paper-api.alpaca.markets/v2/calendar');
  url.searchParams.set('start', options.start.slice(0, 10));
  url.searchParams.set('end', options.end.slice(0, 10));
  const get = options.httpGet ?? ((u: URL, headers: Record<string, string>) => fetch(u, {headers}));
  const pause = options.pause ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  let response: Response | undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      response = await get(url, {'APCA-API-KEY-ID': options.apiKey, 'APCA-API-SECRET-KEY': options.secretKey});
    } catch (error) {
      if (attempt === 3) throw new Error(`Error de red del calendario Alpaca: ${String(error)}`);
      await pause(1000 * 2 ** attempt);
      continue;
    }
    if (response.status !== 429 && response.status < 500) break;
    if (attempt === 3) throw new Error(`Alpaca calendario respondió ${response.status} tras 4 intentos.`);
    const retryAfter = Number(response.headers.get('retry-after'));
    await pause(Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
  }
  if (!response) throw new Error('No se obtuvo el calendario Alpaca.');
  if (response.status === 401 || response.status === 403) throw new Error(`Alpaca calendario respondió ${response.status}: revise acceso.`);
  if (!response.ok) throw new Error(`Alpaca calendario respondió HTTP ${response.status}.`);
  const body: unknown = await response.json();
  if (!Array.isArray(body) || !body.length) throw new Error('Calendario Alpaca vacío o inválido.');
  const calendar: MarketCalendar = new Map();
  for (const row of body) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) throw new Error('Sesión inválida en calendario Alpaca.');
    const record = row as Record<string, unknown>;
    if (typeof record.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.date) || calendar.has(record.date)) {
      throw new Error('Fecha inválida o duplicada en calendario Alpaca.');
    }
    const open = minutes(record.open), close = minutes(record.close);
    if (open >= close) throw new Error('Cierre anterior a apertura en calendario Alpaca.');
    calendar.set(record.date, {open, close});
  }
  return calendar;
}
