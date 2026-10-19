import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, readdirSync, rmSync, statSync,
  writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BROKER_COLUMNS} from '../src/phase17-broker.ts';
import {importBrokerSource, readBrokerStore} from '../src/phase17-broker-store.ts';
import {preserveChart} from '../src/phase17-charts.ts';
import {csvCell} from '../src/phase17-csv.ts';
import {appendPhase17Decision, PHASE17_TEMPLATE_COLUMNS,
  PHASE17_V1_COLUMNS, parsePhase17DecisionCsv} from '../src/phase17-journal.ts';
import {compareHumanToSignals, humanFromLedger} from '../src/phase17-comparison.ts';
import {buildTradeCases} from '../src/phase17-trade-review.ts';
import {verifyLedger} from '../src/phase16-ledger.ts';

const occ = 'NVDA  261120C00150000';
const put = 'NVDA  261120P00150000';
const at = (minute: string) => `2026-10-16T${minute}:00.000Z`;
const header = BROKER_COLUMNS.join(',') + '\n';
function fill(id: string, side: 'BUY' | 'SELL', time: string, qty: number,
  premium: number, commission: string, contract = occ) {
  return [id,'NVDA',contract,contract.includes('C001') ? 'CALL' : 'PUT',
    '150','2026-11-20',side,time,String(qty),String(premium),commission,''].join(',')+'\n';
}
const source = (...rows: string[]) => Buffer.from(header + rows.join(''));
const buy = fill('b1','BUY',at('14:00'),2,4,'2');
const firstSale = fill('s1','SELL',at('14:20'),1,5,'1');
const secondSale = fill('s2','SELL',at('14:40'),1,3,'1');
const temp = (fn: (root: string) => void) => {
  const root = mkdtempSync(join(tmpdir(), 'phase17-store-synthetic-'));
  try {fn(root);} finally {rmSync(root, {recursive: true, force: true});}
};
const add = (root: string, csv: Buffer, name: string, minute = '16:00') =>
  importBrokerSource(root, csv, name, at(minute));

test('tres archivos sintéticos reconstruyen una posición, ventas parciales y reintentos', () => temp(root => {
  const a = add(root, source(buy), 'A.csv');
  assert.equal(a.state.positions[0]!.remainingQuantity, 2);
  assert.equal(a.state.sourceFiles.length, 1);
  const b = add(root, source(firstSale), 'B.csv', '16:01');
  assert.equal(b.state.positions[0]!.remainingQuantity, 1);
  assert.equal(b.state.positions[0]!.realizedNet, 98);
  const c = add(root, source(secondSale), 'C.csv', '16:02');
  assert.equal(c.state.positions.length, 1);
  assert.equal(c.state.positions[0]!.remainingQuantity, 0);
  assert.equal(c.state.positions[0]!.realizedGross, 0);
  assert.equal(c.state.positions[0]!.realizedCommission, 4);
  assert.equal(c.state.positions[0]!.realizedNet, -4);
  assert.deepEqual(c.state.positions[0]!.sellExecutionIds, ['s1','s2']);
  assert.equal(c.state.closedTrades.length, 2);
  const repeated = add(root, source(firstSale), 'B-copy.csv', '16:03');
  assert.equal(repeated.alreadyPresent, true);
  assert.equal(repeated.state.stateSha256, c.state.stateSha256);
  assert.equal(repeated.state.sourceFiles.length, 3);
  const stored = statSync(join(root,'broker-sources',`${a.sourceSha256}.json`));
  assert.ok(stored.size > 0);
  // NTFS aplica ACL; los bits POSIX de stat.mode no prueban privacidad en Windows.
  if (process.platform !== 'win32') assert.equal(stored.mode & 0o777, 0o600);
  assert.equal(readBrokerStore(root, at('16:04')).stateSha256, c.state.stateSha256);
}));

