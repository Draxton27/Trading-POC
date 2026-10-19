import {describe,it,expect} from 'vitest';
import {alignTradeMarkers} from '../../apps/web/src/features/charts/trade-markers.ts';

describe('ejecuciones sobre velas del subyacente',()=>{
  it('ubica varias compras y ventas parciales incluso tras días sin mercado',()=>{
    const bars=[
      {startUtc:'2026-10-16T13:30:00.000Z',endUtc:'2026-10-16T13:45:00.000Z',close:100},
      {startUtc:'2026-10-19T13:30:00.000Z',endUtc:'2026-10-19T13:45:00.000Z',close:105},
      {startUtc:'2026-10-19T13:45:00.000Z',endUtc:'2026-10-19T14:00:00.000Z',close:106}];
    const markers=[
      {timestampUtc:'2026-10-16T13:35:00.000Z',label:'buy 1'},
      {timestampUtc:'2026-10-16T13:40:00.000Z',label:'buy 2'},
      {timestampUtc:'2026-10-19T13:31:00.000Z',label:'sell 1'},
      {timestampUtc:'2026-10-19T13:46:00.000Z',label:'sell 2'}];
    const result=alignTradeMarkers(bars,markers);
    expect(result.missing).toEqual([]);
    expect(result.placed.map(m=>m.barStartUtc)).toEqual([
      bars[0]!.startUtc,bars[0]!.startUtc,bars[1]!.startUtc,bars[2]!.startUtc]);
  });
  it('no aproxima ejecuciones sin vela y respeta el límite de fin exclusivo',()=>{
    const bars=[{startUtc:'2026-10-16T13:30:00.000Z',
      endUtc:'2026-10-16T13:45:00.000Z',close:100}];
    const result=alignTradeMarkers(bars,[
      {timestampUtc:'2026-10-16T13:45:00.000Z',label:'sin vela'},
      {timestampUtc:'2026-10-16T13:30:00.000Z',label:'exacto'}]);
    expect(result.missing.map(m=>m.label)).toEqual(['sin vela']);
    expect(result.placed.map(m=>m.label)).toEqual(['exacto']);
  });
});
