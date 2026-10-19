import {appendRecord, HUMAN_TEMPLATE_COLUMNS, humanReferenceOutcomeEnd,
  parseHumanDecisionCsv, sha256, validateHumanDecision, verifyLedger,
  type HumanDecision, type LedgerRecord} from './phase16-ledger.ts';
import {parseCsvRows} from './phase17-csv.ts';
import {parseOccSymbol} from './phase17-occ.ts';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {readBrokerStore} from './phase17-broker-store.ts';

export const PHASE17_EXTRA_COLUMNS = ['recordMode','reviewedTimeframes','trendInterpretation',
  'manualLevelsDescription','manualLevelsJson','awaitedConfirmation',
  'invalidationCondition','contractOccSymbol','contractSelectionReason',
  'strikeReason','expirationReason','profitObjective','lossLimit',
  'chartCapturedAtUtc','chartSha256','manualChartAnnotations','rejectedSignalIds',
  'relatedDecisionId'] as const;
export const PHASE17_FOLLOWUP_COLUMNS = ['contextKnownAtUtc','linkedExecutionIds',
  'exitReason','planChangedAtUtc','planChangeReason'] as const;
export const PHASE17_V1_COLUMNS = [...HUMAN_TEMPLATE_COLUMNS, ...PHASE17_EXTRA_COLUMNS];
export const PHASE17_TEMPLATE_COLUMNS = [...PHASE17_V1_COLUMNS, ...PHASE17_FOLLOWUP_COLUMNS];
export type RecordMode = 'live' | 'historical_reconstruction' | 'post_outcome_annotation';
export type ManualLevel = {kind: 'support' | 'resistance' | 'zone'; label: string;
  lower: number; upper: number; drawnAtUtc: string | null};
export type Phase17Extension = {recordMode: RecordMode; reviewedTimeframes: string[];
  trendInterpretation: string | null; manualLevelsDescription: string | null;
  manualLevels: ManualLevel[]; awaitedConfirmation: string | null;
  invalidationCondition: string | null; contractOccSymbol: string | null;
  contractSelectionReason: string | null; strikeReason: string | null;
  expirationReason: string | null; profitObjective: string | null;
  lossLimit: string | null; chartCapturedAtUtc: string | null;
  chartSha256: string | null; manualChartAnnotations: string | null;
  rejectedSignalIds: string[]; relatedDecisionId: string | null;
  contextKnownAtUtc: string | null; linkedExecutionIds: string[];
  exitReason: string | null; planChangedAtUtc: string | null;
  planChangeReason: string | null};
export type Phase17Decision = {decision: HumanDecision; extension: Phase17Extension};
const optional = (value: string) => value.trim() || null;
const splitList = (value: string) => value.split('|').map(x => x.trim()).filter(Boolean);
const validUtc = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);

function parseLevels(value: string): ManualLevel[] {
  if (!value.trim()) return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error('manualLevelsJson requiere un arreglo.');
  return parsed.map((item: unknown) => {
    const row = item as Partial<ManualLevel>;
    if (!row || !['support','resistance','zone'].includes(String(row.kind)) ||
        typeof row.label !== 'string' || !row.label.trim() ||
        !Number.isFinite(row.lower) || !Number.isFinite(row.upper) ||
        row.lower! <= 0 || row.upper! < row.lower! ||
        row.drawnAtUtc !== null && row.drawnAtUtc !== undefined &&
          (typeof row.drawnAtUtc !== 'string' || !validUtc(row.drawnAtUtc))) {
      throw new Error('Nivel manual inválido.');
    }
    return {kind: row.kind!, label: row.label, lower: row.lower!,
      upper: row.upper!, drawnAtUtc: row.drawnAtUtc ?? null};
  });
}

