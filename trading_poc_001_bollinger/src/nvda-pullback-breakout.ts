import type {Candle, Direction} from './domain.ts';
import type {MarketCalendar} from './alpaca-calendar.ts';
import {calculateBollinger} from './bollinger.ts';
import {calculateEma9} from './ema9.ts';
import {calculateVolumeReferences} from './volume-filter.ts';
import {detectSignals} from './signals.ts';
import {buildDailyCandles, buildHourlyCandles, calculateSmaPoints, type SmaPoint} from './multitimeframe.ts';
import {auditNvdaCalendar, evaluateNvdaHorizon, type HorizonResult} from './nvda-indicators-study.ts';
import {newYorkBarParts} from './strategy-validation.ts';

export type Trend = 'bullish' | 'bearish' | 'contradictory' | 'neutral' | 'insufficient';
export type Strategy = 'pullback' | 'breakout';
export type Side = 'bullish' | 'bearish';
export type Horizon = '15' | '30' | '60';
export type Scope = 'total' | 'first70' | 'last30' | string;
export type Match = {meanPercent: number | null; controls: number;
  reason: 'insufficient_controls' | 'horizon_incomplete' | null};
export type Phase11Event = {
  index: number; strategy: Strategy; direction: Side; dateNy: string; slotNy: string;
  barStartUtc: string; availableAtUtc: string; segment: 'first70' | 'last30';
  priceClose: number; hourSma20: number; hourSma100: number; daySma20: number;
  distanceCloseHour20Percent: number; distanceExtremeHour20Percent: number;
  distanceCloseHour100Percent: number; distanceCloseDay20Percent: number;
  bollingerUpper: number | null; bollingerLower: number | null;
  bollingerBandwidthPercent: number | null; ema9: number | null; rvol: number | null;
  coincidesWithCompression: boolean;
  repeatedWithinFourBars: boolean; overlappingPrimaryOutcome: boolean; dedupRetained: boolean;
  horizons: Record<Horizon, HorizonResult>; controls: Record<Horizon, Match>;
};
export type Movement = {
  count: number; favorableRate: number | null; meanSignedPercent: number | null;
  meanFavorablePercent: number | null; meanAdversePercent: number | null;
};
export type CostSensitivity = {bps: number; netMeanPercent: number | null; netFavorableRate: number | null};
export type Row = {
  scope: Scope; strategy: Strategy; direction: Side; horizonMinutes: 15 | 30 | 60;
  signals: number; distinctSessions: number; eligible: Movement;
  excluded: Record<'session_close' | 'missing_next' | 'missing_intermediate', number>;
  matchedEvents: number; unmatchedEvents: number; matchedControlObservations: number;
  referenceMeanPercent: number | null; differenceMeanPercent: number | null;
  favorableInterval95: [number, number] | null;
  meanInterval95Percent: [number, number] | null;
  differenceInterval95Percent: [number, number] | null;
  bootstrapP: number | null; holmP: number | null; costSensitivity: CostSensitivity[];
};
export type Classification = {
  strategy: Strategy; direction: Side;
  label: 'Evidencia exploratoria favorable' | 'Sin mejora demostrada' |
    'Evidencia exploratoria desfavorable' | 'Inconclusa por muestra insuficiente';
  reason: string;
};
export type Phase11Study = {
  candles: number; firstTimestamp: string; lastTimestamp: string; splitDate: string | null;
  calendarAudit: ReturnType<typeof auditNvdaCalendar>;
  aggregation: {hourlyComplete: number; hourlyIncomplete: number; dailyComplete: number; dailyIncomplete: number};
  contextCounts: Record<Trend, number>;
  compression: {historicalSignals: number; simpleBreakouts: number; coincident: number};
  compressionComparison: {direction: Side; simple: Movement; historical: Movement; coincident: number}[];
  repeatAudit: {repeated: number; overlappingPrimary: number; deduplicatedRetained: number};
  repeatSensitivity: {strategy: Strategy; direction: Side; raw: Movement; deduplicated: Movement}[];
  events: Phase11Event[]; rows: Row[]; classifications: Classification[];
};

const BAR_MS = 900_000;
const HORIZONS = [{bars: 1, key: '15'}, {bars: 2, key: '30'}, {bars: 4, key: '60'}] as const;
const STRATEGIES: Strategy[] = ['pullback', 'breakout'];
const SIDES: Side[] = ['bullish', 'bearish'];
const COSTS = [0, 5, 10, 20] as const;

