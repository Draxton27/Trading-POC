import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {bootstrap, classify, describe, estimate, type Group, type Observation} from './phase15-analysis.ts';

const project = fileURLToPath(new URL('../', import.meta.url));
const repo = fileURLToPath(new URL('../../', import.meta.url));
const source = join(project, 'data', 'NVDA_ALPACA_SIP_15min_20211017_20261017.csv');
const prior = {
  phase11: join(project, 'output/real/nvda-pullback-breakout-study.json'),
  phase12: join(repo, 'shared-artifacts/phase12-nvda-failed-breakouts/phase12-results.json'),
  phase13: join(project, 'output/real/nvda-volatility-regimes.json'),
  phase14: join(repo, 'shared-artifacts/phase14-market-context/phase14-signal-context.csv'),
};
const expected: Record<string, string> = {
  source: '7b06d0a493515b18a581963d2d2d488e73a7cd0dc2c961b60a99315e7a9b0ecc',
  phase11: '05031c1371b2596efa7653e326cdad1325855454479a1e1f25c3aeff66f6ba1f',
  phase12: '3e1f2ddab92bee95c270a9f1f170574a4089c1d9bd3696287a343a30fc030f56',
  phase13: '45f15df045e7210651745919bbd7f22a9eb88cc199638a1a9c606a7ade40c0e7',
  phase14: '5c930e3b0ddefa672428665843106c6d87d6fb6ac3c81563c9b0cdfd5f06e6da',
};
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hashes = Object.fromEntries(Object.entries({source, ...prior}).map(([name, path]) =>
  [name, sha(readFileSync(path))]));
for (const [name, hash] of Object.entries(expected)) assert.equal(hashes[name], hash, `Hash ${name} cambió`);
const f11 = JSON.parse(readFileSync(prior.phase11, 'utf8')).study.events as any[];
const f12 = JSON.parse(readFileSync(prior.phase12, 'utf8')).study.signals as any[];
const f13 = JSON.parse(readFileSync(prior.phase13, 'utf8')).study.events as any[];
const phase14Audit = JSON.parse(readFileSync(join(repo, 'shared-artifacts/phase14-market-context/phase14-data-audit.json'), 'utf8'));
assert.deepEqual(phase14Audit.originalArtifactHashes, {phase11: hashes.phase11, phase12: hashes.phase12,
  phase13: hashes.phase13});
assert.equal(phase14Audit.sourceHashes.NVDA.csv, hashes.source);
const sourceMap = new Map<string, any>();
for (const event of f11) sourceMap.set(`phase11:${event.strategy}_${event.direction}:${event.index}`, event);
for (const signal of f12) sourceMap.set(signal.episodeId, signal);
assert.equal(sourceMap.size, f11.length + f12.length);

export function parseTable(csv: string): Record<string, string>[] {
  const table: string[][] = []; let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i]!;
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') {field += '"'; i++;}
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {row.push(field); field = '';}
    else if (char === '\n' && !quoted) {row.push(field.replace(/\r$/, '')); table.push(row); row = []; field = '';}
    else field += char;
  }
  if (quoted) throw new Error('CSV con comillas incompletas');
  if (field || row.length) {row.push(field); table.push(row);}
  const header = table.shift()!;
  return table.filter(r => r.some(Boolean)).map(r => {
    assert.equal(r.length, header.length, 'Anchura CSV inválida');
    return Object.fromEntries(header.map((key, i) => [key, r[i]!]));
  });
}
const market = parseTable(readFileSync(prior.phase14, 'utf8'));
assert.equal(market.length, f13.length);
const marketMap = new Map(market.map(row => [row.signal_id, row]));
assert.equal(marketMap.size, market.length);
const events = parseTable(readFileSync(join(repo,
  'shared-artifacts/phase14-market-context/phase14-economic-events.csv'), 'utf8'))
  .filter(event => event.verification === 'verified_time' && event.timestamp_utc &&
    (event.category === 'CPI' || event.category === 'EMPLOYMENT_SITUATION' ||
      (event.category === 'FOMC' && event.subtype === 'statement')));
const eventDates = new Map<string, Record<string, string>[]>();
for (const event of events) eventDates.set(event.date_ny,
  [...(eventDates.get(event.date_ny) ?? []), event]);
