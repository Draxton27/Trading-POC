import {describe,it,expect} from 'vitest';
import Fastify from 'fastify';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {InvestepScenarioResponse,TechnicalContext as TechnicalContextSchema,type TechnicalContext,type MarketBar} from '@trading-poc/contracts';
import {buildInvestepScenarios} from '../../trading_poc_001_bollinger/src/phase41k-scenarios.ts';
import {buildInvestepTechnicalContext} from '../../trading_poc_001_bollinger/src/investep-technical-context.ts';
import {registerScenarioRoutes} from '../../apps/api/src/radar/scenarios-routes.ts';
import {createApp} from '../../apps/api/src/server.ts';

const asOfUtc='2026-10-21T15:00:00.000Z',latestStart='2026-10-21T14:45:00.000Z';
type Event=TechnicalContext['events'][number];
const event=(kind:Event['kind'],direction:Event['direction']='ABOVE',status:Event['status']='OBSERVED',
  barStartUtc=latestStart,period:Event['period']=20):Event=>({timeframe:'15m',kind,period,direction,status,
    atUtc:new Date(Date.parse(barStartUtc)+900_000).toISOString(),barStartUtc,
    breakAtUtc:kind==='RETEST'||kind==='RECOVERY'?'2026-10-21T14:15:00.000Z':null,
    description:`${kind} ${direction} ${status}`});
const sma=(period:20|40|100|200,value:number|null,previousValue=value)=>({period,value,previousValue,slopePercent:0,
  slope:value===null?'UNAVAILABLE' as const:'FLAT' as const,priceDistancePercent:value===null?null:(100/value-1)*100,
  priceAboveSma:value===null?null:100>value,priceBelowSma:value===null?null:100<value,
  interactions:[] as TechnicalContext['timeframes']['15m']['smas'][20]['interactions'],availableAtUtc:value===null?null:asOfUtc});
function frame(timeframe:'15m'|'1h'|'1d',shortPair:'BULLISH_ALIGNMENT'|'BEARISH_ALIGNMENT'|'MIXED'|'INSUFFICIENT_DATA'='BULLISH_ALIGNMENT',
  longPair:typeof shortPair='BULLISH_ALIGNMENT'){
  return {timeframe,lastCompleteBarUtc:asOfUtc,lastBarStartUtc:timeframe==='15m'?latestStart:'2026-10-21T13:30:00.000Z',
    scheduledAbbreviated:false,completeBarsInRun:220,smas:{20:sma(20,99),40:sma(40,98),100:sma(100,97),200:sma(200,96)},
    shortPair,longPair,state:shortPair,limitations:[]};
}
function context(events:Event[]=[],options:{dataStatus?:TechnicalContext['dataStatus'];short1h?:'BULLISH_ALIGNMENT'|'BEARISH_ALIGNMENT';
  long1d?:'BULLISH_ALIGNMENT'|'BEARISH_ALIGNMENT';last15m?:string|null}={}):TechnicalContext{
  const technical={symbol:'NVDA',asOfUtc,source:'Alpaca Market Data API · sip',provider:'Alpaca Market Data API',feed:'sip',adjustment:'split',
    historicalOrSynthetic:'HISTORICAL',dataStatus:options.dataStatus??'HISTORICAL',lastCompleteBarUtc:asOfUtc,ageMinutes:0,
    timeframes:{'15m':{...frame('15m'),lastCompleteBarUtc:options.last15m===undefined?asOfUtc:options.last15m,
      lastBarStartUtc:options.last15m===null?null:latestStart},'1h':frame('1h',options.short1h),'1d':frame('1d','BULLISH_ALIGNMENT',options.long1d)},
    alignment:'ALIGNED_BULLISH',previousRanges:[],levels:[{symbol:'NVDA',timeframe:'15m',kind:'MOVING_AVERAGE',period:20,levelPrice:99,
      distancePercent:1,referenceStartUtc:'2026-10-20T13:30:00.000Z',referenceEndUtc:asOfUtc,availableAtUtc:asOfUtc,
      source:'41A',method:'SMA20',status:'POTENTIAL'}],events,limitations:[]};
  return TechnicalContextSchema.parse(technical);
}
const metrics={close:100,bollingerUpper:101,bollingerMiddle:100,bollingerLower:99,relativeVolume20:1.2,
  returnOneBarPercent:0.1,returnFourBarsPercent:-0.2};
