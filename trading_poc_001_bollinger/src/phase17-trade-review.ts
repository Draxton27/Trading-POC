import {compareHumanToSignals, humanFromLedger} from './phase17-comparison.ts';
import type {BrokerStoreState} from './phase17-broker-store.ts';
import type {ForwardSignal} from './phase16-engine.ts';
import type {LedgerRecord} from './phase16-ledger.ts';
import type {Phase17Extension} from './phase17-journal.ts';

export type TradeCase = {decisionId: string; recordClass: string;
  decisionAtUtc: string; documentedAtUtc: string;
  decisionView: {symbol: string; direction: string; operationType: string;
    contextKnownAtUtc: string | null; contextVerification: string;
    context: Record<string, unknown> | null; chartCaptureId: string | null};
  signalReferences: Array<{signalId: string; confirmedAtUtc: string;
    firstDetectedAtUtc: string; knownAtDecision: boolean}>;
  status: 'no_trade' | 'unlinked' | 'incomplete_links' | 'multiple_positions' |
    'partially_open' | 'closed';
  positionId: string | null; occSymbol: string | null;
  linkedExecutionIds: string[]; sourceHashesByExecution: Record<string, string[]>;
  firstPurchaseAtUtc: string | null; lastSaleAtUtc: string | null;
  resultAvailableInStoreAtUtc: string | null;
  documentedBeforeFirstPurchase: boolean | null;
  boughtQuantity: number | null; soldQuantity: number | null;
  remainingQuantity: number | null; realizedGross: number | null;
  realizedCommission: number | null; realizedNet: number | null;
  exitNotes: Array<{noteId: string; documentedAtUtc: string; reason: string}>;
  planChanges: Array<{noteId: string; declaredAtUtc: string; documentedAtUtc: string;
    reason: string; profitObjective: string | null; lossLimit: string | null;
    documentedBeforeLastSale: boolean | null}>;
  limitations: string[]};

