import {existsSync} from 'node:fs';
import {MlIngestionStatus, type MlIngestionStatus as Status} from '@trading-poc/contracts';
import {availabilityForBarEnd, readIngestion} from '../../../../trading_poc_001_bollinger/src/phase32-ingestion.ts';

/** Read-only projection of the Phase 32 append-only ledger. Freshness is recomputed on every request. */
export function readAlpacaIngestionStatus(logPath: string | undefined, clock: () => number = Date.now): Status {
  const absent = (status: Status['status'], reason: string) => MlIngestionStatus.parse({status, provider: 'Alpaca Market Data API', feed: 'sip', adjustment: 'split', availability: 'UNAVAILABLE', lastBarStartUtc: null, lastBarEndUtc: null, receivedAtUtc: null, effectiveDelayMs: null, revision: null, lastAttemptAtUtc: null, lastSuccessfulQueryAtUtc: null, lastBarReceivedAtUtc: null, lastBarAvailability: 'UNAVAILABLE', reason});
  if (!logPath || !existsSync(logPath)) return absent('NOT_CONFIGURED', 'No existe todavía un libro local de ingesta Alpaca SIP.');
  try {
    const records = readIngestion(logPath), attempt = records.at(-1);
    if (!attempt) return absent('NO_DATA', 'El libro local de ingesta está vacío.');
    const bar = records.filter(record => record.kind === 'bar' && record.bar !== null).at(-1);
    // Old Phase 32 records have no query row; their latest bar remains a compatible successful query proxy.
    const successful = records.filter(record => record.kind === 'query').at(-1) ?? bar;
    const lastBarAvailability = bar?.bar ? availabilityForBarEnd(bar.bar.endUtc, clock()) : 'UNAVAILABLE';
    const effectiveDelayMs = bar?.bar ? Math.max(0, clock() - Date.parse(bar.bar.endUtc)) : null;
    const error = ['PERMISSION_DENIED', 'RATE_LIMIT', 'HTTP_ERROR', 'NETWORK_ERROR', 'INVALID_DATA'].includes(attempt.status);
    const status = error ? attempt.status : bar ? (lastBarAvailability === 'CURRENT' ? 'READY' : 'DELAYED') : attempt.status;
    return MlIngestionStatus.parse({status, provider: attempt.provider, feed: attempt.feed, adjustment: attempt.adjustment,
      availability: lastBarAvailability, lastBarStartUtc: bar?.bar?.startUtc ?? null, lastBarEndUtc: bar?.bar?.endUtc ?? null,
      // Backward-compatible alias for last-bar receipt, never a claim that it is current.
      receivedAtUtc: bar?.receivedAtUtc ?? null, effectiveDelayMs, revision: bar?.bar?.revision ?? null,
      lastAttemptAtUtc: attempt.queryAtUtc ?? attempt.receivedAtUtc, lastSuccessfulQueryAtUtc: successful?.queryAtUtc ?? successful?.receivedAtUtc ?? null,
      lastBarReceivedAtUtc: bar?.receivedAtUtc ?? null, lastBarAvailability, reason: attempt.detail});
  } catch { return absent('INVALID_DATA', 'El libro local de ingesta no superó la verificación de integridad.'); }
}
