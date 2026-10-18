import type {Candle} from './domain.ts';
import type {MarketCalendar} from './alpaca-calendar.ts';
import {auditNvdaCalendar, type HorizonReason} from './nvda-indicators-study.ts';
import {newYorkBarParts} from './strategy-validation.ts';
import type {Phase11Study} from './nvda-pullback-breakout.ts';
import type {FailedBreakoutStudy} from './nvda-failed-breakouts.ts';
import {buildDailyAtr, buildPrior20Ranges, evaluateVolatilityTrajectory,
  nearestRank, sessionBlock, sessionBootstrap,
  type AtrSession, type IntradayRange, type Regime, type Side, type Trajectory} from './nvda-volatility.ts';

export const FAMILIES = [
  'pullback_bullish', 'pullback_bearish', 'breakout_bullish', 'breakout_bearish',
  'failed_high_bearish', 'failed_low_bullish',
] as const;
export type Family = typeof FAMILIES[number];
export type Horizon = '15' | '30' | '60';
export type OriginalMatch = {meanPercent: number | null; observations: number;
  reason: string | null};
export type GeneralMatch = {meanPercent: number | null; meanMfePercent: number | null;
  meanMaePercent: number | null; observations: number; sessions: number;
  reason: 'horizon_incomplete' | 'regime_insufficient' | 'insufficient_windows' | null};
export type VolatilityEvent = {
  id: string; family: Family; sourcePhase: 11 | 12; direction: Side;
  index: number; dateNy: string; slotNy: string; hourBlock: number;
  barStartUtc: string; availableAtUtc: string; segment: 'first70' | 'last30';
  regime: Regime; priorAtr14: number | null; priorAtr14Percent: number | null;
  p33: number | null; p67: number | null; atrReferenceCount: number;
  priorRange20Dollar: number | null; priorRange20Percent: number | null;
  range20Count: number;
  originalHorizons: Record<Horizon, {value: number | null; reason: HorizonReason | null;
    entryUtc: string | null; exitUtc: string | null}>;
  originalControls: Record<Horizon, OriginalMatch>;
  trajectories: Record<Horizon, Trajectory>; generalControl30: GeneralMatch;
};
export type GeneralWindow = {
  index: number; dateNy: string; slotNy: string; hourBlock: number;
  barStartUtc: string; availableAtUtc: string; regime: Regime;
  priorAtr14: number | null; priorAtr14Percent: number | null;
  priorRange20Dollar: number | null; priorRange20Percent: number | null;
  bullish: Trajectory; bearish: Trajectory;
};
export type Quantiles = {p10: number | null; p25: number | null; p50: number | null;
  p75: number | null; p90: number | null};
export type CostRow = {bps: number; netMeanPercent: number | null;
  netFavorableRate: number | null};
export type Comparator = {matched: number; coverage: number | null;
  matchedSignalMeanPercent: number | null; referenceMeanPercent: number | null;
  differenceMeanPercent: number | null; differenceInterval95Percent: [number, number] | null};
export type GeneralComparator = Comparator & {
  matchedSignalMfePercent: number | null; referenceMfePercent: number | null;
  differenceMfePercent: number | null; matchedSignalMaePercent: number | null;
  referenceMaePercent: number | null; differenceMaePercent: number | null};
export type Summary = {
  family: Family; direction: Side; scope: string; regime: Regime | 'all';
  horizonMinutes: 15 | 30 | 60; signals: number; eligible: number;
  distinctSessions: number; smallSample: boolean;
  excluded: Record<HorizonReason, number>; positiveRate: number | null;
  meanSignedPercent: number | null; sdSignedPercent: number | null;
  meanMfePercent: number | null; meanMaePercent: number | null;
  mfeQuantilesPercent: Quantiles; maeQuantilesPercent: Quantiles;
  meanMfeAtrUnits: number | null; meanMaeAtrUnits: number | null;
  normalizedAtrCount: number; meanMfeRange20Units: number | null;
  meanMaeRange20Units: number | null; normalizedRange20Count: number;
  meanInterval95Percent: [number, number] | null;
  mfeInterval95Percent: [number, number] | null;
  maeInterval95Percent: [number, number] | null;
  costs: CostRow[]; originalControl: Comparator;
  generalControl: GeneralComparator | null;
};
export type GeneralSummary = {
  scope: string; direction: Side; windows: number; eligible: number; distinctSessions: number;
  excluded: Record<HorizonReason, number>; positiveRate: number | null;
  meanSignedPercent: number | null; sdSignedPercent: number | null;
  meanMfePercent: number | null; meanMaePercent: number | null;
  mfeQuantilesPercent: Quantiles; maeQuantilesPercent: Quantiles; costs: CostRow[];
};
export type HourlyEvents = {hourBlock: number; direction: Side; signals: number;
  eligible: number; sessionCloseExcluded: number; meanSignedPercent: number | null;
  meanMfePercent: number | null; meanMaePercent: number | null};
