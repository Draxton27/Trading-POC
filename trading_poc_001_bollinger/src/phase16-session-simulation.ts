import {strict as assert} from 'node:assert';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {loadMarketCalendar} from './alpaca-calendar.ts';
import {parseCandlesCsv} from './csv.ts';
import type {Candle} from './domain.ts';
import {metadataFor, PHASE14_NVDA_SHA256, sha256, symbolPath} from './phase14-import.ts';
import {localEasternToUtc} from './phase14-events.ts';
import {appendRecord, verifyLedger} from './phase16-ledger.ts';
import {barId, detectAt, marketContextUpdate, settleSignal, validateBar,
  type BarReceipt, type ForwardSignal, type Symbol} from './phase16-engine.ts';

const project = fileURLToPath(new URL('../', import.meta.url));
const repo = fileURLToPath(new URL('../../', import.meta.url));
const output = join(repo, 'shared-artifacts/phase16-forward-observation');
const source = join(project, 'data/NVDA_ALPACA_SIP_15min_20211017_20261017.csv');
const sources: Record<Symbol, string> = {NVDA: source,
  QQQ: symbolPath(join(project, 'data'), 'QQQ'),
  SMH: symbolPath(join(project, 'data'), 'SMH')};
const expected: Record<Symbol, string> = {NVDA: PHASE14_NVDA_SHA256,
  QQQ: '962696cb57499ecf0991b1915975f5fe5725e7df7185654bfa4a2f71775eb2fb',
  SMH: 'd517e4652e9f4e44c715b5580dd4fa6d303b0a9f3246169027d142b2aac0cb55'};
const bars = {} as Record<Symbol, Candle[]>;
for (const symbol of ['NVDA', 'QQQ', 'SMH'] as Symbol[]) {
  const raw = readFileSync(sources[symbol]);
  assert.equal(sha256(raw), expected[symbol]);
  bars[symbol] = parseCandlesCsv(raw.toString('utf8'),
    symbol === 'NVDA' ? {...metadataFor('QQQ'), asset: 'NVDA'} : metadataFor(symbol),
    {allowIntradayGaps: symbol !== 'NVDA'});
}
const calendar = loadMarketCalendar(source + '.calendar.json');
const day = '2026-10-13';
const hours = calendar.get(day);
assert.ok(hours && hours.close - hours.open === 390);
const timestamps = Array.from({length: 26}, (_, index) => {
  const minute = hours.open + index * 15;
  return localEasternToUtc(day,
    `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`)!;
});
const lookup = Object.fromEntries((['NVDA', 'QQQ', 'SMH'] as Symbol[])
  .map(symbol => [symbol, new Map(bars[symbol].map((bar, index) => [bar.timestamp, index]))])) as
  Record<Symbol, Map<string, number>>;
assert.ok(timestamps.every(timestamp => lookup.NVDA.has(timestamp)));
const codeVersion = execFileSync('git', ['rev-parse', 'HEAD'],
  {cwd: repo, encoding: 'utf8'}).trim();
const detectorFiles = ['nvda-pullback-breakout.ts','nvda-failed-breakouts.ts',
  'nvda-volatility.ts','phase15-analysis.ts','phase16-engine.ts'];
const detectorHash = sha256(detectorFiles.map(name =>
  sha256(readFileSync(join(project, 'src', name)))).join('|'));
const root = mkdtempSync(join(tmpdir(), 'phase16-full-session-'));
const ledgerPath = join(root, 'ledger');
type Row = {barStartUtc: string; processingMs: number; detectionCpuMs: number;
  injectedNvdaReceiptDelayMs: number; signals: number; marketUpdates: number;
  qqqPresent: boolean; smhPresent: boolean; recordsAfterBar: number};
const rows: Row[] = [];

