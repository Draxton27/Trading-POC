import {describe,it,expect} from 'vitest';
import type {MarketBar} from '@trading-poc/contracts';
import {previousSessionLevels} from '@trading-poc/market-domain';

const day=(date:string,high:number,low:number,complete=true):MarketBar=>({
  symbol:'NVDA',timeframe:'1d',startUtc:`${date}T13:30:00.000Z`,endUtc:`${date}T20:00:00.000Z`,
  open:100,high,low,close:100,volume:1000,provider:'controlado',adjustment:'none',
  receivedAtUtc:null,isComplete:complete,
});
describe('niveles históricos sin información futura',()=>{
  const bars=[day('2020-01-02',110,90),day('2020-01-03',120,80),
    day('2020-01-06',130,70),day('2020-01-07',140,60,false),
    day('2026-10-16',999,1)];
  it('lunes usa viernes y no el final de un dataset de años posteriores',()=>{
    expect(previousSessionLevels(bars,'2020-01-06T15:00:00.000Z')).toEqual({
      previousHigh:120,previousLow:80,sourceSessionNy:'2020-01-03',
      availableAtUtc:'2020-01-03T20:00:00.000Z',asOfUtc:'2020-01-06T15:00:00.000Z'});
  });
  it('feriado y sesión abreviada: conserva la última sesión completa anterior',()=>{
    const short={...day('2020-01-08',125,85),endUtc:'2020-01-08T18:00:00.000Z'};
    expect(previousSessionLevels([...bars,short].sort((a,b)=>a.startUtc.localeCompare(b.startUtc)),
      '2020-01-09T15:00:00.000Z').sourceSessionNy).toBe('2020-01-08');
    expect(previousSessionLevels(bars,'2020-01-08T15:00:00.000Z').sourceSessionNy).toBe('2020-01-06');
  });
  it('primera sesión o histórico incompleto devuelven null',()=>{
    expect(previousSessionLevels(bars,'2020-01-02T15:00:00.000Z').previousHigh).toBeNull();
    expect(previousSessionLevels([day('2020-01-02',110,90,false)],'2020-01-03T15:00:00.000Z').previousLow).toBeNull();
    expect(previousSessionLevels(bars,'2020-01-08T15:00:00.000Z','2020-01-07').previousHigh).toBeNull();
    expect(previousSessionLevels(bars,'2020-01-06T15:00:00.000Z','2020-01-03').previousHigh).toBe(120);
  });
});
