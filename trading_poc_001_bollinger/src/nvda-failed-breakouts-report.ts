import type {FailedBreakoutStudy, StudyRow, BreakSide} from './nvda-failed-breakouts.ts';

const label: Record<BreakSide, string> = {
  high: 'A. Falla del máximo (bajista)', low: 'B. Falla del mínimo (alcista)',
};
const fmt = (value: number | null, digits = 3): string => value === null ? 'N/D' : value.toFixed(digits);
const pct = (value: number | null): string => value === null ? 'N/D' : (value * 100).toFixed(1) + '%';
const interval = (value: [number, number] | null): string => value === null ? 'N/D' :
  `[${fmt(value[0])}, ${fmt(value[1])}]`;

function primaryRow(row: StudyRow): string {
  return '| ' + [label[row.side], row.initialBreakouts, row.confirmedFailures,
    row.noReturn, row.incompleteObservation, row.eligible.count, row.distinctSessions,
    row.matchedEvents, pct(row.eligible.favorableRate), interval(row.favorableInterval95),
    fmt(row.eligible.meanSignedPercent), fmt(row.eligible.meanFavorablePercent),
    fmt(row.eligible.meanAdversePercent), fmt(row.eligible.meanMfePercent),
    fmt(row.eligible.meanMaePercent), fmt(row.matchedSignalMeanPercent),
    fmt(row.referenceMeanPercent),
    fmt(row.differenceMeanPercent), interval(row.differenceInterval95Percent),
    fmt(row.holmP, 4)].join(' | ') + ' |';
}

