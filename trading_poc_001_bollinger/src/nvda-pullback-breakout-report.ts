import type {Phase11Study, Row, Strategy, Side} from './nvda-pullback-breakout.ts';

const strategyLabel: Record<Strategy, string> = {pullback: 'A. Retroceso y recuperación',
  breakout: 'B. Ruptura simple'};
const sideLabel: Record<Side, string> = {bullish: 'Alcista', bearish: 'Bajista'};
const fmt = (value: number | null, digits = 3): string => value === null ? 'N/D' : value.toFixed(digits);
const pct = (value: number | null): string => value === null ? 'N/D' : (value * 100).toFixed(1) + '%';
const interval = (value: [number, number] | null): string =>
  value === null ? 'N/D' : '[' + fmt(value[0]) + ', ' + fmt(value[1]) + ']';

function rowMarkdown(row: Row): string {
  return '| ' + [strategyLabel[row.strategy], sideLabel[row.direction], row.signals,
    row.eligible.count, row.distinctSessions, row.matchedEvents,
    pct(row.eligible.favorableRate), row.favorableInterval95 === null ? 'N/D' :
      '[' + pct(row.favorableInterval95[0]) + ', ' + pct(row.favorableInterval95[1]) + ']',
    fmt(row.eligible.meanSignedPercent),
    fmt(row.eligible.meanFavorablePercent), fmt(row.eligible.meanAdversePercent),
    fmt(row.referenceMeanPercent), fmt(row.differenceMeanPercent),
    interval(row.differenceInterval95Percent), fmt(row.holmP, 4)].join(' | ') + ' |';
}

