import type {MarketCalendar} from '../../../../trading_poc_001_bollinger/src/alpaca-calendar.ts';
import type {IexRecord} from '../../../../trading_poc_001_bollinger/src/phase38-iex.ts';

const formatter=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function nyParts(utc:string){
  const parts=Object.fromEntries(formatter.formatToParts(new Date(utc)).map(part=>[part.type,part.value]));
  return {date:`${parts.year}-${parts.month}-${parts.day}`,minute:Number(parts.hour)*60+Number(parts.minute)};
}
export type ExplorationReference={referencePrice:number;referenceKind:'HISTORICAL_EXPLORATION';
  referenceSource:'ALPACA_IEX_VERIFIED_SESSION_CLOSE';observedAtUtc:string;receivedAtUtc:string;
  sessionDate:string;ageTradingSessions:number;isCurrent:false;isExecutable:false};

/** Read-only strike-centering reference. A last 15m bar is not an official daily closing price. */
export function previousIexSessionReference(records:IexRecord[],calendar:MarketCalendar,nowUtc:string):ExplorationReference|null{
  const now=Date.parse(nowUtc);if(!Number.isFinite(now))return null;
  const today=nyParts(nowUtc).date,days=[...calendar.keys()].sort();
  // A calendar ending before today cannot establish whether later sessions were missed.
  if(!days.length||days.at(-1)!<today)return null;
  const complete=records.filter(row=>row.kind==='quarter'&&row.status==='COMPLETE'&&row.bar&&row.revision===1&&row.sourceMessageHash);
  for(const row of complete.sort((a,b)=>Date.parse(b.bar!.endUtc)-Date.parse(a.bar!.endUtc))){
    const bar=row.bar!,end=Date.parse(bar.endUtc),received=Date.parse(row.receivedAtUtc);
    if(!Number.isFinite(end)||!Number.isFinite(received)||end>now||received<end||received>now||
      !Number.isFinite(bar.close)||bar.close<=0)continue;
    const parts=nyParts(bar.endUtc),session=calendar.get(parts.date);
    if(!session||parts.minute!==session.close||end-Date.parse(bar.startUtc)!==15*60_000)continue;
    const ageTradingSessions=days.filter(day=>day>parts.date&&day<=today).length;
    if(ageTradingSessions>1)return null;
    return {referencePrice:bar.close,referenceKind:'HISTORICAL_EXPLORATION',
      referenceSource:'ALPACA_IEX_VERIFIED_SESSION_CLOSE',observedAtUtc:bar.endUtc,
      receivedAtUtc:row.receivedAtUtc,sessionDate:parts.date,ageTradingSessions,isCurrent:false,isExecutable:false};
  }
  return null;
}
