import {config as loadEnv} from 'dotenv';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AlpacaCalendarError, fetchAlpacaCalendar, saveMarketCalendar} from './alpaca-calendar.ts';
import {AlpacaCaptureError, delayedCaptureWindow, fetchAlpacaCaptureBars} from './alpaca.ts';
import {appendIngestionStatus, appendSuccessfulCapture, validateCapture} from './phase32-ingestion.ts';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
loadEnv({path: resolve(repoRoot, '.env.local'), override: false, quiet: true});
loadEnv({path: resolve(repoRoot, '.env'), override: false, quiet: true});
const args = process.argv.slice(2);
const value = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const interval = value('--every-seconds');
const requestedDelay = value('--delay-minutes');
const optionWithValue = ['--every-seconds', '--delay-minutes', '--log'];
if (args.some((arg, index) => optionWithValue.includes(arg) && (!args[index + 1] || args[index + 1]!.startsWith('--'))) ||
    (args.some(arg => !['--once', ...optionWithValue].includes(arg)) && !args.some((arg, index) => index > 0 && optionWithValue.includes(args[index - 1]!)))) {
  throw new Error('Uso: npm run alpaca:ingest -- [--once] [--delay-minutes 20] [--every-seconds 60] [--log ruta-privada].');
}
const repeatSeconds = interval === undefined ? undefined : Number(interval);
if (repeatSeconds !== undefined && (!Number.isInteger(repeatSeconds) || repeatSeconds < 60)) throw new Error('--every-seconds debe ser un entero de al menos 60.');
const delayMinutes = requestedDelay === undefined ? 20 : Number(requestedDelay);
if (!Number.isInteger(delayMinutes) || delayMinutes < 20) throw new Error('--delay-minutes debe ser un entero de al menos 20.');
const ledgerPath = value('--log') ?? process.env.TRADING_POC_ALPACA_INGESTION_LOG ?? resolve(repoRoot, 'private', 'alpaca-ingestion', 'ledger.jsonl');
// The calendar is provenance metadata for the private ledger, not an alternate
// price source. The forward observer refuses to operate if it is unavailable.
const calendarPath = process.env.TRADING_POC_ALPACA_INGESTION_CALENDAR ?? `${ledgerPath}.calendar.json`;
const key = process.env.APCA_API_KEY_ID ?? '', secret = process.env.APCA_API_SECRET_KEY ?? '';

async function once(): Promise<void> {
  const window = delayedCaptureWindow(Date.now(), delayMinutes);
  const startUtc = window.start, endUtc = window.end;
  try {
    const calendar = await fetchAlpacaCalendar({apiKey: key, secretKey: secret, start: startUtc, end: endUtc});
    saveMarketCalendar(calendarPath, calendar);
    const result = await fetchAlpacaCaptureBars({apiKey: key, secretKey: secret, start: startUtc, end: endUtc, calendar, minimumBarAgeMs: window.delayMs});
    validateCapture(result.candles, calendar, result.receivedAtUtc, Date.now, window.delayMs, result.queryAtUtc);
    const appended = appendSuccessfulCapture(ledgerPath, result);
    const latest = result.candles.at(-1);
    const closeUtc = latest ? new Date(Date.parse(latest.timestamp) + 15 * 60_000).toISOString() : 'N/D';
    process.stdout.write(`Alpaca SIP NVDA 15Min: consulta ${result.queryAtUtc}, recepción ${result.receivedAtUtc}, último cierre ${closeUtc}, retraso efectivo ${Number.isFinite(result.effectiveDelayMs) ? Math.round(result.effectiveDelayMs / 60_000) : 'N/D'} min; ${result.candles.length} velas, ${appended.barsAdded} nuevas/revisadas, disponibilidad ${result.availability}.\n`);
  } catch (error) {
    const state = error instanceof AlpacaCaptureError || error instanceof AlpacaCalendarError ? error.status : 'INVALID_DATA';
    const stage = error instanceof AlpacaCalendarError ? 'Calendario' : error instanceof AlpacaCaptureError ? 'Market Data' : 'Validación local';
    appendIngestionStatus(ledgerPath, state, `${stage}: ${error instanceof Error ? error.message : 'Error de ingesta Alpaca.'}`);
    throw error;
  }
}

let stopped = false, active = false;
async function run(): Promise<void> { if (active || stopped) return; active = true; try { await once(); } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); if (repeatSeconds === undefined) process.exitCode = 1; } finally { active = false; } }
if (repeatSeconds === undefined) { await run(); }
else {
  await run();
  const timer = setInterval(() => void run(), repeatSeconds * 1000);
  const stop = () => { stopped = true; clearInterval(timer); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
