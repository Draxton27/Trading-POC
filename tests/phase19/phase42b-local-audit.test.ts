import {describe,it,expect} from 'vitest';
import {auditLocal15m,auditSessionCoverage} from '../../trading_poc_001_bollinger/src/phase42b-local-audit.ts';
import {buildPendingQueue} from '../../trading_poc_001_bollinger/src/phase42b-queue.ts';

describe('42B local session audit',()=>{
  it('uses the official session and only bars closed strictly before the decision',()=>{
    const queue=buildPendingQueue([{id:'rec12345678901235',fields:{Ticker:'QQQ','Fecha entrada ET':'2026-11-04T10:01:00','Lote imagen numero':'12','Trade reconstruido':['rec12345678901234']}}]);
    const calendar=new Map([['2026-11-04',{open:570,close:960}]]);
    const candle={timestamp:'2026-11-04T14:30:00.000Z',open:100,high:101,low:99,close:100,volume:1};
    const result=auditLocal15m(queue,'QQQ',[candle],calendar)[0]!;
    expect(result.expectedBeforeEntry).toBe(2);expect(result.observedBeforeEntry).toBe(1);
    expect(result.reasons).toContain('VELAS_INTRADIA_FALTANTES');
    expect(result.reasons).toContain('RECEPCION_HISTORICA_NO_VERIFICADA');
    expect(auditLocal15m(queue,'QQQ',[candle,{...candle,timestamp:'2026-11-04T15:00:00.000Z'}],calendar)[0]).toEqual(result);
    expect(auditSessionCoverage(queue[0]!,[candle],calendar,5).missing).toBe(5);
  });
  it('never invents a session when a holiday is missing from the calendar',()=>{
    const queue=buildPendingQueue([{id:'rec12345678901235',fields:{Ticker:'QQQ','Fecha entrada ET':'2026-11-26T10:01:00','Lote imagen numero':'1'}}]);
    expect(auditLocal15m(queue,'QQQ',[],new Map())[0]!.reasons).toContain('CALENDARIO_O_HORA_NO_DISPONIBLE');
  });
});
