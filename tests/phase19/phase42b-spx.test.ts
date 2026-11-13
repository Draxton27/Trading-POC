import {describe,it,expect} from 'vitest';
import {indexSchedules,indexSmaBeforeEntry} from '../../trading_poc_001_bollinger/src/phase42b-spx.ts';

describe('42B SPX index schedules',()=>{
  it('represents a first half-hour, DST and an early close from the calendar',()=>{
    const cal=new Map([['2026-07-02',{open:570,close:960}],['2026-11-27',{open:570,close:780}]]);
    const s=indexSchedules(cal);
    expect(new Date(s.hour[0]!.start).toISOString()).toBe('2026-07-02T13:30:00.000Z');
    expect(s.hour[0]!.end-s.hour[0]!.start).toBe(30*60_000);
    expect(new Date(s.day[1]!.end).toISOString()).toBe('2026-11-27T18:00:00.000Z');
  });
  it('calculates each SMA only when its own prior bars are present and ignores future closes',()=>{
    const schedule=Array.from({length:25},(_,i)=>({start:i*1000,end:i*1000+500}));
    const bars=schedule.map(x=>({startUtc:new Date(x.start).toISOString(),close:100}));
    const result=indexSmaBeforeEntry(bars,schedule,new Date(22_000).toISOString());
    expect(result.values['20'].current).toBe(100);expect(result.values['40'].current).toBeNull();
    expect(indexSmaBeforeEntry([...bars.slice(0,22),...bars.slice(22).map(x=>({...x,close:999}))],schedule,new Date(22_000).toISOString())).toEqual(result);
    expect(indexSmaBeforeEntry(bars.filter((_,i)=>i!==10),schedule,new Date(22_000).toISOString()).values['20'].current).toBeNull();
  });
});
