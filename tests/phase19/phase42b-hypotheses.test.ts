import {describe,it,expect} from 'vitest';
import {compareHypotheses} from '../../trading_poc_001_bollinger/src/phase42b-hypotheses.ts';

describe('42B competing hypotheses',()=>{
  it('separates conditional evidence and contradictions without claiming a retest',()=>{
    const r=compareHypotheses({lastClose:101,vwap:100,bbUpper:102,bbLower:98,relative:{QQQ:0.5,SMH:-0.2}});
    expect(r.supportingEvidence.some(x=>x.hypothesis==='FORTALEZA_RELATIVA')).toBe(true);
    expect(r.contradictingEvidence.some(x=>x.hypothesis==='FORTALEZA_RELATIVA')).toBe(true);
    expect(r.supportingEvidence.find(x=>x.hypothesis==='CONTEXTO_VWAP')?.limitation).toBe('NO_PRUEBA_TOQUE_NI_RETESTEO');
    expect(r.alternativesWithoutEvidence).toContain('RETESTEO');expect(r.laterEvolution).toBeNull();
  });
  it('does not invent comparisons when observations are absent',()=>{
    const r=compareHypotheses({lastClose:null,vwap:null,bbUpper:null,bbLower:null,relative:{QQQ:null}});
    expect(r.observed).toEqual([]);expect(r.supportingEvidence).toEqual([]);expect(r.contradictingEvidence).toEqual([]);
  });
});
