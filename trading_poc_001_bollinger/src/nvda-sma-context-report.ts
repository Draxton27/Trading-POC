import type {ConditionDefinition, NvdaSmaContextStudy, SmaAnalysisRow} from './nvda-sma-context-study.ts';

const fmt=(value:number|null,digits=3)=>value===null?'—':value.toFixed(digits);
const rate=(value:number|null)=>value===null?'—':`${(value*100).toFixed(1)}%`;
const direction=(value:string)=>value==='CALL_CONTEXT'?'Alcista':'Bajista';
const sample=(row:SmaAnalysisRow)=>`${row.eligible.count}; ${rate(row.eligible.favorableRate)}; ${fmt(row.eligible.meanSignedPercent)}%; ${row.eligible.meanGainPercent===null?'—':`+${fmt(row.eligible.meanGainPercent)}%`}; ${row.eligible.meanLossPercent===null?'—':`${fmt(row.eligible.meanLossPercent)}%`}`;

function coverageTable(study:NvdaSmaContextStudy):string{
  return '| Temporalidad | SMA | Velas completas | Velas con SMA | Primera disponibilidad | Señales con SMA | Primer 70% | Último 30% |\n'+
    '|---|---:|---:|---:|---|---:|---:|---:|\n'+study.coverage.map(row=>
      `| ${row.timeframe==='hour'?'1 hora':'1 día'} | ${row.period} | ${row.completeBars} | ${row.barsWithSma} | ${row.firstSmaAvailableAt??'—'} | ${row.signalsAvailable} | ${row.explorationSignalsAvailable} | ${row.evaluationSignalsAvailable} |`).join('\n')+'\n';
}

function find(rows:readonly SmaAnalysisRow[],conditionId:string,directionValue:string,horizon:number):SmaAnalysisRow|undefined{
  return rows.find(row=>row.conditionId===conditionId&&row.direction===directionValue&&row.horizonMinutes===horizon);
}

function individualTable(study:NvdaSmaContextStudy,segment:SmaAnalysisRow['segment']):string{
  const rows=study.rows.filter(row=>row.segment===segment);
  const lines:string[]=[];
  for(const timeframe of ['hour','day'] as const)for(const period of [20,40,100,200] as const)
    for(const directionValue of ['CALL_CONTEXT','PUT_CONTEXT'] as const)for(const horizon of [15,30,60]){
      const prefix=`${timeframe}_sma${period}`;
      const ids=['position_aligned','position_contradictory','slope_aligned','slope_contradictory'].map(suffix=>`${prefix}_${suffix}`);
      const selected=ids.map(id=>find(rows,id,directionValue,horizon));
      lines.push(`| ${timeframe==='hour'?'1h':'1d'} | ${period} | ${direction(directionValue)} | ${horizon}m | ${selected.map(row=>row?sample(row):'—').join(' | ')} |`);
    }
  return '| TF | SMA | Dirección | Horizonte | Precio alineado n; fav.; media; fav. media; desfav. media | Precio contrario | Pendiente alineada | Pendiente contraria |\n'+
    '|---|---:|---|---:|---|---|---|---|\n'+lines.join('\n')+'\n';
}

function rareTable(study:NvdaSmaContextStudy,segment:SmaAnalysisRow['segment']):string{
  const rows=study.rows.filter(row=>row.segment===segment&&row.horizonMinutes===15);
  const lines:string[]=[];
  for(const timeframe of ['hour','day'] as const)for(const period of [20,40,100,200] as const){
    const equal=rows.filter(row=>row.conditionId===`${timeframe}_sma${period}_position_equal`).reduce((sum,row)=>sum+row.selectedSignals,0);
    const flat=rows.filter(row=>row.conditionId===`${timeframe}_sma${period}_slope_flat`).reduce((sum,row)=>sum+row.selectedSignals,0);
    lines.push(`| ${timeframe==='hour'?'1h':'1d'} | ${period} | ${equal} | ${flat} |`);
  }
  return '| TF | SMA | Precio exactamente igual | Pendiente plana |\n|---|---:|---:|---:|\n'+lines.join('\n')+'\n';
}

