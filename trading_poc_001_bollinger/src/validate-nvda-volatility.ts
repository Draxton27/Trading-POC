import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {loadDataset} from './csv.ts';
import {loadMarketCalendar} from './alpaca-calendar.ts';
import {studyNvdaPullbackBreakout, type Phase11Study} from './nvda-pullback-breakout.ts';
import {studyNvdaFailedBreakouts, type FailedBreakoutStudy} from './nvda-failed-breakouts.ts';
import {studyNvdaVolatility, type VolatilityEvent, type GeneralWindow,
  type Horizon} from './nvda-volatility-study.ts';
import {renderNvdaVolatilityReport} from './nvda-volatility-report.ts';

const source = process.argv[2] ?? 'data/NVDA_ALPACA_SIP_15min_20211017_20261017.csv';
const expected = {
  csv: '7b06d0a493515b18a581963d2d2d488e73a7cd0dc2c961b60a99315e7a9b0ecc',
  metadata: '123ff39326b3aa2eb16a0455a0b9652a77ea009363758353880761d524a014e2',
  calendar: '75c3228c9addae74242763927a18d6e206fc623f2204381894f2d162befbe37a',
  provenance: '90e3381b68308f8e3188ff2651f7c3432ecccc4872ee8d32181b3ac10b66ea94',
  phase11: '05031c1371b2596efa7653e326cdad1325855454479a1e1f25c3aeff66f6ba1f',
  phase12: '3e1f2ddab92bee95c270a9f1f170574a4089c1d9bd3696287a343a30fc030f56',
} as const;
const priorFiles = {
  phase11: 'output/real/nvda-pullback-breakout-study.json',
  phase12: '../shared-artifacts/phase12-nvda-failed-breakouts/phase12-results.json',
};
const paths = {csv: source, metadata: source + '.meta.json',
  calendar: source + '.calendar.json', provenance: source + '.provenance.json', ...priorFiles};
const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex');
const hashes = Object.fromEntries(Object.entries(paths).map(([key, path]) =>
  [key, sha256(readFileSync(path))])) as Record<keyof typeof expected, string>;
for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
  assert.equal(hashes[key], expected[key], `SHA-256 inesperado en ${key}; se aborta Fase 13`);
}
const {candles, metadata} = loadDataset(source);
assert.ok(metadata.asset === 'NVDA' && metadata.provider === 'Alpaca Market Data API' &&
  metadata.data_class === 'real' && metadata.bar_minutes === 15 && metadata.feed === 'sip' &&
  metadata.adjustment === 'split' && metadata.session === 'regular',
  'Se exige NVDA real SIP 15Min split regular.');
const provenance = JSON.parse(readFileSync(paths.provenance, 'utf8')) as Record<string, unknown>;
assert.ok(provenance.provider === 'Alpaca Market Data API' &&
  provenance.timeframe === '15Min' && provenance.feed === 'sip' &&
  provenance.adjustment === 'split' && provenance.session === 'regular' &&
  provenance.credentials_recorded === false, 'Procedencia inválida.');
const calendar = loadMarketCalendar(paths.calendar);
const prior11 = JSON.parse(readFileSync(priorFiles.phase11, 'utf8')) as {study: Phase11Study};
const prior12 = JSON.parse(readFileSync(priorFiles.phase12, 'utf8')) as {study: FailedBreakoutStudy};
// The complete published objects include all events, controls, exclusions and outputs.
const publishedShape = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
assert.deepEqual(publishedShape(studyNvdaPullbackBreakout(candles, calendar)), prior11.study,
  'Fase 11 difiere del JSON publicado.');
assert.deepEqual(publishedShape(studyNvdaFailedBreakouts(candles, calendar)), prior12.study,
  'Fase 12 difiere del JSON publicado.');
const codeVersion = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
const study = studyNvdaVolatility(candles, calendar, prior11.study, prior12.study);
const output = join('output', 'real');
mkdirSync(output, {recursive: true});

