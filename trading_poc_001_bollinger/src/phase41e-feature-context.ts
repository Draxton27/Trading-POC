/** Compact, causal Phase 41E projection of the unmodified 41A/41B engine. */
import {SMA_PERIODS} from './multitimeframe.ts';
import type {SipSnapshot,FrameSnapshot} from './phase41b-context.ts';

export const CONTEXT_STATES=[
  'UNAVAILABLE','NO_CANDIDATE','POTENTIAL_NO_INTERACTION','INTERACTION_OBSERVED',
  'REJECTION_OBSERVED','BREAK_OBSERVED','RETEST_PENDING','RETEST_CONFIRMED',
  'RETEST_EXPIRED','RECOVERY_OBSERVED',
] as const;
export type ContextState=typeof CONTEXT_STATES[number];
type Side='ceiling'|'floor';

export function fullSmaOrder(frame:FrameSnapshot):string{
  const values=SMA_PERIODS.map(period=>({period,value:frame.sma[period].value}));
  if(values.some(item=>item.value===null))return 'UNAVAILABLE';
  if(new Set(values.map(item=>item.value)).size!==4)return 'TIED';
  return values.sort((a,b)=>b.value!-a.value!).map(item=>item.period).join('>');
}

export function candidateContext(frame:FrameSnapshot,sipClose:number|null,side:Side){
  if(sipClose===null||SMA_PERIODS.some(period=>frame.sma[period].value===null))
    return {state:'UNAVAILABLE' as ContextState,periods:[] as number[],evidence:[] as object[]};
  const periods:number[]=[],evidence:object[]=[];
  let best:ContextState='NO_CANDIDATE';
  const rank=(state:ContextState)=>CONTEXT_STATES.indexOf(state);
  for(const period of SMA_PERIODS){
    const sma=frame.sma[period],value=sma.value!;
    const interactions=sma.interactions;
    const events=frame.events.filter(event=>event.period===period);
    const eligible=side==='ceiling'?sipClose<=value:sipClose>=value;
    // A crossing or retest at the observed bar may be relevant even when the
    // closing price has moved across the level. Retain its actual direction.
    if(!eligible&&!events.length&&!interactions.some(i=>i.startsWith('CROSSED_')))continue;
    periods.push(period);
    let state:ContextState='POTENTIAL_NO_INTERACTION';
    if(interactions.some(i=>i.startsWith('TOUCHED_'))||sipClose===value)state='INTERACTION_OBSERVED';
    if(interactions.some(i=>i.startsWith('CROSSED_'))||events.some(e=>e.kind==='CROSS'||e.kind==='FULL_CANDLE_BREAK'))state='BREAK_OBSERVED';
    if(events.some(e=>e.kind==='REJECTION'))state='REJECTION_OBSERVED';
    if(events.some(e=>e.kind==='RECOVERY'))state='RECOVERY_OBSERVED';
    if(events.some(e=>e.kind==='RETEST'&&e.status==='EXPIRED'))state='RETEST_EXPIRED';
    if(events.some(e=>e.kind==='RETEST'&&e.status==='PENDING'))state='RETEST_PENDING';
    if(events.some(e=>e.kind==='RETEST'&&e.status==='OBSERVED'))state='RETEST_CONFIRMED';
    if(rank(state)>rank(best))best=state;
    evidence.push({period,position:sipClose<value?'BELOW':sipClose>value?'ABOVE':'EQUAL',
      approach:interactions.includes('TOUCHED_FROM_BELOW')?'FROM_BELOW':
        interactions.includes('TOUCHED_FROM_ABOVE')?'FROM_ABOVE':'UNDETERMINED',
      interactions,events:events.map(({kind,direction,status,atUtc,breakAtUtc})=>({kind,direction,status,atUtc,breakAtUtc}))});
  }
  return {state:best,periods,evidence};
}

export function projectPhase41e(snapshot:SipSnapshot){
  const frame=snapshot.frames['15m'];
  const ceiling=candidateContext(frame,snapshot.sipClose,'ceiling');
  const floor=candidateContext(frame,snapshot.sipClose,'floor');
  const features={
    sma_full_order_15m:fullSmaOrder(frame),
    sma_short_pair_alignment_15m:frame.shortPair,
    sma_long_pair_alignment_15m:frame.longPair,
    sma20_slope_15m:frame.sma[20].slope,
    sma40_slope_15m:frame.sma[40].slope,
    sma100_slope_15m:frame.sma[100].slope,
    sma200_slope_15m:frame.sma[200].slope,
    price_relative_sma20_15m:frame.sma[20].distancePercent===null?null:frame.sma[20].distancePercent/100,
    price_relative_sma40_15m:frame.sma[40].distancePercent===null?null:frame.sma[40].distancePercent/100,
    price_relative_sma100_15m:frame.sma[100].distancePercent===null?null:frame.sma[100].distancePercent/100,
    price_relative_sma200_15m:frame.sma[200].distancePercent===null?null:frame.sma[200].distancePercent/100,
    candidate_ceiling_context_15m:ceiling.state,
    candidate_floor_context_15m:floor.state,
    alignment_1h:snapshot.frames['1h'].state,
    alignment_1d:snapshot.frames['1d'].state,
  };
  return {features,audit:{reason:snapshot.reason,currentBarDelayNotMet:snapshot.currentBarDelayNotMet,
    sipBarStartUtc:frame.barStartUtc,sipBarEndUtc:frame.barEndUtc,
    assumedAvailableAtUtc:frame.assumedAvailableAtUtc,
    frameEnds:{'1h':snapshot.frames['1h'].barEndUtc,'1d':snapshot.frames['1d'].barEndUtc},
    frameAvailability:{'1h':snapshot.frames['1h'].assumedAvailableAtUtc,'1d':snapshot.frames['1d'].assumedAvailableAtUtc},
    continuousBars:Object.fromEntries(['15m','1h','1d'].map(key=>[key,snapshot.frames[key as '15m'|'1h'|'1d'].continuousBars])),
    ceiling,floor,availability:snapshot.availability}};
}