export function renderPhase12Report(study: FailedBreakoutStudy, source: string,
  sourceSha256: string, codeVersion: string): string {
  const primary = study.rows.filter(row => row.scope === 'total' && row.horizonMinutes === 30);
  const secondary = study.rows.filter(row => row.scope === 'total' && row.horizonMinutes !== 30);
  const periods = study.rows.filter(row => row.horizonMinutes === 30 &&
    (row.scope === 'first70' || row.scope === 'last30' || /^\d{4}$/.test(row.scope)));
  const lines = [
    '# Fase 12: rupturas fallidas del máximo y mínimo previo de NVDA', '',
    'Estudio retrospectivo **exploratorio**. Ninguna fecha dentro de este archivo constituye validación prospectiva. ' +
      'No se investigan opciones ni se generan operaciones reales.', '',
    `Fuente: ${source}. SHA-256 del CSV fuente: \`${sourceSha256}\`.`,
    `Versión del código utilizada: \`${codeVersion}\` (commit previo a generar estos artefactos).`,
    `Velas: ${study.candles}; rango UTC: ${study.firstTimestamp} a ${study.lastTimestamp}.`,
    `Sesiones observadas: ${study.calendarAudit.observedSessions} de ${study.calendarAudit.calendarSessions}; ` +
      `${study.calendarAudit.missingSessions.length} ausentes y ` +
      `${study.calendarAudit.partialSessions.length} parciales.`,
    `Sesiones con nivel anterior válido: ${study.coverage.referenceAvailableSessions}; ` +
      `sin nivel anterior: ${study.coverage.referenceUnavailableSessions}.`,
    '', 'El protocolo fijo previo al análisis está en `docs/phase12-research-protocol.md`. ' +
      'La ruptura inicial no es una señal de reversión: la falla exige retorno estricto en la primera o segunda vela siguiente. ' +
      'La entrada hipotética sigue al cierre de confirmación; el horizonte principal termina al cierre de la segunda vela posterior.',
    '', '## Dos comparaciones principales: 30 minutos', '',
    '| Hipótesis | Rupturas iniciales | Fallas | Sin regreso | Observación incompleta | Evaluables | Sesiones | Con control | Favorables | IC 95% favorables | Media % | Favorable media % | Desfavorable media % | MFE media % | MAE media % | Media emparejada % | Control % | Diferencia % | IC 95% diferencia % | p Holm |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|',
    ...primary.map(primaryRow), '',
    'El control principal procede de otras rupturas iniciales del mismo lado, año, bloque horario local y ' +
      'desplazamiento de confirmación; no habían fallado **hasta ese momento**. Para una falla en la primera ' +
      'observación, no se mira la segunda para seleccionar controles. Se necesitan diez observaciones de diez ' +
      'sesiones distintas. La diferencia es la media emparejada menos el control; la columna «Media %» ' +
      'incluye todas las señales evaluables. El intervalo y p se calculan solo en señales emparejadas. ' +
      'Se remuestrean sesiones completas 2.000 veces y se aplica Holm a las dos pruebas principales.',
    '', 'MFE es el máximo movimiento favorable y MAE el máximo desfavorable entre entrada y salida; ' +
      'los extremos dentro de una vela no tienen un orden conocido ni son ganancias/pérdidas ejecutables.',
    '', '## Clasificación', '',
    ...study.classifications.map(item => `- **${label[item.side]}: ${item.label}.** ${item.reason}`), '',
    'Ninguna etiqueta inconclusa demuestra una ventaja ni justifica avanzar por sí sola a una validación prospectiva.', '',
    '## Horizontes secundarios: 15 y 60 minutos', '',
    '| Hipótesis | Horizonte | Evaluables | Favorables | Media % | MFE % | MAE % | Diferencia con control % | IC 95% diferencia % |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---|',
    ...secondary.map(row => '| ' + [label[row.side], row.horizonMinutes + 'm', row.eligible.count,
      pct(row.eligible.favorableRate), fmt(row.eligible.meanSignedPercent),
      fmt(row.eligible.meanMfePercent), fmt(row.eligible.meanMaePercent),
      fmt(row.differenceMeanPercent), interval(row.differenceInterval95Percent)].join(' | ') + ' |'), '',
    'Estos horizontes no reemplazan retroactivamente la prueba de 30 minutos.', '',
    '## Costos hipotéticos por operación completa sobre acciones', '',
    '| Hipótesis | Costo (pb) | Media neta % | Favorables netas |',
    '|---|---:|---:|---:|',
    ...primary.flatMap(row => row.costSensitivity.map(cost => '| ' +
      [label[row.side], cost.bps, fmt(cost.netMeanPercent), pct(cost.netFavorableRate)].join(' | ') + ' |')), '',
    'Estos costos no son una estimación certificada de ejecución. No se calcula rentabilidad de opciones.', '',
    '## Años y cortes cronológicos: horizonte principal', '',
    `Corte 70/30 de sesiones en ${study.splitDate ?? 'N/D'}. Ambos tramos son históricos, no prospectivos.`, '',
    '| Tramo | Hipótesis | Rupturas | Fallas | Sin regreso | Incompletas | Evaluables | Sesiones | Con control | Media % | Media emparejada % | Control % | Diferencia % | IC 95% diferencia % |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|',
    ...periods.map(row => '| ' + [row.scope, label[row.side], row.initialBreakouts,
      row.confirmedFailures, row.noReturn, row.incompleteObservation,
      row.eligible.count, row.distinctSessions, row.matchedEvents,
      fmt(row.eligible.meanSignedPercent), fmt(row.matchedSignalMeanPercent),
      fmt(row.referenceMeanPercent),
      fmt(row.differenceMeanPercent), interval(row.differenceInterval95Percent)].join(' | ') + ' |'), '',
    '## Exclusiones, SMA descriptivas y dependencia entre eventos', '',
    ...primary.map(row => `- ${label[row.side]}: cierre de sesión ${row.excluded.session_close}; ` +
      `siguiente vela ausente ${row.excluded.missing_next}; horizonte interrumpido ` +
      `${row.excluded.missing_intermediate}; sin controles suficientes ${row.unmatchedEvents}.`),
    `Contexto SMA al inicio de la confirmación, **sin filtrar señales**: alcista ` +
      `${study.contextCounts.bullish}, bajista ${study.contextCounts.bearish}, ` +
      `contradictorio ${study.contextCounts.contradictory}, igualdad ${study.contextCounts.neutral}, ` +
      `insuficiente ${study.contextCounts.insufficient}.`,
    `Señales repetidas en menos de cuatro barras: ${study.repeatAudit.repeated}; ` +
      `ventanas principales solapadas: ${study.repeatAudit.overlappingPrimary}; ` +
      `señales retenidas al quitar repeticiones: ${study.repeatAudit.deduplicatedRetained}.`, '',
    '| Hipótesis | Evaluables originales | Media original % | Evaluables sin repetición | Media sin repetición % |',
    '|---|---:|---:|---:|---:|',
    ...study.repeatSensitivity.map(item => '| ' + [label[item.side], item.original.count,
      fmt(item.original.meanSignedPercent), item.deduplicated.count,
      fmt(item.deduplicated.meanSignedPercent)].join(' | ') + ' |'), '',
    'La sensibilidad sin repetición es descriptiva y no sustituye la prueba principal. ' +
      'Los episodios sin regreso figuran en el CSV de eventos; los controles de primera observación ' +
      'pueden incluir episodios que fallaron más tarde.', '',
    '## Límites de interpretación', '',
    'El emparejamiento restringe año, horario y tipo de ruptura, pero no elimina diferencias de volatilidad, ' +
      'noticias o liquidez. El remuestreo mantiene los controles fijos. Se preservan resultados desfavorables y ' +
      'casos sin control. Las hipótesis fueron formuladas después de analizar el historial previo; ' +
      'un resultado histórico favorable requeriría datos nuevos posteriores al protocolo.', '',
  ];
  return lines.join('\n');
}