export function renderNvdaPullbackBreakoutReport(study: Phase11Study, source: string,
  sha256: string): string {
  const primary = study.rows.filter(row => row.scope === 'total' && row.horizonMinutes === 30);
  const secondary = study.rows.filter(row => row.scope === 'total' && row.horizonMinutes !== 30);
  const periods = study.rows.filter(row => row.horizonMinutes === 30 &&
    (row.scope === 'first70' || row.scope === 'last30' || /^\d{4}$/.test(row.scope)));
  const lines: string[] = [
    '# Fase 11: retrocesos y rupturas de NVDA', '',
    'Estudio histórico exploratorio. No constituye una validación prospectiva, un sistema de operaciones ni un estudio de opciones.',
    '', 'Fuente: ' + source + '. SHA-256 del CSV: ' + sha256 + '.',
    'Velas: ' + study.candles + '; rango observado: ' + study.firstTimestamp + ' a ' + study.lastTimestamp + '.',
    'Calendario: ' + study.calendarAudit.observedSessions + '/' + study.calendarAudit.calendarSessions +
      ' sesiones observadas; ' + study.calendarAudit.missingSessions.length + ' ausentes y ' +
      study.calendarAudit.partialSessions.length + ' parciales.',
    'Agregaciones completas: ' + study.aggregation.hourlyComplete + ' horarias y ' +
      study.aggregation.dailyComplete + ' diarias. Incompletas: ' + study.aggregation.hourlyIncomplete +
      ' horarias y ' + study.aggregation.dailyIncomplete + ' diarias.',
    'Contextos de las velas: alcista ' + study.contextCounts.bullish + ', bajista ' +
      study.contextCounts.bearish + ', contradictorio ' + study.contextCounts.contradictory +
      ', igualdad/neutral ' + study.contextCounts.neutral + ', insuficiente ' +
      study.contextCounts.insufficient + '.', '',
    'El protocolo se fijó en docs/phase11-research-protocol.md antes de ejecutar este estudio. ' +
      'Señal al cierre de la vela; entrada hipotética en la siguiente apertura. Horizonte principal: 30 minutos.',
    '', '## Comparaciones principales: 30 minutos', '',
    '| Hipótesis | Sentido | Señales | Evaluables | Sesiones | Con control | Favorables | IC 95% favorables | Media % | Favorable media % | Desfavorable media % | Control % | Diferencia % | IC 95% diferencia % | p Holm |',
    '|---|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---|---:|',
    ...primary.map(rowMarkdown), '',
    'Los controles son velas sin ninguno de los dos eventos, con la misma dirección de tendencia, año y hora de Nueva York, ' +
      'de otras sesiones. Cada evento requiere diez controles de diez sesiones. La diferencia y sus intervalos se calculan ' +
      'solo donde existe referencia. Los intervalos se remuestrean por sesión (2.000 bloques); p de Holm corrige las cuatro ' +
      'comparaciones principales. Son inferencias exploratorias condicionadas a la referencia construida.',
    '', '## Decisión por hipótesis', '',
    ...study.classifications.map(item => '- **' + strategyLabel[item.strategy] + ', ' +
      sideLabel[item.direction].toLowerCase() + ': ' + item.label + '.** ' + item.reason), '',
    '## Horizonte secundario: 15 y 60 minutos', '',
    '| Hipótesis | Sentido | Horizonte | Evaluables | Favorables | Media % | Diferencia con control % | IC 95% diferencia % |',
    '|---|---|---:|---:|---:|---:|---:|---|',
    ...secondary.map(row => '| ' + [strategyLabel[row.strategy], sideLabel[row.direction],
      row.horizonMinutes + 'm', row.eligible.count, pct(row.eligible.favorableRate),
      fmt(row.eligible.meanSignedPercent), fmt(row.differenceMeanPercent),
      interval(row.differenceInterval95Percent)].join(' | ') + ' |'), '',
    'Los horizontes secundarios no sustituyen el principal aunque parezcan más favorables.', '',
    '## Sensibilidad a costos por operación completa sobre acciones', '',
    '| Hipótesis | Sentido | Costo (pb) | Media neta % | Favorables netas |',
    '|---|---|---:|---:|---:|',
    ...primary.flatMap(row => row.costSensitivity.map(cost => '| ' +
      [strategyLabel[row.strategy], sideLabel[row.direction], cost.bps,
        fmt(cost.netMeanPercent), pct(cost.netFavorableRate)].join(' | ') + ' |')), '',
    'Los 0, 5, 10 y 20 puntos básicos son escenarios hipotéticos; no estiman ejecución real ni valor de contratos.', '',
    '## Años y divisiones cronológicas, horizonte principal', '',
    'Corte 70/30 por sesiones en ' + (study.splitDate ?? 'N/D') +
      '. Ambos tramos son retrospectivos; el último puede incluir fechas ya examinadas.', '',
    '| Tramo | Hipótesis | Sentido | Señales | Evaluables | Sesiones | Con control | Media % | Control % | Diferencia % | IC 95% diferencia % |',
    '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|',
    ...periods.map(row => '| ' + [row.scope, strategyLabel[row.strategy], sideLabel[row.direction],
      row.signals, row.eligible.count, row.distinctSessions, row.matchedEvents,
      fmt(row.eligible.meanSignedPercent), fmt(row.referenceMeanPercent),
      fmt(row.differenceMeanPercent), interval(row.differenceInterval95Percent)].join(' | ') + ' |'), '',
    '## Exclusiones, repeticiones y relación con compresión', '',
    'En las cuatro comparaciones principales, las causas de exclusión del resultado de 30 minutos son:',
    ...primary.map(row => '- ' + strategyLabel[row.strategy] + ', ' + sideLabel[row.direction].toLowerCase() +
      ': cierre de sesión ' + row.excluded.session_close + ', próxima vela ausente ' +
      row.excluded.missing_next + ', horizonte incompleto ' + row.excluded.missing_intermediate +
      ', sin referencia comparable ' + row.unmatchedEvents + '.'),
    'Eventos repetidos a menos de cuatro barras: ' + study.repeatAudit.repeated +
      '; ventanas principales solapadas con un evento anterior: ' + study.repeatAudit.overlappingPrimary +
      '; eventos retenidos al quitar repeticiones: ' + study.repeatAudit.deduplicatedRetained + '.',
    'Sensibilidad descriptiva al quitar repeticiones, horizonte principal:', '',
    '| Hipótesis | Sentido | Evaluables originales | Media original % | Evaluables sin repetición | Media sin repetición % |',
    '|---|---|---:|---:|---:|---:|',
    ...study.repeatSensitivity.map(item => '| ' + [strategyLabel[item.strategy],
      sideLabel[item.direction], item.raw.count, fmt(item.raw.meanSignedPercent),
      item.deduplicated.count, fmt(item.deduplicated.meanSignedPercent)].join(' | ') + ' |'), '',
    'Rupturas simples: ' + study.compression.simpleBreakouts + '; coincidentes en la misma vela y dirección con ' +
      study.compression.historicalSignals + ' señales históricas de compresión: ' +
      study.compression.coincident + '. Comparación descriptiva con contexto de tendencia y resultado de 30 minutos:', '',
    '| Sentido | Rupturas evaluables | Media ruptura % | Compresiones históricas evaluables | Media compresión % | Coincidentes |',
    '|---|---:|---:|---:|---:|---:|',
    ...study.compressionComparison.map(item => '| ' + [sideLabel[item.direction],
      item.simple.count, fmt(item.simple.meanSignedPercent), item.historical.count,
      fmt(item.historical.meanSignedPercent), item.coincident].join(' | ') + ' |'), '',
    'La compresión histórica tiene su propia selección y separación de señales. Esta tabla no representa una prueba causal ni otra comparación principal.', '',
    'La selección de estas hipótesis siguió estudios previos y puede estar afectada por revisión retrospectiva. ' +
      'Los resultados negativos y las referencias insuficientes se conservan. Una pequeña diferencia después de ' +
      'examinar muchas combinaciones no demuestra ventaja; una hipótesis favorable necesitaría datos nuevos posteriores ' +
      'al protocolo para validación prospectiva.', '',
  ];
  return lines.join('\n');
}
