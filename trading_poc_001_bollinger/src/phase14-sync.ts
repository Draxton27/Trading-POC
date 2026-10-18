import type {Candle} from './domain.ts';
import type {MarketCalendar} from './alpaca-calendar.ts';
import {newYorkBarParts} from './strategy-validation.ts';
import {localEasternToUtc, type VerifiedEvent} from './phase14-events.ts';

export type SymbolName = 'NVDA' | 'QQQ' | 'SMH';
export const SYMBOLS: SymbolName[] = ['NVDA', 'QQQ', 'SMH'];
export type MarketFeatures = {
  bar: Candle | null; availableAtUtc: string | null;
  candleReturnPercent: number | null; fourBarReturnPercent: number | null;
  sessionReturnPercent: number | null; relativeVolume: number | null;
  distancePreviousClosePercent: number | null;
  fourStartUtc: string | null; sessionOpenUtc: string | null;
  previousCloseUtc: string | null; volumeReferenceLastDate: string | null;
  volumeReferenceCount: number;
};
export type SynchronizedRow = {
  timestampUtc: string; endUtc: string; dateNy: string; slotNy: string;
  hourBlock: number; symbols: Record<SymbolName, MarketFeatures>;
  completeThree: boolean; availableAtUtc: string;
  nvdaMinusQqqCandlePercent: number | null; nvdaMinusSmhCandlePercent: number | null;
  nvdaMinusQqqFourPercent: number | null; nvdaMinusSmhFourPercent: number | null;
  directionAgreement: 'all_bullish' | 'all_bearish' | 'two_bullish' |
    'two_bearish' | 'mixed_with_zero' | 'all_flat' | 'insufficient';
  knownEventIds: string[]; minutesSinceEvents: Record<string, number>;
  dateOnlyEventIds: string[]; eventBeforeOpen: boolean;
  eventDuringSession: boolean; postEarningsFromPriorClose: boolean;
};
export type SyncAudit = {scheduled: number; completeThree: number;
  present: Record<SymbolName, number>; missing: Record<SymbolName, number>;
  completeSessions: Record<SymbolName, number>;
  partialSessions: Record<SymbolName, number>;
  absentSessions: Record<SymbolName, number>;
  missingByYear: Record<string, Record<SymbolName, number>>;
  eventDays: number; dateOnlyEventDays: number; simultaneousEventDays: number};
export type SynchronizedMarket = {rows: SynchronizedRow[]; audit: SyncAudit};

function percent(numerator: number, denominator: number): number {
  return 100 * (numerator / denominator - 1);
}
const diff = (a: number | null, b: number | null): number | null =>
  a !== null && b !== null ? a - b : null;
function agreement(values: (number | null)[]): SynchronizedRow['directionAgreement'] {
  if (values.some(item => item === null)) return 'insufficient';
  const positive = values.filter(item => item! > 0).length;
  const negative = values.filter(item => item! < 0).length;
  if (positive === 3) return 'all_bullish';
  if (negative === 3) return 'all_bearish';
  if (positive === 2 && negative === 1) return 'two_bullish';
  if (negative === 2 && positive === 1) return 'two_bearish';
  if (!positive && !negative) return 'all_flat';
  return 'mixed_with_zero';
}
function block(slot: string): number {
  const [hour, minute] = slot.split(':').map(Number);
  return Math.floor((hour! * 60 + minute! - 570) / 60);
}

