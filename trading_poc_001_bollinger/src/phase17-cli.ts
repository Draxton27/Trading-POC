import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {importBrokerExecutions} from './phase17-broker.ts';
import {preserveChart} from './phase17-charts.ts';
import {compareHumanToSignals, humanFromLedger} from './phase17-comparison.ts';
import {appendPhase17Decision} from './phase17-journal.ts';
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
  const record = appendPhase17Decision(privateLedger, raw);
  console.log(JSON.stringify({id: record.id, recordedAtUtc: record.recordedAtUtc,
    recordClass: record.payload.recordClass, journal: privateLedger}));
} else if (command === 'import-broker' && path) {
  const raw = readFileSync(path, 'utf8');
  const importedAtUtc = new Date().toISOString();
  const result = importBrokerExecutions(raw, importedAtUtc);
  mkdirSync(privateRoot, {recursive: true, mode: 0o700});
  const target = join(privateRoot, `broker-import-${result.sourceSha256}.json`);
  const version = execFileSync('git', ['rev-parse', 'HEAD'],
    {cwd: repo, encoding: 'utf8'}).trim();
  const resultSha256 = sha256(JSON.stringify(result));
  const body = JSON.stringify({importedAtUtc,
    codeVersion: version, resultSha256, result}, null, 2) + '\n';
  if (!existsSync(target)) writeFileSync(target, body, {flag: 'wx', mode: 0o600});
  else {
    const old = JSON.parse(readFileSync(target, 'utf8')) as
      {resultSha256: string; result: typeof result};
    if (old.resultSha256 !== resultSha256 ||
        sha256(JSON.stringify(old.result)) !== resultSha256) {
      throw new Error('Importación privada alterada.');
    }
  }
  console.log(JSON.stringify({sourceSha256: result.sourceSha256,
    executions: result.executionCount, closedTrades: result.closedTrades.length,
    openLots: result.openLots.length, privateOutput: target}));
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
} else throw new Error('Uso: phase17-cli.ts journal <csv>|import-broker <csv>|attach-chart <image> <id> [capturedAtUtc]|compare');
