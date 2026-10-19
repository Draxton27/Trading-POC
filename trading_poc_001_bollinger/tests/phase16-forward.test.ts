import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Candle} from '../src/domain.ts';
import {loadMarketCalendar} from '../src/alpaca-calendar.ts';
import {parseCandlesCsv} from '../src/csv.ts';
import {metadataFor} from '../src/phase14-import.ts';
import {appendCorrection, appendRecord, HUMAN_TEMPLATE_COLUMNS, matchHumanSignal,
  humanReferenceOutcomeEnd, operationalStatus, parseHumanDecisionCsv,
  validateHumanDecision, verifyLedger, type HumanDecision} from '../src/phase16-ledger.ts';
import {barId, detectAt, fourBarReturn, knownAt, marketContextUpdate,
  receivedFourBarReturn, requireAlpacaKeys, settleSignal, signalTiming, validateBar,
  type BarReceipt, type ForwardSignal} from '../src/phase16-engine.ts';

function candle(timestamp: string, open = 100, close = 101): Candle {
  return {timestamp, open, high: Math.max(open, close) + 1,
    low: Math.min(open, close) - 1, close, volume: 100};
}

test('vela completa, EST/EDT, calendario y cierre anticipado', () => {
  const calendar = new Map([
    ['2026-03-06', {open: 570, close: 600}],
    ['2026-03-09', {open: 570, close: 615}],
    ['2026-11-27', {open: 570, close: 780}],
  ]);
  const est = candle('2026-03-06T14:30:00.000Z');
  const edt = candle('2026-03-09T13:30:00.000Z');
  assert.equal(validateBar('NVDA', est, '2026-03-06T14:45:00.000Z', calendar).feed, 'sip');
  assert.equal(validateBar('QQQ', edt, '2026-03-09T13:45:00.000Z', calendar).symbol, 'QQQ');
  assert.throws(() => validateBar('NVDA', edt, '2026-03-09T13:44:59.000Z', calendar), /incompleta/);
  assert.equal(validateBar('SMH', candle('2026-11-27T17:45:00.000Z'),
    '2026-11-27T18:00:00.000Z', calendar).symbol, 'SMH');
  assert.throws(() => validateBar('SMH', candle('2026-11-27T18:00:00.000Z'),
    '2026-11-27T18:15:00.000Z', calendar), /calendario/);
});

test('cuatro barras consecutivas, sin saltos nocturnos ni información futura', () => {
  const values = ['2026-03-09T13:30:00.000Z','2026-03-09T13:45:00.000Z',
    '2026-03-09T14:00:00.000Z','2026-03-09T14:15:00.000Z'].map((t, i) => candle(t, 100 + i, 101 + i));
  assert.equal(fourBarReturn(values, values[3]!.timestamp).starts.length, 4);
  assert.ok(Math.abs(fourBarReturn([...values, candle('2026-03-09T14:30:00.000Z', 900, 900)],
    values[3]!.timestamp).value! - 4) < 1e-10);
  assert.equal(fourBarReturn(values.slice(1), values[3]!.timestamp).value, null);
  assert.equal(fourBarReturn([values[0]!, values[1]!, values[3]!,
    candle('2026-03-09T14:30:00.000Z')], '2026-03-09T14:30:00.000Z').value, null);
});

test('hash encadenado, reintento, interrupción y corrección solo por adición', () => {
  const directory = mkdtempSync(join(tmpdir(), 'phase16-ledger-test-'));
  try {
    const first = appendRecord(directory, 'bar:a', 'bar_receipt', {hash: 'one'}, '2026-10-19T14:00:00.000Z');
    writeFileSync(join(directory, '.00000002.json.partial'), 'interrupted');
    assert.equal(appendRecord(directory, 'bar:a', 'bar_receipt', {hash: 'one'}).hash, first.hash);
    assert.throws(() => appendRecord(directory, 'bar:a', 'bar_receipt', {hash: 'two'}), /duplicado/);
    appendCorrection(directory, 'bar:a', 'fix:a', 'proveedor revisó barra', {hash: 'two'});
    assert.equal(verifyLedger(directory).length, 2);
    const path = join(directory, '00000001.json');
    const value = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    value.payload = {hash: 'tampered'};
    writeFileSync(path, JSON.stringify(value));
    assert.throws(() => verifyLedger(directory), /alterado/);
  } finally {rmSync(directory, {recursive: true, force: true});}
});

