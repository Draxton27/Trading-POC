import type {VolumeStudy} from './volume-study.ts';
import type {ValidationRow} from './strategy-validation.ts';

const pct = (value: number | null) => value === null ? 'N/D' : `${(value * 100).toFixed(1)}%`;
const pp = (value: number | null) => value === null ? 'N/D' : `${(value * 100).toFixed(1)} pp`;
const move = (value: number | null) => value === null ? 'N/D' : `${value.toFixed(3)}%`;
const side = (direction: ValidationRow['direction']) => direction === 'CALL_CONTEXT' ? 'Alcista' : 'Bajista';
const interval = (value: [number, number] | null) => value ? `${move(value[0])} a ${move(value[1])}` : 'N/D';

export function renderVolumeReport(study: VolumeStudy, source: string): string {
  const share = (n: number) => pct(study.originalSignals ? n / study.originalSignals : null);
  const lines = [
    '# Investigación exploratoria: Bollinger con filtro de volumen en QQQ', '',
    `Fuente local: \`${source}\`. ${study.original.candles} velas, de ${study.original.firstTimestamp} a ${study.original.lastTimestamp}. Corte cronológico desde ${study.original.splitTimestamp}.`,
    `Bollinger original: **${study.originalSignals} señales**; de ellas, **${study.withHistorySignals}** tienen historial suficiente. Volumen conserva **${study.retainedSignals} (${share(study.retainedSignals)})**, descarta por umbral **${study.discardedSignals} (${share(study.discardedSignals)})** y deja **${study.insufficientSignals} (${share(study.insufficientSignals)}) sin historial suficiente**.`, '',
    'Filtro único: volumen de la vela de señal ≥ 1,5 × promedio de las velas del **mismo intervalo local de Nueva York** en las **20 sesiones observadas inmediatamente anteriores**. Cada una de esas 20 sesiones debe contener ese intervalo; si falta una, la señal queda sin historial suficiente. No se buscan sesiones más antiguas para reemplazar datos ausentes, no se rellena ninguna vela y la sesión actual queda fuera del promedio. El volumen de la vela de señal se conoce solo a su cierre.', '',
    'Las señales originales de Bollinger y su descanso permanecen intactos. La comparación principal enfrenta las señales Bollinger **con historial suficiente** (conservadas + descartadas por umbral) con su subconjunto conservado. También se mantiene la comparación con **todas** las señales Bollinger originales para mostrar el efecto conjunto de cobertura y filtro. Todos los grupos usan el mismo corte cronológico 70/30 y la misma referencia de velas sin señal Bollinger, emparejada por horario de Nueva York dentro de cada segmento. La entrada es la apertura **hipotética** de la siguiente vela contigua y la salida el cierre de la vela correspondiente a 15, 30 o 60 minutos desde la disponibilidad de la señal; los casos sin continuidad se excluyen de las métricas, pero siguen en el conteo de señales. La dirección bajista invierte el signo del movimiento de QQQ.', '',
    '**Todo el estudio es exploratorio.** Ya se examinaron los resultados del último 30% en fases anteriores; ese tramo no constituye una validación independiente de la hipótesis de volumen.', '',
  ];
  const groups = [
    ['Bollinger original', study.original], ['Bollinger con historial', study.withHistory],
    ['Con volumen', study.retained],
    ['Descartadas', study.discarded], ['Sin historial', study.insufficient],
  ] as const;
  for (const segment of ['exploracion', 'evaluacion'] as const) {
    lines.push(`## ${segment === 'exploracion' ? 'Primer 70% cronológico' : 'Último 30% cronológico, ya examinado'}`, '',
      '| Grupo | Señal | Min | Detectadas | Evaluables | Comparables | Favorable | Movimiento medio | Ganancia media | Pérdida media | Magnitud media | Favorable referencia | Diferencia vs referencia | IC 99,17% | Muestra pequeña |',
      '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|');
    for (const [label, group] of groups) {
      for (const row of group.rows.filter(r => r.segment === segment)) {
        const stats = row.matchedSignals;
        lines.push(`| ${label} | ${side(row.direction)} | ${row.horizonMinutes} | ${row.signals} | ${row.eligible.count} | ${stats.count} | ${pct(stats.favorableRate)} | ${move(stats.meanSignedPercent)} | ${move(stats.meanGainPercent)} | ${move(stats.meanLossPercent)} | ${move(stats.meanAbsolutePercent)} | ${pct(row.matchedBaseline.favorableRate)} | ${move(row.meanDifferencePercent)} | ${interval(row.differenceInterval99Percent)} | ${row.smallSample ? 'Sí' : 'No'} |`);
      }
    }
    lines.push('', '### Cambio del grupo con volumen frente a Bollinger original', '',
      '| Señal | Min | Original evaluables | Con volumen evaluables | Cambio favorable | Cambio movimiento medio | IC 99,17% del cambio | Muestra pequeña |',
      '|---|---:|---:|---:|---:|---:|---|---|');
    for (const comparison of study.comparisons.filter(c => c.segment === segment)) {
      lines.push(`| ${side(comparison.direction)} | ${comparison.horizonMinutes} | ${comparison.originalEligible} | ${comparison.retainedEligible} | ${pp(comparison.retainedMinusOriginalFavorableRate)} | ${move(comparison.retainedMinusOriginalMeanPercent)} | ${comparison.identicalSamples ? 'No aplica: muestras idénticas' : interval(comparison.interval99Percent)} | ${comparison.smallSample ? 'Sí' : 'No'} |`);
    }
    lines.push('', '### Cambio del grupo con volumen frente a Bollinger con historial suficiente', '',
      '| Señal | Min | Con historial evaluables | Con volumen evaluables | Cambio favorable | Cambio movimiento medio | IC 99,17% del cambio | Muestra pequeña |',
      '|---|---:|---:|---:|---:|---:|---|---|');
    for (const comparison of study.comparisonsWithHistory.filter(c => c.segment === segment)) {
      lines.push(`| ${side(comparison.direction)} | ${comparison.horizonMinutes} | ${comparison.historyEligible} | ${comparison.retainedEligible} | ${pp(comparison.retainedMinusHistoryFavorableRate)} | ${move(comparison.retainedMinusHistoryMeanPercent)} | ${comparison.identicalSamples ? 'No aplica: muestras idénticas' : interval(comparison.interval99Percent)} | ${comparison.smallSample ? 'Sí' : 'No'} |`);
    }
    lines.push('');
  }
  if (study.retainedSignals === study.originalSignals && study.originalSignals > 0) {
    lines.push('**Conclusión descriptiva:** el filtro conservó todas las señales; sus movimientos son idénticos a los de Bollinger original en este historial.');
  } else {
    const later = study.comparisonsWithHistory.filter(c => c.segment === 'evaluacion' &&
      c.retainedMinusHistoryMeanPercent !== null);
    const higher = later.filter(c => c.retainedMinusHistoryMeanPercent! > 0).length;
    lines.push(`**Conclusión descriptiva:** en el último tramo examinado, el movimiento medio del grupo filtrado fue mayor que el de Bollinger con historial suficiente en ${higher} de ${later.length} combinaciones de dirección y horizonte evaluables. La tabla muestra el tamaño y signo de cada cambio. Esto no demuestra una mejora futura: las muestras retenidas son pequeñas y el tramo ya se utilizó para investigar otras hipótesis.`);
  }
  lines.push('', 'Las tablas de grupos usan señales comparables con la referencia; las dos tablas de cambio usan todas las señales con movimiento evaluable. En la comparación con Bollinger original, las señales sin historial de volumen siguen en la base y pueden afectar el cambio, especialmente al inicio del CSV. En la comparación con Bollinger con historial suficiente, base y subconjunto tienen la misma cobertura del filtro. Los intervalos frente a referencia son los de Fase 4. Para cada cambio se remuestrean conjuntamente días de Nueva York y su subconjunto retenido (2.000 repeticiones, 99,17% por comparación dentro de cada conjunto de seis; los dos conjuntos no tienen corrección conjunta). No se calcula intervalo con menos de 30 señales retenidas o 10 días distintos. La reutilización de datos, señales cercanas entre sí, controles reutilizados y la búsqueda secuencial de hipótesis limitan esos intervalos. Las sesiones anteriores son las fechas observadas en el CSV: el POC no certifica días completos ausentes. Un cierre anticipado puede dejar sin referencia los horarios que no aparezcan en las 20 sesiones previas.', '',
    'Los porcentajes son movimientos históricos de QQQ, no rentabilidad de CALL o PUT ni probabilidades garantizadas. No se modelan spread, deslizamiento, comisiones, liquidez o ejecución real. Harían falta datos posteriores nuevos para evaluar esta hipótesis de forma independiente.', '');
  return lines.join('\n');
}
