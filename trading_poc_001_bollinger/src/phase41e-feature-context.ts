/** Compact, causal Phase 41E projection of the unmodified 41A/41B engine. */
import {SMA_PERIODS} from './multitimeframe.ts';
import type {SipSnapshot,FrameSnapshot} from './phase41b-context.ts';

export const CONTEXT_STATES=[
  'UNAVAILABLE','NO_CANDIDATE','POTENTIAL_NO_INTERACTION','INTERACTION_AT_LEVEL',
  'TOUCH_FROM_ABOVE','TOUCH_FROM_BELOW','CROSS_OBSERVED_ABOVE','CROSS_OBSERVED_BELOW',
  'FULL_BODY_STATE_ABOVE','FULL_BODY_STATE_BELOW','FULL_CANDLE_STATE_ABOVE','FULL_CANDLE_STATE_BELOW',
  'FULL_CANDLE_BREAK_OBSERVED_ABOVE','FULL_CANDLE_BREAK_OBSERVED_BELOW',
  'REJECTION_OBSERVED_ABOVE','REJECTION_OBSERVED_BELOW',
  'RETEST_PENDING_ABOVE','RETEST_PENDING_BELOW','RETEST_OBSERVED_ABOVE','RETEST_OBSERVED_BELOW',
  'RETEST_FAILED_ABOVE','RETEST_FAILED_BELOW','RETEST_EXPIRED_ABOVE','RETEST_EXPIRED_BELOW',
  'RECOVERY_FAILED_ABOVE','RECOVERY_FAILED_BELOW',
] as const;
export type ContextState=typeof CONTEXT_STATES[number];
type Side='ceiling'|'floor';
type Event=FrameSnapshot['events'][number];
type CandidateEventAudit={kind:Event['kind'];direction:Event['direction'];status:Event['status'];
  atUtc:string;barStartUtc:string;breakAtUtc:string|null;closingSide:ClosingSide;
  roleApplicability:'LEVEL_CROSSING_RETAINED'|'APPLIES_TO_ROLE'|'DIRECTION_DOES_NOT_CONFIRM_ROLE'|'CLOSING_SIDE_MISMATCH'};
type CandidateEvidence={period:number;position:'BELOW'|'ABOVE'|'EQUAL';eligible:boolean;candidate:boolean;
  contextRole:Side;approach:'FROM_ABOVE'|'FROM_BELOW'|'UNDETERMINED';
  interactions:FrameSnapshot['sma'][20]['interactions'];events:CandidateEventAudit[];selectedForState:boolean};

type ClosingSide='ABOVE'|'BELOW'|'EQUAL';
function expectedClosingSide(event:Event):ClosingSide|null{
  if(event.kind==='CROSS'||event.kind==='FULL_CANDLE_BREAK'||event.kind==='REJECTION')return event.direction;
  if(event.kind==='RETEST')return event.status==='FAILED'?(event.direction==='ABOVE'?'BELOW':'ABOVE'):event.direction;
  if(event.kind==='RECOVERY')return event.direction==='ABOVE'?'BELOW':'ABOVE';
  return null;
}

function eventAppliesToRole(event:Event,side:Side,closingSide:ClosingSide):boolean{
  // A crossing is evidence about the traversed level in either role. It is
  // deliberately called a crossing, never a confirmed ceiling/floor.
  if(event.kind==='CROSS'||event.kind==='FULL_CANDLE_BREAK')return true;
  if(closingSide!==expectedClosingSide(event))return false;
  if(event.kind==='REJECTION')return event.direction===(side==='ceiling'?'BELOW':'ABOVE');
  if(event.kind==='RETEST')return event.direction===(event.status==='FAILED'?
    (side==='ceiling'?'ABOVE':'BELOW'):(side==='ceiling'?'BELOW':'ABOVE'));
  // RECOVERY/FAILED means the break failed and price returned through the SMA.
  return event.direction===(side==='ceiling'?'ABOVE':'BELOW');
}