test('latencia y recuperación no se presentan como ejecutabilidad', () => {
  const entry = '2026-10-19T14:00:00.000Z';
  assert.equal(operationalStatus(entry, entry, entry, false, false), 'on_time');
  assert.equal(operationalStatus('2026-10-19T14:15:00.000Z',
    '2026-10-19T14:16:00.000Z', entry, false, false), 'delayed');
  assert.equal(operationalStatus(entry, entry, entry, true, false), 'recovered_after_failure');
  assert.equal(operationalStatus(entry, entry, entry, false, true), 'historical_reconstruction');
});

test('entrada sin latencia, observación y ejecución tienen estados separados', () => {
  const timing = signalTiming('2026-10-19T14:00:00.000Z',
    '2026-10-19T14:00:02.000Z', false);
  assert.equal(timing.theoreticalEntryOpenUtc, '2026-10-19T14:15:00.000Z');
  assert.equal(timing.primaryOutcomeEndUtc, '2026-10-19T14:45:00.000Z');
  assert.equal(timing.firstDetectedBeforePrimaryOutcome, true);
  assert.equal(timing.executionAtTheoreticalOpen, 'not_demonstrated');
  const calendar = new Map([['2026-10-19', {open: 570, close: 960}]]);
  const bars = ['2026-10-19T14:00:00.000Z', '2026-10-19T14:15:00.000Z',
    '2026-10-19T14:30:00.000Z'].map(t => candle(t));
  const signal = {id: 'zero-latency', direction: 'bullish', dateNy: '2026-10-19',
    barStartUtc: bars[0]!.timestamp, nextEntryOpenUtc: timing.theoreticalEntryOpenUtc,
    primaryOutcomeEndUtc: timing.primaryOutcomeEndUtc,
    firstDetectedBeforePrimaryOutcome: true, prospectiveBeforePrimaryOutcome: true,
    observability: 'on_time'} as ForwardSignal;
  const result = settleSignal(signal, bars, calendar, '2026-10-19T14:45:00.000Z');
  assert.equal(result.operationallyAvailable, false);
  assert.equal(result.executionAtTheoreticalOpen, 'not_demonstrated');
  assert.equal((result.horizons['30'] as {state: string}).state, 'final');
});

test('primera detección después del desenlace principal no es anticipada', () => {
  const start = '2026-10-19T14:00:00.000Z';
  assert.equal(signalTiming(start, '2026-10-19T14:44:59.999Z', false)
    .prospectiveBeforePrimaryOutcome, true);
  assert.equal(signalTiming(start, '2026-10-19T14:45:00.000Z', false)
    .firstDetectedBeforePrimaryOutcome, false);
  assert.equal(signalTiming(start, '2026-10-19T15:00:00.000Z', false)
    .prospectiveBeforePrimaryOutcome, false);
  assert.equal(signalTiming(start, '2026-10-19T14:30:00.000Z', true)
    .prospectiveBeforePrimaryOutcome, false);
});

