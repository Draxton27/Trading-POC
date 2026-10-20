import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {appendPhase31Record,assertPhase31FeatureEquivalence,assertPhase31HorizonEligible,preparePhase31Inference} from '../../trading_poc_001_bollinger/src/phase31-inference.ts';
import {readProspectiveInference} from '../../apps/api/src/ml/inference.ts';
import type {Candle} from '../../trading_poc_001_bollinger/src/domain.ts';

const clean:string[]=[];afterEach(()=>clean.splice(0).forEach(path=>rmSync(path,{recursive:true,force:true})));
const calendar=new Map([['2026-01-02',{open:570,close:960}]]);
const metadata={asset:'NVDA',provider:'Alpaca Market Data API',bar_minutes:15,data_class:'real' as const,session:'regular' as const,exchange_timezone:'America/New_York' as const,feed:'sip' as const,adjustment:'split' as const};
function candles(count=22):Candle[]{return Array.from({length:count},(_,i)=>{const open=100+i*.1,close=open+.05;return {timestamp:new Date(Date.UTC(2026,0,2,14,30+i*15)).toISOString(),open,high:open+.2,low:open-.2,close,volume:1000+i};});}
function input(){const rows=candles(),receivedAtUtc=new Date(Date.parse(rows.at(-1)!.timestamp)+15*60_000).toISOString();return preparePhase31Inference(rows,calendar,metadata,receivedAtUtc,receivedAtUtc);}
describe('Fase 31: inferencia causal y registro',()=>{
  it('conserva exactamente las diez variables disponibles al cierre',()=>{
    const first=input();const rows=candles();rows.push({timestamp:'2026-01-02T20:00:00.000Z',open:999,high:1000,low:998,close:999,volume:999999});
    const receivedAtUtc=new Date(Date.parse(rows.at(-2)!.timestamp)+15*60_000).toISOString();const second=preparePhase31Inference(rows.slice(0,22),calendar,metadata,receivedAtUtc,receivedAtUtc);
    expect(Object.keys(first.features)).toEqual(['return_1','return_4','distance_ema9','distance_sma20','bollinger_position','relative_volume_20','candle_range','candle_body','atr14_relative','minutes_from_open']);
    expect(second.features).toEqual(first.features);expect(first.barEndUtc).toBe('2026-01-02T20:00:00.000Z');
    assertPhase31FeatureEquivalence(first.features,Object.fromEntries(Object.entries(first.features).map(([name,value])=>[name,String(value)])));
    expect(()=>assertPhase31FeatureEquivalence(first.features,{...Object.fromEntries(Object.entries(first.features).map(([name,value])=>[name,String(value)])),return_1:'999'})).toThrow(/no equivalente/);
  });
  it('rechaza velas abiertas, fuente incompatible y huecos causales',()=>{
    const rows=candles(),last=rows.at(-1)!;expect(()=>preparePhase31Inference(rows,calendar,metadata,last.timestamp,last.timestamp)).toThrow(/aún no cerró/);
    expect(()=>preparePhase31Inference(rows,calendar,{...metadata,feed:undefined},'2026-01-02T20:00:00.000Z','2026-01-02T20:00:00.000Z')).toThrow(/Alpaca SIP/);
    const gap=rows.filter((_,i)=>i!==20);expect(()=>preparePhase31Inference(gap,calendar,metadata,'2026-01-02T20:00:00.000Z','2026-01-02T20:00:00.000Z')).toThrow(/insuficientes|continuidad/);
  });
  it('admite la última vela elegible y rechaza horizonte tras cierre regular o anticipado',()=>{
    expect(()=>assertPhase31HorizonEligible('2026-01-02T19:45:00.000Z',calendar)).not.toThrow();
    expect(()=>assertPhase31HorizonEligible('2026-01-02T20:00:00.000Z',calendar)).toThrow(/horizonte/);
    const early=new Map([['2026-07-03',{open:570,close:780}]]);
    expect(()=>assertPhase31HorizonEligible('2026-07-03T15:45:00.000Z',early)).not.toThrow();
    expect(()=>assertPhase31HorizonEligible('2026-07-03T16:00:00.000Z',early)).toThrow(/horizonte/);
  });
  it('registra replay append-only e idempotente, bloquea promoción prospectiva y otro modelo',()=>{
    const prepared=input(),root=mkdtempSync(join(tmpdir(),'phase31-'));clean.push(root);const path=join(root,'records.jsonl');
    const base={model:{id:'model',sha256:'a'.repeat(64),createdAtUtc:'2025-01-01T00:00:00.000Z'},bar:{startUtc:prepared.barStartUtc,endUtc:prepared.barEndUtc,sessionDateNy:prepared.sessionDateNy,receivedAtUtc:prepared.source.receivedAtUtc},features:{spec:'nvda-15m-v1',hash:prepared.featureHash,values:prepared.features},prediction:{ALCISTA:.2,BAJISTA:.3,LATERAL:.5,dominantClass:'LATERAL' as const},source:{provider:prepared.source.provider,feed:'sip' as const,adjustment:'split' as const,availability:'VERIFIED' as const}};
    const replay=appendPhase31Record(path,{...base,mode:'REPLAY'},'2026-01-02T20:45:01.000Z');expect(replay.alreadyPresent).toBe(false);expect(appendPhase31Record(path,{...base,mode:'REPLAY'},'2026-01-02T20:45:02.000Z').alreadyPresent).toBe(true);
    expect(()=>appendPhase31Record(path,{...base,mode:'PROSPECTIVE_CAPTURE'},'2026-01-02T20:45:02.000Z')).toThrow(/bloqueado/);
    expect(readProspectiveInference(path,'b'.repeat(64))).toMatchObject({status:'MODEL_INCOMPATIBLE'});
  });
});