type Full = Observation & {sourcePhase: number; direction: string; index: number;
  barStartUtc: string; availableAtUtc: string; marketAvailableAtUtc: string;
  qqqFour: number | null; smhFour: number | null; reason30: string | null;
  h15: number | null; h60: number | null; entryUtc: string | null;
  exitUtc: string | null; repeated: boolean; overlapping: boolean;
  eventLinks: string[]; newsBefore: string[]; newsAfter: string[];
  newsAt: string[]; generalControl30: number | null};
const numeric = (value: string): number | null => value === '' ? null : Number(value);
const near = (a: number | null, b: number | null) =>
  a === null && b === null || a !== null && b !== null && Math.abs(a - b) < 1e-10;
const rows: Full[] = [];
for (const signal of f13) {
  const original = sourceMap.get(signal.id);
  const ctx = marketMap.get(signal.id);
  assert.ok(original && ctx, `Señal sin origen o mercado: ${signal.id}`);
  const index = signal.sourcePhase === 11 ? original.index : original.confirmationIndex;
  const timestamp = signal.sourcePhase === 11 ? original.barStartUtc : original.confirmationBarStartUtc;
  assert.equal(index, signal.index); assert.equal(timestamp, signal.barStartUtc);
  assert.equal(original.availableAtUtc, signal.availableAtUtc);
  assert.equal(original.direction, signal.direction);
  for (const horizon of ['15', '30', '60']) {
    const from = original.horizons[horizon], derived = signal.originalHorizons[horizon];
    assert.ok(near(from.value, derived.value) && from.reason === derived.reason &&
      from.entryUtc === derived.entryUtc && from.exitUtc === derived.exitUtc,
    `Desenlace ${horizon} alterado: ${signal.id}`);
    assert.ok(near(original.controls[horizon].meanPercent,
      signal.originalControls[horizon].meanPercent), `Control alterado: ${signal.id}`);
  }
  assert.equal(ctx.source_index, String(signal.index));
  assert.equal(ctx.family, signal.family); assert.equal(ctx.direction, signal.direction);
  assert.equal(ctx.bar_start_utc, signal.barStartUtc);
  assert.equal(ctx.available_at_utc, signal.availableAtUtc);
  assert.equal(ctx.date_ny, signal.dateNy); assert.equal(ctx.regime_phase13, signal.regime);
  assert.ok(near(numeric(ctx.original_h30_signed_percent), signal.originalHorizons['30'].value));
  assert.equal(ctx.original_h30_exclusion_reason || null, signal.originalHorizons['30'].reason);
  assert.equal(ctx.market_available_at_utc, signal.availableAtUtc);
  const qqq = numeric(ctx.qqq_four_return_pct), smh = numeric(ctx.smh_four_return_pct);
  const related = eventDates.get(signal.dateNy) ?? [];
  const before = related.filter(e => e.timestamp_utc > signal.availableAtUtc).map(e => e.event_id);
  const after = related.filter(e => e.timestamp_utc < signal.availableAtUtc).map(e => e.event_id);
  const at = related.filter(e => e.timestamp_utc === signal.availableAtUtc).map(e => e.event_id);
  rows.push({id: signal.id, session: signal.dateNy, family: signal.family,
    year: signal.dateNy.slice(0, 4), hourBlock: signal.hourBlock, regime: signal.regime,
    group: classify(signal.direction, qqq, smh), outcome: signal.originalHorizons['30'].value,
    control: signal.originalControls['30'].meanPercent === null ||
      signal.originalHorizons['30'].value === null ? null :
      signal.originalHorizons['30'].value - signal.originalControls['30'].meanPercent,
    mfe: signal.trajectories['30'].mfePercent, mae: signal.trajectories['30'].maePercent,
    sourcePhase: signal.sourcePhase, direction: signal.direction, index: signal.index,
    barStartUtc: signal.barStartUtc, availableAtUtc: signal.availableAtUtc,
    marketAvailableAtUtc: ctx.market_available_at_utc, qqqFour: qqq, smhFour: smh,
    reason30: signal.originalHorizons['30'].reason,
    h15: signal.originalHorizons['15'].value, h60: signal.originalHorizons['60'].value,
    entryUtc: signal.originalHorizons['30'].entryUtc,
    exitUtc: signal.originalHorizons['30'].exitUtc,
    repeated: original.repeatedWithinFourBars,
    overlapping: original.overlappingPrimaryOutcome,
    eventLinks: related.map(e => e.event_id), newsBefore: before, newsAfter: after,
    newsAt: at, generalControl30: signal.generalControl30?.meanPercent ?? null});
}
assert.equal(rows.length, 1242);
assert.equal(new Set(rows.map(r => r.id)).size, rows.length);
assert.equal(rows.filter(r => r.sourcePhase === 11).length, f11.length);
assert.equal(rows.filter(r => r.sourcePhase === 12).length, f12.length);

