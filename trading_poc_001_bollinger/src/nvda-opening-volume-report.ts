import type {OpeningSegment} from './nvda-opening-study.ts';
import type {OpeningVolumeStudy, RvolBand} from './nvda-opening-volume-study.ts';

const decimal = (value: number | null, places = 2): string => value === null ? 'N/D' :
  value.toFixed(places).replace('.', ',');
const percent = (value: number | null): string => value === null ? 'N/D' :
  `${decimal(value * 100, 1)}%`;
const interval = (value: [number, number] | null): string => value === null ? 'N/D' :
  `${percent(value[0])}–${percent(value[1])}`;
const count = (value: number | null): string => value === null ? 'N/D' :
  Math.round(value).toLocaleString('es-ES');
const bandLabel: Record<RvolBand, string> = {
  todas: 'Todas, con o sin RVOL', bajo: 'Tercil bajo', medio: 'Tercil medio', alto: 'Tercil alto',
};
const segmentLabel: Record<OpeningSegment, string> = {
  total: 'Historial completo', exploracion: 'Primer 70% cronológico',
  evaluacion: 'Último 30% cronológico',
};

export function renderNvdaOpeningVolumeReport(study: OpeningVolumeStudy, source: string): string {
  const {lower, upper, sample} = study.exploratoryRvolCutpoints;
  const lines = [
    '# NVDA: volumen de la primera vela y regreso a Bollinger en 15 minutos', '',
    `Fuente local: \`${source}\`; ${count(study.candles)} velas reales de NVDA de 15 minutos. ${study.calendarSessions} sesiones de calendario, ${study.evaluatedOpeningDays} aperturas evaluadas. Corte 70/30 desde ${study.splitDate}.`, '',
    '## Tiempo e interpretación', '',
    'La condición de apertura fuera de las bandas congeladas se conoce a las **09:30 de Nueva York**. El volumen absoluto de la vela 09:30–09:45 y su máximo, mínimo y cierre completos solo se conocen **al terminar esa vela, a las 09:45**. Por ello, la relación entre RVOL y regreso en esos primeros 15 minutos es **retrospectiva**: este estudio no propone ni valida una condición de entrada a las 09:30 basada en el volumen final. No se infieren operaciones ni rentabilidad de opciones.', '',
    'El promedio de referencia usa el volumen de la vela de 09:30–09:45 en las **20 sesiones observadas inmediatamente anteriores**, en horario local `America/New_York`, sin incluir la sesión actual. Si una de esas 20 sesiones no tiene esa vela, no se reemplaza con una más antigua: RVOL queda sin dato. RVOL = volumen de la primera vela / promedio histórico; si el promedio es cero, RVOL queda sin dato. No se fabrican velas ni sesiones ausentes.', '',
    'La clasificación «encima», «debajo» o «dentro» y el regreso por rango/cierre proceden del estudio NVDA de Fase 7, sin modificarlo. Rango: `low < upper && high > lower`; cierre: `lower < close && close < upper`, con bandas previas a las 09:30 congeladas. Las tasas de regreso usan solo aperturas fuera de banda con primera vela evaluable.', '',
    'Para describir cómo varían las frecuencias se muestran **terciles retrospectivos de RVOL**, definidos solo con la distribución de RVOL de aperturas con historial en el primer 70%; se aplican las mismas fronteras al último 30%. No se usaron los resultados de regreso para fijarlas. **No son umbrales mínimos de volumen ni reglas de trading.**',
    `Muestra para fronteras: ${sample} días; tercil bajo < ${decimal(lower, 3)}, medio desde ${decimal(lower, 3)} hasta < ${decimal(upper, 3)}, alto ≥ ${decimal(upper, 3)}.${lower === null || upper === null ? ' No hay suficientes días para formar terciles.' : lower === upper ? ' Las fronteras coinciden; algunos terciles pueden quedar vacíos.' : ''}`, '',
  ];
  for (const segment of ['total', 'exploracion', 'evaluacion'] as const) {
    const days = study.days.filter(day => segment === 'total' || day.segment === segment);
    lines.push(`## ${segmentLabel[segment]}`, '',
      `Aperturas evaluadas: **${days.length}**; RVOL disponible: **${days.filter(day => day.rvol !== null).length}**; menos de 20 sesiones previas: ${days.filter(day => day.volumeAvailability === 'menos_de_20_sesiones').length}; falta de vela 09:30 previa: ${days.filter(day => day.volumeAvailability === 'falta_apertura_previa').length}; promedio previo cero: ${days.filter(day => day.volumeAvailability === 'promedio_cero').length}.`, '',
      '| RVOL descriptivo | Días | Encima | Debajo | Fuera total | % fuera (IC Wilson 95%) | Volumen primera vela medio | Promedio histórico medio | RVOL medio | Muestra pequeña |',
      '|---|---:|---:|---:|---:|---|---:|---:|---:|---|');
    for (const row of study.openingRows.filter(item => item.segment === segment)) {
      lines.push(`| ${bandLabel[row.band]} | ${row.openingDays} | ${row.outsideAbove} | ${row.outsideBelow} | ${row.outsideTotal} | ${percent(row.outsideRate)} (${interval(row.outsideWilson95)}) | ${count(row.meanOpeningVolume)} | ${count(row.meanHistoricalAverage)} | ${decimal(row.meanRvol)} | ${row.smallSample ? 'Sí' : 'No'} |`);
    }
    lines.push('',
      '| RVOL descriptivo | Apertura | Casos | Evaluables 15 min | Regreso por rango | % rango (IC Wilson 95%) | Confirmación por cierre | % cierre (IC Wilson 95%) | Muestra pequeña |',
      '|---|---|---:|---:|---:|---|---:|---|---|');
    for (const row of study.returnRows.filter(item => item.segment === segment)) {
      lines.push(`| ${bandLabel[row.band]} | ${row.direction} | ${row.openings} | ${row.evaluable} | ${row.rangeReturns} | ${percent(row.rangeRate)} (${interval(row.rangeWilson95)}) | ${row.closeReturns} | ${percent(row.closeRate)} (${interval(row.closeWilson95)}) | ${row.smallSample ? 'Sí' : 'No'} |`);
    }
    lines.push('');
  }
  const opening = (segment: OpeningSegment, band: RvolBand) => study.openingRows.find(row =>
    row.segment === segment && row.band === band)!;
  const returns = (segment: OpeningSegment, band: RvolBand, direction: 'encima' | 'debajo') =>
    study.returnRows.find(row => row.segment === segment && row.band === band &&
      row.direction === direction)!;
  const low = opening('total', 'bajo');
  const high = opening('total', 'alto');
  const evalLow = opening('evaluacion', 'bajo');
  const evalHigh = opening('evaluacion', 'alto');
  lines.push('## Lectura descriptiva', '',
    `En el historial completo, abrieron fuera de banda ${low.outsideTotal}/${low.openingDays} días del tercil bajo (${percent(low.outsideRate)}) y ${high.outsideTotal}/${high.openingDays} del alto (${percent(high.outsideRate)}). Entre las aperturas por encima, el regreso por rango en 15 minutos ocurrió en ${returns('total', 'bajo', 'encima').rangeReturns}/${returns('total', 'bajo', 'encima').evaluable} del tercil bajo y ${returns('total', 'alto', 'encima').rangeReturns}/${returns('total', 'alto', 'encima').evaluable} del alto; por debajo, en ${returns('total', 'bajo', 'debajo').rangeReturns}/${returns('total', 'bajo', 'debajo').evaluable} y ${returns('total', 'alto', 'debajo').rangeReturns}/${returns('total', 'alto', 'debajo').evaluable}, respectivamente.`, '',
    `En el último 30%, los terciles bajo y alto tuvieron ${evalLow.outsideTotal}/${evalLow.openingDays} y ${evalHigh.outsideTotal}/${evalHigh.openingDays} aperturas fuera de banda. Los subgrupos de regreso de ese tramo son pequeños; las tablas muestran sus conteos y no permiten afirmar una ventaja estadística ni una regla disponible a las 09:30.`, '');
  lines.push('## Aperturas fuera de banda: datos auditables', '',
    'Las marcas de tiempo son UTC. El volumen, RVOL y resultado de la primera vela se conocen a `volumeAvailableAt`, no a `openingTimestamp`.', '',
    '| Fecha NY | Dirección | Inicio vela UTC | Disponible UTC | Volumen 09:30 | Promedio 20 sesiones | RVOL | Tercil | Rango 15 min | Cierre 15 min |',
    '|---|---|---|---|---:|---:|---:|---|---|---|');
  for (const day of study.days.filter(item => item.direction !== 'dentro')) {
    const result = (value: boolean | null) => value === null ? 'N/D' : value ? 'Sí' : 'No';
    lines.push(`| ${day.date} | ${day.direction} | ${day.openingTimestamp} | ${day.volumeAvailableAt} | ${count(day.openingVolume)} | ${count(day.historicalAverage)} | ${decimal(day.rvol)} | ${day.rvolBand ?? 'N/D'} | ${result(day.rangeReturned15)} | ${result(day.closeConfirmed15)} |`);
  }
  lines.push('',
    '## Limitaciones', '',
    'Los terciles y las comparaciones se investigaron después de observar este historial; el último 30% tampoco es una validación independiente de la hipótesis de volumen. Los grupos pueden tener tamaños pequeños y diferencias de volatilidad, fecha u otras condiciones; asociación no implica causalidad ni mejora operable. Los intervalos Wilson 95% son orientativos, sin ajuste por múltiples grupos y con posible dependencia entre sesiones. Los porcentajes históricos no garantizan resultados futuros. Una sesión completamente ausente del CSV no puede detectarse solo con las sesiones observadas.', '');
  return lines.join('\n');
}