function direction(side: Side): Direction {
  return side === 'bullish' ? 'CALL_CONTEXT' : 'PUT_CONTEXT';
}
function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
function movement(values: readonly number[]): Movement {
  const gains = values.filter(value => value > 0), losses = values.filter(value => value < 0);
  return {count: values.length, favorableRate: values.length ? gains.length / values.length : null,
    meanSignedPercent: mean(values), meanFavorablePercent: mean(gains), meanAdversePercent: mean(losses)};
}
function position(point: SmaPoint | null, period: 20 | 100): 'above' | 'below' | 'equal' | null {
  if (!point || !point.candle.complete || point.values[period] === null) return null;
  const close = point.candle.close, sma = point.values[period]!;
  return close > sma ? 'above' : close < sma ? 'below' : 'equal';
}

/** Both references must be closed at bar start. An incomplete latest aggregate blocks stale fallback. */
export function classifyTrend(day: SmaPoint | null, hour: SmaPoint | null): Trend {
  const daily = position(day, 20), hourly = position(hour, 100);
  if (daily === null || hourly === null) return 'insufficient';
  if (daily === 'equal' || hourly === 'equal') return 'neutral';
  if (daily !== hourly) return 'contradictory';
  return daily === 'above' ? 'bullish' : 'bearish';
}

export function isPullback(previous: Candle, current: Candle, side: Side, sma20: number): boolean {
  return side === 'bullish'
    ? previous.close > sma20 && current.low <= sma20 && current.close > sma20 && current.close > current.open
    : previous.close < sma20 && current.high >= sma20 && current.close < sma20 && current.close < current.open;
}

export function isBreakout(previousClose: number, previousBands: {lower: number | null; upper: number | null},
  currentClose: number, currentBands: {lower: number | null; upper: number | null}, side: Side): boolean {
  if (previousBands.lower === null || previousBands.upper === null ||
      currentBands.lower === null || currentBands.upper === null) return false;
  if (previousClose < previousBands.lower || previousClose > previousBands.upper) return false;
  return side === 'bullish' ? currentClose > currentBands.upper : currentClose < currentBands.lower;
}

