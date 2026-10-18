import type {NvdaIndicatorsStudy, StudyRow} from './nvda-indicators-study.ts';

const fmt = (value: number | null, digits = 3): string => value === null ? '—' : value.toFixed(digits);
const pct = (value: number | null): string => value === null ? '—' : `${(value * 100).toFixed(1)}%`;
const groupName = {bollinger: 'A Bollinger', ema9: 'B EMA 9', volume: 'C RVOL', ema9_volume: 'D EMA 9 + RVOL'};
function table(rows: readonly StudyRow[]): string {
  const header = '| Grupo | Dirección | Horizonte | Originales | Cobertura | Conservadas | Descartadas | Sin historial | Evaluables | Sesiones | Favorables | Media % | Fav. media % | Desfav. media % | Magnitud abs. % | Δ favorable vs A (pp) | Δ media vs A % | IC 95% Δ vs A % | Control horario: n / Δ media % | IC 95% Δ vs control % | Muestra |\n' +
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|\n';
  return header + rows.map(r => `| ${groupName[r.group]} | ${r.direction === 'CALL_CONTEXT' ? 'Alcista' : 'Bajista'} | ${r.horizonMinutes}m | ${r.original} | ${r.coverage} | ${r.retained} | ${r.discarded} | ${r.insufficient} | ${r.eligible.count} | ${r.distinctSessions} | ${pct(r.eligible.favorableRate)} | ${fmt(r.eligible.meanSignedPercent)} | ${fmt(r.eligible.meanGainPercent)} | ${fmt(r.eligible.meanLossPercent)} | ${fmt(r.eligible.meanAbsolutePercent)} | ${r.differenceFavorableRate === null ? '—' : (r.differenceFavorableRate*100).toFixed(1)} | ${fmt(r.differenceMeanPercent)} | ${r.differenceInterval95Percent ? `[${fmt(r.differenceInterval95Percent[0])}, ${fmt(r.differenceInterval95Percent[1])}]` : '—'} | ${r.matchedControls} / ${fmt(r.differenceVsControlPercent)} | ${r.differenceVsControlInterval95Percent ? `[${fmt(r.differenceVsControlInterval95Percent[0])}, ${fmt(r.differenceVsControlInterval95Percent[1])}]` : '—'} | ${r.smallSample ? 'Pequeña' : '≥30 señales y ≥10 sesiones'} |`).join('\n') + '\n';
}
export function renderNvdaIndicatorsReport(study: NvdaIndicatorsStudy, source: string, provenance: string): string {
  const {calendarAudit: audit} = study;
  const sections = [
    '# Fase 9 — NVDA 15m: Bollinger, EMA 9 y RVOL',
    '',
    `Fuente local: ${source}. ${study.candleCount} velas, ${study.signalCount} señales; desde ${study.firstTimestamp} hasta ${study.lastTimestamp}.`,
    `Calendario: ${provenance}. ${audit.calendarSessions} sesiones programadas en el intervalo, ${audit.observedSessions} observadas, ${audit.missingSessions.length} ausentes por completo y ${audit.partialSessions.length} parciales.`,
    `División por sesiones: ${study.sessionCounts.exploracion} exploración / ${study.sessionCounts.evaluacion} evaluación; primera fecha del tramo final: ${study.splitDate ?? '—'}. El tramo final ya fue examinado en fases previas y no es validación independiente.`,
    '',
    '## Método',
    '',
    '- Señal original: Bollinger SMA 20 y 2 desviaciones poblacionales; compresión en las 100 velas previas (cuantil 20%), expansión >5%, cierre estrictamente fuera de banda y separación original de 12 velas. En 15m, 12 velas son tres horas de negociación. Las bandas se recalculan con cada cierre.',
    '- EMA 9: SMA inicial de nueve cierres y factor 0,2, continua entre sesiones. El filtro usa la pendiente actual frente a la EMA anterior. La posición del cierre frente a la EMA se registra solo como descripción.',
    '- RVOL: volumen de la vela de señal / promedio del mismo intervalo local en las 20 sesiones observadas previas. Se exige RVOL >=1,5; sin las 20 observaciones o con promedio cero, el historial es insuficiente.',
    '- La señal, EMA y RVOL final solo se conocen al cierre de la vela que genera la señal. Entrada hipotética: apertura de la siguiente vela consecutiva. Salida: cierre de la primera, segunda o cuarta vela posterior. Cada horizonte exige continuidad y cierre dentro de la misma sesión, también en días de cierre temprano.',
    '- Rendimiento firmado de la acción NVDA: positivo si favorece la dirección de la señal; no equivale a rentabilidad de opciones. Porcentaje favorable = proporción estrictamente positiva; cero no es favorable.',
    '- A: todas las señales Bollinger. B: pendiente EMA. C: RVOL. D: ambos filtros. Para C y D, el referente A comparable usa únicamente señales con RVOL calculable del mismo tramo, dirección y horizonte; B usa el conjunto completo. La diferencia se calcula entre medias de grupos sobre esa cobertura, no es un efecto causal.',
    '- Control descriptivo: velas sin ninguna señal Bollinger del mismo intervalo local, dirección y tramo cronológico, con horizonte completo. Se promedia la media de control del intervalo para cada señal emparejada; los controles pueden repetirse.',
    '- IC descriptivos del 95% para diferencias de movimiento medio frente a A comparable y frente al control horario: 2.000 remuestreos deterministas de sesiones completas. Se omiten si hay menos de 30 señales evaluables o 10 sesiones. Un intervalo [0, 0] cuando el filtro conserva exactamente todo A refleja identidad de las muestras, no precisión predictiva. No se corrigen comparaciones múltiples.',
    '',
  ];
  for (const [segment, title] of [['total', 'Historial completo'], ['exploracion', 'Primer 70% de sesiones'], ['evaluacion', 'Último 30% de sesiones']] as const) {
    sections.push(`## ${title}`, '', table(study.rows.filter(r => r.segment === segment)), '');
  }
  sections.push('## Cobertura y límites', '',
    `Sesiones ausentes por completo: ${audit.missingSessions.length ? audit.missingSessions.join(', ') : 'ninguna'}.`,
    `Sesiones parciales: ${audit.partialSessions.length ? audit.partialSessions.map(s => `${s.date} (${s.observed}/${s.expected})`).join(', ') : 'ninguna'}.`,
    'Las exclusiones por cierre de sesión y huecos constan por grupo, dirección y horizonte en el JSON. La matriz de CSV contiene los resultados individuales y su causa de ausencia.',
    'Las observaciones se solapan dentro de una sesión; el remuestreo por sesión solo aproxima esta dependencia. Las cuatro configuraciones, dos direcciones y tres horizontes crean múltiples comparaciones sin ajuste. El historial y su tramo final ya se inspeccionaron; hay riesgo de selección retrospectiva y confusión por régimen, hora y volatilidad. Muestras pequeñas e intervalos amplios impiden afirmar una mejora fiable. No hay costes, deslizamiento ni ejecución de opciones.',
    'Los informes se basan en datos locales. La procedencia del calendario se declara tal como aparece en el archivo adjunto; una reconstrucción XNYS no equivale a un calendario original certificado por Alpaca.', '');
  return sections.join('\n');
}
