import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import type {MarketCalendar} from '../src/alpaca-calendar.ts';
import type {Candle, Direction} from '../src/domain.ts';
import {buildDailyCandles, buildHourlyCandles, calculateSmaPoints, lastAvailableSmaPoint,
  type AggregateCandle} from '../src/multitimeframe.ts';
import {classifySmaSignal, smaConditionDefinitions, smaConditionStatus} from '../src/nvda-sma-context-study.ts';
import type {SignalRecord} from '../src/nvda-indicators-study.ts';
import {studyNvdaSmaContext} from '../src/nvda-sma-context-study.ts';
import {studyNvdaIndicators} from '../src/nvda-indicators-study.ts';

function sourceBar(timestamp:string,index=0):Candle {
  const open=100+index,close=open+.5;
  return {timestamp,open,high:close+1,low:open-1,close,volume:10+index};
}
function session(date:string,utcHour:number,count=26):Candle[]{
  const start=Date.parse(`${date}T${String(utcHour).padStart(2,'0')}:30:00Z`);
  return Array.from({length:count},(_,index)=>sourceBar(new Date(start+index*900_000).toISOString(),index));
}
function calendar(entries:[string,number,number][]):MarketCalendar{
  return new Map(entries.map(([date,open,close])=>[date,{open,close}]));
}
function aggregate(index:number,close:number,timeframe:'hour'|'day'='day'):AggregateCandle{
  const start=Date.parse('2025-01-02T14:30:00Z')+index*86_400_000;
  return {timestamp:new Date(start).toISOString(),endTimestamp:new Date(start+3_600_000).toISOString(),
    availableAt:new Date(start+3_600_000).toISOString(),dateNy:`d${index}`,timeframe,durationMinutes:60,
    expectedSourceBars:4,observedSourceBars:4,complete:true,scheduledAbbreviated:false,
    open:close,high:close,low:close,close,volume:100};
}
function record(timestamp:string,direction:Direction='CALL_CONTEXT'):SignalRecord{
  const end=new Date(Date.parse(timestamp)+900_000).toISOString();
  return {signal:{index:0,timestamp,candleEndTimestamp:end,availableAt:end,direction,close:100,
    previousBandwidthPercent:1,currentBandwidthPercent:2,squeezeThresholdPercent:1},
  dateNy:'2026-06-01',slotNy:'10:15',segment:'exploracion',bollinger:{middle:99,upper:101,lower:97},
  ema9:99,previousEma9:98,emaPass:true,closeAboveEma:true,volume:100,averageVolume20:80,rvol:1.25,
  volumePass:false,horizons:{'15':{value:1,reason:null,entryUtc:end,exitUtc:end},
    '30':{value:1,reason:null,entryUtc:end,exitUtc:end},'60':{value:1,reason:null,entryUtc:end,exitUtc:end}}};
}

test('agrega OHLCV horario anclado a 09:30 y conserva la última vela programada de 30 minutos',()=>{
  const bars=session('2026-06-01',13);
  const hourly=buildHourlyCandles(bars,calendar([['2026-06-01',570,960]]));
  assert.equal(hourly.length,7);
  assert.deepEqual(hourly.map(bar=>bar.durationMinutes),[60,60,60,60,60,60,30]);
  assert.equal(hourly.every(bar=>bar.complete),true);
  assert.equal(hourly.at(-1)!.scheduledAbbreviated,true);
  assert.equal(hourly[0]!.open,bars[0]!.open);
  assert.equal(hourly[0]!.close,bars[3]!.close);
  assert.equal(hourly[0]!.high,Math.max(...bars.slice(0,4).map(bar=>bar.high)));
  assert.equal(hourly[0]!.low,Math.min(...bars.slice(0,4).map(bar=>bar.low)));
  assert.equal(hourly[0]!.volume,bars.slice(0,4).reduce((sum,bar)=>sum+bar.volume,0));
  assert.equal(hourly[0]!.availableAt,'2026-06-01T14:30:00.000Z');
  assert.equal(hourly.at(-1)!.availableAt,'2026-06-01T20:00:00.000Z');
});

test('cierre anticipado produce intervalos horarios completos y abreviados según calendario',()=>{
  const bars=session('2026-11-27',14,14);
  const hourly=buildHourlyCandles(bars,calendar([['2026-11-27',570,780]]));
  assert.deepEqual(hourly.map(bar=>[bar.durationMinutes,bar.complete,bar.scheduledAbbreviated]),
    [[60,true,false],[60,true,false],[60,true,false],[30,true,true]]);
  const daily=buildDailyCandles(bars,calendar([['2026-11-27',570,780]]));
  assert.equal(daily[0]!.complete,true);
  assert.equal(daily[0]!.scheduledAbbreviated,true);
  assert.equal(daily[0]!.endTimestamp,'2026-11-27T18:00:00.000Z');
});

test('distingue vela abreviada por calendario de sesión incompleta y no inventa festivos',()=>{
  const full=session('2026-11-25',14);
  const missing=full.filter((_,index)=>index!==5);
  const schedule=calendar([['2026-11-25',570,960],['2026-11-27',570,780]]);
  const hourly=buildHourlyCandles(missing,schedule);
  assert.equal(hourly[1]!.complete,false);
  assert.equal(hourly[1]!.scheduledAbbreviated,false);
  assert.equal(hourly.at(-1)!.scheduledAbbreviated,true);
  assert.equal(buildDailyCandles(missing,schedule)[0]!.complete,false);
  assert.equal(hourly.some(bar=>bar.dateNy==='2026-11-27'),false);
});

