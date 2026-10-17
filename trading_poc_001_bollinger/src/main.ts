import {mkdirSync, writeFileSync} from 'node:fs';
import {basename} from 'node:path';
import {loadDataset} from './csv.ts';
import {calculateBollinger} from './bollinger.ts';
import {detectSignals} from './signals.ts';
import {evaluateBaseline, evaluateSignals, wilson95} from './evaluate.ts';
import type {Direction, Outcome, Signal} from './domain.ts';

const file = process.argv[2];
if (!file) {console.error('Uso: node --experimental-strip-types src/main.ts ruta/al/archivo.csv');process.exit(1);}
const {candles, metadata: dataMetadata} = loadDataset(file);
if (candles.length < 300) throw new Error('Se recomiendan al menos 300 velas para esta prueba.');
const split = Math.floor(candles.length * 0.7);
const points = calculateBollinger(candles);
const signals = detectSignals(points);
const horizons = [3,6,12];
const segments = [
  {key:'exploracion',label:'Exploración (primer 70%)',start:0,end:split},
  {key:'validacion',label:'Validación (último 30%)',start:split,end:candles.length},
] as const;
const fmt = (x:number) => x.toFixed(2);
const results: Record<string,unknown> = {};
const lines = [
  '# POC 001: Bollinger y movimientos posteriores',
  '',
  `Archivo: \`${basename(file)}\``,
  dataMetadata.data_class === 'synthetic' ? '**ATENCIÓN: DATOS FICTICIOS. Los resultados no representan el mercado ni sirven para operar.**' : '**Datos declarados reales por el usuario; origen y calidad no verificados por este programa.**',
  '',
  `Activo: ${dataMetadata.asset}; proveedor declarado: ${dataMetadata.provider}; sesión: ${dataMetadata.session} (${dataMetadata.exchange_timezone}).`,
  'Cada timestamp CSV marca el inicio de una vela de 5 minutos en UTC. Una señal solo está disponible al terminar su vela; no se supone ejecución a ese precio de cierre.',
  `Velas: ${candles.length}; rango ${candles[0]!.timestamp} a ${candles.at(-1)!.timestamp}.`,
  'Parámetros: Bollinger 20 períodos, 2 desviaciones; referencia histórica 100 velas; percentil 20; expansión relativa mínima 5%; ruptura de banda; máximo una señal cada 12 velas.',
  `Separación temporal: primeras ${split} velas para exploración y últimas ${candles.length-split} velas para validación. Los parámetros se eligieron antes de conocer los resultados del ejemplo.`,
  '',
  `**Importante:** el porcentaje positivo aquí indica únicamente que el precio de ${dataMetadata.asset} se movió en la dirección observada después de X velas. **No indica ganancias de CALL/PUT** ni incorpora primas, spreads o comisiones.`,
  '',
];
for (const segment of segments) {
  lines.push(`## ${segment.label}`, '', '| Dirección observada | Horizonte | Señales válidas | % movimiento favorable | IC 95% (aproximado) | Cambio medio a favor (%) | Base de mercado favorable (%) |', '|---|---:|---:|---:|---|---:|---:|');
  const outcomes = evaluateSignals(candles,signals,horizons,segment.start,segment.end);
  const segmentResults=[];
  for (const direction of ['CALL_CONTEXT','PUT_CONTEXT'] as Direction[]) {
    for (const horizon of horizons) {
      const selected = outcomes.filter(o=>o.signal.direction===direction && o.horizon===horizon);
      const wins=selected.filter(o=>o.favored).length;
      const n=selected.length;
      const ci=wilson95(wins,n);
      const avg=n?selected.reduce((acc,o)=>acc+o.signedReturnPercent,0)/n:null;
      const base=evaluateBaseline(candles,horizon,direction,segment.start,segment.end);
      lines.push(`| ${direction==='CALL_CONTEXT'?'Alcista (estudiar CALL)':'Bajista (estudiar PUT)'} | ${horizon} velas | ${n} | ${n?fmt(wins/n*100)+'%':'N/D'} | ${ci?`${fmt(ci[0]*100)}% a ${fmt(ci[1]*100)}%`:'N/D'} | ${avg!==null?fmt(avg):'N/D'} | ${base.samples?fmt(base.positiveRate*100)+'%':'N/D'} |`);
      segmentResults.push({direction,horizon,samples:n,favorable_count:wins,favorable_rate:n?wins/n:null,wilson95:ci,average_signed_price_return_percent:avg,unconditional_baseline_positive_rate:base.positiveRate,unconditional_baseline_samples:base.samples});
    }
  }
  results[segment.key]=segmentResults;
  lines.push('');
}
lines.push('**Lectura correcta:** las cifras dependen de los datos, del período y de las reglas seleccionadas. El intervalo de confianza supone observaciones independientes, que no siempre ocurre en series financieras. Una tasa histórica alta no demuestra una ventaja real.', '', '**Próximo paso:** analizar velas reales de QQQ y después investigar si las diferencias persisten fuera de muestra y tras costos de ejecución.', '');
mkdirSync('output',{recursive:true});
const metadata={input:file,data_type:dataMetadata.data_class === 'synthetic' ? 'synthetic' : 'user_supplied_unverified',data:dataMetadata,bar_size_minutes:5,timestamp_semantics:'bar_start_utc',signal_available_at:'bar_end_utc',model:'bollinger_squeeze_expansion_v0',horizons,indicators:{bollinger_periods:20,sd_multiples:2,bandwidth_lookback:100,lowest_bandwidth_quantile:.2,minimum_bandwidth_expansion:1.05,signal_cooldown_bars:12},split_index:split,split_timestamp:candles[split]?.timestamp,total_signals:signals.length,stats:results};
writeFileSync('output/report.json',JSON.stringify(metadata,null,2)+'\n');
writeFileSync('output/report.md',lines.join('\n'));
writeFileSync('output/signals.csv',['bar_start_utc,bar_end_utc,available_at_utc,direction,close,previous_bandwidth_percent,current_bandwidth_percent,threshold_percent,segment',...signals.map(s=>`${s.timestamp},${s.candleEndTimestamp},${s.availableAt},${s.direction},${s.close.toFixed(4)},${s.previousBandwidthPercent.toFixed(4)},${s.currentBandwidthPercent.toFixed(4)},${s.squeezeThresholdPercent.toFixed(4)},${s.index>=split?'validacion':'exploracion'}`)].join('\n')+'\n');
console.log('\n'+lines.join('\n'));
console.log('Guardados: output/report.md, output/report.json y output/signals.csv');
