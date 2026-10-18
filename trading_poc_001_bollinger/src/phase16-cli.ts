import {strict as assert} from 'node:assert';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fetchAlpacaCalendar, loadMarketCalendar, type MarketCalendar} from './alpaca-calendar.ts';
import {parseCandlesCsv} from './csv.ts';
import type {Candle} from './domain.ts';
import {metadataFor, PHASE14_NVDA_SHA256, sha256, symbolPath} from './phase14-import.ts';
import {localEasternToUtc} from './phase14-events.ts';
import {appendCorrection, appendRecord, FORWARD_START, matchHumanSignal, sha256 as hash,
  validateHumanDecision, verifyLedger, type HumanDecision} from './phase16-ledger.ts';
import {barId, canonicalBarHash, detectAt, settleSignal, validateBar, requireAlpacaKeys,
  type BarReceipt, type ForwardSignal, type KnownEvent, type Symbol} from './phase16-engine.ts';

const project = fileURLToPath(new URL('../', import.meta.url));
const repo = fileURLToPath(new URL('../../', import.meta.url));
const privateRoot = resolve(process.env.PHASE16_PRIVATE_DIR ?? join(project, 'output/phase16-private'));
const publicRoot = resolve(process.env.PHASE16_JOURNAL_DIR ??
  join(repo, 'shared-artifacts/phase16-forward-observation/live/ledger'));
const baseData = join(project, 'data');
const originalNvda = join(baseData, 'NVDA_ALPACA_SIP_15min_20211017_20261017.csv');
const originalCalendar = originalNvda + '.calendar.json';
const codeVersion = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repo, encoding: 'utf8'}).trim();
const detectorFiles = ['nvda-pullback-breakout.ts', 'nvda-failed-breakouts.ts',
  'nvda-volatility.ts', 'phase15-analysis.ts', 'phase16-engine.ts'];
const detectorHash = hash(detectorFiles.map(name =>
  hash(readFileSync(join(project, 'src', name)))).join('|'));
const symbols: Symbol[] = ['NVDA', 'QQQ', 'SMH'];
const historicalHashes: Record<Symbol, string> = {
  NVDA: PHASE14_NVDA_SHA256,
  QQQ: '962696cb57499ecf0991b1915975f5fe5725e7df7185654bfa4a2f71775eb2fb',
  SMH: 'd517e4652e9f4e44c715b5580dd4fa6d303b0a9f3246169027d142b2aac0cb55',
};

function baseCandles(symbol: Symbol): Candle[] {
  const path = symbol === 'NVDA' ? originalNvda : symbolPath(baseData, symbol);
  const expected = historicalHashes[symbol];
  assert.equal(sha256(readFileSync(path)), expected, `Historial fijo ${symbol} alterado.`);
  return parseCandlesCsv(readFileSync(path, 'utf8'),
    symbol === 'NVDA' ? {...metadataFor('QQQ'), asset: 'NVDA'} : metadataFor(symbol),
    {allowIntradayGaps: symbol !== 'NVDA'});
}
function cachePath(symbol: Symbol, timestamp: string) {
  return join(privateRoot, 'bars', symbol, timestamp.slice(0, 10),
    timestamp.replaceAll(':', '-') + '.json');
}
function loadCached(symbol: Symbol): BarReceipt[] {
  const root = join(privateRoot, 'bars', symbol);
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap(day => readdirSync(join(root, day))
    .filter(name => name.endsWith('.json'))
    .map(name => JSON.parse(readFileSync(join(root, day, name), 'utf8')) as BarReceipt))
    .sort((a, b) => a.candle.timestamp.localeCompare(b.candle.timestamp));
}