export function buildPhase14Synchronized(candles: Record<SymbolName, readonly Candle[]>,
  calendar: MarketCalendar, economic: readonly VerifiedEvent[],
  corporate: readonly VerifiedEvent[]): SynchronizedMarket {
  const dates = [...calendar.keys()].sort();
  if (!dates.length) throw new Error('Calendario de mercado vacío.');
  const maps = Object.fromEntries(SYMBOLS.map(symbol => [symbol,
    new Map(candles[symbol].map(bar => [bar.timestamp, bar]))])) as
      Record<SymbolName, Map<string, Candle>>;
  for (const symbol of SYMBOLS) {
    if (maps[symbol].size !== candles[symbol].length) throw new Error(`Duplicados ${symbol}.`);
  }
  const schedule = new Map<string, {times: string[]; openUtc: string; closeUtc: string}>();
  const allScheduled = new Set<string>();
  for (const date of dates) {
    const session = calendar.get(date)!;
    const times: string[] = [];
    for (let minute = session.open; minute < session.close; minute += 15) {
      const slot = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      const timestamp = localEasternToUtc(date, slot);
      if (!timestamp || allScheduled.has(timestamp)) throw new Error(`Intervalo programado inválido: ${date} ${slot}`);
      times.push(timestamp); allScheduled.add(timestamp);
    }
    schedule.set(date, {times, openUtc: times[0]!,
      closeUtc: new Date(Date.parse(times.at(-1)!) + 900_000).toISOString()});
  }
  for (const symbol of SYMBOLS) {
    for (const bar of candles[symbol]) {
      if (!allScheduled.has(bar.timestamp)) throw new Error(`Vela ${symbol} fuera de calendario: ${bar.timestamp}`);
    }
  }
  const complete = Object.fromEntries(SYMBOLS.map(symbol => [symbol,
    new Set(dates.filter(date => schedule.get(date)!.times.every(time => maps[symbol].has(time))))])) as
      Record<SymbolName, Set<string>>;
  const events = [...economic, ...corporate];
  if (new Set(events.map(item => item.id)).size !== events.length) throw new Error('Eventos con ID duplicado.');
  const datedEvents = new Map<string, VerifiedEvent[]>();
  for (const event of events) {
    const group = datedEvents.get(event.dateNy) ?? [];
    group.push(event); datedEvents.set(event.dateNy, group);
  }
  const rows: SynchronizedRow[] = [];
  for (const [dateIndex, date] of dates.entries()) {
    const session = schedule.get(date)!;
    const previousDate = dates[dateIndex - 1];
    const referenceDates = dates.slice(Math.max(0, dateIndex - 20), dateIndex);
    const previousEarnings = events.filter(item => item.category === 'NVIDIA_EARNINGS' &&
      item.timestampUtc && item.timestampUtc < session.openUtc &&
      previousDate && item.timestampUtc >= schedule.get(previousDate)!.closeUtc);
    for (const [slotIndex, timestampUtc] of session.times.entries()) {
      const endUtc = new Date(Date.parse(timestampUtc) + 900_000).toISOString();
      const {slot} = newYorkBarParts(timestampUtc);
      const symbols = {} as Record<SymbolName, MarketFeatures>;
      for (const symbol of SYMBOLS) {
        const bar = maps[symbol].get(timestampUtc) ?? null;
        const earlier = session.times.slice(0, slotIndex + 1);
        const allSinceOpen = earlier.every(time => maps[symbol].has(time));
        const four = slotIndex >= 3 ? session.times.slice(slotIndex - 3, slotIndex + 1) : [];
        const fourComplete = four.length === 4 && four.every(time => maps[symbol].has(time));
        const priorEnd = previousDate && complete[symbol].has(previousDate) ?
          schedule.get(previousDate)!.times.at(-1)! : null;
        const previousClose = priorEnd ? maps[symbol].get(priorEnd)!.close : null;
        const referenceTimes = referenceDates.length === 20 ? referenceDates.map(prior =>
          schedule.get(prior)!.times[slotIndex] ?? null) : [];
        const volumeValid = referenceTimes.length === 20 && referenceDates.every(prior =>
          complete[symbol].has(prior)) && referenceTimes.every(time => time && maps[symbol].has(time));
        const referenceVolume = volumeValid ? referenceTimes.reduce((sum, time) =>
          sum + maps[symbol].get(time!)!.volume, 0) / 20 : null;
        const first = maps[symbol].get(session.times[0]!) ?? null;
        const fourFirst = fourComplete ? maps[symbol].get(four[0]!)! : null;
        symbols[symbol] = {
          bar, availableAtUtc: bar ? endUtc : null,
          candleReturnPercent: bar ? percent(bar.close, bar.open) : null,
          fourBarReturnPercent: bar && fourFirst ? percent(bar.close, fourFirst.open) : null,
          sessionReturnPercent: bar && first && allSinceOpen ? percent(bar.close, first.open) : null,
          relativeVolume: bar && referenceVolume !== null && referenceVolume > 0 ?
            bar.volume / referenceVolume - 1 : null,
          distancePreviousClosePercent: bar && previousClose !== null ?
            percent(bar.close, previousClose) : null,
          fourStartUtc: fourFirst ? four[0]! : null,
          sessionOpenUtc: first && allSinceOpen ? session.openUtc : null,
          previousCloseUtc: priorEnd,
          volumeReferenceLastDate: volumeValid ? referenceDates.at(-1)! : null,
          volumeReferenceCount: volumeValid ? 20 : 0,
        };
      }
      const known = (datedEvents.get(date) ?? []).filter(item =>
        item.timestampUtc && item.timestampUtc < endUtc);
      const available = [...known, ...previousEarnings];
      const minutesSinceEvents = Object.fromEntries(available.map(item =>
        [item.id, (Date.parse(endUtc) - Date.parse(item.timestampUtc!)) / 60_000]));
      const returns = SYMBOLS.map(symbol => symbols[symbol].candleReturnPercent);
      rows.push({timestampUtc, endUtc, dateNy: date, slotNy: slot, hourBlock: block(slot),
        symbols, completeThree: SYMBOLS.every(symbol => symbols[symbol].bar !== null),
        availableAtUtc: endUtc,
        nvdaMinusQqqCandlePercent: diff(returns[0]!, returns[1]!),
        nvdaMinusSmhCandlePercent: diff(returns[0]!, returns[2]!),
        nvdaMinusQqqFourPercent: diff(symbols.NVDA.fourBarReturnPercent,
          symbols.QQQ.fourBarReturnPercent),
        nvdaMinusSmhFourPercent: diff(symbols.NVDA.fourBarReturnPercent,
          symbols.SMH.fourBarReturnPercent), directionAgreement: agreement(returns),
        knownEventIds: available.map(item => item.id), minutesSinceEvents,
        dateOnlyEventIds: (datedEvents.get(date) ?? []).filter(item => !item.timestampUtc)
          .map(item => item.id),
        eventBeforeOpen: known.some(item => Date.parse(item.timestampUtc!) < Date.parse(session.openUtc)),
        eventDuringSession: known.some(item => Date.parse(item.timestampUtc!) >= Date.parse(session.openUtc)),
        postEarningsFromPriorClose: previousEarnings.length > 0});
    }
  }
  const present = Object.fromEntries(SYMBOLS.map(symbol => [symbol, candles[symbol].length])) as
    Record<SymbolName, number>;
  const missing = Object.fromEntries(SYMBOLS.map(symbol => [symbol, rows.length - present[symbol]])) as
    Record<SymbolName, number>;
  const countSessions = (symbol: SymbolName) => ({
    complete: complete[symbol].size,
    absent: dates.filter(date => schedule.get(date)!.times.every(time => !maps[symbol].has(time))).length,
  });
  const sessionCounts = Object.fromEntries(SYMBOLS.map(symbol => [symbol, countSessions(symbol)])) as
    Record<SymbolName, {complete: number; absent: number}>;
  const byYear: SyncAudit['missingByYear'] = {};
  for (const row of rows) {
    const year = row.dateNy.slice(0, 4);
    byYear[year] ??= {NVDA: 0, QQQ: 0, SMH: 0};
    for (const symbol of SYMBOLS) if (!row.symbols[symbol].bar) byYear[year]![symbol]++;
  }
  return {rows, audit: {scheduled: rows.length,
    completeThree: rows.filter(row => row.completeThree).length, present, missing,
    completeSessions: Object.fromEntries(SYMBOLS.map(symbol =>
      [symbol, sessionCounts[symbol].complete])) as Record<SymbolName, number>,
    partialSessions: Object.fromEntries(SYMBOLS.map(symbol =>
      [symbol, dates.length - sessionCounts[symbol].complete - sessionCounts[symbol].absent])) as
        Record<SymbolName, number>,
    absentSessions: Object.fromEntries(SYMBOLS.map(symbol =>
      [symbol, sessionCounts[symbol].absent])) as Record<SymbolName, number>,
    missingByYear: byYear,
    eventDays: dates.filter(date => (datedEvents.get(date) ?? []).some(item => item.timestampUtc)).length,
    dateOnlyEventDays: dates.filter(date => (datedEvents.get(date) ?? []).some(item => !item.timestampUtc)).length,
    simultaneousEventDays: dates.filter(date => (datedEvents.get(date) ?? []).length > 1).length}};
}
