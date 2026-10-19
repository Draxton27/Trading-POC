import {describe,it,expect} from 'vitest';
import {calculateIndicators} from '../../packages/market-domain/src/index.ts';
import {demoBars} from '../../packages/research-adapter/src/index.ts';
import {calculateBollinger} from '../../trading_poc_001_bollinger/src/bollinger.ts';

describe('indicadores visibles: motor del proyecto',()=>{
  it.each(['15m','1h','1d'] as const)('%s coincide vela por vela con Bollinger histórico y SMA calculada',frame=>{
    const bars=demoBars('NVDA',frame);
    const points=calculateIndicators(bars);
    const reference=calculateBollinger(bars.map(bar=>({timestamp:bar.startUtc,
      open:bar.open,high:bar.high,low:bar.low,close:bar.close,volume:bar.volume??0})),20,2);
    expect(points).toHaveLength(bars.length);
    for(let i=0;i<points.length;i++){
      const point=points[i]!,expected=reference[i]!;
      if(expected.middle===null){expect(point.bbMiddle).toBeNull();continue;}
      expect(point.bbMiddle).toBeCloseTo(expected.middle,10);
      expect(point.bbUpper).toBeCloseTo(expected.upper!,10);
      expect(point.bbLower).toBeCloseTo(expected.lower!,10);
      for(const length of [20,40,100,200] as const){
        const key=`sma${length}` as const;
        if(i+1<length)expect(point[key]).toBeNull();
        else expect(point[key]).toBeCloseTo(bars.slice(i+1-length,i+1)
          .reduce((total,bar)=>total+bar.close,0)/length,10);
      }
      expect(Date.parse(bars[i]!.endUtc)).toBeGreaterThan(Date.parse(bars[i]!.startUtc));
      expect(bars[i]!.receivedAtUtc).toBeNull();
    }
  });
  it('vela incompleta y cierre futuro no generan indicador prematuro',()=>{
    const bars=demoBars('QQQ','15m').slice(0,25);
    bars[19]={...bars[19]!,isComplete:false,close:999999};
    const before=calculateIndicators(bars);
    expect(before[19]!.bbUpper).toBeNull();
    expect(before[20]!.bbUpper).not.toBeNull();
    const edited=bars.map((bar,index)=>index>21?{...bar,close:bar.close+500}:bar);
    const after=calculateIndicators(edited);
    expect(after.slice(0,22)).toEqual(before.slice(0,22));
  });
});
