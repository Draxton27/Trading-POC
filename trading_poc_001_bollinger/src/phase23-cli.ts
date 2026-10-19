import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {basename,join} from 'node:path';
import {parseCandlesCsv} from './csv.ts';
import {validateMetadata} from './data-contract.ts';
import {loadMarketCalendar} from './alpaca-calendar.ts';
import {historyCoverage} from './nvda-history.ts';
import {buildPhase23Dataset,DATASET_SPEC,type DatasetRow} from './phase23-dataset.ts';

const source='data/NVDA_ALPACA_SIP_15min_20211017_20261017.csv';
const paths={csv:source,metadata:`${source}.meta.json`,calendar:`${source}.calendar.json`,provenance:`${source}.provenance.json`};
const sha=(data:Buffer|string)=>createHash('sha256').update(data).digest('hex');
const input=Object.fromEntries(Object.entries(paths).map(([name,path])=>[name,readFileSync(path)])) as Record<keyof typeof paths,Buffer>;
const rawMetadata=JSON.parse(input.metadata.toString('utf8')) as Record<string,unknown>;
const metadata=validateMetadata(rawMetadata), provenance=JSON.parse(input.provenance.toString('utf8')) as Record<string,unknown>;
if(metadata.asset!=='NVDA'||metadata.provider!=='Alpaca Market Data API'||metadata.data_class!=='real'||
  metadata.bar_minutes!==15||metadata.feed!=='sip'||metadata.adjustment!=='split'||metadata.session!=='regular'||
  provenance.provider!=='Alpaca Market Data API'||provenance.bars_endpoint!=='/v2/stocks/bars'||
  provenance.calendar_endpoint!=='/v2/calendar'||provenance.timeframe!=='15Min'||provenance.feed!=='sip'||
  provenance.adjustment!=='split'||provenance.session!=='regular'||provenance.credentials_recorded!==false)
  throw new Error('Se exige procedencia declarada NVDA real Alpaca SIP split, 15Min, sesión regular.');
if(typeof rawMetadata.requested_start!=='string'||typeof rawMetadata.requested_end!=='string'||
  rawMetadata.requested_start!==provenance.requested_start||rawMetadata.requested_end!==provenance.requested_end||
  !Number.isFinite(Date.parse(rawMetadata.requested_start))||!Number.isFinite(Date.parse(rawMetadata.requested_end))||
  Date.parse(rawMetadata.requested_start)>=Date.parse(rawMetadata.requested_end))throw new Error('Rango de procedencia inválido o inconsistente.');
const candles=parseCandlesCsv(input.csv.toString('utf8'),metadata,{allowIntradayGaps:true});
const calendar=loadMarketCalendar(paths.calendar);
const coverage=historyCoverage(candles,calendar,{start:rawMetadata.requested_start,end:rawMetadata.requested_end,fileStem:basename(source)});
if(Date.parse(candles[0]!.timestamp)<Date.parse(rawMetadata.requested_start)||
  Date.parse(candles.at(-1)!.timestamp)>Date.parse(rawMetadata.requested_end))throw new Error('Las velas exceden el intervalo declarado.');
if(JSON.stringify(coverage)!==JSON.stringify(rawMetadata.coverage)||JSON.stringify(coverage)!==JSON.stringify(provenance.coverage))
  throw new Error('La cobertura calculada no coincide con la declarada en los archivos locales.');
