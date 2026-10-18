import type {Candle} from './domain.ts';
import type {SmaValues} from './multitimeframe.ts';
import {parseOccSymbol} from './phase17-occ.ts';

export type FourOrder = 'bullish' | 'bearish' | 'other' | 'insufficient';
export type TrendSide = 'bullish' | 'bearish';
export const FOUR_PERIODS = [20, 40, 100, 200] as const;

export function fourOrder(values: SmaValues | null): FourOrder {
  if (!values || FOUR_PERIODS.some(period => values[period] === null)) return 'insufficient';
  const v = FOUR_PERIODS.map(period => values[period]!);
  if (v.every((value, index) => index === 0 || v[index - 1]! > value)) return 'bullish';
  if (v.every((value, index) => index === 0 || v[index - 1]! < value)) return 'bearish';
  return 'other';
}

export function fourDescriptor(values: SmaValues | null, previous: SmaValues | null,
  close: number) {
  const order = fourOrder(values);
  const slope = Object.fromEntries(FOUR_PERIODS.map(period => [period,
    values?.[period] !== null && values?.[period] !== undefined &&
    previous?.[period] !== null && previous?.[period] !== undefined ?
      values[period]! - previous[period]! : null])) as Record<20 | 40 | 100 | 200, number | null>;
  const priceDistance = Object.fromEntries(FOUR_PERIODS.map(period => [period,
    values?.[period] ? 100 * (close - values[period]!)/values[period]! : null])) as
    Record<20 | 40 | 100 | 200, number | null>;
  const pairs = [[20, 40], [40, 100], [100, 200]] as const;
  const separation = pairs.map(([a, b]) => values?.[a] && values?.[b] ?
    100 * (values[a]! - values[b]!)/values[b]! : null);
  const slopesAgree = order === 'bullish' ? FOUR_PERIODS.every(p => slope[p] !== null && slope[p]! > 0) :
    order === 'bearish' ? FOUR_PERIODS.every(p => slope[p] !== null && slope[p]! < 0) : null;
  const spreadNow = values?.[20] !== null && values?.[40] !== null && values?.[20] !== undefined && values?.[40] !== undefined ?
    values[20]! - values[40]! : null;
  const spreadPrev = previous?.[20] !== null && previous?.[40] !== null && previous?.[20] !== undefined && previous?.[40] !== undefined ?
    previous[20]! - previous[40]! : null;
  const cross20_40 = spreadNow !== null && spreadPrev !== null &&
    spreadNow * spreadPrev < 0 ? (spreadNow > 0 ? 'up' : 'down') : 'none';
  return {order, slope, priceDistance, separation, slopesAgree, cross20_40};
}

export function levelState(previousClose: number, bar: Candle, level: number) {
  if (!(level > 0)) throw new Error('Nivel inválido.');
  const previousSide = Math.sign(previousClose - level);
  const currentSide = Math.sign(bar.close - level);
  return {distancePercent: 100 * (bar.close - level)/level,
    relative: currentSide > 0 ? 'above' : currentSide < 0 ? 'below' : 'at',
    touch: bar.low <= level && bar.high >= level,
    crossClose: previousSide * currentSide < 0,
    crossDirection: previousSide * currentSide < 0 ? (currentSide > 0 ? 'up' : 'down') : null};
}

/** Labels known only when the current 15m bar has closed. */
export function pullbackState(previous: Candle, current: Candle, level: number,
  side: TrendSide): {approach: boolean; contact: boolean; closeOtherSide: boolean} {
  const sign = side === 'bullish' ? 1 : -1;
  const before = sign * (previous.close - level), after = sign * (current.close - level);
  const contact = before > 0 && current.low <= level && current.high >= level;
  return {approach: before > 0 && after > 0 && after < before && !contact,
    contact, closeOtherSide: before > 0 && after < 0};
}

