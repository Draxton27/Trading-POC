import {appendRecord, HUMAN_TEMPLATE_COLUMNS, humanReferenceOutcomeEnd,
  parseHumanDecisionCsv, sha256, validateHumanDecision, verifyLedger,
  type HumanDecision, type LedgerRecord} from './phase16-ledger.ts';
import {parseCsvRows} from './phase17-csv.ts';
import {parseOccSymbol} from './phase17-occ.ts';

export const PHASE17_EXTRA_COLUMNS = ['recordMode','reviewedTimeframes','trendInterpretation',
  'manualLevelsDescription','manualLevelsJson','awaitedConfirmation',
  'invalidationCondition','contractOccSymbol','contractSelectionReason',
  'strikeReason','expirationReason','profitObjective','lossLimit',
  'chartCapturedAtUtc','chartSha256','manualChartAnnotations','rejectedSignalIds',
  'relatedDecisionId'] as const;
export const PHASE17_TEMPLATE_COLUMNS = [...HUMAN_TEMPLATE_COLUMNS, ...PHASE17_EXTRA_COLUMNS];
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
  rejectedSignalIds: string[]; relatedDecisionId: string | null};
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
  if (!legacy && header !== PHASE17_TEMPLATE_COLUMNS.join(',')) {
    throw new Error('Cabecera humana F16/F17 desconocida.');
  }
  if (rows[1]!.length !== (legacy ? HUMAN_TEMPLATE_COLUMNS.length : PHASE17_TEMPLATE_COLUMNS.length)) {
    throw new Error('Campos humanos incompletos.');
  }
  const baseCsv = HUMAN_TEMPLATE_COLUMNS.join(',') + '\n' +
    rows[1]!.slice(0, HUMAN_TEMPLATE_COLUMNS.length).map(value =>
      /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value).join(',') + '\n';
  const decision = parseHumanDecisionCsv(baseCsv);
  const fields = Object.fromEntries(PHASE17_EXTRA_COLUMNS.map((key, index) =>
    [key, legacy ? '' : rows[1]![HUMAN_TEMPLATE_COLUMNS.length + index]!])) as
    Record<typeof PHASE17_EXTRA_COLUMNS[number], string>;
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
    relatedDecisionId: optional(fields.relatedDecisionId)};
  return {decision, extension};
}

export function validatePhase17Decision(value: Phase17Decision, documentedAtUtc: string) {
  const decision = {...value.decision, documentedAtUtc};
  const timing = validateHumanDecision(decision, documentedAtUtc);
  if (!validUtc(decision.decisionAtUtc) || !validUtc(documentedAtUtc) ||
      decision.outcomeKnownAtUtc && !validUtc(decision.outcomeKnownAtUtc)) {
    throw new Error('La decisión F17 requiere timestamps UTC completos.');
  }
  if (decision.decisionAtUtc > documentedAtUtc) {
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
  if (extension.rejectedSignalIds.length &&
      (decision.direction !== 'no_trade' || decision.observedMarket !== true)) {
    throw new Error('Rechazo explícito requiere no_trade y mercado observado.');
  }
  if (extension.manualLevels.some(level => level.drawnAtUtc &&
      level.drawnAtUtc > documentedAtUtc)) throw new Error('Nivel trazado en el futuro.');
  const recordClass = extension.recordMode === 'historical_reconstruction' ?
    'historical_reconstruction' : extension.recordMode === 'post_outcome_annotation' ?
    'post_outcome_annotation' : timing === 'prospective' ?
      'live_before_primary_outcome' : 'post_outcome_annotation';
  return {decision, extension, status: recordClass === 'live_before_primary_outcome' ?
    'prospective' : 'retrospective', recordClass,
    referenceOutcomeEndUtc: humanReferenceOutcomeEnd(decision.decisionAtUtc),
    chartKnownAtDecision: !!extension.chartCapturedAtUtc &&
      extension.chartCapturedAtUtc <= decision.decisionAtUtc,
    manualLevelsKnownAtDecision: extension.manualLevels.map(level =>
      !!level.drawnAtUtc && level.drawnAtUtc <= decision.decisionAtUtc)};
}

export function appendPhase17Decision(directory: string, raw: string,
  documentedAtUtc = new Date().toISOString()): LedgerRecord {
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
  return appendRecord(directory, id, 'human_decision',
    {sourceFormat: 'phase17_csv_or_phase16_legacy', sourceSha256: sha256(raw),
      ...audited.decision, phase17: audited.extension,
      status: audited.status, recordClass: audited.recordClass,
      referenceOutcomeEndUtc: audited.referenceOutcomeEndUtc,
      chartKnownAtDecision: audited.chartKnownAtDecision,
      manualLevelsKnownAtDecision: audited.manualLevelsKnownAtDecision}, documentedAtUtc);
}
