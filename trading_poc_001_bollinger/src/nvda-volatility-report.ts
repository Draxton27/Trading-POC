import {FAMILIES, type Summary, type VolatilityStudy} from './nvda-volatility-study.ts';

const names: Record<string, string> = {
  pullback_bullish: 'Retroceso alcista (F11)', pullback_bearish: 'Retroceso bajista (F11)',
  breakout_bullish: 'Ruptura alcista (F11)', breakout_bearish: 'Ruptura bajista (F11)',
  failed_high_bearish: 'Falla de máximo, bajista (F12)',
  failed_low_bullish: 'Falla de mínimo, alcista (F12)',
};
const f = (value: number | null, digits = 3): string => value === null ? 'N/D' : value.toFixed(digits);
const percent = (value: number | null): string => value === null ? 'N/D' : (100 * value).toFixed(1) + '%';
const ci = (value: [number, number] | null): string => value === null ? 'N/D' :
  `[${f(value[0])}, ${f(value[1])}]`;
const cost = (row: Summary, bps: number): number | null =>
  row.costs.find(item => item.bps === bps)?.netMeanPercent ?? null;
const table = (header: string[], rows: string[][]): string[] => [
  '| ' + header.join(' | ') + ' |',
  '|' + header.map(() => '---').join('|') + '|',
  ...rows.map(row => '| ' + row.join(' | ') + ' |'),
];
const rowMain = (row: Summary): string[] => [names[row.family]!, row.regime, String(row.signals),
  String(row.eligible), String(row.distinctSessions), row.smallSample ? 'sí' : 'no',
  percent(row.positiveRate), f(row.meanSignedPercent), ci(row.meanInterval95Percent),
  f(row.meanMfePercent), f(row.meanMaePercent), f(row.sdSignedPercent),
  f(cost(row, 5)), f(cost(row, 10)), f(cost(row, 20)),
  percent(row.originalControl.coverage), f(row.originalControl.differenceMeanPercent),
  percent(row.generalControl?.coverage ?? null),
  f(row.generalControl?.differenceMeanPercent ?? null)];

