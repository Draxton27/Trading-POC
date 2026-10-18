import type {Candle, Direction} from './domain.ts';
import type {MarketCalendar} from './alpaca-calendar.ts';
import {buildDailyCandles, buildHourlyCandles, calculateSmaPoints, type SmaPoint} from './multitimeframe.ts';
import {auditNvdaCalendar, evaluateNvdaHorizon, type HorizonReason} from './nvda-indicators-study.ts';
import {classifyTrend, type Trend} from './nvda-pullback-breakout.ts';
import {newYorkBarParts} from './strategy-validation.ts';

export type BreakSide = 'high' | 'low';
export type Horizon = '15' | '30' | '60';
export type Scope = 'total' | 'first70' | 'last30' | string;
export type EpisodeStatus = 'confirmed_failed' | 'no_return' | 'observation_incomplete';
export type ObservationReason = 'session_close' | 'missing_observation' | null;
export type Episode = {
  id: string; breakoutIndex: number; side: BreakSide; dateNy: string; priorSessionDate: string;
  priorHigh: number; priorLow: number; breakoutClose: number; breakoutBarStartUtc: string;
  breakoutAvailableAtUtc: string; firstObservationIndex: number | null;
  secondObservationIndex: number | null; firstObservationClose: number | null;
  secondObservationClose: number | null; firstObservationStartUtc: string | null;
  secondObservationStartUtc: string | null; status: EpisodeStatus;
  observationReason: ObservationReason; failureLag: 1 | 2 | null;
  confirmationIndex: number | null; confirmationAvailableAtUtc: string | null;
  year: string; timeBucket: number; segment: 'first70' | 'last30';
};
export type Outcome = {
  value: number | null; reason: HorizonReason | null; entryUtc: string | null;
  exitUtc: string | null; entryPrice: number | null; exitPrice: number | null;
  mfePercent: number | null; maePercent: number | null;
};
export type ControlMatch = {meanPercent: number | null; observations: number; sessions: number;
  reason: 'insufficient_controls' | 'horizon_incomplete' | null};
export type SmaContext = {trend: Trend; dayClose: number | null; daySma20: number | null;
  hourClose: number | null; hourSma100: number | null};
export type FailedBreakoutSignal = {
  episodeId: string; side: BreakSide; direction: 'bearish' | 'bullish';
  dateNy: string; confirmationIndex: number; confirmationBarStartUtc: string;
  availableAtUtc: string; confirmationClose: number; failureLag: 1 | 2;
  segment: 'first70' | 'last30'; priorHigh: number; priorLow: number;
  sma: SmaContext; repeatedWithinFourBars: boolean;
  overlappingPrimaryOutcome: boolean; dedupRetained: boolean;
  horizons: Record<Horizon, Outcome>; controls: Record<Horizon, ControlMatch>;
};
export type Movement = {count: number; favorableRate: number | null;
  meanSignedPercent: number | null; meanFavorablePercent: number | null;
  meanAdversePercent: number | null; meanMfePercent: number | null;
  meanMaePercent: number | null};
export type CostSensitivity = {bps: number; netMeanPercent: number | null; netFavorableRate: number | null};
export type StudyRow = {
  scope: Scope; side: BreakSide; direction: 'bearish' | 'bullish'; horizonMinutes: 15 | 30 | 60;
  initialBreakouts: number; confirmedFailures: number; noReturn: number;
  incompleteObservation: number; signals: number; distinctSessions: number;
  eligible: Movement; excluded: Record<HorizonReason, number>;
  matchedEvents: number; unmatchedEvents: number; matchedControlObservations: number;
  matchedSignalMeanPercent: number | null; referenceMeanPercent: number | null;
  differenceMeanPercent: number | null;
  favorableInterval95: [number, number] | null; meanInterval95Percent: [number, number] | null;
  differenceInterval95Percent: [number, number] | null; bootstrapP: number | null;
  holmP: number | null; costSensitivity: CostSensitivity[];
};
export type Classification = {side: BreakSide; label:
  'Evidencia exploratoria favorable' | 'Sin mejora demostrada' |
  'Evidencia exploratoria desfavorable' | 'Inconclusa por muestra insuficiente'; reason: string};