function eventRoleApplicability(event:Event,side:Side,closingSide:ClosingSide):CandidateEventAudit['roleApplicability']{
  if(event.kind==='CROSS'||event.kind==='FULL_CANDLE_BREAK')return 'LEVEL_CROSSING_RETAINED';
  if(closingSide!==expectedClosingSide(event))return 'CLOSING_SIDE_MISMATCH';
  return eventAppliesToRole(event,side,closingSide)?'APPLIES_TO_ROLE':'DIRECTION_DOES_NOT_CONFIRM_ROLE';
}

function eventState(event:Event):ContextState{
  const name=`${event.kind}_${event.status}_${event.direction}`;
  if((CONTEXT_STATES as readonly string[]).includes(name))return name as ContextState;
  throw new Error(`Evento 41A fuera del esquema 41E: ${name}`);
}

function interactionState(interaction:string):ContextState|null{
  const mapping:Record<string,ContextState>={
    EQUAL:'INTERACTION_AT_LEVEL',
    TOUCHED_FROM_ABOVE:'TOUCH_FROM_ABOVE',TOUCHED_FROM_BELOW:'TOUCH_FROM_BELOW',
    CROSSED_ABOVE:'CROSS_OBSERVED_ABOVE',CROSSED_BELOW:'CROSS_OBSERVED_BELOW',
    REJECTED_ABOVE:'REJECTION_OBSERVED_ABOVE',REJECTED_BELOW:'REJECTION_OBSERVED_BELOW',
    FULL_BODY_BREAK_ABOVE:'FULL_BODY_STATE_ABOVE',FULL_BODY_BREAK_BELOW:'FULL_BODY_STATE_BELOW',
    FULL_CANDLE_BREAK_ABOVE:'FULL_CANDLE_STATE_ABOVE',FULL_CANDLE_BREAK_BELOW:'FULL_CANDLE_STATE_BELOW',
  };
  return mapping[interaction]??null;
}

function interactionAppliesToRole(interaction:string,side:Side):boolean{
  if(interaction.startsWith('CROSSED_')||interaction.startsWith('FULL_BODY_BREAK_')||
      interaction.startsWith('FULL_CANDLE_BREAK_'))return true;
  if(interaction==='REJECTED_ABOVE'||interaction==='TOUCHED_FROM_ABOVE')return side==='floor';
  if(interaction==='REJECTED_BELOW'||interaction==='TOUCHED_FROM_BELOW')return side==='ceiling';
  return interaction==='EQUAL';
}

function compareText(a:string,b:string):number{return a<b?-1:a>b?1:0;}

/**
 * Pick a representative state using a reproducibility tie-break only:
 * latest event availability, shortest SMA period, then lexical event kind,
 * direction and status. This ordering does not rank predictive strength.
 */
function compareEvents(a:{event:FrameSnapshot['events'][number];period:number},
  b:{event:FrameSnapshot['events'][number];period:number}):number{
  return Date.parse(b.event.atUtc)-Date.parse(a.event.atUtc)||a.period-b.period||
    compareText(a.event.kind,b.event.kind)||compareText(a.event.direction,b.event.direction)||
    compareText(a.event.status,b.event.status);
}

export function fullSmaOrder(frame:FrameSnapshot):string{
  const values=SMA_PERIODS.map(period=>({period,value:frame.sma[period].value}));
  if(values.some(item=>item.value===null))return 'UNAVAILABLE';
  if(new Set(values.map(item=>item.value)).size!==4)return 'TIED';
  return values.sort((a,b)=>b.value!-a.value!).map(item=>item.period).join('>');
}

