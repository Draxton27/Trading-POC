import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {alpacaMetadata, fetchAlpacaBars, historicalWindow} from './alpaca.ts';
import {serializeCandles} from './csv.ts';
import {saveMetadata} from './data-contract.ts';

const apiKey = process.env.APCA_API_KEY_ID ?? '';
const secretKey = process.env.APCA_API_SECRET_KEY ?? '';
if (!apiKey || !secretKey) {
  console.error('Configure APCA_API_KEY_ID y APCA_API_SECRET_KEY en variables de entorno.');
  process.exitCode = 1;
} else {
  try {
    const window = historicalWindow();
    const candles = await fetchAlpacaBars({apiKey, secretKey, ...window});
    const filePath = fileURLToPath(new URL('../data/QQQ_ALPACA_SIP_5min.csv', import.meta.url));
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
