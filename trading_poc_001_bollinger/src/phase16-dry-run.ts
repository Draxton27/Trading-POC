import {strict as assert} from 'node:assert';
import {execFileSync} from 'node:child_process';
import {cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadMarketCalendar} from './alpaca-calendar.ts';
import {parseCandlesCsv} from './csv.ts';
import type {Candle} from './domain.ts';
import {metadataFor, PHASE14_NVDA_SHA256, sha256, symbolPath} from './phase14-import.ts';
import {appendRecord, FORWARD_START, HUMAN_TEMPLATE_COLUMNS, sha256 as hash,
  verifyLedger} from './phase16-ledger.ts';
import {barId, detectAt, settleSignal, type BarReceipt,
  type ForwardSignal, type Symbol} from './phase16-engine.ts';

const project = fileURLToPath(new URL('../', import.meta.url));
const repo = fileURLToPath(new URL('../../', import.meta.url));
const output = join(repo, 'shared-artifacts/phase16-forward-observation');
mkdirSync(output, {recursive: true});
const source = join(project, 'data/NVDA_ALPACA_SIP_15min_20211017_20261017.csv');
const calendar = loadMarketCalendar(source + '.calendar.json');
const originals = {NVDA: source, QQQ: symbolPath(join(project, 'data'), 'QQQ'),
  SMH: symbolPath(join(project, 'data'), 'SMH')};
const expected = {NVDA: PHASE14_NVDA_SHA256,
  QQQ: '962696cb57499ecf0991b1915975f5fe5725e7df7185654bfa4a2f71775eb2fb',
  SMH: 'd517e4652e9f4e44c715b5580dd4fa6d303b0a9f3246169027d142b2aac0cb55'};
const sourceHashes = {} as Record<Symbol, string>;
const bars = {} as Record<Symbol, Candle[]>;
for (const symbol of ['NVDA','QQQ','SMH'] as Symbol[]) {
  const raw = readFileSync(originals[symbol]);
  sourceHashes[symbol] = sha256(raw);
  assert.equal(sourceHashes[symbol], expected[symbol]);
  bars[symbol] = parseCandlesCsv(raw.toString('utf8'),
    symbol === 'NVDA' ? {...metadataFor('QQQ'), asset: 'NVDA'} : metadataFor(symbol),
    {allowIntradayGaps: symbol !== 'NVDA'});
}
const historical = JSON.parse(readFileSync(join(project,
  'output/real/nvda-volatility-regimes.json'), 'utf8')) as {
  study: {events: Array<{id: string; family: string; direction: string; index: number;
    originalHorizons: Record<string, {value: number | null}>}>}};
assert.equal(hash(readFileSync(join(project, 'output/real/nvda-volatility-regimes.json'))),
  '45f15df045e7210651745919bbd7f22a9eb88cc199638a1a9c606a7ade40c0e7');
const first = new Map<string, typeof historical.study.events[number]>();
for (const signal of historical.study.events) if (!first.has(signal.family)) first.set(signal.family, signal);
assert.equal(first.size, 6);
const codeVersion = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repo, encoding: 'utf8'}).trim();
const detectorFiles = ['nvda-pullback-breakout.ts','nvda-failed-breakouts.ts','nvda-volatility.ts',
  'phase15-analysis.ts','phase16-engine.ts'];
const detectorHash = hash(detectorFiles.map(name =>
  hash(readFileSync(join(project, 'src', name)))).join('|'));
