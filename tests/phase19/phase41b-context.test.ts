import {describe,it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createPhase41bIndex,loadPhase41bSip} from '../../trading_poc_001_bollinger/src/phase41b-context.ts';
import {buildInvestepTechnicalContext} from '../../trading_poc_001_bollinger/src/investep-technical-context.ts';
import {newYorkBarParts} from '../../trading_poc_001_bollinger/src/strategy-validation.ts';
import type {MarketCalendar} from '../../trading_poc_001_bollinger/src/alpaca-calendar.ts';
import type {Candle} from '../../trading_poc_001_bollinger/src/domain.ts';

function fixture(days=215,abbreviated=-1){
  const calendar:MarketCalendar=new Map(),bars:Candle[]=[];let seen=0;
  for(let time=Date.parse('2025-01-02T00:00:00Z');seen<days;time+=86_400_000){
    const day=new Date(time).toISOString().slice(0,10),weekday=new Date(time).getUTCDay();
    if(weekday===0||weekday===6)continue;
    const open=[13,14].map(hour=>Date.parse(`${day}T${hour}:30:00Z`))
      .find(value=>newYorkBarParts(new Date(value).toISOString()).slot==='09:30');
    if(open===undefined)throw new Error('DST fixture inválida');
    const close=seen===abbreviated?780:960;calendar.set(day,{open:570,close});
    for(let i=0;i<(close-570)/15;i++){
      const timestamp=new Date(open+i*900_000).toISOString(),value=100+seen*.03+Math.sin((seen*26+i)/17);
      bars.push({timestamp,open:value,high:value+.5,low:value-.5,close:value+.1,volume:1000+i});
    }
    seen++;
  }
  return {bars,calendar};
}
function engineAt(bars:Candle[],calendar:MarketCalendar,at:string,delay:number){
  return buildInvestepTechnicalContext({symbol:'NVDA',asOfUtc:at,calendar,provider:'Alpaca Market Data API',
    feed:'sip',adjustment:'split',historicalOrSynthetic:'HISTORICAL',bars:bars.map(bar=>({
      startUtc:bar.timestamp,endUtc:new Date(Date.parse(bar.timestamp)+900_000).toISOString(),
      open:bar.open,high:bar.high,low:bar.low,close:bar.close,volume:bar.volume,
      provider:'Alpaca Market Data API',adjustment:'split',isComplete:true,
      receivedAtUtc:new Date(Date.parse(bar.timestamp)+(15+delay)*60_000).toISOString()}))});
}
describe('Fase 41B: índice SIP causal sobre motor 41A',()=>{
  it('acepta SIP split real y rechaza metadatos incompatibles',()=>{
    const dir=mkdtempSync(join(tmpdir(),'phase41b-sip-')),csv=join(dir,'nvda.csv');
    const meta={asset:'NVDA',provider:'Alpaca Market Data API',bar_minutes:15,data_class:'real',session:'regular',
      exchange_timezone:'America/New_York',feed:'sip',adjustment:'split'};
    const provenance={provider:'Alpaca Market Data API',feed:'sip',adjustment:'split',timeframe:'15Min',
      calendar_endpoint:'/v2/calendar',credentials_recorded:false};
    try{
      writeFileSync(csv,'timestamp,open,high,low,close,volume\n2025-01-02T14:30:00.000Z,10,11,9,10,100\n');
      writeFileSync(`${csv}.meta.json`,JSON.stringify(meta));
      writeFileSync(`${csv}.provenance.json`,JSON.stringify(provenance));
      writeFileSync(`${csv}.calendar.json`,JSON.stringify({provider:'Alpaca Market Calendar',
        sessions:[{date:'2025-01-02',open:570,close:960}]}));
      expect(loadPhase41bSip(csv).candles).toHaveLength(1);
      writeFileSync(`${csv}.meta.json`,JSON.stringify({...meta,feed:'iex'}));
      expect(()=>loadPhase41bSip(csv)).toThrow();
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
  it('CLI une consultas exactas y rechaza timestamps imposibles o duplicados',()=>{
    const dir=mkdtempSync(join(tmpdir(),'phase41b-cli-')),csv=join(dir,'nvda.csv'),queries=join(dir,'queries.json'),
      out=join(dir,'contexts.json'),script=resolve('trading_poc_001_bollinger/src/phase41b-context-cli.ts');
    const q={scenario:'ideal',fold:1,barStartUtc:'2025-01-02T14:30:00.000Z',
      barEndUtc:'2025-01-02T14:45:00.000Z',decisionAtUtc:'2025-01-02T15:00:00.000Z'};
    const execute=()=>spawnSync(process.execPath,['--import','tsx',script,'--sip-csv',csv,'--queries',queries,'--out',out],
      {cwd:resolve('.'),encoding:'utf8'});
    try{
      writeFileSync(csv,'timestamp,open,high,low,close,volume\n2025-01-02T14:30:00.000Z,10,11,9,10,100\n');
      writeFileSync(`${csv}.meta.json`,JSON.stringify({asset:'NVDA',provider:'Alpaca Market Data API',bar_minutes:15,
        data_class:'real',session:'regular',exchange_timezone:'America/New_York',feed:'sip',adjustment:'split'}));
      writeFileSync(`${csv}.provenance.json`,JSON.stringify({provider:'Alpaca Market Data API',feed:'sip',adjustment:'split',
        timeframe:'15Min',calendar_endpoint:'/v2/calendar',credentials_recorded:false}));
      writeFileSync(`${csv}.calendar.json`,JSON.stringify({provider:'Alpaca Market Calendar',
        sessions:[{date:'2025-01-02',open:570,close:960}]}));
      writeFileSync(queries,JSON.stringify([q]));
      expect(execute().status).toBe(0);
      expect(JSON.parse(readFileSync(out,'utf8')).rows).toHaveLength(3);
      rmSync(out);
      writeFileSync(queries,JSON.stringify([q,q]));
      expect(execute().status).not.toBe(0);
      expect(existsSync(out)).toBe(false);
      writeFileSync(queries,JSON.stringify([{...q,barStartUtc:'2025-02-30T14:30:00.000Z'}]));
      expect(execute().status).not.toBe(0);
      expect(existsSync(out)).toBe(false);
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
  it.each([15,20,30] as const)('retrasa SIP %i minutos sin usar barras futuras y coincide con 41A',delay=>{
    const {bars,calendar}=fixture(),selected=bars.at(-11)!,barEnd=Date.parse(selected.timestamp)+900_000;
    const at=new Date(barEnd+delay*60_000).toISOString();
    const index=createPhase41bIndex(bars,calendar,delay),snapshot=index(at,new Date(barEnd).toISOString());
    const engine=engineAt(bars,calendar,at,delay);
    expect(snapshot.reason).toBe('TECHNICAL_CONTEXT_AVAILABLE');
    expect(snapshot.sipAssumedAvailableAtUtc).toBe(at);
    expect(snapshot.currentBarDelayNotMet).toBe(false);
    expect(snapshot.alignment).toBe(engine.alignment);
    for(const frame of ['15m','1h','1d'] as const){
      expect(snapshot.frames[frame].shortPair).toBe(engine.timeframes[frame].shortPair);
      expect(snapshot.frames[frame].longPair).toBe(engine.timeframes[frame].longPair);
      expect(snapshot.frames[frame].barEndUtc).toBe(engine.timeframes[frame].lastCompleteBarUtc);
      for(const period of [20,40,100,200] as const){
        expect(snapshot.frames[frame].sma[period].value).toBeCloseTo(engine.timeframes[frame].smas[period].value!,9);
        expect(snapshot.frames[frame].sma[period].slope).toBe(engine.timeframes[frame].smas[period].slope);
        expect(snapshot.frames[frame].sma[period].interactions).toEqual(engine.timeframes[frame].smas[period].interactions);
      }
    }
    expect(snapshot.ranges['20'].distanceToLowPercent).toBeCloseTo(engine.previousRanges[1]!.distanceToLowPercent!,9);
    const justBefore=index(new Date(barEnd+delay*60_000-1).toISOString(),new Date(barEnd).toISOString());
    expect(justBefore.sipBarEndUtc).toBe(new Date(barEnd-900_000).toISOString());
    expect(justBefore.currentBarDelayNotMet).toBe(true);
    const causalPrefix=bars.slice(0,bars.indexOf(selected)+1);
    expect(createPhase41bIndex(causalPrefix,calendar,delay)(at,new Date(barEnd).toISOString()).frames['15m'].sma[20].value)
      .toBe(snapshot.frames['15m'].sma[20].value);
  });
  it('mantiene diario incompleto fuera del índice y respeta cierre anticipado',()=>{
    const {bars,calendar}=fixture(210,209),last=bars.at(-1)!,end=Date.parse(last.timestamp)+900_000;
    const index=createPhase41bIndex(bars,calendar,15),before=index(new Date(end+14*60_000).toISOString(),new Date(end).toISOString());
    const after=index(new Date(end+15*60_000).toISOString(),new Date(end).toISOString());
    expect(before.frames['1d'].barEndUtc).not.toBe(new Date(end).toISOString());
    expect(after.frames['1d'].barEndUtc).toBe(new Date(end).toISOString());
    expect(after.frames['1d'].continuousBars).toBeGreaterThanOrEqual(200);
  });
  it('marca falta de historia, salida de cobertura y un hueco sin inventar SMA',()=>{
    const {bars,calendar}=fixture(3),delay=15;
    const index=createPhase41bIndex(bars,calendar,delay);
    const middle=bars[10]!,at=new Date(Date.parse(middle.timestamp)+30*60_000).toISOString();
    expect(index(at,new Date(Date.parse(middle.timestamp)+900_000).toISOString()).reason).toBe('INSUFFICIENT_SIP_HISTORY');
    const outside=index('2026-01-01T15:00:00.000Z',new Date(Date.parse(middle.timestamp)+900_000).toISOString());
    expect(outside.reason).toBe('SOURCE_OUT_OF_RANGE');
    expect(outside.sipClose).toBeNull();
    expect(outside.frames['15m'].sma[20].value).toBeNull();
    const gapped=bars.filter((_,i)=>i!==10),gap=createPhase41bIndex(gapped,calendar,delay);
    expect(gap(at,new Date(Date.parse(middle.timestamp)+900_000).toISOString()).frames['15m'].continuousBars).toBeLessThan(20);
  });
  it('mantiene continuidad causal de viernes a lunes al cambiar de EST a EDT',()=>{
    const {bars,calendar}=fixture(55),friday=[...bars].reverse().find(b=>b.timestamp.startsWith('2025-03-07'))!,
      monday=bars.find(b=>b.timestamp==='2025-03-10T13:30:00.000Z')!;
    expect(friday).toBeDefined();expect(monday).toBeDefined();
    const index=createPhase41bIndex(bars,calendar,15);
    const afterFriday=index(new Date(Date.parse(friday.timestamp)+1_800_000).toISOString(),
      new Date(Date.parse(friday.timestamp)+900_000).toISOString());
    const afterMonday=index(new Date(Date.parse(monday.timestamp)+1_800_000).toISOString(),
      new Date(Date.parse(monday.timestamp)+900_000).toISOString());
    expect(afterMonday.frames['15m'].continuousBars).toBe(afterFriday.frames['15m'].continuousBars+1);
    expect(afterMonday.sipBarEndUtc).toBe('2025-03-10T13:45:00.000Z');
  });
  it('no adelanta un retesteo: queda pendiente hasta la vela que lo confirma',()=>{
    const {bars,calendar}=fixture();
    for(const bar of bars){bar.open=100;bar.high=100.4;bar.low=99.6;bar.close=100;}
    const below=bars.at(-7)!,breakout=bars.at(-6)!,held=bars.at(-5)!,retest=bars.at(-4)!;
    Object.assign(below,{open:99,high:99.4,low:98.6,close:99});
    Object.assign(breakout,{open:101,high:101.4,low:100.6,close:101});
    Object.assign(held,{open:101,high:101.4,low:100.6,close:101});
    Object.assign(retest,{open:101,high:101.4,low:99.9,close:101});
    const at=(bar:Candle)=>new Date(Date.parse(bar.timestamp)+1_800_000).toISOString();
    const end=(bar:Candle)=>new Date(Date.parse(bar.timestamp)+900_000).toISOString();
    const index=createPhase41bIndex(bars,calendar,15),before=index(at(held),end(held));
    const futureFree=createPhase41bIndex(bars.slice(0,bars.indexOf(held)+1),calendar,15)(at(held),end(held));
    expect(before.frames['15m'].events).toEqual(futureFree.frames['15m'].events);
    expect(before.frames['15m'].events.some(e=>e.period===20&&e.kind==='RETEST'&&e.status==='PENDING')).toBe(true);
    const after=index(at(retest),end(retest));
    expect(after.frames['15m'].events.some(e=>e.period===20&&e.kind==='RETEST'&&e.status==='OBSERVED')).toBe(true);
  });
});
