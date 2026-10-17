import {readFileSync, writeFileSync} from 'node:fs';

export type DataMetadata = {
  asset: string;
  provider: string;
  bar_minutes: 5 | 15;
  data_class: 'synthetic' | 'real';
  session: 'regular' | 'extended';
  exchange_timezone: 'America/New_York';
  feed?: 'sip';
  adjustment?: 'split';
};

const BAR_MS = 300_000;
const timestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;
const exchangeClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
});

/** CSV timestamps identify bar starts. An explicit ISO offset is mandatory. */
export function parseBarStart(value: string): number {
  const match = timestampPattern.exec(value);
  if (!match) throw new Error('timestamp debe ser ISO 8601 con Z u offset explícito.');
  const [, y, mo, d, h, mi, s, fraction, zone, sign, oh, om] = match;
  const year = Number(y), month = Number(mo), day = Number(d);
  const hour = Number(h), minute = Number(mi), second = Number(s);
  const millisecond = Number((fraction ?? '').padEnd(3, '0'));
  const offsetHours = Number(oh ?? 0), offsetMinutes = Number(om ?? 0);
  const calendar = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  if (year < 1000 || calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 ||
      calendar.getUTCDate() !== day || calendar.getUTCHours() !== hour ||
      calendar.getUTCMinutes() !== minute || calendar.getUTCSeconds() !== second ||
      offsetHours > 14 || offsetMinutes > 59 || (offsetHours === 14 && offsetMinutes !== 0)) {
    throw new Error('timestamp contiene una fecha, hora u offset inválido.');
  }
  const offset = zone === 'Z' ? 0 : (sign === '+' ? 1 : -1) * (offsetHours * 60 + offsetMinutes);
  const instant = calendar.getTime() - offset * 60_000;
  if (!Number.isFinite(instant) || instant % BAR_MS !== 0) {
    throw new Error('timestamp debe coincidir con el inicio de una vela UTC de 5 minutos.');
  }
  return instant;
}

export function barEndTimestamp(startTimestamp: string): string {
  return new Date(parseBarStart(startTimestamp) + BAR_MS).toISOString();
}

export function validateMetadata(value: unknown): DataMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Metadatos inválidos.');
  const data = value as Record<string, unknown>;
  if (typeof data.asset !== 'string' || !data.asset.trim() ||
      typeof data.provider !== 'string' || !data.provider.trim() ||
      (data.bar_minutes !== 5 && data.bar_minutes !== 15) || !['synthetic', 'real'].includes(String(data.data_class)) ||
      !['regular', 'extended'].includes(String(data.session)) ||
      data.exchange_timezone !== 'America/New_York' ||
      (data.feed !== undefined && data.feed !== 'sip') ||
      (data.adjustment !== undefined && data.adjustment !== 'split') ||
      ((data.feed === undefined) !== (data.adjustment === undefined))) {
    throw new Error('Metadatos requieren asset, provider, bar_minutes=5 o 15, data_class, session y exchange_timezone=America/New_York.');
  }
  const metadata: DataMetadata = {
    asset: data.asset.trim(), provider: data.provider.trim(), bar_minutes: data.bar_minutes as 5 | 15,
    data_class: data.data_class as DataMetadata['data_class'],
    session: data.session as DataMetadata['session'], exchange_timezone: 'America/New_York',
  };
  if (data.feed === 'sip' && data.adjustment === 'split') {
    metadata.feed = 'sip';
    metadata.adjustment = 'split';
  }
  return metadata;
}

export function loadMetadata(csvPath: string): DataMetadata {
  const path = `${csvPath}.meta.json`;
  let value: unknown;
  try { value = JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { throw new Error(`No se pudo leer metadatos JSON de ${path}: ${String(error)}`); }
  return validateMetadata(value);
}

export function saveMetadata(csvPath: string, metadata: DataMetadata): void {
  writeFileSync(`${csvPath}.meta.json`, JSON.stringify(validateMetadata(metadata), null, 2) + '\n');
}

function exchangeParts(instant: number) {
  const parts = Object.fromEntries(exchangeClock.formatToParts(new Date(instant)).map(p => [p.type, p.value]));
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,
    minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function isBarInSession(instant: number, metadata: DataMetadata): boolean {
  const current = exchangeParts(instant);
  const open = metadata.session === 'regular' ? 9 * 60 + 30 : 4 * 60;
  const close = metadata.session === 'regular' ? 16 * 60 : 20 * 60;
  return current.weekday !== 'Sat' && current.weekday !== 'Sun' &&
    current.minuteOfDay >= open && current.minuteOfDay < close;
}

/** Reject gaps inside the declared market session; allow overnight, holidays and partial days. */
export function validateBarTime(instant: number, previousInstant: number | null, metadata: DataMetadata): void {
  const current = exchangeParts(instant);
  const duration = metadata.bar_minutes * 60_000;
  if (instant % duration !== 0) throw new Error(`Vela no alineada a ${metadata.bar_minutes} minutos UTC.`);
  if (!isBarInSession(instant, metadata)) {
    throw new Error(`Vela fuera de sesión ${metadata.session} en America/New_York.`);
  }
  if (previousInstant !== null && exchangeParts(previousInstant).day === current.day &&
      instant - previousInstant !== duration) {
    throw new Error(`Faltan velas de ${metadata.bar_minutes} minutos dentro de la sesión declarada: ${new Date(previousInstant).toISOString()} a ${new Date(instant).toISOString()}.`);
  }
}
