import type {Candle, Direction, Signal} from './domain.ts';
import type {MarketCalendar} from './alpaca-calendar.ts';
import {calculateBollinger} from './bollinger.ts';
import {detectSignals} from './signals.ts';
import {calculateEma9} from './ema9.ts';
import {calculateVolumeReferences, VOLUME_MULTIPLIER} from './volume-filter.ts';
import {newYorkBarParts, type MovementSummary} from './strategy-validation.ts';

export const NVDA_HORIZONS = [1, 2, 4] as const;
export const NVDA_GROUPS = ['bollinger', 'ema9', 'volume', 'ema9_volume'] as const;
export type Group = typeof NVDA_GROUPS[number];
export type Segment = 'exploracion' | 'evaluacion';
export type HorizonReason = 'session_close' | 'missing_next' | 'missing_intermediate';
export type HorizonResult = {value: number | null; reason: HorizonReason | null; entryUtc: string | null; exitUtc: string | null};
export type SignalRecord = {
  signal: Signal; dateNy: string; slotNy: string; segment: Segment;
  bollinger: {middle: number; upper: number; lower: number};
  ema9: number; previousEma9: number; emaPass: boolean; closeAboveEma: boolean;
  volume: number; averageVolume20: number | null; rvol: number | null; volumePass: boolean | null;
  horizons: Record<'15' | '30' | '60', HorizonResult>;
};
export type StudyRow = {
  segment: Segment | 'total'; direction: Direction; horizonMinutes: number; group: Group;
  original: number; coverage: number; retained: number; discarded: number; insufficient: number;
  eligible: MovementSummary; distinctSessions: number;
  excluded: Record<HorizonReason, number>;
  comparableOriginal: MovementSummary;
  differenceMeanPercent: number | null; differenceFavorableRate: number | null;
  differenceInterval95Percent: [number, number] | null;
  matchedControls: number; controlObservations: number; matchedSignalMeanPercent: number | null;
  controlMeanPercent: number | null; differenceVsControlPercent: number | null;
  differenceVsControlInterval95Percent: [number, number] | null;
  smallSample: boolean;
};
export type NvdaIndicatorsStudy = {
  candleCount: number; firstTimestamp: string; lastTimestamp: string;
  calendarAudit: {calendarSessions: number; observedSessions: number; missingSessions: string[]; partialSessions: {date: string; observed: number; expected: number}[]};
  splitDate: string | null; sessionCounts: {exploracion: number; evaluacion: number};
  signalCount: number; signals: SignalRecord[]; rows: StudyRow[];
};
const BAR_MS = 900_000;
const DIRECTIONS: Direction[] = ['CALL_CONTEXT', 'PUT_CONTEXT'];

