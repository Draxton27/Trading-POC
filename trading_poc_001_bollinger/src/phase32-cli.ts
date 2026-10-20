import {config as loadEnv} from 'dotenv';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fetchAlpacaCalendar} from './alpaca-calendar.ts';
import {AlpacaCaptureError, fetchAlpacaCaptureBars} from './alpaca.ts';
import {appendIngestion, appendIngestionStatus, readIngestion, recordsForCapture, validateCapture} from './phase32-ingestion.ts';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
loadEnv({path: resolve(repoRoot, '.env.local'), override: false, quiet: true});
loadEnv({path: resolve(repoRoot, '.env'), override: false, quiet: true});
const args = process.argv.slice(2);
const value = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const interval = value('--every-seconds');
if (args.some(arg => !['--once', '--every-seconds', '--log'].includes(arg)) && !args.some((arg, index) => index > 0 && ['--every-seconds', '--log'].includes(args[index - 1]!))) {
  throw new Error('Uso: npm run alpaca:ingest -- [--once] [--every-seconds 60] [--log ruta-privada].');
}
const repeatSeconds = interval === undefined ? undefined : Number(interval);
if (repeatSeconds !== undefined && (!Number.isInteger(repeatSeconds) || repeatSeconds < 60)) throw new Error('--every-seconds debe ser un entero de al menos 60.');
const ledgerPath = value('--log') ?? process.env.TRADING_POC_ALPACA_INGESTION_LOG ?? resolve(repoRoot, 'private', 'alpaca-ingestion', 'ledger.jsonl');
const key = process.env.APCA_API_KEY_ID ?? '', secret = process.env.APCA_API_SECRET_KEY ?? '';

async function once(): Promise<void> {
  const now = Date.now(), end = Math.floor(now / (15 * 60_000)) * 15 * 60_000, start = end - 40 * 60 * 60_000;
  const startUtc = new Date(start).toISOString(), endUtc = new Date(end).toISOString();
  try {
    const calendar = await fetchAlpacaCalendar({apiKey: key, secretKey: secret, start: startUtc, end: endUtc});
    const result = await fetchAlpacaCaptureBars({apiKey: key, secretKey: secret, start: startUtc, end: endUtc, now, calendar});
    validateCapture(result.candles, calendar, result.receivedAtUtc);
    if (!result.candles.length) {
      appendIngestionStatus(ledgerPath, 'NO_DATA', 'Alpaca SIP no devolvió velas cerradas de sesión regular para la ventana solicitada.', result.receivedAtUtc);
      process.stdout.write(`Alpaca SIP: sin velas cerradas; registro ${ledgerPath}\n`); return;
    }
    const entries = recordsForCapture(result.candles, result.receivedAtUtc, result.responseSha256, result.availability, result.effectiveDelayMs, readIngestion(ledgerPath));
    const appended = appendIngestion(ledgerPath, entries);
    process.stdout.write(`Alpaca SIP NVDA 15Min split: ${result.candles.length} velas, ${appended.records.length} nuevas/revisadas, disponibilidad ${result.availability}.\n`);
  } catch (error) {
    const state = error instanceof AlpacaCaptureError ? error.status : 'INVALID_DATA';
    appendIngestionStatus(ledgerPath, state, error instanceof Error ? error.message : 'Error de ingesta Alpaca.');
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
