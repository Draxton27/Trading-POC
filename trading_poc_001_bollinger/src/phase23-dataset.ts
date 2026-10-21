import type {Candle} from './domain.ts';
import type {MarketCalendar} from './alpaca-calendar.ts';
import {calculateBollinger} from './bollinger.ts';
import {calculateEma9} from './ema9.ts';
import {auditNvdaCalendar, evaluateNvdaHorizon} from './nvda-indicators-study.ts';
import {newYorkBarParts} from './strategy-validation.ts';

const BAR_MS = 15 * 60_000;
export const DATASET_SPEC = 'nvda-15m-v1';
export type Partition = 'desarrollo' | 'evaluacion_exploratoria';
export type Label = 'ALCISTA' | 'BAJISTA' | 'LATERAL';
export type DatasetRow = {
  partition: Partition; session_date_ny: string; session: 'regular'; bar_start_ny: string;
  bar_start_utc: string; observed_at_utc: string; available_at_utc: string;
  minutes_from_open: number; return_1: number; return_4: number;
  distance_ema9: number; distance_sma20: number; bollinger_position: number;
  relative_volume_20: number; candle_range: number; candle_body: number; atr14_relative: number;
  label: Label; label_entry_utc: string; label_available_at_utc: string;
  label_entry_open: number; label_exit_close: number; label_change: number; label_atr14_price_units: number;
};
type Features = Pick<DatasetRow, 'return_1'|'return_4'|'distance_ema9'|'distance_sma20'|
  'bollinger_position'|'relative_volume_20'|'candle_range'|'candle_body'|'atr14_relative'>;
type Calculated = Features & {atr14PriceUnits:number};
type Reason = 'fuera_de_periodo' | 'sesion_incompleta' | 'historial_o_indicador_insuficiente' |
  'cierre_sesion' | 'falta_siguiente' | 'falta_intermedia' | 'purga_particion';

export function classifyMovement(change: number, atr: number): Label {
  if (!Number.isFinite(change) || !Number.isFinite(atr) || atr < 0) throw new Error('Movimiento o ATR inválido.');
  return change > 0.5 * atr ? 'ALCISTA' : change < -0.5 * atr ? 'BAJISTA' : 'LATERAL';
}

function partition(day: string): Partition | null {
  return day < '2025-01-01' ? 'desarrollo' : day < '2027-01-01' ? 'evaluacion_exploratoria' : null;
}
function minutes(slot: string): number {const [h,m]=slot.split(':').map(Number);return h!*60+m!;}

/** Never bridge an intraday gap, a missing session, or an incomplete overnight boundary. */
function contiguous(previous: Candle, current: Candle, calendar: MarketCalendar, priorDay: Map<string,string>): boolean {
  const a=newYorkBarParts(previous.timestamp), b=newYorkBarParts(current.timestamp);
  if(a.day===b.day)return Date.parse(current.timestamp)-Date.parse(previous.timestamp)===BAR_MS;
  const before=calendar.get(a.day),after=calendar.get(b.day);
  return priorDay.get(b.day)===a.day && before!==undefined && after!==undefined &&
    minutes(a.slot)+15===before.close && minutes(b.slot)===after.open;
}

/** The latest causally continuous segment. It is shared so inference preserves Fase 23's EMA state. */
export function phase23ContinuousSuffix(candles:readonly Candle[],calendar:MarketCalendar):Candle[]{
  if(!candles.length)return [];
  const days=[...calendar.keys()].sort(),priorDay=new Map(days.slice(1).map((day,i)=>[day,days[i]!]));
  let start=candles.length-1;
  for(;start>0;start--){
    const previous=candles[start-1]!,current=candles[start]!,previousLocal=newYorkBarParts(previous.timestamp),currentLocal=newYorkBarParts(current.timestamp);
    // Missing official hours are ambiguous at a session boundary; never silently restart EMA there.
    if(!calendar.has(previousLocal.day)||!calendar.has(currentLocal.day))throw new Error('Calendario oficial incompleto para la continuidad de Fase 23.');
    if(!contiguous(previous,current,calendar,priorDay))break;
  }
  const first=newYorkBarParts(candles[start]!.timestamp);if(!calendar.has(first.day))throw new Error('Calendario oficial incompleto para la continuidad de Fase 23.');
  return candles.slice(start);
}

