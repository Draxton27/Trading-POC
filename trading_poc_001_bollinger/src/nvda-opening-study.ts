import type {Candle} from './domain.ts';
import type {MarketCalendar} from './alpaca-calendar.ts';
import {calculateBollinger} from './bollinger.ts';
import {newYorkBarParts} from './strategy-validation.ts';
import {wilson95} from './evaluate.ts';

const BAR_MS = 15 * 60_000;
export const HIGH_VOL_BANDWIDTH = 0.04;
export const OPENING_HORIZONS = ['15', '30', '60', '120', 'sesion'] as const;
export type OpeningHorizon = typeof OPENING_HORIZONS[number];
export type OpeningDirection = 'encima' | 'debajo';
export type OpeningSegment = 'total' | 'exploracion' | 'evaluacion';
export type OpeningGroup = OpeningDirection | 'alta_vol_encima' | 'alta_vol_debajo';
export type ReturnObservation = {
  evaluable: boolean;
  rangeReturned: boolean | null;
  closeConfirmed: boolean | null;
  firstRangeByMinutes: number | null;
  firstCloseByMinutes: number | null;
};
export type OpeningEvent = {
  date: string;
  segment: Exclude<OpeningSegment, 'total'>;
  direction: OpeningDirection;
  open: number;
  middle: number;
  upper: number;
  lower: number;
  bandwidthPercent: number;
  highVolatility: boolean;
  distanceToBandPercent: number;
  sessionComplete: boolean;
  outcomes: Record<OpeningHorizon, ReturnObservation>;
};
export type SessionAudit = {
  date: string;
  segment: Exclude<OpeningSegment, 'total'>;
  status: 'evaluada' | 'sin_apertura_0930' | 'sin_20_previas';
  completeSession: boolean | null;
};
export type OpeningRow = {
  segment: OpeningSegment;
  group: OpeningGroup;
  horizon: OpeningHorizon;
  openings: number;
  evaluable: number;
  rangeReturns: number;
  rangeRate: number | null;
  rangeWilson95: [number, number] | null;
  closeReturns: number;
  closeRate: number | null;
  closeWilson95: [number, number] | null;
  meanFirstRangeByMinutes: number | null;
  meanFirstCloseByMinutes: number | null;
  meanInitialDistancePercent: number | null;
  neverReturned: number | null;
  smallSample: boolean;
};
export type OpeningStudy = {
  candles: number;
  calendarSessions: number;
  splitDate: string;
  highVolBandwidthThresholdPercent: 4;
  sessions: SessionAudit[];
  events: OpeningEvent[];
  rows: OpeningRow[];
};

const mean = (values: number[]): number | null => values.length ?
  values.reduce((sum, value) => sum + value, 0) / values.length : null;
const belongs = (event: OpeningEvent, group: OpeningGroup) =>
  group === event.direction || (group === `alta_vol_${event.direction}` && event.highVolatility);

function observe(bars: readonly Candle[], openTime: number, requiredBars: number,
  lower: number, upper: number): ReturnObservation {
  for (let i = 0; i < requiredBars; i++) {
    if (Date.parse(bars[i]?.timestamp ?? '') !== openTime + i * BAR_MS) {
      return {evaluable: false, rangeReturned: null, closeConfirmed: null,
        firstRangeByMinutes: null, firstCloseByMinutes: null};
    }
  }
  const rangeIndex = bars.slice(0, requiredBars).findIndex(bar =>
    bar.low < upper && bar.high > lower);
  const closeIndex = bars.slice(0, requiredBars).findIndex(bar =>
    lower < bar.close && bar.close < upper);
  return {evaluable: true, rangeReturned: rangeIndex >= 0, closeConfirmed: closeIndex >= 0,
    firstRangeByMinutes: rangeIndex < 0 ? null : (rangeIndex + 1) * 15,
    firstCloseByMinutes: closeIndex < 0 ? null : (closeIndex + 1) * 15};
}

function summarize(events: readonly OpeningEvent[], segment: OpeningSegment,
  group: OpeningGroup, horizon: OpeningHorizon): OpeningRow {
  const selected = events.filter(event =>
    (segment === 'total' || event.segment === segment) && belongs(event, group));
  const evaluated = selected.filter(event => event.outcomes[horizon].evaluable);
  const rangeReturns = evaluated.filter(event => event.outcomes[horizon].rangeReturned).length;
  const closeReturns = evaluated.filter(event => event.outcomes[horizon].closeConfirmed).length;
  const firstRange = evaluated.map(event => event.outcomes[horizon].firstRangeByMinutes)
    .filter((value): value is number => value !== null);
  const firstClose = evaluated.map(event => event.outcomes[horizon].firstCloseByMinutes)
    .filter((value): value is number => value !== null);
  return {segment, group, horizon, openings: selected.length, evaluable: evaluated.length,
    rangeReturns, rangeRate: evaluated.length ? rangeReturns / evaluated.length : null,
    rangeWilson95: wilson95(rangeReturns, evaluated.length),
    closeReturns, closeRate: evaluated.length ? closeReturns / evaluated.length : null,
    closeWilson95: wilson95(closeReturns, evaluated.length),
    meanFirstRangeByMinutes: mean(firstRange), meanFirstCloseByMinutes: mean(firstClose),
    meanInitialDistancePercent: mean(evaluated.map(event => event.distanceToBandPercent)),
    neverReturned: horizon === 'sesion' && evaluated.length ? evaluated.length - rangeReturns : null,
    smallSample: evaluated.length < 30};
}

