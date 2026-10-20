import {describe,it,expect} from 'vitest';
import type {MarketBar} from '@trading-poc/contracts';
import {analyzeAtCommonTimestamp,analyzeMarketBars,compareMarketAnalyses,explainIndicators} from '../../apps/api/src/assistant/analysis.ts';

function bar(index:number,close:number,options:{day?:string;volume?:number;symbol?:string}={}):MarketBar{
  const start=Date.parse(`${options.day??'2026-10-19'}T13:30:00.000Z`)+index*15*60_000;
  const open=index?100:close;
  return {symbol:(options.symbol??'NVDA') as 'NVDA'|'QQQ'|'SMH',timeframe:'15m',startUtc:new Date(start).toISOString(),
    endUtc:new Date(start+15*60_000).toISOString(),open,high:Math.max(open,close)+1,low:Math.min(open,close)-1,close,
    volume:options.volume??100,provider:'fixture',adjustment:'split',receivedAtUtc:null,isComplete:true};
}
const trendBars=(symbol:string,scale:number)=>Array.from({length:24},(_,i)=>bar(i,100+(i===22?1:i===23?2:0)*scale,{symbol}));

describe('asistente: interpretación determinista de mercado',()=>{
  it('calcula distancias SMA, posición Bollinger y retorno de cuatro velas',()=>{
    const result=analyzeMarketBars('NVDA','fixture SIP','HISTORICAL',trendBars('NVDA',1));
    const metrics=result.metrics!;
    expect(metrics.close).toBe(102);
    expect(metrics.sma20).toBeCloseTo(100.15,10);
    expect(metrics.distanceSma20Percent).toBeCloseTo((102/100.15-1)*100,10);
    expect(metrics.returnFourBarsPercent).toBeCloseTo(2,10);
    expect(metrics.bollingerPositionPercent).toBeGreaterThan(50);
    expect(metrics.bollingerPositionPercent).toBeCloseTo((metrics.close-metrics.bollingerLower!)/(metrics.bollingerUpper!-metrics.bollingerLower!)*100,10);
    expect(metrics.distanceUpperBandWidthPercent!+metrics.distanceLowerBandWidthPercent!).toBeCloseTo(100,8);
    expect(metrics.sma40).toBeNull();expect(metrics.sma200).toBeNull();
    expect(result.availability).toBe('HISTORICAL_ONLY');
    expect(metrics.returnOneBarPercent).toBeCloseTo((102/101-1)*100,10);
    expect(metrics.bollingerWidthPercent).toBeGreaterThan(0);
    expect(result.observations.find(x=>x.key==='distanceSma20Percent')).toMatchObject({period:'20 velas',timestampUtc:result.dateUtc,availability:'AVAILABLE',unit:'percent'});
    expect(result.observations.find(x=>x.key==='returnFourBarsPercent')).toMatchObject({period:'4 intervalos consecutivos de 15 minutos',availability:'AVAILABLE'});
    expect(result.sections[0]!.items.some(x=>x.toLowerCase().includes('no es cotización actual'))).toBe(true);
  });
  it('calcula RVOL solo con las 20 sesiones previas del mismo horario NY',()=>{
    const bars:MarketBar[]=[];let volume=100;
    for(let day=new Date('2026-09-21T00:00:00.000Z');day<=new Date('2026-10-19T00:00:00.000Z');day.setUTCDate(day.getUTCDate()+1)){
      if(day.getUTCDay()===0||day.getUTCDay()===6)continue;
      bars.push(bar(0,100,{day:day.toISOString().slice(0,10),volume:volume++}));
    }
    bars[bars.length-1]={...bars.at(-1)!,volume:219};
    let result=analyzeMarketBars('NVDA','fixture SIP','HISTORICAL',bars);
    expect(result.metrics?.volumeReference).toBeCloseTo(109.5,10);
    expect(result.metrics?.relativeVolume20).toBeCloseTo(2,10);
    const missing=bars.filter((_,i)=>i!==bars.length-2);
    result=analyzeMarketBars('NVDA','fixture SIP','HISTORICAL',missing);
    expect(result.metrics?.relativeVolume20).toBeNull();
  });
  it('compara porcentajes normalizados y rechaza fechas o procedencias no comparables',()=>{
    const nvda=analyzeMarketBars('NVDA','local','HISTORICAL',trendBars('NVDA',1));
    const qqq=analyzeMarketBars('QQQ','local','HISTORICAL',trendBars('QQQ',0.5));
    const same=compareMarketAnalyses(nvda,qqq);
    expect(same.sufficient).toBe(true);expect(same.items.join(' ')).toContain('retornos porcentuales relativamente mayores');
    expect(same.items.join(' ')).not.toContain('precio absoluto');
    expect(compareMarketAnalyses(nvda,{...qqq,dateUtc:'2026-10-20T20:00:00.000Z'}).sufficient).toBe(false);
    expect(compareMarketAnalyses(nvda,{...qqq,dataType:'SYNTHETIC'}).sufficient).toBe(false);
    expect(compareMarketAnalyses(nvda,{...qqq,source:'otro proveedor'}).sufficient).toBe(false);
    expect(compareMarketAnalyses(nvda,analyzeMarketBars('SMH','local','HISTORICAL',trendBars('SMH',1).slice(0,4))).items.join(' ').toLowerCase()).toContain('no se concluye fortaleza relativa');
  });
  it('recalcula ambos activos en el Ãºltimo corte comÃºn y excluye velas posteriores',()=>{
    const a=trendBars('NVDA',1),b=[...trendBars('QQQ',0.5),bar(24,103,{symbol:'QQQ'})];
    const aligned=analyzeAtCommonTimestamp({asset:'NVDA',source:'local',dataType:'HISTORICAL',bars:a},
      {asset:'QQQ',source:'local',dataType:'HISTORICAL',bars:b});
    expect(aligned.commonTimestamp).toBe(a.at(-1)!.endUtc);
    expect(aligned.analyses[0].dateUtc).toBe(aligned.analyses[1].dateUtc);
    expect(aligned.analyses[1].metrics?.close).toBe(b.at(23)!.close);
    const guarded=analyzeMarketBars('NVDA','local','HISTORICAL',[...a,bar(24,999)],a.at(-1)!.endUtc);
    expect(guarded.dateUtc).toBe(a.at(-1)!.endUtc);expect(guarded.metrics?.close).not.toBe(999);
    const noOverlap=analyzeAtCommonTimestamp({asset:'NVDA',source:'local',dataType:'HISTORICAL',bars:a},
      {asset:'SMH',source:'local',dataType:'HISTORICAL',bars:[bar(0,100,{day:'2026-10-20',symbol:'SMH'})]});
    expect(noOverlap.commonTimestamp).toBeNull();expect(compareMarketAnalyses(noOverlap.analyses[0],noOverlap.analyses[1]).sufficient).toBe(false);
  });
  it('rechaza velas duplicadas, desordenadas o con OHLC inconsistente',()=>{
    const bars=trendBars('NVDA',1);
    expect(()=>analyzeMarketBars('NVDA','fixture','HISTORICAL',[...bars,bars.at(-1)!])).toThrow();
    expect(()=>analyzeMarketBars('NVDA','fixture','HISTORICAL',[bars[1]!,bars[0]!])).toThrow();
    expect(()=>analyzeMarketBars('NVDA','fixture','HISTORICAL',[{...bars[0]!,high:1}])).toThrow();
  });
  it('explica indicadores con texto educativo acotado',()=>{
    expect(explainIndicators(['SMA20','BOLLINGER'])).toHaveLength(2);
    expect(explainIndicators(['SMA20'])[0]).toContain('no confirma por sí sola');
  });
});