test('QQQ y SMH tardíos agregan contexto sin editar señal original', () => {
  const directory = mkdtempSync(join(tmpdir(), 'phase16-context-test-'));
  try {
    const times = ['2026-10-19T13:30:00.000Z', '2026-10-19T13:45:00.000Z',
      '2026-10-19T14:00:00.000Z', '2026-10-19T14:15:00.000Z'];
    const qqq = times.map((t, i) => candle(t, 100 + i, 101 + i));
    const smh = times.map((t, i) => candle(t, 200 - i, 199 - i));
    const signal = {id: 'sample', direction: 'bullish', dateNy: '2026-10-19',
      barStartUtc: times[3], generatedAtUtc: '2026-10-19T14:30:01.000Z',
      primaryOutcomeEndUtc: '2026-10-19T15:00:00.000Z',
      qqqFourReturnPercent: null, smhFourReturnPercent: null,
      marketGroup: 'missing'} as ForwardSignal;
    const original = appendRecord(directory, 'signal:sample', 'signal',
      signal as unknown as Record<string, unknown>, signal.generatedAtUtc);
    const receipts = new Map<string, BarReceipt>();
    const put = (symbol: 'QQQ' | 'SMH', bars: Candle[], at: string) => {
      for (const bar of bars) receipts.set(barId(symbol, bar.timestamp), {
        symbol, candle: bar, receivedAtUtc: at, provider: 'Alpaca Market Data API',
        feed: 'sip', adjustment: 'split', status: 'delayed', inputSha256: 'fixture'});
    };
    put('QQQ', qqq, '2026-10-19T14:31:00.000Z');
    assert.equal(receivedFourBarReturn(qqq, 'QQQ', times[3]!, receipts,
      signal.generatedAtUtc).value, null);
    const partial = marketContextUpdate(signal, qqq, smh, receipts,
      '2026-10-19T14:32:00.000Z')!;
    assert.equal(partial.payload.originalMarketGroup, 'missing');
    assert.equal(partial.payload.smhFourReturnPercent, null);
    appendRecord(directory, partial.id, 'market_context_update', partial.payload,
      '2026-10-19T14:32:00.000Z');
    put('SMH', smh, '2026-10-19T15:01:00.000Z');
    const final = marketContextUpdate(signal, qqq, smh, receipts,
      '2026-10-19T15:02:00.000Z')!;
    assert.notEqual(final.id, partial.id);
    assert.equal(final.payload.availableBeforePrimaryOutcome, false);
    appendRecord(directory, final.id, 'market_context_update', final.payload,
      '2026-10-19T15:02:00.000Z');
    appendRecord(directory, final.id, 'market_context_update', final.payload,
      '2026-10-19T15:02:00.000Z');
    const rows = verifyLedger(directory);
    assert.equal(rows.length, 3);
    assert.equal(rows[0]!.hash, original.hash);
    assert.equal(rows[0]!.payload.marketGroup, 'missing');
    assert.equal(rows[2]!.payload.originalGeneratedAtUtc, signal.generatedAtUtc);
    const earlySignal = {...signal, id: 'early', barStartUtc: times[1],
      primaryOutcomeEndUtc: '2026-10-19T14:30:00.000Z'};
    const partialReceipts = new Map([[barId('QQQ', times[1]!),
      receipts.get(barId('QQQ', times[1]!))!]]);
    const insufficient = marketContextUpdate(earlySignal, qqq, smh, partialReceipts,
      '2026-10-19T15:02:00.000Z')!;
    assert.equal(insufficient.payload.qqqFourReturnPercent, null);
    assert.equal((insufficient.payload.qqqSourceBars as unknown[]).length, 1);
    assert.equal(insufficient.payload.availableBeforePrimaryOutcome, false);
  } finally {rmSync(directory, {recursive: true, force: true});}
});

test('resultado pendiente, 30 minutos y exclusión por cierre de sesión', () => {
  const calendar = new Map([['2026-03-09', {open: 570, close: 615}]]);
  const bars = ['2026-03-09T13:30:00.000Z','2026-03-09T13:45:00.000Z',
    '2026-03-09T14:00:00.000Z'].map((t, i) => candle(t, 100 + i, 101 + i));
  const signal = {id: 'test', direction: 'bullish', dateNy: '2026-03-09',
    barStartUtc: bars[1]!.timestamp, availableAtUtc: '2026-03-09T14:00:00.000Z',
    nextEntryOpenUtc: '2026-03-09T14:00:00.000Z', observability: 'delayed'} as ForwardSignal;
  const pending = settleSignal(signal, bars, calendar, '2026-03-09T14:10:00.000Z');
  assert.equal((pending.horizons['15'] as {state: string}).state, 'pending');
  const settled = settleSignal(signal, bars, calendar, '2026-03-10T15:00:00.000Z');
  assert.equal((settled.horizons['15'] as {state: string}).state, 'final');
  assert.equal((settled.horizons['30'] as {reason: string}).reason, 'session_close');
  assert.equal(settled.operationallyAvailable, false);
});

test('eventos solo después de su publicación verificada', () => {
  const events = [{id: 'CPI', timestampUtc: '2026-10-19T12:30:00.000Z',
    verifiedAtUtc: '2026-10-19T12:30:00.000Z'},
  {id: 'FOMC', timestampUtc: '2026-10-19T18:00:00.000Z',
    verifiedAtUtc: '2026-10-19T17:00:00.000Z'},
  {id: 'unknown', timestampUtc: '2026-10-19T13:00:00.000Z',
    verifiedAtUtc: '2026-10-19T20:00:00.000Z'}];
  assert.deepEqual(knownAt(events, '2026-10-19T14:00:00.000Z'), ['CPI']);
  assert.deepEqual(knownAt(null, '2026-10-19T14:00:00.000Z'), []);
});

