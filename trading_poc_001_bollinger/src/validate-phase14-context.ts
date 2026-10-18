import {strict as assert} from 'node:assert';
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadMarketCalendar} from './alpaca-calendar.ts';
import {parseCandlesCsv} from './csv.ts';
import type {Candle} from './domain.ts';
import {acquirePhase14Events, type VerifiedEvent} from './phase14-events.ts';
import {metadataFor, PHASE14_NVDA_SHA256, sha256, symbolPath} from './phase14-import.ts';
import {buildPhase14Synchronized, SYMBOLS, type SynchronizedRow,
  type SymbolName} from './phase14-sync.ts';

const project = fileURLToPath(new URL('../', import.meta.url));
const repo = fileURLToPath(new URL('../../', import.meta.url));
const data = join(project, 'data');
const output = join(repo, 'shared-artifacts', 'phase14-market-context');
const privateOutput = join(project, 'output', 'real');
const sourceNvda = join(data, 'NVDA_ALPACA_SIP_15min_20211017_20261017.csv');
const priorFiles = {
  phase11: join(privateOutput, 'nvda-pullback-breakout-study.json'),
  phase12: join(repo, 'shared-artifacts', 'phase12-nvda-failed-breakouts', 'phase12-results.json'),
  phase13: join(privateOutput, 'nvda-volatility-regimes.json'),
};
const priorExpected = {
  phase11: '05031c1371b2596efa7653e326cdad1325855454479a1e1f25c3aeff66f6ba1f',
  phase12: '3e1f2ddab92bee95c270a9f1f170574a4089c1d9bd3696287a343a30fc030f56',
  phase13: '45f15df045e7210651745919bbd7f22a9eb88cc199638a1a9c606a7ade40c0e7',
};
const codeVersion = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repo,
  encoding: 'utf8'}).trim();
const calendarPath = sourceNvda + '.calendar.json';
const calendar = loadMarketCalendar(calendarPath);
const inputPaths = Object.fromEntries(SYMBOLS.map(symbol => [symbol,
  symbol === 'NVDA' ? sourceNvda : symbolPath(data, symbol)])) as Record<SymbolName, string>;
const inputHashes = Object.fromEntries(SYMBOLS.map(symbol => [symbol,
  Object.fromEntries((['csv', 'meta.json', 'calendar.json', 'provenance.json'] as const)
    .map(ext => [ext, sha256(readFileSync(inputPaths[symbol] + (ext === 'csv' ? '' : '.' + ext)))]))])) as
      Record<SymbolName, Record<string, string>>;
assert.equal(inputHashes.NVDA.csv, PHASE14_NVDA_SHA256, 'CSV NVDA original no coincide.');
assert.equal(inputHashes.NVDA['calendar.json'], inputHashes.QQQ['calendar.json']);
assert.equal(inputHashes.NVDA['calendar.json'], inputHashes.SMH['calendar.json']);
const originals = Object.fromEntries(Object.entries(priorFiles).map(([phase, path]) =>
  [phase, sha256(readFileSync(path))])) as Record<keyof typeof priorExpected, string>;
