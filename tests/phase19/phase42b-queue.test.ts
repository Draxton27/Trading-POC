import {describe,it,expect} from 'vitest';
import {buildPendingQueue,newYorkLocalToUtc,stableQueueHash} from '../../trading_poc_001_bollinger/src/phase42b-queue.ts';

describe('42B pending queue',()=>{
  it('converts New York times and rejects DST gaps and overlaps',()=>{
    expect(newYorkLocalToUtc('2026-07-01T09:30:00')).toBe('2026-07-01T13:30:00.000Z');
    expect(newYorkLocalToUtc('2026-11-12T09:30:00')).toBe('2026-11-12T14:30:00.000Z');
    expect(()=>newYorkLocalToUtc('2026-03-08T02:15:00')).toThrow('AMBIGUOUS_OR_NONEXISTENT');
    expect(()=>newYorkLocalToUtc('2026-11-01T01:15:00')).toThrow('AMBIGUOUS_OR_NONEXISTENT');
  });
  it('retains conflicts and original linked trade IDs without guessing a strategy',()=>{
    const fields={'Ticker':'QQQ','Fecha entrada ET':'2026-11-04T09:31:00','Lote imagen numero':'12',
      'Prioridad':'Alta','Trade reconstruido':['rec12345678901234']};
    const rows=buildPendingQueue([{id:'rec12345678901235',fields},{id:'rec12345678901236',fields}]);
    expect(rows).toHaveLength(2);expect(rows.every(r=>r.status==='IDENTITY_CONFLICT')).toBe(true);
    expect(rows[0]!.sourceTradeIds).toEqual(['rec12345678901234']);expect(rows[0]!.laterEvolution).toBeNull();
    expect(stableQueueHash(rows)).toBe(stableQueueHash(buildPendingQueue([{id:'rec12345678901236',fields},{id:'rec12345678901235',fields}])));
  });
  it('does not silently accept invalid or absent source timestamps',()=>{
    const rows=buildPendingQueue([{id:'rec12345678901235',fields:{Ticker:'NVDA','Fecha entrada ET':'2026-02-30T09:30:00','Lote imagen numero':'1'}}]);
    expect(rows[0]!.entryUtc).toBeNull();expect(rows[0]!.reasons).toContain('HORA_LOCAL_INVALIDA_O_AMBIGUA');
  });
});
