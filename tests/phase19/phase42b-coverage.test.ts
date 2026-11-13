import {describe, expect, it} from 'vitest';
import {auditWindow, preEntryBollinger, type EvidenceBar, type SourceEvidence} from '../../trading_poc_001_bollinger/src/phase42b-coverage.ts';

const source:SourceEvidence={provider:'fixture',feed:'fixture',adjustment:'raw',symbol:'TEST',calendarVerified:true,licenseVerified:true,pointInTimeVerified:true};
const start=Date.parse('2026-11-04T14:30:00.000Z');
const iso=(n:number)=>new Date(n).toISOString();
const bars:EvidenceBar[]=Array.from({length:20},(_,i)=>({timestamp:iso(start+i*900_000),endUtc:iso(start+(i+1)*900_000),availableAtUtc:iso(start+(i+1)*900_000+1000),open:100+i,high:101+i,low:99+i,close:100+i,volume:100}));
const starts=bars.map(b=>b.timestamp), decision=iso(start+20*900_000+2000);

describe('42B temporal coverage',()=>{
  it('uses only closed bars received strictly before the entry',()=>{
    expect(preEntryBollinger(bars,starts,decision,source).status).toBe('VERIFICABLE');
    const late=bars.map((b,i)=>i===19?{...b,availableAtUtc:decision}:b);
    expect(preEntryBollinger(late,starts,decision,source).status).toBe('NO_VERIFICABLE');
  });
  it('does not infer reception from a bar close or from retrospective data',()=>{
    expect(preEntryBollinger(bars.map(b=>({...b,availableAtUtc:null})),starts,decision,source).status).toBe('NO_VERIFICABLE');
    expect(preEntryBollinger(bars,starts,decision,{...source,pointInTimeVerified:false}).status).toBe('NO_VERIFICABLE');
  });
  it('reports missing bars and rejects duplicates and future bars',()=>{
    expect(auditWindow(bars.slice(1),starts,15,decision,source).missing).toBe(1);
    expect(()=>auditWindow([...bars,bars[19]!],starts,15,decision,source)).toThrow('ORDEN_O_DUPLICADO');
    expect(()=>auditWindow(bars,starts,15,bars[19]!.timestamp,source)).toThrow('CALENDARIO_INVALIDO');
  });
  it('rejects invalid OHLC and availability before close',()=>{
    expect(()=>auditWindow([{...bars[0]!,low:200}],starts,15,decision,source)).toThrow('OHLCV_INVALIDO');
    expect(()=>auditWindow([{...bars[0]!,availableAtUtc:bars[0]!.timestamp}],starts,15,decision,source)).toThrow('DISPONIBILIDAD_ANTERIOR_AL_CIERRE');
  });
});