function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}
function movement(values: readonly number[]): MovementSummary {
  const gains = values.filter(v => v > 0), losses = values.filter(v => v < 0);
  return {count: values.length, favorableRate: values.length ? gains.length / values.length : null,
    meanSignedPercent: mean(values), meanGainPercent: mean(gains), meanLossPercent: mean(losses),
    meanAbsolutePercent: mean(values.map(Math.abs))};
}
function minute(slot: string): number {
  const [hour, minute] = slot.split(':').map(Number);
  return hour! * 60 + minute!;
}
function checkBar(candle: Candle, calendar: MarketCalendar): void {
  const start = Date.parse(candle.timestamp);
  const {day, slot} = newYorkBarParts(candle.timestamp);
  const schedule = calendar.get(day);
  const localMinute = minute(slot);
  if (!Number.isFinite(start) || start % BAR_MS !== 0 || !schedule ||
      localMinute < schedule.open || localMinute + 15 > schedule.close ||
      (localMinute - schedule.open) % 15 !== 0) {
    throw new Error(`Vela fuera de calendario regular de 15 minutos: ${candle.timestamp}`);
  }
}
export function auditNvdaCalendar(candles: readonly Candle[], calendar: MarketCalendar): NvdaIndicatorsStudy['calendarAudit'] {
  if (!candles.length) throw new Error('Se requieren velas NVDA.');
  const counts = new Map<string, number>();
  let previous = -Infinity;
  for (const candle of candles) {
    checkBar(candle, calendar);
    const time = Date.parse(candle.timestamp);
    if (time <= previous) throw new Error('Velas desordenadas o duplicadas.');
    previous = time;
    const day = newYorkBarParts(candle.timestamp).day;
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const first = [...counts.keys()][0]!, last = [...counts.keys()].at(-1)!;
  const range = [...calendar].filter(([date]) => date >= first && date <= last);
  const missingSessions = range.filter(([date]) => !counts.has(date)).map(([date]) => date);
  const partialSessions = range.flatMap(([date, schedule]) => {
    const observed = counts.get(date);
    const expected = (schedule.close - schedule.open) / 15;
    return observed !== undefined && observed !== expected ? [{date, observed, expected}] : [];
  });
  return {calendarSessions: range.length, observedSessions: counts.size, missingSessions, partialSessions};
}

/** Entry is the next consecutive bar's open; all bars through exit must remain in the same scheduled session. */
export function evaluateNvdaHorizon(candles: readonly Candle[], index: number, bars: 1 | 2 | 4,
  direction: Direction, calendar: MarketCalendar): HorizonResult {
  if (!Number.isInteger(index) || index < 0 || index >= candles.length) throw new Error('Índice de vela inválido.');
  const start = Date.parse(candles[index]!.timestamp);
  const {day, slot} = newYorkBarParts(candles[index]!.timestamp);
  const schedule = calendar.get(day);
  if (!schedule) throw new Error('Sesión ausente del calendario.');
  if (minute(slot) + (bars + 1) * 15 > schedule.close) {
    return {value: null, reason: 'session_close', entryUtc: null, exitUtc: null};
  }
  for (let offset = 1; offset <= bars; offset++) {
    const next = candles[index + offset];
    if (!next || Date.parse(next.timestamp) !== start + offset * BAR_MS || newYorkBarParts(next.timestamp).day !== day) {
      return {value: null, reason: offset === 1 ? 'missing_next' : 'missing_intermediate', entryUtc: null, exitUtc: null};
    }
  }
  const entry = candles[index + 1]!, exit = candles[index + bars]!;
  const raw = (exit.close / entry.open - 1) * 100;
  return {value: direction === 'CALL_CONTEXT' ? raw : -raw, reason: null,
    entryUtc: entry.timestamp, exitUtc: new Date(Date.parse(exit.timestamp) + BAR_MS).toISOString()};
}
function groupStatus(record: SignalRecord, group: Group): 'retained' | 'discarded' | 'insufficient' {
  if (group === 'bollinger') return 'retained';
  if (group === 'ema9') return record.emaPass ? 'retained' : 'discarded';
  if (record.volumePass === null) return 'insufficient';
  return (group === 'volume' ? record.volumePass : record.volumePass && record.emaPass) ? 'retained' : 'discarded';
}
function bootstrapDifference(records: readonly SignalRecord[], group: Group, key: '15' | '30' | '60'): [number, number] | null {
  const byDay = new Map<string, SignalRecord[]>();
  for (const record of records) byDay.set(record.dateNy, [...(byDay.get(record.dateNy) ?? []), record]);
  const retained = records.filter(r => groupStatus(r, group) === 'retained');
  if (retained.length < 30 || new Set(retained.map(r => r.dateNy)).size < 10) return null;
  const days = [...byDay.values()];
  let seed = 936127;
  const random = () => {seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32;};
  const draws: number[] = [];
  for (let i = 0; i < 2000; i++) {
    let baseSum = 0, baseCount = 0, selectedSum = 0, selectedCount = 0;
    for (let j = 0; j < days.length; j++) {
      for (const r of days[Math.floor(random() * days.length)]!) {
        const value = r.horizons[key].value!;
        baseSum += value; baseCount++;
        if (groupStatus(r, group) === 'retained') {selectedSum += value; selectedCount++;}
      }
    }
    if (selectedCount) draws.push(selectedSum / selectedCount - baseSum / baseCount);
  }
  if (draws.length < 1900) return null;
  draws.sort((a, b) => a - b);
  return [draws[Math.floor(draws.length * .025)]!, draws[Math.floor(draws.length * .975)]!];
}
function bootstrapControlDifferences(items: readonly {day: string; value: number}[]): [number, number] | null {
  const byDay = new Map<string, number[]>();
  for (const item of items) byDay.set(item.day, [...(byDay.get(item.day) ?? []), item.value]);
  if (items.length < 30 || byDay.size < 10) return null;
  const days = [...byDay.values()];
  let seed = 412967;
  const random = () => {seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32;};
  const draws: number[] = [];
  for (let i = 0; i < 2000; i++) {
    let sum = 0, count = 0;
    for (let j = 0; j < days.length; j++) {
      for (const value of days[Math.floor(random() * days.length)]!) {sum += value; count++;}
    }
    draws.push(sum / count);
  }
  draws.sort((a,b) => a-b);
  return [draws[50]!, draws[1950]!];
}

export function studyNvdaIndicators(candles: readonly Candle[], calendar: MarketCalendar): NvdaIndicatorsStudy {
  const calendarAudit = auditNvdaCalendar(candles, calendar);
  const days = [...new Set(candles.map(c => newYorkBarParts(c.timestamp).day))];
  const splitDate = days.length < 2 ? null : days[Math.min(days.length - 1, Math.max(1, Math.round(days.length * .7)))]!;
  const points = calculateBollinger(candles);
  const signals = detectSignals(points, 100, .2, 1.05, 12, 15);
  const ema = calculateEma9(candles);
  const references = calculateVolumeReferences(candles);
  const records: SignalRecord[] = signals.map(signal => {
    const i = signal.index, candle = candles[i]!, point = points[i]!;
    const {day, slot} = newYorkBarParts(candle.timestamp);
    const currentEma = ema[i], previousEma = ema[i - 1];
    if (point.middle === null || point.upper === null || point.lower === null || currentEma == null || previousEma == null) {
      throw new Error('Señal sin indicadores disponibles.');
    }
    const averageVolume20 = references[i]!.average;
    const rvol = averageVolume20 !== null && averageVolume20 > 0 ? candle.volume / averageVolume20 : null;
    return {signal, dateNy: day, slotNy: slot, segment: splitDate !== null && day >= splitDate ? 'evaluacion' : 'exploracion',
      bollinger: {middle: point.middle, upper: point.upper, lower: point.lower},
      ema9: currentEma, previousEma9: previousEma,
      emaPass: signal.direction === 'CALL_CONTEXT' ? currentEma > previousEma : currentEma < previousEma,
      closeAboveEma: candle.close > currentEma, volume: candle.volume, averageVolume20, rvol,
      volumePass: rvol === null ? null : rvol >= VOLUME_MULTIPLIER,
      horizons: {
        '15': evaluateNvdaHorizon(candles, i, 1, signal.direction, calendar),
        '30': evaluateNvdaHorizon(candles, i, 2, signal.direction, calendar),
        '60': evaluateNvdaHorizon(candles, i, 4, signal.direction, calendar),
      }};
  });
  const signalIndices = new Set(signals.map(s => s.index));
  const controls = new Map<string, number[]>();
  for (let i = 0; i < candles.length; i++) {
    if (signalIndices.has(i)) continue;
    const {day, slot} = newYorkBarParts(candles[i]!.timestamp);
    const segment: Segment = splitDate !== null && day >= splitDate ? 'evaluacion' : 'exploracion';
    for (const direction of DIRECTIONS) for (const bars of NVDA_HORIZONS) {
      const value = evaluateNvdaHorizon(candles, i, bars, direction, calendar).value;
      if (value === null) continue;
      const key = `${segment}|${direction}|${bars}|${slot}`;
      controls.set(key, [...(controls.get(key) ?? []), value]);
    }
  }
  const rows: StudyRow[] = [];
  for (const segment of ['total', 'exploracion', 'evaluacion'] as const) for (const direction of DIRECTIONS) {
    const original = records.filter(r => (segment === 'total' || r.segment === segment) && r.signal.direction === direction);
    for (const bars of NVDA_HORIZONS) for (const group of NVDA_GROUPS) {
      const key = String(bars * 15) as '15' | '30' | '60';
      const classified = original.filter(r => groupStatus(r, group) !== 'insufficient');
      const selected = classified.filter(r => groupStatus(r, group) === 'retained');
      const eligible = selected.filter(r => r.horizons[key].value !== null);
      const comparable = classified.filter(r => r.horizons[key].value !== null);
      const eligibleValues = eligible.map(r => r.horizons[key].value!);
      const baseValues = comparable.map(r => r.horizons[key].value!);
      const excluded: Record<HorizonReason, number> = {session_close: 0, missing_next: 0, missing_intermediate: 0};
      for (const r of selected) {const reason = r.horizons[key].reason; if (reason) excluded[reason]++;}
      const matchedValues: number[] = [], controlMeans: number[] = [];
      const controlDifferences: {day: string; value: number}[] = [];
      let controlObservations = 0;
      for (const r of eligible) {
        const pool = controls.get(`${r.segment}|${direction}|${bars}|${r.slotNy}`) ?? [];
        if (pool.length) {
          const control = mean(pool)!;
          matchedValues.push(r.horizons[key].value!); controlMeans.push(control);
          controlDifferences.push({day:r.dateNy,value:r.horizons[key].value!-control});
          controlObservations += pool.length;
        }
      }
      const summary = movement(eligibleValues), base = movement(baseValues);
      const controlMean = mean(controlMeans), signalMean = mean(matchedValues);
      const distinctSessions = new Set(eligible.map(r => r.dateNy)).size;
      rows.push({segment, direction, horizonMinutes: bars * 15, group, original: original.length,
        coverage: classified.length, retained: selected.length, discarded: classified.length - selected.length,
        insufficient: original.length - classified.length, eligible: summary, distinctSessions, excluded,
        comparableOriginal: base,
        differenceMeanPercent: summary.meanSignedPercent === null || base.meanSignedPercent === null ? null : summary.meanSignedPercent - base.meanSignedPercent,
        differenceFavorableRate: summary.favorableRate === null || base.favorableRate === null ? null : summary.favorableRate - base.favorableRate,
        differenceInterval95Percent: bootstrapDifference(comparable, group, key),
        matchedControls: matchedValues.length, controlObservations, matchedSignalMeanPercent: signalMean,
        controlMeanPercent: controlMean, differenceVsControlPercent: signalMean === null || controlMean === null ? null : signalMean - controlMean,
        differenceVsControlInterval95Percent: bootstrapControlDifferences(controlDifferences),
        smallSample: eligible.length < 30 || distinctSessions < 10});
    }
  }
  return {candleCount: candles.length, firstTimestamp: candles[0]!.timestamp, lastTimestamp: candles.at(-1)!.timestamp,
    calendarAudit, splitDate, sessionCounts: {exploracion: days.filter(d => splitDate === null || d < splitDate).length,
      evaluacion: days.filter(d => splitDate !== null && d >= splitDate).length},
    signalCount: signals.length, signals: records, rows};
}