function blockBootstrap(items: readonly {date: string; value: number}[], seed: number):
  {interval: [number, number] | null; p: number | null} {
  const grouped = new Map<string, number[]>();
  for (const item of items) {
    const row = grouped.get(item.date) ?? [];
    row.push(item.value);
    grouped.set(item.date, row);
  }
  if (items.length < 30 || grouped.size < 10) return {interval: null, p: null};
  const sessions = [...grouped.values()];
  let state = seed >>> 0;
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

function scopeOf(event: Phase11Event, scope: Scope): boolean {
  return scope === 'total' || event.segment === scope || scope === event.dateNy.slice(0, 4);
}
function rowFor(events: readonly Phase11Event[], scope: Scope, strategy: Strategy, side: Side,
  horizon: typeof HORIZONS[number]): Row {
  const selected = events.filter(event => event.strategy === strategy && event.direction === side && scopeOf(event, scope));
  const eligible = selected.filter(event => event.horizons[horizon.key].value !== null);
  const matched = eligible.filter(event => event.controls[horizon.key].meanPercent !== null);
  const values = eligible.map(event => event.horizons[horizon.key].value!);
  const differences = matched.map(event => event.horizons[horizon.key].value! -
    event.controls[horizon.key].meanPercent!);
  const excluded: Row['excluded'] = {session_close: 0, missing_next: 0, missing_intermediate: 0};
  for (const event of selected) {
    const reason = event.horizons[horizon.key].reason;
    if (reason) excluded[reason]++;
  }
  const sampled = blockBootstrap(eligible.map(event => ({date: event.dateNy, value: event.horizons[horizon.key].value!})), 11011);
  const favorable = blockBootstrap(eligible.map(event => ({date: event.dateNy,
    value: event.horizons[horizon.key].value! > 0 ? 1 : 0})), 11011);
  const contrasted = blockBootstrap(matched.map(event => ({date: event.dateNy,
    value: event.horizons[horizon.key].value! - event.controls[horizon.key].meanPercent!})), 11011);
  return {scope, strategy, direction: side, horizonMinutes: Number(horizon.key) as 15 | 30 | 60,
    signals: selected.length, distinctSessions: new Set(eligible.map(event => event.dateNy)).size,
    eligible: movement(values), excluded, matchedEvents: matched.length,
    unmatchedEvents: eligible.length - matched.length,
    matchedControlObservations: matched.reduce((sum, event) => sum + event.controls[horizon.key].controls, 0),
    referenceMeanPercent: mean(matched.map(event => event.controls[horizon.key].meanPercent!)),
    differenceMeanPercent: mean(differences), favorableInterval95: favorable.interval,
    meanInterval95Percent: sampled.interval,
    differenceInterval95Percent: contrasted.interval, bootstrapP: contrasted.p, holmP: null,
    costSensitivity: COSTS.map(bps => {
      const net = values.map(value => value - bps / 100);
      return {bps, netMeanPercent: mean(net), netFavorableRate: net.length ?
        net.filter(value => value > 0).length / net.length : null};
    })};
}

function applyHolm(rows: Row[]): void {
  const main = rows.filter(row => row.scope === 'total' && row.horizonMinutes === 30);
  if (main.length !== 4) throw new Error('Se requieren cuatro comparaciones principales.');
  const ranked = [...main].sort((a, b) => (a.bootstrapP ?? 1) - (b.bootstrapP ?? 1));
  let adjusted = 0;
  ranked.forEach((row, index) => {
    adjusted = Math.max(adjusted, Math.min(1, (4 - index) * (row.bootstrapP ?? 1)));
    row.holmP = adjusted;
  });
}

function classify(rows: readonly Row[], strategy: Strategy, side: Side): Classification {
  const primary = rows.find(row => row.scope === 'total' && row.strategy === strategy &&
    row.direction === side && row.horizonMinutes === 30)!;
  const evaluated = primary.eligible.count;
  if (evaluated < 100 || primary.distinctSessions < 50 ||
      primary.matchedEvents / Math.max(1, evaluated) < .8) {
    return {strategy, direction: side, label: 'Inconclusa por muestra insuficiente',
      reason: 'Menos de 100 resultados, 50 sesiones o 80 % de eventos con referencia comparable.'};
  }
  const interval = primary.differenceInterval95Percent;
  const significant = (primary.holmP ?? 1) <= .05;
  if (interval && interval[1] < 0 && significant) {
    return {strategy, direction: side, label: 'Evidencia exploratoria desfavorable',
      reason: 'Diferencia negativa con intervalo bajo cero y corrección de Holm.'};
  }
  const last = rows.find(row => row.scope === 'last30' && row.strategy === strategy &&
    row.direction === side && row.horizonMinutes === 30)!;
  const years = rows.filter(row => /^[0-9]{4}$/.test(row.scope) && row.strategy === strategy &&
    row.direction === side && row.horizonMinutes === 30 && row.matchedEvents >= 30);
  const stable = years.length >= 2 &&
    years.filter(row => (row.differenceMeanPercent ?? -Infinity) > 0).length > years.length / 2;
  const net10 = primary.costSensitivity.find(item => item.bps === 10)?.netMeanPercent ?? null;
  if ((primary.differenceMeanPercent ?? -Infinity) > 0 && interval && interval[0] > 0 &&
      significant && net10 !== null && net10 > 0 &&
      (last.differenceMeanPercent ?? -Infinity) > 0 && stable) {
    return {strategy, direction: side, label: 'Evidencia exploratoria favorable',
      reason: 'Supera referencia, incertidumbre, Holm, costo 10 pb y estabilidad predefinidos; requiere datos futuros.'};
  }
  return {strategy, direction: side, label: 'Sin mejora demostrada',
    reason: 'La comparación principal no cumple todos los criterios predefinidos para avanzar.'};
}

export function studyNvdaPullbackBreakout(candles: readonly Candle[], calendar: MarketCalendar,
  asOf = Date.now()): Phase11Study {
  if (!candles.length || Date.parse(candles.at(-1)!.timestamp) + BAR_MS > asOf) {
    throw new Error('El historial incluye una vela de 15 minutos que aún no terminó.');
  }
  const calendarAudit = auditNvdaCalendar(candles, calendar);
  const hourly = buildHourlyCandles(candles, calendar), daily = buildDailyCandles(candles, calendar);
  const hourPoints = calculateSmaPoints(hourly), dayPoints = calculateSmaPoints(daily);
  const bollinger = calculateBollinger(candles), ema = calculateEma9(candles);
  const volumes = calculateVolumeReferences(candles);
  const compression = detectSignals(bollinger, 100, .2, 1.05, 12, 15);
  const compressionAt = new Map(compression.map(signal => [signal.index, signal.direction]));
  const days = [...new Set(candles.map(candle => newYorkBarParts(candle.timestamp).day))];
  const splitDate = days.length < 2 ? null : days[Math.min(days.length - 1, Math.max(1, Math.round(days.length * .7)))]!;
  const contextCounts: Record<Trend, number> = {bullish: 0, bearish: 0, contradictory: 0, neutral: 0, insufficient: 0};
  const candidates: {index: number; date: string; slot: string; trend: Trend; event: boolean}[] = [];
  const events: Phase11Event[] = [];
  let hourCursor = 0, dayCursor = 0;
  let latestHour: SmaPoint | null = null, latestDay: SmaPoint | null = null;
  for (let index = 0; index < candles.length; index++) {
    const candle = candles[index]!, start = Date.parse(candle.timestamp);
    while (hourCursor < hourPoints.length &&
      Date.parse(hourPoints[hourCursor]!.candle.availableAt) <= start) latestHour = hourPoints[hourCursor++]!;
    while (dayCursor < dayPoints.length &&
      Date.parse(dayPoints[dayCursor]!.candle.availableAt) <= start) latestDay = dayPoints[dayCursor++]!;
    const trend = classifyTrend(latestDay, latestHour);
    contextCounts[trend]++;
    const {day, slot} = newYorkBarParts(candle.timestamp);
    const previous = candles[index - 1];
    const consecutive = previous && Date.parse(previous.timestamp) + BAR_MS === start &&
      newYorkBarParts(previous.timestamp).day === day;
    const candidate = {index, date: day, slot, trend, event: false};
    candidates.push(candidate);
    if (!consecutive || (trend !== 'bullish' && trend !== 'bearish')) continue;
    const hour20 = latestHour!.values[20]!;
    const hour100 = latestHour!.values[100]!;
    const day20 = latestDay!.values[20]!;
    const previousBands = bollinger[index - 1]!, currentBands = bollinger[index]!;
    const pullback = isPullback(previous!, candle, trend, hour20);
    const breakout = isBreakout(previous!.close, previousBands, candle.close, currentBands, trend);
    if (!pullback && !breakout) continue;
    candidate.event = true;
    const reference = volumes[index]!.average;
    const rvol = reference !== null && reference > 0 ? candle.volume / reference : null;
    for (const strategy of STRATEGIES) {
      if (strategy === 'pullback' && !pullback || strategy === 'breakout' && !breakout) continue;
      const horizons = Object.fromEntries(HORIZONS.map(item => [item.key,
        evaluateNvdaHorizon(candles, index, item.bars, direction(trend), calendar)])) as Record<Horizon, HorizonResult>;
      const controls = Object.fromEntries(HORIZONS.map(item => [item.key,
        {meanPercent: null, controls: 0, reason: horizons[item.key].value === null ?
          'horizon_incomplete' : 'insufficient_controls'}])) as Record<Horizon, Match>;
      events.push({index, strategy, direction: trend, dateNy: day, slotNy: slot,
        barStartUtc: candle.timestamp, availableAtUtc: new Date(start + BAR_MS).toISOString(),
        segment: splitDate !== null && day >= splitDate ? 'last30' : 'first70',
        priceClose: candle.close, hourSma20: hour20, hourSma100: hour100, daySma20: day20,
        distanceCloseHour20Percent: (candle.close / hour20 - 1) * 100,
        distanceExtremeHour20Percent: ((trend === 'bullish' ? candle.low : candle.high) / hour20 - 1) * 100,
        distanceCloseHour100Percent: (candle.close / hour100 - 1) * 100,
        distanceCloseDay20Percent: (candle.close / day20 - 1) * 100,
        bollingerUpper: currentBands.upper, bollingerLower: currentBands.lower,
        bollingerBandwidthPercent: currentBands.bandwidth === null ? null : currentBands.bandwidth * 100,
        ema9: ema[index]!, rvol,
        coincidesWithCompression: compressionAt.get(index) === direction(trend),
        repeatedWithinFourBars: false, overlappingPrimaryOutcome: false, dedupRetained: true,
        horizons, controls});
    }
  }
  const lastSeen = new Map<string, Phase11Event>(), lastKept = new Map<string, Phase11Event>();
  let preceding: Phase11Event[] = [];
  for (const event of events) {
    const key = event.strategy + '|' + event.direction;
    const prior = lastSeen.get(key), kept = lastKept.get(key);
    event.repeatedWithinFourBars = !!prior && prior.dateNy === event.dateNy && event.index - prior.index < 4;
    event.dedupRetained = !kept || kept.dateNy !== event.dateNy || event.index - kept.index >= 4;
    event.overlappingPrimaryOutcome = preceding.some(other =>
      other.dateNy === event.dateNy && event.index - other.index <= 1);
    if (event.dedupRetained) lastKept.set(key, event);
    lastSeen.set(key, event);
    preceding = preceding.filter(other => other.dateNy === event.dateNy && event.index - other.index <= 1);
    preceding.push(event);
  }
  const pools = new Map<string, {date: string; value: number}[]>();
  for (const candidate of candidates) {
    if (candidate.event || (candidate.trend !== 'bullish' && candidate.trend !== 'bearish')) continue;
    for (const item of HORIZONS) {
      const result = evaluateNvdaHorizon(candles, candidate.index, item.bars, direction(candidate.trend), calendar);
      if (result.value === null) continue;
      const key = candidate.date.slice(0, 4) + '|' + candidate.slot + '|' + candidate.trend + '|' + item.key;
      const pool = pools.get(key) ?? [];
      pool.push({date: candidate.date, value: result.value});
      pools.set(key, pool);
    }
  }
  for (const event of events) for (const item of HORIZONS) {
    if (event.horizons[item.key].value === null) continue;
    const key = event.dateNy.slice(0, 4) + '|' + event.slotNy + '|' + event.direction + '|' + item.key;
    const pool = (pools.get(key) ?? []).filter(control => control.date !== event.dateNy);
    const distinct = new Set(pool.map(control => control.date)).size;
    if (pool.length >= 10 && distinct >= 10) {
      event.controls[item.key] = {meanPercent: mean(pool.map(control => control.value)),
        controls: pool.length, reason: null};
    } else event.controls[item.key] = {meanPercent: null, controls: pool.length, reason: 'insufficient_controls'};
  }
  const scopes: Scope[] = ['total', 'first70', 'last30', ...new Set(days.map(day => day.slice(0, 4)))];
  const rows: Row[] = [];
  for (const scope of scopes) for (const strategy of STRATEGIES) for (const side of SIDES)
    for (const horizon of HORIZONS) {
      rows.push(rowFor(events, scope, strategy, side, horizon));
    }
  applyHolm(rows);
  const compressionComparison = SIDES.map(side => {
    const simple = events.filter(event => event.strategy === 'breakout' && event.direction === side);
    const historical = compression.filter(signal => signal.direction === direction(side) &&
      candidates[signal.index]?.trend === side);
    return {direction: side,
      simple: movement(simple.flatMap(event => event.horizons['30'].value === null ? [] :
        [event.horizons['30'].value])),
      historical: movement(historical.flatMap(signal => {
        const result = evaluateNvdaHorizon(candles, signal.index, 2, direction(side), calendar);
        return result.value === null ? [] : [result.value];
      })),
      coincident: simple.filter(event => event.coincidesWithCompression).length};
  });
  const repeatSensitivity = STRATEGIES.flatMap(strategy => SIDES.map(side => {
    const selected = events.filter(event => event.strategy === strategy && event.direction === side &&
      event.horizons['30'].value !== null);
    return {strategy, direction: side,
      raw: movement(selected.map(event => event.horizons['30'].value!)),
      deduplicated: movement(selected.filter(event => event.dedupRetained)
        .map(event => event.horizons['30'].value!))};
  }));
  return {candles: candles.length, firstTimestamp: candles[0]!.timestamp,
    lastTimestamp: candles.at(-1)!.timestamp, splitDate, calendarAudit,
    aggregation: {hourlyComplete: hourly.filter(point => point.complete).length,
      hourlyIncomplete: hourly.filter(point => !point.complete).length,
      dailyComplete: daily.filter(point => point.complete).length,
      dailyIncomplete: daily.filter(point => !point.complete).length},
    contextCounts, compression: {historicalSignals: compression.length,
      simpleBreakouts: events.filter(event => event.strategy === 'breakout').length,
      coincident: events.filter(event => event.strategy === 'breakout' && event.coincidesWithCompression).length},
    compressionComparison, repeatSensitivity,
    repeatAudit: {repeated: events.filter(event => event.repeatedWithinFourBars).length,
      overlappingPrimary: events.filter(event => event.overlappingPrimaryOutcome).length,
      deduplicatedRetained: events.filter(event => event.dedupRetained).length},
    events, rows, classifications: STRATEGIES.flatMap(strategy => SIDES.map(side => classify(rows, strategy, side)))};
}