const dryLedger = join(mkdtempSync(join(tmpdir(), 'phase16-dry-run-')), 'ledger');
const observed: ForwardSignal[] = [];
const settled: Array<{signal: ForwardSignal; horizon: string; result: Record<string, unknown>}> = [];
const dryAt = new Date().toISOString();
for (const sample of first.values()) {
  const candle = bars.NVDA[sample.index]!;
  const receipts = new Map<string, BarReceipt>();
  for (const symbol of ['NVDA','QQQ','SMH'] as Symbol[]) {
    const same = bars[symbol].findIndex(c => c.timestamp === candle.timestamp);
    if (same < 0) continue;
    for (const item of bars[symbol].slice(Math.max(0, same - 3), same + 1)) {
      receipts.set(barId(symbol, item.timestamp), {symbol, candle: item,
        receivedAtUtc: dryAt, provider: 'Alpaca Market Data API',
        feed: 'sip', adjustment: 'split', status: 'recovered', inputSha256: hash(JSON.stringify(item))});
    }
  }
  const detected = detectAt({nvdaPrefix: bars.NVDA.slice(0, sample.index + 1),
    qqq: bars.QQQ, smh: bars.SMH, calendar, receipts,
    generatedAtUtc: dryAt, codeVersion, detectorHash, events: null,
    priorSignals: observed, historical: true, recoveryReason: null});
  const signal = detected.find(item => item.id === sample.id);
  assert.ok(signal, `Detector congelado no reprodujo ${sample.id}`);
  assert.equal(signal.family, sample.family);
  assert.equal(signal.observability, 'historical_reconstruction');
  appendRecord(dryLedger, `signal:${signal.id}`, 'signal',
    signal as unknown as Record<string, unknown>, dryAt);
  observed.push(signal);
  const outcome = settleSignal(signal, bars.NVDA, calendar, dryAt);
  const h30 = outcome.horizons['30'] as {value: number | null};
  assert.ok(h30.value === sample.originalHorizons['30'].value ||
    h30.value !== null && sample.originalHorizons['30'].value !== null &&
    Math.abs(h30.value - sample.originalHorizons['30'].value) < 1e-10,
  `Resultado histórico 30m cambió: ${sample.id}`);
  for (const [horizon, result] of Object.entries(outcome.horizons)) {
    appendRecord(dryLedger, `settlement:${signal.id}:${horizon}`, 'settlement',
      {signalId: signal.id, horizonMinutes: Number(horizon),
        ...result as Record<string, unknown>}, dryAt);
    settled.push({signal, horizon, result: result as Record<string, unknown>});
  }
}
const ledger = verifyLedger(dryLedger);
assert.equal(ledger.length, observed.length + settled.length);
const csv = (values: unknown[]) => values.map(v => v === null || v === undefined ? '' :
  String(v).includes(',') ? `"${String(v).replaceAll('"','""')}"` : String(v)).join(',');
writeFileSync(join(output, 'phase16-dry-run-signals.csv'),
  'run_type,signal_id,family,direction,bar_start_utc,confirmation_utc,test_generated_at_utc,primary_outcome_end_utc,first_detected_before_outcome,prospective_before_outcome,theoretical_entry_utc,execution_at_theoretical_open,observability,market_group,regime,qqq_four_pct,smh_four_pct,prediction_state,record_hash\n' +
  observed.map(s => csv(['dry_run',s.id,s.family,s.direction,s.barStartUtc,s.availableAtUtc,
    dryAt,s.primaryOutcomeEndUtc,s.firstDetectedBeforePrimaryOutcome,
    s.prospectiveBeforePrimaryOutcome,s.nextEntryOpenUtc,s.executionAtTheoreticalOpen,
    s.observability,s.marketGroup,s.regime,s.qqqFourReturnPercent,s.smhFourReturnPercent,
    s.result,ledger.find(r => r.id === `signal:${s.id}`)!.hash])).join('\n') + '\n');
writeFileSync(join(output, 'phase16-dry-run-settlements.csv'),
  'run_type,signal_id,horizon_minutes,state,reason,signed_return_pct,mfe_pct,mae_pct,operationally_available,execution_at_theoretical_open,record_hash\n' +
  settled.map(item => csv(['dry_run',item.signal.id,item.horizon,item.result.state,
    item.result.reason ?? null,item.result.value ?? null,item.result.mfePercent ?? null,
    item.result.maePercent ?? null,false,item.signal.executionAtTheoreticalOpen,
    ledger.find(r => r.id === `settlement:${item.signal.id}:${item.horizon}`)!.hash])).join('\n') + '\n');
cpSync(join(repo, 'docs/phase16-forward-protocol.md'), join(output, 'phase16-protocol.md'));
writeFileSync(join(output, 'phase16-operator-journal-template.csv'),
  HUMAN_TEMPLATE_COLUMNS.join(',') + '\n');
