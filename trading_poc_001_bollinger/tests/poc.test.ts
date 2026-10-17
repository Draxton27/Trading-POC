import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {calculateBollinger} from '../src/bollinger.ts';
import {detectSignals} from '../src/signals.ts';
import {evaluateSignals, wilson95} from '../src/evaluate.ts';
import type {Candle} from '../src/domain.ts';

const bar=(i:number,close:number): Candle => ({timestamp:new Date(Date.UTC(2026,5,1,13,30+i*5)).toISOString(),open:close,high:close+1,low:close-1,close,volume:100});

test('20 precios constantes generan ancho de Bollinger cero',()=>{
  const series=calculateBollinger(Array.from({length:30},(_,i)=>bar(i,100)));
  assert.equal(series[18]!.bandwidth,null);
  assert.equal(series[19]!.middle,100);
  assert.equal(series[19]!.upper,100);
  assert.equal(series[19]!.lower,100);
  assert.equal(series[19]!.bandwidth,0);
});

test('ancho se calcula como (banda superior - inferior) / media',()=>{
  const closes=Array.from({length:20},(_,i)=>i+1);
  const series=calculateBollinger(closes.map((close,i)=>bar(i,close)));
  const s=series[19]!;
  const expectedSD=Math.sqrt(33.25);
  assert.ok(Math.abs(s.middle!-10.5)<1e-10);
  assert.ok(Math.abs(s.upper!-(10.5+2*expectedSD))<1e-10);
  assert.ok(Math.abs(s.bandwidth!-(4*expectedSD/10.5))<1e-10);
});

test('deteccion no utiliza velas futuras',()=>{
  const closes=Array.from({length:500},(_,i)=>100+Math.sin(i/12)*0.7+(i>300?(i-300)*0.02:0));
  const bars=closes.map((close,i)=>bar(i,close));
  const series=calculateBollinger(bars);
  const sigs=detectSignals(series);
  const altered=bars.map((b,i)=>i>390?{...b,close:b.close*1.1}:b);
  const sigs2=detectSignals(calculateBollinger(altered));
  assert.deepEqual(sigs.filter(s=>s.index<=390),sigs2.filter(s=>s.index<=390));
});

test('no se evalua una senal que salte de un dia bursatil a otro',()=>{
  const bars=[...Array.from({length:20},(_,i)=>bar(i,100+i*.1)),bar(300,120)];
  const sign={index:18,timestamp:bars[18]!.timestamp,candleEndTimestamp:bars[19]!.timestamp,availableAt:bars[19]!.timestamp,close:101.8,direction:'CALL_CONTEXT' as const,previousBandwidthPercent:2,currentBandwidthPercent:4,squeezeThresholdPercent:3};
  assert.equal(evaluateSignals(bars,[sign],[3]).length,0);
  assert.equal(evaluateSignals(bars,[sign],[1]).length,1);
});

test('Wilson 95% devuelve limites razonables',()=>{
  const [lo,hi]=wilson95(60,100)!;
  assert.ok(lo>0.50 && lo<0.52);
  assert.ok(hi>0.69 && hi<0.70);
  assert.equal(wilson95(0,0),null);
});

test('detecta un rompimiento alcista tras una compresion extrema',()=>{
  const candles=Array.from({length:130},(_,i)=>bar(i,i===120?110:100));
  const signals=detectSignals(calculateBollinger(candles));
  assert.ok(signals.some(s=>s.index===120 && s.direction==='CALL_CONTEXT'));
});