export type YearRegime = {family: Family; regime: Regime; year: string;
  eligible: number; sessions: number; meanSignedPercent: number | null;
  generalMatched: number; differenceVsGeneralPercent: number | null};
export type CandidateAudit = {family: Family; regime: 'low' | 'medium' | 'high';
  sufficient: boolean; positiveNet10: boolean; positiveGeneralDifference: boolean;
  mfeOutweighsAdditionalMae: boolean; last30Positive: boolean;
  qualifyingYears: number; positiveQualifyingYears: number; candidate: boolean};
export type VolatilityStudy = {
  sourceCandles: number; firstTimestamp: string; lastTimestamp: string;
  calendarAudit: ReturnType<typeof auditNvdaCalendar>;
  atrCoverage: {completeSessions: number; incompleteSessions: number;
    validTrueRanges: number; validAtr14: number; regimes: Record<Regime, number>};
  originalCounts: {phase11: number; phase12: number};
  events: VolatilityEvent[]; baselineWindows: GeneralWindow[];
  familyRows: Summary[]; regimeRows: Summary[]; yearRows: Summary[];
  periodRows: Summary[]; horizonRows: Summary[];
  baselineRegimeRows: GeneralSummary[]; baselineHourRows: GeneralSummary[];
  hourlyEventRows: HourlyEvents[]; yearRegimeRows: YearRegime[];
  candidateAudit: CandidateAudit[];
  decision: {label: 'Patrón descriptivo para nueva hipótesis' |
    'Patrones inconsistentes o demasiado pequeños' | 'Información insuficiente';
    qualifiedFamilies: number; candidateCells: number;
    thirtyMinuteCoverage: number; thirtyMinuteMeasurable: boolean};
};

const HORIZONS = [{bars: 1, key: '15'}, {bars: 2, key: '30'}, {bars: 4, key: '60'}] as const;
const REGIMES: Regime[] = ['low', 'medium', 'high', 'insufficient'];
const DIRECTIONS: Side[] = ['bullish', 'bearish'];
const COSTS = [0, 5, 10, 20] as const;
const mean = (values: readonly number[]): number | null =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const nonNull = (values: readonly (number | null)[]): number[] =>
  values.filter((value): value is number => value !== null);