const accessAudit = {
  checkedAtUtc: '2026-10-18T15:12:42.277Z', marketState: 'closed_sunday',
  requestedProvider: 'Alpaca Market Data API', requestedFeed: 'sip',
  credentials: 'injected environment bindings; values never recorded',
  probes: [
    {capability: 'sip_real_time', endpoint: 'NVDA snapshot feed=sip', httpStatus: 403,
      requestStartedAtUtc: '2026-10-18T15:12:41.811Z', conclusion: 'unavailable_for_this_endpoint'},
    {capability: 'iex_real_time', endpoint: 'NVDA snapshot feed=iex', httpStatus: 200,
      requestStartedAtUtc: '2026-10-18T15:12:42.054Z', latestTradeUtc: '2026-10-16T19:59:59.999827568Z',
      conclusion: 'endpoint_accessible_but_live_latency_unverified_on_closed_market'},
    {capability: 'sip_historical_after_close', endpoint: 'NVDA 15Min bars feed=sip adjustment=split',
      httpStatus: 200, requestStartedAtUtc: '2026-10-18T15:12:42.277Z',
      latestBarUtc: '2026-10-16T19:45:00Z', bars: 2, conclusion: 'available'},
    {capability: 'sip_delayed_15_minutes', endpoint: 'intraday SIP bars', httpStatus: null,
      conclusion: 'not_measurable_while_market_closed; delayed_collection_mode_required'},
  ],
  probeResponseReceiptTimestampCaptured: false,
  operatingMode: 'sip_delayed_collection', iexFallback: false,
  liveSignalOperability: 'unknown_until_in_session_receipt_audit; late arrivals marked non_executable',
};
writeFileSync(join(output, 'phase16-data-access-audit.json'), JSON.stringify(accessAudit, null, 2) + '\n');
const reproducibility = {protocolCommit: '3afe2424e9f452faf6c79d9cca073f6366538221',
  codeVersion, detectorHash, prospectStartUtc: FORWARD_START,
  dryRunType: 'historical_reconstruction_not_prospective', dryRunAtUtc: dryAt,
  sixFamilies: [...first.keys()], dryRunSignalCount: observed.length,
  dryRunSettlementCount: settled.length, dryRunLedgerRecords: ledger.length,
  dryRunLedgerLastHash: ledger.at(-1)!.hash,
  sourceHashes, phase13ArtifactSha256: hash(readFileSync(join(project,
    'output/real/nvda-volatility-regimes.json'))),
  protocolSha256: hash(readFileSync(join(output, 'phase16-protocol.md'))),
  feed: 'sip', timeframe: '15Min', adjustment: 'split',
  commands: ['npm run observe:phase16', 'npm run settle:phase16',
    'npm run journal:phase16 -- path/to/decision.json', 'npm run compare:phase16'],
  secretValuesRecorded: false};
