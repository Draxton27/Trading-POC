import {describe,it,expect} from 'vitest';
import {historicalBollinger15,historicalRelativeMinutes,historicalSessionMinutes,type HistoricalBar} from '../../trading_poc_001_bollinger/src/phase42b-retrospective.ts';

const start=Date.parse('2026-11-04T14:30:00Z'),iso=(t:number)=>new Date(t).toISOString();
const make=(t:number):HistoricalBar=>({timestamp:iso(t),open:100,high:101,low:99,close:100,volume:10,providerVwap:100});
const calendar=new Map([['2026-11-04',{open:570,close:960}]]);
describe('42B conditional reconstruction',()=>{
  it('only computes Bollinger for the 20 calendar bars strictly before the entry',()=>{
    const bars=Array.from({length:25},(_,i)=>make(start+i*15*60_000));
    const entry='2026-11-04T20:00:01.000Z',result=historicalBollinger15(bars,calendar,entry);
    expect(result.status).toBe('RETROSPECTIVO_NO_POINT_IN_TIME');expect(result.value?.middle).toBe(100);
    const altered=bars.map((b,i)=>i>=22?{...b,close:999,high:999}:b);
    expect(historicalBollinger15(altered,calendar,entry)).toEqual(result);
    expect(historicalBollinger15(bars.filter((_,i)=>i!==4),calendar,entry).status).toBe('NO_VERIFICABLE');
  });
  it('excludes the entry minute and rejects gaps for VWAP',()=>{
    const bars=Array.from({length:4},(_,i)=>make(start+i*60_000));
    const result=historicalSessionMinutes(bars,calendar,'2026-11-04T09:34:00');
    expect(result.expected).toBe(3);expect(result.vwap).toBe(100);
    expect(historicalSessionMinutes(bars.filter((_,i)=>i!==1),calendar,'2026-11-04T09:34:00').vwap).toBeNull();
    expect(historicalSessionMinutes(bars,calendar,'2026-11-04T09:31:00').status).toBe('NO_VERIFICABLE');
  });
  it('compares aligned prior minutes and refuses missing benchmark bars',()=>{
    const bars=Array.from({length:4},(_,i)=>make(start+i*60_000));
    const benchmark=bars.map(b=>({...b,open:200,high:201,low:199,close:200,providerVwap:200}));
    expect(historicalRelativeMinutes(bars,benchmark,calendar,'2026-11-04T09:34:00').value?.differencePercentagePoints).toBe(0);
    expect(historicalRelativeMinutes(bars,benchmark.slice(1),calendar,'2026-11-04T09:34:00').status).toBe('NO_VERIFICABLE');
  });
});