const scenarios=(events:Event[]=[],options:Parameters<typeof context>[1]={},receiptVerified=false)=>
  InvestepScenarioResponse.parse(buildInvestepScenarios(context(events,options),metrics,receiptVerified));

describe('Fase 41K: composición determinista de eventos 41A',()=>{
  it.each([
    ['REJECTION','ABOVE','OBSERVED','SMA_PULLBACK_REJECTION','OBSERVED'],
    ['REJECTION','BELOW','OBSERVED','SMA_PULLBACK_REJECTION','OBSERVED'],
    ['CROSS','ABOVE','OBSERVED','SMA_STRUCTURE_BREAK','OBSERVED'],
    ['FULL_CANDLE_BREAK','BELOW','OBSERVED','SMA_STRUCTURE_BREAK','OBSERVED'],
    ['RETEST','ABOVE','OBSERVED','SMA_BREAK_RETEST','OBSERVED'],
    ['RETEST','BELOW','PENDING','SMA_BREAK_RETEST','AWAITING_CONFIRMATION'],
    ['RETEST','BELOW','FAILED','SMA_BREAK_RETEST','FAILED'],
    ['RETEST','ABOVE','EXPIRED','SMA_BREAK_RETEST','EXPIRED'],
  ] as const)('%s %s %s conserva familia, dirección y estado',(kind,direction,status,family,want)=>{
    const row=scenarios([event(kind,direction,status)]).current.find(item=>item.family===family);
    expect(row).toMatchObject({direction,state:want,period:20,trigger:{kind},source:{feed:'sip',adjustment:'split'}});
    expect(row!.confirmations).toHaveLength(status==='OBSERVED'?1:0);
    expect(JSON.stringify(row)).not.toMatch(/CALL|PUT|probabilidad|compra recomendada/i);
  });
  it('distingue cruce por cierre de ruptura de vela completa, sin duplicar el mismo evento por polling',()=>{
    const a=scenarios([event('CROSS'),event('FULL_CANDLE_BREAK')]);
    const b=scenarios([event('CROSS'),event('FULL_CANDLE_BREAK')]);
    const breaks=a.current.filter(item=>item.family==='SMA_STRUCTURE_BREAK');
    expect(breaks).toHaveLength(2);expect(new Set(breaks.map(item=>item.id)).size).toBe(2);
    expect(a).toEqual(b);
  });
  it('conserva un identificador de episodio entre retesteo pendiente y confirmado',()=>{
    const pending=scenarios([event('RETEST','ABOVE','PENDING')]).current.find(item=>item.family==='SMA_BREAK_RETEST')!;
    const observed=scenarios([event('RETEST','ABOVE','OBSERVED')]).current.find(item=>item.family==='SMA_BREAK_RETEST')!;
    expect(pending.id).toBe(observed.id);expect(pending.breakAtUtc).toBe(observed.breakAtUtc);
  });
  it('un evento anterior queda solo en consulta histórica, aunque sea el único',()=>{
    const old=event('CROSS','BELOW','OBSERVED','2026-10-21T14:15:00.000Z');
    const response=scenarios([old]);
    expect(response.historical.some(item=>item.family==='SMA_STRUCTURE_BREAK')).toBe(true);
    expect(response.current.every(item=>item.family!=='SMA_STRUCTURE_BREAK')).toBe(true);
  });
  it('mantiene pendiente únicamente cuando 41A lo mantiene en la última vela',()=>{
    const old=event('RETEST','ABOVE','PENDING','2026-10-21T14:30:00.000Z');
    expect(scenarios([old]).current.some(item=>item.state==='AWAITING_CONFIRMATION')).toBe(false);
  });
  it('registra contradicciones de ambas parejas y de ambos marcos superiores, sin resolverlas',()=>{
    const response=scenarios([event('REJECTION','BELOW')],{short1h:'BULLISH_ALIGNMENT',long1d:'BULLISH_ALIGNMENT'});
    const row=response.current.find(item=>item.family==='SMA_PULLBACK_REJECTION')!;
    expect(row.contradictions.some(item=>item.timeframe==='1h'&&item.component==='SMA20_40')).toBe(true);
    expect(row.contradictions.some(item=>item.timeframe==='1d'&&item.component==='SMA100_200')).toBe(true);
    expect(row.context!.frames['15m'].smas['20'].slope).toBe('FLAT');
    expect(row.context!.frames['15m'].shortPair).toBe('BULLISH_ALIGNMENT');
  });
  it('separa pendientes, igualdad y disponibilidad de SMA200 del orden de las parejas',()=>{
    const input=context([event('REJECTION')]);
    input.timeframes['15m'].smas['20'].slope='FALLING';
    input.timeframes['15m'].smas['200']=sma(200,null);
    input.timeframes['15m'].shortPair='MIXED';
    const row=buildInvestepScenarios(input,metrics).current.find(item=>item.family==='SMA_PULLBACK_REJECTION')!;
    expect(row.context!.frames['15m'].smas['20'].slope).toBe('FALLING');
    expect(row.context!.frames['15m'].shortPair).toBe('MIXED');
    expect(row.context!.frames['15m'].smas['200'].value).toBeNull();
  });
  it('conserva dirección y procedencia SIP split; no mezcla IEX raw',()=>{
    const row=scenarios([event('CROSS','BELOW')]).current.find(item=>item.family==='SMA_STRUCTURE_BREAK')!;
    expect(row.direction).toBe('BELOW');expect(row.feed).toBe('sip');expect(row.adjustment).toBe('split');
    expect(row.dataStatus).toBe('HISTORICAL');
  });
  it('no fabrica hora de recepción histórica y sí expone disponibilidad verificada',()=>{
    expect(scenarios([event('CROSS')]).current.find(item=>item.family==='SMA_STRUCTURE_BREAK')!.availableAtUtc).toBeNull();
    expect(scenarios([event('CROSS')],{},true).current.find(item=>item.family==='SMA_STRUCTURE_BREAK')!.availableAtUtc).toBe(asOfUtc);
  });
  it('usa la recepción real para Bollinger, posterior al cierre físico',()=>{
    const input=context();input.asOfUtc='2026-10-21T15:05:00.000Z';
    const response=buildInvestepScenarios(input,metrics,true,'2026-10-21T15:03:00.000Z');
    const row=response.current.find(item=>item.family==='BOLLINGER_VOLUME_CONTEXT')!;
    expect(row.eventAtUtc).toBe(asOfUtc);expect(row.availableAtUtc).toBe('2026-10-21T15:03:00.000Z');
  });
  it('distingue histórico, sintético, obsoleto y no disponible',()=>{
    for(const status of ['HISTORICAL','SYNTHETIC','STALE','UNAVAILABLE'] as const){
      const response=scenarios([], {dataStatus:status});
      expect(response.source.dataStatus).toBe(status);
      if(status==='UNAVAILABLE')expect(response.status).toBe('UNAVAILABLE');
    }
  });
  it('excluye niveles que solo estarían disponibles después del corte',()=>{
    const input=context([event('REJECTION')]);
    input.levels.push({...input.levels[0]!,availableAtUtc:'2026-10-21T16:00:00.000Z'});
    const row=buildInvestepScenarios(input,metrics).current.find(item=>item.family==='SMA_PULLBACK_REJECTION')!;
    expect(row.relatedLevels).toHaveLength(1);
  });
  it('un evento antiguo no recibe medias, niveles ni contradicciones posteriores',()=>{
    const row=scenarios([event('CROSS','BELOW','OBSERVED','2026-10-21T14:15:00.000Z')]).historical[0]!;
    expect(row.context).toBeNull();expect(row.relatedLevels).toHaveLength(0);
    expect(row.contradictions).toHaveLength(0);
  });
  it('oculta el marco rápido posterior a un evento diario todavía último de su marco',()=>{
    const input=context([{...event('REJECTION'),timeframe:'1d',barStartUtc:'2026-10-21T13:30:00.000Z'}]);
    input.asOfUtc='2026-10-21T16:00:00.000Z';
    input.timeframes['15m'].lastCompleteBarUtc='2026-10-21T16:00:00.000Z';
    const row=buildInvestepScenarios(input,null).current[0]!;
    expect(row.context?.frames['15m'].barEndUtc).toBeNull();
    expect(row.context?.frames['15m'].smas['20'].value).toBeNull();
    expect(row.context?.alignment).toBe('INSUFFICIENT_DATA');
  });
  it('oculta una SMA cuya recepción sucede después del evento aunque la vela ya hubiese cerrado',()=>{
    const input=context([event('REJECTION')]);
    input.timeframes['1h'].smas['20'].availableAtUtc='2026-10-21T15:04:00.000Z';
    const row=buildInvestepScenarios(input,null).current[0]!;
    expect(row.context?.frames['1h'].smas['20'].value).toBeNull();
    expect(row.context?.alignment).toBe('INSUFFICIENT_DATA');
  });
  it('expresa ausencia de escenarios cuando no hay eventos ni Bollinger calculable',()=>{
    const response=buildInvestepScenarios(context(),null);
    expect(response.status).toBe('NO_SCENARIO');expect(response.current).toHaveLength(0);
  });
  it('expresa insuficiencia cuando no hay última vela completa',()=>{
    const response=buildInvestepScenarios(context([],{last15m:null}),null);
    expect(response.status).toBe('INSUFFICIENT_DATA');expect(response.current).toHaveLength(0);
  });
});

