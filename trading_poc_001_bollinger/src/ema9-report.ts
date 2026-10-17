import type {Ema9Comparison, Ema9Study} from './ema9-study.ts';
import type {ValidationRow} from './strategy-validation.ts';

const pct = (value: number | null) => value === null ? 'N/D' : `${(value * 100).toFixed(1)}%`;
const pp = (value: number | null) => value === null ? 'N/D' : `${(value * 100).toFixed(1)} pp`;
const move = (value: number | null) => value === null ? 'N/D' : `${value.toFixed(3)}%`;
const side = (direction: ValidationRow['direction']) => direction === 'CALL_CONTEXT' ? 'Alcista' : 'Bajista';
const interval = (value: [number, number] | null) => value ? `${move(value[0])} a ${move(value[1])}` : 'N/D';

export function renderEma9Report(study: Ema9Study, source: string): string {
  const removedRate = study.originalSignals ? study.discardedSignals / study.originalSignals : 0;
  const lines = [
    '# Investigación histórica: Bollinger con filtro EMA 9 en QQQ', '',
    `Fuente local: \`${source}\`. ${study.original.candles} velas, de ${study.original.firstTimestamp} a ${study.original.lastTimestamp}. Evaluación posterior desde ${study.original.splitTimestamp}.`,
    `Bollinger original: ${study.originalSignals} señales; EMA 9 conserva ${study.retainedSignals} y descarta ${study.discardedSignals} (${pct(removedRate)}).`, '',
    'EMA 9 se calcula con cierres de velas de cinco minutos. Su primera salida es la media simple de los primeros nueve cierres; después usa EMA actual = EMA anterior + 0,2 × (cierre actual − EMA anterior). Una señal alcista pasa si EMA actual > anterior; una bajista si EMA actual < anterior. La igualdad se descarta. Solo se leen datos disponibles al cierre de la vela de la señal.', '',
    'Los tres grupos comparten las señales Bollinger originales y la misma referencia de velas **sin señal Bollinger**, por intervalo local de Nueva York y período cronológico. El filtro se aplica después de detectar las señales originales: no cambia Bollinger ni su descanso entre señales. La entrada hipotética es la apertura de la siguiente vela contigua; la salida es el cierre 15, 30 o 60 minutos después de la disponibilidad de la señal. Ni la apertura ni los precios de opciones son ejecuciones garantizadas.', '',
  ];
  const groups = [
    ['Original', study.original], ['Con EMA 9', study.retained], ['Descartadas', study.discarded],
  ] as const;
  for (const segment of ['exploracion', 'evaluacion'] as const) {
    lines.push(`## ${segment === 'exploracion' ? 'Exploración' : 'Evaluación posterior'}`, '',
      '| Grupo | Señal | Min | Detectadas | Evaluables | Comparables | Favorable | Movimiento medio | Magnitud media | Favorable referencia | Diferencia vs referencia | IC 99,17% | Muestra pequeña |',
      '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|');
    for (const [label, group] of groups) {
      for (const row of group.rows.filter(r => r.segment === segment)) {
        lines.push(`| ${label} | ${side(row.direction)} | ${row.horizonMinutes} | ${row.signals} | ${row.eligible.count} | ${row.matchedSignals.count} | ${pct(row.matchedSignals.favorableRate)} | ${move(row.matchedSignals.meanSignedPercent)} | ${move(row.matchedSignals.meanAbsolutePercent)} | ${pct(row.matchedBaseline.favorableRate)} | ${move(row.meanDifferencePercent)} | ${interval(row.differenceInterval99Percent)} | ${row.smallSample ? 'Sí' : 'No'} |`);
      }
    }
    lines.push('', '### Cambio del filtro frente a Bollinger original', '',
      '| Señal | Min | Original evaluables | Con EMA evaluables | Cambio favorable | Cambio movimiento medio | IC 99,17% del cambio | Muestra pequeña |',
      '|---|---:|---:|---:|---:|---:|---|---|');
    for (const comparison of study.comparisons.filter(c => c.segment === segment)) {
      lines.push(`| ${side(comparison.direction)} | ${comparison.horizonMinutes} | ${comparison.originalEligible} | ${comparison.retainedEligible} | ${pp(comparison.retainedMinusOriginalFavorableRate)} | ${move(comparison.retainedMinusOriginalMeanPercent)} | ${comparison.identicalSamples ? 'No aplica: muestras idénticas' : interval(comparison.interval99Percent)} | ${comparison.smallSample ? 'Sí' : 'No'} |`);
    }
    lines.push('');
  }
  const later = study.comparisons.filter(c => c.segment === 'evaluacion');
  const positive = later.filter(c => !c.smallSample && c.interval99Percent !== null && c.interval99Percent[0] > 0);
  if (study.discardedSignals === 0) {
    lines.push('**Conclusión:** EMA 9 no descartó ninguna señal Bollinger en este historial. Los grupos original y filtrado son exactamente iguales, por lo que sus resultados no cambian. El filtro no mejoró la estrategia en estos datos; la identidad entre grupos no necesita un intervalo estadístico de diferencia.');
  } else if (positive.length) {
    lines.push(`**Conclusión exploratoria:** ${positive.map((c: Ema9Comparison) => `${side(c.direction).toLowerCase()} a ${c.horizonMinutes} min`).join(', ')} muestran un cambio medio positivo con intervalo ajustado por encima de cero. La investigación de EMA 9 sigue a una fase anterior sobre los mismos datos; esto no constituye confirmación independiente ni garantiza una ventaja futura.`);
  } else {
    lines.push('**Conclusión:** en la evaluación posterior no se observó una mejora del movimiento medio con intervalo ajustado totalmente positivo y muestra suficiente. No hay evidencia suficiente para afirmar que EMA 9 mejora Bollinger original.');
  }
  lines.push('', 'Cuando los grupos tienen exactamente las mismas observaciones, el intervalo de mejora no aplica. En los demás casos, los intervalos del cambio con EMA remuestrean por día de mercado las señales originales y su subconjunto retenido (2.000 repeticiones; 99,17% por comparación para dos direcciones y tres horizontes). Una celda con menos de 30 señales retenidas o menos de 10 días distintos se marca pequeña y no recibe intervalo. Los intervalos frente a la referencia usan el método exploratorio de Fase 4. No se corrige el hecho de haber investigado EMA después de observar la Fase 4; existen dependencia temporal y referencias reutilizadas. Se necesitan datos posteriores nuevos para confirmación.', '',
    'Todos los cambios son movimientos del precio de QQQ, no ganancias de CALL o PUT. No se modelan spread, deslizamiento, comisiones, liquidez ni ejecución real. Las frecuencias históricas no son probabilidades garantizadas.', '');
  return lines.join('\n');
}
