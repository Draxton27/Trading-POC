import {describe,expect,it} from 'vitest';
import {describeMoneyness,expiryLabel} from '../../apps/web/src/features/options/chain-view.ts';

describe('descripciones de Option Chain 2.0',()=>{
  it('clasifica CALL y PUT alrededor del mismo precio sin convertirlo en consejo',()=>{
    expect(describeMoneyness('CALL',215,220,'IBKR_LAST_OBSERVED')).toBe('ITM');
    expect(describeMoneyness('CALL',225,220,'IBKR_LAST_OBSERVED')).toBe('OTM');
    expect(describeMoneyness('PUT',225,220,'IBKR_LAST_OBSERVED')).toBe('ITM');
    expect(describeMoneyness('PUT',215,220,'IBKR_LAST_OBSERVED')).toBe('OTM');
    expect(describeMoneyness('CALL',220.005,220,'IBKR_LAST_OBSERVED')).toBe('Cerca del precio');
  });
  it('no infiere moneyness desde strike manual ni ausencia de precio',()=>{
    expect(describeMoneyness('CALL',215,220,'MANUAL_STRIKE')).toBeNull();
    expect(describeMoneyness('PUT',225,null,'NONE')).toBeNull();
    expect(describeMoneyness('PUT',225,220,'ALPACA_IEX_LAST_COMPLETE_BAR')).toBe('ITM');
    expect(describeMoneyness('CALL',215,220,'HISTORICAL')).toBeNull();
  });
  it('formatea únicamente vencimientos calendario válidos',()=>{
    expect(expiryLabel('2026-10-28')).toMatch(/28/);
    expect(expiryLabel('20260230')).toBe('20260230');
  });
});
