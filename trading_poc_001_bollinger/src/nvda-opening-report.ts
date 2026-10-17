import type {OpeningGroup, OpeningHorizon, OpeningRow, OpeningSegment, OpeningStudy} from './nvda-opening-study.ts';

const pct = (value: number | null) => value === null ? 'N/D' : `${(value * 100).toFixed(1)}%`;
const num = (value: number | null, digits = 1) => value === null ? 'N/D' : value.toFixed(digits);
const distance = (value: number | null) => value === null ? 'N/D' : `${value.toFixed(2)}%`;
const interval = (value: [number, number] | null) => value ?
  `${pct(value[0])} a ${pct(value[1])}` : 'N/D';
const label: Record<OpeningGroup, string> = {
  encima: 'Abre encima', debajo: 'Abre debajo',
  alta_vol_encima: 'Alta volatilidad: encima', alta_vol_debajo: 'Alta volatilidad: debajo',
};
const horizonLabel = (horizon: OpeningHorizon) => horizon === 'sesion' ? 'Sesión completa' : `${horizon} min`;

function table(lines: string[], rows: readonly OpeningRow[], segment: OpeningSegment): void {
  lines.push('| Grupo | Horizonte | Aperturas | Evaluables | Regresos por rango | % rango | IC Wilson 95% | Confirmados por cierre | % cierre | IC Wilson 95% | Min hasta primer rango* | Distancia inicial media | Nunca regresó** | Muestra pequeña |',
    '|---|---|---:|---:|---:|---:|---|---:|---:|---|---:|---:|---:|---|');
  for (const row of rows.filter(item => item.segment === segment)) {
    lines.push(`| ${label[row.group]} | ${horizonLabel(row.horizon)} | ${row.openings} | ${row.evaluable} | ${row.rangeReturns} | ${pct(row.rangeRate)} | ${interval(row.rangeWilson95)} | ${row.closeReturns} | ${pct(row.closeRate)} | ${interval(row.closeWilson95)} | ${num(row.meanFirstRangeByMinutes)} | ${distance(row.meanInitialDistancePercent)} | ${row.neverReturned ?? 'N/D'} | ${row.smallSample ? 'Sí' : 'No'} |`);
  }
  lines.push('');
}

export function renderNvdaOpeningReport(study: OpeningStudy, source: string): string {
  const lines = [
    '# NVDA: regreso a bandas de Bollinger tras apertura fuera de banda', '',
    `Fuente local: \`${source}\`. ${study.candles} velas NVDA SIP ajustadas por split, de 15 minutos. ${study.calendarSessions} sesiones del calendario entre la primera y última vela. Corte cronológico 70/30 desde ${study.splitDate}.`, '',
    'La SMA 20 y las bandas ±2 desviaciones estándar poblacionales se calculan solo con los **20 cierres anteriores a las 09:30 de Nueva York**. Los valores se congelan para toda la sesión. Una apertura exactamente en una banda no se clasifica como fuera. La volatilidad elevada se define antes de ver los resultados como **ancho previo de bandas ≥ 4% de la SMA 20**; es un umbral descriptivo fijo, no optimizado.', '',
    'Para una apertura sobre la banda superior, el regreso por rango requiere **mínimo < banda superior**; para una apertura bajo la banda inferior requiere **máximo > banda inferior**. Tocar exactamente la banda no cuenta. La confirmación por cierre requiere respectivamente **cierre < banda superior** o **cierre > banda inferior**. Se usa la banda congelada, no la banda recalculada durante la sesión. Entrar por la banda no equivale a llegar a la SMA 20.', '',
    'Cada horizonte requiere todas las velas de 15 minutos desde la apertura hasta ese límite. Una sesión incompleta no se cuenta como «nunca regresó» en el horizonte de sesión completa. Los cierres anticipados siguen el calendario Alpaca; festivos no se inventan. Los horarios se interpretan en `America/New_York`, con cambio automático entre EST y EDT. Si la ventana descargada comienza a media sesión, esa primera fecha puede figurar sin apertura de 09:30 sin representar un error del proveedor.', '',
  ];
  for (const segment of ['total', 'exploracion', 'evaluacion'] as const) {
    const audits = study.sessions.filter(item => segment === 'total' || item.segment === segment);
    const events = study.events.filter(item => segment === 'total' || item.segment === segment);
    const evaluated = audits.filter(item => item.status === 'evaluada');
    lines.push(`## ${segment === 'total' ? 'Total observado' : segment === 'exploracion' ? 'Primer 70% cronológico' : 'Último 30% cronológico'}`, '',
      `Días del calendario: **${audits.length}**; días evaluados con 09:30 y 20 cierres previos: **${evaluated.length}**; sin barra de apertura: ${audits.filter(item => item.status === 'sin_apertura_0930').length}; sin 20 cierres previos: ${audits.filter(item => item.status === 'sin_20_previas').length}; sesiones evaluadas incompletas: ${evaluated.filter(item => !item.completeSession).length}.`,
      `Aperturas fuera de banda: **${events.length}** (${events.filter(event => event.direction === 'encima').length} encima, ${events.filter(event => event.direction === 'debajo').length} debajo); de ellas, ${events.filter(event => event.highVolatility).length} con volatilidad elevada.`, '');
    table(lines, study.rows, segment);
  }
  const above = study.rows.find(row => row.segment === 'total' && row.group === 'encima' && row.horizon === 'sesion')!;
  const below = study.rows.find(row => row.segment === 'total' && row.group === 'debajo' && row.horizon === 'sesion')!;
  lines.push(`**Lectura descriptiva:** en sesiones completas, el regreso por rango se observó en ${above.rangeReturns} de ${above.evaluable} aperturas por encima (${pct(above.rangeRate)}) y en ${below.rangeReturns} de ${below.evaluable} aperturas por debajo (${pct(below.rangeRate)}). Hubo ${above.neverReturned ?? 0} y ${below.neverReturned ?? 0} casos, respectivamente, que no regresaron. Estos porcentajes históricos no garantizan el comportamiento futuro.`, '',
    '*El tiempo por rango se expresa como el **final de la primera vela de 15 minutos** en que se observó el cruce: es un límite superior discretizado, no la hora exacta dentro de la vela. Se promedia solo entre casos que regresaron. La distancia inicial media se expresa como porcentaje de la banda cruzada y se calcula entre aperturas evaluables del renglón.',
    '**«Nunca regresó» solo se informa cuando se observó la sesión completa. Un cierre de vela puede confirmar más tarde que el primer toque intravela.', '',
    'Los intervalos Wilson 95% describen incertidumbre binomial orientativa; asumen más independencia de la que podría haber entre sesiones. Hay múltiples horizontes y subgrupos solapados, sin corrección conjunta. Menos de 30 aperturas evaluables se marca como muestra pequeña. El 70/30 es cronológico y no se usó para ajustar 20, 2 ni 4%; el tramo final tampoco constituye garantía de validación independiente. No se modelan operaciones ni rentabilidad de opciones, spreads, comisiones o ejecución.', '');
  return lines.join('\n');
}
