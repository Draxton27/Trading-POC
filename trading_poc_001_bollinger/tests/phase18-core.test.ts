import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import type {Candle} from '../src/domain.ts';
import {buildHourlyCandles, calculateSmaPoints, lastAvailableSmaPoint, type AggregateCandle} from '../src/multitimeframe.ts';
import {fourOrder, fourDescriptor, levelState, pullbackState, quoteValidity,
  selectPilotContract, evaluatePilotQuotes, type PilotContract} from '../src/phase18-core.ts';
const candle=(timestamp:string,open:number,high:number,low:number,close:number):Candle=>
  ({timestamp,open,high,low,close,volume:100});
function bars(start:string,count:number){return Array.from({length:count},(_,i)=>candle(
  new Date(Date.parse(start)+i*900000).toISOString(),100,101,99,100));}

test('cuatro SMA: orden, pendientes y separación no se confunden',()=>{
  assert.equal(fourOrder({20:4,40:3,100:2,200:1}),'bullish');
  assert.equal(fourOrder({20:1,40:2,100:3,200:4}),'bearish');
  assert.equal(fourOrder({20:2,40:3,100:1,200:4}),'other');
  assert.equal(fourOrder({20:2,40:3,100:1,200:null}),'insufficient');
  const d=fourDescriptor({20:4,40:3,100:2,200:1},{20:5,40:2,100:1,200:.5},4.2);
  assert.equal(d.order,'bullish');assert.equal(d.slopesAgree,false);
  assert.ok(d.separation[0]!>0);assert.ok(d.priceDistance[20]!>0);
});

test('cruce 20/40 solo con dos SMA disponibles, sin mirar una vela futura',()=>{
  const old={20:1,40:2,100:3,200:4},now={20:3,40:2,100:4,200:5};
  assert.equal(fourDescriptor(now,old,3).cross20_40,'up');
  assert.equal(fourDescriptor(now,{...old,40:null},3).cross20_40,'none');
});

test('warmup SMA200 requiere 200 agregados completos y no usa un agregado incompleto',()=>{
  const points=Array.from({length:201},(_,i)=>({timestamp:new Date(Date.UTC(2020,0,1+i)).toISOString(),
    endTimestamp:new Date(Date.UTC(2020,0,2+i)).toISOString(),availableAt:new Date(Date.UTC(2020,0,2+i)).toISOString(),
    dateNy:new Date(Date.UTC(2020,0,1+i)).toISOString().slice(0,10),timeframe:'day' as const,durationMinutes:390,
    expectedSourceBars:26,observedSourceBars:i===200?25:26,complete:i!==200,scheduledAbbreviated:false,
    open:100,high:101,low:99,close:100+i,volume:100})) as AggregateCandle[];
  const result=calculateSmaPoints(points);
  assert.equal(result[198]!.values[200],null);assert.ok(result[199]!.values[200]!==null);
  assert.equal(result[200]!.values[200],null);
  assert.equal(lastAvailableSmaPoint(result,points[199]!.timestamp)?.candle.timestamp,points[198]!.timestamp);
});

test('agregación horaria conserva último bloque abreviado y cierre anticipado',()=>{
  const regular=buildHourlyCandles(bars('2026-10-16T13:30:00Z',26),new Map([['2026-10-16',{open:570,close:960}]]));
  assert.equal(regular.length,7);assert.equal(regular.at(-1)!.durationMinutes,30);
  assert.ok(regular.every(v=>v.complete));
  const early=buildHourlyCandles(bars('2026-11-27T14:30:00Z',14),new Map([['2026-11-27',{open:570,close:780}]]));
  assert.equal(early.length,4);assert.equal(early.at(-1)!.durationMinutes,30);assert.ok(early.every(v=>v.complete));
  const missing=buildHourlyCandles(bars('2026-11-27T14:30:00Z',14).filter((_,i)=>i!==3),new Map([['2026-11-27',{open:570,close:780}]]));
  assert.equal(missing[0]!.complete,false);
});

