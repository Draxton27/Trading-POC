import type {Candle} from './domain.ts';
import type {MarketCalendar} from './alpaca-calendar.ts';
import {newYorkBarParts} from './strategy-validation.ts';
import {calculateVolumeReferences, VOLUME_LOOKBACK_SESSIONS} from './volume-filter.ts';
import {studyNvdaOpening, type OpeningDirection, type OpeningSegment} from './nvda-opening-study.ts';
import {wilson95} from './evaluate.ts';

const FIRST_BAR_MS = 15 * 60_000;
export type RvolBand = 'todas' | 'bajo' | 'medio' | 'alto';
export type VolumeAvailability = 'disponible' | 'menos_de_20_sesiones' |
  'falta_apertura_previa' | 'promedio_cero';

export type OpeningVolumeDay = {
  date: string;
  segment: Exclude<OpeningSegment, 'total'>;
  openingTimestamp: string;
  volumeAvailableAt: string;
  openingVolume: number;
  historicalAverage: number | null;
  priorSessions: number;
  matchingSessions: number;
  volumeAvailability: VolumeAvailability;
  rvol: number | null;
  rvolBand: Exclude<RvolBand, 'todas'> | null;
  direction: OpeningDirection | 'dentro';
  first15Evaluable: boolean | null;
  rangeReturned15: boolean | null;
  closeConfirmed15: boolean | null;
};

export type OpeningVolumeRow = {
  segment: OpeningSegment;
  band: RvolBand;
  openingDays: number;
  outsideAbove: number;
  outsideBelow: number;
  outsideTotal: number;
  outsideRate: number | null;
  outsideWilson95: [number, number] | null;
  meanOpeningVolume: number | null;
  meanHistoricalAverage: number | null;
  meanRvol: number | null;
  smallSample: boolean;
};

export type ReturnVolumeRow = {
  segment: OpeningSegment;
  band: RvolBand;
  direction: OpeningDirection;
  openings: number;
  evaluable: number;
  rangeReturns: number;
  rangeRate: number | null;
  rangeWilson95: [number, number] | null;
  closeReturns: number;
  closeRate: number | null;
  closeWilson95: [number, number] | null;
  smallSample: boolean;
};

export type OpeningVolumeStudy = {
  candles: number;
  calendarSessions: number;
  evaluatedOpeningDays: number;
  splitDate: string;
  lookbackSessions: 20;
  exploratoryRvolCutpoints: {lower: number | null; upper: number | null; sample: number};
  days: OpeningVolumeDay[];
  openingRows: OpeningVolumeRow[];
  returnRows: ReturnVolumeRow[];
};

const mean = (values: readonly number[]): number | null => values.length ?
  values.reduce((sum, value) => sum + value, 0) / values.length : null;
const selected = (day: OpeningVolumeDay, segment: OpeningSegment, band: RvolBand): boolean =>
  (segment === 'total' || day.segment === segment) &&
  (band === 'todas' || day.rvolBand === band);

function summarizeOpenings(days: readonly OpeningVolumeDay[], segment: OpeningSegment,
  band: RvolBand): OpeningVolumeRow {
  const group = days.filter(day => selected(day, segment, band));
  const outsideAbove = group.filter(day => day.direction === 'encima').length;
  const outsideBelow = group.filter(day => day.direction === 'debajo').length;
  const outsideTotal = outsideAbove + outsideBelow;
  return {segment, band, openingDays: group.length, outsideAbove, outsideBelow, outsideTotal,
    outsideRate: group.length ? outsideTotal / group.length : null,
    outsideWilson95: wilson95(outsideTotal, group.length),
    meanOpeningVolume: mean(group.map(day => day.openingVolume)),
    meanHistoricalAverage: mean(group.flatMap(day => day.historicalAverage === null ? [] : [day.historicalAverage])),
    meanRvol: mean(group.flatMap(day => day.rvol === null ? [] : [day.rvol])),
    smallSample: group.length < 30};
}