export function parsePhase17DecisionCsv(csv: string): Phase17Decision {
  const rows = parseCsvRows(csv);
  if (rows.length !== 2) throw new Error('Se requiere cabecera y una sola decisión.');
  const header = rows[0]!.join(',');
  const legacy = header === HUMAN_TEMPLATE_COLUMNS.join(',');
  const v1 = header === PHASE17_V1_COLUMNS.join(',');
  if (!legacy && !v1 && header !== PHASE17_TEMPLATE_COLUMNS.join(',')) {
    throw new Error('Cabecera humana F16/F17 desconocida.');
  }
  if (rows[1]!.length !== (legacy ? HUMAN_TEMPLATE_COLUMNS.length :
      v1 ? PHASE17_V1_COLUMNS.length : PHASE17_TEMPLATE_COLUMNS.length)) {
    throw new Error('Campos humanos incompletos.');
  }
  const baseCsv = HUMAN_TEMPLATE_COLUMNS.join(',') + '\n' +
    rows[1]!.slice(0, HUMAN_TEMPLATE_COLUMNS.length).map(value =>
      /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value).join(',') + '\n';
  const decision = parseHumanDecisionCsv(baseCsv);
  const fields = Object.fromEntries(PHASE17_EXTRA_COLUMNS.map((key, index) =>
    [key, legacy ? '' : rows[1]![HUMAN_TEMPLATE_COLUMNS.length + index]!])) as
    Record<typeof PHASE17_EXTRA_COLUMNS[number], string>;
  const followup = Object.fromEntries(PHASE17_FOLLOWUP_COLUMNS.map((key, index) =>
    [key, legacy || v1 ? '' : rows[1]![PHASE17_V1_COLUMNS.length + index]!])) as
    Record<typeof PHASE17_FOLLOWUP_COLUMNS[number], string>;
  const recordMode = (legacy ? 'live' : fields.recordMode) as RecordMode;
  if (!['live','historical_reconstruction','post_outcome_annotation'].includes(recordMode)) {
    throw new Error('recordMode inválido.');
  }
  const extension: Phase17Extension = {recordMode,
    reviewedTimeframes: splitList(fields.reviewedTimeframes),
    trendInterpretation: optional(fields.trendInterpretation),
    manualLevelsDescription: optional(fields.manualLevelsDescription),
    manualLevels: parseLevels(fields.manualLevelsJson),
    awaitedConfirmation: optional(fields.awaitedConfirmation),
    invalidationCondition: optional(fields.invalidationCondition),
    contractOccSymbol: optional(fields.contractOccSymbol),
    contractSelectionReason: optional(fields.contractSelectionReason),
    strikeReason: optional(fields.strikeReason),
    expirationReason: optional(fields.expirationReason),
    profitObjective: optional(fields.profitObjective),
    lossLimit: optional(fields.lossLimit),
    chartCapturedAtUtc: optional(fields.chartCapturedAtUtc),
    chartSha256: optional(fields.chartSha256),
    manualChartAnnotations: optional(fields.manualChartAnnotations),
    rejectedSignalIds: splitList(fields.rejectedSignalIds),
    relatedDecisionId: optional(fields.relatedDecisionId),
    contextKnownAtUtc: optional(followup.contextKnownAtUtc),
    linkedExecutionIds: splitList(followup.linkedExecutionIds),
    exitReason: optional(followup.exitReason),
    planChangedAtUtc: optional(followup.planChangedAtUtc),
    planChangeReason: optional(followup.planChangeReason)};
  return {decision, extension};
}