export function renderPhase12DataAudit(study: FailedBreakoutStudy, source: string,
  hashes: Record<'csv' | 'metadata' | 'calendar' | 'provenance', string>,
  codeVersion: string, metadata: Record<string, unknown>, provenance: Record<string, unknown>): string {
  const firstYear = Number(study.firstTimestamp.slice(0, 4));
  const lastYear = Number(study.lastTimestamp.slice(0, 4));
  const years = Array.from({length: lastYear - firstYear + 1}, (_, index) => String(firstYear + index));
  const lines = [
    '# Fase 12: auditoría de datos y procedencia', '',
    `Código utilizado: \`${codeVersion}\`. Fuente local: \`${source}\`.`,
    'No se descargaron datos nuevos ni se añadieron velas SIP originales a este PR. ' +
      'Las credenciales no se registran en estos artefactos.', '',
    '## Identidad y sumas de entrada', '',
    '| Archivo | SHA-256 |', '|---|---|',
    ...(['csv', 'metadata', 'calendar', 'provenance'] as const).map(kind =>
      `| ${kind} | \`${hashes[kind]}\` |`), '',
    `Proveedor: ${metadata.provider}; activo: ${metadata.asset}; clase: ${metadata.data_class}; ` +
      `15 minutos: ${metadata.bar_minutes}; feed: ${metadata.feed}; ajuste: ${metadata.adjustment}; ` +
      `sesión: ${metadata.session}.`,
    `Procedencia declarada: proveedor ${provenance.provider}; timeframe ${provenance.timeframe}; ` +
      `feed ${provenance.feed}; ajuste ${provenance.adjustment}; sesión ${provenance.session}; ` +
      `ventana solicitada ${provenance.requested_start} a ${provenance.requested_end}.`, '',
    '## Cobertura y calendario', '',
    `Velas cargadas: ${study.candles}; primera ${study.firstTimestamp}; última ${study.lastTimestamp}.`,
    `Sesiones programadas en el rango observado: ${study.calendarAudit.calendarSessions}; ` +
      `observadas: ${study.calendarAudit.observedSessions}; ausentes: ` +
      `${study.calendarAudit.missingSessions.length}; parciales: ` +
      `${study.calendarAudit.partialSessions.length}.`,
    `Sesiones observadas con referencia del día previo completo: ` +
      `${study.coverage.referenceAvailableSessions}; sin referencia: ` +
      `${study.coverage.referenceUnavailableSessions}.`,
    `Agregaciones horarias completas/incompletas: ${study.coverage.hourlyComplete}/` +
      `${study.coverage.hourlyIncomplete}; diarias completas/incompletas: ` +
      `${study.coverage.dailyComplete}/${study.coverage.dailyIncomplete}.`, '',
    '| Año | Sesiones ausentes | Sesiones parciales |', '|---|---:|---:|',
    ...years.map(year => '| ' + [year,
      study.calendarAudit.missingSessions.filter(day => day.startsWith(year)).length,
      study.calendarAudit.partialSessions.filter(item => item.date.startsWith(year)).length]
      .join(' | ') + ' |'), '',
    'Sesiones ausentes: ' + (study.calendarAudit.missingSessions.join(', ') || 'ninguna') + '.',
    'Sesiones parciales: ' + (study.calendarAudit.partialSessions.map(item =>
      `${item.date} (${item.observed}/${item.expected})`).join(', ') || 'ninguna') + '.', '',
    'La referencia de cada sesión exige que la sesión bursátil programada inmediatamente anterior esté ' +
      'completa. Festivos y cierres anticipados provienen del calendario adjunto; huecos de datos ' +
      'descalifican el nivel y los horizontes afectados.', '',
  ];
  return lines.join('\n');
}
