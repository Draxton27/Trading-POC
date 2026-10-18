import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {loadDataset} from './csv.ts';
import {loadMarketCalendar} from './alpaca-calendar.ts';
import {studyNvdaFailedBreakouts, type Episode, type FailedBreakoutSignal} from './nvda-failed-breakouts.ts';
import {renderPhase12DataAudit, renderPhase12Report} from './nvda-failed-breakouts-report.ts';

const path = process.argv[2] ?? 'data/NVDA_ALPACA_SIP_15min_20211017_20261017.csv';
const expected = {
  csv: '7b06d0a493515b18a581963d2d2d488e73a7cd0dc2c961b60a99315e7a9b0ecc',
  metadata: '123ff39326b3aa2eb16a0455a0b9652a77ea009363758353880761d524a014e2',
  calendar: '75c3228c9addae74242763927a18d6e206fc623f2204381894f2d162befbe37a',
  provenance: '90e3381b68308f8e3188ff2651f7c3432ecccc4872ee8d32181b3ac10b66ea94',
} as const;
const sourcePaths = {csv: path, metadata: path + '.meta.json',
  calendar: path + '.calendar.json', provenance: path + '.provenance.json'};
const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
const hashes = Object.fromEntries(Object.entries(sourcePaths).map(([kind, source]) =>
  [kind, sha256(readFileSync(source))])) as Record<keyof typeof expected, string>;
for (const kind of Object.keys(expected) as (keyof typeof expected)[]) {
  if (hashes[kind] !== expected[kind]) throw new Error(`SHA-256 inesperado en ${kind}; no se ejecutó el estudio.`);
}
const {candles, metadata} = loadDataset(path);
if (metadata.asset !== 'NVDA' || metadata.provider !== 'Alpaca Market Data API' ||
    metadata.data_class !== 'real' || metadata.bar_minutes !== 15 || metadata.feed !== 'sip' ||
    metadata.adjustment !== 'split' || metadata.session !== 'regular') {
  throw new Error('Fase 12 exige NVDA real de Alpaca SIP, 15 minutos, ajuste split y sesión regular.');
}
const calendar = loadMarketCalendar(sourcePaths.calendar);
const rawProvenance = JSON.parse(readFileSync(sourcePaths.provenance, 'utf8')) as Record<string, unknown>;
if (rawProvenance.provider !== 'Alpaca Market Data API' || rawProvenance.timeframe !== '15Min' ||
    rawProvenance.feed !== 'sip' || rawProvenance.adjustment !== 'split' ||
    rawProvenance.session !== 'regular' || rawProvenance.credentials_recorded !== false) {
  throw new Error('Procedencia del historial NVDA inválida o incompleta.');
}
const safeMetadata = {asset: metadata.asset, provider: metadata.provider,
  data_class: metadata.data_class, bar_minutes: metadata.bar_minutes,
  feed: metadata.feed, adjustment: metadata.adjustment, session: metadata.session};
const safeProvenance = {provider: rawProvenance.provider, timeframe: rawProvenance.timeframe,
  feed: rawProvenance.feed, adjustment: rawProvenance.adjustment,
  session: rawProvenance.session, requested_start: rawProvenance.requested_start,
  requested_end: rawProvenance.requested_end};
const codeVersion = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
const study = studyNvdaFailedBreakouts(candles, calendar);
const output = join('..', 'shared-artifacts', 'phase12-nvda-failed-breakouts');
mkdirSync(output, {recursive: true});
const source = basename(path);
writeFileSync(join(output, 'phase12-report.md'),
  renderPhase12Report(study, source, hashes.csv, codeVersion));
writeFileSync(join(output, 'phase12-data-audit.md'),
  renderPhase12DataAudit(study, source, hashes, codeVersion, safeMetadata, safeProvenance));
writeFileSync(join(output, 'phase12-results.json'), JSON.stringify({
  protocol: 'docs/phase12-research-protocol.md', codeVersion, source, sourceSha256: hashes.csv,
  inputHashes: hashes, metadata: safeMetadata, provenance: safeProvenance, study,
}, null, 2) + '\n');

function csv(values: readonly (string | number | boolean | null)[]): string {
  return values.map(value => {
    if (value === null) return '';
    const text = String(value);
    return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
  }).join(',');
}
function closeOf(start: string | null): string | null {
  return start === null ? null : new Date(Date.parse(start) + 900_000).toISOString();
}
const eventFields = ['episode_id', 'breakout_side', 'status', 'observation_reason', 'date_ny',
  'prior_session_date', 'segment', 'prior_high', 'prior_low', 'breakout_close',
  'breakout_bar_start_utc', 'breakout_available_at_utc', 'first_observation_bar_start_utc',
  'first_observation_available_at_utc', 'first_observation_close',
  'second_observation_bar_start_utc', 'second_observation_available_at_utc',
  'second_observation_close', 'failure_lag', 'failure_confirmation_available_at_utc',
  'time_bucket_from_open'];