describe('Fase 41K: contexto Bollinger y volumen sin reglas nuevas',()=>{
  it.each([
    [102,'ABOVE_UPPER','ABOVE'],[98,'BELOW_LOWER','BELOW'],[100,'INSIDE','NEUTRAL'],[101,'ON_BAND','NEUTRAL'],
  ] as const)('cierre %i se clasifica como %s', (close,position,direction)=>{
    const response=buildInvestepScenarios(context(),{...metrics,close});
    expect(response.current[0]).toMatchObject({family:'BOLLINGER_VOLUME_CONTEXT',direction,bollingerVolume:{position}});
  });
  it('marca bandas incompletas y RVOL ausente sin umbral de volumen',()=>{
    const response=buildInvestepScenarios(context(),{...metrics,bollingerUpper:null,relativeVolume20:null});
    expect(response.status).toBe('INSUFFICIENT_DATA');
    expect(response.current[0]).toMatchObject({state:'INSUFFICIENT_DATA',bollingerVolume:{position:'UNAVAILABLE',relativeVolume20:null}});
    expect(response.current[0]!.limitations.join(' ')).toMatch(/RVOL|historial de volumen/i);
  });
  it('el ancho cero de Bollinger no se convierte en posición ni señal',()=>{
    const response=buildInvestepScenarios(context(),{...metrics,bollingerUpper:100,bollingerLower:100});
    expect(response.status).toBe('INSUFFICIENT_DATA');
    expect(response.current[0]).toMatchObject({state:'INSUFFICIENT_DATA',bollingerVolume:{position:'UNAVAILABLE'}});
  });
});