export function buildTradeCases(records: readonly LedgerRecord[], broker: BrokerStoreState,
  signals: readonly ForwardSignal[] = []): TradeCase[] {
  const human = humanFromLedger(records);
  const comparisons = compareHumanToSignals(signals, human);
  const sources = new Map(broker.sourceFiles.map(source => [source.sourceSha256, source]));
  const fills = new Map(broker.fills.map(fill => [fill.executionId, fill]));
  const positionsById = new Map(broker.positions.flatMap(position =>
    [...position.buyExecutionIds, ...position.sellExecutionIds].map(id =>
      [id, position] as const)));
  return human.filter(row => !row.phase17.relatedDecisionId).map(original => {
    const related = human.filter(row => row.phase17.relatedDecisionId === original.id);
    const linkedExecutionIds = [...new Set(related.flatMap(row =>
      row.phase17.linkedExecutionIds ?? []))].sort();
    const positionIds = new Set(linkedExecutionIds.map(id => positionsById.get(id)?.positionId)
      .filter((id): id is string => !!id));
    const position = positionIds.size === 1 ? broker.positions.find(row =>
      row.positionId === [...positionIds][0]) ?? null : null;
    const expected = position ? [...position.buyExecutionIds, ...position.sellExecutionIds] : [];
    const complete = !!position && expected.length === linkedExecutionIds.length &&
      expected.every(id => linkedExecutionIds.includes(id));
    const lastSaleAtUtc = position?.closedAtUtc ??
      linkedExecutionIds.map(id => fills.get(id)).filter(fill => fill?.side === 'SELL')
        .map(fill => fill!.executedAtUtc)
        .sort((a,b) => Date.parse(a)-Date.parse(b)).at(-1) ?? null;
    const sourceHashesByExecution = Object.fromEntries(linkedExecutionIds.map(id =>
      [id, broker.executionSources[id] ?? []]));
    const firstReceiptTimes = linkedExecutionIds.map(id =>
      (broker.executionSources[id] ?? []).map(hash => sources.get(hash)?.importedAtUtc)
        .filter((at): at is string => !!at)
        .sort((a,b) => Date.parse(a)-Date.parse(b))[0]).filter((at): at is string => !!at);
    const resultAvailableInStoreAtUtc = firstReceiptTimes.sort((a,b) =>
      Date.parse(a)-Date.parse(b)).at(-1) ?? null;
    const contextKnown = original.phase17.contextKnownAtUtc &&
      Date.parse(original.phase17.contextKnownAtUtc) <= Date.parse(original.decision.decisionAtUtc);
    const signalReferences = comparisons.filter(row => row.humanDecisionId === original.id &&
      row.signalId !== null).map(row => {
      const signal = signals.find(item => item.id === row.signalId)!;
      return {signalId: signal.id, confirmedAtUtc: signal.availableAtUtc,
        firstDetectedAtUtc: signal.firstDetectedAtUtc,
        knownAtDecision: row.decisionView.signalKnownAtDecision};
    });
    const exitNotes = related.filter(row => !!row.phase17.exitReason).map(row =>
      ({noteId: row.id, documentedAtUtc: row.decision.documentedAtUtc,
        reason: row.phase17.exitReason!}));
    const planChanges = related.filter(row => !!row.phase17.planChangedAtUtc).map(row =>
      ({noteId: row.id, declaredAtUtc: row.phase17.planChangedAtUtc!,
        documentedAtUtc: row.decision.documentedAtUtc,
        reason: row.phase17.planChangeReason!,
        profitObjective: row.phase17.profitObjective,
        lossLimit: row.phase17.lossLimit,
        documentedBeforeLastSale: lastSaleAtUtc ?
          Date.parse(row.decision.documentedAtUtc) <= Date.parse(lastSaleAtUtc) : null}));
    const noTrade = original.decision.direction === 'no_trade';
    const status: TradeCase['status'] = noTrade ? 'no_trade' :
      !linkedExecutionIds.length ? 'unlinked' :
      positionIds.size > 1 ? 'multiple_positions' :
      !complete ? 'incomplete_links' :
      position!.remainingQuantity ? 'partially_open' : 'closed';
    const limitations: string[] = [];
    if (!contextKnown) limitations.push('Contexto inicial sin hora de adquisición verificada; oculto en vista de decisión.');
    if (original.recordClass !== 'live_before_primary_outcome') {
      limitations.push('Decisión reconstruida o documentada después del resultado de referencia.');
    }
    if (linkedExecutionIds.length && !complete) {
      limitations.push('Faltan IDs de fills o se vincularon varias posiciones; no se calcula resultado agregado.');
    }
    if (position && Date.parse(original.decision.documentedAtUtc) >
        Date.parse(position.boughtAtUtc)) {
      limitations.push('La decisión fue documentada después de la primera compra; no prueba selección prospectiva.');
    }
    return {decisionId: original.id, recordClass: original.recordClass,
      decisionAtUtc: original.decision.decisionAtUtc,
      documentedAtUtc: original.decision.documentedAtUtc,
      decisionView: {symbol: original.decision.symbol,
        direction: original.decision.direction,
        operationType: original.decision.operationType,
        contextKnownAtUtc: original.phase17.contextKnownAtUtc ?? null,
        contextVerification: contextKnown ? 'self_reported_time_unverified' : 'unknown',
        context: contextKnown ? {sma20: original.decision.sma20,
          sma40: original.decision.sma40, sma100: original.decision.sma100,
          sma200: original.decision.sma200,
          trendInterpretation: original.phase17.trendInterpretation,
          manualLevels: original.phase17.manualLevels.filter(level =>
            level.drawnAtUtc && Date.parse(level.drawnAtUtc) <=
              Date.parse(original.decision.decisionAtUtc)),
          awaitedConfirmation: original.phase17.awaitedConfirmation} : null,
        chartCaptureId: original.decision.chartCaptureId &&
          original.phase17.chartCapturedAtUtc &&
          Date.parse(original.phase17.chartCapturedAtUtc) <=
            Date.parse(original.decision.decisionAtUtc) ?
          original.decision.chartCaptureId : null},
      signalReferences, status,
      positionId: complete ? position!.positionId : null,
      occSymbol: complete ? position!.occSymbol :
        original.phase17.contractOccSymbol ?? null,
      linkedExecutionIds, sourceHashesByExecution,
      firstPurchaseAtUtc: complete ? position!.boughtAtUtc : null,
      lastSaleAtUtc: complete ? lastSaleAtUtc : null,
      resultAvailableInStoreAtUtc: complete ? resultAvailableInStoreAtUtc : null,
      documentedBeforeFirstPurchase: complete ?
        Date.parse(original.decision.documentedAtUtc) <= Date.parse(position!.boughtAtUtc) : null,
      boughtQuantity: complete ? position!.boughtQuantity : null,
      soldQuantity: complete ? position!.soldQuantity : null,
      remainingQuantity: complete ? position!.remainingQuantity : null,
      realizedGross: complete ? position!.realizedGross : null,
      realizedCommission: complete ? position!.realizedCommission : null,
      realizedNet: complete ? position!.realizedNet : null,
      exitNotes, planChanges, limitations};
  });
}