test('decisión humana antes/después y coincidencia independiente de no operar', () => {
  const decision: HumanDecision = {symbol: 'NVDA', direction: 'bullish',
    operationType: 'pullback', timeframe: '15Min',
    decisionAtUtc: '2026-10-19T14:00:00.000Z', documentedAtUtc: '2026-10-19T14:01:00.000Z',
    sma20: null, sma40: null, sma100: null, sma200: null,
    plannedEntry: null, plannedInvalidation: null, exitCriterion: null,
    selectionReason: 'observación humana', chartCaptureId: null, observedMarket: true,
    outcomeKnownAtUtc: '2026-10-19T14:30:00.000Z'};
  assert.equal(validateHumanDecision(decision, '2026-10-19T14:02:00.000Z'), 'prospective');
  assert.equal(matchHumanSignal({family: 'pullback_bullish', direction: 'bullish',
    availableAtUtc: '2026-10-19T14:00:00.000Z'}, decision), 'both');
  assert.equal(validateHumanDecision({...decision, documentedAtUtc: '2026-10-19T15:00:00.000Z'},
    '2026-10-19T15:01:00.000Z'), 'retrospective');
  assert.equal(matchHumanSignal({family: 'pullback_bullish', direction: 'bullish',
    availableAtUtc: '2026-10-19T14:00:00.000Z'},
  {...decision, direction: 'no_trade', operationType: 'no_trade'}), 'no_trade');
});

test('diario humano documentado antes del desenlace principal sin hora aportada por operador', () => {
  const decision: HumanDecision = {symbol: 'NVDA', direction: 'bullish',
    operationType: 'pullback', timeframe: '15Min',
    decisionAtUtc: '2026-10-19T14:02:00.000Z',
    documentedAtUtc: '2026-10-19T14:20:00.000Z',
    sma20: null, sma40: null, sma100: null, sma200: null,
    plannedEntry: null, plannedInvalidation: null, exitCriterion: null,
    selectionReason: 'documentada antes del desenlace', chartCaptureId: null,
    observedMarket: true, outcomeKnownAtUtc: null};
  assert.equal(humanReferenceOutcomeEnd(decision.decisionAtUtc),
    '2026-10-19T14:45:00.000Z');
  assert.equal(validateHumanDecision(decision, '2026-10-19T14:20:00.000Z'), 'prospective');
  assert.equal(validateHumanDecision({...decision, documentedAtUtc: '2026-10-19T14:45:00.000Z'},
    '2026-10-19T14:45:00.000Z'), 'retrospective');
  assert.equal(validateHumanDecision({...decision,
    outcomeKnownAtUtc: '2026-10-19T14:15:00.000Z'},
  '2026-10-19T14:20:00.000Z'), 'retrospective');
});

test('sesión de 26 velas conserva 26 evaluaciones tras reintento y reapertura', () => {
  const directory = mkdtempSync(join(tmpdir(), 'phase16-session-test-'));
  try {
    const start = Date.parse('2026-10-19T13:30:00.000Z');
    const calendar = new Map([['2026-10-19', {open: 570, close: 960}]]);
    const begin = performance.now();
    for (let i = 0; i < 26; i++) {
      const at = new Date(start + i * 900_000).toISOString();
      const received = new Date(start + (i + 1) * 900_000 + 960_000).toISOString();
      const checked = validateBar('NVDA', candle(at), received, calendar);
      appendRecord(directory, barId('NVDA', at), 'bar_receipt',
        {receivedAtUtc: checked.receivedAtUtc, inputSha256: checked.inputSha256}, received);
      appendRecord(directory, `assessed:${at}`, 'bar_assessment',
        {barStartUtc: at, signalIds: []}, received);
    }
    const firstPassMs = performance.now() - begin;
    const firstHash = verifyLedger(directory).at(-1)!.hash;
    for (let i = 0; i < 26; i++) {
      const at = new Date(start + i * 900_000).toISOString();
      const received = new Date(start + (i + 1) * 900_000 + 960_000).toISOString();
      const checked = validateBar('NVDA', candle(at), received, calendar);
      appendRecord(directory, barId('NVDA', at), 'bar_receipt',
        {receivedAtUtc: checked.receivedAtUtc, inputSha256: checked.inputSha256}, received);
      appendRecord(directory, `assessed:${at}`, 'bar_assessment',
        {barStartUtc: at, signalIds: []}, received);
    }
    assert.equal(verifyLedger(directory).length, 52);
    assert.equal(verifyLedger(directory).at(-1)!.hash, firstHash);
    assert.ok(firstPassMs < 900_000, `El procesamiento local excede 15 minutos: ${firstPassMs}`);
  } finally {rmSync(directory, {recursive: true, force: true});}
});