export type FailedBreakoutStudy = {
  candles: number; firstTimestamp: string; lastTimestamp: string; splitDate: string | null;
  calendarAudit: ReturnType<typeof auditNvdaCalendar>;
  coverage: {referenceAvailableSessions: number; referenceUnavailableSessions: number;
    hourlyComplete: number; hourlyIncomplete: number; dailyComplete: number; dailyIncomplete: number};
  episodes: Episode[]; signals: FailedBreakoutSignal[]; rows: StudyRow[];
  contextCounts: Record<Trend, number>;
  repeatAudit: {repeated: number; overlappingPrimary: number; deduplicatedRetained: number};
  repeatSensitivity: {side: BreakSide; original: Movement; deduplicated: Movement}[];
  classifications: Classification[];
};

const BAR_MS = 900_000;
const HORIZONS = [{bars: 1, key: '15'}, {bars: 2, key: '30'}, {bars: 4, key: '60'}] as const;
const SIDES: BreakSide[] = ['high', 'low'];
const COSTS = [0, 5, 10, 20] as const;
const atClose = (candle: Candle): string => new Date(Date.parse(candle.timestamp) + BAR_MS).toISOString();
const tradeDirection = (side: BreakSide): Direction => side === 'high' ? 'PUT_CONTEXT' : 'CALL_CONTEXT';
const directionLabel = (side: BreakSide): 'bearish' | 'bullish' => side === 'high' ? 'bearish' : 'bullish';
const mean = (values: readonly number[]): number | null =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

function movement(values: readonly number[], mfe: readonly number[] = [], mae: readonly number[] = []): Movement {
  const favorable = values.filter(value => value > 0), adverse = values.filter(value => value < 0);
  return {count: values.length, favorableRate: values.length ? favorable.length / values.length : null,
    meanSignedPercent: mean(values), meanFavorablePercent: mean(favorable),
    meanAdversePercent: mean(adverse), meanMfePercent: mean(mfe), meanMaePercent: mean(mae)};
}

export function evaluateFailedBreakoutOutcome(candles: readonly Candle[], index: number,
  bars: 1 | 2 | 4, side: BreakSide, calendar: MarketCalendar): Outcome {
  const result = evaluateNvdaHorizon(candles, index, bars, tradeDirection(side), calendar);
  if (result.value === null) return {...result, entryPrice: null, exitPrice: null,
    mfePercent: null, maePercent: null};
  const entry = candles[index + 1]!.open;
  const passage = candles.slice(index + 1, index + bars + 1);
  const high = Math.max(...passage.map(candle => candle.high));
  const low = Math.min(...passage.map(candle => candle.low));
  return {...result, entryPrice: entry, exitPrice: candles[index + bars]!.close,
    mfePercent: side === 'high' ? (entry - low) / entry * 100 : (high - entry) / entry * 100,
    maePercent: side === 'high' ? (entry - high) / entry * 100 : (low - entry) / entry * 100};
}

function localMinute(slot: string): number {
  const [hour, minute] = slot.split(':').map(Number);
  return hour! * 60 + minute!;
}

/** An episode is classified from the next two closed bars; its signal exists only at confirmation close. */
export function observeBreakout(candles: readonly Candle[], index: number, side: BreakSide,
  priorHigh: number, priorLow: number, calendar: MarketCalendar,
  priorSessionDate: string, segment: 'first70' | 'last30'): Episode {
  const current = candles[index]!;
  const {day, slot} = newYorkBarParts(current.timestamp);
  const schedule = calendar.get(day);
  if (!schedule) throw new Error('Sesión ausente del calendario.');
  const episode: Episode = {
    id: `${side}:${current.timestamp}`, breakoutIndex: index, side, dateNy: day,
    priorSessionDate, priorHigh, priorLow, breakoutClose: current.close,
    breakoutBarStartUtc: current.timestamp, breakoutAvailableAtUtc: atClose(current),
    firstObservationIndex: null, secondObservationIndex: null,
    firstObservationClose: null, secondObservationClose: null,
    firstObservationStartUtc: null, secondObservationStartUtc: null,
    status: 'observation_incomplete', observationReason: null, failureLag: null,
    confirmationIndex: null, confirmationAvailableAtUtc: null,
    year: day.slice(0, 4), timeBucket: Math.floor((localMinute(slot) - schedule.open) / 60), segment,
  };
  const start = Date.parse(current.timestamp);
  for (const lag of [1, 2] as const) {
    if (localMinute(slot) + (lag + 1) * 15 > schedule.close) {
      episode.observationReason = 'session_close';
      return episode;
    }
    const next = candles[index + lag];
    if (!next || Date.parse(next.timestamp) !== start + lag * BAR_MS ||
        newYorkBarParts(next.timestamp).day !== day) {
      episode.observationReason = 'missing_observation';
      return episode;
    }
    if (lag === 1) {
      episode.firstObservationIndex = index + lag;
      episode.firstObservationClose = next.close;
      episode.firstObservationStartUtc = next.timestamp;
    } else {
      episode.secondObservationIndex = index + lag;
      episode.secondObservationClose = next.close;
      episode.secondObservationStartUtc = next.timestamp;
    }
    const failed = side === 'high' ? next.close < priorHigh : next.close > priorLow;
    if (failed) {
      episode.status = 'confirmed_failed';
      episode.failureLag = lag;
      episode.confirmationIndex = index + lag;
      episode.confirmationAvailableAtUtc = atClose(next);
      return episode;
    }
  }
  episode.status = 'no_return';
  return episode;
}

