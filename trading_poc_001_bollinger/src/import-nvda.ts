import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {alpacaNvdaMetadata, fetchAlpacaBars, historicalWindow} from './alpaca.ts';
import {fetchAlpacaCalendar, saveMarketCalendar} from './alpaca-calendar.ts';
import {serializeCandles} from './csv.ts';
import {saveMetadata} from './data-contract.ts';

const apiKey = process.env.APCA_API_KEY_ID ?? '';
const secretKey = process.env.APCA_API_SECRET_KEY ?? '';
if (!apiKey || !secretKey) {
  console.error('Configure APCA_API_KEY_ID y APCA_API_SECRET_KEY en variables de entorno.');
  process.exitCode = 1;
} else {
  try {
    const window = historicalWindow(Date.now(), 12, 15);
    const calendar = await fetchAlpacaCalendar({apiKey, secretKey, ...window});
    const candles = await fetchAlpacaBars({apiKey, secretKey, ...window,
      metadata: alpacaNvdaMetadata, calendar});
    const directory = fileURLToPath(new URL('../data/', import.meta.url));
    const filePath = fileURLToPath(new URL('../data/NVDA_ALPACA_SIP_15min_12m.csv', import.meta.url));
    mkdirSync(directory, {recursive: true});
    writeFileSync(filePath, serializeCandles(candles));
    saveMetadata(filePath, alpacaNvdaMetadata);
    saveMarketCalendar(`${filePath}.calendar.json`, calendar);
    console.log(`Guardadas ${candles.length} velas NVDA SIP de 15 minutos en ${filePath}.`);
    console.log(`Ventana solicitada: ${window.start} a ${window.end} (inicio UTC de cada vela).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
