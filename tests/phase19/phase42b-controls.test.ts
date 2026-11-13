import {describe,it,expect} from 'vitest';
import {auditControlSnapshots} from '../../trading_poc_001_bollinger/src/phase42b-controls.ts';

describe('42B existing snapshot audit',()=>{
  it('flags a purported one-minute candle that closes at the entry and leaves cadence unverified',()=>{
    const rows=auditControlSnapshots([{id:'rec12345678901234',fields:{'Entrada ET':'2026-11-04T09:32:00',
      'Trade relacionado':['rec12345678901235'],'Velas contexto JSON':JSON.stringify({confirmedBeforeEntry:[{t:'09:30'},{t:'09:31'}]})}}]);
    expect(rows[0]!.priorAssuming1m).toBe(1);expect(rows[0]!.notStrictlyPriorAssuming1m).toBe(1);
    expect(rows[0]!.status).toBe('NO_VERIFICABLE');expect(rows[0]!.linkedTradeIds).toEqual(['rec12345678901235']);
  });
  it('does not infer data from missing or invalid JSON',()=>{
    const rows=auditControlSnapshots([{id:'rec12345678901234',fields:{'Velas contexto JSON':'not json'}}]);
    expect(rows[0]!.barCount).toBeNull();expect(rows[0]!.entryUtc).toBeNull();
  });
});