function sd(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const average = mean(values)!;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}
function quantiles(values: readonly number[]): Quantiles {
  return {p10: nearestRank(values, 10), p25: nearestRank(values, 25),
    p50: nearestRank(values, 50), p75: nearestRank(values, 75), p90: nearestRank(values, 90)};
}
function costs(values: readonly number[]): CostRow[] {
  return COSTS.map(bps => {
    const net = values.map(value => value - bps / 100);
    return {bps, netMeanPercent: mean(net), netFavorableRate: net.length ?
      net.filter(value => value > 0).length / net.length : null};
  });
}
function originalComparator(eligible: readonly VolatilityEvent[], horizon: Horizon): Comparator {
  const matched = eligible.filter(item => item.originalControls[horizon].meanPercent !== null);
  const differences = matched.map(item => ({date: item.dateNy,
    value: item.trajectories[horizon].value! - item.originalControls[horizon].meanPercent!}));
  return {matched: matched.length, coverage: eligible.length ? matched.length / eligible.length : null,
    matchedSignalMeanPercent: mean(matched.map(item => item.trajectories[horizon].value!)),
    referenceMeanPercent: mean(matched.map(item => item.originalControls[horizon].meanPercent!)),
    differenceMeanPercent: mean(differences.map(item => item.value)),
    differenceInterval95Percent: sessionBootstrap(differences)};
}
function generalComparator(eligible: readonly VolatilityEvent[]): GeneralComparator {
  const matched = eligible.filter(item => item.generalControl30.meanPercent !== null);
  const diff = matched.map(item => ({date: item.dateNy,
    value: item.trajectories['30'].value! - item.generalControl30.meanPercent!}));
  return {matched: matched.length, coverage: eligible.length ? matched.length / eligible.length : null,
    matchedSignalMeanPercent: mean(matched.map(item => item.trajectories['30'].value!)),
    referenceMeanPercent: mean(matched.map(item => item.generalControl30.meanPercent!)),
    differenceMeanPercent: mean(diff.map(item => item.value)),
    differenceInterval95Percent: sessionBootstrap(diff),
    matchedSignalMfePercent: mean(matched.map(item => item.trajectories['30'].mfePercent!)),
    referenceMfePercent: mean(matched.map(item => item.generalControl30.meanMfePercent!)),
    differenceMfePercent: mean(matched.map(item => item.trajectories['30'].mfePercent! -
      item.generalControl30.meanMfePercent!)),
    matchedSignalMaePercent: mean(matched.map(item => item.trajectories['30'].maePercent!)),
    referenceMaePercent: mean(matched.map(item => item.generalControl30.meanMaePercent!)),
    differenceMaePercent: mean(matched.map(item => item.trajectories['30'].maePercent! -
      item.generalControl30.meanMaePercent!))};
}
function summarizeEvents(selected: readonly VolatilityEvent[], family: Family, scope: string,
  regime: Regime | 'all', horizon: typeof HORIZONS[number]): Summary {
  const eligible = selected.filter(item => item.trajectories[horizon.key].value !== null);
  const values = eligible.map(item => item.trajectories[horizon.key].value!);
  const mfe = eligible.map(item => item.trajectories[horizon.key].mfePercent!);
  const mae = eligible.map(item => item.trajectories[horizon.key].maePercent!);
  const excluded: Summary['excluded'] = {session_close: 0, missing_next: 0, missing_intermediate: 0};
  for (const item of selected) {
    const reason = item.trajectories[horizon.key].reason;
    if (reason) excluded[reason]++;
  }
  const sessions = new Set(eligible.map(item => item.dateNy)).size;
  const atrMfe = nonNull(eligible.map(item => item.trajectories[horizon.key].mfeAtrUnits));
  const atrMae = nonNull(eligible.map(item => item.trajectories[horizon.key].maeAtrUnits));
  const rangeMfe = nonNull(eligible.map(item => item.trajectories[horizon.key].mfeRange20Units));
  const rangeMae = nonNull(eligible.map(item => item.trajectories[horizon.key].maeRange20Units));
  const dated = (numbers: readonly number[]) => eligible.map((item, index) =>
    ({date: item.dateNy, value: numbers[index]!}));
  return {family, direction: family.endsWith('bullish') ? 'bullish' : 'bearish', scope, regime,
    horizonMinutes: Number(horizon.key) as 15 | 30 | 60,
    signals: selected.length, eligible: eligible.length, distinctSessions: sessions,
    smallSample: eligible.length < 30 || sessions < 10, excluded,
    positiveRate: values.length ? values.filter(value => value > 0).length / values.length : null,
    meanSignedPercent: mean(values), sdSignedPercent: sd(values),
    meanMfePercent: mean(mfe), meanMaePercent: mean(mae),
    mfeQuantilesPercent: quantiles(mfe), maeQuantilesPercent: quantiles(mae),
    meanMfeAtrUnits: mean(atrMfe), meanMaeAtrUnits: mean(atrMae), normalizedAtrCount: atrMfe.length,
    meanMfeRange20Units: mean(rangeMfe), meanMaeRange20Units: mean(rangeMae),
    normalizedRange20Count: rangeMfe.length,
    meanInterval95Percent: sessionBootstrap(dated(values)),
    mfeInterval95Percent: sessionBootstrap(dated(mfe)),
    maeInterval95Percent: sessionBootstrap(dated(mae)),
    costs: costs(values), originalControl: originalComparator(eligible, horizon.key),
    generalControl: horizon.key === '30' ? generalComparator(eligible) : null};
}
function summarizeGeneral(windows: readonly GeneralWindow[], scope: string, direction: Side): GeneralSummary {
  const eligible = windows.filter(item => item[direction].value !== null);
  const values = eligible.map(item => item[direction].value!);
  const mfe = eligible.map(item => item[direction].mfePercent!);
  const mae = eligible.map(item => item[direction].maePercent!);
  const excluded: GeneralSummary['excluded'] =
    {session_close: 0, missing_next: 0, missing_intermediate: 0};
  for (const item of windows) {
    const reason = item[direction].reason;
    if (reason) excluded[reason]++;
  }
  return {scope, direction, windows: windows.length, eligible: eligible.length,
    distinctSessions: new Set(eligible.map(item => item.dateNy)).size, excluded,
    positiveRate: values.length ? values.filter(value => value > 0).length / values.length : null,
    meanSignedPercent: mean(values), sdSignedPercent: sd(values),
    meanMfePercent: mean(mfe), meanMaePercent: mean(mae),
    mfeQuantilesPercent: quantiles(mfe), maeQuantilesPercent: quantiles(mae), costs: costs(values)};
}
function sameNumber(a: number | null, b: number | null): boolean {
  return a === b || a !== null && b !== null && Math.abs(a - b) < 1e-12;
}