async function fetchBars(symbol: Symbol, now: string): Promise<BarReceipt[]> {
  const headers = requireAlpacaKeys(process.env.APCA_API_KEY_ID, process.env.APCA_API_SECRET_KEY);
  const cutoff = new Date(Date.parse(now) - 900_000).toISOString();
  if (cutoff <= FORWARD_START) return [];
  const receipts: BarReceipt[] = [];
  let page: string | null = null, pages = 0;
  const tokens = new Set<string>(), seen = new Map<string, string>();
  do {
    const url = new URL(`https://data.alpaca.markets/v2/stocks/${symbol}/bars`);
    for (const [k, v] of Object.entries({timeframe: '15Min', start: FORWARD_START,
      end: cutoff, feed: 'sip', adjustment: 'split', limit: '10000'})) url.searchParams.set(k, v);
    if (page) url.searchParams.set('page_token', page);
    let response: Response | undefined;
    for (let attempt = 0; attempt < 4; attempt++) {
      response = await fetch(url, {headers});
      if (response.status !== 429 && response.status < 500) break;
      if (attempt === 3) break;
      await new Promise(done => setTimeout(done, 1000 * 2 ** attempt));
    }
    if (!response?.ok) throw new Error(`Alpaca SIP ${symbol} respondió HTTP ${response?.status ?? 'sin respuesta'}; sin cambio de feed.`);
    const data = await response.json() as {bars?: Array<{t: string; o: number; h: number;
      l: number; c: number; v: number}>; next_page_token?: string | null};
    const receivedAtUtc = new Date().toISOString();
    if (!Array.isArray(data.bars)) throw new Error('Respuesta Alpaca sin barras válidas.');
    for (const bar of data.bars) {
      const candle = {timestamp: new Date(bar.t).toISOString(), open: bar.o,
        high: bar.h, low: bar.l, close: bar.c, volume: bar.v};
      const fingerprint = canonicalBarHash(symbol, candle);
      const prior = seen.get(candle.timestamp);
      if (prior && prior !== fingerprint) throw new Error(`Duplicado SIP contradictorio: ${symbol} ${candle.timestamp}`);
      if (prior) continue;
      seen.set(candle.timestamp, fingerprint);
      receipts.push({symbol, candle, receivedAtUtc, provider: 'Alpaca Market Data API',
        feed: 'sip', adjustment: 'split', status: 'delayed',
        inputSha256: fingerprint});
    }
    page = data.next_page_token ?? null;
    if (page && tokens.has(page)) throw new Error('Paginación Alpaca cíclica.');
    if (page) tokens.add(page);
    if (++pages > 100) throw new Error('Paginación Alpaca demasiado larga.');
  } while (page);
  return receipts;
}

async function liveCalendar(now: string): Promise<MarketCalendar> {
  const headers = requireAlpacaKeys(process.env.APCA_API_KEY_ID, process.env.APCA_API_SECRET_KEY);
  const calendar = loadMarketCalendar(originalCalendar);
  const through = new Date(Date.parse(now) + 7 * 86_400_000).toISOString();
  const future = await fetchAlpacaCalendar({apiKey: headers['APCA-API-KEY-ID'],
    secretKey: headers['APCA-API-SECRET-KEY'],
    start: FORWARD_START, end: through});
  for (const [date, hours] of future) {
    if (calendar.has(date)) assert.deepEqual(calendar.get(date), hours);
    calendar.set(date, hours);
  }
  return calendar;
}

function eventsFromFile(): KnownEvent[] | null {
  const path = process.env.PHASE16_VERIFIED_EVENTS_FILE;
  if (!path) return null;
  const events = JSON.parse(readFileSync(path, 'utf8')) as KnownEvent[];
  if (!Array.isArray(events) || events.some(e => !e.id || !Number.isFinite(Date.parse(e.timestampUtc)) ||
    !Number.isFinite(Date.parse(e.verifiedAtUtc)))) throw new Error('Calendario de eventos no verificado.');
  return events;
}