function bootstrap(items: readonly {date: string; value: number}[]):
  {interval: [number, number] | null; p: number | null} {
  const grouped = new Map<string, number[]>();
  for (const item of items) {
    const row = grouped.get(item.date) ?? [];
    row.push(item.value);
    grouped.set(item.date, row);
  }
  if (items.length < 30 || grouped.size < 10) return {interval: null, p: null};
  const sessions = [...grouped.values()];
  let state = 12012;
  const random = () => {state = (1664525 * state + 1013904223) >>> 0; return state / 2 ** 32;};
  const draws: number[] = [];
  for (let iteration = 0; iteration < 2000; iteration++) {
    let sum = 0, count = 0;
    for (let sample = 0; sample < sessions.length; sample++) {
      for (const value of sessions[Math.floor(random() * sessions.length)]!) {sum += value; count++;}
    }
    draws.push(sum / count);
  }
  draws.sort((a, b) => a - b);
  const nonPositive = draws.filter(value => value <= 0).length;
  const nonNegative = draws.filter(value => value >= 0).length;
  return {interval: [draws[50]!, draws[1949]!],
    p: Math.min(1, 2 * Math.min((nonPositive + 1) / 2001, (nonNegative + 1) / 2001))};
}

function inScope(date: string, segment: 'first70' | 'last30', scope: Scope): boolean {
  return scope === 'total' || scope === segment || scope === date.slice(0, 4);
}

function makeRow(episodes: readonly Episode[], signals: readonly FailedBreakoutSignal[],
  scope: Scope, side: BreakSide, horizon: typeof HORIZONS[number]): StudyRow {
  const episodeSet = episodes.filter(item => item.side === side && inScope(item.dateNy, item.segment, scope));
  const selected = signals.filter(item => item.side === side && inScope(item.dateNy, item.segment, scope));
  const eligible = selected.filter(item => item.horizons[horizon.key].value !== null);
  const matched = eligible.filter(item => item.controls[horizon.key].meanPercent !== null);
  const values = eligible.map(item => item.horizons[horizon.key].value!);
  const differences = matched.map(item => item.horizons[horizon.key].value! - item.controls[horizon.key].meanPercent!);
  const excluded: StudyRow['excluded'] = {session_close: 0, missing_next: 0, missing_intermediate: 0};
  for (const item of selected) {
    const reason = item.horizons[horizon.key].reason;
    if (reason) excluded[reason]++;
  }
  const sampled = bootstrap(eligible.map(item => ({date: item.dateNy, value: item.horizons[horizon.key].value!})));
  const favorable = bootstrap(eligible.map(item => ({date: item.dateNy,
    value: item.horizons[horizon.key].value! > 0 ? 1 : 0})));
  const contrasted = bootstrap(matched.map(item => ({date: item.dateNy,
    value: item.horizons[horizon.key].value! - item.controls[horizon.key].meanPercent!})));
  return {scope, side, direction: directionLabel(side), horizonMinutes: Number(horizon.key) as 15 | 30 | 60,
    initialBreakouts: episodeSet.length,
    confirmedFailures: episodeSet.filter(item => item.status === 'confirmed_failed').length,
    noReturn: episodeSet.filter(item => item.status === 'no_return').length,
    incompleteObservation: episodeSet.filter(item => item.status === 'observation_incomplete').length,
    signals: selected.length, distinctSessions: new Set(eligible.map(item => item.dateNy)).size,
    eligible: movement(values, eligible.map(item => item.horizons[horizon.key].mfePercent!),
      eligible.map(item => item.horizons[horizon.key].maePercent!)),
    excluded, matchedEvents: matched.length, unmatchedEvents: eligible.length - matched.length,
    matchedControlObservations: matched.reduce((sum, item) => sum + item.controls[horizon.key].observations, 0),
    matchedSignalMeanPercent: mean(matched.map(item => item.horizons[horizon.key].value!)),
    referenceMeanPercent: mean(matched.map(item => item.controls[horizon.key].meanPercent!)),
    differenceMeanPercent: mean(differences), favorableInterval95: favorable.interval,
    meanInterval95Percent: sampled.interval, differenceInterval95Percent: contrasted.interval,
    bootstrapP: contrasted.p, holmP: null,
    costSensitivity: COSTS.map(bps => {
      const net = values.map(value => value - bps / 100);
      return {bps, netMeanPercent: mean(net), netFavorableRate: net.length ?
        net.filter(value => value > 0).length / net.length : null};
    })};
}