export function validatePhase17Decision(value: Phase17Decision, documentedAtUtc: string) {
  const decision = {...value.decision, documentedAtUtc};
  if (!Number.isFinite(Date.parse(decision.decisionAtUtc))) {
    throw new Error('Decisión humana incompleta o fechada en el futuro.');
  }
  if (!validUtc(decision.decisionAtUtc) || !validUtc(documentedAtUtc) ||
      decision.outcomeKnownAtUtc && !validUtc(decision.outcomeKnownAtUtc)) {
    throw new Error('La decisión F17 requiere timestamps UTC completos.');
  }
  const timing = validateHumanDecision(decision, documentedAtUtc);
  if (Date.parse(decision.decisionAtUtc) > Date.parse(documentedAtUtc)) {
    throw new Error('La decisión no puede ocurrir después de documentarse.');
  }
  const extension = value.extension;
  if (!['live','historical_reconstruction','post_outcome_annotation']
    .includes(extension.recordMode)) throw new Error('Modo de registro inválido.');
  if (extension.contractOccSymbol) parseOccSymbol(extension.contractOccSymbol);
  if (extension.chartCapturedAtUtc && !validUtc(extension.chartCapturedAtUtc)) {
    throw new Error('Hora de captura inválida.');
  }
  if (extension.chartSha256 && !/^[a-f0-9]{64}$/i.test(extension.chartSha256)) {
    throw new Error('Hash de captura inválido.');
  }
  if (extension.contextKnownAtUtc && !validUtc(extension.contextKnownAtUtc) ||
      extension.planChangedAtUtc && !validUtc(extension.planChangedAtUtc)) {
    throw new Error('Hora UTC de contexto o cambio de plan inválida.');
  }
  if (extension.planChangedAtUtc &&
      Date.parse(extension.planChangedAtUtc) > Date.parse(documentedAtUtc)) {
    throw new Error('Cambio de plan fechado después de su documentación.');
  }
  if (!!extension.planChangedAtUtc !== !!extension.planChangeReason) {
    throw new Error('Cambio de plan requiere hora y motivo juntos.');
  }
  if (new Set(extension.linkedExecutionIds).size !== extension.linkedExecutionIds.length) {
    throw new Error('IDs de ejecución duplicados en anotación.');
  }
  if (extension.linkedExecutionIds.length &&
      (!extension.relatedDecisionId || extension.recordMode === 'live' ||
        decision.direction === 'no_trade')) {
    throw new Error('Ejecuciones requieren anotación retrospectiva vinculada y operación.');
  }
  if (extension.rejectedSignalIds.length &&
      (decision.direction !== 'no_trade' || decision.observedMarket !== true)) {
    throw new Error('Rechazo explícito requiere no_trade y mercado observado.');
  }
  if (extension.manualLevels.some(level => level.drawnAtUtc &&
      Date.parse(level.drawnAtUtc) > Date.parse(documentedAtUtc))) {
    throw new Error('Nivel trazado en el futuro.');
  }
  const recordClass = extension.recordMode === 'historical_reconstruction' ?
    'historical_reconstruction' : extension.recordMode === 'post_outcome_annotation' ?
    'post_outcome_annotation' : decision.observedMarket !== true ?
      'timing_unverified' : timing === 'prospective' ?
      'live_before_primary_outcome' : 'post_outcome_annotation';
  return {decision, extension, status: recordClass === 'live_before_primary_outcome' ?
    'prospective' : 'retrospective', recordClass,
    referenceOutcomeEndUtc: humanReferenceOutcomeEnd(decision.decisionAtUtc),
    chartKnownAtDecision: !!extension.chartCapturedAtUtc &&
      Date.parse(extension.chartCapturedAtUtc) <= Date.parse(decision.decisionAtUtc),
    contextKnownAtDecision: !!extension.contextKnownAtUtc &&
      Date.parse(extension.contextKnownAtUtc) <= Date.parse(decision.decisionAtUtc),
    manualLevelsKnownAtDecision: extension.manualLevels.map(level =>
      !!level.drawnAtUtc && level.drawnAtUtc <= decision.decisionAtUtc)};
}