function summarizeReturns(days: readonly OpeningVolumeDay[], segment: OpeningSegment,
  band: RvolBand, direction: OpeningDirection): ReturnVolumeRow {
  const group = days.filter(day => selected(day, segment, band) && day.direction === direction);
  const evaluable = group.filter(day => day.first15Evaluable);
  const rangeReturns = evaluable.filter(day => day.rangeReturned15).length;
  const closeReturns = evaluable.filter(day => day.closeConfirmed15).length;
  return {segment, band, direction, openings: group.length, evaluable: evaluable.length,
    rangeReturns, rangeRate: evaluable.length ? rangeReturns / evaluable.length : null,
    rangeWilson95: wilson95(rangeReturns, evaluable.length),
    closeReturns, closeRate: evaluable.length ? closeReturns / evaluable.length : null,
    closeWilson95: wilson95(closeReturns, evaluable.length),
    smallSample: evaluable.length < 30};
}

/** RVOL is retrospective at 09:45; it cannot explain a decision available at 09:30. */
export function studyNvdaOpeningVolume(candles: readonly Candle[], calendar: MarketCalendar): OpeningVolumeStudy {
  const openingStudy = studyNvdaOpening(candles, calendar);
  const references = calculateVolumeReferences(candles);
  const firstByDay = new Map<string, number>();
  for (const [index, candle] of candles.entries()) {
    const day = newYorkBarParts(candle.timestamp).day;
    if (!firstByDay.has(day)) firstByDay.set(day, index);
  }
  const eventByDay = new Map(openingStudy.events.map(event => [event.date, event]));
  const days: OpeningVolumeDay[] = [];
  for (const session of openingStudy.sessions.filter(item => item.status === 'evaluada')) {
    const index = firstByDay.get(session.date);
    if (index === undefined || newYorkBarParts(candles[index]!.timestamp).slot !== '09:30') {
      throw new Error(`Apertura evaluada sin vela de 09:30: ${session.date}.`);
    }
    const candle = candles[index]!;
    const reference = references[index]!;
    const historicalAverage = reference.average;
    const volumeAvailability: VolumeAvailability = reference.priorSessions < VOLUME_LOOKBACK_SESSIONS ?
      'menos_de_20_sesiones' : historicalAverage === null ? 'falta_apertura_previa' :
      historicalAverage === 0 ? 'promedio_cero' : 'disponible';
    const rvol = volumeAvailability === 'disponible' ? candle.volume / historicalAverage! : null;
    const event = eventByDay.get(session.date);
    days.push({date: session.date, segment: session.segment, openingTimestamp: candle.timestamp,
      volumeAvailableAt: new Date(Date.parse(candle.timestamp) + FIRST_BAR_MS).toISOString(),
      openingVolume: candle.volume, historicalAverage, priorSessions: reference.priorSessions,
      matchingSessions: reference.matchingSessions, volumeAvailability, rvol, rvolBand: null,
      direction: event?.direction ?? 'dentro', first15Evaluable: event?.outcomes['15'].evaluable ?? null,
      rangeReturned15: event?.outcomes['15'].rangeReturned ?? null,
      closeConfirmed15: event?.outcomes['15'].closeConfirmed ?? null});
  }
  // Terciles are display-only and learned from opening volumes in the first 70%.
  // No outcome or evaluation-period volume is used to define their boundaries.
  const exploration = days.filter(day => day.segment === 'exploracion' && day.rvol !== null)
    .map(day => day.rvol!).sort((a, b) => a - b);
  const lower = exploration.length >= 3 ? exploration[Math.floor(exploration.length / 3)]! : null;
  const upper = exploration.length >= 3 ? exploration[Math.floor(2 * exploration.length / 3)]! : null;
  if (lower !== null && upper !== null) {
    for (const day of days) {
      if (day.rvol !== null) day.rvolBand = day.rvol < lower ? 'bajo' :
        day.rvol < upper ? 'medio' : 'alto';
    }
  }
  const openingRows: OpeningVolumeRow[] = [];
  const returnRows: ReturnVolumeRow[] = [];
  for (const segment of ['total', 'exploracion', 'evaluacion'] as const) {
    for (const band of ['todas', 'bajo', 'medio', 'alto'] as const) {
      openingRows.push(summarizeOpenings(days, segment, band));
      for (const direction of ['encima', 'debajo'] as const) {
        returnRows.push(summarizeReturns(days, segment, band, direction));
      }
    }
  }
  return {candles: candles.length, calendarSessions: openingStudy.calendarSessions,
    evaluatedOpeningDays: days.length, splitDate: openingStudy.splitDate,
    lookbackSessions: 20, exploratoryRvolCutpoints: {lower, upper, sample: exploration.length},
    days, openingRows, returnRows};
}
