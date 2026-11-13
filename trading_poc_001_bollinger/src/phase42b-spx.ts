import type {MarketCalendar} from './alpaca-calendar.ts';
import {newYorkLocalToUtc} from './phase42b-queue.ts';

export type IndexBar={startUtc:string;close:number};
export type ScheduledBar={start:number;end:number};
const hhmm=(m:number)=>`${Math.floor(m/60).toString().padStart(2,'0')}:${(m%60).toString().padStart(2,'0')}`;
/** IBKR RTH hourly bars begin with a scheduled 30-minute bar then align to the hour. */
export function indexSchedules(calendar:MarketCalendar){
  const hour:ScheduledBar[]=[],day:ScheduledBar[]=[];
  for(const [date,s] of [...calendar].sort(([a],[b])=>a.localeCompare(b))){
    const open=Date.parse(newYorkLocalToUtc(`${date}T${hhmm(s.open)}:00`));
    day.push({start:open,end:open+(s.close-s.open)*60_000});
    for(let m=s.open;m<s.close;){const next=Math.min(Math.ceil((m+1)/60)*60,s.close);
      hour.push({start:open+(m-s.open)*60_000,end:open+(next-s.open)*60_000});m=next;}
  }
  return {hour,day};
}

/** Close times are calendar-derived; later source revisions and historical receipt remain unknown. */
export function indexSmaBeforeEntry(bars:readonly IndexBar[],schedule:readonly ScheduledBar[],entryUtc:string){
  const entry=Date.parse(entryUtc);if(!Number.isFinite(entry))throw Error('ENTRY_INVALID');
  const wanted=schedule.filter(x=>x.end<entry).slice(-201),byTime=new Map<number,number>();
  let last=-Infinity;for(const bar of bars){const time=Date.parse(bar.startUtc);
    if(!Number.isFinite(time)||time<=last||!Number.isFinite(bar.close)||bar.close<=0)throw Error('INDEX_BAR_INVALID');
    last=time;if(time<entry)byTime.set(time,bar.close);
  }
  const missing=wanted.filter(x=>!byTime.has(x.start)).length;
  const values=Object.fromEntries([20,40,100,200].map(n=>{
    const window=wanted.slice(-n-1),absent=window.filter(x=>!byTime.has(x.start)).length;
    if(window.length<n+1||absent)return [String(n),{status:'NO_VERIFICABLE',current:null,previous:null,missing:absent}];
    const closes=window.map(x=>byTime.get(x.start)!);
    const current=closes.slice(-n).reduce((a,b)=>a+b,0)/n,previous=closes.slice(-n-1,-1).reduce((a,b)=>a+b,0)/n;
    return [String(n),{status:'RETROSPECTIVO_NO_POINT_IN_TIME',current,previous,missing:0}];
  }));
  return {status:'NO_VERIFICABLE' as const,expected:wanted.length,missing,values};
}
