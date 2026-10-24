import {describe,it,expect} from 'vitest';
import Fastify from 'fastify';
import {existsSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TechnicalContext as TechnicalContextSchema,type MarketBar} from '@trading-poc/contracts';
import {buildInvestepTechnicalContext,classifySmaInteraction,classifySmaPair,classifySmaSlope,classifyTimeframeAlignment,detectSmaEvents} from '../../trading_poc_001_bollinger/src/investep-technical-context.ts';
import type {TechnicalBar} from '../../trading_poc_001_bollinger/src/investep-technical-context.ts';
import type {MarketCalendar} from '../../trading_poc_001_bollinger/src/alpaca-calendar.ts';
import type {AggregateCandle,SmaPoint} from '../../trading_poc_001_bollinger/src/multitimeframe.ts';
import {newYorkBarParts} from '../../trading_poc_001_bollinger/src/strategy-validation.ts';
import {registerTechnicalContextRoutes} from '../../apps/api/src/technical-context/routes.ts';
import {selectDeterministicAssistantActions} from '../../apps/api/src/assistant/routes.ts';
import {createApp} from '../../apps/api/src/server.ts';

const source={provider:'Alpaca Market Data API',feed:'sip',adjustment:'split',historicalOrSynthetic:'HISTORICAL' as const};
function fixture(days=210,shortDay=-1){
  const calendar:MarketCalendar=new Map(),bars:TechnicalBar[]=[];
  let count=0;
  for(let date=Date.parse('2025-01-02T00:00:00Z');count<days;date+=86_400_000){
    const day=new Date(date).toISOString().slice(0,10),weekday=new Date(date).getUTCDay();
    if(weekday===0||weekday===6)continue;
    const close=count===shortDay?780:960;
    const open=[13,14].map(h=>Date.parse(`${day}T${h}:30:00Z`)).find(t=>Number(newYorkBarParts(new Date(t).toISOString()).slot.split(':')[0])===9);
    if(open===undefined)throw new Error(`Apertura no encontrada ${day}`);
    calendar.set(day,{open:570,close});
    for(let i=0;i<(close-570)/15;i++){
      const start=open+i*900_000,value=100+count*.2+i*.002;
      bars.push({startUtc:new Date(start).toISOString(),endUtc:new Date(start+900_000).toISOString(),open:value,high:value+.3,low:value-.3,close:value+.1,
        volume:1000,provider:source.provider,adjustment:source.adjustment,receivedAtUtc:null,isComplete:true});
    }
    count++;
  }
  const asOfUtc=bars.at(-1)!.endUtc;
  return {calendar,bars,asOfUtc};
}
const analyze=(data:{calendar:MarketCalendar|null;bars:TechnicalBar[];asOfUtc:string})=>buildInvestepTechnicalContext({symbol:'NVDA',...source,...data});
const bar=(open:number,high:number,low:number,close:number)=>({open,high,low,close});