async function ingest(now: string) {
  const calendar = await liveCalendar(now);
  const records = verifyLedger(publicRoot);
  const existingBars = new Map(records.filter(r => r.kind === 'bar_receipt').map(r => [r.id, r]));
  const map = new Map<string, BarReceipt>();
  for (const symbol of symbols) {
    for (const receipt of await fetchBars(symbol, now)) {
      const checked = validateBar(symbol, receipt.candle, receipt.receivedAtUtc, calendar);
      const id = barId(symbol, checked.candle.timestamp);
      const prior = existingBars.get(id);
      if (prior && prior.payload.inputSha256 !== checked.inputSha256) {
        throw new Error(`Barra SIP revisada; requiere corrección append-only: ${id}`);
      }
      const path = cachePath(symbol, checked.candle.timestamp);
      if (!existsSync(path)) {
        mkdirSync(join(privateRoot, 'bars', symbol, checked.candle.timestamp.slice(0, 10)), {recursive: true});
        writeFileSync(path, JSON.stringify(checked) + '\n', {flag: 'wx'});
      } else {
        const cached = JSON.parse(readFileSync(path, 'utf8')) as BarReceipt;
        if (cached.inputSha256 !== checked.inputSha256) throw new Error('Caché privada contradice Alpaca.');
      }
      map.set(id, prior ? {...checked,
        receivedAtUtc: String(prior.payload.receivedAtUtc)} : checked);
      if (!prior) {
        appendRecord(publicRoot, id, 'bar_receipt', {symbol,
          barStartUtc: checked.candle.timestamp,
          barCloseUtc: new Date(Date.parse(checked.candle.timestamp) + 900_000).toISOString(),
          receivedAtUtc: checked.receivedAtUtc, provider: checked.provider,
          feed: checked.feed, adjustment: checked.adjustment, status: checked.status,
          inputSha256: checked.inputSha256,
          historicalReferenceSha256: historicalHashes[symbol]},
        checked.receivedAtUtc);
      }
    }
  }
  return {calendar, receipts: map};
}

function allCandles(): Record<Symbol, Candle[]> {
  return Object.fromEntries(symbols.map(symbol => [symbol,
    [...baseCandles(symbol), ...loadCached(symbol).map(r => r.candle)]])) as Record<Symbol, Candle[]>;
}

async function observe() {
  const now = new Date().toISOString();
  if (now < FORWARD_START) {console.log(`Prospectivo aún no iniciado (${FORWARD_START}); use --dry-run.`); return;}
  const {calendar, receipts} = await ingest(now);
  const candles = allCandles();
  const events = eventsFromFile();
  let newSignals = 0, assessed = 0;
  const nvdaIndex = new Map(candles.NVDA.map((bar, index) => [bar.timestamp, index]));
  const availableThrough = Date.parse(now) - 900_000;
  for (const [date, hours] of [...calendar].sort(([a], [b]) => a.localeCompare(b))) {
    for (let local = hours.open; local < hours.close; local += 15) {
      const slot = `${String(Math.floor(local / 60)).padStart(2, '0')}:${String(local % 60).padStart(2, '0')}`;
      const timestamp = localEasternToUtc(date, slot);
      if (!timestamp || timestamp < FORWARD_START || Date.parse(timestamp) + 900_000 > availableThrough) continue;
      const id = `assessed:${timestamp}`;
    const priorAssessment = verifyLedger(publicRoot).find(r => r.id === id);
    if (priorAssessment && (priorAssessment.payload.coverage as Record<string, boolean>).NVDA) continue;
    const at = new Date().toISOString();
    const index = nvdaIndex.get(timestamp);
    const current = index === undefined ? null : candles.NVDA[index]!;
    if (priorAssessment && !current) continue;
    const priorSignals = verifyLedger(publicRoot).filter(r => r.kind === 'signal')
      .map(r => r.payload as unknown as ForwardSignal);
    const detected = current ? detectAt({nvdaPrefix: candles.NVDA.slice(0, index! + 1),
      qqq: candles.QQQ, smh: candles.SMH, calendar, receipts,
      generatedAtUtc: at, codeVersion, detectorHash, events, priorSignals,
      historical: Date.parse(at) - Date.parse(current.timestamp) > 86_400_000,
      recoveryReason: priorAssessment ? 'Vela NVDA ausente en evaluación anterior' :
        process.argv.find(arg => arg.startsWith('--recovery-reason='))
          ?.slice('--recovery-reason='.length) || null}) : [];
    for (const signal of detected) {
      appendRecord(publicRoot, `signal:${signal.id}`, 'signal', signal as unknown as Record<string, unknown>, at);
      newSignals++;
    }
    const qPresent = candles.QQQ.some(b => b.timestamp === timestamp);
    const sPresent = candles.SMH.some(b => b.timestamp === timestamp);
    const assessment = {assessment: true, nvdaStartUtc: timestamp, observedAtUtc: at,
      coverage: {NVDA: !!current, QQQ: qPresent, SMH: sPresent},
      status: current ? 'assessed' : 'missing_nvda', signalIds: detected.map(s => s.id)};
    if (priorAssessment) appendCorrection(publicRoot, id, `correction:${id}:nvda_recovered`,
      'Vela NVDA recibida tras hueco; detección recuperada, no observación a tiempo', assessment, at);
    else appendRecord(publicRoot, id, 'bar_assessment', assessment, at);
    assessed++;
    }
  }
  console.log(JSON.stringify({assessed, newSignals, journal: publicRoot,
    persistence: 'Commit/push del lote derivado requerido; OHLCV en caché privada'}));
}

