import type {Candle} from './domain.ts';
import {calculateBollinger} from './bollinger.ts';
import {calculateSmaPoints} from './multitimeframe.ts';

/** Historical bars may have been corrected or adjusted later; their close is not proof of receipt. */
export type EvidenceBar = Candle & {endUtc: string; availableAtUtc: string | null};
export type SourceEvidence = {
  provider: string; feed: string; adjustment: string; symbol: string;
  calendarVerified: boolean; licenseVerified: boolean; pointInTimeVerified: boolean;
};
export type CoverageStatus = 'VERIFICABLE' | 'NO_VERIFICABLE';

const instant = (value: string): number => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new Error('TIMESTAMP_INVALIDO');
  const result = Date.parse(value);
  if (!Number.isFinite(result) || new Date(result).toISOString() !== value) throw new Error('TIMESTAMP_INVALIDO');
  return result;
};

/** Audits a single intraday window against explicit, calendar-derived expected starts. */
export function auditWindow(bars: readonly EvidenceBar[], expectedStarts: readonly string[], minutes: 1 | 5 | 15 | 60,
  decisionUtc: string, source: SourceEvidence) {
  const decision = instant(decisionUtc), expected = new Set<number>();
  for (const item of expectedStarts) {
    const value = instant(item);
    if (value + minutes * 60_000 > decision || expected.has(value)) throw new Error('CALENDARIO_INVALIDO');
    expected.add(value);
  }
  const seen = new Set<number>();
  let previous = -Infinity, unavailable = 0;
  for (const bar of bars) {
    const start = instant(bar.timestamp), end = instant(bar.endUtc);
    if (start <= previous || seen.has(start)) throw new Error('ORDEN_O_DUPLICADO_INVALIDO');
    previous = start; seen.add(start);
    if (end !== start + minutes * 60_000 || !expected.has(start)) throw new Error('VELA_FUERA_DE_CALENDARIO');
    if (![bar.open,bar.high,bar.low,bar.close,bar.volume].every(Number.isFinite) ||
      bar.low <= 0 || bar.volume < 0 || bar.high < Math.max(bar.open,bar.close,bar.low) ||
      bar.low > Math.min(bar.open,bar.close)) throw new Error('OHLCV_INVALIDO');
    const received = bar.availableAtUtc === null ? null : instant(bar.availableAtUtc);
    if (received !== null && received < end) throw new Error('DISPONIBILIDAD_ANTERIOR_AL_CIERRE');
    if (end >= decision || received === null || received >= decision) unavailable++;
  }
  const missing = [...expected].filter(t => !seen.has(t)).length;
  const sourceValid = Boolean(source.provider.trim() && source.feed.trim() && source.adjustment.trim() && source.symbol.trim()) &&
    source.calendarVerified && source.licenseVerified && source.pointInTimeVerified;
  const reasons = [missing && 'VELAS_FALTANTES', unavailable && 'DISPONIBILIDAD_NO_VERIFICADA',
    !sourceValid && 'PROCEDENCIA_NO_VERIFICADA', expected.size === 0 && 'VENTANA_VACIA'].filter(Boolean);
  return {status: (reasons.length ? 'NO_VERIFICABLE' : 'VERIFICABLE') as CoverageStatus,
    expected:expected.size, observed:bars.length, missing, unavailable, reasons};
}

/** Never compute a result over bars with gaps, unknown provenance, or unavailable at decision time. */
export function preEntryBollinger(bars: readonly EvidenceBar[], expectedStarts: readonly string[],
  decisionUtc: string, source: SourceEvidence) {
  const audit = auditWindow(bars, expectedStarts, 15, decisionUtc, source);
  if (audit.status !== 'VERIFICABLE' || bars.length < 20) return {status:'NO_VERIFICABLE' as const, value:null, audit};
  return {status:'VERIFICABLE' as const, value:calculateBollinger(bars).at(-1) ?? null, audit};
}

/** SMAs use only complete, verified hourly bars and the existing higher-timeframe implementation. */
export function preEntryHourlySma(bars:readonly EvidenceBar[],expectedStarts:readonly string[],decisionUtc:string,source:SourceEvidence){
  const audit=auditWindow(bars,expectedStarts,60,decisionUtc,source);
  if(audit.status!=='VERIFICABLE'||bars.length<20)return {status:'NO_VERIFICABLE' as const,value:null,audit};
  const aggregates=bars.map(bar=>({...bar,endTimestamp:bar.endUtc,availableAt:bar.availableAtUtc!,dateNy:'',
    timeframe:'hour' as const,durationMinutes:60,expectedSourceBars:1,observedSourceBars:1,complete:true,scheduledAbbreviated:false}));
  const point=calculateSmaPoints(aggregates).at(-1)!;
  return {status:'VERIFICABLE' as const,value:{values:point.values,previous:point.previous},audit};
}

/** Weighted provider VWAP, not an OHLC-derived approximation. The caller must provide all session minutes. */
export function preEntryVwap(bars:readonly (EvidenceBar & {providerVwap:number|null})[],expectedStarts:readonly string[],
  decisionUtc:string,source:SourceEvidence){
  const audit=auditWindow(bars,expectedStarts,1,decisionUtc,source);
  if(audit.status!=='VERIFICABLE'||bars.some(b=>b.providerVwap===null||!Number.isFinite(b.providerVwap)||b.providerVwap<=0))
    return {status:'NO_VERIFICABLE' as const,value:null,audit};
  const volume=bars.reduce((n,b)=>n+b.volume,0);
  if(volume<=0)return {status:'NO_VERIFICABLE' as const,value:null,audit};
  return {status:'VERIFICABLE' as const,value:bars.reduce((n,b)=>n+b.providerVwap!*b.volume,0)/volume,audit};
}
