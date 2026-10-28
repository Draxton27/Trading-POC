import {describe,expect,it} from 'vitest';
import {emptyEconomicFilters,evaluateEconomicContract,parseEconomicNumber,type EconomicConfig} from
  '../../apps/web/src/features/options/economic-explorer.ts';

const row={conId:123,symbol:'NVDA',right:'CALL',strike:220,expiration:'20261030',multiplier:100,
  currency:'USD',bid:2,ask:2.5,feedType:'DELAYED',provider:'IBKR',receivedAtUtc:'2026-10-28T15:00:00Z',
  marketTimestampUtc:'2026-10-28T14:59:00Z'};
const config=():EconomicConfig=>({quantity:2,capitalUsd:1000,maxUnitCostUsd:null,
  entryFeePerContractUsd:null,filters:emptyEconomicFilters(),asOfUtc:'2026-10-28T15:01:00Z'});

describe('Fase 41U: filtros económicos descriptivos',()=>{
  it('multiplica ASK por multiplicador y cantidad sin asumir comisión cero',()=>{
    const result=evaluateEconomicContract(row,config());
    expect(result.status).toBe('MATCH');
    expect(result.unitCostUsd).toBe(250);
    expect(result.analysis.premium.grossPremiumUsd).toBe(500);
    expect(result.analysis.capital.committedPercent).toBe(50);
    expect(result.analysis.capital.feesExcludedFromBudget).toBe(true);
    expect(result.analysis.quote.status).toBe('DELAYED');
  });
  it('incluye costos de entrada declarados sin cambiarlos por una estimación',()=>{
    const input={...config(),entryFeePerContractUsd:3};
    const result=evaluateEconomicContract(row,input);
    expect(result.analysis.capital.cashOutlayWithKnownEntryFeesUsd).toBe(506);
    expect(result.analysis.capital.committedPercent).toBeCloseTo(50.6);
  });
  it('mantiene independientes ASK, costo, spread, DTE y capital',()=>{
    const input={...config(),capitalUsd:400,maxUnitCostUsd:240,
      filters:{...emptyEconomicFilters(),minAsk:2.4,maxAsk:2.6,maxCost:450,maxSpreadPercent:10,minDte:1,maxDte:3}};
    const result=evaluateEconomicContract(row,input);
    expect(result.status).toBe('EXCEEDS');
    expect(result.failures).toHaveLength(4); // unit cost, total cost, capital and spread
    expect(result.analysis.expiration.daysCalendar).toBe(2);
  });
  it('marca como no evaluable ASK ausente y no lo convierte en cero',()=>{
    const input={...config(),filters:{...emptyEconomicFilters(),maxAsk:3,maxSpreadPercent:15}};
    const result=evaluateEconomicContract({...row,ask:null},input);
    expect(result.status).toBe('NO_EVALUABLE');
    expect(result.unknown).toEqual(expect.arrayContaining([expect.stringContaining('ASK'),expect.stringContaining('Spread')]));
    expect(result.analysis.premium.grossPremiumUsd).toBeNull();
  });
  it('BID ausente solo impide evaluar el spread, no el costo ASK',()=>{
    const input={...config(),filters:{...emptyEconomicFilters(),maxSpreadPercent:15}};
    const result=evaluateEconomicContract({...row,bid:null},input);
    expect(result.status).toBe('NO_EVALUABLE');
    expect(result.analysis.premium.grossPremiumUsd).toBe(500);
  });
  it('ticks anteriores no verifican un presupuesto tras declararse la cotización no disponible',()=>{
    const input={...config(),maxUnitCostUsd:300};
    const unavailable=evaluateEconomicContract({...row,marketDataStatus:'unavailable'},input);
    expect(unavailable.status).toBe('NO_EVALUABLE');
    expect(unavailable.analysis.quote.askCurrentVerified).toBe(false);
    expect(unavailable.analysis.premium.grossPremiumUsd).toBe(500); // importe descriptivo observado
    const failed=evaluateEconomicContract({...row,subscriptionStatus:'FAILED'},input);
    expect(failed.status).toBe('NO_EVALUABLE');
  });
  it('rechaza entradas inválidas sin interpretar vacío como cero',()=>{
    expect(parseEconomicNumber('')).toBeNull();
    expect(Number.isNaN(parseEconomicNumber('-1'))).toBe(true);
    expect(Number.isNaN(parseEconomicNumber('abc'))).toBe(true);
    expect(Number.isNaN(parseEconomicNumber('1.5',{integer:true}))).toBe(true);
  });
});
