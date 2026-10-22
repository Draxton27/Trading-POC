import {existsSync} from 'node:fs';
import {AlpacaCalendarError, fetchAlpacaCalendar, loadMarketCalendar, mergeMarketCalendars, saveMarketCalendar, type MarketCalendar} from './alpaca-calendar.ts';
import {AlpacaCaptureError, delayedCaptureWindow, fetchAlpacaCaptureBars} from './alpaca.ts';
import {appendIngestionStatus, appendSuccessfulCapture, validateCapture} from './phase32-ingestion.ts';

export type CaptureOnceOptions={ledgerPath:string;calendarPath:string;apiKey:string;secretKey:string;delayMinutes?:number;clock?:()=>number;calendar?:MarketCalendar;historicalWindow?:{start:string;end:string}};
/** Shared implementation of alpaca:ingest --once and the coordinated collector. */
export async function captureOnce(options:CaptureOnceOptions){
  const clock=options.clock??Date.now,window=delayedCaptureWindow(clock(),options.delayMinutes??20);
  const selected=options.historicalWindow??window;
  if(options.historicalWindow){
    const start=Date.parse(selected.start),end=Date.parse(selected.end);
    if(!Number.isFinite(start)||!Number.isFinite(end)||start>end||end-start>24*60*60_000||start%900_000||end%900_000||end+900_000>clock()-window.delayMs)throw new Error('Ventana histórica fuera del límite SIP retrasado.');
  }
  try{
    const fresh=options.calendar??await fetchAlpacaCalendar({apiKey:options.apiKey,secretKey:options.secretKey,start:selected.start,end:selected.end});
    saveMarketCalendar(options.calendarPath,mergeMarketCalendars(existsSync(options.calendarPath)?loadMarketCalendar(options.calendarPath):new Map(),fresh));
    const result=await fetchAlpacaCaptureBars({apiKey:options.apiKey,secretKey:options.secretKey,start:selected.start,end:selected.end,calendar:fresh,minimumBarAgeMs:window.delayMs,clock});
    validateCapture(result.candles,fresh,result.receivedAtUtc,clock,window.delayMs,result.queryAtUtc);
    const appended=appendSuccessfulCapture(options.ledgerPath,result);
    return {...result,barsAdded:appended.barsAdded,calendar:fresh};
  }catch(error){
    const status=error instanceof AlpacaCalendarError||error instanceof AlpacaCaptureError?error.status:'INVALID_DATA';
    const stage=error instanceof AlpacaCalendarError?'Calendario':error instanceof AlpacaCaptureError?'Market Data':'Validación local';
    appendIngestionStatus(options.ledgerPath,status,`${stage}: ${error instanceof Error?error.message:'Error de ingesta Alpaca.'}`);
    throw error;
  }
}
