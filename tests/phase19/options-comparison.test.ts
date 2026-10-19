import {describe,expect,it} from 'vitest';
import {comparisonMetrics,daysToExpiration,toggleComparison} from '../../apps/web/src/features/options/comparison.ts';
import {OptionComparisonRequest} from '@trading-poc/contracts';

describe('comparador de opciones',()=>{
  const base={right:'CALL',strike:200,expiration:'20261023',multiplier:100,bid:2,ask:3};
  const now=new Date('2026-10-19T15:00:00Z');
  it('calcula spread sobre el medio, costo nominal y equilibrio de CALL y PUT largos',()=>{
    expect(comparisonMetrics(base,now)).toEqual({spread:{absolute:1,percent:40},dte:4,nominalCost:300,breakEven:203});
    expect(comparisonMetrics({...base,right:'PUT'},now).breakEven).toBe(197);
  });
  it('no inventa datos faltantes, spread cruzado ni fechas invalidas',()=>{
    const metrics=comparisonMetrics({...base,bid:null,ask:null,multiplier:null},now);
    expect(metrics).toMatchObject({spread:{absolute:null,percent:null},nominalCost:null,breakEven:null});
    expect(comparisonMetrics({...base,bid:4,ask:3},now).spread.percent).toBeNull();
    expect(comparisonMetrics({...base,bid:0,ask:0},now).spread.percent).toBeNull();
    expect(daysToExpiration('2026-02-30',now)).toBeNull();
    expect(daysToExpiration('20261018',now)).toBeNull();
    expect(daysToExpiration('2026-10-19',new Date('2026-10-20T03:30:00Z'))).toBe(0);
  });
  it('selecciona hasta cuatro identidades, permite quitar y rechaza solicitudes invalidas',()=>{
    let ids:number[]=[];for(const id of [1,2,3,4,5])ids=toggleComparison(ids,id);
    expect(ids).toEqual([1,2,3,4]);
    expect(toggleComparison(ids,2)).toEqual([1,3,4]);
    expect(OptionComparisonRequest.safeParse({conId:0,consumerId:'not-a-uuid'}).success).toBe(false);
  });
});
