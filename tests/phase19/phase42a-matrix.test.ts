import {describe,expect,it} from 'vitest';
import {auditDataset,buildMatrix,CATALOG,pilotRows,PROTOCOL} from '../../trading_poc_001_bollinger/src/phase42a-matrix.ts';
import type {Candle} from '../../trading_poc_001_bollinger/src/domain.ts';
const candle=(timestamp:string):Candle=>({timestamp,open:100,high:102,low:99,close:101,volume:100});

describe('42A matriz causal y auditoría',()=>{
  it('registra ocho estrategias, requisitos Worden y 24 combinaciones sin inventar reglas',()=>{
    expect(CATALOG.map(x=>x.id)).toEqual(['E1','E2','E3','E4','E5','E6','E7','E8']);
    for(const id of ['E7','E8'])expect(CATALOG.find(x=>x.id===id)?.requirements.join(' ')).toContain('Worden Stochastics');
    const matrix=buildMatrix({NVDA:'DISPONIBLE',AMD:'SIN_DATOS',AMZN:'SIN_DATOS'});expect(matrix).toHaveLength(24);
    expect(matrix.find(x=>x.asset==='NVDA'&&x.strategy==='E1')?.status).toBe('NO_VERIFICABLE');
    expect(matrix.find(x=>x.asset==='NVDA'&&x.strategy==='E5')?.status).toBe('CONGELADA');
    expect(matrix.filter(x=>x.asset==='AMD').every(x=>x.status==='SIN_DATOS')).toBe(true);
    expect(PROTOCOL.classification).toBe('EXPLORATORIA');
  });
  it('no convierte cruces, valores desconocidos ni cierres futuros en señales',()=>{
    const first=candle('2026-03-06T14:30:00.000Z'),future=candle('2026-03-06T14:45:00.000Z');
    const prior=[...pilotRows([first],'NVDA','2026-03-06T15:00:00.000Z')],later=[...pilotRows([first,{...future,close:99}],'NVDA','2026-03-06T15:00:00.000Z')];
    expect(later.slice(0,2)).toEqual(prior);expect(prior).toHaveLength(2);
    expect(prior.every(x=>x.status==='NO_EVALUABLE'&&x.availableAtUtc===null&&x.confirmation===null)).toBe(true);
    expect(prior[0]!.observedAtUtc).toBe('2026-03-06T14:45:00.000Z');
    expect([...pilotRows([first],'NVDA','2026-03-06T14:44:59.000Z')]).toEqual([]);
  });
  it('audita huecos y cierres anticipados con calendario sin fabricar velas',()=>{
    const calendar=new Map([['2024-11-29',{open:570,close:780}],['2024-12-02',{open:570,close:960}]]);
    const bars=[candle('2024-11-29T14:30:00.000Z'),candle('2024-11-29T15:00:00.000Z'),candle('2024-12-02T14:30:00.000Z')];
    const audit=auditDataset(bars,calendar);expect(audit.bars).toBe(3);expect(audit.calendarAudit.partialSessions).toHaveLength(2);
    expect(audit.frames['15m'].maxContinuous).toBe(1);expect(audit.frames['1d'].incomplete).toBe(2);
    expect(audit.frames['15m'].ready['20']).toBe(0);
  });
  it('rechaza duplicados, fechas fuera del calendario y orden incorrecto',()=>{
    const calendar=new Map([['2026-03-06',{open:570,close:960}]]),bar=candle('2026-03-06T14:30:00.000Z');
    expect(()=>auditDataset([bar,bar],calendar)).toThrow();
    expect(()=>auditDataset([candle('2026-03-07T14:30:00.000Z')],calendar)).toThrow();
  });
  it('continúa entre viernes y lunes con cambio EST/EDT si los extremos son consecutivos',()=>{
    const calendar=new Map([['2026-03-06',{open:570,close:960}],['2026-03-09',{open:570,close:960}]]);
    const bars=[candle('2026-03-06T20:45:00.000Z'),candle('2026-03-09T13:30:00.000Z')];
    expect(auditDataset(bars,calendar).frames['15m'].maxContinuous).toBe(2);
  });
});