describe('Investep: reglas numéricas y geometría',()=>{
  it.each([
    [21,20,'BULLISH_ALIGNMENT'],[19,20,'BEARISH_ALIGNMENT'],[20,20,'MIXED'],[null,20,'INSUFFICIENT_DATA'],
    [101,100,'BULLISH_ALIGNMENT'],[99,100,'BEARISH_ALIGNMENT'],[100,100,'MIXED'],[100,null,'INSUFFICIENT_DATA'],
  ] as const)('clasifica pareja %s / %s como %s',(a,b,want)=>expect(classifySmaPair(a,b)).toBe(want));
  it.each([[11,10,'RISING'],[9,10,'FALLING'],[10,10,'FLAT'],[null,10,'UNAVAILABLE'],[10,null,'UNAVAILABLE']] as const)(
    'pendiente %s / %s = %s',(a,b,want)=>expect(classifySmaSlope(a,b).slope).toBe(want));
  it('mantiene el orden alcista aun con pendientes bajistas y viceversa',()=>{
    expect(classifySmaPair(101,100)).toBe('BULLISH_ALIGNMENT');expect(classifySmaSlope(101,102).slope).toBe('FALLING');
    expect(classifySmaPair(99,100)).toBe('BEARISH_ALIGNMENT');expect(classifySmaSlope(99,98).slope).toBe('RISING');
  });
  it.each([
    ['BULLISH_ALIGNMENT','BULLISH_ALIGNMENT','BULLISH_ALIGNMENT','ALIGNED_BULLISH'],
    ['BEARISH_ALIGNMENT','BEARISH_ALIGNMENT','BEARISH_ALIGNMENT','ALIGNED_BEARISH'],
    ['BEARISH_ALIGNMENT','BULLISH_ALIGNMENT','BULLISH_ALIGNMENT','SHORT_TERM_PULLBACK'],
    ['BULLISH_ALIGNMENT','BEARISH_ALIGNMENT','BEARISH_ALIGNMENT','SHORT_TERM_RECOVERY'],
    ['BULLISH_ALIGNMENT','BEARISH_ALIGNMENT','BULLISH_ALIGNMENT','CONFLICTING'],
    ['MIXED','BULLISH_ALIGNMENT','BULLISH_ALIGNMENT','MIXED'],
    ['INSUFFICIENT_DATA','BULLISH_ALIGNMENT','BULLISH_ALIGNMENT','INSUFFICIENT_DATA'],
  ] as const)('compatibilidad %s / %s / %s = %s',(a,b,c,want)=>{
    expect(classifyTimeframeAlignment({'15m':{state:a},'1h':{state:b},'1d':{state:c}})).toBe(want);
  });
  it.each([
    ['toque sin ruptura',bar(101,102,99,101),['TOUCHED_FROM_ABOVE','REJECTED_ABOVE']],
    ['cierre bajo sin vela entera',bar(101,102,99,99),['CROSSED_BELOW']],
    ['vela entera bajo',bar(99,99.5,98,98.5),['FULL_CANDLE_BREAK_BELOW']],
    ['vela entera sobre',bar(101,102,100.5,101.5),['FULL_CANDLE_BREAK_ABOVE']],
    ['cuerpo bajo',bar(99,101,98,98.5),['FULL_BODY_BREAK_BELOW']],
    ['cuerpo sobre',bar(101,102,99,101.5),['FULL_BODY_BREAK_ABOVE']],
  ] as const)('%s',(_name,current,expected)=>{
    const interactions=classifySmaInteraction(bar(101,102,100.5,101),current,100,100);
    for(const item of expected)expect(interactions).toContain(item);
  });
  it('igualdad no se interpreta como cruce',()=>{
    const result=classifySmaInteraction(bar(100,101,99,100),bar(100,101,99,101),100,100);
    expect(result).not.toContain('CROSSED_ABOVE');
  });
});

function points(closes:number[]):SmaPoint[]{return closes.map((close,i)=>{
  const t=Date.parse('2026-10-21T13:30:00Z')+i*900_000;
  const candle:AggregateCandle={timestamp:new Date(t).toISOString(),endTimestamp:new Date(t+900_000).toISOString(),availableAt:new Date(t+900_000).toISOString(),dateNy:'2026-10-21',timeframe:'hour',durationMinutes:15,expectedSourceBars:1,observedSourceBars:1,complete:true,scheduledAbbreviated:false,
    open:close,high:close+1,low:close-1,close,volume:100};
  return {candle,values:{20:100,40:null,100:null,200:null},previous:{20:100,40:null,100:null,200:null}};
});}

describe('secuencias sin anticipar desenlaces',()=>{
  it('registra ruptura falsa y recuperación',()=>{
    const events=detectSmaEvents(points([101,99,101]),'15m');
    expect(events.some(e=>e.kind==='CROSS'&&e.direction==='BELOW')).toBe(true);
    expect(events.some(e=>e.kind==='RECOVERY'&&e.status==='FAILED')).toBe(true);
  });
  it('retesteo bajista dentro de cuatro velas',()=>{
    const events=detectSmaEvents(points([101,99,99]),'15m');
    expect(events.some(e=>e.kind==='RETEST'&&e.direction==='BELOW'&&e.status==='OBSERVED')).toBe(true);
  });
  it('retesteo alcista dentro de cuatro velas',()=>{
    const events=detectSmaEvents(points([99,101,101]),'15m');
    expect(events.some(e=>e.kind==='RETEST'&&e.direction==='ABOVE'&&e.status==='OBSERVED')).toBe(true);
  });
  it('rompimiento pendiente sin retesteo confirmado',()=>{
    expect(detectSmaEvents(points([101,99]),'15m')).toEqual(expect.arrayContaining([expect.objectContaining({kind:'RETEST',status:'PENDING'})]));
  });
  it('vencimiento de retesteo después de cuatro velas',()=>{
    const sequence=points([101,98,98,98,98,98,98]);sequence.forEach(p=>{p.candle.high=p.candle.close+.1;p.candle.low=p.candle.close-.1;});
    expect(detectSmaEvents(sequence,'15m').some(e=>e.kind==='RETEST'&&e.status==='EXPIRED')).toBe(true);
  });
});

