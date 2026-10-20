import {existsSync} from 'node:fs';
import {MlIngestionStatus, type MlIngestionStatus as Status} from '@trading-poc/contracts';
import {readIngestion} from '../../../../trading_poc_001_bollinger/src/phase32-ingestion.ts';

/** Read-only projection of the Phase 32 append-only ledger. */
export function readAlpacaIngestionStatus(logPath: string | undefined): Status {
  const absent = (status: Status['status'], reason: string) => MlIngestionStatus.parse({status, provider: 'Alpaca Market Data API', feed: 'sip', adjustment: 'split', availability: 'UNAVAILABLE', lastBarStartUtc: null, lastBarEndUtc: null, receivedAtUtc: null, effectiveDelayMs: null, revision: null, reason});
  if (!logPath || !existsSync(logPath)) return absent('NOT_CONFIGURED', 'No existe todavía un libro local de ingesta Alpaca SIP.');
  try {
    const records = readIngestion(logPath), row = records.at(-1);
    if (!row) return absent('NO_DATA', 'El libro local de ingesta está vacío.');
    const bar = row.bar ? row : records.filter(record => record.bar !== null).at(-1);
    return MlIngestionStatus.parse({status: row.status, provider: row.provider, feed: row.feed, adjustment: row.adjustment, availability: row.availability,
      lastBarStartUtc: bar?.bar?.startUtc ?? null, lastBarEndUtc: bar?.bar?.endUtc ?? null, receivedAtUtc: bar?.receivedAtUtc ?? null,
      effectiveDelayMs: bar?.effectiveDelayMs ?? null, revision: bar?.bar?.revision ?? null, reason: row.detail});
  } catch { return absent('INVALID_DATA', 'El libro local de ingesta no superó la verificación de integridad.'); }
}
