import {sha256} from './phase16-ledger.ts';
import {parseCsvRows} from './phase17-csv.ts';
import {parseOccSymbol, type OccContract} from './phase17-occ.ts';

export const BROKER_COLUMNS = ['execution_id','underlying_symbol','occ_symbol',
  'option_type','strike','expiration','side','executed_at_utc','quantity',
  'premium_per_share','commission','broker_reported_net'] as const;
export type BrokerFill = {executionId: string; contract: OccContract;
  side: 'BUY' | 'SELL'; executedAtUtc: string; quantity: number;
  premiumPerShare: number; commission: number | null;
  brokerReportedNet: number | null};
export type ClosedTrade = {sellExecutionId: string; occSymbol: string;
  underlyingSymbol: string; optionType: 'CALL' | 'PUT'; strike: number;
  expiration: string; soldAtUtc: string; quantity: number;
  matches: Array<{buyExecutionId: string; boughtAtUtc: string; quantity: number;
    buyPremiumPerShare: number; sellPremiumPerShare: number}>;
  grossResult: number; commission: number | null;
  calculatedNet: number | null; brokerReportedNet: number | null;
  brokerNetDifference: number | null};
export type BrokerImport = {sourceSha256: string; executionCount: number;
  identicalDuplicateCount: number; closedTrades: ClosedTrade[];
  openLots: Array<{occSymbol: string; buyExecutionId: string;
    remainingQuantity: number; boughtAtUtc: string}>};
const numeric = (value: string, label: string, allowZero: boolean): number => {
  const parsed = Number(value);
  if (!value.trim() || !Number.isFinite(parsed) ||
      (allowZero ? parsed < 0 : parsed <= 0)) throw new Error(`${label} inválido.`);
  return parsed;
};
const optionalNumeric = (value: string, label: string, allowZero = true): number | null =>
  value.trim() ? numeric(value, label, allowZero) : null;
const optionalSigned = (value: string): number | null => {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error('broker_reported_net inválido.');
  return parsed;
};
const validUtc = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);

export function importBrokerExecutions(csv: string, importedAtUtc?: string): BrokerImport {
  const rows = parseCsvRows(csv);
  if (!rows.length || rows[0]!.join(',') !== BROKER_COLUMNS.join(',')) {
    throw new Error('Cabecera CSV del bróker distinta del esquema F17.');
  }
  const byId = new Map<string, {fingerprint: string; fill: BrokerFill}>();
  let identicalDuplicateCount = 0;
  for (const [index, cells] of rows.slice(1).entries()) {
    if (cells.length !== BROKER_COLUMNS.length) throw new Error(`Fila ${index + 2} incompleta.`);
    const raw = Object.fromEntries(BROKER_COLUMNS.map((key, i) => [key, cells[i]!])) as
      Record<typeof BROKER_COLUMNS[number], string>;
    if (!raw.execution_id.trim()) throw new Error('execution_id obligatorio.');
    const contract = parseOccSymbol(raw.occ_symbol);
    if (raw.underlying_symbol && raw.underlying_symbol !== contract.underlyingSymbol ||
        raw.option_type && raw.option_type !== contract.optionType ||
        raw.strike && Number(raw.strike) !== contract.strike ||
        raw.expiration && raw.expiration !== contract.expiration) {
      throw new Error('Datos de contrato contradicen el símbolo OCC.');
    }
    if (raw.side !== 'BUY' && raw.side !== 'SELL') throw new Error('side requiere BUY/SELL.');
    if (!validUtc(raw.executed_at_utc)) throw new Error('Timestamp UTC inválido.');
    if (importedAtUtc && raw.executed_at_utc > importedAtUtc) {
      throw new Error('Ejecución del bróker fechada en el futuro.');
    }
    const quantity = numeric(raw.quantity, 'quantity', false);
    if (!Number.isSafeInteger(quantity)) throw new Error('Cantidad de contratos no entera.');
    const fill: BrokerFill = {executionId: raw.execution_id, contract,
      side: raw.side, executedAtUtc: raw.executed_at_utc, quantity,
      premiumPerShare: numeric(raw.premium_per_share, 'premium_per_share', false),
      commission: optionalNumeric(raw.commission, 'commission'),
      brokerReportedNet: optionalSigned(raw.broker_reported_net)};
    const fingerprint = sha256(JSON.stringify(fill));
    const prior = byId.get(fill.executionId);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new Error('execution_id duplicado contradictorio.');
      identicalDuplicateCount++; continue;
    }
    byId.set(fill.executionId, {fingerprint, fill});
  }
  const fills = [...byId.values()].map(row => row.fill)
    .sort((a, b) => a.executedAtUtc.localeCompare(b.executedAtUtc) ||
      a.executionId.localeCompare(b.executionId));
  type Lot = {fill: BrokerFill; remaining: number};
  const inventory = new Map<string, Lot[]>();
  const closedTrades: ClosedTrade[] = [];
  for (const fill of fills) {
    const key = fill.contract.occSymbol;
    const lots = inventory.get(key) ?? [];
    if (fill.side === 'BUY') {lots.push({fill, remaining: fill.quantity}); inventory.set(key, lots); continue;}
    let remaining = fill.quantity, grossResult = 0, commission = fill.commission;
    const matches: ClosedTrade['matches'] = [];
    for (const lot of lots) {
      if (!remaining) break;
      const quantity = Math.min(remaining, lot.remaining);
      if (!quantity) continue;
      remaining -= quantity; lot.remaining -= quantity;
      grossResult += (fill.premiumPerShare - lot.fill.premiumPerShare) * 100 * quantity;
      if (commission !== null && lot.fill.commission !== null) {
        commission += lot.fill.commission * quantity / lot.fill.quantity;
      } else commission = null;
      matches.push({buyExecutionId: lot.fill.executionId,
        boughtAtUtc: lot.fill.executedAtUtc, quantity,
        buyPremiumPerShare: lot.fill.premiumPerShare,
        sellPremiumPerShare: fill.premiumPerShare});
    }
    if (remaining) throw new Error(`Venta sin compra suficiente: ${fill.executionId}`);
    const calculatedNet = commission === null ? null : grossResult - commission;
    closedTrades.push({sellExecutionId: fill.executionId, occSymbol: key,
      underlyingSymbol: fill.contract.underlyingSymbol,
      optionType: fill.contract.optionType, strike: fill.contract.strike,
      expiration: fill.contract.expiration, soldAtUtc: fill.executedAtUtc,
      quantity: fill.quantity, matches, grossResult, commission,
      calculatedNet, brokerReportedNet: fill.brokerReportedNet,
      brokerNetDifference: calculatedNet !== null && fill.brokerReportedNet !== null ?
        calculatedNet - fill.brokerReportedNet : null});
    inventory.set(key, lots.filter(lot => lot.remaining > 0));
  }
  return {sourceSha256: sha256(csv), executionCount: fills.length,
    identicalDuplicateCount, closedTrades,
    openLots: [...inventory].flatMap(([occSymbol, lots]) => lots.map(lot =>
      ({occSymbol, buyExecutionId: lot.fill.executionId,
        remainingQuantity: lot.remaining, boughtAtUtc: lot.fill.executedAtUtc})))};
}