function runPass(collectMetrics: boolean) {
  const receipts = new Map<string, BarReceipt>();
  const signals: ForwardSignal[] = [];
  const previousRows = collectMetrics ? rows : [];
  for (const timestamp of timestamps) {
    const slotStart = performance.now();
    const index = lookup.NVDA.get(timestamp)!;
    const nvda = bars.NVDA[index]!;
    const closeMs = Date.parse(timestamp) + 900_000;
    const nvdaAt = new Date(closeMs + 960_000).toISOString();
    const firstDetectedAt = new Date(closeMs + 960_001).toISOString();
    const nvdaReceipt = validateBar('NVDA', nvda, nvdaAt, calendar);
    receipts.set(barId('NVDA', timestamp), nvdaReceipt);
    appendRecord(ledgerPath, barId('NVDA', timestamp), 'bar_receipt',
      {symbol: 'NVDA', barStartUtc: timestamp, receivedAtUtc: nvdaAt,
        inputSha256: nvdaReceipt.inputSha256}, nvdaAt);
    const detectStart = performance.now();
    const found = detectAt({nvdaPrefix: bars.NVDA.slice(0, index + 1),
      qqq: bars.QQQ, smh: bars.SMH, calendar, receipts,
      generatedAtUtc: firstDetectedAt, codeVersion, detectorHash,
      events: null, priorSignals: signals, historical: true, recoveryReason: null});
    const detectionCpuMs = performance.now() - detectStart;
    for (const signal of found) {
      assert.equal(signal.marketGroup, 'missing');
      appendRecord(ledgerPath, `signal:${signal.id}`, 'signal',
        signal as unknown as Record<string, unknown>, firstDetectedAt);
      signals.push(signal);
    }
    appendRecord(ledgerPath, `assessed:${timestamp}`, 'bar_assessment',
      {barStartUtc: timestamp, signalIds: found.map(signal => signal.id),
        originalMarketContext: 'not_yet_received'}, firstDetectedAt);
    let updates = 0;
    const coverage: Record<'QQQ' | 'SMH', boolean> = {QQQ: false, SMH: false};
    for (const [symbol, delay] of [['QQQ', 1_020_000], ['SMH', 1_080_000]] as const) {
      const atIndex = lookup[symbol].get(timestamp);
      if (atIndex === undefined) continue;
      coverage[symbol] = true;
      const at = new Date(closeMs + delay).toISOString();
      const receipt = validateBar(symbol, bars[symbol][atIndex]!, at, calendar);
      receipts.set(barId(symbol, timestamp), receipt);
      appendRecord(ledgerPath, barId(symbol, timestamp), 'bar_receipt',
        {symbol, barStartUtc: timestamp, receivedAtUtc: at,
          inputSha256: receipt.inputSha256}, at);
      const ids = new Set(verifyLedger(ledgerPath).map(record => record.id));
      for (const signal of signals) {
        const update = marketContextUpdate(signal, bars.QQQ, bars.SMH, receipts, at);
        if (!update || ids.has(update.id)) continue;
        appendRecord(ledgerPath, update.id, 'market_context_update', update.payload, at);
        ids.add(update.id);
        updates++;
      }
    }
    const settleAt = new Date(closeMs + 1_080_000).toISOString();
    const existing = new Set(verifyLedger(ledgerPath).map(record => record.id));
    for (const signal of signals) {
      const outcome = settleSignal(signal, bars.NVDA.slice(0, index + 1), calendar, settleAt);
      for (const [minutes, value] of Object.entries(outcome.horizons)) {
        const id = `settlement:${signal.id}:${minutes}`;
        if ((value as {state: string}).state === 'pending' || existing.has(id)) continue;
        appendRecord(ledgerPath, id, 'settlement', {signalId: signal.id,
          horizonMinutes: Number(minutes), theoreticalOnly: true,
          operationallyAvailable: false,
          ...value as Record<string, unknown>}, settleAt);
        existing.add(id);
      }
    }
    if (collectMetrics) previousRows.push({barStartUtc: timestamp,
      processingMs: performance.now() - slotStart, detectionCpuMs,
      injectedNvdaReceiptDelayMs: 960_000, signals: found.length,
      marketUpdates: updates, qqqPresent: coverage.QQQ,
      smhPresent: coverage.SMH, recordsAfterBar: verifyLedger(ledgerPath).length});
  }
  const at = new Date(Date.parse(timestamps.at(-1)!) + 86_400_000).toISOString();
  const existing = new Set(verifyLedger(ledgerPath).map(record => record.id));
  for (const signal of signals) {
    const result = settleSignal(signal, bars.NVDA.slice(0,
      lookup.NVDA.get(timestamps.at(-1)!)! + 1), calendar, at);
    for (const [minutes, value] of Object.entries(result.horizons)) {
      const id = `settlement:${signal.id}:${minutes}`;
      if ((value as {state: string}).state === 'pending' || existing.has(id)) continue;
      appendRecord(ledgerPath, id, 'settlement', {signalId: signal.id,
        horizonMinutes: Number(minutes), theoreticalOnly: true,
        operationallyAvailable: false, ...value as Record<string, unknown>}, at);
      existing.add(id);
    }
  }
  return signals;
}