/** Indicators restart at a gap; all values in a feature row use candles through t only. */
export function calculatePhase23Features(candles: readonly Candle[], calendar: MarketCalendar): (Calculated|null)[] {
  const days=[...calendar.keys()].sort();
  const priorDay=new Map(days.slice(1).map((day,i)=>[day,days[i]!]));
  const features:(Calculated|null)[]=Array(candles.length).fill(null);
  for(let start=0;start<candles.length;){
    let end=start+1;while(end<candles.length&&contiguous(candles[end-1]!,candles[end]!,calendar,priorDay))end++;
    const segment=candles.slice(start,end), ema=calculateEma9(segment), bands=calculateBollinger(segment);
    for(let j=20;j<segment.length;j++){
      const bar=segment[j]!, band=bands[j]!, currentEma=ema[j]!;
      const volumes=segment.slice(j-20,j), meanVolume=volumes.reduce((sum,c)=>sum+c.volume,0)/20;
      const trueRanges=segment.slice(j-13,j+1).map((c,k)=>{const prior=segment[j-14+k]!;
        return Math.max(c.high-c.low,Math.abs(c.high-prior.close),Math.abs(c.low-prior.close));});
      const atr=trueRanges.reduce((sum,n)=>sum+n,0)/14;
      if(band.middle===null||band.lower===null||band.upper===null||band.upper<=band.lower||meanVolume<=0||currentEma<=0)continue;
      const values:Calculated={return_1:bar.close/segment[j-1]!.close-1,return_4:bar.close/segment[j-4]!.close-1,
        distance_ema9:bar.close/currentEma-1,distance_sma20:bar.close/band.middle-1,
        bollinger_position:(bar.close-band.lower)/(band.upper-band.lower),relative_volume_20:bar.volume/meanVolume,
        candle_range:(bar.high-bar.low)/bar.open,candle_body:(bar.close-bar.open)/bar.open,atr14_relative:atr/bar.close,atr14PriceUnits:atr};
      if(Object.values(values).every(Number.isFinite))features[start+j]=values;
    }
    start=end;
  }
  return features;
}

export function buildPhase23Dataset(candles: readonly Candle[], calendar: MarketCalendar) {
  const audit=auditNvdaCalendar(candles,calendar), features=calculatePhase23Features(candles,calendar);
  const counts=new Map<string,number>();for(const candle of candles){const day=newYorkBarParts(candle.timestamp).day;counts.set(day,(counts.get(day)??0)+1);}
  const incomplete=new Set([...calendar].filter(([day,h])=>counts.has(day)&&counts.get(day)!==(h.close-h.open)/15).map(([day])=>day));
  const exclusions:Record<Reason,number>={fuera_de_periodo:0,sesion_incompleta:0,historial_o_indicador_insuficiente:0,cierre_sesion:0,falta_siguiente:0,falta_intermedia:0,purga_particion:0};
  const rows:DatasetRow[]=[];
  for(const [i,bar] of candles.entries()){
    const local=newYorkBarParts(bar.timestamp), split=partition(local.day), h=calendar.get(local.day)!;
    if(split===null){exclusions.fuera_de_periodo++;continue;}
    const horizon=evaluateNvdaHorizon(candles,i,4,'CALL_CONTEXT',calendar);
    if(horizon.reason){const reason={session_close:'cierre_sesion',missing_next:'falta_siguiente',missing_intermediate:'falta_intermedia'} as const;exclusions[reason[horizon.reason]]++;continue;}
    if(incomplete.has(local.day)){exclusions.sesion_incompleta++;continue;}
    if(!features[i]){exclusions.historial_o_indicador_insuficiente++;continue;}
    const targetDay=newYorkBarParts(candles[i+4]!.timestamp).day;
    if(partition(targetDay)!==split){exclusions.purga_particion++;continue;}
    const entry=candles[i+1]!.open,exit=candles[i+4]!.close,change=exit-entry;
    const {atr14PriceUnits,...availableFeatures}=features[i]!;
    const observedAt=new Date(Date.parse(bar.timestamp)+BAR_MS).toISOString();
    rows.push({partition:split,session_date_ny:local.day,session:'regular',bar_start_ny:local.slot,
      bar_start_utc:bar.timestamp,observed_at_utc:observedAt,available_at_utc:observedAt,
      minutes_from_open:minutes(local.slot)-h.open,...availableFeatures,label:classifyMovement(change,atr14PriceUnits),
      label_entry_utc:horizon.entryUtc!,label_available_at_utc:horizon.exitUtc!,label_entry_open:entry,label_exit_close:exit,label_change:change,label_atr14_price_units:atr14PriceUnits});
  }
  return {rows,exclusions,audit};
}