test('archivos superpuestos deduplican ID idéntico y rechazan conflicto sin persistirlo', () => temp(root => {
  add(root, source(buy), 'A.csv');
  const overlap = add(root, source(buy, firstSale), 'B.csv', '16:01');
  assert.equal(overlap.state.executionCount, 2);
  assert.equal(overlap.state.identicalDuplicateCount, 1);
  assert.equal(overlap.state.executionSources.b1?.length, 2);
  const before = overlap.state.stateSha256;
  assert.throws(() => add(root, source(fill('b1','BUY',at('14:00'),2,6,'2')),
    'conflict.csv', '16:02'), /duplicado contradictorio/);
  assert.equal(readBrokerStore(root, at('16:04')).stateSha256, before);
  assert.equal(readdirSync(join(root, 'broker-sources')).length, 2);
}));

test('reinicio de proceso reconstruye mismo hash, posición e inventario', () => temp(root => {
  add(root, source(buy), 'A.csv');
  const state = add(root, source(firstSale), 'B.csv', '16:01').state;
  const moduleUrl = new URL('../src/phase17-broker-store.ts', import.meta.url).href;
  const code = `import {readBrokerStore} from ${JSON.stringify(moduleUrl)};\n`+
    `const s=readBrokerStore(process.argv[1],${JSON.stringify(at('16:02'))});`+
    `console.log(JSON.stringify({hash:s.stateSha256,open:s.openLots.length,remaining:s.positions[0].remainingQuantity}));`;
  const child = spawnSync(process.execPath,
    ['--experimental-strip-types','--input-type=module','-e',code,root],
    {encoding:'utf8'});
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout),
    {hash: state.stateSha256, open: 1, remaining: 1});
}));

test('contratos OCC distintos, comisiones desconocidas y orden ambiguo no se mezclan', () => temp(root => {
  add(root, source(buy,fill('p1','BUY',at('14:05'),1,2,'' ,put)), 'A.csv');
  const state = add(root, source(firstSale,
    fill('ps1','SELL',at('14:25'),1,2.5,'1',put)), 'B.csv', '16:01').state;
  assert.equal(state.positions.length, 2);
  assert.equal(state.positions.find(p => p.occSymbol === put)?.realizedNet, null);
  assert.equal(state.positions.find(p => p.occSymbol === occ)?.remainingQuantity, 1);
  assert.throws(() => add(root, source(fill('s3','SELL',at('14:30'),3,5,'1')),
    'oversell.csv', '16:02'), /Venta sin compra suficiente/);
  assert.throws(() => add(root, source(fill('x','BUY',at('14:20'),1,4,'1')),
    'ambiguous.csv', '16:02'), /orden temporal ambiguo/);
  assert.equal(readBrokerStore(root, at('16:03')).sourceFiles.length, 2);
}));

test('hash original alterado y ejecución futura abortan la recuperación', () => temp(root => {
  const a = add(root, source(buy), 'A.csv');
  assert.throws(() => add(root, source(fill('late','BUY',at('16:02'),1,4,'1')),
    'future.csv', '16:01'), /posterior/);
  const path = join(root,'broker-sources',`${a.sourceSha256}.json`);
  const envelope = JSON.parse(readFileSync(path, 'utf8')) as {rawCsvBase64: string};
  envelope.rawCsvBase64 = Buffer.from('modificado').toString('base64');
  writeFileSync(path, JSON.stringify(envelope));
  assert.throws(() => readBrokerStore(root), /alterado/);
}));

test('bloqueo de proceso interrumpido se recupera sin duplicar fuente', () => temp(root => {
  writeFileSync(join(root,'.broker-import.lock'), '99999999');
  const first = add(root, source(buy), 'A.csv');
  assert.equal(first.state.executionCount,1);
  assert.equal(add(root,source(buy),'A.csv').alreadyPresent,true);
  assert.equal(readdirSync(join(root,'broker-sources')).length,1);
}));