function jointTable(study:NvdaSmaContextStudy,segment:SmaAnalysisRow['segment']):string{
  const labels=new Map(study.conditions.filter(condition=>condition.kind!=='individual').map(condition=>[condition.id,condition.label]));
  const rows=study.rows.filter(row=>row.segment===segment&&labels.has(row.conditionId));
  return '| Condición | Dirección | Horizonte | Disponibles | Seleccionadas | Evaluables | Sesiones | Favorables | Media % | Fav. media % | Desfav. media % | Δ vs Bollinger comparable % | IC 95% Δ % | Muestra |\n'+
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|\n'+rows.map(row=>
      `| ${labels.get(row.conditionId)} | ${direction(row.direction)} | ${row.horizonMinutes}m | ${row.availableSignals} | ${row.selectedSignals} | ${row.eligible.count} | ${row.distinctSessions} | ${rate(row.eligible.favorableRate)} | ${fmt(row.eligible.meanSignedPercent)} | ${fmt(row.eligible.meanGainPercent)} | ${fmt(row.eligible.meanLossPercent)} | ${fmt(row.differenceMeanPercent)} | ${row.differenceInterval95Percent?`[${fmt(row.differenceInterval95Percent[0])}, ${fmt(row.differenceInterval95Percent[1])}]`:'—'} | ${row.smallSample?'Pequeña':'≥30 señales y ≥10 sesiones'} |`).join('\n')+'\n';
}

function uncertaintyTable(study:NvdaSmaContextStudy,segment:SmaAnalysisRow['segment']):string{
  const labels=new Map(study.conditions.map(condition=>[condition.id,condition.label]));
  const rows=study.rows.filter(row=>row.segment===segment&&row.differenceInterval95Percent!==null);
  if(!rows.length)return 'No hubo condiciones con muestra suficiente para calcular el intervalo por sesiones.\n';
  return '| Condición | Dirección | Horizonte | n | Δ media vs Bollinger comparable % | IC 95% por sesiones % | Δ vs control horario % | IC 95% vs control % |\n'+
    '|---|---|---:|---:|---:|---|---:|---|\n'+rows.map(row=>
      `| ${labels.get(row.conditionId)} | ${direction(row.direction)} | ${row.horizonMinutes}m | ${row.eligible.count} | ${fmt(row.differenceMeanPercent)} | [${fmt(row.differenceInterval95Percent![0])}, ${fmt(row.differenceInterval95Percent![1])}] | ${fmt(row.differenceVsControlPercent)} | ${row.differenceVsControlInterval95Percent?`[${fmt(row.differenceVsControlInterval95Percent[0])}, ${fmt(row.differenceVsControlInterval95Percent[1])}]`:'—'} |`).join('\n')+'\n';
}

function conditionNotes(conditions:readonly ConditionDefinition[]):string{
  return conditions.filter(condition=>condition.kind!=='individual').map(condition=>
    `- ${condition.id}: ${condition.label}.`).join('\n');
}