export function renderNvdaVolatilityReport(study: VolatilityStudy, source: string,
  sourceSha256: string, codeVersion: string, priorHashes: Record<string, string>): string {
  const regimes = study.regimeRows.filter(row => row.regime !== 'insufficient');
  const baselines = study.baselineRegimeRows.filter(row => row.scope !== 'insufficient');
  const maxMfe = regimes.filter(row => row.eligible > 0)
    .sort((a, b) => (b.meanMfePercent ?? -Infinity) - (a.meanMfePercent ?? -Infinity))[0];
  const lines = [
    '# Fase 13: volatilidad y calidad de oportunidades de NVDA', '',
    '**Estudio diagnóstico, retrospectivo y exploratorio.** Todo 2021–2026 estaba disponible antes de este análisis; los años y el corte 70/30 no validan de forma independiente. No se generan operaciones ni opciones.', '',
    `Fuente local: \`${source}\`; SHA-256 CSV: \`${sourceSha256}\`.`,
    `Commit de código usado: \`${codeVersion}\`. Protocolo fijado previamente: \`docs/phase13-research-protocol.md\`.`,
    `JSON anteriores verificados: F11 \`${priorHashes.phase11}\`; F12 \`${priorHashes.phase12}\`.`,
    `Velas: ${study.sourceCandles}; ${study.firstTimestamp} a ${study.lastTimestamp}. Eventos sin redefinir: F11 ${study.originalCounts.phase11}, F12 ${study.originalCounts.phase12}.`,
    `Calendario: ${study.calendarAudit.observedSessions}/${study.calendarAudit.calendarSessions} sesiones observadas; ${study.calendarAudit.missingSessions.length} ausentes y ${study.calendarAudit.partialSessions.length} parciales. ATR14 válido en ${study.atrCoverage.validAtr14} sesiones; regímenes baja/media/alta/insuficiente: ${study.atrCoverage.regimes.low}/${study.atrCoverage.regimes.medium}/${study.atrCoverage.regimes.high}/${study.atrCoverage.regimes.insufficient}.`, '',
    '## Resultados observados: horizonte principal de 30 minutos', '',
    ...table(['Familia', 'ATR previo', 'Señales', 'Evaluables', 'Sesiones', 'Muestra pequeña',
      'Final >0', 'Media %', 'IC 95% %', 'MFE %', 'MAE %', 'DE %',
      'Neto 5pb %', 'Neto 10pb %', 'Neto 20pb %', 'Control original', 'Dif. original %',
      'Control general', 'Dif. general %'], regimes.map(rowMain)), '',
    'MFE es máximo favorable y MAE máximo adverso dentro de la ventana, en porcentaje de entrada; no se conoce el orden de extremos en una vela ni son ganancias ejecutables. Los costos son escenarios completos sobre acciones. La media firmada, no MFE, es el resultado principal. Los intervalos remuestrean sesiones completas y faltan cuando la muestra es pequeña.', '',
    '### Régimen insuficiente y controles', '',
    ...table(['Familia', 'Sin régimen', 'Evaluables', 'Sin control original', 'Sin control general',
      'MFE / ATR', 'MAE / ATR', 'MFE / rango20', 'MAE / rango20'],
    FAMILIES.map(family => {
      const row = study.regimeRows.find(item => item.family === family && item.regime === 'insufficient')!;
      const total = study.familyRows.find(item => item.family === family)!;
      return [names[family]!, String(row.signals), String(row.eligible),
        String(total.eligible - total.originalControl.matched),
        String(total.eligible - (total.generalControl?.matched ?? 0)),
        f(total.meanMfeAtrUnits), f(total.meanMaeAtrUnits),
        f(total.meanMfeRange20Units), f(total.meanMaeRange20Units)];
    })), '',
    'Los controles originales mantienen sus reglas y cobertura de Fases 11 y 12. La referencia adicional usa ventanas de otras sesiones del mismo año, régimen, sentido y bloque horario; cada diferencia se calcula solo donde existe emparejamiento. Ninguna agrupación demuestra causalidad. Las excursiones normalizadas usan ATR14 previo en dólares o rango medio previo de 20 velas, por separado.', '',
    '### Costos y distribuciones', '',
    ...table(['Familia', 'ATR previo', '0pb neto %', '5pb neto %', '10pb neto %', '20pb neto %',
      'P10/P50/P90 MFE %', 'P10/P50/P90 MAE %'], regimes.map(row => [
      names[row.family]!, row.regime, ...[0, 5, 10, 20].map(bps => f(cost(row, bps))),
      [row.mfeQuantilesPercent.p10, row.mfeQuantilesPercent.p50,
        row.mfeQuantilesPercent.p90].map(value => f(value)).join(' / '),
      [row.maeQuantilesPercent.p10, row.maeQuantilesPercent.p50,
        row.maeQuantilesPercent.p90].map(value => f(value)).join(' / ')])), '',
    '### Ventanas generales: amplitud habitual en ambos sentidos, sin seleccionar futuro', '',
    ...table(['ATR previo', 'Sentido', 'Ventanas', 'Evaluables', 'Sesiones', 'Final >0',
      'Media %', 'MFE %', 'MAE %', 'Neto 10pb %', 'Cierre excluido'], baselines.map(row => [
      row.scope, row.direction, String(row.windows), String(row.eligible),
      String(row.distinctSessions), percent(row.positiveRate), f(row.meanSignedPercent),
      f(row.meanMfePercent), f(row.meanMaePercent),
      f(row.costs.find(item => item.bps === 10)?.netMeanPercent ?? null),
      String(row.excluded.session_close)])), '',
    'Cada vela entra una sola vez como ventana y se calcula cada sentido por separado. No se suman ambos como si se pudiera escoger el ganador tras observarlo.', '',
    '### Años y cortes cronológicos; ningún segmento es prospectivo', '',
    ...table(['Período', 'Familia', 'Evaluables', 'Sesiones', 'Media %', 'IC 95% %',
      'Dif. control general %'], [...study.yearRows, ...study.periodRows].map(row => [
      row.scope, names[row.family]!, String(row.eligible), String(row.distinctSessions),
      f(row.meanSignedPercent), ci(row.meanInterval95Percent),
      f(row.generalControl?.differenceMeanPercent ?? null)])), '',
    'La composición por año y régimen, incluidos recuentos con control, está en el JSON `yearRegimeRows`. Los años con menos de 30 eventos no sostienen una lectura de estabilidad.', '',
    '### Horario de toda la sesión regular', '',
    ...table(['Bloque NY', 'Sentido', 'Señales', 'Evaluables', 'Excluidas al cierre',
      'Media %', 'MFE %', 'MAE %', 'Ventanas generales', 'MFE general %', 'MAE general %'],
    study.hourlyEventRows.map(row => {
      const baseline = study.baselineHourRows.find(item => item.scope === String(row.hourBlock) &&
        item.direction === row.direction)!;
      const hour = 9 + Math.floor((30 + 60 * row.hourBlock) / 60);
      const minute = (30 + 60 * row.hourBlock) % 60;
      return [`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
        row.direction, String(row.signals), String(row.eligible), String(row.sessionCloseExcluded),
        f(row.meanSignedPercent), f(row.meanMfePercent), f(row.meanMaePercent),
        String(baseline.windows), f(baseline.meanMfePercent), f(baseline.meanMaePercent)];
    })), '',
    'El bloque 15:30 es abreviado; las exclusiones de cierre aumentan al final del día. El desglose horario no se cruza con los regímenes para decidir.', '',
    '### Horizontes secundarios y exclusiones', '',
    ...table(['Familia', 'Minutos', 'Evaluables', 'Cierre', 'Falta siguiente', 'Hueco',
      'Media %', 'MFE %', 'MAE %'], study.horizonRows.map(row => [
      names[row.family]!, String(row.horizonMinutes), String(row.eligible),
      String(row.excluded.session_close), String(row.excluded.missing_next),
      String(row.excluded.missing_intermediate), f(row.meanSignedPercent),
      f(row.meanMfePercent), f(row.meanMaePercent)])), '',
    'Los horizontes de 15 y 60 minutos no sustituyen el resultado principal predefinido de 30 minutos.', '',
    '## Interpretación y decisión de viabilidad', '',
    `Entre las celdas familiares, la mayor MFE media observada corresponde a ${maxMfe ?
      `${names[maxMfe.family]}, régimen ${maxMfe.regime}, ${f(maxMfe.meanMfePercent)}% ` +
      `(${maxMfe.eligible} resultados; MAE media ${f(maxMfe.meanMaePercent)}%)` : 'ninguna celda evaluable'}. ` +
      'La tabla principal y la línea base permiten comprobar si la mayor excursión favorable también vino con mayor excursión adversa; la comparación de MFE no equivale a rentabilidad.',
    `La cobertura de 30 minutos fue ${percent(study.decision.thirtyMinuteCoverage)}; ` +
      (study.decision.thirtyMinuteMeasurable ? 'alcanza el umbral diagnóstico del 70%.' :
        'no alcanza el umbral diagnóstico del 70%; habría que replantear el horizonte en otro protocolo.'),
    `Auditoría predefinida de suficiencia y estabilidad: ${study.decision.candidateCells} celdas candidatas de 18; ` +
      `${study.decision.qualifiedFamilies} familias tienen al menos dos regímenes con 30 resultados y 10 sesiones. ` +
      `Decisión: **${study.decision.label}**.`,
    ...(study.decision.candidateCells ? [
      'Cualquier patrón candidato solo permitiría formular una hipótesis fija para datos nuevos; no es una estrategia rentable ni una validación prospectiva.'] : [
      'No apareció evidencia bajo el criterio fijo para convertir estas agrupaciones en una regla de entrada. Recomendamos dejar de probar variantes similares de señales de 15 minutos sobre este mismo historial y considerar otro horizonte o información nueva.']),
    'Los signos, coberturas y umbrales individuales de las 18 celdas están en `candidateAudit` del JSON. Las diferencias originales frente a control se informan por cobertura; Fase 11 y Fase 12 ya habían encontrado límites estadísticos y aquí no se reescriben sus conclusiones.', '',
    'Este diagnóstico tiene sesgo de selección por investigación previa sobre el mismo período, múltiples comparaciones descriptivas, variación por año, controles imperfectos y posibles noticias/liquidez no modeladas. Ni una pequeña media positiva tras revisar celdas ni una MFE grande prueban ventaja. Las trayectorias y exclusiones individuales se conservan en los CSV adjuntos.', '',
  ];
  return lines.join('\n');
}