test('plantilla CSV humana admite motivo citado y no inventa contexto', () => {
  const fields = ['NVDA','no_trade','no_trade','15Min','2026-10-19T14:00:00.000Z',
    '','','','','','','','"Sin contexto, espero"','','true',''];
  const parsed = parseHumanDecisionCsv(HUMAN_TEMPLATE_COLUMNS.join(',') + '\n' +
    fields.join(',') + '\n');
  assert.equal(parsed.selectionReason, 'Sin contexto, espero');
  assert.equal(parsed.direction, 'no_trade');
  assert.equal(parsed.sma200, null);
  assert.equal(parsed.observedMarket, true);
});

test('fallo de credenciales sin exponer valores y ningún endpoint de órdenes', () => {
  assert.throws(() => requireAlpacaKeys(undefined, 'secret'), /Faltan credenciales/);
  assert.throws(() => requireAlpacaKeys('key', undefined), /Faltan credenciales/);
  const headers = requireAlpacaKeys('key', 'secret');
  assert.equal(Object.keys(headers).length, 2);
  const source = readFileSync(new URL('../src/phase16-cli.ts', import.meta.url), 'utf8');
  assert.ok(!source.includes('/v2/orders') && !source.includes('method: \'POST\''));
});

test('las seis familias históricas se detectan con prefijos causales y preservan el retorno principal',
  {skip: !existsSync(new URL('../data/NVDA_ALPACA_SIP_15min_20211017_20261017.csv', import.meta.url))}, () => {
    const source = new URL('../data/NVDA_ALPACA_SIP_15min_20211017_20261017.csv', import.meta.url);
    const bars = parseCandlesCsv(readFileSync(source, 'utf8'),
      {...metadataFor('QQQ'), asset: 'NVDA'});
    const calendar = loadMarketCalendar(fileURLToPath(new URL('../data/NVDA_ALPACA_SIP_15min_20211017_20261017.csv.calendar.json',
      import.meta.url)));
    const prior = JSON.parse(readFileSync(new URL('../output/real/nvda-volatility-regimes.json',
      import.meta.url), 'utf8')) as {study: {events: Array<{id: string; family: string;
      index: number; originalHorizons: Record<string, {value: number | null}>}>}};
    const first = new Map<string, typeof prior.study.events[number]>();
    for (const event of prior.study.events) if (!first.has(event.family)) first.set(event.family, event);
    assert.equal(first.size, 6);
    for (const original of first.values()) {
      const bar = bars[original.index]!;
      const receipt: BarReceipt = {symbol: 'NVDA', candle: bar,
        receivedAtUtc: '2026-10-18T15:00:00.000Z', provider: 'Alpaca Market Data API',
        feed: 'sip', adjustment: 'split', status: 'recovered', inputSha256: 'test'};
      const found = detectAt({nvdaPrefix: bars.slice(0, original.index + 1), qqq: [], smh: [],
        calendar, receipts: new Map([[barId('NVDA', bar.timestamp), receipt]]),
        generatedAtUtc: '2026-10-18T15:00:00.000Z', codeVersion: 'test', detectorHash: 'test',
        events: null, priorSignals: [], historical: true, recoveryReason: null})
        .find(signal => signal.id === original.id);
      assert.ok(found, `Falta ${original.id}`);
      const result = settleSignal(found, bars, calendar, '2026-10-18T15:00:00.000Z')
        .horizons['30'] as {value: number | null};
      assert.ok(result.value === original.originalHorizons['30'].value ||
        result.value !== null && original.originalHorizons['30'].value !== null &&
        Math.abs(result.value - original.originalHorizons['30'].value) < 1e-10);
    }
  });
