import {describe,it,expect} from 'vitest';
import {MarketBar,OptionQuote,AgentMessage} from '@trading-poc/contracts';
import {calculateIndicators,quoteNumber,spread} from '@trading-poc/market-domain';
import {demoBars,pageBars} from '@trading-poc/research-adapter';
import {normalizeFeed} from '../../apps/ibkr-agent/src/connection/tws.ts';

describe('contratos y mercado',()=>{
  it('rechaza OHLC inválido y conserva cotizaciones faltantes',()=>{
    const bar=demoBars('NVDA')[0]!;
    expect(MarketBar.safeParse({...bar,high:bar.low-1}).success).toBe(false);
    expect(MarketBar.safeParse({...bar,startUtc:'2026-10-18T09:30:00'}).success).toBe(false);
    expect(quoteNumber(-1)).toBeNull();expect(quoteNumber(Number.MAX_VALUE)).toBeNull();
    expect(spread(1.2,1.1).percent).toBeNull();
    expect(OptionQuote.safeParse({conId:1,occSymbol:null,bid:null,ask:null,bidSize:null,askSize:null,last:null,delta:null,gamma:null,theta:null,vega:null,impliedVolatility:null,greeksSource:null,marketTimestampUtc:null,receivedAtUtc:new Date().toISOString(),feedType:'DELAYED',provider:'IBKR'}).success).toBe(true);
  });
  it('página sin duplicados y SMA causal',()=>{
    const bars=demoBars('NVDA'),last=pageBars(bars,undefined,30),prior=pageBars(bars,last.nextBefore!,30);
    expect(last.items).toHaveLength(30);expect(prior.items).toHaveLength(30);
    expect(prior.items.at(-1)!.startUtc<last.items[0]!.startUtc).toBe(true);
    const points=calculateIndicators(bars);expect(points[18]!.sma20).toBeNull();
    expect(points[19]!.sma20).not.toBeNull();
    const changed=bars.map((b,i)=>i===100?{...b,close:b.close+100}:b);
    expect(calculateIndicators(changed)[99]).toEqual(points[99]);
  });
  it('agrega sesiones DEMO sin cruzar sábados ni inventar barras',()=>{
    const daily=demoBars('NVDA','1d'),hourly=demoBars('NVDA','1h');
    expect(daily).toHaveLength(15);expect(hourly).toHaveLength(105);
    expect(daily.every(b=>b.isComplete&&new Date(b.startUtc).getUTCDay()!==0&&new Date(b.startUtc).getUTCDay()!==6)).toBe(true);
    expect(hourly[6]!.endUtc).toBe(daily[0]!.endUtc);
  });
  it('normaliza el feed real de TWS, incluso frozen y delayed',()=>{
    expect([1,2,3,4,99].map(normalizeFeed)).toEqual(['LIVE','FROZEN','DELAYED','DELAYED_FROZEN','UNKNOWN']);
  });
  it('rechaza un tipo de mensaje de orden no autorizado',()=>{
    const message={protocolVersion:1,messageId:crypto.randomUUID(),requestId:null,agentId:'a',connectionId:crypto.randomUUID(),sequence:0,issuedAtUtc:new Date().toISOString(),kind:'order.place',payload:{}};
    expect(AgentMessage.safeParse(message).success).toBe(false);
  });
});
