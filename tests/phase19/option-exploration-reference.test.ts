import {describe,expect,it} from 'vitest';
import type {IexRecord} from '../../trading_poc_001_bollinger/src/phase38-iex.ts';
import {previousIexSessionReference} from '../../apps/api/src/options/exploration-reference.ts';

const calendar=new Map([['2026-10-23',{open:570,close:960}],['2026-10-26',{open:570,close:960}],
  ['2026-10-27',{open:570,close:960}],['2026-10-28',{open:570,close:960}],['2026-10-29',{open:570,close:960}]]);
const quarter=(startUtc:string,endUtc:string,close=140):IexRecord=>({kind:'quarter',status:'COMPLETE',revision:1,
  sourceMessageHash:'synthetic',receivedAtUtc:new Date(Date.parse(endUtc)+30_000).toISOString(),
  bar:{startUtc,endUtc,open:close,high:close,low:close,close,volume:10,tradeCount:2}} as IexRecord);

describe('referencia IEX de exploración, nunca operativa',()=>{
  it('elige la última vela completa del cierre regular previo y usa sesiones oficiales',()=>{
    const row=quarter('2026-10-27T19:45:00Z','2026-10-27T20:00:00Z');
    expect(previousIexSessionReference([row],calendar,'2026-10-28T14:00:00Z')).toMatchObject({
      referencePrice:140,sessionDate:'2026-10-27',ageTradingSessions:1,isCurrent:false,isExecutable:false});
  });
  it('acepta viernes hasta lunes y no cuenta el fin de semana como sesiones',()=>{
    const row=quarter('2026-10-23T19:45:00Z','2026-10-23T20:00:00Z');
    expect(previousIexSessionReference([row],calendar,'2026-10-24T16:00:00Z')?.ageTradingSessions).toBe(0);
    expect(previousIexSessionReference([row],calendar,'2026-10-26T14:00:00Z')?.ageTradingSessions).toBe(1);
  });
  it('no cuenta el feriado de Acción de Gracias como sesión y exige calendario posterior',()=>{
    const holiday=new Map([['2026-11-25',{open:570,close:960}],['2026-11-27',{open:570,close:780}],
      ['2026-11-30',{open:570,close:960}]]);
    const row=quarter('2026-11-25T20:45:00Z','2026-11-25T21:00:00Z');
    expect(previousIexSessionReference([row],holiday,'2026-11-27T15:00:00Z')?.ageTradingSessions).toBe(1);
  });
  it('rechaza cierre incompleto, demasiado antiguo, futuro y calendario sin cobertura',()=>{
    const mid=quarter('2026-10-27T18:45:00Z','2026-10-27T19:00:00Z');
    const old=quarter('2026-10-23T19:45:00Z','2026-10-23T20:00:00Z');
    expect(previousIexSessionReference([mid],calendar,'2026-10-28T14:00:00Z')).toBeNull();
    expect(previousIexSessionReference([old],calendar,'2026-10-28T14:00:00Z')).toBeNull();
    expect(previousIexSessionReference([old],calendar,'2026-10-23T19:59:00Z')).toBeNull();
    expect(previousIexSessionReference([mid],new Map([['2026-10-27',{open:570,close:960}]]),'2026-10-28T14:00:00Z')).toBeNull();
  });
  it('respeta cierre anticipado y una revisión posterior no cambia la primera versión',()=>{
    const early=new Map([['2026-11-27',{open:570,close:780}],['2026-11-30',{open:570,close:960}]]);
    const row=quarter('2026-11-27T17:45:00Z','2026-11-27T18:00:00Z');
    const revision={...row,revision:2,bar:{...row.bar!,close:150}};
    expect(previousIexSessionReference([row,revision],early,'2026-11-30T15:00:00Z')?.referencePrice).toBe(140);
  });
});