describe('motor causal, calendario y procedencia',()=>{
  it('calcula 5/20/60 sesiones anteriores, SMA200 diaria y barra horaria abreviada',()=>{
    const data=fixture(),result=analyze(data);
    expect(TechnicalContextSchema.parse(result)).toBeTruthy();
    expect(result.timeframes['1d'].smas[200].value).not.toBeNull();
    expect(result.timeframes['1h'].scheduledAbbreviated).toBe(true);
    for(const range of result.previousRanges){expect(range.status).toBe('AVAILABLE');expect(range.high).toBeGreaterThan(range.low!);expect(range.referenceEndUtc!<data.asOfUtc).toBe(true);}
    expect(result.levels.every(level=>level.availableAtUtc<=data.asOfUtc&&level.status==='POTENTIAL')).toBe(true);
  });
  it('excluye hora y día incompletos antes del cierre',()=>{
    const data=fixture(2),asOfUtc=data.bars.at(-3)!.endUtc;
    const result=analyze({...data,asOfUtc});
    expect(result.timeframes['1h'].lastCompleteBarUtc!<=asOfUtc).toBe(true);
    expect(result.timeframes['1d'].lastCompleteBarUtc).toBe(data.bars[25]!.endUtc);
  });
  it('excluye la última barra diaria si hay una vela faltante',()=>{
    const data=fixture(3);data.bars.splice(-2,1);
    const result=analyze(data);expect(result.timeframes['1d'].lastCompleteBarUtc).toBe(data.bars[51]!.endUtc);
  });
  it('un cierre anticipado genera agregado completo y abreviado',()=>{
    const data=fixture(2,1),result=analyze(data);
    expect(result.timeframes['1d'].lastCompleteBarUtc).toBe(data.asOfUtc);
    expect(result.timeframes['1h'].scheduledAbbreviated).toBe(true);
  });
  it('respeta EDT/EST al pasar entre sesiones',()=>{
    const data=fixture(60),result=analyze(data);
    expect(result.timeframes['15m'].completeBarsInRun).toBe(data.bars.length);
    expect(result.timeframes['1d'].completeBarsInRun).toBe(60);
  });
  it('la SMA200 diaria sin 200 sesiones continuas queda nula',()=>{
    const result=analyze(fixture(60));expect(result.timeframes['1d'].smas[200].value).toBeNull();
    expect(result.timeframes['1d'].longPair).toBe('INSUFFICIENT_DATA');
  });
  it('una sesión ausente corta la continuidad y bloquea medias largas',()=>{
    const data=fixture(50),missing=[...data.calendar.keys()][25]!;
    const result=analyze({...data,bars:data.bars.filter(b=>newYorkBarParts(b.startUtc).day!==missing)});
    expect(result.timeframes['1d'].completeBarsInRun).toBe(24);
    expect(result.timeframes['1d'].smas[40].value).toBeNull();
  });
  it('una vela incompleta no participa en SMA y deja hueco',()=>{
    const data=fixture(3);data.bars[30]={...data.bars[30]!,isComplete:false};
    const result=analyze(data);expect(result.timeframes['15m'].completeBarsInRun).toBe(data.bars.length-31);
  });
  it('una recepción posterior retrasa causalmente el punto horario sin cambiar el cierre',()=>{
    const data=fixture(2),last=data.bars.at(-1)!;
    data.bars[data.bars.length-1]={...last,receivedAtUtc:new Date(Date.parse(last.endUtc)+60_000).toISOString()};
    const before=analyze({...data,asOfUtc:last.endUtc});
    expect(before.timeframes['15m'].lastCompleteBarUtc).toBe(data.bars.at(-2)!.endUtc);
    const after=analyze({...data,asOfUtc:new Date(Date.parse(last.endUtc)+60_000).toISOString()});
    expect(after.timeframes['15m'].lastCompleteBarUtc).toBe(last.endUtc);
    expect(after.timeframes['1h'].smas[20].availableAtUtc).toBeNull();
  });
  it('no fabrica contexto si faltan calendario o velas',()=>{
    const data=fixture(1);
    expect(analyze({...data,calendar:null}).dataStatus).toBe('UNAVAILABLE');
    expect(analyze({...data,bars:[]}).dataStatus).toBe('UNAVAILABLE');
  });
  it('rechaza procedencia incompatible y OHLCV inválido',()=>{
    const data=fixture(1);
    expect(()=>analyze({...data,bars:[{...data.bars[0]!,provider:'IEX'}]})).toThrow();
    expect(()=>analyze({...data,bars:[{...data.bars[0]!,high:0}]})).toThrow();
  });
  it('marca el histórico viejo como obsoleto',()=>{
    const data=fixture(1),asOfUtc=new Date(Date.parse(data.asOfUtc)+8*86_400_000).toISOString();
    expect(analyze({...data,asOfUtc}).dataStatus).toBe('STALE');
  });
  it('marca falta de vela esperada durante sesión y no confunde fin de semana con hueco',()=>{
    const data=fixture(2),firstClose=data.bars[25]!.endUtc;
    expect(analyze({...data,bars:data.bars.slice(0,26),asOfUtc:data.bars[29]!.endUtc}).dataStatus).toBe('STALE');
    const weekend=new Date(Date.parse(data.asOfUtc)+2*86_400_000).toISOString();
    expect(analyze({...data,asOfUtc:weekend}).dataStatus).toBe('HISTORICAL');
    expect(firstClose<data.asOfUtc).toBe(true);
  });
  it('añadir velas posteriores a asOf no altera cálculos',()=>{
    const data=fixture(2),asOfUtc=data.bars[25]!.endUtc;
    const first=analyze({...data,asOfUtc,bars:data.bars.slice(0,26)});
    const full=analyze({...data,asOfUtc});expect(full).toEqual(first);
  });
});