async function settle() {
  const now = new Date().toISOString();
  if (now < FORWARD_START) {console.log('Sin observaciones prospectivas todavía.'); return;}
  const {calendar} = await ingest(now);
  const nvda = allCandles().NVDA;
  const records = verifyLedger(publicRoot);
  let appended = 0;
  for (const record of records.filter(r => r.kind === 'signal')) {
    const signal = record.payload as unknown as ForwardSignal;
    const outcomes = settleSignal(signal, nvda, calendar, now);
    for (const minutes of ['15', '30', '60']) {
      const value = outcomes.horizons[minutes] as Record<string, unknown>;
      if (value.state === 'pending') continue;
      const id = `settlement:${signal.id}:${minutes}`;
      if (records.some(r => r.id === id)) continue;
      appendRecord(publicRoot, id, 'settlement', {signalId: signal.id,
        horizonMinutes: Number(minutes), evaluatedAtUtc: now,
        theoreticalOnly: true, operationallyAvailable: outcomes.operationallyAvailable,
        operationalReason: outcomes.operationalReason, ...value});
      appended++;
    }
  }
  console.log(JSON.stringify({newSettlements: appended, journal: publicRoot}));
}

function journal(path: string) {
  const input = JSON.parse(readFileSync(path, 'utf8')) as HumanDecision;
  const now = new Date().toISOString();
  const decision = {...input, documentedAtUtc: now};
  const status = validateHumanDecision(decision, now);
  const id = `human:${hash(JSON.stringify(decision))}`;
  appendRecord(publicRoot, id, 'human_decision', {status, ...decision}, now);
  console.log(JSON.stringify({id, status}));
}

function compare() {
  const rows = verifyLedger(publicRoot);
  const allHuman = rows.filter(r => r.kind === 'human_decision');
  const human = allHuman.filter(r => r.payload.status === 'prospective')
    .map(r => r.payload as unknown as HumanDecision);
  const signals = rows.filter(r => r.kind === 'signal')
    .map(r => r.payload as unknown as ForwardSignal);
  const matched = new Set<number>(); let both = 0;
  for (const signal of signals) {
    const index = human.findIndex((d, i) => !matched.has(i) && matchHumanSignal(signal, d) === 'both');
    if (index >= 0) {matched.add(index); both++;}
  }
  console.log(JSON.stringify({both, systemOnly: signals.length - both,
    humanOnly: human.filter((h, i) => !matched.has(i) && h.direction !== 'no_trade').length,
    noTrade: human.filter(h => h.direction === 'no_trade').length,
    retrospectiveAnnotations: allHuman.filter(r => r.payload.status === 'retrospective').length,
    timingUnverified: allHuman.filter(r => r.payload.status === 'timing_unverified').length,
    operatorCoverageKnown: human.filter(h => h.observedMarket === true).length,
    caveat: 'Ausencia de diario humano no implica rechazo.'}));
}

const command = process.argv[2];
if (command === 'observe') await observe();
else if (command === 'settle') await settle();
else if (command === 'journal' && process.argv[3]) journal(process.argv[3]);
else if (command === 'compare') compare();
else throw new Error('Uso: phase16-cli.ts observe|settle|journal <json>|compare');
