import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {loadMarketCalendar} from './alpaca-calendar.ts';
import {loadDataset} from './csv.ts';
import {SMA_PERIODS} from './multitimeframe.ts';
import {renderNvdaSmaContextReport} from './nvda-sma-context-report.ts';
import {studyNvdaSmaContext, type SmaSignalRecord, type TimeframeContext} from './nvda-sma-context-study.ts';

const path=process.argv[2]??'data/NVDA_ALPACA_SIP_15min_12m.csv';
const {candles,metadata}=loadDataset(path);
if(metadata.data_class!=='real'||metadata.asset!=='NVDA'||metadata.bar_minutes!==15||
  metadata.provider!=='Alpaca Market Data API'||metadata.feed!=='sip'||metadata.adjustment!=='split'||
  metadata.session!=='regular'){
  throw new Error('El estudio SMA requiere NVDA real de Alpaca SIP, 15 minutos, ajuste split y sesión regular.');
}
const calendarPath=`${path}.calendar.json`;
const calendar=loadMarketCalendar(calendarPath);
const raw=JSON.parse(readFileSync(calendarPath,'utf8')) as {provider?:string;reconstruction?:{original_alpaca_calendar?:boolean;schedule_source?:string}};
const provenance=raw.reconstruction?.original_alpaca_calendar===false?
  `reconstrucción local de ${raw.reconstruction.schedule_source??'fuente no especificada'}; no es calendario original certificado de Alpaca`:
  raw.provider==='Alpaca Market Calendar'?
    'declarado por el importador como respuesta del calendario de Alpaca; este estudio no certifica su origen de forma independiente':
    'procedencia del calendario no certificada por este estudio';
const study=studyNvdaSmaContext(candles,calendar);
const output=join('output','real');
mkdirSync(output,{recursive:true});
writeFileSync(join(output,'nvda-sma-context.md'),renderNvdaSmaContextReport(study,basename(path),provenance));
writeFileSync(join(output,'nvda-sma-context.json'),JSON.stringify({source:basename(path),metadata,
  calendarProvenance:provenance,study},null,2)+'\n');

const timeframeHeaders=(prefix:string)=>[
  `${prefix}_reference_start_utc`,`${prefix}_reference_close_utc`,`${prefix}_available_at_utc`,`${prefix}_reference_close`,
  ...SMA_PERIODS.flatMap(period=>[`${prefix}_sma${period}`,`${prefix}_sma${period}_previous`,
    `${prefix}_sma${period}_position`,`${prefix}_sma${period}_slope`]),
  `${prefix}_all_available`,`${prefix}_above_all`,`${prefix}_below_all`,`${prefix}_bullish_order`,
  `${prefix}_bearish_order`,`${prefix}_directional_context`];
const headers=['date_ny','slot_ny','signal_start_utc','signal_close_utc','segment','direction','price_close',
  'bollinger_middle','bollinger_upper','bollinger_lower','ema9','previous_ema9','volume','average_volume_20','rvol',
  ...timeframeHeaders('hour'),...timeframeHeaders('day'),'timeframes_agree','timeframes_contradict',
  ...[15,30,60].flatMap(horizon=>[`h${horizon}_signed_percent`,`h${horizon}_excluded_reason`,
    `h${horizon}_entry_utc`,`h${horizon}_exit_utc`])];
function timeframeValues(context:TimeframeContext):(string|number|boolean|null)[]{
  return [context.referenceStartUtc,context.referenceCloseUtc,context.availableAtUtc,context.referenceClose,
    ...SMA_PERIODS.flatMap(period=>{const sma=context.smas[period];return [sma.value,sma.previous,sma.position,sma.slope];}),
    context.allAvailable,context.aboveAll,context.belowAll,context.bullishOrder,context.bearishOrder,context.directionalContext];
}
function csv(record:SmaSignalRecord):string{
  const values:(string|number|boolean|null)[]=[record.dateNy,record.slotNy,record.signal.timestamp,
    record.signal.availableAt,record.segment,record.signal.direction,record.signal.close,
    record.bollinger.middle,record.bollinger.upper,record.bollinger.lower,record.ema9,record.previousEma9,
    record.volume,record.averageVolume20,record.rvol,...timeframeValues(record.hour),...timeframeValues(record.day),
    record.timeframesAgree,record.timeframesContradict,
    ...([15,30,60] as const).flatMap(horizon=>{const result=record.horizons[String(horizon) as '15'|'30'|'60'];
      return [result.value,result.reason,result.entryUtc,result.exitUtc];})];
  return values.map(value=>value===null?'':String(value)).join(',');
}
writeFileSync(join(output,'nvda-sma-context-signals.csv'),headers.join(',')+'\n'+study.signals.map(csv).join('\n')+'\n');
console.log(`Fase 10 NVDA: ${study.aggregate.hour.complete} velas horarias completas, ${study.aggregate.day.complete} diarias completas y ${study.sourceSignalCount} señales.`);