export type HistoricalOptionQuote = {timestampUtc: string; bid: number; ask: number;
  bidSize: number; askSize: number};
export function quoteValidity(quote: HistoricalOptionQuote | null, decisionUtc: string,
  maxAgeSeconds = 60): 'valid' | 'missing' | 'future' | 'stale' | 'invalid' {
  if (!quote) return 'missing';
  const age = (Date.parse(decisionUtc) - Date.parse(quote.timestampUtc)) / 1000;
  if (!Number.isFinite(age)) return 'invalid';
  if (age < 0) return 'future';
  if (age > maxAgeSeconds) return 'stale';
  if (![quote.bid, quote.ask, quote.bidSize, quote.askSize].every(Number.isFinite) ||
      quote.bid < 0 || quote.ask <= 0 || quote.ask < quote.bid ||
      !Number.isInteger(quote.bidSize) || !Number.isInteger(quote.askSize) ||
      quote.bidSize <= 0 || quote.askSize <= 0) return 'invalid';
  return 'valid';
}

export type PilotContract = {occ: string; kind: 'CALL' | 'PUT'; strike: number;
  expiry: string; multiplier: number; adjusted: boolean};
function pilotOcc(value: string) {
  try {return parseOccSymbol(value);} catch {
    // Alpaca returns the same OSI fields with padding spaces removed.
    const match = /^([A-Z][A-Z0-9.]{0,5})(\d{6})([CP])(\d{8})$/.exec(value);
    if (!match) return null;
    try {return parseOccSymbol(match[1]!.padEnd(6, ' ') + match[2]! + match[3]! + match[4]!);}
    catch {return null;}
  }
}
export function selectPilotContract(contracts: readonly PilotContract[], side: TrendSide,
  knownUnderlying: number, evaluationUtc: string, underlying = 'NVDA'): PilotContract | null {
  const kind = side === 'bullish' ? 'CALL' : 'PUT';
  const minExpiry = Date.parse(evaluationUtc.slice(0, 10) + 'T00:00:00Z') + 7 * 86_400_000;
  return contracts.filter(c => {const occ = pilotOcc(c.occ);
    return occ !== null && c.kind === kind && c.multiplier === 100 && !c.adjusted &&
      occ.underlyingSymbol === underlying && occ.optionType === c.kind &&
      occ.strike === c.strike && occ.expiration === c.expiry &&
      Number.isFinite(c.strike) && c.strike > 0 && Date.parse(c.expiry + 'T00:00:00Z') >= minExpiry;})
    .sort((a, b) => Date.parse(a.expiry) - Date.parse(b.expiry) ||
      Math.abs(a.strike - knownUnderlying) - Math.abs(b.strike - knownUnderlying) ||
      a.occ.localeCompare(b.occ))[0] ?? null;
}

/** Quote-crossing and midpoint are separate hypothetical scenarios, never observed fills. */
export function evaluatePilotQuotes(entry: HistoricalOptionQuote | null,
  exit: HistoricalOptionQuote | null, entryDecisionUtc: string, exitDecisionUtc: string) {
  const entryStatus = quoteValidity(entry, entryDecisionUtc);
  const exitStatus = quoteValidity(exit, exitDecisionUtc);
  if (entryStatus !== 'valid' || exitStatus !== 'valid') return {
    evaluable: false, entryStatus, exitStatus, midpointReturnPct: null,
    crossedReturnPct: null, slippedReturnPct: null};
  const entryMid = (entry!.bid + entry!.ask) / 2, exitMid = (exit!.bid + exit!.ask) / 2;
  const ask = entry!.ask, bid = exit!.bid;
  return {evaluable: true, entryStatus, exitStatus,
    midpointReturnPct: 100 * (exitMid / entryMid - 1),
    crossedReturnPct: 100 * (bid / ask - 1),
    slippedReturnPct: 100 * ((bid * (1 - 0.0005)) / (ask * (1 + 0.0005)) - 1)};
}
