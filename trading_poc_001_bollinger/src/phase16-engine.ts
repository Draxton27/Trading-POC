import type {Candle} from './domain.ts';
import type {MarketCalendar} from './alpaca-calendar.ts';
import {studyNvdaPullbackBreakout} from './nvda-pullback-breakout.ts';
import {studyNvdaFailedBreakouts} from './nvda-failed-breakouts.ts';
import {buildDailyAtr, buildPrior20Ranges, evaluateVolatilityTrajectory} from './nvda-volatility.ts';
import {classify, type Group} from './phase15-analysis.ts';
import {newYorkBarParts} from './strategy-validation.ts';
import {FORWARD_START, sha256, operationalStatus} from './phase16-ledger.ts';

export type Symbol = 'NVDA' | 'QQQ' | 'SMH';
export function requireAlpacaKeys(key?: string, secret?: string) {
  if (!key || !secret) throw new Error('Faltan credenciales Alpaca del entorno seguro.');
  return {'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret};
}
export type BarReceipt = {symbol: Symbol; candle: Candle; receivedAtUtc: string;
  provider: 'Alpaca Market Data API'; feed: 'sip'; adjustment: 'split';
  status: 'complete' | 'delayed' | 'recovered'; inputSha256: string};
export const barId = (symbol: Symbol, timestamp: string) => `bar:${symbol}:${timestamp}`;
export function canonicalBarHash(symbol: Symbol, candle: Candle): string {
  return sha256(JSON.stringify({symbol, timestamp: candle.timestamp, open: candle.open,
    high: candle.high, low: candle.low, close: candle.close, volume: candle.volume}));
}
export function validateBar(symbol: Symbol, candle: Candle, receivedAtUtc: string,
  calendar: MarketCalendar): BarReceipt {
  const start = Date.parse(candle.timestamp), received = Date.parse(receivedAtUtc);
  if (!Number.isFinite(start) || !Number.isFinite(received) || start % 900_000 !== 0 ||
      start + 900_000 > received ||
      ![candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite) ||
      candle.open <= 0 || candle.close <= 0 || candle.low <= 0 || candle.volume < 0 ||
      candle.low > Math.min(candle.open, candle.close) ||
      candle.high < Math.max(candle.open, candle.close) || candle.high < candle.low) {
    throw new Error(`Vela incompleta u OHLCV inválido: ${symbol} ${candle.timestamp}`);
  }
  const {day, slot} = newYorkBarParts(candle.timestamp);
  const session = calendar.get(day), [hour, minute] = slot.split(':').map(Number);
  const local = hour! * 60 + minute!;
  if (!session || local < session.open || local + 15 > session.close ||
      (local - session.open) % 15 !== 0) throw new Error('Vela fuera del calendario real.');
  return {symbol, candle, receivedAtUtc, provider: 'Alpaca Market Data API',
    feed: 'sip', adjustment: 'split',
    status: received - start - 900_000 > 900_000 ? 'delayed' : 'complete',
    inputSha256: canonicalBarHash(symbol, candle)};
}

export function fourBarReturn(candles: readonly Candle[], endUtc: string):
  {value: number | null; starts: string[]} {
  const index = candles.findIndex(c => c.timestamp === endUtc);
  if (index < 3) return {value: null, starts: []};
  const four = candles.slice(index - 3, index + 1);
  const date = newYorkBarParts(endUtc).day;
  if (four.length !== 4 || four.some((bar, i) =>
    newYorkBarParts(bar.timestamp).day !== date ||
    Date.parse(bar.timestamp) !== Date.parse(endUtc) - (3 - i) * 900_000)) {
    return {value: null, starts: []};
  }
  return {value: 100 * (four[3]!.close / four[0]!.open - 1),
    starts: four.map(c => c.timestamp)};
}

export type ForwardSignal = {id: string; family: string; direction: 'bullish' | 'bearish';
  index: number; dateNy: string; barStartUtc: string; availableAtUtc: string;
  generatedAtUtc: string; firstDetectedAtUtc: string; requiredDataReceivedAtUtc: string | null;
  nextEntryOpenUtc: string; primaryOutcomeEndUtc: string;
  firstDetectedBeforePrimaryOutcome: boolean; prospectiveBeforePrimaryOutcome: boolean;
  theoreticalEntryAssumesZeroLatency: true; executionAtTheoreticalOpen: 'not_demonstrated';
  observability: string; hypothesis: string;
  ruleId: string; detectorVersion: string; detectorHash: string;
  qqqFourReturnPercent: number | null; smhFourReturnPercent: number | null;
  marketGroup: Group; regime: string; indicators: Record<string, number | string | null>;
  knownEventIds: string[]; eventCalendarStatus: 'verified' | 'unavailable';
  sourceBarIds: string[]; feed: 'sip'; result: 'pending';
  recoveryReason: string | null;
  repeatedWithinFourBars: boolean; overlappingPrimaryOutcome: boolean};

export type KnownEvent = {id: string; timestampUtc: string; verifiedAtUtc: string};
export function knownAt(events: readonly KnownEvent[] | null, asOf: string): string[] {
  if (!events) return [];
  return events.filter(e => e.timestampUtc <= asOf && e.verifiedAtUtc <= asOf)
    .map(e => e.id).sort();
}

export function signalTiming(barStartUtc: string, firstDetectedAtUtc: string,
  historical: boolean) {
  const theoreticalEntryOpenUtc = new Date(Date.parse(barStartUtc) + 900_000).toISOString();
  const primaryOutcomeEndUtc = new Date(Date.parse(barStartUtc) + 2_700_000).toISOString();
  return {theoreticalEntryOpenUtc, primaryOutcomeEndUtc,
    firstDetectedBeforePrimaryOutcome: firstDetectedAtUtc < primaryOutcomeEndUtc,
    prospectiveBeforePrimaryOutcome: !historical && firstDetectedAtUtc < primaryOutcomeEndUtc,
    theoreticalEntryAssumesZeroLatency: true as const,
    executionAtTheoreticalOpen: 'not_demonstrated' as const};
}

/** Re-run frozen detectors on a prefix ending at the candidate bar. No later bar exists in the input. */
export function detectAt(options: {nvdaPrefix: readonly Candle[]; qqq: readonly Candle[];
  smh: readonly Candle[]; calendar: MarketCalendar; receipts: Map<string, BarReceipt>;
  generatedAtUtc: string; codeVersion: string; detectorHash: string;
  events: readonly KnownEvent[] | null; priorSignals: readonly ForwardSignal[];
  historical: boolean; recoveryReason: string | null;
  detectionClock?: () => string}): ForwardSignal[] {
  const {nvdaPrefix: nvda, qqq, smh, calendar, receipts, generatedAtUtc} = options;
  const last = nvda.at(-1);
  if (!last) return [];
  const index = nvda.length - 1;
  const close = new Date(Date.parse(last.timestamp) + 900_000).toISOString();
  if (close > generatedAtUtc && !options.historical) throw new Error('No se puede confirmar una vela futura.');
  const phase11 = studyNvdaPullbackBreakout(nvda, calendar, Date.parse(close));
  const phase12 = studyNvdaFailedBreakouts(nvda, calendar, Date.parse(close));
  const candidates = [
    ...phase11.events.filter(e => e.index === index).map(e => ({
      id: `phase11:${e.strategy}_${e.direction}:${e.index}`, family: `${e.strategy}_${e.direction}`,
      direction: e.direction, indicators: {hourSma20: e.hourSma20,
        hourSma100: e.hourSma100, daySma20: e.daySma20,
        bollingerUpper: e.bollingerUpper, bollingerLower: e.bollingerLower,
        ema9: e.ema9, rvol: e.rvol}, repeated: e.repeatedWithinFourBars,
      overlapping: e.overlappingPrimaryOutcome})),
    ...phase12.signals.filter(e => e.confirmationIndex === index).map(e => ({
      id: `phase12:${e.episodeId}`, family: `failed_${e.side}_${e.direction}`,
      direction: e.direction, indicators: {priorHigh: e.priorHigh,
        priorLow: e.priorLow, failureLag: e.failureLag,
        daySma20: e.sma.daySma20, hourSma100: e.sma.hourSma100,
        smaTrend: e.sma.trend}, repeated: e.repeatedWithinFourBars,
      overlapping: e.overlappingPrimaryOutcome})),
  ];
  const q = receivedFourBarReturn(qqq, 'QQQ', last.timestamp, receipts, generatedAtUtc);
  const s = receivedFourBarReturn(smh, 'SMH', last.timestamp, receipts, generatedAtUtc);
  const atr = buildDailyAtr(nvda, calendar).find(row => row.dateNy === newYorkBarParts(last.timestamp).day);
  const nvdaNeeded = [...new Set([barId('NVDA', last.timestamp),
    ...nvda.filter(c => c.timestamp >= FORWARD_START)
      .map(c => barId('NVDA', c.timestamp))])];
  const needed = [...new Set([barId('NVDA', last.timestamp), ...nvdaNeeded,
    ...q.starts.map(t => barId('QQQ', t)), ...s.starts.map(t => barId('SMH', t))])];
  const nvdaReceipts = nvdaNeeded.map(id => receipts.get(id)?.receivedAtUtc ?? null);
  const nvdaPresent = nvdaReceipts.every(Boolean);
  const latestReceipt = nvdaPresent ? nvdaReceipts.filter((v): v is string => v !== null)
    .sort().at(-1)! : null;
  const firstDetectedAtUtc = options.detectionClock?.() ?? generatedAtUtc;
  if (firstDetectedAtUtc < generatedAtUtc) throw new Error('Reloj de detección anterior al inicio.');
  return candidates.map(candidate => {
    const timing = signalTiming(last.timestamp, firstDetectedAtUtc, options.historical);
    const observability = !nvdaPresent ? 'missing_nvda_data' :
      operationalStatus(latestReceipt!, firstDetectedAtUtc, close,
        options.recoveryReason !== null, options.historical);
    const priorSame = options.priorSignals.filter(x => x.family === candidate.family &&
      x.dateNy === newYorkBarParts(last.timestamp).day && index - x.index < 4);
    return {id: candidate.id, family: candidate.family, direction: candidate.direction,
      index, dateNy: newYorkBarParts(last.timestamp).day,
      barStartUtc: last.timestamp, availableAtUtc: close,
      generatedAtUtc: firstDetectedAtUtc, firstDetectedAtUtc,
      requiredDataReceivedAtUtc: latestReceipt,
      nextEntryOpenUtc: close,
      primaryOutcomeEndUtc: timing.primaryOutcomeEndUtc,
      firstDetectedBeforePrimaryOutcome: timing.firstDetectedBeforePrimaryOutcome,
      prospectiveBeforePrimaryOutcome: timing.prospectiveBeforePrimaryOutcome,
      theoreticalEntryAssumesZeroLatency: timing.theoreticalEntryAssumesZeroLatency,
      executionAtTheoreticalOpen: timing.executionAtTheoreticalOpen, observability,
      hypothesis: 'Reglas congeladas Fases 11 y 12; desenlace firmado a 30 minutos pendiente',
      ruleId: candidate.id.startsWith('phase11:') ? 'phase11-frozen' : 'phase12-frozen',
      detectorVersion: options.codeVersion, detectorHash: options.detectorHash,
      qqqFourReturnPercent: q.value, smhFourReturnPercent: s.value,
      marketGroup: classify(candidate.direction, q.value, s.value),
      regime: atr?.regime ?? 'insufficient', indicators: candidate.indicators,
      knownEventIds: knownAt(options.events, close),
      eventCalendarStatus: options.events ? 'verified' : 'unavailable',
      sourceBarIds: needed, feed: 'sip', result: 'pending',
      recoveryReason: options.recoveryReason,
      repeatedWithinFourBars: candidate.repeated || priorSame.length > 0,
      overlappingPrimaryOutcome: candidate.overlapping};
  });
}

export function receivedFourBarReturn(candles: readonly Candle[], symbol: 'QQQ' | 'SMH',
  barStartUtc: string, receipts: ReadonlyMap<string, BarReceipt>, asOfUtc: string) {
  const result = fourBarReturn(candles, barStartUtc);
  if (result.value === null || result.starts.some(start => {
    const receipt = receipts.get(barId(symbol, start));
    return !receipt || receipt.receivedAtUtc > asOfUtc;
  })) return {value: null, starts: []};
  return result;
}

/** New information is appended; the frozen signal and its original market context remain intact. */
export function marketContextUpdate(signal: ForwardSignal, qqq: readonly Candle[],
  smh: readonly Candle[], receipts: ReadonlyMap<string, BarReceipt>, recordedAtUtc: string) {
  const q = receivedFourBarReturn(qqq, 'QQQ', signal.barStartUtc, receipts, recordedAtUtc);
  const s = receivedFourBarReturn(smh, 'SMH', signal.barStartUtc, receipts, recordedAtUtc);
  const sourceBars = (symbol: 'QQQ' | 'SMH') => Array.from({length: 4}, (_, offset) =>
    new Date(Date.parse(signal.barStartUtc) - (3 - offset) * 900_000).toISOString())
    .filter(start => newYorkBarParts(start).day === signal.dateNy)
    .flatMap(start => {
      const id = barId(symbol, start), receipt = receipts.get(id);
      return receipt && receipt.receivedAtUtc <= recordedAtUtc ?
        [{id, receivedAtUtc: receipt.receivedAtUtc,
          inputSha256: receipt.inputSha256}] : [];
    });
  const qBars = sourceBars('QQQ'), sBars = sourceBars('SMH');
  const qReceipt = qBars.map(bar => bar.receivedAtUtc).sort().at(-1) ?? null;
  const sReceipt = sBars.map(bar => bar.receivedAtUtc).sort().at(-1) ?? null;
  const late = [...qBars, ...sBars].some(bar => bar.receivedAtUtc > signal.generatedAtUtc);
  if (!late) return null;
  const group = classify(signal.direction, q.value, s.value);
  const availabilityAtUtc = [qReceipt, sReceipt].filter((at): at is string => at !== null).sort().at(-1)!;
  const payload = {signalId: signal.id, originalGeneratedAtUtc: signal.generatedAtUtc,
    originalMarketGroup: signal.marketGroup,
    originalQqqFourReturnPercent: signal.qqqFourReturnPercent,
    originalSmhFourReturnPercent: signal.smhFourReturnPercent,
    qqqFourReturnPercent: q.value, smhFourReturnPercent: s.value, marketGroup: group,
    qqqReceivedAtUtc: qReceipt, smhReceivedAtUtc: sReceipt,
    qqqSourceBars: qBars, smhSourceBars: sBars,
    availabilityAtUtc, recordedAtUtc,
    availableBeforePrimaryOutcome: availabilityAtUtc < signal.primaryOutcomeEndUtc &&
      recordedAtUtc < signal.primaryOutcomeEndUtc,
    originalSignalUnchanged: true};
  const id = `market_context:${signal.id}:${sha256(JSON.stringify({
    q: q.value, s: s.value, qBars, sBars}))}`;
  return {id, payload};
}

export function settleSignal(signal: ForwardSignal, nvda: readonly Candle[],
  calendar: MarketCalendar, nowUtc: string) {
  const index = nvda.findIndex(c => c.timestamp === signal.barStartUtc);
  if (index < 0) throw new Error('Señal sin vela original.');
  const scale = buildPrior20Ranges(nvda.slice(0, index + 1), calendar)[index]?.meanDollar ?? null;
  const atr = buildDailyAtr(nvda.slice(0, index + 1), calendar)
    .find(r => r.dateNy === signal.dateNy)?.priorAtr14 ?? null;
  const horizons = Object.fromEntries(([1, 2, 4] as const).map(bars => {
    const expectedExit = new Date(Date.parse(signal.barStartUtc) + (bars + 1) * 900_000).toISOString();
    if (expectedExit > nowUtc) return [String(bars * 15), {state: 'pending', value: null}];
    const trajectory = evaluateVolatilityTrajectory(nvda, index, bars, signal.direction,
      calendar, {atrDollar: atr, range20Dollar: scale});
    if ((trajectory.reason === 'missing_next' || trajectory.reason === 'missing_intermediate') &&
      Date.parse(nowUtc) < Date.parse(expectedExit) + 86_400_000) {
      return [String(bars * 15), {state: 'pending', value: null, reason: trajectory.reason}];
    }
    return [String(bars * 15), {state: trajectory.reason ? 'excluded' : 'final', ...trajectory}];
  }));
  return {signalId: signal.id, evaluatedAtUtc: nowUtc, entryTheoreticalUtc: signal.nextEntryOpenUtc,
    primaryOutcomeEndUtc: signal.primaryOutcomeEndUtc,
    firstDetectedBeforePrimaryOutcome: signal.firstDetectedBeforePrimaryOutcome,
    prospectiveBeforePrimaryOutcome: signal.prospectiveBeforePrimaryOutcome,
    signalObservability: signal.observability,
    executionAtTheoreticalOpen: 'not_demonstrated',
    operationallyAvailable: false,
    operationalReason: 'La apertura teórica exige latencia cero; no hay precio ejecutable verificado.',
    theoreticalOnly: true, horizons};
}