/** Opening decision reads only completed bars before 09:30; frozen bands judge the rest of the session. */
export function studyNvdaOpening(candles: readonly Candle[], calendar: MarketCalendar): OpeningStudy {
  if (!candles.length) throw new Error('No hay velas NVDA para estudiar.');
  const byDate = new Map<string, {firstIndex: number; bars: Candle[]}>();
  for (const [index, candle] of candles.entries()) {
    const {day} = newYorkBarParts(candle.timestamp);
    if (!calendar.has(day)) throw new Error(`Falta calendario bursátil para ${day}.`);
    if (!byDate.has(day)) byDate.set(day, {firstIndex: index, bars: []});
    byDate.get(day)!.bars.push(candle);
  }
  const firstDate = newYorkBarParts(candles[0]!.timestamp).day;
  const lastDate = newYorkBarParts(candles.at(-1)!.timestamp).day;
  const dates = [...calendar.keys()].filter(date => date >= firstDate && date <= lastDate).sort();
  if (dates.length < 2) throw new Error('Se requieren al menos dos sesiones para el corte cronológico.');
  const splitDate = dates[Math.floor(dates.length * 0.7)]!;
  const sessions: SessionAudit[] = [];
  const events: OpeningEvent[] = [];
  for (const date of dates) {
    const schedule = calendar.get(date)!;
    const segment = date < splitDate ? 'exploracion' : 'evaluacion';
    const observed = byDate.get(date);
    const first = observed?.bars[0];
    if (schedule.open !== 570 || !first || newYorkBarParts(first.timestamp).slot !== '09:30') {
      sessions.push({date, segment, status: 'sin_apertura_0930', completeSession: null});
      continue;
    }
    const expectedBars = (schedule.close - schedule.open) / 15;
    if (!Number.isInteger(expectedBars) || expectedBars < 1) {
      throw new Error(`Horario de calendario incompatible con velas de 15 minutos: ${date}.`);
    }
    const openTime = Date.parse(first.timestamp);
    const completeSession = observed!.bars.length === expectedBars &&
      observed!.bars.every((bar, index) => Date.parse(bar.timestamp) === openTime + index * BAR_MS);
    const firstIndex = observed!.firstIndex;
    if (firstIndex < 20 || Date.parse(candles[firstIndex - 1]!.timestamp) + BAR_MS > openTime) {
      sessions.push({date, segment, status: 'sin_20_previas', completeSession});
      continue;
    }
    sessions.push({date, segment, status: 'evaluada', completeSession});
    const point = calculateBollinger(candles.slice(firstIndex - 20, firstIndex), 20, 2).at(-1)!;
    const {upper, lower, middle, bandwidth} = point;
    if (upper === null || lower === null || middle === null || bandwidth === null) {
      throw new Error('No se pudieron calcular las bandas previas a la apertura.');
    }
    const open = first.open;
    const direction = open > upper ? 'encima' : open < lower ? 'debajo' : null;
    if (direction === null) continue;
    const band = direction === 'encima' ? upper : lower;
    const outcomes = {} as Record<OpeningHorizon, ReturnObservation>;
    for (const horizon of OPENING_HORIZONS) {
      const requiredBars = horizon === 'sesion' ? expectedBars : Number(horizon) / 15;
      outcomes[horizon] = requiredBars <= expectedBars ?
        observe(observed!.bars, openTime, requiredBars, lower, upper) :
        {evaluable: false, rangeReturned: null, closeConfirmed: null,
          firstRangeByMinutes: null, firstCloseByMinutes: null};
    }
    events.push({date, segment, direction, open, middle, upper, lower,
      bandwidthPercent: bandwidth * 100, highVolatility: bandwidth >= HIGH_VOL_BANDWIDTH,
      distanceToBandPercent: Math.abs(open - band) / band * 100,
      sessionComplete: completeSession, outcomes});
  }
  const rows: OpeningRow[] = [];
  for (const segment of ['total', 'exploracion', 'evaluacion'] as const) {
    for (const group of ['encima', 'debajo', 'alta_vol_encima', 'alta_vol_debajo'] as const) {
      for (const horizon of OPENING_HORIZONS) rows.push(summarize(events, segment, group, horizon));
    }
  }
  return {candles: candles.length, calendarSessions: dates.length, splitDate,
    highVolBandwidthThresholdPercent: 4, sessions, events, rows};
}