export function renderNvdaSmaContextReport(study:NvdaSmaContextStudy,source:string,provenance:string):string{
  const hour=study.aggregate.hour,day=study.aggregate.day;
  const intervalExcludesZero=(row:SmaAnalysisRow)=>row.differenceInterval95Percent!==null&&
    (row.differenceInterval95Percent[0]>0||row.differenceInterval95Percent[1]<0);
  const historicalFindings=study.rows.filter(row=>row.segment==='total'&&intervalExcludesZero(row));
  const explorationFindings=study.rows.filter(row=>row.segment==='exploracion'&&intervalExcludesZero(row));
  const evaluationFindings=study.rows.filter(row=>row.segment==='evaluacion'&&intervalExcludesZero(row));
  const labels=new Map(study.conditions.map(condition=>[condition.id,condition.label]));
  const sections=[
    '# Fase 10 — NVDA: contexto SMA multitemporal', '',
    `Fuente local: ${source}. Se preservaron ${study.sourceSignalCount} señales de Fase 9: ${study.sourceBullishSignals} alcistas y ${study.sourceBearishSignals} bajistas.`,
    `Calendario: ${provenance}. Corte cronológico por sesiones: ${study.splitDate??'—'}. El último 30% ya fue examinado y no es validación independiente.`, '',
    '## Construcción temporal', '',
    `Una hora: ${hour.total} intervalos programados, ${hour.complete} completos y ${hour.incomplete} incompletos. ${hour.scheduledAbbreviated} son finales abreviados por calendario y ${hour.completeScheduledAbbreviated} contienen todas sus velas esperadas.`,
    `Un día: ${day.total} sesiones agregadas, ${day.complete} completas y ${day.incomplete} incompletas. Las sesiones incompletas se conservan para auditoría, pero no entran en ninguna SMA diaria.`,
    'Los intervalos horarios se anclan a las 09:30 de Nueva York. La última vela normal 15:30–16:00 dura 30 minutos y sí entra en las SMA cuando contiene sus dos velas de 15 minutos. Los cierres anticipados usan el cierre programado del calendario. Esta convención no se presenta como equivalente a TC2000 sin contrastar su configuración.',
    'Cada señal usa la última vela superior completa cuyo cierre es anterior o igual al inicio de la vela de señal. El cierre parcial de la hora o del día de la señal queda excluido.', '',
    '## Cobertura', '', coverageTable(study), '',
    `Señales con las cuatro SMA horarias: ${study.signalsWithAllHourSmas}. Con las cuatro diarias: ${study.signalsWithAllDaySmas}. Con las ocho SMA: ${study.signalsWithAllSmas} (${study.explorationSignalsWithAllSmas} en exploración y ${study.evaluationSignalsWithAllSmas} en evaluación).`,
    'La SMA 200 diaria no está disponible para ninguna señal del primer 70%; con este archivo no existe una evaluación cronológica independiente de las condiciones que la requieren.', '',
    '## Resumen interpretativo', '',
    `En el historial completo, ${historicalFindings.length} comparaciones tuvieron un intervalo descriptivo que no cruzó cero; en el primer 70% hubo ${explorationFindings.length} y en el último 30% hubo ${evaluationFindings.length}.`,
    historicalFindings.length?`Las comparaciones del historial completo fueron: ${historicalFindings.map(row=>
      `${labels.get(row.conditionId)} / ${direction(row.direction)} / ${row.horizonMinutes}m`).join('; ')}.`:
      'Ninguna comparación del historial completo separó descriptivamente su media de Bollinger comparable.',
    'La ausencia de repetición con muestra suficiente en los tramos cronológicos, junto con el número de comparaciones, impide considerar estos casos evidencia defendible de mejora. Las SMA aportan variables de contexto y segmentación, pero este archivo no demuestra una ventaja estable.', '',
    '## Método estadístico', '',
    'Cada condición selecciona un subconjunto descriptivo de las señales Bollinger originales. Se compara con Bollinger restringido a señales que tenían disponible la misma información y el mismo horizonte. La entrada hipotética permanece en la apertura de la siguiente vela de 15 minutos y las salidas en los cierres de la primera, segunda y cuarta vela, sin cruzar sesiones.',
    'Los intervalos del 95% usan 2.000 remuestreos de sesiones completas y se omiten con menos de 30 resultados o 10 sesiones. El control horario usa observaciones sin señal del mismo intervalo local y segmento, pero no empareja régimen de SMA; se considera una referencia descriptiva limitada.',
    'Contexto alcista de una temporalidad significa que su último cierre está por encima de las cuatro SMA; bajista, por debajo. Coincidencia exige que 1h y 1d sean ambos alcistas o ambos bajistas. Contradicción exige sentidos opuestos. Los contextos mixtos no se fuerzan a una dirección.', '',
    'Condiciones conjuntas registradas:', '', conditionNotes(study.conditions), '',
  ];
  for(const [segment,title] of [['total','Historial completo'],['exploracion','Primer 70%'],['evaluacion','Último 30%']] as const){
    sections.push(`## ${title}: SMA individuales`,'',
      'Cada celda muestra: resultados evaluables; frecuencia favorable; movimiento medio firmado; movimiento favorable medio; movimiento desfavorable medio.', '',
      individualTable(study,segment),'', 'Igualdades y pendientes planas (suma de ambas direcciones):','',rareTable(study,segment),'',
      `## ${title}: condiciones conjuntas`,'',jointTable(study,segment),'',
      `## ${title}: intervalos disponibles`,'',uncertaintyTable(study,segment),'');
  }
  sections.push('## Limitaciones','',
    'Las señales dentro de una sesión y los horizontes solapados son dependientes. Se analizaron ocho medias, varias clasificaciones, dos direcciones, tres horizontes y tres segmentos sin corrección conjunta por comparaciones múltiples. Los intervalos son descriptivos y no prueban causalidad.',
    'La SMA 200 diaria aparece únicamente en el tramo ya examinado. Las condiciones combinadas tienen como máximo 35 señales antes de excluir horizontes; muchas quedan por debajo del mínimo para intervalos. Se requiere historial anterior adicional y después datos realmente nuevos para una evaluación defendible.',
    'Los movimientos corresponden al precio de NVDA. No modelan contratos de opciones, costes, liquidez, deslizamiento ni ejecución real. No se definieron reglas de entrada, rebote, retroceso o ruptura.', '');
  return sections.join('\n');
}