function eventValues(item: Episode): (string | number | null)[] {
  return [item.id, item.side, item.status, item.observationReason, item.dateNy,
    item.priorSessionDate, item.segment, item.priorHigh, item.priorLow, item.breakoutClose,
    item.breakoutBarStartUtc, item.breakoutAvailableAtUtc, item.firstObservationStartUtc,
    closeOf(item.firstObservationStartUtc), item.firstObservationClose,
    item.secondObservationStartUtc, closeOf(item.secondObservationStartUtc),
    item.secondObservationClose, item.failureLag, item.confirmationAvailableAtUtc,
    item.timeBucket];
}
writeFileSync(join(output, 'phase12-events.csv'), eventFields.join(',') + '\n' +
  study.episodes.map(item => csv(eventValues(item))).join('\n') + '\n');

const horizons = ['15', '30', '60'] as const;
const signalFields = ['episode_id', 'breakout_side', 'trade_direction', 'date_ny', 'segment',
  'confirmation_bar_start_utc', 'signal_available_at_utc', 'confirmation_close',
  'failure_lag', 'prior_high', 'prior_low', 'sma_trend_descriptive', 'day_close',
  'day_sma20', 'hour_close', 'hour_sma100', 'repeated_within_four_bars',
  'overlapping_primary_outcome', 'dedup_retained',
  ...horizons.flatMap(h => [`h${h}_signed_percent`, `h${h}_excluded_reason`,
    `h${h}_entry_utc`, `h${h}_exit_utc`, `h${h}_entry_price`, `h${h}_exit_price`,
    `h${h}_mfe_percent`, `h${h}_mae_percent`, `h${h}_control_mean_percent`,
    `h${h}_control_observations`, `h${h}_control_sessions`, `h${h}_control_reason`])];
function signalValues(item: FailedBreakoutSignal): (string | number | boolean | null)[] {
  const values: (string | number | boolean | null)[] = [item.episodeId, item.side,
    item.direction, item.dateNy, item.segment, item.confirmationBarStartUtc,
    item.availableAtUtc, item.confirmationClose, item.failureLag, item.priorHigh,
    item.priorLow, item.sma.trend, item.sma.dayClose, item.sma.daySma20,
    item.sma.hourClose, item.sma.hourSma100, item.repeatedWithinFourBars,
    item.overlappingPrimaryOutcome, item.dedupRetained];
  for (const horizon of horizons) {
    const result = item.horizons[horizon], control = item.controls[horizon];
    values.push(result.value, result.reason, result.entryUtc, result.exitUtc,
      result.entryPrice, result.exitPrice, result.mfePercent, result.maePercent,
      control.meanPercent, control.observations, control.sessions, control.reason);
  }
  return values;
}
writeFileSync(join(output, 'phase12-signals.csv'), signalFields.join(',') + '\n' +
  study.signals.map(item => csv(signalValues(item))).join('\n') + '\n');

const readme = `# Artefactos de Fase 12: NVDA\n\n` +
  `Estudio exploratorio de rupturas fallidas del máximo y mínimo de la sesión bursátil anterior. ` +
  `Protocolo fijado antes del análisis en [docs/phase12-research-protocol.md](../../docs/phase12-research-protocol.md).\n\n` +
  `Versión exacta del código usada: \`${codeVersion}\`. SHA-256 del CSV fuente: \`${hashes.csv}\`. ` +
  `El historial SIP original no se redistribuye en esta carpeta. Se necesita el CSV local de cinco años ` +
  `y sus archivos \`.meta.json\`, \`.calendar.json\` y \`.provenance.json\`, con los hashes ` +
  `registrados en \`phase12-data-audit.md\`. No se necesitan credenciales para repetir el análisis.\n\n` +
  `Desde \`trading_poc_001_bollinger/\`, usando ese código y los archivos de entrada:\n\n` +
  '\`\`\`bash\n' +
  'npm ci\n' +
  'npm run validate:nvda-failed-breakouts -- data/NVDA_ALPACA_SIP_15min_20211017_20261017.csv\n' +
  '\`\`\`\n\n' +
  `- [phase12-report.md](phase12-report.md): conclusiones, tablas principales y negativas, costos, años y límites.\n` +
  `- [phase12-results.json](phase12-results.json): resultados estructurados, todos los episodios y señales.\n` +
  `- [phase12-signals.csv](phase12-signals.csv): cada falla confirmada, tres horizontes, MFE/MAE y controles.\n` +
  `- [phase12-events.csv](phase12-events.csv): cada ruptura inicial, regreso o no regreso, con timestamps.\n` +
  `- [phase12-data-audit.md](phase12-data-audit.md): cobertura, calendario, hashes y procedencia.\n` +
  `- [SHA256SUMS.txt](SHA256SUMS.txt): hashes de los seis archivos anteriores, incluido este README; ` +
  `el manifiesto se excluye de sí mismo.\n\n` +
  `El corte 70/30 y todos los años son retrospectivos; no constituyen validación prospectiva. ` +
  `MFE y MAE no suponen orden de máximos y mínimos dentro de cada vela ni ejecución garantizada.\n`;
writeFileSync(join(output, 'README.md'), readme);
const delivered = ['README.md', 'phase12-data-audit.md', 'phase12-events.csv',
  'phase12-report.md', 'phase12-results.json', 'phase12-signals.csv'];
writeFileSync(join(output, 'SHA256SUMS.txt'), delivered.map(name =>
  `${sha256(readFileSync(join(output, name)))}  ${name}`).join('\n') + '\n');
console.log(`Fase 12 NVDA: ${study.episodes.length} rupturas originales, ` +
  `${study.signals.length} fallas confirmadas; artefactos en ${output}.`);