export function candidateContext(frame:FrameSnapshot,sipClose:number|null,side:Side){
  if(sipClose===null||SMA_PERIODS.some(period=>frame.sma[period].value===null))
    return {state:'UNAVAILABLE' as ContextState,periods:[] as number[],evidence:[] as CandidateEvidence[]};
  const periods:number[]=[],evidence:CandidateEvidence[]=[],selectedEvents:
    {event:Event;period:number}[]=[],selectedInteractions:
    {state:ContextState;period:number}[]=[];
  const decisionAt=frame.assumedAvailableAtUtc?Date.parse(frame.assumedAvailableAtUtc):Number.NEGATIVE_INFINITY;
  for(const period of SMA_PERIODS){
    const sma=frame.sma[period],value=sma.value!;
    const interactions=sma.interactions;
    const allEvents=frame.events.filter(event=>event.period===period);
    // Never let a future or unavailable event enter either the feature or its audit.
    const events=allEvents.filter(event=>Number.isFinite(Date.parse(event.atUtc))&&Date.parse(event.atUtc)<=decisionAt);
    const eligible=side==='ceiling'?sipClose<=value:sipClose>=value;
    const closingSide:ClosingSide=sipClose<value?'BELOW':sipClose>value?'ABOVE':'EQUAL';
    const roleEvents=events.filter(event=>eventAppliesToRole(event,side,closingSide));
    const roleInteractions=interactions.filter(interaction=>interactionAppliesToRole(interaction,side));
    // Crossings are retained for both contextual views because the level was
    // traversed even when the close now lies beyond it. Rejections/retests and
    // failed-break recoveries are admitted only to the role their direction supports.
    const candidate=eligible||roleEvents.length>0||roleInteractions.some(i=>
      i.startsWith('CROSSED_')||i.startsWith('FULL_BODY_BREAK_')||i.startsWith('FULL_CANDLE_BREAK_'));
    if(candidate)periods.push(period);
    selectedEvents.push(...roleEvents.map(event=>({event,period})));
    if(candidate&&!roleEvents.length){
      const states=roleInteractions.map(interaction=>interactionState(interaction)).filter((state):state is ContextState=>state!==null)
        .sort(compareText);
      if(states.length)selectedInteractions.push({state:states[0]!,period});
    }
    const eventRecords:CandidateEventAudit[]=events.map(event=>({kind:event.kind,direction:event.direction,status:event.status,
      atUtc:event.atUtc,barStartUtc:event.barStartUtc,breakAtUtc:event.breakAtUtc,closingSide,
      roleApplicability:eventRoleApplicability(event,side,closingSide)}));
    evidence.push({period,position:sipClose<value?'BELOW':sipClose>value?'ABOVE':'EQUAL',eligible,
      candidate,contextRole:side,
      approach:interactions.includes('TOUCHED_FROM_BELOW')?'FROM_BELOW':
        interactions.includes('TOUCHED_FROM_ABOVE')?'FROM_ABOVE':'UNDETERMINED',
      interactions,events:eventRecords,selectedForState:false});
  }
  selectedEvents.sort(compareEvents);
  let state:ContextState;
  let selectedPeriod:number|undefined;
  if(selectedEvents.length){state=eventState(selectedEvents[0]!.event);selectedPeriod=selectedEvents[0]!.period;}
  else if(selectedInteractions.length){
    selectedInteractions.sort((a,b)=>a.period-b.period||compareText(a.state,b.state));
    state=selectedInteractions[0]!.state;selectedPeriod=selectedInteractions[0]!.period;
  }else state=periods.length?'POTENTIAL_NO_INTERACTION':'NO_CANDIDATE';
  for(const item of evidence){
    if(item.period===selectedPeriod){
      const hasSelectedEvent=selectedEvents.length&&selectedEvents[0]!.period===selectedPeriod;
      const hasSelectedInteraction=selectedInteractions.length&&selectedInteractions[0]!.period===selectedPeriod;
      if(hasSelectedEvent||hasSelectedInteraction)item.selectedForState=true;
    }
  }
  return {state,periods,evidence};
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