const main = estimate(rows), uncertainty = bootstrap(rows), controlRows = rows.filter(r => r.control !== null);
const originalControl = estimate(controlRows, 'control');
const comparable = main.matched.concordance >= 30 && main.matched.contradiction >= 30 &&
  main.sessions.concordance >= 10 && main.sessions.contradiction >= 10 &&
  main.matched.concordance / main.total.concordance >= .5 &&
  main.matched.contradiction / main.total.contradiction >= .5 &&
  Object.keys(main.years).length >= 2;
const byYear = [...new Set(rows.map(r => r.year))].sort().map(year => ({year,
  ...estimate(rows.filter(r => r.year === year))}));
const qualifyingYears = byYear.filter(y => y.total.concordance >= 10 && y.total.contradiction >= 10);
const yearStablePositive = qualifyingYears.length > 0 && qualifyingYears.filter(y =>
  (y.adjustedDifference ?? -Infinity) > 0).length >= Math.ceil(qualifyingYears.length / 2);
const yearStableNegative = qualifyingYears.length > 0 && qualifyingYears.filter(y =>
  (y.adjustedDifference ?? Infinity) < 0).length >= Math.ceil(qualifyingYears.length / 2);
const maxYearWeight = main.weight ? Math.max(...Object.values(main.years)) / main.weight : null;
const sufficientBootstrap = uncertainty.validAdjusted >= 1800;
const ci = uncertainty.adjusted95;
const decision = !comparable || !sufficientBootstrap ? 'Inconclusa' :
  main.adjustedDifference !== null && main.adjustedDifference > .1 &&
  ci[0] !== null && ci[0] > 0 && yearStablePositive && (maxYearWeight ?? 1) <= .7 ?
    'Asociación exploratoria favorable' :
  main.adjustedDifference !== null && main.adjustedDifference < -.1 &&
  ci[1] !== null && ci[1] < 0 && yearStableNegative && (maxYearWeight ?? 1) <= .7 ?
    'Asociación exploratoria desfavorable' : 'Sin mejora demostrada';
const groups: Group[] = ['concordance', 'contradiction', 'mixed', 'missing'];
function comparison(scope: string, key: string, subset: Full[]) {
  const e = estimate(subset);
  return {scope, key, ...e, groups: Object.fromEntries(groups.map(g =>
    [g, describe(subset.filter(r => r.group === g))]))};
}
const familyNames = [...new Set(rows.map(r => r.family))].sort();
const regimes = ['low', 'medium', 'high', 'insufficient'];
const hours = [...new Set(rows.map(r => r.hourBlock))].sort((a, b) => a - b);
const comparisons = [comparison('all', 'all', rows),
  ...familyNames.map(k => comparison('family', k, rows.filter(r => r.family === k))),
  ...byYear.map(y => comparison('year', y.year, rows.filter(r => r.year === y.year))),
  ...regimes.map(k => comparison('regime', k, rows.filter(r => r.regime === k))),
  ...hours.map(k => comparison('hour', String(k), rows.filter(r => r.hourBlock === k)))];
const robustness = [...familyNames.flatMap(f => [
  comparison('family', f, rows.filter(r => r.family === f)),
  ...byYear.map(y => comparison('family_year', `${f}|${y.year}`,
    rows.filter(r => r.family === f && r.year === y.year))),
  ...regimes.map(g => comparison('family_regime', `${f}|${g}`,
    rows.filter(r => r.family === f && r.regime === g)))])];