function applyHolm(rows: StudyRow[]): void {
  const primary = rows.filter(row => row.scope === 'total' && row.horizonMinutes === 30);
  if (primary.length !== 2) throw new Error('Se requieren dos comparaciones principales.');
  const ranked = [...primary].sort((a, b) => (a.bootstrapP ?? 1) - (b.bootstrapP ?? 1));
  let adjusted = 0;
  ranked.forEach((row, index) => {
    adjusted = Math.max(adjusted, Math.min(1, (2 - index) * (row.bootstrapP ?? 1)));
    row.holmP = adjusted;
  });
}

function classify(rows: readonly StudyRow[], side: BreakSide): Classification {
  const primary = rows.find(row => row.scope === 'total' && row.side === side && row.horizonMinutes === 30)!;
  if (primary.eligible.count < 100 || primary.distinctSessions < 50 ||
      primary.matchedEvents / Math.max(primary.eligible.count, 1) < .8) {
    return {side, label: 'Inconclusa por muestra insuficiente',
      reason: 'Menos de 100 resultados, 50 sesiones o 80 % de eventos con control comparable.'};
  }
  const interval = primary.differenceInterval95Percent;
  const significant = (primary.holmP ?? 1) <= .05;
  if (interval && interval[1] < 0 && significant) {
    return {side, label: 'Evidencia exploratoria desfavorable',
      reason: 'Diferencia negativa con intervalo bajo cero y corrección de Holm.'};
  }
  const last = rows.find(row => row.scope === 'last30' && row.side === side && row.horizonMinutes === 30)!;
  const years = rows.filter(row => /^\d{4}$/.test(row.scope) && row.side === side &&
    row.horizonMinutes === 30 && row.matchedEvents >= 30);
  const stable = years.length >= 2 && years.filter(row =>
    (row.differenceMeanPercent ?? -Infinity) > 0).length > years.length / 2;
  const net10 = primary.costSensitivity.find(item => item.bps === 10)?.netMeanPercent ?? null;
  if ((primary.differenceMeanPercent ?? -Infinity) > 0 && interval && interval[0] > 0 &&
      significant && net10 !== null && net10 > 0 &&
      (last.differenceMeanPercent ?? -Infinity) > 0 && stable) {
    return {side, label: 'Evidencia exploratoria favorable',
      reason: 'Supera control, incertidumbre, Holm, costo 10 pb y estabilidad; requiere datos futuros.'};
  }
  return {side, label: 'Sin mejora demostrada',
    reason: 'La comparación principal no cumple todos los criterios predefinidos para avanzar.'};
}