test('archivo desconocido y precisión mixta de segundos se auditan explícitamente', () => temp(root => {
  importBrokerSource(root, source(fill('b0','BUY',
    '2026-10-16T14:00:00Z',1,4,'1'),
    fill('s0','SELL','2026-10-16T14:00:00.123Z',1,5,'1')), 'seconds.csv',
  '2026-10-16T14:00:00.456Z');
  assert.equal(readBrokerStore(root,at('16:01')).positions[0]?.realizedNet,98);
  writeFileSync(join(root,'broker-sources','junk.json'),'{}');
  assert.throws(() => readBrokerStore(root), /desconocido/);
}));

function decisionCsv(fields: Record<string,string>, v1 = false) {
  const columns = v1 ? PHASE17_V1_COLUMNS : PHASE17_TEMPLATE_COLUMNS;
  const defaults: Record<string,string> = {symbol:'NVDA',direction:'bullish',
    operationType:'pullback',timeframe:'15Min',decisionAtUtc:at('14:00'),
    selectionReason:'Prueba sintética, sin operador real',observedMarket:'true',
    recordMode:'live'};
  const value = {...defaults,...fields};
  return columns.join(',')+'\n'+columns.map(key => csvCell(value[key] ?? '')).join(',')+'\n';
}

test('CSV F17 inicial sigue aceptado; nota posterior vincula fills y plan sin alterar decisión', () => temp(root => {
  assert.equal(parsePhase17DecisionCsv(decisionCsv({}, true)).extension.linkedExecutionIds.length, 0);
  const chart = join(root, 'synthetic-chart.png');
  writeFileSync(chart, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/sXcAAAAASUVORK5CYII=', 'base64'));
  const capture = preserveChart(root, chart, 'synthetic_chart', at('13:55'), at('14:05'));
  const ledger = join(root,'ledger');
  const original = appendPhase17Decision(ledger, decisionCsv({
    decisionAtUtc:at('14:00'), contextKnownAtUtc:at('13:59'),
    trendInterpretation:'Sube según observación sintética',
    chartCaptureId:'synthetic_chart',chartCapturedAtUtc:at('13:55'),
    chartSha256:capture.sha256,contractOccSymbol:occ}), at('14:05'), root);
  add(root, source(fill('b1','BUY',at('14:10'),2,4,'2')), 'A.csv');
  add(root, source(firstSale), 'B.csv', '16:01');
  add(root, source(secondSale), 'C.csv', '16:02');
  const note = appendPhase17Decision(ledger, decisionCsv({
    decisionAtUtc:at('15:00'),recordMode:'post_outcome_annotation',
    relatedDecisionId:original.id,linkedExecutionIds:'b1|s1|s2',
    exitReason:'Salida anotada después del resultado sintético',
    planChangedAtUtc:at('14:25'),planChangeReason:'Cambio declarado retrospectivamente',
    profitObjective:'objetivo revisado'}), at('16:05'), root);
  assert.equal(note.payload.recordClass,'post_outcome_annotation');
  assert.equal(verifyLedger(ledger).length, 2);
  const cases = buildTradeCases(verifyLedger(ledger), readBrokerStore(root,at('16:06')));
  assert.equal(cases.length, 1);
  const result = cases[0]!;
  assert.equal(result.status,'closed');
  assert.equal(result.realizedNet,-4);
  assert.equal(result.documentedBeforeFirstPurchase,true);
  assert.equal(result.resultAvailableInStoreAtUtc,at('16:02'));
  assert.equal(result.decisionView.chartCaptureId,'synthetic_chart');
  assert.equal(result.planChanges[0]?.documentedBeforeLastSale,false);
  assert.ok(!JSON.stringify(result.decisionView).includes('realizedNet'));
  assert.ok(!JSON.stringify(result.decisionView).includes('Salida anotada'));
  assert.equal(compareHumanToSignals([],humanFromLedger(verifyLedger(ledger))).length,1);
}));

test('no_trade se conserva y reconstrucción posterior nunca gana estado prospectivo', () => temp(root => {
  const ledger = join(root,'ledger');
  const noTrade = appendPhase17Decision(ledger, decisionCsv({direction:'no_trade',
    operationType:'no_trade',selectionReason:'No opero, caso sintético',
    observedMarket:'false'}), at('14:05'), root);
  const old = appendPhase17Decision(ledger, decisionCsv({recordMode:'historical_reconstruction',
    decisionAtUtc:at('14:01'),contractOccSymbol:occ}), at('16:05'), root);
  add(root, source(fill('b1','BUY',at('14:10'),2,4,'2'),firstSale), 'A.csv');
  assert.throws(() => appendPhase17Decision(ledger, decisionCsv({
    recordMode:'post_outcome_annotation',decisionAtUtc:at('16:04'),
    relatedDecisionId:noTrade.id,linkedExecutionIds:'b1'}), at('16:06'), root), /no_trade/);
  appendPhase17Decision(ledger, decisionCsv({
    recordMode:'post_outcome_annotation',decisionAtUtc:at('16:04'),
    relatedDecisionId:old.id,linkedExecutionIds:'b1|s1'}), at('16:06'), root);
  const cases = buildTradeCases(verifyLedger(ledger), readBrokerStore(root,at('16:07')));
  assert.equal(cases.find(c=>c.decisionId===noTrade.id)?.status,'no_trade');
  const reconstructed = cases.find(c=>c.decisionId===old.id)!;
  assert.equal(reconstructed.status,'partially_open');
  assert.equal(reconstructed.documentedBeforeFirstPurchase,false);
  assert.equal(reconstructed.recordClass,'historical_reconstruction');
  assert.equal(reconstructed.decisionView.context,null);
}));

test('referencias futuras, contratos diferentes y capturas no importadas se rechazan', () => temp(root => {
  const ledger = join(root,'ledger');
  assert.throws(() => appendPhase17Decision(ledger, decisionCsv({
    chartCaptureId:'missing',chartSha256:'a'.repeat(64),
    chartCapturedAtUtc:at('13:55')}),at('14:05'),root), /Captura referenciada/);
  const first = appendPhase17Decision(ledger,
    decisionCsv({contractOccSymbol:occ}),at('14:05'),root);
  add(root,source(fill('p1','BUY',at('14:10'),1,2,'1',put)),'P.csv');
  assert.throws(() => appendPhase17Decision(ledger,decisionCsv({
    decisionAtUtc:at('15:00'),recordMode:'post_outcome_annotation',
    relatedDecisionId:first.id,linkedExecutionIds:'p1'}),at('16:05'),root), /otro contrato/);
  assert.throws(() => appendPhase17Decision(ledger,decisionCsv({
    decisionAtUtc:at('15:00'),recordMode:'post_outcome_annotation',
    relatedDecisionId:first.id,linkedExecutionIds:'missing'}),at('16:05'),root), /no disponible/);
  assert.equal(verifyLedger(ledger).length,1);
}));

test('un fill no puede atribuirse a dos decisiones ni mezclar posiciones', () => temp(root => {
  const ledger=join(root,'ledger');
  const first=appendPhase17Decision(ledger,decisionCsv({
    selectionReason:'Decisión sintética A'}),at('14:05'),root);
  const second=appendPhase17Decision(ledger,decisionCsv({
    selectionReason:'Decisión sintética B'}),at('14:05'),root);
  add(root,source(buy,firstSale,fill('p1','BUY',at('14:30'),1,2,'1',put)),
    'mixed.csv');
  const note=(decisionId:string,ids:string)=>decisionCsv({
    decisionAtUtc:at('15:00'),recordMode:'post_outcome_annotation',
    relatedDecisionId:decisionId,linkedExecutionIds:ids});
  assert.throws(()=>appendPhase17Decision(ledger,note(first.id,'b1|p1'),
    at('16:04'),root),/mezclar/);
  appendPhase17Decision(ledger,note(first.id,'b1|s1'),at('16:04'),root);
  assert.throws(()=>appendPhase17Decision(ledger,note(second.id,'b1'),
    at('16:05'),root),/otra decisión/);
  assert.equal(verifyLedger(ledger).length,3);
}));