const horizons = [15, 60].map(minutes => {
  const derived = rows.map(r => ({...r, outcome: minutes === 15 ? r.h15 : r.h60}));
  return {minutes, estimate: estimate(derived), byFamily: familyNames.map(f =>
    comparison('family', f, derived.filter(r => r.family === f)))};
});
const news = ['CPI', 'EMPLOYMENT_SITUATION', 'FOMC'].flatMap(category =>
  (['before', 'after', 'at'] as const).map(position => {
    const field = ({before: 'newsBefore', after: 'newsAfter', at: 'newsAt'} as const)[position];
    const subset = rows.filter(r => r[field]
      .some(id => id.startsWith(category + ':')));
    return {category, position, ...describe(subset)};
  }));
const audit = {totalSignals: rows.length, phase11: f11.length, phase12: f12.length,
  groupCounts: Object.fromEntries(groups.map(g => [g, rows.filter(r => r.group === g).length])),
  eligibleByGroup: Object.fromEntries(groups.map(g => [g, rows.filter(r => r.group === g && r.outcome !== null).length])),
  incomplete30: rows.filter(r => r.outcome === null).length,
  exclusionReasons: Object.fromEntries([...new Set(rows.map(r => r.reason30).filter(Boolean))]
    .map(reason => [reason, rows.filter(r => r.reason30 === reason).length])),
  repeated: rows.filter(r => r.repeated).length,
  overlapping: rows.filter(r => r.overlapping).length,
  controlsAvailable: rows.filter(r => r.control !== null).length,
  verifiedEvents: events.length, signalsBeforeNews: rows.filter(r => r.newsBefore.length).length,
  signalsAfterNews: rows.filter(r => r.newsAfter.length).length,
  signalsAtNews: rows.filter(r => r.newsAt.length).length,
  sourceHashes: hashes, originalPhase14Hash: sha(readFileSync(join(repo,
    'shared-artifacts/phase14-market-context/phase14-data-audit.json')))};
const codeVersion = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repo, encoding: 'utf8'}).trim();
const results = {protocol: 'docs/phase15-research-protocol.md',
  protocolCommit: '7ab491edb2c040b096213764ded69352cf593aad', codeVersion,
  exploratoryPeriod: '2021-10-17 to 2026-10-17', seed: 15015, bootstrapRepetitions: 2000,
  audit, primary: {main, uncertainty, comparable, sufficientBootstrap,
    qualifyingYears,
    maxYearWeight, yearStablePositive, yearStableNegative, decision},
  originalControlSensitivity: {eligible: controlRows.length, estimate: originalControl},
  comparisons, robustness, horizons, news};
const out = join(repo, 'shared-artifacts/phase15-market-confirmation');
mkdirSync(out, {recursive: true});
const csvCell = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'string' ? value : String(value);
  return /[",\r\n]/.test(str) ? `"${str.replaceAll('"', '""')}"` : str;
};
function writeCsv(name: string, header: string[], values: unknown[][]) {
  writeFileSync(join(out, name), header.join(',') + '\n' +
    values.map(v => v.map(csvCell).join(',')).join('\n') + '\n');
}
writeFileSync(join(out, 'phase15-results.json'), JSON.stringify(results, null, 2) + '\n');
writeCsv('phase15-signal-analysis.csv', ['signal_id','source_phase','family','direction','index',
  'session_ny','bar_start_utc','signal_available_at_utc','market_available_at_utc',
  'year','hour_block','regime','qqq_four_return_pct','smh_four_return_pct','group',
  'entry_utc','exit_utc','h15_signed_pct','h30_signed_pct','h60_signed_pct',
  'h30_exclusion','original_control30_pct','difference_vs_original_control30_pct',
  'general_control30_pct','mfe30_pct','mae30_pct','net0_pct','net5_pct','net10_pct','net20_pct',
  'repeated_within_four_bars','overlapping_primary_outcome','same_day_event_ids',
  'before_verified_event_ids','after_verified_event_ids','at_verified_event_ids'],
rows.map(r => [r.id,r.sourcePhase,r.family,r.direction,r.index,r.session,r.barStartUtc,
  r.availableAtUtc,r.marketAvailableAtUtc,r.year,r.hourBlock,r.regime,r.qqqFour,r.smhFour,r.group,
  r.entryUtc,r.exitUtc,r.h15,r.outcome,r.h60,r.reason30,
  r.outcome === null || r.control === null ? null : r.outcome-r.control,r.control,
  r.generalControl30,r.mfe,r.mae,...[0,5,10,20].map(cost => r.outcome === null ? null :
    r.outcome-cost/100),r.repeated,r.overlapping,r.eventLinks.join(';'),
  r.newsBefore.join(';'),r.newsAfter.join(';'),r.newsAt.join(';')]));