test('ancla 09:30 local a UTC correctamente antes y después de cambio EST/EDT',()=>{
  const bars=[...session('2026-03-06',14),...session('2026-03-09',13)];
  const schedule=calendar([['2026-03-06',570,960],['2026-03-09',570,960]]);
  const hourly=buildHourlyCandles(bars,schedule);
  assert.equal(hourly[0]!.timestamp,'2026-03-06T14:30:00.000Z');
  assert.equal(hourly[7]!.timestamp,'2026-03-09T13:30:00.000Z');
  const daily=buildDailyCandles(bars,schedule);
  assert.equal(daily[0]!.endTimestamp,'2026-03-06T21:00:00.000Z');
  assert.equal(daily[1]!.endTimestamp,'2026-03-09T20:00:00.000Z');
});

test('SMA 20, 40, 100 y 200 se inicializan solo tras cierres completos y conservan pendiente',()=>{
  const bars=Array.from({length:202},(_,index)=>aggregate(index,index+1));
  bars[50]={...bars[50]!,complete:false};
  const points=calculateSmaPoints(bars);
  assert.equal(points[18]!.values[20],null);
  assert.equal(points[19]!.values[20],10.5);
  assert.equal(points[39]!.values[40],20.5);
  assert.equal(points[99]!.values[100],null); // un cierre incompleto deja 99 cierres observados
  assert.equal(points[100]!.values[100],51);
  assert.equal(points[200]!.values[200],101.25);
  assert.equal(points[200]!.previous[200],null);
  assert.equal(points[201]!.previous[200],101.25);
  assert.equal(points[201]!.values[200],102.255);
});

test('una señal usa solo el último cierre superior disponible antes de empezar',()=>{
  const bars=session('2026-06-01',13);
  const schedule=calendar([['2026-06-01',570,960]]);
  const points=calculateSmaPoints(buildHourlyCandles(bars,schedule));
  assert.equal(lastAvailableSmaPoint(points,'2026-06-01T14:15:00.000Z'),null);
  assert.equal(lastAvailableSmaPoint(points,'2026-06-01T14:30:00.000Z')!.candle.endTimestamp,
    '2026-06-01T14:30:00.000Z');
  const extended=[...Array.from({length:200},(_,index)=>aggregate(index,100,'hour')),
    aggregate(200,200,'hour')];
  const cutoff=extended[200]!.timestamp;
  const before=classifySmaSignal(record(cutoff),calculateSmaPoints(extended),calculateSmaPoints(extended));
  const changed=extended.map((bar,index)=>index===200?{...bar,close:999,high:999}:bar);
  const after=classifySmaSignal(record(cutoff),calculateSmaPoints(changed),calculateSmaPoints(changed));
  assert.deepEqual(after,before);
  assert.ok(Date.parse(before.hour.availableAtUtc!)<=Date.parse(cutoff));
  assert.ok(Date.parse(before.day.availableAtUtc!)<=Date.parse(cutoff));
});

test('clasifica alineación individual, orden conjunto y concordancia entre temporalidades',()=>{
  const rising=Array.from({length:202},(_,index)=>aggregate(index,100+index));
  const falling=Array.from({length:202},(_,index)=>aggregate(index,500-index));
  const signalStart=new Date(Date.parse(rising.at(-1)!.endTimestamp)+1).toISOString();
  const bullish=classifySmaSignal(record(signalStart,'CALL_CONTEXT'),calculateSmaPoints(rising),calculateSmaPoints(rising));
  assert.equal(bullish.hour.aboveAll,true);
  assert.equal(bullish.hour.bullishOrder,true);
  assert.equal(bullish.timeframesAgree,true);
  const definitions=smaConditionDefinitions();
  assert.deepEqual(smaConditionStatus(bullish,definitions.find(d=>d.id==='hour_sma200_position_aligned')!),
    {available:true,selected:true});
  assert.deepEqual(smaConditionStatus(bullish,definitions.find(d=>d.id==='hour_sma200_slope_aligned')!),
    {available:true,selected:true});
  const mixed=classifySmaSignal(record(signalStart,'CALL_CONTEXT'),calculateSmaPoints(rising),calculateSmaPoints(falling));
  assert.equal(mixed.timeframesContradict,true);
  assert.equal(mixed.day.belowAll,true);
  assert.equal(mixed.day.bearishOrder,true);
});

test('conserva exactamente las señales, direcciones, segmentos y horizontes de Fase 9',()=>{
  const dates=['2026-06-01','2026-06-02','2026-06-03','2026-06-04','2026-06-05','2026-06-08'];
  const bars=dates.flatMap(date=>session(date,13));
  bars[120]={...bars[120]!,close:110,high:110};
  const schedule=calendar(dates.map(date=>[date,570,960]));
  const phase9=studyNvdaIndicators(bars,schedule);
  const phase10=studyNvdaSmaContext(bars,schedule);
  assert.equal(phase10.sourceSignalCount,phase9.signalCount);
  assert.deepEqual(phase10.signals.map(record=>({signal:record.signal,segment:record.segment,horizons:record.horizons})),
    phase9.signals.map(record=>({signal:record.signal,segment:record.segment,horizons:record.horizons})));
});
