/** IEX-only historical research. The source is a completed, verified Phase 38D run. */
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync} from 'node:fs';
import {resolve,relative,isAbsolute,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseCandlesCsv} from './csv.ts';
import {loadMarketCalendar,isCalendarBar} from './alpaca-calendar.ts';
import {postDecisionObservations} from './phase38c-replay.ts';

const root=fileURLToPath(new URL('../../',import.meta.url));
const args=process.argv.slice(2);
if(args.length!==4||args[0]!=='--source'||args[2]!=='--out')
  throw new Error('Uso: npm run ml:iex:prepare -- --source <histórico 38D> --out <directorio privado nuevo>');
const source=resolve(root,args[1]!),out=resolve(root,args[3]!);
const allowed=[resolve(root,'private'),resolve(root,'trading_poc_001_bollinger/output/real')];
const within=(path:string)=>allowed.some(base=>{const part=relative(base,path);return part!==''&&!part.startsWith('..')&&!isAbsolute(part);});
if(!within(source)||!within(out)||source===out)throw new Error('Fuente y salida deben ser carpetas privadas diferentes.');
const sha=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
const hashes=new Map<string,string>();
for(const line of readFileSync(join(source,'SHA256SUMS'),'utf8').trim().split(/\r?\n/)){
  const match=/^([a-f0-9]{64})  (.+)$/.exec(line);
  if(!match||hashes.has(match[2]!))throw new Error('Manifiesto IEX inválido.');
  const name=match[2]!;
  if(name.startsWith('/')||name.includes('..')||name.includes('\\'))throw new Error('Ruta de manifiesto IEX inválida.');
  hashes.set(name,match[1]!);
}
for(const name of ['query.json','calendar.json','calendar.json.sha256','minutes.csv','strict-15m.csv','report.json'])
  if(!hashes.has(name))throw new Error(`Artefacto IEX requerido ausente: ${name}.`);
for(const [name,digest] of hashes)
  if(sha(readFileSync(join(source,name)))!==digest)throw new Error(`SHA-256 IEX inválido: ${name}.`);
const report=JSON.parse(readFileSync(join(source,'report.json'),'utf8'));
const query=JSON.parse(readFileSync(join(source,'query.json'),'utf8'));
if(report.schema!=='phase38d-report-v1'||query.schema!=='phase38d-v1'||
  query.symbol!=='NVDA'||query.feed!=='iex'||query.timeframe!=='1Min'||query.adjustment!=='raw'||
  JSON.stringify(report.source)!==JSON.stringify(query)||report.sha256.strict15mCsv!==hashes.get('strict-15m.csv')||
  report.sha256.calendar!==hashes.get('calendar.json'))throw new Error('Procedencia IEX incompatible.');
const calendar=loadMarketCalendar(join(source,'calendar.json'));
const strict=readFileSync(join(source,'strict-15m.csv'),'utf8');
const candles=parseCandlesCsv(strict,{asset:'NVDA',provider:'Alpaca Market Data API',bar_minutes:15,
  data_class:'real',session:'regular',exchange_timezone:'America/New_York'},{allowIntradayGaps:true});
if(candles.length!==report.summary.strict15m)throw new Error('Conteo de velas IEX distinto del reporte.');
for(const bar of candles){const start=Date.parse(bar.timestamp);
  if(start<Date.parse(query.start)||start+900_000>Date.parse(query.end)||
    ![0,5,10].every(offset=>isCalendarBar(start+offset*60_000,calendar)))
    throw new Error('Vela IEX fuera del calendario o rango verificado.');
}
const observations=postDecisionObservations(candles,calendar).map(row=>({...row,phase:'38E' as const,feed:'iex' as const,adjustment:'raw' as const}));
const observationsText=JSON.stringify(observations)+'\n';
const codeFiles=['trading_poc_001_bollinger/src/phase23-dataset.ts','trading_poc_001_bollinger/src/phase31-inference.ts',
  'trading_poc_001_bollinger/src/phase38c-replay.ts','trading_poc_001_bollinger/src/phase38e-cli.ts',
  'ml/phase28/train.py','ml/phase38c/replay.py','ml/phase38e/replay.py'];
const codeSha256=Object.fromEntries(codeFiles.map(name=>[name,sha(readFileSync(resolve(root,name)))]));
const manifest={schema:'phase38e-v1',source:{symbol:'NVDA',provider:'Alpaca Market Data API',feed:'iex',adjustment:'raw',
  minuteTimeframe:'1Min',timeframe:'15m',start:query.start,end:query.end,sha256:Object.fromEntries(hashes)},
  codeSha256,observationsSha256:sha(observationsText),rows:observations.length,
  indicatorInsufficientCandles:candles.length-observations.length/2,
  exclusionCounts:Object.fromEntries(['ideal','delayed'].map(scenario=>[scenario,Object.fromEntries(
    ['NONE','MARKET_CLOSE','FUTURE_BARS_MISSING'].map(reason=>[reason,observations.filter(row=>row.scenario===scenario&&(row.exclusion??'NONE')===reason).length]))])),
  availability:'Simulada: cierre de vela o cierre + 20 minutos. REST histórico no proporciona hora de recepción original.',
  independence:'Investigación retrospectiva, sin inferencia prospectiva verificada.'};
const manifestText=JSON.stringify(manifest,null,2)+'\n';
mkdirSync(dirname(out),{recursive:true});mkdirSync(out,{recursive:false});
const {writeFileSync}=await import('node:fs');
writeFileSync(join(out,'observations.json'),observationsText,{flag:'wx'});
writeFileSync(join(out,'manifest.json'),manifestText,{flag:'wx'});
writeFileSync(join(out,'SHA256SUMS'),`${sha(observationsText)}  observations.json\n${sha(manifestText)}  manifest.json\n`,{flag:'wx'});
process.stdout.write(JSON.stringify({out,sourceCandles:candles.length,observations:observations.length,exclusions:manifest.exclusionCounts})+'\n');