function csvRow(values: readonly (string | number | boolean | null)[]): string {
  return values.map(value => {
    if (value === null) return '';
    const string = String(value);
    return /[",\r\n]/.test(string) ? '"' + string.replaceAll('"', '""') + '"' : string;
  }).join(',');
}
function csvFile(header: readonly string[], rows: readonly (readonly (string | number | boolean | null)[])[]): string {
  return header.join(',') + '\n' + rows.map(csvRow).join('\n') + '\n';
}
const horizonKeys: Horizon[] = ['15', '30', '60'];
const eventHeader = ['id', 'family', 'source_phase', 'direction', 'source_index', 'date_ny',
  'slot_ny', 'hour_block', 'bar_start_utc', 'available_at_utc', 'segment', 'regime',
  'prior_atr14_dollar', 'prior_atr14_percent', 'p33', 'p67', 'atr_reference_count',
  'prior_range20_dollar', 'prior_range20_percent', 'range20_count',
  'general_control30_mean_percent', 'general_control30_mfe_percent',
  'general_control30_mae_percent', 'general_control30_observations',
  'general_control30_sessions', 'general_control30_reason',
  ...horizonKeys.flatMap(h => [`h${h}_signed_percent`, `h${h}_excluded_reason`,
    `h${h}_entry_utc`, `h${h}_exit_utc`, `h${h}_entry_price`, `h${h}_exit_price`,
    `h${h}_mfe_percent`, `h${h}_mae_percent`, `h${h}_mfe_atr_units`, `h${h}_mae_atr_units`,
    `h${h}_mfe_range20_units`, `h${h}_mae_range20_units`,
    `h${h}_original_control_mean_percent`, `h${h}_original_control_observations`,
    `h${h}_original_control_reason`])];
function eventRow(item: VolatilityEvent): (string | number | boolean | null)[] {
  const control = item.generalControl30;
  return [item.id, item.family, item.sourcePhase, item.direction, item.index,
    item.dateNy, item.slotNy, item.hourBlock, item.barStartUtc, item.availableAtUtc,
    item.segment, item.regime, item.priorAtr14, item.priorAtr14Percent,
    item.p33, item.p67, item.atrReferenceCount, item.priorRange20Dollar,
    item.priorRange20Percent, item.range20Count, control.meanPercent,
    control.meanMfePercent, control.meanMaePercent, control.observations,
    control.sessions, control.reason, ...horizonKeys.flatMap(h => {
      const trajectory = item.trajectories[h], original = item.originalControls[h];
      return [trajectory.value, trajectory.reason, trajectory.entryUtc, trajectory.exitUtc,
        trajectory.entryPrice, trajectory.exitPrice, trajectory.mfePercent,
        trajectory.maePercent, trajectory.mfeAtrUnits, trajectory.maeAtrUnits,
        trajectory.mfeRange20Units, trajectory.maeRange20Units,
        original.meanPercent, original.observations, original.reason];
    })];
}
const baselineHeader = ['source_index', 'date_ny', 'slot_ny', 'hour_block',
  'bar_start_utc', 'available_at_utc', 'regime', 'prior_atr14_dollar',
  'prior_atr14_percent', 'prior_range20_dollar', 'prior_range20_percent',
  ...(['bullish', 'bearish'] as const).flatMap(side => [
    `${side}_h30_signed_percent`, `${side}_h30_excluded_reason`,
    `${side}_h30_entry_utc`, `${side}_h30_exit_utc`,
    `${side}_h30_mfe_percent`, `${side}_h30_mae_percent`,
    `${side}_h30_mfe_atr_units`, `${side}_h30_mae_atr_units`,
    `${side}_h30_mfe_range20_units`, `${side}_h30_mae_range20_units`])];
function baselineRow(item: GeneralWindow): (string | number | null)[] {
  return [item.index, item.dateNy, item.slotNy, item.hourBlock, item.barStartUtc,
    item.availableAtUtc, item.regime, item.priorAtr14, item.priorAtr14Percent,
    item.priorRange20Dollar, item.priorRange20Percent,
    ...([item.bullish, item.bearish].flatMap(result => [result.value, result.reason,
      result.entryUtc, result.exitUtc, result.mfePercent, result.maePercent,
      result.mfeAtrUnits, result.maeAtrUnits, result.mfeRange20Units,
      result.maeRange20Units]))];
}
const eventsPath = join(output, 'nvda-volatility-regimes-events.csv');
const baselinePath = join(output, 'nvda-volatility-regimes-baseline.csv');
writeFileSync(eventsPath, csvFile(eventHeader, study.events.map(eventRow)));
writeFileSync(baselinePath, csvFile(baselineHeader, study.baselineWindows.map(baselineRow)));
const outputHashes = {events: sha256(readFileSync(eventsPath)),
  baseline: sha256(readFileSync(baselinePath))};
const {baselineWindows, ...compactStudy} = study;
writeFileSync(join(output, 'nvda-volatility-regimes.json'), JSON.stringify({
  protocol: 'docs/phase13-research-protocol.md', codeVersion,
  source: basename(source), sourceSha256: hashes.csv, inputHashes: hashes,
  outputHashes, metadata: {asset: metadata.asset, provider: metadata.provider,
    dataClass: metadata.data_class, timeframeMinutes: metadata.bar_minutes,
    feed: metadata.feed, adjustment: metadata.adjustment, session: metadata.session},
  provenance: {provider: provenance.provider, timeframe: provenance.timeframe,
    feed: provenance.feed, adjustment: provenance.adjustment,
    session: provenance.session, requestedStart: provenance.requested_start,
    requestedEnd: provenance.requested_end},
  baselineWindowCount: baselineWindows.length, study: compactStudy,
}, null, 2) + '\n');
writeFileSync(join(output, 'nvda-volatility-regimes.md'), renderNvdaVolatilityReport(
  study, basename(source), hashes.csv, codeVersion,
  {phase11: hashes.phase11, phase12: hashes.phase12}));
console.log(`Fase 13: ${study.events.length} eventos, ${baselineWindows.length} ventanas; ` +
  `decisión: ${study.decision.label}.`);
