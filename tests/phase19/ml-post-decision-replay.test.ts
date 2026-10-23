import {describe,expect,it} from 'vitest';
import type {Candle} from '../../trading_poc_001_bollinger/src/domain.ts';
import type {MarketCalendar} from '../../trading_poc_001_bollinger/src/alpaca-calendar.ts';
import {replayObservations} from '../../trading_poc_001_bollinger/src/phase38b-replay.ts';
import {postDecisionObservations,scheduledPostDecisionEntry} from '../../trading_poc_001_bollinger/src/phase38c-replay.ts';

function fixture(earlyClose=false){
  const days=[['2026-03-06','14:30'],['2026-03-09','13:30'],['2026-03-10','13:30'],['2026-03-11','13:30']] as const;
  const calendar:MarketCalendar=new Map(days.map(([day])=>[day,{open:570,close:earlyClose&&day==='2026-03-11'?780:960}]));
  const candles:Candle[]=[];
  for(const [day,start] of days){
    let time=Date.parse(`${day}T${start}:00.000Z`);
    for(let i=0;i<(earlyClose&&day==='2026-03-11'?14:26);i++,time+=900_000){
      const n=candles.length,open=100+n*.02,close=open+(n%7-3)*.05;
      candles.push({timestamp:new Date(time).toISOString(),open,close,
        high:Math.max(open,close)+.25,low:Math.min(open,close)-.25,volume:1000+n%11*100});
    }
  }
  return {candles,calendar};
}
const at=(rows:ReturnType<typeof postDecisionObservations>,start:string,scenario:'ideal'|'delayed')=>
  rows.find(row=>row.bar_start_utc===start&&row.scenario===scenario)!;

describe('Fase 38C: entrada posterior a disponibilidad',()=>{
  it('utiliza la primera apertura estrictamente posterior en ambos escenarios',()=>{
    const {candles,calendar}=fixture(),rows=postDecisionObservations(candles,calendar),start='2026-03-09T14:00:00.000Z';
    const ideal=at(rows,start,'ideal'),delayed=at(rows,start,'delayed');
    expect(ideal.available_at_utc).toBe('2026-03-09T14:15:00.000Z');
    expect(ideal.reference_entry_at_utc).toBe('2026-03-09T14:30:00.000Z');
    expect(delayed.available_at_utc).toBe('2026-03-09T14:35:00.000Z');
    expect(delayed.reference_entry_at_utc).toBe('2026-03-09T14:45:00.000Z');
    expect(ideal.label_available_at_utc).toBe('2026-03-09T15:30:00.000Z');
    expect(delayed.label_available_at_utc).toBe('2026-03-09T15:45:00.000Z');
    expect(Date.parse(ideal.reference_entry_at_utc!)).toBeGreaterThan(Date.parse(ideal.available_at_utc));
    expect(Date.parse(delayed.reference_entry_at_utc!)).toBeGreaterThan(Date.parse(delayed.available_at_utc));
    expect(ideal.historical_received_at_utc).toBeNull();expect(delayed.mode).toBe('HISTORICAL_REPLAY');
    const phase38b=replayObservations(candles,calendar).find(row=>row.bar_start_utc===start)!;
    expect(ideal.features).toEqual(phase38b.features);
    expect(delayed.feature_sha256).toBe(phase38b.feature_sha256);
  });

  it('no deja que cambios futuros modifiquen variables, instante o apertura prevista',()=>{
    const {candles,calendar}=fixture(),start='2026-03-09T14:00:00.000Z';
    const original=at(postDecisionObservations(candles,calendar),start,'delayed');
    const changed=candles.map(candle=>candle.timestamp==='2026-03-09T14:45:00.000Z'
      ?{...candle,open:candle.open+20,high:candle.high+20,low:candle.low+20,close:candle.close+20}:candle);
    const later=at(postDecisionObservations(changed,calendar),start,'delayed');
    expect(later.features).toEqual(original.features);
    expect(later.available_at_utc).toBe(original.available_at_utc);
    expect(later.reference_entry_at_utc).toBe(original.reference_entry_at_utc);
    expect(later.label).not.toBe(original.label);
  });

  it('mantiene la primera apertura prevista aunque falte su vela',()=>{
    const {candles,calendar}=fixture(),start='2026-03-09T14:00:00.000Z';
    const missing=candles.filter(candle=>candle.timestamp!=='2026-03-09T14:45:00.000Z');
    const row=at(postDecisionObservations(missing,calendar),start,'delayed');
    expect(row.reference_entry_at_utc).toBe('2026-03-09T14:45:00.000Z');
    expect(row.exclusion).toBe('FUTURE_BARS_MISSING');
    expect(row.label).toBeNull();
  });

  it('respeta cierre anticipado, viernes-lunes y cambio de horario de verano',()=>{
    const {candles,calendar}=fixture(true),rows=postDecisionObservations(candles,calendar);
    expect(rows.some(row=>row.session_date_ny==='2026-03-09')).toBe(true);
    const start='2026-03-11T15:30:00.000Z';
    expect(at(rows,start,'ideal').exclusion).toBeNull();
    expect(at(rows,start,'delayed').exclusion).toBe('MARKET_CLOSE');
    expect(scheduledPostDecisionEntry(start,'2026-03-11T16:05:00.000Z',690,{open:570,close:780}).horizonEndUtc).toBeNull();
    expect(postDecisionObservations(candles,calendar)).toEqual(rows);
  });

  it('continúa por el calendario oficial tras un festivo sin inventar velas del día cerrado',()=>{
    const {candles,calendar}=fixture();
    const holidayCalendar:MarketCalendar=new Map([
      ['2026-01-16',{open:570,close:960}],
      ['2026-01-20',{open:570,close:960}]
    ]);
    const holidayCandles=candles.slice(0,52).map((candle,index)=>({
      ...candle,timestamp:new Date(Date.parse(`${index<26?'2026-01-16':'2026-01-20'}T14:30:00.000Z`)+(index%26)*900_000).toISOString()
    }));
    expect(postDecisionObservations(holidayCandles,holidayCalendar).some(row=>row.session_date_ny==='2026-01-20')).toBe(true);
    expect([...holidayCalendar.keys()]).not.toContain('2026-01-19');
    expect(calendar.size).toBeGreaterThan(0);
  });
});
