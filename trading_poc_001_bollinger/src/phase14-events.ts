import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

export type EventCategory = 'CPI' | 'EMPLOYMENT_SITUATION' | 'FOMC' | 'NVIDIA_EARNINGS';
export type VerifiedEvent = {
  id: string; category: EventCategory; subtype: string; dateNy: string;
  timeNy: string | null; timeZone: 'America/New_York'; timestampUtc: string | null;
  sourceUrl: string; timeSourceUrl: string | null;
  verification: 'verified_time' | 'date_without_time';
  availableAtUtc: string | null; notes: string; consensus: number | null;
  releasedValue: number | null; surprise: number | null;
};
export type SourceRecord = {url: string; publisher: string; retrievedAtUtc: string;
  consultedAtUtc: string; sha256: string | null; status: number; licenseNote: string};
export type AcquiredEvents = {economic: VerifiedEvent[]; corporate: VerifiedEvent[];
  sources: SourceRecord[]; missingCorporatePages: string[]};
const START = '2021-10-17', END = '2026-10-17';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const strip = (html: string): string => html.replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&')
  .replace(/\s+/g, ' ').trim();
function parseEnglishDate(value: string): string | null {
  const matched = value.match(/(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+)?([A-Z][a-z]+\s+\d{1,2},\s+20\d{2})/);
  if (!matched) return null;
  const date = new Date(matched[1]! + ' 12:00:00 GMT');
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}
function inRange(date: string): boolean {return date >= START && date <= END;}
const formatter = new Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  hourCycle: 'h23'});
export function localEasternToUtc(dateNy: string, timeNy: string): string | null {
  const candidates: string[] = [];
  for (const offset of ['-04:00', '-05:00']) {
    const instant = new Date(`${dateNy}T${timeNy}:00${offset}`);
    if (!Number.isFinite(instant.getTime())) continue;
    const parts = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]));
    if (`${parts.year}-${parts.month}-${parts.day}` === dateNy &&
        `${parts.hour}:${parts.minute}` === timeNy) candidates.push(instant.toISOString());
  }
  return candidates.length === 1 ? candidates[0]! : null;
}
function clock12(value: string): string | null {
  const match = value.match(/\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)(?!\w)/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  if (/^p/i.test(match[3]!) && hour !== 12) hour += 12;
  if (/^a/i.test(match[3]!) && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
function record(category: EventCategory, subtype: string, dateNy: string,
  timeNy: string | null, sourceUrl: string, notes: string,
  timeSourceUrl = sourceUrl): VerifiedEvent {
  const timestampUtc = timeNy ? localEasternToUtc(dateNy, timeNy) : null;
  const finalTime = timestampUtc ? timeNy : null;
  return {id: `${category}:${subtype}:${dateNy}`.replaceAll(' ', '_'), category, subtype,
    dateNy, timeNy: finalTime, timeZone: 'America/New_York', timestampUtc,
    sourceUrl, timeSourceUrl: timestampUtc ? timeSourceUrl : null,
    verification: timestampUtc ? 'verified_time' : 'date_without_time',
    availableAtUtc: timestampUtc, notes: timestampUtc ? notes :
      `${notes}; hora exacta de publicación sin verificar`,
    consensus: null, releasedValue: null, surprise: null};
}

export function parseBlsSchedule(html: string, year: number, url: string): VerifiedEvent[] {
  if (!html.includes('All times on calendar are Eastern Time')) {
    throw new Error(`BLS ${year}: no se verificó la zona horaria del calendario.`);
  }
  const events: VerifiedEvent[] = [];
  for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = match[1]!;
    const dateText = strip(row.match(/<td[^>]*class="date-cell"[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? '');
    const timeText = strip(row.match(/<td[^>]*class="time-cell"[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? '');
    const description = strip(row.match(/<td[^>]*class="desc-cell"[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? '');
    const category: EventCategory | null = /^Consumer Price Index\s+for\b/i.test(description) ? 'CPI' :
      /^Employment Situation\s+for\b/i.test(description) ? 'EMPLOYMENT_SITUATION' : null;
    if (!category) continue;
    const dateNy = parseEnglishDate(dateText);
    if (!dateNy || dateNy.slice(0, 4) !== String(year)) throw new Error(`BLS ${year}: fecha inválida.`);
    if (!inRange(dateNy)) continue;
    events.push(record(category, 'release', dateNy, clock12(timeText), url,
      `BLS: ${description}; horario del calendario oficial en Eastern Time`));
  }
  return events;
}

export function parseFedStatement(html: string, dateNy: string, url: string): VerifiedEvent {
  const release = strip(html.match(/class="releaseTime"[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? '');
  const explicitZone = /\b(EST|EDT)\b/.exec(release)?.[1] ?? null;
  const timeNy = /For release at/i.test(release) && explicitZone ? clock12(release) : null;
  const event = record('FOMC', 'statement', dateNy, timeNy, url,
    `Comunicado original; ${release || 'sin hora de publicación verificable'}`);
  if (event.timestampUtc && explicitZone) {
    const inferred = new Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York',
      timeZoneName: 'short'}).formatToParts(new Date(event.timestampUtc))
      .find(part => part.type === 'timeZoneName')?.value;
    if (inferred !== explicitZone) throw new Error(`Zona FOMC inconsistente: ${url}`);
  }
  return event;
}

export function parseFedCalendar(html: string): {statement: {date: string; url: string}[];
  conference: {date: string; url: string}[];
  minutes: {meetingDate: string; releaseDate: string | null; url: string}[]} {
  const base = 'https://www.federalreserve.gov';
  const unique = (regex: RegExp) => [...new Map([...html.matchAll(regex)].map(match =>
    [match[1]!, {date: `${match[2]!.slice(0, 4)}-${match[2]!.slice(4, 6)}-${match[2]!.slice(6)}`,
      url: base + match[1]!}])).values()].filter(item => inRange(item.date));
  const statement = unique(/href="(\/newsevents\/pressreleases\/monetary(20\d{6})a\.htm)"/g);
  const conference = unique(/href="(\/monetarypolicy\/fomcpresconf(20\d{6})\.htm)"/g);
  const minutes = [...html.matchAll(/href="(\/monetarypolicy\/fomcminutes(20\d{6})\.htm)"/g)]
    .map(match => {
      const meetingDate = `${match[2]!.slice(0, 4)}-${match[2]!.slice(4, 6)}-${match[2]!.slice(6)}`;
      const nearby = strip(html.slice(match.index! + match[0].length, match.index! + match[0].length + 300));
      const releaseDate = parseEnglishDate(nearby.match(/Released ([A-Za-z]+ \d{1,2}, 20\d{2})/)?.[1] ?? '');
      return {meetingDate, releaseDate, url: base + match[1]!};
    }).filter(item => item.releaseDate && inRange(item.releaseDate));
  return {statement, conference, minutes: [...new Map(minutes.map(item =>
    [item.meetingDate, item])).values()]};
}

export function parseFedConferenceMinutesTime(html: string, releaseDate: string): string | null {
  const plain = strip(html);
  const english = new Date(`${releaseDate}T12:00:00Z`).toLocaleDateString('en-US',
    {month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC'});
  const match = plain.match(new RegExp(`Released ${english.replaceAll(' ', '\\s+')} at (\\d{1,2}:\\d{2}\\s*[ap]\\.m\\.)`, 'i'));
  return match ? clock12(match[1]!) : null;
}

export function parseNvidiaEarnings(html: string, url: string): VerifiedEvent | null {
  const match = html.match(/PublishDate','View','([^']+)'/);
  const dateNy = match ? parseEnglishDate(match[1]!) : null;
  if (!dateNy || !inRange(dateNy) || !/NVIDIA Announces Financial Results/i.test(html)) return null;
  const title = strip(html.match(/<meta property="og:title" content="([^"]+)"/i)?.[1] ?? '');
  return record('NVIDIA_EARNINGS', 'earnings_release', dateNy, null, url,
    `Anuncio original NVIDIA Newsroom: ${title}; fecha verificada, hora no publicada en la página`);
}

export async function acquirePhase14Events(cacheDirectory: string,
  get?: (url: string) => Promise<{status: number; body: string}>): Promise<AcquiredEvents> {
  mkdirSync(cacheDirectory, {recursive: true});
  const retrievedAtUtc = new Date().toISOString();
  const sources: SourceRecord[] = [];
  const request = get ?? (async (url: string) => {
    const response = await fetch(url, {signal: AbortSignal.timeout(30_000)});
    return {status: response.status, body: response.ok ? await response.text() : ''};
  });
  async function page(url: string, publisher: string, required = true): Promise<string | null> {
    const path = join(cacheDirectory, digest(url) + '.html');
    let status = 200, body: string;
    if (existsSync(path)) body = readFileSync(path, 'utf8');
    else {
      const response = await request(url);
      status = response.status; body = response.body;
      if (status === 200) writeFileSync(path, body, {flag: 'wx'});
    }
    sources.push({url, publisher, retrievedAtUtc: status === 200 ?
      statSync(path).mtime.toISOString() : retrievedAtUtc, consultedAtUtc: retrievedAtUtc,
      sha256: status === 200 ? digest(body) : null,
      status, licenseNote: publisher === 'BLS' || publisher === 'Federal Reserve' ?
        'Fuente gubernamental pública; solo metadatos de calendario derivados' :
        'Página pública NVIDIA; solo metadatos de fecha/tipo y URL'});
    if (status !== 200) {
      if (required) throw new Error(`Fuente oficial HTTP ${status}: ${url}`);
      return null;
    }
    return body;
  }
  const economic: VerifiedEvent[] = [], corporate: VerifiedEvent[] = [];
  for (let year = 2021; year <= 2026; year++) {
    const url = `https://www.bls.gov/schedule/${year}/home.htm`;
    economic.push(...parseBlsSchedule((await page(url, 'BLS'))!, year, url));
  }
  const fedUrl = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm';
  const fed = parseFedCalendar((await page(fedUrl, 'Federal Reserve'))!);
  for (const item of fed.statement) {
    economic.push(parseFedStatement((await page(item.url, 'Federal Reserve'))!, item.date, item.url));
  }
  const conferencePages = new Map<string, string>();
  for (const item of fed.conference) {
    const body = (await page(item.url, 'Federal Reserve'))!;
    conferencePages.set(item.date, body);
    economic.push(record('FOMC', 'press_conference', item.date, null, item.url,
      'Conferencia vinculada al calendario oficial; hora exacta de inicio no verificada'));
  }
  for (const item of fed.minutes) {
    const date = item.releaseDate!;
    const body = conferencePages.get(item.meetingDate);
    const time = body ? parseFedConferenceMinutesTime(body, date) : null;
    const timeSourceUrl = time ? fed.conference.find(entry => entry.date === item.meetingDate)?.url : undefined;
    economic.push(record('FOMC', 'minutes', date, time, item.url,
      `Actas de reunión ${item.meetingDate}; fecha de publicación del calendario Federal Reserve`,
      timeSourceUrl));
  }
  const quarters = ['first', 'second', 'third', 'fourth'];
  const missingCorporatePages: string[] = [];
  for (let fiscal = 2022; fiscal <= 2027; fiscal++) {
    for (const quarter of quarters) {
      if (fiscal === 2022 && (quarter === 'first' || quarter === 'second') ||
          fiscal === 2027 && (quarter === 'third' || quarter === 'fourth')) continue;
      const slug = quarter === 'fourth' ?
        `fourth-quarter-and-fiscal-${fiscal}` : `${quarter}-quarter-fiscal-${fiscal}`;
      const url = `https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-${slug}`;
      const body = await page(url, 'NVIDIA Newsroom', false);
      if (body === null) {missingCorporatePages.push(url); continue;}
      const event = parseNvidiaEarnings(body, url);
      if (event) corporate.push(event);
    }
  }
  const unique = (rows: VerifiedEvent[]) => {
    const map = new Map<string, VerifiedEvent>();
    for (const row of rows) {
      if (map.has(row.id)) throw new Error(`Evento duplicado: ${row.id}`);
      map.set(row.id, row);
    }
    return [...map.values()].sort((a, b) =>
      a.dateNy.localeCompare(b.dateNy) || a.category.localeCompare(b.category) ||
      a.subtype.localeCompare(b.subtype));
  };
  return {economic: unique(economic), corporate: unique(corporate), sources, missingCorporatePages};
}