describe('API, Radar y asistente de solo lectura',()=>{
  it('responde un contrato Zod válido y rechaza símbolos/fechas inválidas',async()=>{
    const data=fixture(2),app=Fastify();
    const bars:MarketBar[]=data.bars.map(b=>({...b,symbol:'NVDA',timeframe:'15m'}));
    registerTechnicalContextRoutes(app,{mode:'OFFLINE',barsFor:()=>bars,calendarFor:()=>data.calendar,
      metadataFor:()=>({asset:'NVDA',provider:source.provider,bar_minutes:15,data_class:'real',session:'regular',exchange_timezone:'America/New_York',feed:'sip',adjustment:'split'}),clock:()=>Date.parse(data.asOfUtc)});
    try{
      const response=await app.inject('/api/v1/market/technical-context?symbol=NVDA');expect(response.statusCode).toBe(200);
      expect(TechnicalContextSchema.parse(response.json()).symbol).toBe('NVDA');
      expect((await app.inject('/api/v1/market/technical-context?symbol=TSLA')).statusCode).toBe(400);
      expect((await app.inject('/api/v1/market/technical-context?symbol=NVDA&asOfUtc=bad')).statusCode).toBe(400);
      expect((await app.inject('/api/v1/market/technical-context?symbol=NVDA&asOfUtc=2099-01-01T00:00:00Z')).statusCode).toBe(400);
    }finally{await app.close();}
  });
  it('selecciona estructura técnica explícita sin convertir compra en análisis',()=>{
    expect(selectDeterministicAssistantActions('Explicá la estructura técnica SMA20/40 de NVDA')).toEqual({kind:'actions',actions:[{name:'get_technical_context',args:{symbols:['NVDA']}}]});
    expect(selectDeterministicAssistantActions('Compara soportes y resistencias de NVDA y QQQ')).toEqual({kind:'actions',actions:[{name:'get_technical_context',args:{symbols:['NVDA','QQQ']}}]});
    expect(selectDeterministicAssistantActions('Compra NVDA si toca la SMA')).toBeNull();
  });
  it('no admite tres activos ni símbolos desconocidos en el selector técnico',()=>{
    expect(selectDeterministicAssistantActions('Estructura técnica de NVDA QQQ SMH')).toMatchObject({kind:'rejected'});
    expect(selectDeterministicAssistantActions('Estructura técnica de TSLA')).toMatchObject({kind:'rejected'});
  });
  it('integra API DEMO sintética y asistente sin modificar ledgers ni abrir órdenes',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'phase41a-'));
    const {app}=await createApp({mode:'DEMO',privateDir:dir,dbPath:join(dir,'test.sqlite'),newsDir:join(dir,'news'),
      phase16Ledger:join(dir,'phase16'),phase17Private:join(dir,'phase17'),radarFrozenDir:null,radarObservationLog:join(dir,'absent.jsonl')});
    try{
      const context=await app.inject('/api/v1/market/technical-context?symbol=NVDA');
      expect(context.statusCode).toBe(200);
      expect(TechnicalContextSchema.parse(context.json()).historicalOrSynthetic).toBe('SYNTHETIC');
      const token=(await app.inject({url:'/api/v1/session',headers:{origin:'http://localhost:5173'}})).json().token as string;
      expect((await app.inject({method:'POST',url:'/api/v1/market/technical-context',headers:{'x-local-token':token}})).statusCode).toBe(404);
      const radar=await app.inject('/api/v1/radar');expect(radar.statusCode).toBe(200);
      const assistant=await app.inject({method:'POST',url:'/api/v1/assistant/chat',headers:{'x-local-token':token},
        payload:{message:'Describí la estructura técnica SMA20/40 de NVDA'}});
      expect(assistant.statusCode).toBe(200);
      expect(assistant.json().answer).toContain('Estructura técnica');
      expect(assistant.json().evidence.some((row:{asset:string;dataType:string})=>row.asset==='NVDA'&&row.dataType==='SYNTHETIC')).toBe(true);
      expect(existsSync(join(dir,'phase16'))).toBe(false);
      expect(existsSync(join(dir,'observations.jsonl'))).toBe(false);
    }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
  });
});