for (const phase of Object.keys(priorExpected) as (keyof typeof priorExpected)[]) {
  assert.equal(originals[phase], priorExpected[phase], `Artefacto ${phase} alterado.`);
}
const candles = {} as Record<SymbolName, Candle[]>;
for (const symbol of SYMBOLS) {
  const base = inputPaths[symbol];
  const meta = JSON.parse(readFileSync(base + '.meta.json', 'utf8')) as Record<string, unknown>;
  const provenance = JSON.parse(readFileSync(base + '.provenance.json', 'utf8')) as Record<string, unknown>;
  assert.ok(meta.asset === symbol && meta.provider === 'Alpaca Market Data API' &&
    meta.bar_minutes === 15 && meta.feed === 'sip' && meta.adjustment === 'split' &&
    meta.session === 'regular' && provenance.credentials_recorded === false &&
    provenance.timeframe === '15Min' && provenance.feed === 'sip',
  `Identidad ${symbol} inválida.`);
  candles[symbol] = parseCandlesCsv(readFileSync(base, 'utf8'),
    symbol === 'NVDA' ? {...metadataFor('QQQ'), asset: 'NVDA'} : metadataFor(symbol),
    {allowIntradayGaps: symbol !== 'NVDA'});
}
const events = await acquirePhase14Events(join(data, 'phase14-source-cache'));
const synced = buildPhase14Synchronized(candles, calendar, events.economic, events.corporate);
const phase13 = JSON.parse(readFileSync(priorFiles.phase13, 'utf8')) as {
  study: {events: Array<{id: string; family: string; sourcePhase: number; direction: string;
    index: number; dateNy: string; barStartUtc: string; availableAtUtc: string;
    regime: string; originalHorizons: Record<string, {value: number | null; reason: string | null}>}>};
};
const byStart = new Map(synced.rows.map(row => [row.timestampUtc, row]));
if (byStart.size !== synced.rows.length) throw new Error('Intervalos sincronizados duplicados.');
assert.equal(phase13.study.events.length, 1242, 'Recuento de señales F11/F12 inesperado.');
for (const signal of phase13.study.events) {
  const row = byStart.get(signal.barStartUtc);
  assert.ok(row && row.endUtc === signal.availableAtUtc && row.dateNy === signal.dateNy,
    `Señal histórica sin intervalo exacto: ${signal.id}`);
  assert.equal(candles.NVDA[signal.index]?.timestamp, signal.barStartUtc,
    `Índice NVDA alterado: ${signal.id}`);
}
mkdirSync(output, {recursive: true});
mkdirSync(privateOutput, {recursive: true});

