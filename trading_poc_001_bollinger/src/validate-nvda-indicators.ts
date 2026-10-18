import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {loadDataset} from './csv.ts';
import {loadMarketCalendar} from './alpaca-calendar.ts';
import {studyNvdaIndicators, type SignalRecord} from './nvda-indicators-study.ts';
import {renderNvdaIndicatorsReport} from './nvda-indicators-report.ts';

const path = process.argv[2] ?? 'data/NVDA_ALPACA_SIP_15min_12m.csv';
const {candles, metadata} = loadDataset(path);
if (metadata.data_class !== 'real' || metadata.asset !== 'NVDA' || metadata.bar_minutes !== 15 ||
    metadata.provider !== 'Alpaca Market Data API' || metadata.feed !== 'sip' ||
    metadata.adjustment !== 'split' || metadata.session !== 'regular') {
  throw new Error('El estudio requiere NVDA real de Alpaca SIP, velas de 15 minutos, ajuste split y sesión regular.');
}
const calendarPath = `${path}.calendar.json`;
const calendar = loadMarketCalendar(calendarPath);
const calendarRaw = JSON.parse(readFileSync(calendarPath, 'utf8')) as {reconstruction?: {original_alpaca_calendar?: boolean; schedule_source?: string}};
const provenance = calendarRaw.reconstruction?.original_alpaca_calendar === false ?
  `reconstrucción local de ${calendarRaw.reconstruction.schedule_source ?? 'fuente no especificada'}; no es calendario original certificado de Alpaca` :
  'procedencia del calendario no certificada por este estudio';
const study = studyNvdaIndicators(candles, calendar);
const output = join('output', 'real');
mkdirSync(output, {recursive: true});
const stem = 'nvda-indicators-study';
writeFileSync(join(output, `${stem}.md`), renderNvdaIndicatorsReport(study, basename(path), provenance));
writeFileSync(join(output, `${stem}.json`), JSON.stringify({source: basename(path), metadata, calendarProvenance: provenance, study}, null, 2) + '\n');
const headers = ['date_ny','slot_ny','bar_start_utc','available_at_utc','segment','direction','close','bollinger_middle','bollinger_upper','bollinger_lower','previous_bandwidth_percent','current_bandwidth_percent','squeeze_threshold_percent','ema9','previous_ema9','close_above_ema9','ema9_pass','volume','average_volume_20','rvol','volume_pass','bollinger_status','ema9_status','volume_status','ema9_volume_status',
  ...[15,30,60].flatMap(h => [`h${h}_signed_percent`,`h${h}_excluded_reason`,`h${h}_entry_utc`,`h${h}_exit_utc`])];
function csvRecord(r: SignalRecord): string {
  const {signal: s} = r;
  const volumeStatus = r.volumePass === null ? 'insufficient' : r.volumePass ? 'retained' : 'discarded';
  const combinedStatus = r.volumePass === null ? 'insufficient' : r.volumePass && r.emaPass ? 'retained' : 'discarded';
  const values: (string | number | boolean | null)[] = [r.dateNy,r.slotNy,s.timestamp,s.availableAt,r.segment,s.direction,s.close,
    r.bollinger.middle,r.bollinger.upper,r.bollinger.lower,s.previousBandwidthPercent,s.currentBandwidthPercent,s.squeezeThresholdPercent,
    r.ema9,r.previousEma9,r.closeAboveEma,r.emaPass,r.volume,r.averageVolume20,r.rvol,r.volumePass,
    'retained',r.emaPass ? 'retained' : 'discarded',volumeStatus,combinedStatus,
    ...([15,30,60] as const).flatMap(h => {const v = r.horizons[String(h) as '15'|'30'|'60']; return [v.value,v.reason,v.entryUtc,v.exitUtc];})];
  return values.map(value => value === null ? '' : String(value)).join(',');
}
writeFileSync(join(output, 'nvda-indicators-signals.csv'), headers.join(',') + '\n' + study.signals.map(csvRecord).join('\n') + '\n');
console.log(`Fase 9 NVDA: ${study.candleCount} velas, ${study.signalCount} señales; informes en ${output}.`);
