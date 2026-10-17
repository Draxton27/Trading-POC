import type {ValidationRow, ValidationStudy} from './strategy-validation.ts';

const pct = (value: number | null) => value === null ? 'N/D' : `${(value * 100).toFixed(1)}%`;
const points = (value: number | null) => value === null ? 'N/D' : `${value.toFixed(3)}%`;
const direction = (row: ValidationRow) => row.direction === 'CALL_CONTEXT' ? 'Alcista' : 'Bajista';

export function renderValidationReport(study: ValidationStudy, source: string): string {
  const lines = [
    '# Validación histórica de señales Bollinger en QQQ', '',
    `Fuente local: \`${source}\`. ${study.candles} velas entre ${study.firstTimestamp} y ${study.lastTimestamp}.`,
    `Señales detectadas: ${study.totalSignals}. División cronológica cercana a 70/30, iniciando la evaluación en una nueva sesión; evaluación desde ${study.splitTimestamp}.`, '',
    'Cada señal se conoce al cierre de su vela. Se simula una entrada al **precio de apertura de la siguiente vela contigua**; la salida es el cierre de la vela 3, 6 o 12 posterior a la señal (15, 30 o 60 minutos desde que estuvo disponible). La apertura no es una ejecución garantizada. Se excluyen saltos de sesión, huecos y horizontes que cruzan el límite entre exploración y evaluación.', '',
    'La referencia utiliza velas **sin señal** del mismo intervalo local de cinco minutos en Nueva York y del mismo tramo cronológico. Cada señal comparable recibe el promedio de sus referencias; las referencias pueden reutilizarse entre señales. Los cambios se expresan en precio de QQQ, con signo invertido para señales bajistas. No son rendimientos de opciones ni descuentan spreads, comisiones o deslizamiento.', '',
  ];
  for (const segment of ['exploracion', 'evaluacion'] as const) {
    lines.push(`## ${segment === 'exploracion' ? 'Exploración (primer 70%)' : 'Evaluación posterior (último 30%)'}`, '',
      '| Señal | Min | Detectadas | Evaluables | Comparables | Favorable señal | Favorable referencia | Movimiento favorable medio | Movimiento desfavorable medio | Magnitud media | Diferencia media vs referencia | IC 99,17% diferencia | Muestra pequeña |',
      '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|');
    for (const row of study.rows.filter(r => r.segment === segment)) {
      const interval = row.differenceInterval99Percent;
      lines.push(`| ${direction(row)} | ${row.horizonMinutes} | ${row.signals} | ${row.eligible.count} | ${row.matchedSignals.count} | ${pct(row.matchedSignals.favorableRate)} | ${pct(row.matchedBaseline.favorableRate)} | ${points(row.eligible.meanGainPercent)} | ${points(row.eligible.meanLossPercent)} | ${points(row.eligible.meanAbsolutePercent)} | ${points(row.meanDifferencePercent)} | ${interval ? `${points(interval[0])} a ${points(interval[1])}` : 'N/D'} | ${row.smallSample ? 'Sí' : 'No'} |`);
    }
    lines.push('');
  }
  lines.push('## Cobertura y lectura', '');
  for (const row of study.rows.filter(r => r.segment === 'evaluacion')) {
    lines.push(`- ${direction(row)} ${row.horizonMinutes} min: ${row.excludedNoNextBar} sin siguiente vela contigua, ${row.excludedIncompleteHorizon} sin horizonte completo, ${row.unmatched} sin referencia horaria; ${row.baselineObservations} observaciones de referencia ponderadas y ${row.distinctSignalDays} días con señales comparables.`);
  }
  lines.push('');
  const evaluation = study.rows.filter(r => r.segment === 'evaluacion');
  const positiveExploration = study.rows.filter(r => r.segment === 'exploracion' &&
    r.meanDifferencePercent !== null && r.meanDifferencePercent > 0);
  const retained = positiveExploration.filter(r => evaluation.some(e => e.direction === r.direction &&
    e.horizonMinutes === r.horizonMinutes && e.meanDifferencePercent !== null && e.meanDifferencePercent > 0));
  lines.push(`En la evaluación posterior, el signo permaneció positivo en ${retained.length} de las ${positiveExploration.length} combinaciones con diferencia media positiva en exploración. Mantener el signo no establece significación estadística.`, '');
  if (evaluation.every(r => r.smallSample)) {
    lines.push('**Conclusión:** las muestras comparables del período posterior son pequeñas (menos de 30 señales o menos de 10 días por comparación). No hay base suficiente para afirmar una ventaja estadística de esta estrategia. Las diferencias observadas son descriptivas.');
  } else {
    const positive = evaluation.filter(r => !r.smallSample && r.differenceInterval99Percent?.[0]! > 0);
    if (positive.length) {
      lines.push(`**Conclusión exploratoria:** ${positive.map(r => `${direction(r).toLowerCase()} a ${r.horizonMinutes} min`).join(', ')} mostraron una diferencia media positiva cuyo intervalo ajustado no cruza cero en el período posterior. Esto no demuestra una ventaja ejecutable ni garantiza resultados futuros; deben comprobarse más períodos y costos.`);
    } else {
      lines.push('**Conclusión:** en el período posterior no se observó una diferencia media positiva con intervalo ajustado completamente por encima de cero y muestra suficiente. No se puede afirmar una ventaja estadística.');
    }
  }
  lines.push('', 'Las celdas sin intervalo tienen menos de 30 señales comparables o menos de 10 días distintos. El intervalo usa remuestreo por día de mercado (2.000 repeticiones) y nivel 99,17% por comparación para seis combinaciones de dirección y horizonte. Es aproximado; las observaciones, señales y referencias pueden depender entre sí. La regla Bollinger no se ajustó con el período posterior.', '',
    '**Investigación histórica, no asesoramiento financiero ni simulación de operaciones ejecutables.**', '');
  return lines.join('\n');
}