export function appendPhase17Decision(directory: string, raw: string,
  documentedAtUtc = new Date().toISOString(), privateRoot?: string): LedgerRecord {
  const id = `human17:${sha256(raw)}`;
  const records = verifyLedger(directory);
  const prior = records.find(record => record.id === id);
  if (prior) return prior;
  const value = parsePhase17DecisionCsv(raw);
  const audited = validatePhase17Decision(value, documentedAtUtc);
  if (audited.extension.relatedDecisionId &&
      !records.some(record => record.id === audited.extension.relatedDecisionId &&
        record.kind === 'human_decision')) {
    throw new Error('Anotación vinculada a decisión humana inexistente.');
  }
  const original = records.find(record => record.id === audited.extension.relatedDecisionId);
  if (original?.payload.phase17 &&
      (original.payload.phase17 as Phase17Extension).relatedDecisionId) {
    throw new Error('La anotación debe vincularse directamente a la decisión original.');
  }
  if (audited.extension.linkedExecutionIds.length && original?.payload.direction === 'no_trade') {
    throw new Error('Una decisión no_trade no puede vincularse a fills.');
  }
  if (audited.extension.linkedExecutionIds.some(id => records.some(record =>
      record.kind === 'human_decision' && record.payload.phase17 &&
      (record.payload.phase17 as Phase17Extension).relatedDecisionId !==
        audited.extension.relatedDecisionId &&
      (record.payload.phase17 as Phase17Extension).linkedExecutionIds?.includes(id)))) {
    throw new Error('Ejecución ya atribuida a otra decisión humana.');
  }
  if (privateRoot) {
    const captureId = audited.decision.chartCaptureId;
    if (captureId) {
      const manifestPath = join(privateRoot, 'charts', `${captureId}.json`);
      if (!existsSync(manifestPath)) throw new Error('Captura referenciada no importada.');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as
        {captureId: string; sha256: string; capturedAtUtc: string | null;
          privateFileName: string};
      if (manifest.captureId !== captureId || manifest.sha256 !== audited.extension.chartSha256 ||
          manifest.capturedAtUtc !== audited.extension.chartCapturedAtUtc ||
          !existsSync(join(privateRoot, 'charts', manifest.privateFileName)) ||
          sha256(readFileSync(join(privateRoot, 'charts', manifest.privateFileName))) !== manifest.sha256) {
        throw new Error('Referencia o integridad de captura inválida.');
      }
    }
    if (audited.extension.linkedExecutionIds.length) {
      const broker = readBrokerStore(privateRoot, documentedAtUtc);
      const fills = new Map(broker.fills.map(fill =>
        [fill.executionId, fill]));
      const contracts = new Set<string>();
      const positionIds = new Set<string>();
      for (const id of audited.extension.linkedExecutionIds) {
        const fill = fills.get(id);
        if (!fill || Date.parse(fill.executedAtUtc) > Date.parse(documentedAtUtc)) {
          throw new Error(`Ejecución vinculada no disponible: ${id}`);
        }
        const expected = audited.extension.contractOccSymbol ||
          original?.payload.phase17 &&
            (original.payload.phase17 as Phase17Extension).contractOccSymbol;
        if (expected && fill.contract.occSymbol !== expected) {
          throw new Error('Ejecución vinculada de otro contrato OCC.');
        }
        contracts.add(fill.contract.occSymbol);
        const position = broker.positions.find(row =>
          row.buyExecutionIds.includes(id) || row.sellExecutionIds.includes(id));
        if (position) positionIds.add(position.positionId);
      }
      if (contracts.size > 1 || positionIds.size > 1) {
        throw new Error('Una decisión no puede mezclar contratos o posiciones distintos.');
      }
    }
  }
  return appendRecord(directory, id, 'human_decision',
    {sourceFormat: 'phase17_csv_or_phase16_legacy', sourceSha256: sha256(raw),
      ...audited.decision, phase17: audited.extension,
      status: audited.status, recordClass: audited.recordClass,
      referenceOutcomeEndUtc: audited.referenceOutcomeEndUtc,
      chartKnownAtDecision: audited.chartKnownAtDecision,
      contextKnownAtDecision: audited.contextKnownAtDecision,
      manualLevelsKnownAtDecision: audited.manualLevelsKnownAtDecision}, documentedAtUtc);
}