const flatComparison = (x: ReturnType<typeof comparison>) => [x.scope,x.key,
  x.total.concordance,x.total.contradiction,x.matched.concordance,x.matched.contradiction,
  x.sessions.concordance,x.sessions.contradiction,x.effectiveN.concordance,
  x.effectiveN.contradiction,x.sharedStrata,x.totalStrata,x.rawDifference,
  x.adjustedDifference,x.groups.concordance?.meanSignedPercent,
  x.groups.contradiction?.meanSignedPercent,x.groups.mixed?.eligible,
  x.groups.missing?.signals];
const comparisonHeader = ['scope','key','n_concordance','n_contradiction','matched_concordance',
  'matched_contradiction','sessions_concordance','sessions_contradiction','effective_n_concordance',
  'effective_n_contradiction','shared_strata','total_strata','raw_difference_pct',
  'adjusted_difference_pct','concordance_mean_pct','contradiction_mean_pct',
  'mixed_eligible','market_missing_signals'];
writeCsv('phase15-group-comparison.csv', comparisonHeader, comparisons.map(flatComparison));
writeCsv('phase15-robustness.csv', comparisonHeader, robustness.map(flatComparison));
const fmt = (v: number | null | undefined, digits = 4) => v === null || v === undefined ?
  'N/D' : v.toFixed(digits);
