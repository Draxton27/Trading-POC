/** Fase 38C: labels begin strictly after the simulated decision time. */
import {createHash} from 'node:crypto';
import type {Candle} from './domain.ts';
import type {MarketCalendar} from './alpaca-calendar.ts';
import {calculatePhase23Features,classifyMovement,DATASET_SPEC,type Label} from './phase23-dataset.ts';
import {PHASE31_FEATURES,type Phase31Feature} from './phase31-inference.ts';
import {newYorkBarParts} from './strategy-validation.ts';

const BAR_MS=15*60_000;
const DELAY_MS=20*60_000;
const minute=(slot:string)=>{const [hour,part]=slot.split(':').map(Number);return hour!*60+part!;};
const stamp=(value:number)=>new Date(value).toISOString();
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export type PostDecisionScenario='ideal'|'delayed';
export type PostDecisionObservation={
  mode:'HISTORICAL_REPLAY';phase:'38C';symbol:'NVDA';timeframe:'15m';scenario:PostDecisionScenario;
  session_date_ny:string;bar_start_utc:string;bar_end_utc:string;available_at_utc:string;
  historical_received_at_utc:null;features:Record<Phase31Feature,number>;feature_sha256:string;
  reference_entry_at_utc:string|null;minutes_until_reference_entry:number|null;
  label:Label|null;label_available_at_utc:string|null;label_entry_open:number|null;
  label_exit_close:number|null;label_atr14_price_units:number;
  exclusion:'MARKET_CLOSE'|'FUTURE_BARS_MISSING'|null;
};

/** Only the official session grid determines the first eligible opening. No candle lookup here. */
export function scheduledPostDecisionEntry(barStartUtc:string,availableAtUtc:string,
  localStartMinute:number,session:{open:number;close:number}):{entryAtUtc:string|null;horizonEndUtc:string|null;minutesUntilEntry:number|null}{
  const start=Date.parse(barStartUtc),available=Date.parse(availableAtUtc);
  if(!Number.isFinite(start)||!Number.isFinite(available)||available<start+BAR_MS||
      localStartMinute<session.open||(localStartMinute-session.open)%15!==0)throw new Error('Reloj o vela fuera del calendario.');
  const barsAfter=Math.floor((available-start)/BAR_MS)+1;
  const entryMinute=localStartMinute+barsAfter*15;
  if(entryMinute>=session.close)return {entryAtUtc:null,horizonEndUtc:null,minutesUntilEntry:null};
  const entry=start+barsAfter*BAR_MS;
  return {entryAtUtc:stamp(entry),horizonEndUtc:entryMinute+60<=session.close?stamp(entry+4*BAR_MS):null,
    minutesUntilEntry:(entry-available)/60_000};
}

export function postDecisionObservations(candles:readonly Candle[],calendar:MarketCalendar):PostDecisionObservation[]{
  const features=calculatePhase23Features(candles,calendar),byStart=new Map(candles.map(candle=>[candle.timestamp,candle]));
  const rows:PostDecisionObservation[]=[];
  for(const [index,bar] of candles.entries()){
    const local=newYorkBarParts(bar.timestamp),session=calendar.get(local.day);
    if(!session)throw new Error('Calendario oficial ausente para una vela NVDA.');
    const calculated=features[index];if(!calculated)continue;
    const {atr14PriceUnits,...values}=calculated;
    const ordered={...values,minutes_from_open:minute(local.slot)-session.open} as Record<Phase31Feature,number>;
    if(PHASE31_FEATURES.some(key=>!Number.isFinite(ordered[key])))throw new Error('Variable no finita.');
    const featureHash=hash(JSON.stringify({spec:DATASET_SPEC,names:PHASE31_FEATURES,values:ordered}));
    const end=Date.parse(bar.timestamp)+BAR_MS;
    for(const scenario of ['ideal','delayed'] as const){
      const available=end+(scenario==='delayed'?DELAY_MS:0);
      const schedule=scheduledPostDecisionEntry(bar.timestamp,stamp(available),minute(local.slot),session);
      let label:Label|null=null,labelAt:string|null=null,entryOpen:number|null=null,exitClose:number|null=null;
      let exclusion:PostDecisionObservation['exclusion']=null;
      if(schedule.horizonEndUtc===null)exclusion='MARKET_CLOSE';
      else {
        const entry=Date.parse(schedule.entryAtUtc!);
        const future=Array.from({length:4},(_,offset)=>byStart.get(stamp(entry+offset*BAR_MS)));
        if(future.some(candle=>!candle))exclusion='FUTURE_BARS_MISSING';
        else {
          entryOpen=future[0]!.open;exitClose=future[3]!.close;
          label=classifyMovement(exitClose-entryOpen,atr14PriceUnits);
          labelAt=schedule.horizonEndUtc;
        }
      }
      rows.push({mode:'HISTORICAL_REPLAY',phase:'38C',symbol:'NVDA',timeframe:'15m',scenario,
        session_date_ny:local.day,bar_start_utc:bar.timestamp,bar_end_utc:stamp(end),available_at_utc:stamp(available),
        historical_received_at_utc:null,features:ordered,feature_sha256:featureHash,
        reference_entry_at_utc:schedule.entryAtUtc,minutes_until_reference_entry:schedule.minutesUntilEntry,
        label,label_available_at_utc:labelAt,label_entry_open:entryOpen,label_exit_close:exitClose,
        label_atr14_price_units:atr14PriceUnits,exclusion});
    }
  }
  return rows;
}
