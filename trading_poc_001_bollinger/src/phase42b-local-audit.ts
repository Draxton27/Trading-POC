import type {Candle} from './domain.ts';
import type {MarketCalendar} from './alpaca-calendar.ts';
import type {QueueItem} from './phase42b-queue.ts';
import {newYorkLocalToUtc} from './phase42b-queue.ts';

/** Reports available file coverage, never claims historical receipt or produces an indicator. */
export function auditLocal15m(queue:readonly QueueItem[],symbol:string,candles:readonly Candle[],calendar:MarketCalendar){
  const times=new Set(candles.map(c=>Date.parse(c.timestamp)));
  return queue.filter(item=>item.symbol===symbol).map(item=>{
    const date=item.entryLocal?.slice(0,10), schedule=date?calendar.get(date):undefined;
    if(!date||!schedule||!item.entryUtc)return {sourceRecordId:item.sourceRecordId,status:'NO_VERIFICABLE' as const,
      expectedBeforeEntry:null,observedBeforeEntry:null,reasons:['CALENDARIO_O_HORA_NO_DISPONIBLE']};
    const hh=Math.floor(schedule.open/60).toString().padStart(2,'0'),mm=(schedule.open%60).toString().padStart(2,'0');
    const open=Date.parse(newYorkLocalToUtc(`${date}T${hh}:${mm}:00`)), entry=Date.parse(item.entryUtc), expected:number[]=[];
    for(let minute=schedule.open;minute+15<=schedule.close;minute+=15){
      const start=open+(minute-schedule.open)*60_000;
      if(start+15*60_000>=entry)break;
      expected.push(start);
    }
    const observed=expected.filter(t=>times.has(t)).length;
    return {sourceRecordId:item.sourceRecordId,status:'NO_VERIFICABLE' as const,expectedBeforeEntry:expected.length,
      observedBeforeEntry:observed,reasons:[...(observed<expected.length?['VELAS_INTRADIA_FALTANTES']:[]),
        ...(expected.length===0?['SIN_VELAS_CERRADAS_ANTES_DE_ENTRADA']:[]),
        'RECEPCION_HISTORICA_NO_VERIFICADA','AJUSTE_POINT_IN_TIME_NO_VERIFICADO']};
  });
}
