import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {basename, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {importBrokerSource, readBrokerStore} from './phase17-broker-store.ts';
import {preserveChart} from './phase17-charts.ts';
import {compareHumanToSignals, humanFromLedger} from './phase17-comparison.ts';
import {appendPhase17Decision} from './phase17-journal.ts';
import {buildTradeCases} from './phase17-trade-review.ts';
import {sha256, verifyLedger} from './phase16-ledger.ts';
import type {ForwardSignal} from './phase16-engine.ts';

const project = fileURLToPath(new URL('../', import.meta.url));
const repo = fileURLToPath(new URL('../../', import.meta.url));
const privateRoot = resolve(process.env.PHASE17_PRIVATE_DIR ??
  join(project, 'output/phase17-private'));
const privateLedger = join(privateRoot, 'ledger');
const signalLedger = resolve(process.env.PHASE16_JOURNAL_DIR ??
  join(repo, 'shared-artifacts/phase16-forward-observation/live/ledger'));
const command = process.argv[2];
const path = process.argv[3];

if (command === 'journal' && path) {
  const raw = readFileSync(path, 'utf8');
  const record = appendPhase17Decision(privateLedger, raw, new Date().toISOString(), privateRoot);
  console.log(JSON.stringify({id: record.id, recordedAtUtc: record.recordedAtUtc,
    recordClass: record.payload.recordClass, journal: privateLedger}));
} else if (command === 'import-broker' && path) {
  const {state, sourceSha256, alreadyPresent} = importBrokerSource(privateRoot,
    readFileSync(path), basename(path));
  console.log(JSON.stringify({sourceSha256, alreadyPresent,
    stateSha256: state.stateSha256, sourceFiles: state.sourceFiles.length,
    executions: state.executionCount, positions: state.positions.length,
    closedTrades: state.closedTrades.length, openLots: state.openLots.length,
    privateSourceStore: join(privateRoot, 'broker-sources')}));
} else if (command === 'broker-state') {
  const state = readBrokerStore(privateRoot);
  console.log(JSON.stringify({stateSha256: state.stateSha256,
    sourceFiles: state.sourceFiles.length, executions: state.executionCount,
    positions: state.positions.length, openLots: state.openLots.length}));
} else if (command === 'review-trades') {
  const broker = readBrokerStore(privateRoot);
  const decisions = verifyLedger(privateLedger);
  const signals = verifyLedger(signalLedger).filter(record => record.kind === 'signal')
    .map(record => record.payload as unknown as ForwardSignal);
  const cases = buildTradeCases(decisions, broker, signals);
  const fingerprint = sha256(JSON.stringify({broker: broker.stateSha256,
    decisions: decisions.at(-1)?.hash ?? null, signalIds: signals.map(signal => signal.id)}));
  mkdirSync(privateRoot, {recursive: true, mode: 0o700});
  const target = join(privateRoot, `trade-review-${fingerprint}.json`);
  const body = JSON.stringify({brokerStateSha256: broker.stateSha256,
    decisionLedgerHeadHash: decisions.at(-1)?.hash ?? null,
    view: 'decision_context_separate_from_later_fills', cases}, null, 2) + '\n';
  if (!existsSync(target)) writeFileSync(target, body, {flag: 'wx', mode: 0o600});
  else if (readFileSync(target, 'utf8') !== body) {
    throw new Error('Revisión privada previamente guardada fue alterada.');
  }
  console.log(JSON.stringify({cases: cases.length,
    noTrade: cases.filter(item => item.status === 'no_trade').length,
    closed: cases.filter(item => item.status === 'closed').length,
    partial: cases.filter(item => item.status === 'partially_open').length,
    privateOutput: target}));
} else if (command === 'attach-chart' && path && process.argv[4]) {
  const manifest = preserveChart(privateRoot, path, process.argv[4]!,
    process.argv[5] ?? null);
  console.log(JSON.stringify({captureId: manifest.captureId, sha256: manifest.sha256,
    capturedAtSource: manifest.capturedAtSource,
    privateFileName: manifest.privateFileName}));
} else if (command === 'compare') {
  const signals = verifyLedger(signalLedger).filter(record => record.kind === 'signal')
    .map(record => record.payload as unknown as ForwardSignal);
  const human = humanFromLedger(verifyLedger(privateLedger));
  const rows = compareHumanToSignals(signals, human);
  mkdirSync(privateRoot, {recursive: true, mode: 0o700});
  const fingerprint = sha256(JSON.stringify({signalIds: signals.map(s => s.id),
    humanIds: human.map(h => h.id)}));
  const target = join(privateRoot, `comparison-${fingerprint}.json`);
  const summary = Object.fromEntries(['both','human_only','explicit_rejection',
    'no_trade','system_only','insufficient'].map(status =>
    [status, rows.filter(row => row.status === status).length]));
  if (!existsSync(target)) writeFileSync(target,
    JSON.stringify({view: 'decision_time_only', summary, rows}, null, 2) + '\n',
    {flag: 'wx', mode: 0o600});
  console.log(JSON.stringify({summary, privateOutput: target,
    warning: 'Sin datos humanos prospectivos suficientes no hay comparación de desempeño.'}));
} else throw new Error('Uso: phase17-cli.ts journal <csv>|import-broker <csv>|broker-state|review-trades|attach-chart <image> <id> [capturedAtUtc]|compare');
