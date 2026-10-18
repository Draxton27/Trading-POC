import {matchHumanSignal, type LedgerRecord, type HumanDecision} from './phase16-ledger.ts';
import type {ForwardSignal} from './phase16-engine.ts';
import type {Phase17Extension} from './phase17-journal.ts';

export type ComparedHuman = {id: string; recordClass: string;
  decision: HumanDecision; phase17: Phase17Extension};
export type ComparisonStatus = 'both' | 'human_only' | 'explicit_rejection' |
  'no_trade' | 'system_only' | 'insufficient';
export type DecisionView = {atUtc: string; humanDecisionId: string | null;
  signalId: string | null; signalKnownAtDecision: boolean;
  signalContext: {family: string; direction: string; availableAtUtc: string;
    indicators: Record<string, number | string | null>; regime: string;
    marketGroup: string; knownEventIds: string[]} | null};
export type ComparisonRow = {status: ComparisonStatus; signalId: string | null;
  humanDecisionId: string | null; decisionView: DecisionView; reason: string};

export function humanFromLedger(records: readonly LedgerRecord[]): ComparedHuman[] {
  return records.filter(record => record.kind === 'human_decision' &&
      record.payload.phase17 !== undefined).map(record => {
    const payload = record.payload;
    return {id: record.id, recordClass: String(payload.recordClass),
      decision: payload as unknown as HumanDecision,
      phase17: payload.phase17 as Phase17Extension};
  });
}

function view(signal: ForwardSignal | null, human: ComparedHuman | null,
  atUtc: string): DecisionView {
  const known = !!signal && signal.availableAtUtc <= atUtc &&
    signal.firstDetectedAtUtc <= atUtc;
  return {atUtc, humanDecisionId: human?.id ?? null,
    signalId: known ? signal!.id : null, signalKnownAtDecision: known,
    signalContext: known ? {family: signal!.family, direction: signal!.direction,
      availableAtUtc: signal!.availableAtUtc, indicators: signal!.indicators,
      regime: signal!.regime, marketGroup: signal!.marketGroup,
      knownEventIds: signal!.knownEventIds} : null};
}

export function compareHumanToSignals(signals: readonly ForwardSignal[],
  humans: readonly ComparedHuman[]): ComparisonRow[] {
  const rows: ComparisonRow[] = [];
  const used = new Set<string>();
  const primary = humans.filter(h => !h.phase17.relatedDecisionId);
  const live = primary.filter(h => h.recordClass === 'live_before_primary_outcome');
  for (const signal of [...signals].sort((a, b) => a.availableAtUtc.localeCompare(b.availableAtUtc) ||
    a.id.localeCompare(b.id))) {
    const candidates = live.filter(h => !used.has(h.id) &&
      h.decision.direction !== 'no_trade' &&
      matchHumanSignal(signal, h.decision) === 'both')
      .sort((a, b) => Math.abs(Date.parse(a.decision.decisionAtUtc) -
        Date.parse(signal.availableAtUtc)) -
        Math.abs(Date.parse(b.decision.decisionAtUtc) -
          Date.parse(signal.availableAtUtc)) || a.id.localeCompare(b.id));
    const matched = candidates[0];
    if (matched) {
      used.add(matched.id);
      rows.push({status: 'both', signalId: signal.id,
        humanDecisionId: matched.id,
        decisionView: view(signal, matched, matched.decision.decisionAtUtc),
        reason: 'Mismo símbolo, dirección y tipo dentro de ±15 minutos.'});
      continue;
    }
    const rejection = live.find(h => h.decision.direction === 'no_trade' &&
      h.decision.observedMarket === true &&
      h.phase17.rejectedSignalIds.includes(signal.id) &&
      h.decision.decisionAtUtc >= signal.firstDetectedAtUtc &&
      h.decision.documentedAtUtc >= signal.firstDetectedAtUtc &&
      h.decision.documentedAtUtc < signal.primaryOutcomeEndUtc);
    if (rejection) {
      rows.push({status: 'explicit_rejection', signalId: signal.id,
        humanDecisionId: rejection.id,
        decisionView: view(signal, rejection, rejection.decision.decisionAtUtc),
        reason: 'No operar con ID de señal rechazado explícitamente.'});
      continue;
    }
    const covered = live.some(h => h.decision.observedMarket === true &&
      Math.abs(Date.parse(h.decision.decisionAtUtc) -
        Date.parse(signal.availableAtUtc)) <= 900_000);
    rows.push({status: covered ? 'system_only' : 'insufficient',
      signalId: signal.id, humanDecisionId: null,
      decisionView: view(signal, null, signal.firstDetectedAtUtc),
      reason: covered ? 'Mercado observado; sin decisión coincidente ni rechazo explícito.' :
        'No hay cobertura humana comprobada; ausencia de diario no es rechazo.'});
  }
  for (const human of primary) {
    if (human.decision.direction === 'no_trade') {
      rows.push({status: 'no_trade', signalId: null,
        humanDecisionId: human.id,
        decisionView: view(null, human, human.decision.decisionAtUtc),
        reason: human.recordClass === 'live_before_primary_outcome' ?
          'Decisión de no operar registrada antes del resultado principal.' :
          'Anotación de no operar no prospectiva.'});
    } else if (!used.has(human.id)) {
      const qualified = human.recordClass === 'live_before_primary_outcome' &&
        human.decision.observedMarket === true;
      rows.push({status: qualified ? 'human_only' : 'insufficient',
        signalId: null, humanDecisionId: human.id,
        decisionView: view(null, human, human.decision.decisionAtUtc),
        reason: qualified ? 'Decisión humana sin señal congelada compatible.' :
          'Cobertura o anterioridad humana no demostrada.'});
    }
  }
  return rows;
}