export function studyNvdaVolatility(candles: readonly Candle[], calendar: MarketCalendar,
  phase11: Phase11Study, phase12: FailedBreakoutStudy, asOf = Date.now()): VolatilityStudy {
  if (!candles.length || Date.parse(candles.at(-1)!.timestamp) + 900_000 > asOf) {
    throw new Error('La última vela de 15 minutos aún no terminó.');
  }
  const calendarAudit = auditNvdaCalendar(candles, calendar);
  const atr = buildDailyAtr(candles, calendar);
  const atrByDate = new Map(atr.map(item => [item.dateNy, item]));
  const ranges = buildPrior20Ranges(candles, calendar);
  const makeEvent = (item: {
    id: string; family: Family; sourcePhase: 11 | 12; direction: Side; index: number;
    dateNy: string; barStartUtc: string; availableAtUtc: string;
    segment: 'first70' | 'last30';
    horizons: Record<Horizon, {value: number | null; reason: HorizonReason | null;
      entryUtc: string | null; exitUtc: string | null}>;
    controls: Record<Horizon, OriginalMatch>;
  }): VolatilityEvent => {
    const candle = candles[item.index];
    if (!candle || candle.timestamp !== item.barStartUtc ||
        newYorkBarParts(candle.timestamp).day !== item.dateNy ||
        item.availableAtUtc !== new Date(Date.parse(candle.timestamp) + 900_000).toISOString()) {
      throw new Error(`Evento anterior con índice o reloj incongruente: ${item.id}`);
    }
    const {slot} = newYorkBarParts(candle.timestamp);
    const atrDay = atrByDate.get(item.dateNy);
    if (!atrDay) throw new Error('Sesión del evento ausente del calendario ATR.');
    const range: IntradayRange = ranges[item.index]!;
    const trajectories = Object.fromEntries(HORIZONS.map(horizon => [horizon.key,
      evaluateVolatilityTrajectory(candles, item.index, horizon.bars, item.direction,
        calendar, {atrDollar: atrDay.priorAtr14, range20Dollar: range.meanDollar})])) as
        Record<Horizon, Trajectory>;
    for (const horizon of HORIZONS) {
      const original = item.horizons[horizon.key], current = trajectories[horizon.key];
      if (!sameNumber(original.value, current.value) || original.reason !== current.reason ||
          original.entryUtc !== current.entryUtc || original.exitUtc !== current.exitUtc) {
        throw new Error(`Desenlace original modificado: ${item.id}, ${horizon.key}m.`);
      }
    }
    return {id: item.id, family: item.family, sourcePhase: item.sourcePhase,
      direction: item.direction, index: item.index, dateNy: item.dateNy, slotNy: slot,
      hourBlock: sessionBlock(slot), barStartUtc: candle.timestamp,
      availableAtUtc: item.availableAtUtc, segment: item.segment,
      regime: atrDay.regime, priorAtr14: atrDay.priorAtr14,
      priorAtr14Percent: atrDay.priorAtr14Percent,
      p33: atrDay.p33, p67: atrDay.p67, atrReferenceCount: atrDay.referenceCount,
      priorRange20Dollar: range.meanDollar, priorRange20Percent: range.meanPercent,
      range20Count: range.count, originalHorizons: item.horizons,
      originalControls: item.controls, trajectories,
      generalControl30: {meanPercent: null, meanMfePercent: null, meanMaePercent: null,
        observations: 0, sessions: 0, reason: 'regime_insufficient'}};
  };
  const events: VolatilityEvent[] = [];
  for (const event of phase11.events) {
    const family = `${event.strategy}_${event.direction}` as Family;
    events.push(makeEvent({id: `phase11:${family}:${event.index}`, family, sourcePhase: 11,
      direction: event.direction, index: event.index, dateNy: event.dateNy,
      barStartUtc: event.barStartUtc, availableAtUtc: event.availableAtUtc,
      segment: event.segment, horizons: event.horizons,
      controls: Object.fromEntries(HORIZONS.map(horizon => [horizon.key,
        {meanPercent: event.controls[horizon.key].meanPercent,
          observations: event.controls[horizon.key].controls,
          reason: event.controls[horizon.key].reason}])) as Record<Horizon, OriginalMatch>}));
  }
  for (const signal of phase12.signals) {
    const family: Family = signal.side === 'high' ? 'failed_high_bearish' : 'failed_low_bullish';
    events.push(makeEvent({id: `phase12:${signal.episodeId}`, family, sourcePhase: 12,
      direction: signal.direction, index: signal.confirmationIndex,
      dateNy: signal.dateNy, barStartUtc: signal.confirmationBarStartUtc,
      availableAtUtc: signal.availableAtUtc, segment: signal.segment,
      horizons: signal.horizons, controls: Object.fromEntries(HORIZONS.map(horizon =>
        [horizon.key, {meanPercent: signal.controls[horizon.key].meanPercent,
          observations: signal.controls[horizon.key].observations,
          reason: signal.controls[horizon.key].reason}])) as Record<Horizon, OriginalMatch>}));
  }
  const baselineWindows: GeneralWindow[] = candles.map((candle, index) => {
    const {day, slot} = newYorkBarParts(candle.timestamp);
    const atrDay = atrByDate.get(day);
    if (!atrDay) throw new Error('Sesión de línea base ausente del calendario ATR.');
    const range = ranges[index]!;
    const scales = {atrDollar: atrDay.priorAtr14, range20Dollar: range.meanDollar};
    return {index, dateNy: day, slotNy: slot, hourBlock: sessionBlock(slot),
      barStartUtc: candle.timestamp,
      availableAtUtc: new Date(Date.parse(candle.timestamp) + 900_000).toISOString(),
      regime: atrDay.regime, priorAtr14: atrDay.priorAtr14,
      priorAtr14Percent: atrDay.priorAtr14Percent,
      priorRange20Dollar: range.meanDollar, priorRange20Percent: range.meanPercent,
      bullish: evaluateVolatilityTrajectory(candles, index, 2, 'bullish', calendar, scales),
      bearish: evaluateVolatilityTrajectory(candles, index, 2, 'bearish', calendar, scales)};
  });
  const poolKey = (year: string, regime: Regime, direction: Side, block: number) =>
    [year, regime, direction, block].join('|');
  const pools = new Map<string, {date: string; trajectory: Trajectory}[]>();
  for (const window of baselineWindows) {
    if (window.regime === 'insufficient') continue;
    for (const direction of DIRECTIONS) {
      const trajectory = window[direction];
      if (trajectory.value === null) continue;
      const key = poolKey(window.dateNy.slice(0, 4), window.regime, direction, window.hourBlock);
      const pool = pools.get(key) ?? [];
      pool.push({date: window.dateNy, trajectory});
      pools.set(key, pool);
    }
  }
  for (const event of events) {
    if (event.trajectories['30'].value === null) {
      event.generalControl30.reason = 'horizon_incomplete';
      continue;
    }
    if (event.regime === 'insufficient') continue;
    const key = poolKey(event.dateNy.slice(0, 4), event.regime, event.direction, event.hourBlock);
    const pool = (pools.get(key) ?? []).filter(item => item.date !== event.dateNy);
    const sessions = new Set(pool.map(item => item.date)).size;
    event.generalControl30 = pool.length >= 10 && sessions >= 10 ?
      {meanPercent: mean(pool.map(item => item.trajectory.value!)),
        meanMfePercent: mean(pool.map(item => item.trajectory.mfePercent!)),
        meanMaePercent: mean(pool.map(item => item.trajectory.maePercent!)),
        observations: pool.length, sessions, reason: null} :
      {meanPercent: null, meanMfePercent: null, meanMaePercent: null,
        observations: pool.length, sessions, reason: 'insufficient_windows'};
  }
  const byFamily = (family: Family) => events.filter(item => item.family === family);
  const primary = HORIZONS[1];
  const years = [...new Set(candles.map(candle => candle.timestamp.slice(0, 4)))];
  const familyRows = FAMILIES.map(family => summarizeEvents(byFamily(family), family, 'total', 'all', primary));
  const regimeRows = FAMILIES.flatMap(family => REGIMES.map(regime => summarizeEvents(
    byFamily(family).filter(item => item.regime === regime), family, 'regime', regime, primary)));
  const yearRows = FAMILIES.flatMap(family => years.map(year => summarizeEvents(
    byFamily(family).filter(item => item.dateNy.startsWith(year)), family, year, 'all', primary)));
  const periodRows = FAMILIES.flatMap(family => (['first70', 'last30'] as const).map(segment =>
    summarizeEvents(byFamily(family).filter(item => item.segment === segment), family,
      segment, 'all', primary)));
  const horizonRows = FAMILIES.flatMap(family => HORIZONS.filter(item => item.key !== '30').map(horizon =>
    summarizeEvents(byFamily(family), family, 'total', 'all', horizon)));
  const baselineRegimeRows = REGIMES.flatMap(regime => DIRECTIONS.map(direction =>
    summarizeGeneral(baselineWindows.filter(item => item.regime === regime), regime, direction)));
  const baselineHourRows = Array.from({length: 7}, (_, hourBlock) => DIRECTIONS.map(direction =>
    summarizeGeneral(baselineWindows.filter(item => item.hourBlock === hourBlock),
      String(hourBlock), direction))).flat();
  const hourlyEventRows = Array.from({length: 7}, (_, hourBlock) => DIRECTIONS.map(direction => {
    const selected = events.filter(item => item.hourBlock === hourBlock && item.direction === direction);
    const eligible = selected.filter(item => item.trajectories['30'].value !== null);
    return {hourBlock, direction, signals: selected.length, eligible: eligible.length,
      sessionCloseExcluded: selected.filter(item => item.trajectories['30'].reason === 'session_close').length,
      meanSignedPercent: mean(eligible.map(item => item.trajectories['30'].value!)),
      meanMfePercent: mean(eligible.map(item => item.trajectories['30'].mfePercent!)),
      meanMaePercent: mean(eligible.map(item => item.trajectories['30'].maePercent!))};
  })).flat();
  const yearRegimeRows: YearRegime[] = FAMILIES.flatMap(family => REGIMES
    .filter(regime => regime !== 'insufficient').flatMap(regime => years.map(year => {
      const eligible = byFamily(family).filter(item => item.regime === regime &&
        item.dateNy.startsWith(year) && item.trajectories['30'].value !== null);
      const matched = eligible.filter(item => item.generalControl30.meanPercent !== null);
      return {family, regime, year, eligible: eligible.length,
        sessions: new Set(eligible.map(item => item.dateNy)).size,
        meanSignedPercent: mean(eligible.map(item => item.trajectories['30'].value!)),
        generalMatched: matched.length,
        differenceVsGeneralPercent: mean(matched.map(item => item.trajectories['30'].value! -
          item.generalControl30.meanPercent!))};
    })));
  const candidateAudit: CandidateAudit[] = regimeRows.filter(row => row.regime !== 'insufficient')
    .map(row => {
      const regime = row.regime as 'low' | 'medium' | 'high';
      const sufficient = row.eligible >= 100 && row.distinctSessions >= 50 &&
        (row.originalControl.coverage ?? 0) >= .8 && (row.generalControl?.coverage ?? 0) >= .8;
      const positiveNet10 = (row.costs.find(item => item.bps === 10)?.netMeanPercent ?? -Infinity) > 0;
      const general = row.generalControl!;
      const positiveGeneralDifference = (general.differenceMeanPercent ?? -Infinity) > 0 &&
        (general.differenceInterval95Percent?.[0] ?? -Infinity) > 0;
      const mfeOutweighsAdditionalMae = (general.differenceMfePercent ?? -Infinity) >
        Math.max(0, -(general.differenceMaePercent ?? -Infinity));
      const last = byFamily(row.family).filter(item => item.regime === regime &&
        item.segment === 'last30' && item.trajectories['30'].value !== null &&
        item.generalControl30.meanPercent !== null);
      const last30Positive = (mean(last.map(item => item.trajectories['30'].value! -
        item.generalControl30.meanPercent!)) ?? -Infinity) > 0;
      const qualified = yearRegimeRows.filter(item => item.family === row.family &&
        item.regime === regime && item.eligible >= 30);
      const positive = qualified.filter(item => (item.differenceVsGeneralPercent ?? -Infinity) > 0).length;
      const candidate = sufficient && positiveNet10 && positiveGeneralDifference &&
        mfeOutweighsAdditionalMae && last30Positive && qualified.length >= 2 &&
        positive > qualified.length / 2;
      return {family: row.family, regime, sufficient, positiveNet10,
        positiveGeneralDifference, mfeOutweighsAdditionalMae, last30Positive,
        qualifyingYears: qualified.length, positiveQualifyingYears: positive, candidate};
    });
  const qualifiedFamilies = FAMILIES.filter(family => regimeRows.filter(row =>
    row.family === family && row.regime !== 'insufficient' &&
    row.eligible >= 30 && row.distinctSessions >= 10).length >= 2).length;
  const candidateCells = candidateAudit.filter(item => item.candidate).length;
  const thirtyMinuteCoverage = events.length ?
    events.filter(item => item.trajectories['30'].value !== null).length / events.length : 0;
  return {sourceCandles: candles.length, firstTimestamp: candles[0]!.timestamp,
    lastTimestamp: candles.at(-1)!.timestamp, calendarAudit,
    atrCoverage: {completeSessions: atr.filter(item => item.complete).length,
      incompleteSessions: atr.filter(item => !item.complete).length,
      validTrueRanges: atr.filter(item => item.trueRange !== null).length,
      validAtr14: atr.filter(item => item.atr14 !== null).length,
      regimes: {low: atr.filter(item => item.regime === 'low').length,
        medium: atr.filter(item => item.regime === 'medium').length,
        high: atr.filter(item => item.regime === 'high').length,
        insufficient: atr.filter(item => item.regime === 'insufficient').length}},
    originalCounts: {phase11: phase11.events.length, phase12: phase12.signals.length},
    events, baselineWindows, familyRows, regimeRows, yearRows, periodRows,
    horizonRows, baselineRegimeRows, baselineHourRows, hourlyEventRows,
    yearRegimeRows, candidateAudit,
    decision: {label: candidateCells > 0 ? 'Patrón descriptivo para nueva hipótesis' :
      qualifiedFamilies >= 4 ? 'Patrones inconsistentes o demasiado pequeños' :
        'Información insuficiente', qualifiedFamilies, candidateCells,
      thirtyMinuteCoverage, thirtyMinuteMeasurable: thirtyMinuteCoverage >= .7}};
}