function bars(receivedAtUtc:string|null=null):MarketBar[]{
  const start=Date.parse('2026-10-21T13:30:00.000Z');
  return Array.from({length:26},(_,i)=>{const t=start+i*900_000,value=100+i*.1;
    return {symbol:'NVDA',timeframe:'15m',startUtc:new Date(t).toISOString(),endUtc:new Date(t+900_000).toISOString(),
      open:value,high:value+.2,low:value-.2,close:value+.05,volume:1000,provider:'Alpaca Market Data API',adjustment:'split',
      receivedAtUtc,isComplete:true};});
}
const metadata=()=>({asset:'NVDA' as const,provider:'Alpaca Market Data API',bar_minutes:15 as const,data_class:'real' as const,
  session:'regular' as const,exchange_timezone:'America/New_York' as const,feed:'sip' as const,adjustment:'split' as const});

describe('API de escenarios, causalidad y solo lectura',()=>{
  it('devuelve contrato válido y rechaza símbolos, campos y fechas futuras',async()=>{
    const app=Fastify(),input=bars();
    registerScenarioRoutes(app,{mode:'OFFLINE',barsFor:()=>input,metadataFor:metadata,
      calendarFor:()=>new Map([['2026-10-21',{open:570,close:960}]]),clock:()=>Date.parse('2026-10-21T20:00:00.000Z')});
    try{
      const result=await app.inject('/api/v1/radar/scenarios?symbol=NVDA');
      expect(result.statusCode).toBe(200);
      const body=InvestepScenarioResponse.parse(result.json());
      expect(body.source).toMatchObject({feed:'sip',adjustment:'split',receiptVerified:false});
      expect(body.current.some(item=>item.family==='BOLLINGER_VOLUME_CONTEXT')).toBe(true);
      expect(body.current.every(item=>item.availableAtUtc===null)).toBe(true);
      for(const invalid of ['symbol=TSLA','symbol=NVDA&asOfUtc=bad','symbol=NVDA&path=private','symbol=NVDA&asOfUtc=2099-01-01T00:00:00Z'])
        expect((await app.inject(`/api/v1/radar/scenarios?${invalid}`)).statusCode).toBe(400);
      expect((await app.inject({method:'POST',url:'/api/v1/radar/scenarios?symbol=NVDA'})).statusCode).toBe(404);
    }finally{await app.close();}
  });
  it('no usa una vela recibida después de asOfUtc para indicadores ni escenarios',async()=>{
    const app=Fastify(),input=bars();input[25]!.receivedAtUtc='2026-10-21T20:05:00.000Z';
    registerScenarioRoutes(app,{mode:'OFFLINE',barsFor:()=>input,metadataFor:metadata,
      calendarFor:()=>new Map([['2026-10-21',{open:570,close:960}]]),clock:()=>Date.parse('2026-10-21T20:00:00.000Z')});
    try{const result=await app.inject('/api/v1/radar/scenarios?symbol=NVDA');
      expect(result.statusCode).toBe(200);
      const body=InvestepScenarioResponse.parse(result.json());
      expect(body.frames['15m'].barEndUtc).toBe(input[24]!.endUtc);
      expect(body.current.find(item=>item.family==='BOLLINGER_VOLUME_CONTEXT')?.eventAtUtc).toBe(input[24]!.endUtc);
    }finally{await app.close();}
  });
  it('el contexto Bollinger distingue cierre y recepción tardía comprobada',async()=>{
    const app=Fastify(),input=bars('2026-10-21T20:05:00.000Z');
    registerScenarioRoutes(app,{mode:'OFFLINE',barsFor:()=>input,metadataFor:metadata,
      calendarFor:()=>new Map([['2026-10-21',{open:570,close:960}]]),clock:()=>Date.parse('2026-10-21T20:05:00.000Z')});
    try{const result=await app.inject('/api/v1/radar/scenarios?symbol=NVDA');
      expect(result.statusCode).toBe(200);
      const body=InvestepScenarioResponse.parse(result.json());
      const row=body.current.find(item=>item.family==='BOLLINGER_VOLUME_CONTEXT')!;
      expect(body.source.receiptVerified).toBe(true);
      expect(row.eventAtUtc).toBe('2026-10-21T20:00:00.000Z');
      expect(row.availableAtUtc).toBe('2026-10-21T20:05:00.000Z');
    }finally{await app.close();}
  });
  it('rechaza procedencia no SIP split sin mezclarla con el contexto técnico',async()=>{
    const app=Fastify();registerScenarioRoutes(app,{mode:'OFFLINE',barsFor:()=>bars(),metadataFor:()=>({...metadata(),provider:'IEX',feed:undefined,adjustment:undefined}),
      calendarFor:()=>new Map([['2026-10-21',{open:570,close:960}]]),clock:()=>Date.parse('2026-10-21T20:00:00.000Z')});
    try{expect((await app.inject('/api/v1/radar/scenarios?symbol=NVDA')).statusCode).toBe(503);}finally{await app.close();}
  });
  it('devuelve indisponibilidad controlada cuando faltan histórico o calendario',async()=>{
    for(const [input,calendar] of [[[],new Map()],[bars(),new Map()]] as const){
      const app=Fastify();registerScenarioRoutes(app,{mode:'OFFLINE',barsFor:()=>[...input],metadataFor:metadata,
        calendarFor:()=>calendar,clock:()=>Date.parse('2026-10-21T20:00:00.000Z')});
      try{const result=await app.inject('/api/v1/radar/scenarios?symbol=NVDA');
        expect(result.statusCode).toBe(200);
        expect(InvestepScenarioResponse.parse(result.json()).status).toBe('UNAVAILABLE');
      }finally{await app.close();}
    }
  });
  it('identifica como obsoleta una última sesión demasiado antigua',async()=>{
    const app=Fastify();registerScenarioRoutes(app,{mode:'OFFLINE',barsFor:()=>bars(),metadataFor:metadata,
      calendarFor:()=>new Map([['2026-10-21',{open:570,close:960}]]),clock:()=>Date.parse('2026-10-30T20:00:00.000Z')});
    try{const result=await app.inject('/api/v1/radar/scenarios?symbol=NVDA');
      expect(result.statusCode).toBe(200);
      const body=InvestepScenarioResponse.parse(result.json());
      expect(body.source.dataStatus).toBe('STALE');expect(body.limitations.join(' ')).toMatch(/obsoleta/i);
    }finally{await app.close();}
  });
  it('funciona en DEMO y no escribe ledgers ni abre órdenes',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'phase41k-'));
    const {app}=await createApp({mode:'DEMO',privateDir:dir,dbPath:join(dir,'test.sqlite'),newsDir:join(dir,'news'),
      phase16Ledger:join(dir,'phase16'),phase17Private:join(dir,'phase17'),radarFrozenDir:null,radarObservationLog:join(dir,'absent.jsonl')});
    try{const response=await app.inject('/api/v1/radar/scenarios?symbol=NVDA');
      expect(response.statusCode).toBe(200);expect(InvestepScenarioResponse.parse(response.json()).source.dataStatus).toBe('SYNTHETIC');
      expect(existsSync(join(dir,'phase16'))).toBe(false);expect(existsSync(join(dir,'observations.jsonl'))).toBe(false);
    }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
  });
});

