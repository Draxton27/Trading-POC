import {fileURLToPath} from 'node:url';
import {importNvdaHistory, parseHistoryRange} from './nvda-history.ts';

try {
  const range = parseHistoryRange(process.argv.slice(2));
  const apiKey = process.env.APCA_API_KEY_ID;
  const secretKey = process.env.APCA_API_SECRET_KEY;
  if (!apiKey || !secretKey) throw new Error('Faltan APCA_API_KEY_ID o APCA_API_SECRET_KEY en el entorno seguro.');
  const outputDirectory = fileURLToPath(new URL('../data/', import.meta.url));
  const result = await importNvdaHistory({range, outputDirectory, apiKey, secretKey});
  console.log(`Guardadas ${result.candles} velas NVDA en ${result.filePath}.`);
  console.log(`Sesiones: ${result.coverage.observedSessions}/${result.coverage.calendarSessions}; `+
    `${result.coverage.partialSessions.length} parciales, ${result.coverage.missingSessions.length} ausentes.`);
  console.log(`Fragmentos reanudados: ${result.resumedChunks}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