function csv(values: readonly (string | number | boolean | null)[]): string {
  return values.map(value => {
    if (value === null) return '';
    const string = String(value);
    return /[",\r\n]/.test(string) ? '"' + string.replaceAll('"', '""') + '"' : string;
  }).join(',');
}
function csvDocument(header: readonly string[], rows: readonly (readonly (string | number | boolean | null)[])[]): string {
  return header.join(',') + '\n' + rows.map(csv).join('\n') + '\n';
}
function eventCsv(items: VerifiedEvent[]): string {
  const header = ['event_id', 'category', 'subtype', 'date_ny', 'time_ny',
    'time_zone', 'timestamp_utc', 'available_at_utc', 'verification',
    'source_url', 'time_source_url', 'notes', 'consensus', 'released_value', 'surprise'];
  return csvDocument(header, items.map(event => [event.id, event.category, event.subtype,
    event.dateNy, event.timeNy, event.timeZone, event.timestampUtc,
    event.availableAtUtc, event.verification, event.sourceUrl, event.timeSourceUrl, event.notes,
    event.consensus, event.releasedValue, event.surprise]));
}
writeFileSync(join(output, 'phase14-economic-events.csv'), eventCsv(events.economic));
writeFileSync(join(output, 'phase14-nvda-corporate-events.csv'), eventCsv(events.corporate));

const privateHeader = ['timestamp_utc', 'end_utc', 'date_ny', 'slot_ny', 'hour_block',
  ...SYMBOLS.flatMap(symbol => [
    `${symbol}_open`, `${symbol}_high`, `${symbol}_low`, `${symbol}_close`, `${symbol}_volume`,
    `${symbol}_candle_return_pct`, `${symbol}_four_return_pct`,
    `${symbol}_session_return_pct`, `${symbol}_relative_volume`,
    `${symbol}_distance_previous_close_pct`, `${symbol}_available_at_utc`,
    `${symbol}_four_start_utc`, `${symbol}_session_open_utc`,
    `${symbol}_previous_close_utc`, `${symbol}_volume_reference_last_date`,
    `${symbol}_volume_reference_count`]),
  'complete_three', 'nvda_minus_qqq_candle_pct', 'nvda_minus_smh_candle_pct',
  'nvda_minus_qqq_four_pct', 'nvda_minus_smh_four_pct', 'direction_agreement',
  'known_event_ids', 'minutes_since_events', 'date_only_event_ids',
  'event_before_open', 'event_during_session', 'post_earnings_from_prior_close'];
function privateRow(row: SynchronizedRow): (string | number | boolean | null)[] {
  return [row.timestampUtc, row.endUtc, row.dateNy, row.slotNy, row.hourBlock,
    ...SYMBOLS.flatMap(symbol => {
      const feature = row.symbols[symbol], bar = feature.bar;
      return [bar?.open ?? null, bar?.high ?? null, bar?.low ?? null,
        bar?.close ?? null, bar?.volume ?? null, feature.candleReturnPercent,
        feature.fourBarReturnPercent, feature.sessionReturnPercent,
        feature.relativeVolume, feature.distancePreviousClosePercent,
        feature.availableAtUtc, feature.fourStartUtc, feature.sessionOpenUtc,
        feature.previousCloseUtc, feature.volumeReferenceLastDate,
        feature.volumeReferenceCount];
    }), row.completeThree, row.nvdaMinusQqqCandlePercent,
    row.nvdaMinusSmhCandlePercent, row.nvdaMinusQqqFourPercent,
    row.nvdaMinusSmhFourPercent, row.directionAgreement,
    row.knownEventIds.join(';'), JSON.stringify(row.minutesSinceEvents),
    row.dateOnlyEventIds.join(';'), row.eventBeforeOpen, row.eventDuringSession,
    row.postEarningsFromPriorClose];
}
const privateRows = synced.rows.map(privateRow);
const privatePath = join(privateOutput, 'phase14-synchronized-bars-full.csv');
writeFileSync(privatePath, csvDocument(privateHeader, privateRows));

// Raw SIP OHLCV and per-bar returns remain local: provider redistribution permission was not verified.
const publicHeader = ['timestamp_utc', 'end_utc', 'date_ny', 'slot_ny', 'hour_block',
  ...SYMBOLS.flatMap(symbol => [`${symbol}_present`, `${symbol}_candle_return_available`,
    `${symbol}_four_return_available`, `${symbol}_session_return_available`,
    `${symbol}_volume_reference_available`, `${symbol}_previous_close_available`,
    `${symbol}_four_start_utc`, `${symbol}_session_open_utc`,
    `${symbol}_previous_close_utc`, `${symbol}_volume_reference_last_date`]),
  'complete_three',
  'known_event_ids', 'minutes_since_events', 'date_only_event_ids',
  'event_before_open', 'event_during_session', 'post_earnings_from_prior_close',
  'private_row_sha256'];
const publicRows = synced.rows.map((row, index) => [row.timestampUtc, row.endUtc,
  row.dateNy, row.slotNy, row.hourBlock,
  ...SYMBOLS.flatMap(symbol => {
    const feature = row.symbols[symbol];
    return [feature.bar !== null, feature.candleReturnPercent !== null,
      feature.fourBarReturnPercent !== null, feature.sessionReturnPercent !== null,
      feature.relativeVolume !== null, feature.distancePreviousClosePercent !== null,
      feature.fourStartUtc, feature.sessionOpenUtc, feature.previousCloseUtc,
      feature.volumeReferenceLastDate];
  }), row.completeThree,
  row.knownEventIds.join(';'), JSON.stringify(row.minutesSinceEvents),
  row.dateOnlyEventIds.join(';'), row.eventBeforeOpen, row.eventDuringSession,
  row.postEarningsFromPriorClose, sha256(csv(privateRows[index]!))]);
writeFileSync(join(output, 'phase14-synchronized-bars.csv'),
  csvDocument(publicHeader, publicRows));

const signalHeader = ['signal_id', 'source_phase', 'family', 'direction', 'source_index',
  'bar_start_utc', 'available_at_utc', 'date_ny', 'regime_phase13',
  'original_h30_signed_percent', 'original_h30_exclusion_reason',
  'qqq_present', 'qqq_candle_return_pct', 'qqq_four_return_pct',
  'qqq_session_return_pct', 'qqq_relative_volume', 'qqq_distance_previous_close_pct',
  'smh_present', 'smh_candle_return_pct', 'smh_four_return_pct',
  'smh_session_return_pct', 'smh_relative_volume', 'smh_distance_previous_close_pct',
  'nvda_minus_qqq_candle_pct', 'nvda_minus_smh_candle_pct',
  'nvda_minus_qqq_four_pct', 'nvda_minus_smh_four_pct', 'direction_agreement',
  'known_event_ids', 'minutes_since_events', 'date_only_event_ids',
  'market_available_at_utc'];
const signalRows = phase13.study.events.map(signal => {
  const row = byStart.get(signal.barStartUtc)!;
  const q = row.symbols.QQQ, s = row.symbols.SMH;
  return [signal.id, signal.sourcePhase, signal.family, signal.direction,
    signal.index, signal.barStartUtc, signal.availableAtUtc, signal.dateNy,
    signal.regime, signal.originalHorizons['30']!.value,
    signal.originalHorizons['30']!.reason,
    q.bar !== null, q.candleReturnPercent, q.fourBarReturnPercent,
    q.sessionReturnPercent, q.relativeVolume, q.distancePreviousClosePercent,
    s.bar !== null, s.candleReturnPercent, s.fourBarReturnPercent,
    s.sessionReturnPercent, s.relativeVolume, s.distancePreviousClosePercent,
    row.nvdaMinusQqqCandlePercent, row.nvdaMinusSmhCandlePercent,
    row.nvdaMinusQqqFourPercent, row.nvdaMinusSmhFourPercent,
    row.directionAgreement, row.knownEventIds.join(';'),
    JSON.stringify(row.minutesSinceEvents), row.dateOnlyEventIds.join(';'),
    row.availableAtUtc];
});
writeFileSync(join(output, 'phase14-signal-context.csv'),
  csvDocument(signalHeader, signalRows));

function stats(values: number[]): {count: number; mean: number | null; sd: number | null;
  p10: number | null; p50: number | null; p90: number | null} {
  if (!values.length) return {count: 0, mean: null, sd: null, p10: null, p50: null, p90: null};
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const rank = (p: number) => sorted[Math.ceil(sorted.length * p / 100) - 1]!;
  const sd = values.length > 1 ? Math.sqrt(values.reduce((sum, value) =>
    sum + (value - mean) ** 2, 0) / (values.length - 1)) : null;
  return {count: values.length, mean, sd, p10: rank(10), p50: rank(50), p90: rank(90)};
}
const verifiedEventDates = new Set([...events.economic, ...events.corporate]
  .filter(event => event.timestampUtc).map(event => event.dateNy));
type SummaryRow = {year: string; hourBlock: number | 'all'; eventSession: boolean;
  intervals: number; sessions: number; smallSample: boolean;
  candleReturnPercent: ReturnType<typeof stats>; intrabarRangePercent: ReturnType<typeof stats>};
function summarize(selected: SynchronizedRow[], year: string,
  hourBlock: number | 'all', eventSession: boolean): SummaryRow {
  const valid = selected.filter(row => row.symbols.NVDA.bar !== null);
  return {year, hourBlock, eventSession, intervals: valid.length,
    sessions: new Set(valid.map(row => row.dateNy)).size,
    smallSample: valid.length < 30 || new Set(valid.map(row => row.dateNy)).size < 10,
    candleReturnPercent: stats(valid.map(row => row.symbols.NVDA.candleReturnPercent!)),
    intrabarRangePercent: stats(valid.map(row => {
      const bar = row.symbols.NVDA.bar!;
      return 100 * (bar.high - bar.low) / bar.open;
    }))};
}
const years = [...new Set(synced.rows.map(row => row.dateNy.slice(0, 4)))];
const summaryRows: SummaryRow[] = [];
for (const year of ['all', ...years]) {
  for (const hour of ['all', 0, 1, 2, 3, 4, 5, 6] as const) {
    for (const eventSession of [false, true]) {
      summaryRows.push(summarize(synced.rows.filter(row =>
        (year === 'all' || row.dateNy.startsWith(year)) &&
        (hour === 'all' || row.hourBlock === hour) &&
        verifiedEventDates.has(row.dateNy) === eventSession), year, hour, eventSession));
    }
  }
}
const allEvents = [...events.economic, ...events.corporate];
const eventCounts = Object.fromEntries([...new Set(allEvents.map(event => event.category))].map(category =>
  [category, Object.fromEntries(years.map(year => [year,
    allEvents.filter(event => event.category === category && event.dateNy.startsWith(year)).length]))]));
const largestAdjacentSessionGap = Object.fromEntries(SYMBOLS.map(symbol => {
  let largest: {fromDate: string; toDate: string; percent: number} | null = null;
  for (let index = 1; index < candles[symbol].length; index++) {
    const before = candles[symbol][index - 1]!, current = candles[symbol][index]!;
    const priorDate = byStart.get(before.timestamp)?.dateNy;
    const currentDate = byStart.get(current.timestamp)?.dateNy;
    if (!priorDate || !currentDate || priorDate === currentDate) continue;
    const percent = 100 * (current.open / before.close - 1);
    if (!largest || Math.abs(percent) > Math.abs(largest.percent)) {
      largest = {fromDate: priorDate, toDate: currentDate, percent};
    }
  }
  return [symbol, largest];
}));
const audit = {protocol: 'docs/phase14-data-protocol.md', protocolCommit:
  'e10d01c4ba6011dd7ea6e183be83a283a469dc47', codeVersion,
  sourceHashes: inputHashes, originalArtifactHashes: originals,
  corporateActionAudit: {requestedAdjustment: 'split',
    metadataConfirmedForAllSymbols: true, largestAdjacentSessionGap,
    note: 'Control de discontinuidad de apertura entre sesiones; no certifica cada acción corporativa del proveedor.'},
  calendarSessions: calendar.size, market: synced.audit,
  featureAvailability: Object.fromEntries(SYMBOLS.map(symbol => [symbol, {
    candleReturn: synced.rows.filter(row => row.symbols[symbol].candleReturnPercent !== null).length,
    fourReturn: synced.rows.filter(row => row.symbols[symbol].fourBarReturnPercent !== null).length,
    sessionReturn: synced.rows.filter(row => row.symbols[symbol].sessionReturnPercent !== null).length,
    relativeVolume: synced.rows.filter(row => row.symbols[symbol].relativeVolume !== null).length,
    previousCloseDistance: synced.rows.filter(row =>
      row.symbols[symbol].distancePreviousClosePercent !== null).length,
  }])),
  economicEvents: events.economic.length, corporateEvents: events.corporate.length,
  eventsWithVerifiedTime: allEvents.filter(event => event.timestampUtc).length,
  eventsWithoutVerifiedTime: allEvents.filter(event => !event.timestampUtc).length,
  historicalConsensusCount: allEvents.filter(event => event.consensus !== null).length,
  historicalSurpriseCount: allEvents.filter(event => event.surprise !== null).length,
  eventCountsByCategoryYear: eventCounts, missingCorporatePages: events.missingCorporatePages,
  signalCount: phase13.study.events.length,
  signalContextCompleteThree: phase13.study.events.filter(signal =>
    byStart.get(signal.barStartUtc)!.completeThree).length,
  distributions: summaryRows,
  localPrivateFullCsvSha256: sha256(readFileSync(privatePath)),
  publicSynchronizedRedacted: true};
writeFileSync(join(output, 'phase14-data-audit.json'), JSON.stringify(audit, null, 2) + '\n');

const manifest = {protocol: audit.protocol, protocolCommit: audit.protocolCommit,
  codeVersion, createdAtUtc: new Date().toISOString(),
  alpaca: {endpoint: 'https://data.alpaca.markets/v2/stocks/bars',
    termsUrl: 'https://s3.amazonaws.com/files.alpaca.markets/disclosures/library/TermsAndConditions.pdf',
    termsCheckedAtUtc: new Date().toISOString(),
    termsSection: 'Personal and Non-Commercial Usage',
    termsFinding: 'Personal/non-commercial use; advance written notice for making Content available through a User Application. No SIP redistribution grant verified.',
    redistributionPermissionVerified: false,
    disposition: 'CSV fuente y tabla íntegra de OHLCV solo locales; Git publica cobertura y datos derivados no OHLCV',
    symbols: Object.fromEntries(SYMBOLS.map(symbol => [symbol, {
      filename: basename(inputPaths[symbol]), hashes: inputHashes[symbol],
      feed: 'sip', timeframe: '15Min', adjustment: 'split', session: 'regular'}]))},
  publicSources: events.sources, optionalConsensus: {status: 'no verified historical source integrated',
    coveredEvents: 0, totalEvents: allEvents.length},
  corporateTime: {status: 'NVIDIA original pages verify date, not exact release time',
    causalIntradayCoverage: 0}, previousStudies: originals};
writeFileSync(join(output, 'phase14-source-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const n = (value: number | null, digits = 3) => value === null ? 'N/D' : value.toFixed(digits);
const table = (heads: string[], rows: string[][]) => [
  '| ' + heads.join(' | ') + ' |', '|' + heads.map(() => '---').join('|') + '|',
  ...rows.map(row => '| ' + row.join(' | ') + ' |')];
const overall = summaryRows.filter(row => row.year === 'all' && row.hourBlock === 'all');
const annual = summaryRows.filter(row => row.year !== 'all' && row.hourBlock === 'all');
const hourly = summaryRows.filter(row => row.year === 'all' && row.hourBlock !== 'all');
const summaryTable = (rows: SummaryRow[]) => table(
  ['Año', 'Bloque', 'Sesión con evento verificado', 'Velas NVDA', 'Sesiones',
    'Muestra pequeña', 'Retorno vela medio %', 'P10/P50/P90 retorno %',
    'Rango intravela medio %', 'P10/P50/P90 rango %'], rows.map(row => [
    row.year, String(row.hourBlock), row.eventSession ? 'sí' : 'no',
    String(row.intervals), String(row.sessions), row.smallSample ? 'sí' : 'no',
    n(row.candleReturnPercent.mean), [row.candleReturnPercent.p10,
      row.candleReturnPercent.p50, row.candleReturnPercent.p90].map(x => n(x)).join(' / '),
    n(row.intrabarRangePercent.mean), [row.intrabarRangePercent.p10,
      row.intrabarRangePercent.p50, row.intrabarRangePercent.p90].map(x => n(x)).join(' / ')]));
const report = [
  '# Fase 14: contexto de mercado y eventos de NVDA', '',
  '**Adquisición, sincronización y auditoría descriptiva.** No se formuló ninguna estrategia ni se evaluó ventaja operativa. Todo 2021–2026 es historial ya disponible; las diferencias entre sesiones con y sin eventos no son efectos causales.', '',
  `Protocolo fijado antes de adquirir datos: \`${audit.protocol}\` (commit \`${audit.protocolCommit}\`). Código usado: \`${codeVersion}\`.`,
  `CSV NVDA original SHA-256: \`${inputHashes.NVDA.csv}\`. QQQ: \`${inputHashes.QQQ.csv}\`; SMH: \`${inputHashes.SMH.csv}\`.`,
  `Los JSON de Fases 11, 12 y 13 conservan hashes ${originals.phase11}, ${originals.phase12} y ${originals.phase13}.`, '',
  '## Información nueva y cobertura', '',
  `Se adquirieron ${candles.QQQ.length} velas QQQ y ${candles.SMH.length} velas SMH de Alpaca SIP, 15Min, ajuste split y sesión regular. NVDA aporta ${candles.NVDA.length}. El calendario original contiene ${calendar.size} sesiones programadas, incluidos cierres anticipados. Hay ${synced.audit.completeThree}/${synced.audit.scheduled} intervalos con los tres símbolos completos (${n(100 * synced.audit.completeThree / synced.audit.scheduled, 2)}%).`,
  `Sesiones completas NVDA/QQQ/SMH: ${SYMBOLS.map(s => `${s} ${synced.audit.completeSessions[s]}`).join(', ')}; parciales ${SYMBOLS.map(s => `${s} ${synced.audit.partialSessions[s]}`).join(', ')}; ausentes ${SYMBOLS.map(s => `${s} ${synced.audit.absentSessions[s]}`).join(', ')}. No se rellenaron huecos ni se desplazaron velas.`,
  `Las tres series declaran \`adjustment=split\`. Como control descriptivo de discontinuidad, el mayor salto entre cierre regular y siguiente apertura fue ${SYMBOLS.map(s => {
    const gap = largestAdjacentSessionGap[s] as {fromDate: string; toDate: string; percent: number} | null;
    return `${s} ${gap ? `${n(gap.percent)}% (${gap.fromDate}→${gap.toDate})` : 'N/D'}`;
  }).join('; ')}. Esta comprobación no certifica individualmente cada acción corporativa de Alpaca.`,
  `Variables completas de cuatro velas y volumen comparable (NVDA/QQQ/SMH): ${SYMBOLS.map(s => `${s} ${audit.featureAvailability[s]!.fourReturn}/${audit.featureAvailability[s]!.relativeVolume}`).join(', ')} intervalos; las referencias iniciales y los cierres anticipados reducen cobertura sin rellenar datos.`,
  `Calendario oficial: ${events.economic.length} eventos económicos (${events.economic.filter(e => e.category === 'CPI').length} CPI, ${events.economic.filter(e => e.category === 'EMPLOYMENT_SITUATION').length} Employment Situation, ${events.economic.filter(e => e.category === 'FOMC').length} piezas FOMC) y ${events.corporate.length} anuncios originales de resultados NVIDIA. Hora exacta verificada: ${audit.eventsWithVerifiedTime}/${allEvents.length}; sin hora verificable: ${audit.eventsWithoutVerifiedTime}. Días con múltiples registros: ${synced.audit.simultaneousEventDays}.`,
  ...table(['Categoría', ...years, 'Hora verificada / total'],
    [...new Set(allEvents.map(event => event.category))].map(category => [category,
      ...years.map(year => String(allEvents.filter(event =>
        event.category === category && event.dateNy.startsWith(year)).length)),
      `${allEvents.filter(event => event.category === category && event.timestampUtc).length}/${allEvents.filter(event => event.category === category).length}`])),
  `Las ${phase13.study.events.length} señales originales de Fases 11–12 quedaron enlazadas a su intervalo exacto y régimen de Fase 13; ${audit.signalContextCompleteThree} tienen las tres velas presentes. Los retornos originales de 30 minutos se copiaron sin recalcular.`, '',
  '## Descripción de mercado: sesiones con y sin publicación verificada', '',
  ...summaryTable(overall), '',
  'La etiqueta de sesión con evento incluye velas anteriores al instante de publicación; sirve solo para descripción de sesión. La tabla sincronizada causal marca noticias conocidas únicamente cuando su timestamp es anterior al cierre de la vela. Rango intravela = 100 × (high−low)/open; no es un resultado de operación.', '',
  '### Por año', '', ...summaryTable(annual), '',
  '### Por bloque horario desde 09:30 NY', '', ...summaryTable(hourly), '',
  'Los estratos año × bloque horario están completos en `phase14-data-audit.json`. Los grupos menores de 30 velas o 10 sesiones se marcan como muestra pequeña. La comparación no controla sorpresas, dirección del anuncio, régimen ni cambios estructurales; no atribuye causalidad.', '',
  '## Disponibilidad de noticias y límites', '',
  'BLS publica calendario con horas Eastern verificables para CPI y Employment Situation. El comunicado FOMC usa la hora explícita de su propia página; las actas usan la fecha de publicación y la hora cuando figura en la página de conferencia vinculada. Las conferencias sin hora comprobable se conservan con fecha sola. Los comunicados originales de resultados de NVIDIA verifican la fecha, pero no la hora exacta de salida: los 20 quedan sin emparejamiento causal intradía ni marca inferida de reacción posterior. La hora de una conferencia no se reemplaza por la del resultado.',
  'Los calendarios archivados pueden reflejar correcciones posteriores; se conserva URL y hash de cada página consultada, pero no se afirma que toda hora programada se conociera con la misma anticipación. Solo se cubren estas categorías; otras noticias relevantes no aparecen. El calendario BLS no lista una publicación CPI para cada mes del período y no se inventaron entradas faltantes.',
  `Consensos históricos verificables: ${audit.historicalConsensusCount}/${allEvents.length}; sorpresas calculadas: ${audit.historicalSurpriseCount}. No se usaron cifras actuales o revisadas para rellenar expectativas antiguas.`,
  'Para datos de sesión regular, una publicación anterior a la apertura solo puede relacionarse con velas posteriores a 09:30; no se afirma conocer la trayectoria premarket. Una noticia a la hora exacta del cierre de una vela queda disponible desde la vela siguiente por prudencia. QQQ y SMH incluyen exposición a NVDA; diferencias de retornos no miden fuerza independiente.', '',
  '## Permisos de datos y reproducción', '',
  'Los términos públicos de Alpaca indican uso personal/no comercial y requieren aviso previo para ofrecer contenido a terceros; no se verificó permiso específico de redistribución de SIP. Por ello **los CSV originales QQQ/SMH y la tabla íntegra con OHLCV permanecen locales**. `phase14-synchronized-bars.csv` publica una fila por intervalo, marcas de cobertura/evento y un hash de cada fila privada, sin precios ni volúmenes. El CSV privado completo queda en `output/real/phase14-synchronized-bars-full.csv` con SHA-256 indicado en la auditoría. `phase14-signal-context.csv` contiene variables porcentuales derivadas solo en las señales seleccionadas, sin OHLCV original. Las fuentes oficiales y sus hashes están en el manifiesto.',
  'Para reconstruir, colocar en `data/` los tres historiales SIP con sus sidecars de hashes indicados, ejecutar `npm ci` y `npm run validate:phase14-context`. QQQ/SMH pueden adquirirse de nuevo con `NODE_USE_ENV_PROXY=1 npm run import:phase14-market` usando acceso Alpaca autorizado; el importador reutiliza fragmentos válidos y no sobrescribe archivos finales.', '',
  '## Conclusión', '',
  'Ahora existen barras sincronizadas completas de tres símbolos, calendario oficial macroeconómico y fechas originales de resultados NVIDIA, además de una unión exacta con señales previas. Faltan horas originales verificadas de resultados, consenso económico histórico y autorización de redistribución SIP. Estos datos permiten **formular** estudios futuros sobre mercado amplio, semiconductores y horarios de noticias con reglas nuevas y datos posteriores; aquí no se descubre ni declara una estrategia rentable.', '',
].join('\n');
writeFileSync(join(output, 'phase14-report.md'), report);
const readme = [
  '# Artefactos de Fase 14', '',
  'Protocolo: [docs/phase14-data-protocol.md](../../docs/phase14-data-protocol.md).',
  `Código usado: \`${codeVersion}\`. SHA-256 NVDA fuente: \`${inputHashes.NVDA.csv}\`.`, '',
  '- `phase14-report.md`: informe y limitaciones en español.',
  '- `phase14-data-audit.json`: cobertura, distribución por año/horario, eventos y hashes.',
  '- `phase14-synchronized-bars.csv`: una fila por intervalo, marcas de cobertura/evento y hash de la fila privada; OHLCV retenido localmente por permisos SIP no verificados.',
  '- `phase14-economic-events.csv`: cada CPI, Employment Situation y pieza FOMC con fecha, hora verificada si existe y fuente.',
  '- `phase14-nvda-corporate-events.csv`: fechas verificadas de resultados NVIDIA, sin hora inventada.',
  '- `phase14-signal-context.csv`: señales F11/F12 originales con régimen F13, variables porcentuales de QQQ/SMH y eventos conocidos.',
  '- `phase14-source-manifest.json`: URLs, fechas de consulta, hashes y condición de redistribución.',
  '- `SHA256SUMS.txt`: hashes de los siete archivos anteriores y este README; el manifiesto no se incluye a sí mismo.', '',
  'Reproducción desde `trading_poc_001_bollinger/`, con los tres CSV SIP y sidecars privados cuyos hashes figuran en el manifiesto:', '',
  '```bash', 'npm ci', 'npm run typecheck', 'npm test', 'NODE_USE_ENV_PROXY=1 npm run validate:phase14-context', '```', '',
  'Si faltan QQQ/SMH y se cuenta con acceso Alpaca autorizado, ejecutar primero `NODE_USE_ENV_PROXY=1 npm run import:phase14-market`. No se vuelve a descargar NVDA. El comando de validación escribe también `output/real/phase14-synchronized-bars-full.csv`, privado, con OHLCV y todas las variables por intervalo.', '',
  'El período es exploratorio y las noticias sin hora verificable no se atribuyen causalmente a velas intradía.', '',
].join('\n');
writeFileSync(join(output, 'README.md'), readme);
const delivered = ['README.md', 'phase14-data-audit.json', 'phase14-economic-events.csv',
  'phase14-nvda-corporate-events.csv', 'phase14-report.md',
  'phase14-signal-context.csv', 'phase14-source-manifest.json',
  'phase14-synchronized-bars.csv'];
writeFileSync(join(output, 'SHA256SUMS.txt'), delivered.map(name =>
  `${sha256(readFileSync(join(output, name)))}  ${name}`).join('\n') + '\n');
console.log(`Fase 14: ${synced.audit.completeThree}/${synced.audit.scheduled} intervalos ` +
  `sincronizados; ${events.economic.length} eventos macro; ${events.corporate.length} ` +
  `resultados NVIDIA; ${phase13.study.events.length} señales enlazadas.`);