test('horas EST y EDT se anclan a 09:30 NY',()=>{
  const all=[...bars('2026-03-06T14:30:00Z',4),...bars('2026-03-09T13:30:00Z',4)];
  const result=buildHourlyCandles(all,new Map([['2026-03-06',{open:570,close:630}],['2026-03-09',{open:570,close:630}]]));
  assert.deepEqual(result.map(r=>r.timestamp),['2026-03-06T14:30:00.000Z','2026-03-09T13:30:00.000Z']);
});

test('niveles y retrocesos se clasifican al cierre actual',()=>{
  const previous=candle('2026-10-16T13:30:00Z',102,103,101,102);
  const approach=candle('2026-10-16T13:45:00Z',102,102.1,100.5,101);
  const contact=candle('2026-10-16T14:00:00Z',101,101.2,99.9,100.4);
  assert.deepEqual(pullbackState(previous,approach,100,'bullish'),{approach:true,contact:false,closeOtherSide:false});
  assert.equal(pullbackState(approach,contact,100,'bullish').contact,true);
  assert.equal(pullbackState(candle(previous.timestamp,98,99,97,98),candle(contact.timestamp,99,100.1,98.8,99.5),100,'bearish').contact,true);
  assert.equal(levelState(98,candle(contact.timestamp,99,101,98,100.5),100).crossClose,true);
});

test('cotización OPRA inválida, futura u obsoleta no se evalúa',()=>{
  const q={timestampUtc:'2026-10-16T14:30:30Z',bid:1,ask:1.2,bidSize:10,askSize:12};
  assert.equal(quoteValidity(q,'2026-10-16T14:31:00Z'),'valid');
  assert.equal(quoteValidity(q,'2026-10-16T14:30:00Z'),'future');
  assert.equal(quoteValidity(q,'2026-10-16T14:32:00Z'),'stale');
  assert.equal(quoteValidity({...q,ask:.8},'2026-10-16T14:31:00Z'),'invalid');
  assert.equal(quoteValidity(null,'2026-10-16T14:31:00Z'),'missing');
});

test('selección OCC neutral excluye contratos ajustados y campos inconsistentes',()=>{
  const contracts:PilotContract[]=[
    {occ:'NVDA261030C00100000',kind:'CALL',strike:100,expiry:'2026-10-30',multiplier:100,adjusted:false},
    {occ:'NVDA261023C00100000',kind:'CALL',strike:100,expiry:'2026-10-23',multiplier:100,adjusted:false},
    {occ:'NVDA261023C00105000',kind:'CALL',strike:105,expiry:'2026-10-23',multiplier:100,adjusted:false},
    {occ:'NVDA261023C00100000',kind:'CALL',strike:100,expiry:'2026-10-23',multiplier:100,adjusted:true},
    {occ:'NVDA261023P00100000',kind:'PUT',strike:100,expiry:'2026-10-23',multiplier:100,adjusted:false},
  ];
  assert.equal(selectPilotContract(contracts,'bullish',101,'2026-10-16T15:00:00Z')?.occ,'NVDA261023C00100000');
  assert.equal(selectPilotContract(contracts,'bearish',101,'2026-10-16T15:00:00Z')?.kind,'PUT');
  assert.equal(selectPilotContract(contracts,'bullish',101,'2026-10-20T15:00:00Z')?.expiry,'2026-10-30');
  assert.equal(selectPilotContract([{...contracts[0]!,strike:200}], 'bullish',101,'2026-10-16T15:00:00Z'),null);
});

test('precio medio optimista y cruce ask/bid permanecen separados',()=>{
  const entry={timestampUtc:'2026-10-16T14:30:30Z',bid:1,ask:1.2,bidSize:10,askSize:10};
  const exit={timestampUtc:'2026-10-16T15:00:30Z',bid:1.3,ask:1.5,bidSize:10,askSize:10};
  const result=evaluatePilotQuotes(entry,exit,'2026-10-16T14:31:00Z','2026-10-16T15:01:00Z');
  assert.equal(result.evaluable,true);assert.ok(result.midpointReturnPct!>result.crossedReturnPct!);
  assert.ok(result.crossedReturnPct!>result.slippedReturnPct!);
  assert.equal(evaluatePilotQuotes(entry,null,'2026-10-16T14:31:00Z','2026-10-16T15:01:00Z').evaluable,false);
});
