import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {loadDataset} from './csv.ts';
import {loadMarketCalendar} from './alpaca-calendar.ts';
import {studyNvdaPullbackBreakout, type Phase11Event} from './nvda-pullback-breakout.ts';
import {renderNvdaPullbackBreakoutReport} from './nvda-pullback-breakout-report.ts';

const path = process.argv[2] ?? 'data/NVDA_ALPACA_SIP_15min_20211017_20261017.csv';
const {candles, metadata} = loadDataset(path);
if (metadata.asset !== 'NVDA' || metadata.provider !== 'Alpaca Market Data API' ||
    metadata.data_class !== 'real' || metadata.bar_minutes !== 15 ||
    metadata.feed !== 'sip' || metadata.adjustment !== 'split' || metadata.session !== 'regular') {
  throw new Error('Fase 11 exige NVDA real de Alpaca SIP, 15 minutos, ajuste split y sesión regular.');
}
const calendar = loadMarketCalendar(path + '.calendar.json');
const rawProvenance = JSON.parse(readFileSync(path + '.provenance.json', 'utf8')) as Record<string, unknown>;
if (rawProvenance.provider !== 'Alpaca Market Data API' ||
    rawProvenance.timeframe !== '15Min' || rawProvenance.feed !== 'sip' ||
    rawProvenance.adjustment !== 'split' || rawProvenance.session !== 'regular') {
  throw new Error('Procedencia del historial NVDA inválida o incompleta.');
}
const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
const study = studyNvdaPullbackBreakout(candles, calendar);
const output = join('output', 'real');
mkdirSync(output, {recursive: true});
const stem = 'nvda-pullback-breakout';
const source = basename(path);
writeFileSync(join(output, stem + '-study.md'), renderNvdaPullbackBreakoutReport(study, source, sha256));
writeFileSync(join(output, stem + '-study.json'), JSON.stringify({source, sha256,
  metadata: {asset: metadata.asset, bar_minutes: metadata.bar_minutes, provider: metadata.provider,
    data_class: metadata.data_class, feed: metadata.feed, adjustment: metadata.adjustment,
    session: metadata.session},
  provenance: {provider: rawProvenance.provider, timeframe: rawProvenance.timeframe,
    feed: rawProvenance.feed, adjustment: rawProvenance.adjustment,
    requested_start: rawProvenance.requested_start, requested_end: rawProvenance.requested_end},
  protocol: 'docs/phase11-research-protocol.md', study}, null, 2) + '\n');

const fields = ['strategy','direction','date_ny','slot_ny','bar_start_utc','available_at_utc','segment',
  'price_close','hour_sma20','hour_sma100','day_sma20','distance_close_hour20_percent',
  'distance_extreme_hour20_percent','distance_close_hour100_percent','distance_close_day20_percent',
  'bollinger_upper','bollinger_lower','bollinger_bandwidth_percent','ema9','rvol',
  'coincides_with_compression','repeated_within_four_bars','overlapping_primary_outcome','dedup_retained',
  ...[15,30,60].flatMap(horizon => [
    'h' + horizon + '_signed_percent','h' + horizon + '_excluded_reason',
    'h' + horizon + '_entry_utc','h' + horizon + '_exit_utc',
    'h' + horizon + '_control_mean_percent','h' + horizon + '_control_count',
    'h' + horizon + '_control_reason'])];
function eventCsv(event: Phase11Event): string {
  const values: (string | number | boolean | null)[] = [
    event.strategy,event.direction,event.dateNy,event.slotNy,event.barStartUtc,event.availableAtUtc,
    event.segment,event.priceClose,event.hourSma20,event.hourSma100,event.daySma20,
    event.distanceCloseHour20Percent,event.distanceExtremeHour20Percent,
    event.distanceCloseHour100Percent,event.distanceCloseDay20Percent,
    event.bollingerUpper,event.bollingerLower,event.bollingerBandwidthPercent,event.ema9,event.rvol,
    event.coincidesWithCompression,event.repeatedWithinFourBars,
    event.overlappingPrimaryOutcome,event.dedupRetained];
  for (const horizon of ['15','30','60'] as const) {
    const result = event.horizons[horizon], control = event.controls[horizon];
    values.push(result.value,result.reason,result.entryUtc,result.exitUtc,
      control.meanPercent,control.controls,control.reason);
  }
  return values.map(value => value === null ? '' : String(value)).join(',');
}
writeFileSync(join(output, stem + '-signals.csv'),
  fields.join(',') + '\n' + study.events.map(eventCsv).join('\n') + '\n');
console.log('Fase 11 NVDA: ' + study.events.length + ' eventos; informes en ' + output + '.');
