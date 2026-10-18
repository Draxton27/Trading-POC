import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseCsvRows, csvCell} from '../src/phase17-csv.ts';
import {BROKER_COLUMNS, importBrokerExecutions} from '../src/phase17-broker.ts';
import {preserveChart} from '../src/phase17-charts.ts';
import {compareHumanToSignals, humanFromLedger,
  type ComparedHuman} from '../src/phase17-comparison.ts';
import {appendPhase17Decision, PHASE17_TEMPLATE_COLUMNS,
  parsePhase17DecisionCsv, validatePhase17Decision} from '../src/phase17-journal.ts';
import {parseOccSymbol} from '../src/phase17-occ.ts';
import {HUMAN_TEMPLATE_COLUMNS, verifyLedger, type HumanDecision} from '../src/phase16-ledger.ts';
import type {ForwardSignal} from '../src/phase16-engine.ts';

const at = '2026-10-19T14:05:00.000Z';
function decisionCsv(extra: Record<string, string> = {}, legacy = false) {
  const columns = legacy ? [...HUMAN_TEMPLATE_COLUMNS] : PHASE17_TEMPLATE_COLUMNS;
  const values: Record<string, string> = {symbol: 'NVDA', direction: 'bullish',
    operationType: 'pullback', timeframe: '15Min',
    decisionAtUtc: '2026-10-19T14:00:00.000Z',
    selectionReason: 'Vi una recuperación', observedMarket: 'true',
    recordMode: 'live', ...extra};
  return columns.join(',') + '\n' + columns.map(key => csvCell(values[key] ?? '')).join(',') + '\n';
}

test('CSV F16 sigue siendo aceptado y F17 registra texto sencillo antes del resultado', () => {
  const legacy = parsePhase17DecisionCsv(decisionCsv({}, true));
  assert.equal(legacy.extension.recordMode, 'live');
  const raw = decisionCsv({trendInterpretation: 'Sube, pero espero confirmación',
    reviewedTimeframes: '1d|1h|15Min', awaitedConfirmation: 'Que cierre sobre el piso',
    manualLevelsDescription: 'Piso dibujado a mano, aún sin precio exacto',
    manualLevelsJson: JSON.stringify([{kind: 'support', label: 'piso', lower: 100,
      upper: 101, drawnAtUtc: '2026-10-19T13:50:00.000Z'}])});
  const parsed = parsePhase17DecisionCsv(raw);
  const validated = validatePhase17Decision(parsed, at);
  assert.equal(validated.recordClass, 'live_before_primary_outcome');
  assert.deepEqual(parsed.extension.reviewedTimeframes, ['1d','1h','15Min']);
  assert.deepEqual(validated.manualLevelsKnownAtDecision, [true]);
  assert.equal(parsed.extension.manualLevels[0]!.kind, 'support');
});

test('campos incompletos, timestamp inválido y no_trade se distinguen', () => {
  assert.throws(() => parsePhase17DecisionCsv('symbol,direction\nNVDA,bullish\n'), /Cabecera/);
  assert.throws(() => parsePhase17DecisionCsv(decisionCsv({recordMode: ''})), /recordMode/);
  assert.throws(() => validatePhase17Decision(parsePhase17DecisionCsv(
    decisionCsv({decisionAtUtc: 'bad'})), at), /incompleta/);
  assert.throws(() => validatePhase17Decision(parsePhase17DecisionCsv(
    decisionCsv({decisionAtUtc: '2026-10-19T14:00:00'})), at), /UTC/);
  assert.throws(() => validatePhase17Decision(parsePhase17DecisionCsv(
    decisionCsv({chartCapturedAtUtc: '2026-10-19T13:59:00'})), at), /captura/);
  assert.throws(() => validatePhase17Decision(parsePhase17DecisionCsv(
    decisionCsv({decisionAtUtc: '2026-10-19T14:06:00.000Z'})), at), /incompleta|después/);
  const none = parsePhase17DecisionCsv(decisionCsv({direction: 'no_trade',
    operationType: 'no_trade', selectionReason: 'Hoy no veo entrada',
    observedMarket: 'true', rejectedSignalIds: 'signal-1'}));
  assert.equal(validatePhase17Decision(none, at).recordClass,
    'live_before_primary_outcome');
  assert.throws(() => validatePhase17Decision(parsePhase17DecisionCsv(
    decisionCsv({rejectedSignalIds: 'signal-1'})), at), /Rechazo explícito/);
});

test('reconstrucción y anotación posterior no se vuelven prospectivas por etiqueta', () => {
  assert.equal(validatePhase17Decision(parsePhase17DecisionCsv(decisionCsv({
    recordMode: 'historical_reconstruction'})), at).recordClass,
  'historical_reconstruction');
  assert.equal(validatePhase17Decision(parsePhase17DecisionCsv(decisionCsv({
    recordMode: 'post_outcome_annotation', relatedDecisionId: 'human17:prior'})), at)
    .recordClass, 'post_outcome_annotation');
  assert.equal(validatePhase17Decision(parsePhase17DecisionCsv(decisionCsv()),
    '2026-10-19T15:00:00.000Z').recordClass, 'post_outcome_annotation');
});

