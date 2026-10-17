import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {alpacaMetadata, fetchAlpacaBars, historicalWindow, parseHistoryMonths} from './alpaca.ts';
import {fetchAlpacaCalendar} from './alpaca-calendar.ts';
import {serializeCandles} from './csv.ts';
import {saveMetadata} from './data-contract.ts';

const apiKey = process.env.APCA_API_KEY_ID ?? '';
const secretKey = process.env.APCA_API_SECRET_KEY ?? '';
const months = parseHistoryMonths(process.argv.slice(2));
if (!apiKey || !secretKey) {
  console.error('Configure APCA_API_KEY_ID y APCA_API_SECRET_KEY en variables de entorno.');
  process.exitCode = 1;
} else {
  try {
    const window = historicalWindow(Date.now(), months);
    const calendar = months === 3 ? undefined : await fetchAlpacaCalendar({apiKey, secretKey, ...window});
    const candles = await fetchAlpacaBars({apiKey, secretKey, ...window, calendar});
    const suffix = months === 3 ? '' : `_${months}m`;
    const filePath = fileURLToPath(new URL(`../data/QQQ_ALPACA_SIP_5min${suffix}.csv`, import.meta.url));
    mkdirSync(fileURLToPath(new URL('../data/', import.meta.url)), {recursive: true});
    writeFileSync(filePath, serializeCandles(candles));
    saveMetadata(filePath, alpacaMetadata);
    console.log(`Guardadas ${candles.length} velas QQQ SIP de 5 minutos en ${filePath}.`);
    console.log(`Ventana solicitada: ${window.start} a ${window.end} (inicio UTC de cada vela).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