const familyTable = familyNames.map(f => {
  const c = comparisons.find(r => r.scope === 'family' && r.key === f)!;
  return `| ${f} | ${c.total.concordance} | ${c.total.contradiction} | ${fmt(c.rawDifference)} | ${fmt(c.adjustedDifference)} |`;
}).join('\n');
const yearTable = byYear.map(y => `| ${y.year} | ${y.total.concordance} | ${y.total.contradiction} | ${fmt(y.rawDifference)} | ${fmt(y.adjustedDifference)} |`).join('\n');
const first = comparisons[0]!;
const costs = [0,5,10,20].map(bps => {
  const c = first.groups.concordance!.costSensitivity.find(x => x.bps === bps)!;
  const d = first.groups.contradiction!.costSensitivity.find(x => x.bps === bps)!;
  return `| ${bps} | ${fmt(c.meanNetPercent)} | ${fmt(d.meanNetPercent)} | ${fmt(c.favorableNetRate)} | ${fmt(d.favorableNetRate)} |`;
}).join('\n');
const report = `# Fase 15 — concordancia de mercado y señales de NVDA\n\n` +
`**Decisión: ${decision}.** Estudio exploratorio retrospectivo sobre 2021–2026; ninguna subdivisión es validación prospectiva. No se evaluó ejecución real ni rentabilidad de opciones.\n\n`+
`## Resultado principal\n\nSe contrastaron los retornos firmados de NVDA a 30 minutos entre señales con QQQ y SMH concordantes y señales con ambos ETF contrarios. La diferencia cruda fue **${fmt(main.rawDifference)} puntos porcentuales** y la diferencia ajustada por estratos exactos de familia, año, bloque horario y régimen fue **${fmt(main.adjustedDifference)} pp**; intervalo percentil por 2.000 remuestreos de sesiones: **[${fmt(ci[0])}, ${fmt(ci[1])}] pp**. Semilla: 15015. Los grupos completos contienen ${main.total.concordance} y ${main.total.contradiction} desenlaces; el soporte común contiene ${main.matched.concordance} y ${main.matched.contradiction} en ${main.sharedStrata} estratos. Cobertura de soporte: ${fmt(main.matched.concordance/main.total.concordance*100,1)}% y ${fmt(main.matched.contradiction/main.total.contradiction*100,1)}%; tamaños efectivos de Kish ${fmt(main.effectiveN.concordance,1)} y ${fmt(main.effectiveN.contradiction,1)}. Comparabilidad ${comparable ? 'suficiente' : 'insuficiente'} según el protocolo.\n\n`+
`| Familia | Concordantes | Contrarios | Diferencia cruda (pp) | Diferencia ajustada (pp) |\n|---|---:|---:|---:|---:|\n${familyTable}\n\n`+
`Estas seis familias son hipótesis históricas distintas; las diferencias del conjunto dependen también de su composición. Los desgloses son secundarios.\n\n`+
`## Riesgo, sensibilidad y estabilidad\n\nPromedio MFE/MAE a 30 minutos: concordancia ${fmt(first.groups.concordance!.meanMfePercent)}/${fmt(first.groups.concordance!.meanMaePercent)} pp; contradicción ${fmt(first.groups.contradiction!.meanMfePercent)}/${fmt(first.groups.contradiction!.meanMaePercent)} pp. MFE no es rentabilidad ejecutable: se desconoce el orden intravela. Porcentaje de cierre favorable: ${fmt(first.groups.concordance!.favorableRate!*100,1)}% y ${fmt(first.groups.contradiction!.favorableRate!*100,1)}%. Los costos son escenarios completos hipotéticos sobre acciones.\n\n| Costo (pb) | Media neta concordancia (pp) | Media neta contradicción (pp) | Fracción neta positiva concordancia | Fracción neta positiva contradicción |\n|---:|---:|---:|---:|---:|\n${costs}\n\n`+
`| Año | Concordantes | Contrarios | Diferencia cruda (pp) | Diferencia ajustada (pp) |\n|---|---:|---:|---:|---:|\n${yearTable}\n\n`+
`La sensibilidad a controles originales conserva ${controlRows.length} señales con referencia; diferencia ajustada de exceso respecto a control: ${fmt(originalControl.adjustedDifference)} pp, con ${originalControl.sharedStrata} estratos compartidos. No reemplaza el resultado principal. El horizonte de 15 minutos da ${fmt(horizons[0]!.estimate.adjustedDifference)} pp y 60 minutos ${fmt(horizons[1]!.estimate.adjustedDifference)} pp, ambos secundarios.\n\n`+
`## Noticias verificadas\n\nEl calendario incluye ${events.length} publicaciones con hora verificada entre CPI, Employment Situation y comunicados FOMC. ${audit.signalsBeforeNews} señales cerraron antes y ${audit.signalsAfterNews} después de al menos una publicación verificada del mismo día; ${audit.signalsAtNews} coincidieron exactamente. Varias publicaciones pueden corresponder a una señal.\n\n`+
news.map(n => `| ${n.category} | ${n.position} | ${n.signals} | ${fmt(n.meanSignedPercent)} |`).join('\n').replace(/^/, '| Categoría | Posición | Señales | Media firmada 30m (pp) |\n|---|---|---:|---:|\n')+
`\n\nLos resultados de NVIDIA sin hora exacta no se asignaron a ventanas intradía; no hubo consensos históricos verificables para calcular sorpresas. Las diferencias por noticias son descriptivas y no prueban causalidad.\n\n`+
`## Integridad y límites\n\nSe verificó la identidad de ${rows.length} señales (F11 ${f11.length}; F12 ${f12.length}) en F13 y su contexto F14, incluyendo índices, timestamps, horizontes y controles. Hubo ${audit.incomplete30} horizontes principales incompletos, ${audit.repeated} señales repetidas y ${audit.overlapping} desenlaces solapados; se conservaron para auditoría. El SHA-256 del CSV NVDA SIP es \`${hashes.source}\`; el código ejecutado corresponde al commit \`${codeVersion}\` y el protocolo al commit \`7ab491edb2c040b096213764ded69352cf593aad\`. Los ETF incluyen exposición a NVDA y los grupos pueden diferir en factores no observados. No se publican velas SIP originales ni se infiere una ventaja operativa causal.\n`;
writeFileSync(join(out, 'phase15-report.md'), report);
writeFileSync(join(out, 'phase15-data-audit.md'), `# Auditoría de Fase 15\n\n`+
`Protocolo previo: \`docs/phase15-research-protocol.md\` (commit \`7ab491edb2c040b096213764ded69352cf593aad\`). Código: \`${codeVersion}\`. Sin nuevas descargas.\n\n`+
`- Señales F11/F12: ${f11.length}/${f12.length}; unión exacta F13/F14: ${rows.length}; identidad, desenlaces y controles: verificados.\n`+
`- Grupos: ${JSON.stringify(audit.groupCounts)}; elegibles a 30 minutos: ${JSON.stringify(audit.eligibleByGroup)}.\n`+
`- Horizontes incompletos: ${audit.incomplete30}; razones: ${JSON.stringify(audit.exclusionReasons)}. Repetidas: ${audit.repeated}; resultados solapados: ${audit.overlapping}.\n`+
`- Control original disponible en ${audit.controlsAvailable} señales. Calendario económico con timestamp verificado usado: ${audit.verifiedEvents}.\n`+
`- Soporte común: ${main.sharedStrata}/${main.totalStrata} estratos; ${main.matched.concordance}/${main.total.concordance} concordantes y ${main.matched.contradiction}/${main.total.contradiction} contradictorias. No se extrapoló fuera del soporte.\n`+
`- Verificación temporal: \`market_available_at_utc = signal_available_at_utc\` para todas las señales; las cuatro velas concluyen a ese cierre. Noticias antes/después según timestamp verificado del mismo día.\n`+
`- SHA-256 fuente NVDA: \`${hashes.source}\`; artefactos F11–F14: ${JSON.stringify(hashes)}. La auditoría F14 conserva hashes de QQQ, SMH, sidecars y calendario.\n`+
`\nLos CSV SIP privados siguen en \`trading_poc_001_bollinger/data/\` del entorno autorizado. Para reproducir los retornos ETF desde cero se requiere acceso autorizado a los mismos insumos Alpaca; la licencia de redistribución de OHLCV SIP no está acreditada. Los archivos publicados contienen datos derivados por señal, sin OHLCV original.\n`);
writeFileSync(join(out, 'README.md'), `# Fase 15: concordancia de mercado\n\nEstudio exploratorio de señales históricas de NVDA y retornos previos de QQQ/SMH. Protocolo: [phase15-research-protocol.md](../../docs/phase15-research-protocol.md), commit \`7ab491edb2c040b096213764ded69352cf593aad\`. Código ejecutado: \`${codeVersion}\`.\n\n- \`phase15-report.md\`: informe en español, decisión y límites.\n- \`phase15-results.json\`: estimaciones, incertidumbre, desgloses y auditoría estructurados.\n- \`phase15-signal-analysis.csv\`: las ${rows.length} señales individuales con grupo, resultados, riesgo, costos y noticias.\n- \`phase15-group-comparison.csv\`: contraste principal y desgloses por familia, año, régimen y horario.\n- \`phase15-robustness.csv\`: cruces secundarios familia-año y familia-régimen.\n- \`phase15-data-audit.md\`: trazabilidad, cobertura, exclusiones y hashes.\n- \`SHA256SUMS.txt\`: integridad de los otros siete archivos.\n\nReproducción en entorno autorizado: \`cd trading_poc_001_bollinger && npm ci && npm run validate:phase15-confirmation\`. Requiere archivos originales F11–F14 y CSV SIP local de NVDA; no descarga datos. El CSV fuente SIP no se redistribuye porque la licencia pública no está verificada.\n`);
const delivered = ['README.md','phase15-data-audit.md','phase15-group-comparison.csv',
  'phase15-report.md','phase15-results.json','phase15-robustness.csv','phase15-signal-analysis.csv'];
writeFileSync(join(out, 'SHA256SUMS.txt'), delivered.map(name =>
  `${sha(readFileSync(join(out, name)))}  ${name}`).join('\n') + '\n');
console.log(JSON.stringify({decision, total: rows.length, main, uncertainty,
  groupCounts: audit.groupCounts, codeVersion}, null, 2));
