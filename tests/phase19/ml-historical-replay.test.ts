import {describe,expect,it} from 'vitest';
import type {Candle} from '../../trading_poc_001_bollinger/src/domain.ts';
import type {MarketCalendar} from '../../trading_poc_001_bollinger/src/alpaca-calendar.ts';
import {calculatePhase23Features} from '../../trading_poc_001_bollinger/src/phase23-dataset.ts';
import {PHASE31_FEATURES} from '../../trading_poc_001_bollinger/src/phase31-inference.ts';
import {replayObservations} from '../../trading_poc_001_bollinger/src/phase38b-replay.ts';

function fixture(){
  const sessions=[['2026-03-06','14:30'],['2026-03-09','13:30'],['2026-03-10','13:30'],['2026-03-11','13:30'],['2026-03-12','13:30'],['2026-03-13','13:30']] as const;
  const calendar:MarketCalendar=new Map(sessions.map(([day])=>[day,{open:570,close:960}]));
  const candles:Candle[]=[];
  for(const [day,start] of sessions){let time=Date.parse(`${day}T${start}:00.000Z`);
    for(let i=0;i<26;i++,time+=900_000){const n=candles.length,open=100+n*.04,close=open+(n%5-2)*.07;
      candles.push({timestamp:new Date(time).toISOString(),open,high:Math.max(open,close)+.3,low:Math.min(open,close)-.3,close,volume:1000+(n%7)*100});}}
  return {calendar,candles};
}
describe('Fase 38B: reloj y variables causales',()=>{
  it('preserva las diez variables Fase 23/31 sin consultar velas posteriores',()=>{
    const {candles,calendar}=fixture(),full=replayObservations(candles,calendar);
    const index=80,at=full.find(row=>row.bar_start_utc===candles[index]!.timestamp)!;
    const prefix=replayObservations(candles.slice(0,index+1),calendar).at(-1)!;
    expect(at.features).toEqual(prefix.features);expect(PHASE31_FEATURES).toHaveLength(10);
    const changed=candles.map((bar,i)=>i>index?{...bar,close:bar.close+100}:bar);
    expect(replayObservations(changed,calendar).find(row=>row.bar_start_utc===at.bar_start_utc)!.features).toEqual(at.features);
    const original=calculatePhase23Features(candles.slice(0,index+1),calendar)[index]!;
    for(const name of PHASE31_FEATURES.filter(name=>name!=='minutes_from_open'))expect(at.features[name]).toBe(original[name]);
    expect(at.historical_received_at_utc).toBeNull();expect(at.mode).toBe('HISTORICAL_REPLAY');
    expect(at.delayed_before_next_entry).toBe(false);
  });
  it('no usa integridad futura de una sesión para decidir una observación anterior',()=>{
    const {candles,calendar}=fixture(),missing=candles.filter(bar=>bar.timestamp!=='2026-03-11T15:00:00.000Z');
    const original=replayObservations(candles,calendar),replayed=replayObservations(missing,calendar);
    const first=original.find(row=>row.bar_start_utc==='2026-03-11T13:45:00.000Z')!;
    const reduced=replayed.find(row=>row.bar_start_utc===first.bar_start_utc)!;
    expect(reduced.features).toEqual(first.features);
    expect(reduced.exclusion).toBeNull();
    expect(replayed.find(row=>row.bar_start_utc==='2026-03-11T14:00:00.000Z')!.exclusion).toBe('OUTCOME_BARS_MISSING');
  });
  it('respeta viernes-lunes, DST y el último horizonte elegible de cierre anticipado',()=>{
    const {candles,calendar}=fixture(),rows=replayObservations(candles,calendar);
    expect(rows.some(row=>row.session_date_ny==='2026-03-09')).toBe(true);
    expect(rows.find(row=>row.bar_start_utc==='2026-03-09T13:30:00.000Z')?.features).toBeDefined();
    calendar.set('2026-03-13',{open:570,close:780});
    const short=replayObservations(candles.filter(bar=>!bar.timestamp.startsWith('2026-03-13')||Date.parse(bar.timestamp)<Date.parse('2026-03-13T17:00:00Z')),calendar);
    expect(short.find(row=>row.bar_start_utc==='2026-03-13T15:45:00.000Z')?.exclusion).toBeNull();
    expect(short.find(row=>row.bar_start_utc==='2026-03-13T16:00:00.000Z')?.exclusion).toBe('HORIZON_OUTSIDE_SESSION');
    expect(replayObservations(candles,fixture().calendar)).toEqual(rows);
  });
});