export function studyNvdaFailedBreakouts(candles: readonly Candle[], calendar: MarketCalendar,
  asOf = Date.now()): FailedBreakoutStudy {
  if (!candles.length || Date.parse(candles.at(-1)!.timestamp) + BAR_MS > asOf) {
    throw new Error('El historial incluye una vela de 15 minutos que aún no terminó.');
  }
  const calendarAudit = auditNvdaCalendar(candles, calendar);
  const daily = buildDailyCandles(candles, calendar);
  const hourly = buildHourlyCandles(candles, calendar);
  const dailyPoints = calculateSmaPoints(daily), hourlyPoints = calculateSmaPoints(hourly);
  const dailyByDate = new Map(daily.map(item => [item.dateNy, item]));
  const byDate = new Map<string, number[]>();
  candles.forEach((candle, index) => {
    const date = newYorkBarParts(candle.timestamp).day;
    const indices = byDate.get(date) ?? [];
    indices.push(index);
    byDate.set(date, indices);
  });
  const observedDays = [...byDate.keys()];
  const splitDate = observedDays.length < 2 ? null :
    observedDays[Math.min(observedDays.length - 1, Math.max(1, Math.round(observedDays.length * .7)))]!;
  const scheduledDays = [...calendar.keys()].sort();
  const priorScheduled = new Map(scheduledDays.slice(1).map((day, index) => [day, scheduledDays[index]!]));
  const episodes: Episode[] = [];
  let referenceAvailableSessions = 0, referenceUnavailableSessions = 0;
  for (const [day, indices] of byDate) {
    const priorDate = priorScheduled.get(day);
    const prior = priorDate ? dailyByDate.get(priorDate) : undefined;
    if (!priorDate || !prior?.complete) {referenceUnavailableSessions++; continue;}
    referenceAvailableSessions++;
    const segment = splitDate !== null && day >= splitDate ? 'last30' : 'first70';
    let lockedHigh = false, lockedLow = false;
    for (let position = 0; position < indices.length; position++) {
      const index = indices[position]!, current = candles[index]!;
      if (current.close < prior.high) lockedHigh = false;
      if (current.close > prior.low) lockedLow = false;
      if (position === 0) continue;
      const previous = candles[indices[position - 1]!]!;
      if (Date.parse(previous.timestamp) + BAR_MS !== Date.parse(current.timestamp) ||
          previous.close < prior.low || previous.close > prior.high) continue;
      if (!lockedHigh && current.close > prior.high) {
        episodes.push(observeBreakout(candles, index, 'high', prior.high, prior.low,
          calendar, priorDate, segment));
        lockedHigh = true;
      }
      if (!lockedLow && current.close < prior.low) {
        episodes.push(observeBreakout(candles, index, 'low', prior.high, prior.low,
          calendar, priorDate, segment));
        lockedLow = true;
      }
    }
  }
  const signals: FailedBreakoutSignal[] = episodes.filter(item => item.status === 'confirmed_failed')
    .map(item => {
      const index = item.confirmationIndex!, candle = candles[index]!;
      return {episodeId: item.id, side: item.side, direction: directionLabel(item.side),
        dateNy: item.dateNy, confirmationIndex: index, confirmationBarStartUtc: candle.timestamp,
        availableAtUtc: atClose(candle), confirmationClose: candle.close,
        failureLag: item.failureLag!, segment: item.segment,
        priorHigh: item.priorHigh, priorLow: item.priorLow,
        sma: {trend: 'insufficient' as Trend, dayClose: null, daySma20: null,
          hourClose: null, hourSma100: null},
        repeatedWithinFourBars: false, overlappingPrimaryOutcome: false, dedupRetained: true,
        horizons: Object.fromEntries(HORIZONS.map(horizon => [horizon.key,
          evaluateFailedBreakoutOutcome(candles, index, horizon.bars, item.side, calendar)])) as
          Record<Horizon, Outcome>,
        controls: Object.fromEntries(HORIZONS.map(horizon => [horizon.key,
          {meanPercent: null, observations: 0, sessions: 0,
            reason: 'horizon_incomplete' as const}])) as Record<Horizon, ControlMatch>};
    }).sort((a, b) => a.confirmationIndex - b.confirmationIndex);
  let hourCursor = 0, dayCursor = 0;
  let latestHour: SmaPoint | null = null, latestDay: SmaPoint | null = null;
  for (const signal of signals) {
    const start = Date.parse(signal.confirmationBarStartUtc);
    while (hourCursor < hourlyPoints.length &&
      Date.parse(hourlyPoints[hourCursor]!.candle.availableAt) <= start) latestHour = hourlyPoints[hourCursor++]!;
    while (dayCursor < dailyPoints.length &&
      Date.parse(dailyPoints[dayCursor]!.candle.availableAt) <= start) latestDay = dailyPoints[dayCursor++]!;
    signal.sma = {trend: classifyTrend(latestDay, latestHour),
      dayClose: latestDay?.candle.complete ? latestDay.candle.close : null,
      daySma20: latestDay?.candle.complete ? latestDay.values[20] : null,
      hourClose: latestHour?.candle.complete ? latestHour.candle.close : null,
      hourSma100: latestHour?.candle.complete ? latestHour.values[100] : null};
  }
  const lastSeen = new Map<BreakSide, FailedBreakoutSignal>();
  const lastKept = new Map<BreakSide, FailedBreakoutSignal>();
  let preceding: FailedBreakoutSignal[] = [];
  for (const signal of signals) {
    const prior = lastSeen.get(signal.side), kept = lastKept.get(signal.side);
    signal.repeatedWithinFourBars = !!prior && prior.dateNy === signal.dateNy &&
      signal.confirmationIndex - prior.confirmationIndex < 4;
    signal.dedupRetained = !kept || kept.dateNy !== signal.dateNy ||
      signal.confirmationIndex - kept.confirmationIndex >= 4;
    signal.overlappingPrimaryOutcome = preceding.some(other => other.dateNy === signal.dateNy &&
      signal.confirmationIndex - other.confirmationIndex <= 1);
    if (signal.dedupRetained) lastKept.set(signal.side, signal);
    lastSeen.set(signal.side, signal);
    preceding = preceding.filter(other => other.dateNy === signal.dateNy &&
      signal.confirmationIndex - other.confirmationIndex <= 1);
    preceding.push(signal);
  }
  const pools = new Map<string, {date: string; value: number}[]>();
  const poolKey = (item: Episode, lag: 1 | 2, horizon: Horizon): string =>
    [item.year, item.side, item.timeBucket, lag, horizon].join('|');
  for (const episode of episodes) for (const lag of [1, 2] as const) {
    const anchor = lag === 1 ? episode.firstObservationIndex : episode.secondObservationIndex;
    if (anchor === null || episode.failureLag !== null && episode.failureLag <= lag) continue;
    for (const horizon of HORIZONS) {
      const outcome = evaluateFailedBreakoutOutcome(candles, anchor, horizon.bars, episode.side, calendar);
      if (outcome.value === null) continue;
      const key = poolKey(episode, lag, horizon.key);
      const rows = pools.get(key) ?? [];
      rows.push({date: episode.dateNy, value: outcome.value});
      pools.set(key, rows);
    }
  }
  const episodeById = new Map(episodes.map(item => [item.id, item]));
  for (const signal of signals) {
    const episode = episodeById.get(signal.episodeId)!;
    for (const horizon of HORIZONS) {
      if (signal.horizons[horizon.key].value === null) continue;
      const pool = (pools.get(poolKey(episode, signal.failureLag, horizon.key)) ?? [])
        .filter(item => item.date !== signal.dateNy);
      const sessions = new Set(pool.map(item => item.date)).size;
      signal.controls[horizon.key] = pool.length >= 10 && sessions >= 10 ?
        {meanPercent: mean(pool.map(item => item.value)), observations: pool.length, sessions, reason: null} :
        {meanPercent: null, observations: pool.length, sessions, reason: 'insufficient_controls'};
    }
  }
  const scopes: Scope[] = ['total', 'first70', 'last30', ...new Set(observedDays.map(day => day.slice(0, 4)))];
  const rows: StudyRow[] = [];
  for (const scope of scopes) for (const side of SIDES) for (const horizon of HORIZONS) {
    rows.push(makeRow(episodes, signals, scope, side, horizon));
  }
  applyHolm(rows);
  const contextCounts: Record<Trend, number> =
    {bullish: 0, bearish: 0, contradictory: 0, neutral: 0, insufficient: 0};
  for (const signal of signals) contextCounts[signal.sma.trend]++;
  return {candles: candles.length, firstTimestamp: candles[0]!.timestamp,
    lastTimestamp: candles.at(-1)!.timestamp, splitDate, calendarAudit,
    coverage: {referenceAvailableSessions, referenceUnavailableSessions,
      hourlyComplete: hourly.filter(item => item.complete).length,
      hourlyIncomplete: hourly.filter(item => !item.complete).length,
      dailyComplete: daily.filter(item => item.complete).length,
      dailyIncomplete: daily.filter(item => !item.complete).length},
    episodes, signals, rows, contextCounts,
    repeatAudit: {repeated: signals.filter(item => item.repeatedWithinFourBars).length,
      overlappingPrimary: signals.filter(item => item.overlappingPrimaryOutcome).length,
      deduplicatedRetained: signals.filter(item => item.dedupRetained).length},
    repeatSensitivity: SIDES.map(side => {
      const selected = signals.filter(item => item.side === side && item.horizons['30'].value !== null);
      return {side,
        original: movement(selected.map(item => item.horizons['30'].value!)),
        deduplicated: movement(selected.filter(item => item.dedupRetained)
          .map(item => item.horizons['30'].value!))};
    }), classifications: SIDES.map(side => classify(rows, side))};
}
