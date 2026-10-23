/** Historical research only. A prediction decision never inspects a later candle. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import type {Candle} from './domain.ts';
import type {MarketCalendar} from './alpaca-calendar.ts';
import {calculatePhase23Features,classifyMovement,DATASET_SPEC} from './phase23-dataset.ts';
import {PHASE31_FEATURES,type Phase31Feature} from './phase31-inference.ts';
import {newYorkBarParts} from './strategy-validation.ts';

const BAR_MS=900_000;
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const minutes=(slot:string)=>{const [h,m]=slot.split(':').map(Number);return h!*60+m!;};
export type ReplayObservation={mode:'HISTORICAL_REPLAY';symbol:'NVDA';timeframe:'15m';session_date_ny:string;bar_start_utc:string;bar_end_utc:string;features:Record<Phase31Feature,number>;feature_sha256:string;ideal_available_at_utc:string;delayed_available_at_utc:string;historical_received_at_utc:null;next_entry_at_utc:string;ideal_before_next_entry:boolean;delayed_before_next_entry:boolean;label:string|null;label_available_at_utc:string|null;exclusion:string|null};
export function replayObservations(candles:readonly Candle[],calendar:MarketCalendar):ReplayObservation[]{
  // calculatePhase23Features is causal per index; no session-completeness filter is applied.
  const calculated=calculatePhase23Features(candles,calendar),rows:ReplayObservation[]=[];
  for(let index=0;index<candles.length;index++){
    const bar=candles[index]!,local=newYorkBarParts(bar.timestamp),session=calendar.get(local.day);
    if(!session)throw new Error('Calendario oficial ausente para vela NVDA.');
    const feature=calculated[index];if(!feature)continue;
    const {atr14PriceUnits,...values}=feature;
    const ordered={...values,minutes_from_open:minutes(local.slot)-session.open} as Record<Phase31Feature,number>;
    if(PHASE31_FEATURES.some(key=>!Number.isFinite(ordered[key])))throw new Error('Variable no finita.');
    const start=Date.parse(bar.timestamp),end=start+BAR_MS,next=start+BAR_MS,outcome=start+5*BAR_MS;
    const ideal=new Date(end).toISOString(),delayed=new Date(end+20*60_000).toISOString();
    let exclusion:string|null=null,label:string|null=null,labelAt:string|null=null;
    if(minutes(local.slot)+75>session.close)exclusion='HORIZON_OUTSIDE_SESSION';
    else {
      const future=candles.slice(index+1,index+5),expected=[1,2,3,4].map(n=>new Date(start+n*BAR_MS).toISOString());
      if(future.length!==4||future.some((candidate,n)=>candidate.timestamp!==expected[n]))exclusion='OUTCOME_BARS_MISSING';
      else {label=classifyMovement(future[3]!.close-future[0]!.open,atr14PriceUnits);labelAt=new Date(outcome).toISOString();}
    }
    rows.push({mode:'HISTORICAL_REPLAY',symbol:'NVDA',timeframe:'15m',session_date_ny:local.day,bar_start_utc:bar.timestamp,bar_end_utc:ideal,features:ordered,feature_sha256:sha(JSON.stringify({spec:DATASET_SPEC,names:PHASE31_FEATURES,values:ordered})),ideal_available_at_utc:ideal,delayed_available_at_utc:delayed,historical_received_at_utc:null,next_entry_at_utc:new Date(next).toISOString(),ideal_before_next_entry:end<=next,delayed_before_next_entry:end+20*60_000<=next,label,label_available_at_utc:labelAt,exclusion});
  }
  return rows;
}
export function replaySourceHashes(paths:{csv:string;metadata:string;calendar:string;provenance:string}){
  return Object.fromEntries(Object.entries(paths).map(([key,path])=>[key,sha(readFileSync(path))]));
}
