import {describe,it,expect} from 'vitest';
import {fetchYoelAlpacaHistory} from '../../trading_poc_001_bollinger/src/phase42b-alpaca.ts';

const base={symbol:'AMD',frame:'1Min' as const,startUtc:'2026-11-11T14:30:00.000Z',endUtc:'2026-11-11T15:00:00.000Z',
  apiKey:'synthetic',secretKey:'synthetic',now:()=>Date.parse('2026-11-12T16:00:00Z'),pause:async()=>{}};
const bar=(t:string)=>({t,o:100,h:102,l:99,c:101,v:10,vw:100.5});
describe('42B Alpaca SIP historical',()=>{
  it('requests raw SIP, paginates and records real response reading times',async()=>{
    let calls=0;const get:typeof fetch=async input=>{
      const u=new URL(String(input));expect(u.searchParams.get('feed')).toBe('sip');expect(u.searchParams.get('adjustment')).toBe('raw');
      expect(u.searchParams.get('asof')).toBe('-');calls++;
      return Response.json(calls===1?{bars:{AMD:[bar('2026-11-11T14:30:00Z')]},next_page_token:'next'}:
        {bars:{AMD:[bar('2026-11-11T14:31:00Z')]},next_page_token:null});};
    const r=await fetchYoelAlpacaHistory({...base,get});expect(r.bars).toHaveLength(2);expect(r.pages).toHaveLength(2);
    expect(r.availability).toBe('RETROSPECTIVE_RECEIPT_UNKNOWN');expect(r.pages[0]!.receivedAtUtc).toBe('2026-11-12T16:00:00.000Z');
  });
  it('never substitutes a feed on permission failure',async()=>{
    const get:typeof fetch=async()=>new Response(null,{status:403});
    await expect(fetchYoelAlpacaHistory({...base,get})).rejects.toThrow('ALPACA_SIP_PERMISSION_DENIED');
  });
  it('rejects recent requests and duplicate timestamps',async()=>{
    await expect(fetchYoelAlpacaHistory({...base,endUtc:'2026-11-12T15:59:00.000Z'})).rejects.toThrow('HISTORY_RANGE_INVALID');
    const get:typeof fetch=async()=>Response.json({bars:{AMD:[bar('2026-11-11T14:30:00Z'),bar('2026-11-11T14:30:00Z')]},next_page_token:null});
    await expect(fetchYoelAlpacaHistory({...base,get})).rejects.toThrow('ALPACA_TIME_OR_DUPLICATE_INVALID');
  });
  it('retries bounded rate limits without exposing credentials',async()=>{
    let calls=0;const get:typeof fetch=async()=>++calls===1?new Response(null,{status:429}):Response.json({bars:{AMD:[]},next_page_token:null});
    expect((await fetchYoelAlpacaHistory({...base,get})).bars).toHaveLength(0);expect(calls).toBe(2);
  });
});
