import {describe,expect,it} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {auditIex,downloadIexHistory,fetchIexWindow,type IexMinute} from '../../trading_poc_001_bollinger/src/phase38d-iex-history.ts';
import type {MarketCalendar} from '../../trading_poc_001_bollinger/src/alpaca-calendar.ts';

const raw=(time:string,index:number)=>({t:time,o:100+index,h:101+index,l:99+index,c:100.5+index,v:10,n:2});
const minute=(time:string,index:number):IexMinute=>({timestamp:time,open:100+index,high:101+index,low:99+index,close:100.5+index,volume:10,tradeCount:2});
describe('Histórico IEX de un minuto',()=>{
  it('consulta endpoint oficial, pagina y reintenta 429 sin cambiar feed ni ajuste',async()=>{
    const seen:URL[]=[];let calls=0;
    const bars=await fetchIexWindow({start:Date.parse('2026-10-20T13:30:00Z'),end:Date.parse('2026-10-20T13:33:00Z'),apiKey:'key',secretKey:'secret',pause:async()=>{},get:async url=>{
      seen.push(new URL(url));calls++;
      if(calls===1)return new Response('',{status:429,headers:{'retry-after':'0'}});
      return Response.json(calls===2?{bars:[raw('2026-10-20T13:30:00Z',0)],next_page_token:'next'}:
        {bars:[raw('2026-10-20T13:31:00Z',1)],next_page_token:null});
    }});
    expect(bars).toHaveLength(2);expect(seen[0]!.pathname).toBe('/v2/stocks/NVDA/bars');
    expect(seen[0]!.searchParams.get('feed')).toBe('iex');expect(seen[0]!.searchParams.get('adjustment')).toBe('raw');
    expect(seen[2]!.searchParams.get('page_token')).toBe('next');
  });
  it('clasifica permisos y no admite barras contradictorias',async()=>{
    const options={start:Date.parse('2026-10-20T13:30:00Z'),end:Date.parse('2026-10-20T13:33:00Z'),apiKey:'k',secretKey:'s',pause:async()=>{}};
    await expect(fetchIexWindow({...options,get:async()=>new Response('',{status:403})})).rejects.toThrow('IEX_PERMISSION_DENIED');
    await expect(fetchIexWindow({...options,get:async()=>Response.json({bars:[raw('2026-10-20T13:30:00Z',0),raw('2026-10-20T13:30:00Z',1)],next_page_token:null})})).rejects.toThrow('duplicada');
  });
  it('solo agrega un intervalo con sus 15 minutos y cuenta huecos sin rellenarlos',()=>{
    const calendar:MarketCalendar=new Map([['2026-10-20',{open:570,close:600}]]);
    const bars=Array.from({length:30},(_,i)=>minute(new Date(Date.parse('2026-10-20T13:30:00Z')+i*60_000).toISOString(),i)).filter((_,i)=>i!==20);
    const audit=auditIex(bars,calendar);
    expect(audit.summary).toMatchObject({expectedMinutes:30,observedMinutes:29,missingMinutes:1,strict15m:1,featureEligible15m:0});
    expect(audit.strict15m[0]!.volume).toBe(150);
  });
  it('ancla los minutos en Nueva York antes y después de DST y respeta cierre anticipado',()=>{
    const calendar:MarketCalendar=new Map([['2026-03-06',{open:570,close:600}],['2026-03-09',{open:570,close:585}]]);
    const bars=[...Array.from({length:30},(_,i)=>minute(new Date(Date.parse('2026-03-06T14:30:00Z')+i*60_000).toISOString(),i)),
      ...Array.from({length:15},(_,i)=>minute(new Date(Date.parse('2026-03-09T13:30:00Z')+i*60_000).toISOString(),i))];
    const audit=auditIex(bars,calendar);
    expect(audit.summary).toMatchObject({expectedMinutes:45,observedMinutes:45,missingMinutes:0,strict15m:3});
    expect(audit.strict15m.at(-1)!.timestamp).toBe('2026-03-09T13:30:00.000Z');
  });
  it('reanuda partes completas sin volver a solicitarlas y mantiene salida privada',async()=>{
    const out=mkdtempSync(join(tmpdir(),'iex-history-'));
    try{
      let calls=0;const get=async()=>{calls++;return Response.json({bars:[raw('2026-10-20T13:30:00Z',0)],next_page_token:null});};
      const calendarGet=async()=>Response.json([{date:'2026-10-20',open:'09:30',close:'10:00'}]);
      const options={out,start:'2026-10-20T00:00:00.000Z',end:'2026-10-21T00:00:00.000Z',apiKey:'k',secretKey:'s',get,calendarGet,pause:async()=>{}};
      const first=await downloadIexHistory(options),second=await downloadIexHistory(options);
      expect(calls).toBe(1);expect(second.summary).toEqual(first.summary);
      expect(readFileSync(join(out,'minutes.csv'),'utf8')).toContain('trade_count');
      expect(readFileSync(join(out,'report.json'),'utf8')).toContain('UNAVAILABLE_ADJUSTMENT');
    }finally{rmSync(out,{recursive:true,force:true});}
  });
});
