import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {importPhase14Symbol, type Phase14Symbol} from './phase14-import.ts';

const directory = fileURLToPath(new URL('../data/', import.meta.url));
const key = process.env.APCA_API_KEY_ID, secret = process.env.APCA_API_SECRET_KEY;
if (!key || !secret) throw new Error('Faltan APCA_API_KEY_ID o APCA_API_SECRET_KEY en el entorno seguro.');
for (const symbol of ['QQQ', 'SMH'] as Phase14Symbol[]) {
  const result = await importPhase14Symbol({symbol, outputDirectory: directory,
    nvdaCalendarPath: join(directory, 'NVDA_ALPACA_SIP_15min_20211017_20261017.csv.calendar.json'),
    apiKey: key, secretKey: secret});
  console.log(`${symbol}: ${result.candles.length} velas; ` +
    `${result.coverage.observedSessions}/${result.coverage.calendarSessions} sesiones; ` +
    `${result.coverage.partialSessions.length} parciales; ` +
    `${result.resumedChunks} fragmentos reanudados; ` +
    `${result.duplicateBars} duplicados idénticos; ${result.alreadyComplete ? 'existente' : 'adquirido'}.`);
}