test('diario privado F17 conserva hash original e idempotencia append-only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'phase17-human-'));
  try {
    const raw = decisionCsv({chartCaptureId: 'chart_a',
      chartCapturedAtUtc: '2026-10-19T13:58:00.000Z',
      chartSha256: 'a'.repeat(64)});
    const first = appendPhase17Decision(dir, raw, at);
    const second = appendPhase17Decision(dir, raw, '2026-10-19T14:06:00.000Z');
    assert.equal(first.hash, second.hash);
    assert.equal(verifyLedger(dir).length, 1);
    assert.equal(first.payload.chartKnownAtDecision, true);
    assert.equal(first.payload.status, 'prospective');
    assert.equal(humanFromLedger(verifyLedger(dir)).length, 1);
    assert.throws(() => appendPhase17Decision(dir,
      decisionCsv({chartSha256: 'invalid'}), at), /Hash de captura/);
    assert.throws(() => appendPhase17Decision(dir,
      decisionCsv({recordMode: 'post_outcome_annotation',
        relatedDecisionId: 'human17:missing'}), at), /inexistente/);
    const annotation = appendPhase17Decision(dir,
      decisionCsv({recordMode: 'post_outcome_annotation',
        relatedDecisionId: first.id}), '2026-10-19T15:00:00.000Z');
    assert.equal(annotation.payload.recordClass, 'post_outcome_annotation');
    assert.equal(verifyLedger(dir).length, 2);
  } finally {rmSync(dir, {recursive: true, force: true});}
});

const contract = 'NVDA  261120C00150000';
const brokerHeader = BROKER_COLUMNS.join(',') + '\n';
function fill(id: string, side: string, time: string, qty: string,
  premium: string, commission: string, net = '') {
  return [id,'NVDA',contract,'CALL','150','2026-11-20',side,time,qty,
    premium,commission,net].join(',') + '\n';
}

test('OCC y fills parciales FIFO conservan primas, comisiones y pérdidas', () => {
  assert.deepEqual(parseOccSymbol(contract), {occSymbol: contract,
    underlyingSymbol: 'NVDA', optionType: 'CALL', strike: 150,
    expiration: '2026-11-20', multiplier: 100});
  const buy = fill('b1','BUY','2026-10-19T14:00:00.000Z','2','4','2');
  const csv = brokerHeader + buy + buy +
    fill('s1','SELL','2026-10-19T14:20:00.000Z','1','5','1','98') +
    fill('s2','SELL','2026-10-19T14:40:00.000Z','1','3','1','-102');
  const result = importBrokerExecutions(csv);
  assert.equal(result.executionCount, 3);
  assert.equal(result.identicalDuplicateCount, 1);
  assert.equal(result.closedTrades.length, 2);
  assert.equal(result.closedTrades[0]!.calculatedNet, 98);
  assert.equal(result.closedTrades[1]!.calculatedNet, -102);
  assert.equal(result.openLots.length, 0);
  assert.equal(result.closedTrades[1]!.brokerNetDifference, 0);
});

test('importador rechaza contratos contradictorios, ventas sin compra y duplicados alterados', () => {
  assert.throws(() => parseOccSymbol('NVDA  261332C00150000'), /Vencimiento/);
  assert.throws(() => importBrokerExecutions(brokerHeader +
    fill('s1','SELL','2026-10-19T14:00:00.000Z','1','5','1')),
  /Venta sin compra/);
  assert.throws(() => importBrokerExecutions(brokerHeader +
    fill('b1','BUY','2026-10-19T14:00:00.000Z','1','4','1') +
    fill('b1','BUY','2026-10-19T14:00:00.000Z','1','5','1')),
  /duplicado contradictorio/);
  assert.throws(() => importBrokerExecutions(brokerHeader.replace('occ_symbol', 'account_number')),
    /Cabecera/);
  assert.throws(() => importBrokerExecutions(brokerHeader +
    fill('b1','BUY','2026-10-19T14:00:00.000Z','1','4','1')
      .replace(',CALL,150,', ',PUT,150,')), /contradicen/);
  assert.throws(() => importBrokerExecutions(brokerHeader +
    fill('b1','BUY','2026-02-31T14:00:00.000Z','1','4','1')), /Timestamp/);
  assert.throws(() => importBrokerExecutions(brokerHeader +
    fill('b1','BUY','2026-10-19T14:00:00.000Z','1','4','1'),
  '2026-10-18T14:00:00.000Z'), /futuro/);
});

test('comisiones ausentes dejan neto sin calcular y no inventan cotizaciones', () => {
  const result = importBrokerExecutions(brokerHeader +
    fill('b1','BUY','2026-10-19T14:00:00.000Z','1','4','') +
    fill('s1','SELL','2026-10-19T14:20:00.000Z','1','5','','99'));
  assert.equal(result.closedTrades[0]!.grossResult, 100);
  assert.equal(result.closedTrades[0]!.calculatedNet, null);
  assert.equal(result.closedTrades[0]!.brokerReportedNet, 99);
  assert.ok(!JSON.stringify(result).includes('spread'));
});