describe('calendario, huecos y barras parciales heredados causalmente de 41A',()=>{
  function session(date:string,openHourUtc:number,closeMinute=960):MarketBar[]{
    const start=Date.parse(`${date}T${String(openHourUtc).padStart(2,'0')}:30:00.000Z`);
    return Array.from({length:(closeMinute-570)/15},(_,i)=>{const t=start+i*900_000,value=100+i*.01;
      return {symbol:'NVDA',timeframe:'15m',startUtc:new Date(t).toISOString(),endUtc:new Date(t+900_000).toISOString(),
        open:value,high:value+.2,low:value-.2,close:value+.05,volume:1000,provider:'Alpaca Market Data API',adjustment:'split',
        receivedAtUtc:null,isComplete:true};});
  }
  function run(input:MarketBar[],calendar:Map<string,{open:number;close:number}>,at:string){
    return buildInvestepScenarios(TechnicalContextSchema.parse(buildInvestepTechnicalContext({symbol:'NVDA',asOfUtc:at,bars:input,calendar,
      provider:'Alpaca Market Data API',feed:'sip',adjustment:'split',historicalOrSynthetic:'HISTORICAL'})),null);
  }
  it('continúa viernes a lunes y convierte el horario de apertura al terminar EDT',()=>{
    const fri=session('2026-10-30',13),mon=session('2026-11-02',14),at=mon.at(-1)!.endUtc;
    const result=run([...fri,...mon],new Map([['2026-10-30',{open:570,close:960}],['2026-11-02',{open:570,close:960}]]),at);
    expect(result.frames['15m'].smas['40'].value).not.toBeNull();
    expect(result.frames['15m'].barEndUtc).toBe('2026-11-02T21:00:00.000Z');
  });
  it('salta festivo oficial y admite cierre anticipado sin inventar velas',()=>{
    const wed=session('2026-11-25',14),fri=session('2026-11-27',14,780),mon=session('2026-11-30',14),at=mon.at(-1)!.endUtc;
    const result=run([...wed,...fri,...mon],new Map([['2026-11-25',{open:570,close:960}],
      ['2026-11-27',{open:570,close:780}],['2026-11-30',{open:570,close:960}]]),at);
    expect(result.frames['15m'].smas['40'].value).not.toBeNull();
    expect(result.frames['15m'].barEndUtc).toBe(at);
  });
  it('no usa la última vela parcial y deja N/D cuando un hueco interrumpe la SMA20',()=>{
    const input=bars(),calendar=new Map([['2026-10-21',{open:570,close:960}]]);
    input[25]!.isComplete=false;
    const partial=run(input,calendar,input[25]!.endUtc);
    expect(partial.frames['15m'].barEndUtc).toBe(input[24]!.endUtc);
    const missing=run(bars().filter((_,i)=>i!==15),calendar,input[25]!.endUtc);
    expect(missing.frames['15m'].smas['20'].value).toBeNull();
  });
});