const result=buildPhase23Dataset(candles,calendar);
const columns:Record<keyof DatasetRow,{role:'feature'|'metadata'|'target';description:string}>={
  partition:{role:'metadata',description:'desarrollo antes de 2025 o evaluación exploratoria 2025-2026'},
  session_date_ny:{role:'metadata',description:'Fecha de sesión en America/New_York'},
  session:{role:'feature',description:'Sesión regular'},bar_start_ny:{role:'feature',description:'Hora local de inicio de vela t'},
  bar_start_utc:{role:'metadata',description:'Inicio de la vela t en UTC'},observed_at_utc:{role:'metadata',description:'Cierre de la vela t en UTC'},
  available_at_utc:{role:'metadata',description:'Disponibilidad de variables, cierre de vela t en UTC'},
  minutes_from_open:{role:'feature',description:'Minutos entre apertura de sesión e inicio de vela t'},
  return_1:{role:'feature',description:'close[t]/close[t-1] - 1'},return_4:{role:'feature',description:'close[t]/close[t-4] - 1'},
  distance_ema9:{role:'feature',description:'close[t]/EMA9[t] - 1'},distance_sma20:{role:'feature',description:'close[t]/SMA20[t] - 1'},
  bollinger_position:{role:'feature',description:'(close[t]-lower[t])/(upper[t]-lower[t]), Bollinger 20/2'},
  relative_volume_20:{role:'feature',description:'volume[t] / media(volume[t-20..t-1])'},
  candle_range:{role:'feature',description:'(high[t]-low[t])/open[t]'},candle_body:{role:'feature',description:'(close[t]-open[t])/open[t], con signo'},
  atr14_relative:{role:'feature',description:'Media simple de los últimos 14 true ranges de 15 minutos, incluido t, dividida entre close[t]'},
  label:{role:'target',description:'ALCISTA, BAJISTA o LATERAL según cambio y 0.5 × ATR14[t]'},
  label_entry_utc:{role:'target',description:'Inicio de vela t+1; dato posterior, no es variable'},
  label_available_at_utc:{role:'target',description:'Cierre de vela t+4; disponibilidad de etiqueta'},
  label_entry_open:{role:'target',description:'Apertura t+1, referencia hipotética para etiquetar'},
  label_exit_close:{role:'target',description:'Cierre t+4, dato futuro'},label_change:{role:'target',description:'close[t+4] - open[t+1] en unidades de precio ajustado'},
  label_atr14_price_units:{role:'target',description:'ATR14 en escala retrospectiva ajustada; solo auditoría de etiqueta, no utilizar como variable'},
};
const keys=Object.keys(columns) as (keyof DatasetRow)[];
const csv=keys.join(',')+'\n'+result.rows.map(row=>keys.map(key=>String(row[key])).join(',')).join('\n')+'\n';
const distribution=Object.fromEntries((['desarrollo','evaluacion_exploratoria'] as const).map(split=>{
  const rows=result.rows.filter(row=>row.partition===split);
  return [split,{rows:rows.length,sessions:new Set(rows.map(row=>row.session_date_ny)).size,
    labels:Object.fromEntries((['ALCISTA','BAJISTA','LATERAL'] as const).map(label=>[label,rows.filter(row=>row.label===label).length]))}];
}));
if(Object.values(distribution).some(value=>value.rows===0))throw new Error('El dataset requiere filas de desarrollo y evaluación exploratoria.');
const codeFiles=['src/phase23-cli.ts','src/phase23-dataset.ts','src/csv.ts','src/data-contract.ts','src/alpaca-calendar.ts',
  'src/nvda-history.ts','src/nvda-indicators-study.ts','src/strategy-validation.ts','src/ema9.ts','src/bollinger.ts'];
const sourceHashes=Object.fromEntries(Object.entries(input).map(([key,value])=>[key,sha(value)]));
const codeHashes=Object.fromEntries(codeFiles.map(path=>[path,sha(readFileSync(path))]));
const version=sha(JSON.stringify({spec:DATASET_SPEC,sourceHashes,codeHashes,node:process.versions.node})).slice(0,20);
const manifest={schemaVersion:DATASET_SPEC,version,nodeVersion:process.versions.node,
  source:{files:Object.fromEntries(Object.entries(paths).map(([key,path])=>[key,basename(path)])),sha256:sourceHashes,
    metadata,requestedStart:rawMetadata.requested_start,requestedEnd:rawMetadata.requested_end,coverage,
    authenticity:'Procedencia declarada en sidecars locales; hashes identifican archivos, no prueban su autenticidad.'},
  codeSha256:codeHashes,outputCsvSha256:sha(csv),columns,distribution,exclusions:result.exclusions,
  accounting:{inputCandles:candles.length,outputRows:result.rows.length},
  split:{development:'sesiones anteriores a 2025-01-01',evaluation:'sesiones entre 2025-01-01 y 2026-12-31',
    purge:'Etiquetas deben permanecer dentro de la misma sesión y partición.',embargo:'0 sesiones: las ventanas no cruzan sesiones ni particiones. Reconsiderar en futuras validaciones cruzadas.',
    independence:'Todo el histórico se examinó en fases anteriores; no existe evaluación independiente del proyecto.'},
  selection:'Se excluyen sesiones incompletas retrospectivamente; puede introducir sesgo de selección y no es una condición conocida al cierre de t.',
  splitAdjustment:'Las variables de precios son razones invariantes ante un factor uniforme de split posterior; ATR se entrega dividido por close[t]. Los campos de escala absoluta son exclusivamente de auditoría de etiqueta. Los sidecars no prueban el estado point-in-time ni correcciones del proveedor.',
  hypothesis:'Umbral fijo inicial ±0.5 ATR14[t], no optimizado ni validado como estrategia; sin modelo ni ejecución simulada.'};
const json=JSON.stringify(manifest,null,2)+'\n';
const base=join('output','real','phase23-ml-dataset');mkdirSync(base,{recursive:true});const output=join(base,version);mkdirSync(output);
writeFileSync(join(output,'dataset.csv'),csv,{flag:'wx'});writeFileSync(join(output,'metadata.json'),json,{flag:'wx'});
writeFileSync(join(output,'SHA256SUMS'),`${sha(csv)}  dataset.csv\n${sha(json)}  metadata.json\n`,{flag:'wx'});
console.log(JSON.stringify({output,version,distribution,exclusions:result.exclusions,coverage},null,2));