try {
  const firstStart = performance.now();
  const signals = runPass(true);
  const firstPassMs = performance.now() - firstStart;
  const firstLedger = verifyLedger(ledgerPath);
  const firstHash = firstLedger.at(-1)!.hash;
  const retryStart = performance.now();
  runPass(false);
  const retryMs = performance.now() - retryStart;
  const afterRetry = verifyLedger(ledgerPath);
  assert.equal(afterRetry.length, firstLedger.length);
  assert.equal(afterRetry.at(-1)!.hash, firstHash);
  const reopened = execFileSync(process.execPath, ['--experimental-strip-types',
    '--input-type=module', '-e',
    `import {verifyLedger} from ${JSON.stringify(join(project, 'src/phase16-ledger.ts'))};`+
    `const rows=verifyLedger(process.argv[1]);process.stdout.write(JSON.stringify({count:rows.length,lastHash:rows.at(-1)?.hash}));`,
    ledgerPath], {cwd: project, encoding: 'utf8'});
  const durable = JSON.parse(reopened) as {count: number; lastHash: string};
  assert.equal(durable.count, firstLedger.length);
  assert.equal(durable.lastHash, firstHash);
  assert.ok(rows.length === 26 && firstPassMs < 900_000);
  const sorted = rows.map(row => row.processingMs).sort((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.ceil(sorted.length * p) - 1]!;
  const summary = {type: 'historical_full_session_simulation_not_prospective',
    simulatedSessionNy: day, bars: 26, codeVersion, detectorHash,
    sourceHashes: expected, providerDelay: 'injected_not_measured',
    nvdaReceiptDelayMs: 960_000, qqqReceiptDelayMs: 1_020_000,
    smhReceiptDelayMs: 1_080_000, firstDetectionOffsetAfterNvdaReceiptMs: 1,
    firstPassProcessingMs: firstPassMs, retryProcessingMs: retryMs,
    perBarProcessingP50Ms: percentile(0.5),
    perBarProcessingP95Ms: percentile(0.95),
    perBarProcessingMaxMs: sorted.at(-1),
    processingWithin15MinuteInterval: rows.every(row => row.processingMs < 900_000),
    signalsDetected: signals.length,
    signalsBeforeMainOutcomeInSimulatedClock: signals.filter(s =>
      s.firstDetectedBeforePrimaryOutcome).length,
    prospectiveSignals: 0,
    marketContextUpdates: firstLedger.filter(row => row.kind === 'market_context_update').length,
    records: firstLedger.length, firstPassLastHash: firstHash,
    retryAddedRecords: afterRetry.length - firstLedger.length,
    retryPreservedLastHash: afterRetry.at(-1)!.hash === firstHash,
    subprocessReopenVerified: true,
    limitation: 'No network, live provider latency, future schedule, or remote persistence measured.'};
  writeFileSync(join(output, 'phase16-session-simulation.json'),
    JSON.stringify(summary, null, 2) + '\n');
  writeFileSync(join(output, 'phase16-session-simulation.csv'),
    'bar_start_utc,processing_ms,detection_cpu_ms,injected_nvda_receipt_delay_ms,signals,market_updates,qqq_present,smh_present,records_after_bar\n' +
    rows.map(row => [row.barStartUtc,row.processingMs,row.detectionCpuMs,
      row.injectedNvdaReceiptDelayMs,row.signals,row.marketUpdates,
      row.qqqPresent,row.smhPresent,row.recordsAfterBar].join(',')).join('\n') + '\n');
  process.stdout.write(JSON.stringify(summary) + '\n');
} finally {rmSync(root, {recursive: true, force: true});}
