import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {candidateContext,fullSmaOrder,projectPhase41e} from '../../trading_poc_001_bollinger/src/phase41e-feature-context.ts';
import {classifySmaPair,classifySmaSlope} from '../../trading_poc_001_bollinger/src/investep-technical-context.ts';
import type {FrameSnapshot,SipSnapshot} from '../../trading_poc_001_bollinger/src/phase41b-context.ts';

const blank=(value:number|null)=>({value,previousValue:value===null?null:value-1,
  slope:classifySmaSlope(value,value===null?null:value-1).slope,
  distancePercent:value===null?null:(105-value)/value*100,
  priceAbove:value===null?null:105>value,priceBelow:value===null?null:105<value,
  interactions:[] as FrameSnapshot['sma'][20]['interactions']});
function frame(values:[number|null,number|null,number|null,number|null]):FrameSnapshot{
  const sma={20:blank(values[0]),40:blank(values[1]),100:blank(values[2]),200:blank(values[3])};
  const shortPair=classifySmaPair(values[0],values[1]),longPair=classifySmaPair(values[2],values[3]);
  return {barStartUtc:'2026-10-21T14:30:00.000Z',barEndUtc:'2026-10-21T14:45:00.000Z',
    assumedAvailableAtUtc:'2026-10-21T15:05:00.000Z',continuousBars:220,
    shortPair,longPair,state:shortPair===longPair?shortPair:'MIXED',sma,events:[]};
}
function permutations(values:number[]):number[][]{
  if(values.length===0)return [[]];
  return values.flatMap((value,index)=>permutations(values.filter((_,i)=>i!==index)).map(rest=>[value,...rest]));
}
describe('Fase 41E: proyección categórica del motor causal 41A/41B',()=>{
  it('CLI verifica SHA y orden F0, rechaza consultas futuras y no escribe ante error',()=>{
    const dir=mkdtempSync(join(tmpdir(),'phase41e-cli-')),csv=join(dir,'nvda.csv'),
      queries=join(dir,'queries.json'),out=join(dir,'context.json');
    const names=['return_1','return_4','distance_ema9','distance_sma20','bollinger_position',
      'relative_volume_20','candle_range','candle_body','atr14_relative','minutes_from_open'];
    const features=Object.fromEntries(names.map(name=>[name,0]));
    const hash=createHash('sha256').update(JSON.stringify({spec:'nvda-15m-v1',names,values:features})).digest('hex');
    const q={scenario:'ideal',fold:1,barStartUtc:'2025-01-02T14:30:00.000Z',
      barEndUtc:'2025-01-02T14:45:00.000Z',decisionAtUtc:'2025-01-02T15:00:00.000Z',
      featureSha256:hash,features};
    const script=resolve('trading_poc_001_bollinger/src/phase41e-feature-context-cli.ts');
    const execute=()=>spawnSync(process.execPath,['--import','tsx',script,'--sip-csv',csv,
      '--queries',queries,'--out',out],{cwd:resolve('.'),encoding:'utf8'});
    try{
      writeFileSync(csv,'timestamp,open,high,low,close,volume\n2025-01-02T14:30:00.000Z,10,11,9,10,100\n');
      writeFileSync(`${csv}.meta.json`,JSON.stringify({asset:'NVDA',provider:'Alpaca Market Data API',
        bar_minutes:15,data_class:'real',session:'regular',exchange_timezone:'America/New_York',
        feed:'sip',adjustment:'split'}));
      writeFileSync(`${csv}.provenance.json`,JSON.stringify({provider:'Alpaca Market Data API',
        feed:'sip',adjustment:'split',timeframe:'15Min',calendar_endpoint:'/v2/calendar',credentials_recorded:false}));
      writeFileSync(`${csv}.calendar.json`,JSON.stringify({provider:'Alpaca Market Calendar',
        sessions:[{date:'2025-01-02',open:570,close:960}]}));
      writeFileSync(queries,JSON.stringify([q]));
      expect(execute().status).toBe(0);
      expect(JSON.parse(readFileSync(out,'utf8')).rows).toHaveLength(3);
      rmSync(out);
      writeFileSync(queries,JSON.stringify([{...q,featureSha256:'0'.repeat(64)}]));
      expect(execute().status).not.toBe(0);
      expect(existsSync(out)).toBe(false);
      writeFileSync(queries,JSON.stringify([{...q,decisionAtUtc:'2025-01-02T14:30:00.000Z'}]));
      expect(execute().status).not.toBe(0);
      expect(existsSync(out)).toBe(false);
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
  it('admite las 24 permutaciones, empates y SMA200 ausente',()=>{
    const orders=new Set(permutations([20,40,100,200]).map(order=>{
      const values=([20,40,100,200] as const).map(period=>4-order.indexOf(period));
      return fullSmaOrder(frame(values as [number,number,number,number]));
    }));
    expect(orders.size).toBe(24);
    expect(fullSmaOrder(frame([4,4,2,1]))).toBe('TIED');
    expect(fullSmaOrder(frame([4,3,2,null]))).toBe('UNAVAILABLE');
  });
  it('mantiene orden y pendientes independientes; distancias sólo SIP/SIP',()=>{
    const current=frame([100,90,80,70]);
    current.sma[20].previousValue=110;
    current.sma[20].slope=classifySmaSlope(100,110).slope;
    const snapshot={frames:{'15m':current,'1h':current,'1d':current},sipClose:105,
      reason:'TECHNICAL_CONTEXT_AVAILABLE',currentBarDelayNotMet:false,
      availability:'SIMULATED_HISTORICAL_DELAY'} as SipSnapshot;
    const projected=projectPhase41e(snapshot);
    expect(projected.features.sma_full_order_15m).toBe('20>40>100>200');
    expect(projected.features.sma20_slope_15m).toBe('FALLING');
    expect(projected.features.sma_short_pair_alignment_15m).toBe('BULLISH_ALIGNMENT');
    expect(projected.features.price_relative_sma20_15m).toBeCloseTo(.05,12);
  });
  it('no confirma retesteo pendiente ni convierte orden en soporte confirmado',()=>{
    const value=frame([100,90,80,70]);
    expect(candidateContext(value,105,'floor').state).toBe('POTENTIAL_NO_INTERACTION');
    value.events=[{timeframe:'15m',kind:'RETEST',period:20,atUtc:value.assumedAvailableAtUtc!,
      barStartUtc:value.barStartUtc!,direction:'ABOVE',status:'PENDING',breakAtUtc:'2026-10-21T14:30:00.000Z',description:'fixture'}];
    expect(candidateContext(value,105,'floor').state).toBe('RETEST_PENDING');
    const earlier=structuredClone(value);
    value.events[0]!.status='OBSERVED';
    expect(candidateContext(value,105,'floor').state).toBe('RETEST_CONFIRMED');
    expect(candidateContext(earlier,105,'floor').state).toBe('RETEST_PENDING');
    expect(candidateContext(frame([null,90,80,70]),105,'floor').state).toBe('UNAVAILABLE');
  });
});