writeFileSync(join(output, 'phase16-reproducibility.json'), JSON.stringify(reproducibility, null, 2) + '\n');
writeFileSync(join(output, 'phase16-system-report.md'), `# Fase 16 — infraestructura de observación prospectiva\n\n`+
`El protocolo se congeló en el commit \`3afe2424e9f452faf6c79d9cca073f6366538221\`, con inicio \`${FORWARD_START}\`. A la fecha de la prueba seca no existe ninguna observación prospectiva. Las ${observed.length} señales y ${settled.length} evaluaciones de estos CSV se reconstruyeron con datos históricos exclusivamente para comprobar código e integridad; **no son evidencia prospectiva ni disponibilidad operativa**.\n\n`+
`## Funcionamiento\n\n\`observe:phase16\` solicita calendario real Alpaca y barras SIP split de NVDA, QQQ y SMH, registra recepción e integridad por barra, y ejecuta las reglas originales F11/F12 sobre prefijos causales. Cada señal se fija como \`pending\` antes de agregar desenlaces. La primera detección y su posición respecto al fin del horizonte principal se registran por separado. La apertura de la vela siguiente es una entrada teórica sin latencia, no un precio ejecutable demostrado. Los ETF tardíos producen entradas nuevas de contexto, sin editar la señal original. \`settle:phase16\` agrega evaluaciones separadas de 15, 30 y 60 minutos. Se conservan MFE, MAE y exclusiones. No existe código de órdenes.\n\n`+
`El diario derivado está en \`shared-artifacts/phase16-forward-observation/live/ledger/\` y es de solo adición, con hash encadenado, IDs estables, reintentos idempotentes y correcciones por entrada adicional. Las barras completas SIP se guardan en \`trading_poc_001_bollinger/output/phase16-private/\`, excluido de Git. **Tras cada ejecución real, el operador debe auditar y hacer commit/push del nuevo lote derivado a GitHub**; hasta entonces el archivo local no garantiza persistencia entre entornos. No hay programación automática.\n\n`+
`## Acceso y límites\n\nEl snapshot SIP dio HTTP 403, el snapshot IEX HTTP 200 y la consulta SIP histórica posterior al cierre HTTP 200 el domingo 2026-10-18. La latencia de un mercado abierto sigue sin medirse. El sistema solo solicita SIP; toda entrada en la apertura teórica se marca no demostrada como ejecutable, incluso si una señal se registra antes del desenlace. IEX no sustituye SIP. El calendario futuro de eventos económicos requiere un archivo verificado adicional; sin él se informa \`unavailable\`, nunca «sin noticias». La cuenta no se usó para órdenes.\n\n`+
`## Prueba manual\n\nLa ejecución seca confirmó un ejemplo histórico de cada una de las seis familias y reprodujo sus resultados originales a 30 minutos, fijando primero señales y luego evaluaciones en un diario temporal con ${ledger.length} registros y último hash \`${ledger.at(-1)!.hash}\`. Para la prueba real se necesitan credenciales Alpaca vigentes, reloj UTC correcto, red y persistencia GitHub tras la ejecución. Las primeras 60 sesiones registradas serán auditoría operativa; no se evaluó rentabilidad.\n`);
writeFileSync(join(output, 'README.md'), `# Fase 16: observación prospectiva\n\n`+
`Protocolo congelado: [phase16-protocol.md](phase16-protocol.md). Inicio: \`${FORWARD_START}\`. Los CSV dry-run son pruebas históricas, no observaciones nuevas.\n\n`+
`Archivos: \`phase16-system-report.md\` explica funcionamiento y límites; \`phase16-data-access-audit.json\` documenta permisos de feed; \`phase16-dry-run-signals.csv\` y \`phase16-dry-run-settlements.csv\` contienen la prueba de seis familias; \`phase16-operator-journal-template.csv\` solo tiene cabecera, sin decisiones ficticias; \`phase16-reproducibility.json\` fija hashes y versiones; \`phase16-pr21-corrections.md\` documenta esta revisión; \`phase16-session-simulation.json\` y \`phase16-session-simulation.csv\` presentan la prueba completa de 26 velas; \`phase16-validation-results.json\` resume las pruebas; \`SHA256SUMS.txt\` verifica todos los archivos del directorio.\n\n`+
`Instale con \`cd trading_poc_001_bollinger && npm ci\`. Reproduzca la simulación histórica de 26 velas con \`npm run simulate-session:phase16\`; sus retrasos del proveedor son inyectados. Ejecute manualmente \`npm run observe:phase16\` y después \`npm run settle:phase16\`. Para una decisión humana, copie la plantilla CSV, complete exactamente una fila y ejecute \`npm run journal:phase16 -- path/a/decision.csv\`; el sistema fija \`documentedAtUtc\` con el reloj de ejecución. Compare con \`npm run compare:phase16\`. Reintentar no duplica IDs; ante una interrupción, elimine solo un \`.write-lock\` huérfano tras comprobar que ningún proceso sigue activo y valide la cadena antes de reanudar.\n\n`+
`Revise cada lote nuevo en \`live/ledger/\` y haga commit/push manual de esos registros derivados a la rama autorizada. No incluya \`output/phase16-private/\` ni OHLCV SIP. Conserve el mismo checkout o restaure la última versión del diario desde GitHub antes de continuar. Las señales recibidas tarde siguen siendo hipotéticas. No se envían órdenes.\n`);
const files = readdirSync(output, {withFileTypes: true})
  .filter(item => item.isFile() && item.name !== 'SHA256SUMS.txt')
  .map(item => item.name).sort();
writeFileSync(join(output, 'SHA256SUMS.txt'), files.map(name =>
  `${hash(readFileSync(join(output, name)))}  ${name}`).join('\n') + '\n');
console.log(JSON.stringify({dryRunSignals: observed.length, dryRunSettlements: settled.length,
  ledgerRecords: ledger.length, codeVersion, ledgerLastHash: ledger.at(-1)!.hash}));