test('captura original se conserva privada por hash, sin ruta fuente en manifiesto', () => {
  const dir = mkdtempSync(join(tmpdir(), 'phase17-chart-'));
  try {
    const source = join(dir, 'private-original.png');
    writeFileSync(source, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/sXcAAAAASUVORK5CYII=', 'base64'));
    const destination = join(dir, 'output');
    const saved = preserveChart(destination, source, 'chart_1',
      '2026-10-19T13:55:00.000Z', at);
    assert.equal(saved.capturedAtSource, 'operator_declared');
    assert.equal(saved.sha256.length, 64);
    assert.equal(readFileSync(join(destination, 'charts', saved.privateFileName))
      .equals(readFileSync(source)), true);
    assert.ok(!JSON.stringify(saved).includes('private-original.png'));
    assert.equal(preserveChart(destination, source, 'chart_1',
      '2026-10-19T13:55:00.000Z', at).sha256, saved.sha256);
    assert.throws(() => preserveChart(destination, source, 'chart_1',
      '2026-10-19T13:56:00.000Z', at), /ya existe/);
    assert.throws(() => preserveChart(destination, source, 'chart_2',
      '2026-10-19T13:56:00', at), /captura/);
  } finally {rmSync(dir, {recursive: true, force: true});}
});

test('comparación separa coincidencia, rechazo explícito y ausencia de cobertura sin futuro', () => {
  const signal = {id: 'system-1', family: 'pullback_bullish', direction: 'bullish',
    availableAtUtc: '2026-10-19T14:00:00.000Z',
    firstDetectedAtUtc: '2026-10-19T14:00:01.000Z',
    primaryOutcomeEndUtc: '2026-10-19T14:30:00.000Z',
    indicators: {hourSma20: 100}, regime: 'medium', marketGroup: 'missing',
    knownEventIds: [], result: 'pending'} as unknown as ForwardSignal;
  const base: HumanDecision = {symbol: 'NVDA', direction: 'bullish',
    operationType: 'pullback', timeframe: '15Min',
    decisionAtUtc: '2026-10-19T13:59:00.000Z', documentedAtUtc: at,
    sma20: null, sma40: null, sma100: null, sma200: null,
    plannedEntry: null, plannedInvalidation: null,
    exitCriterion: null, selectionReason: 'motivo', chartCaptureId: null,
    observedMarket: true, outcomeKnownAtUtc: null};
  const phase17 = parsePhase17DecisionCsv(decisionCsv()).extension;
  const human: ComparedHuman = {id: 'h1', recordClass: 'live_before_primary_outcome',
    decision: base, phase17};
  const both = compareHumanToSignals([signal], [human]);
  assert.equal(both[0]!.status, 'both');
  assert.equal(both[0]!.decisionView.signalContext, null);
  assert.ok(!JSON.stringify(both).includes('settlement'));
  assert.ok(!JSON.stringify(both).includes('horizons'));
  const early = {...human, decision: {...base,
    documentedAtUtc: '2026-10-19T13:59:30.000Z'}};
  assert.equal(compareHumanToSignals([signal], [early])[0]!.decisionView.signalContext, null);
  const rejected: ComparedHuman = {id: 'h2', recordClass: 'live_before_primary_outcome',
    decision: {...base, direction: 'no_trade', operationType: 'no_trade',
      decisionAtUtc: '2026-10-19T14:01:00.000Z'},
    phase17: {...phase17, rejectedSignalIds: ['system-1']}};
  assert.equal(compareHumanToSignals([signal], [rejected])[0]!.status,
    'explicit_rejection');
  assert.equal(compareHumanToSignals([signal], [])[0]!.status, 'insufficient');
  assert.equal(compareHumanToSignals([], [human])[0]!.status, 'human_only');
  assert.equal(compareHumanToSignals([signal], [{...human, id: 'h3',
    decision: {...base, direction: 'bearish'}}])[0]!.status, 'system_only');
});

test('analizador CSV protege campos entrecomillados y nuevas líneas', () => {
  assert.deepEqual(parseCsvRows('a,b\n"uno,dos","línea 1\nlínea 2"\n'),
    [['a','b'], ['uno,dos','línea 1\nlínea 2']]);
  assert.throws(() => parseCsvRows('a,b\n"sin cerrar'), /incompletas/);
});

test('contratos publicados exigen identificación OCC, cotizaciones y procedencia', () => {
  const root = new URL('../../shared-artifacts/phase17-human-method/', import.meta.url);
  const broker = JSON.parse(readFileSync(new URL('phase17-broker-trades-schema.json', root),
    'utf8')) as {csvHeader: string; required: string[]};
  const options = JSON.parse(readFileSync(new URL('phase17-options-data-schema.json', root),
    'utf8')) as {required: string[]; properties: Record<string, unknown>};
  assert.equal(broker.csvHeader, BROKER_COLUMNS.join(','));
  for (const field of ['occSymbol','bid','ask','bidSize','askSize','delta',
    'impliedVolatility','feed','provider','availabilityStatus','licenseStatus']) {
    assert.ok(options.required.includes(field));
    assert.ok(options.properties[field]);
  }
});
