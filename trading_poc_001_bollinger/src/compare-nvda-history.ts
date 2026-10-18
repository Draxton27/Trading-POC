import {mkdirSync, writeFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {loadMarketCalendar} from './alpaca-calendar.ts';
import {loadDataset} from './csv.ts';
import {studyNvdaSmaContext} from './nvda-sma-context-study.ts';

const path = process.argv[2];
if (!path) throw new Error('Uso: npm run compare:nvda-history -- data/NVDA_ALPACA_SIP_15min_YYYYMMDD_YYYYMMDD.csv');
const baselinePath = 'data/NVDA_ALPACA_SIP_15min_12m.csv';
const baselineData = loadDataset(baselinePath);
const historyData = loadDataset(path);
for (const metadata of [baselineData.metadata, historyData.metadata]) {
  if (metadata.data_class !== 'real' || metadata.asset !== 'NVDA' || metadata.bar_minutes !== 15 ||
      metadata.feed !== 'sip' || metadata.adjustment !== 'split' || metadata.session !== 'regular') {
    throw new Error('La comparación requiere dos archivos NVDA reales de 15m, Alpaca SIP, split y sesión regular.');
  }
}
const baseline = studyNvdaSmaContext(baselineData.candles, loadMarketCalendar(`${baselinePath}.calendar.json`));
const history = studyNvdaSmaContext(historyData.candles, loadMarketCalendar(`${path}.calendar.json`));
const baselineFirst = baselineData.candles[0]!.timestamp.slice(0,10);
const baselineLast = baselineData.candles.at(-1)!.timestamp.slice(0,10);
const extendedByTimestamp = new Map(historyData.candles.map(bar => [bar.timestamp,bar]));
let matchedBars = 0, changedBars = 0, absentBars = 0;
for (const bar of baselineData.candles) {
  const updated = extendedByTimestamp.get(bar.timestamp);
  if (!updated) { absentBars++; continue; }
  matchedBars++;
  if (bar.open !== updated.open || bar.high !== updated.high || bar.low !== updated.low ||
      bar.close !== updated.close || bar.volume !== updated.volume) changedBars++;
}
const earlierSignals = history.signals.filter(item => item.dateNy < baselineFirst).length;
const laterSignals = history.signals.filter(item => item.dateNy > baselineLast).length;
const overlapSignals = history.signals.length - earlierSignals - laterSignals;
const comparisons = history.rows.filter(row => row.conditionId === 'day_sma200_position_aligned');
const output = join('output','real');
mkdirSync(output,{recursive:true});
const stem = `nvda-history-comparison-${basename(path).replace(/\.csv$/,'')}`;
const payload = {source:basename(path),baselineSource:basename(baselinePath),
  baselineWindow:{first:baselineFirst,last:baselineLast},
  overlap:{earlierSignals,overlapSignals,laterSignals,matchedBars,changedBars,absentBars},
  baseline:{signals:baseline.sourceSignalCount,coverage:baseline.coverage,splitDate:baseline.splitDate},
  history:{signals:history.sourceSignalCount,coverage:history.coverage,splitDate:history.splitDate,
    aggregate:history.aggregate,signalsWithAllSmas:history.signalsWithAllSmas,
    explorationSignalsWithAllSmas:history.explorationSignalsWithAllSmas,
    evaluationSignalsWithAllSmas:history.evaluationSignalsWithAllSmas},
  daily200AlignedComparisons:comparisons};
const coverageRows = history.coverage.map(item => {
  const prior = baseline.coverage.find(other => other.timeframe === item.timeframe && other.period === item.period)!;
  return `| ${item.timeframe==='hour'?'1h':'1d'} | ${item.period} | ${prior.signalsAvailable} | ${item.signalsAvailable} | ${item.explorationSignalsAvailable} | ${item.evaluationSignalsAvailable} |`;
});
const fmt = (value:number|null) => value === null ? '—' : value.toFixed(3);
const comparisonRows = comparisons.map(row => `| ${row.segment} | ${row.direction==='CALL_CONTEXT'?'Alcista':'Bajista'} | ${row.horizonMinutes}m | ${row.availableSignals} | ${row.selectedSignals} | ${row.eligible.count} | ${row.distinctSessions} | ${row.eligible.favorableRate===null?'—':(row.eligible.favorableRate*100).toFixed(1)+'%'} | ${fmt(row.eligible.meanSignedPercent)} | ${fmt(row.differenceMeanPercent)} | ${row.differenceInterval95Percent?`[${fmt(row.differenceInterval95Percent[0])}, ${fmt(row.differenceInterval95Percent[1])}]`:'—'} |`);
const markdown = [
  '# Comparación histórica NVDA: cobertura SMA y señales Bollinger', '',
  `Archivo ampliado: ${basename(path)}. Referencia ya examinada: ${basename(baselinePath)} (${baselineFirst} a ${baselineLast}).`,
  `Señales: referencia ${baseline.sourceSignalCount}; historial ampliado ${history.sourceSignalCount}. En el archivo ampliado, ${earlierSignals} preceden la ventana conocida, ${overlapSignals} caen dentro y ${laterSignals} son posteriores.`,
  `Solapamiento de velas: ${matchedBars} timestamps coincidentes, ${changedBars} con alguna diferencia OHLCV y ${absentBars} ausentes en el historial ampliado. Si existen diferencias, una variación en señales o SMA puede provenir de revisiones del proveedor o del historial inicial disponible.`,
  `Corte por sesiones del historial ampliado: ${history.splitDate??'—'}. La SMA 200 diaria está disponible en ${history.coverage.find(item=>item.timeframe==='day'&&item.period===200)!.signalsAvailable} señales, ${history.coverage.find(item=>item.timeframe==='day'&&item.period===200)!.explorationSignalsAvailable} en exploración y ${history.coverage.find(item=>item.timeframe==='day'&&item.period===200)!.evaluationSignalsAvailable} en evaluación.`, '',
  '## Cobertura por SMA', '',
  '| TF | SMA | Señales en 12m | Señales en historial ampliado | Primer 70% ampliado | Último 30% ampliado |',
  '|---|---:|---:|---:|---:|---:|',...coverageRows,'',
  '## SMA 200 diaria: precio alineado con la señal', '',
  '| Tramo | Dirección | Horizonte | Con SMA | Condición | Evaluables | Sesiones | Favorables | Media % | Diferencia frente a Bollinger comparable % | IC 95% por sesiones % |',
  '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|',...comparisonRows,'',
  'El referente Bollinger de cada fila utiliza la misma cobertura SMA 200 diaria y el mismo horizonte. Las restantes posiciones, pendientes y condiciones conjuntas están en el informe completo generado por validate:nvda-sma-context con el archivo ampliado.',
  'Este historial combina fechas anteriores con un período ya investigado. Un primer 70% con más cobertura histórica no es una validación prospectiva nueva; el último 30% puede contener fechas ya examinadas. Hay dependencia entre señales y múltiples comparaciones. Ninguna diferencia equivale a rentabilidad de opciones.', '',
].join('\n');
writeFileSync(join(output,`${stem}.json`),JSON.stringify(payload,null,2)+'\n');
writeFileSync(join(output,`${stem}.md`),markdown);
console.log(`Comparación histórica guardada en ${join(output,stem)}.{md,json}.`);
