import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {basename,dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseCandlesCsv} from './csv.ts';
import {loadMetadata} from './data-contract.ts';
import {loadMarketCalendar} from './alpaca-calendar.ts';
import {historyCoverage} from './nvda-history.ts';
import {replayObservations,replaySourceHashes} from './phase38b-replay.ts';
import {postDecisionObservations} from './phase38c-replay.ts';

const root=fileURLToPath(new URL('../../',import.meta.url)),args=process.argv.slice(2);
function arg(name:string){const index=args.indexOf(name);return index<0?undefined:args[index+1];}
if(args.length%2!==0||args.some((value,index)=>index%2===0&&!['--csv','--out'].includes(value)))
  throw new Error('Uso: npm run ml:replay:post:prepare -- --csv <CSV> --out <directorio privado nuevo>');
const csv=resolve(root,arg('--csv')??'trading_poc_001_bollinger/data/NVDA_ALPACA_SIP_15min_20211017_20261017.csv');
const out=resolve(root,arg('--out')??`trading_poc_001_bollinger/output/real/phase38c/${new Date().toISOString().replace(/[-:.]/g,'').slice(0,15)}Z`);
const privateRoots=[resolve(root,'private'),resolve(root,'trading_poc_001_bollinger/output/real')];
if(!privateRoots.some(base=>{const part=relative(base,out);return part!==''&&!part.startsWith('..')&&!isAbsolute(part);}))
  throw new Error('La salida debe quedar dentro de private/ u output/real/.');
const paths={csv,metadata:`${csv}.meta.json`,calendar:`${csv}.calendar.json`,provenance:`${csv}.provenance.json`};
const metadata=loadMetadata(csv),raw=JSON.parse(readFileSync(paths.metadata,'utf8')) as Record<string,unknown>;
const provenance=JSON.parse(readFileSync(paths.provenance,'utf8')) as Record<string,unknown>;
if(metadata.asset!=='NVDA'||metadata.provider!=='Alpaca Market Data API'||metadata.data_class!=='real'||
    metadata.bar_minutes!==15||metadata.feed!=='sip'||metadata.adjustment!=='split'||metadata.session!=='regular'||
    metadata.exchange_timezone!=='America/New_York'||provenance.provider!=='Alpaca Market Data API'||
    provenance.feed!=='sip'||provenance.adjustment!=='split'||provenance.timeframe!=='15Min'||
    provenance.calendar_endpoint!=='/v2/calendar'||provenance.credentials_recorded!==false)
  throw new Error('Se exige histórico real NVDA Alpaca SIP split 15Min y calendario oficial.');
if(typeof raw.requested_start!=='string'||typeof raw.requested_end!=='string'||
    raw.requested_start!==provenance.requested_start||raw.requested_end!==provenance.requested_end)
  throw new Error('Rango de procedencia inconsistente.');
const candles=parseCandlesCsv(readFileSync(csv,'utf8'),metadata,{allowIntradayGaps:true});
const calendar=loadMarketCalendar(paths.calendar);
const coverage=historyCoverage(candles,calendar,{start:raw.requested_start,end:raw.requested_end,fileStem:basename(csv)});
if(JSON.stringify(coverage)!==JSON.stringify(raw.coverage)||JSON.stringify(coverage)!==JSON.stringify(provenance.coverage))
  throw new Error('Cobertura y procedencia inconsistentes.');
const observations=postDecisionObservations(candles,calendar);
const legacyByStart=new Map(replayObservations(candles,calendar).map(row=>[row.bar_start_utc,row.label]));
const phase38bReference=Object.fromEntries(['ideal','delayed'].map(scenario=>{
  const paired=observations.filter(row=>row.scenario===scenario&&row.label!==null&&legacyByStart.get(row.bar_start_utc));
  const distribution=(labels:(string|null|undefined)[])=>Object.fromEntries(['ALCISTA','BAJISTA','LATERAL'].map(label=>[label,labels.filter(value=>value===label).length]));
  return [scenario,{same_observations:paired.length,phase38b:distribution(paired.map(row=>legacyByStart.get(row.bar_start_utc))),
    phase38c:distribution(paired.map(row=>row.label))}];
}));
const sha=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
const codeFiles=['trading_poc_001_bollinger/src/phase23-dataset.ts','trading_poc_001_bollinger/src/phase31-inference.ts',
  'trading_poc_001_bollinger/src/phase38c-replay.ts','ml/phase28/train.py','ml/phase38c/replay.py'];
const codeSha256=Object.fromEntries(codeFiles.map(path=>[path,sha(readFileSync(resolve(root,path)))]));
const payload=JSON.stringify(observations)+'\n';
const exclusions=Object.fromEntries(['ideal','delayed'].map(scenario=>[scenario,
  Object.fromEntries(['NONE','MARKET_CLOSE','FUTURE_BARS_MISSING'].map(reason=>[reason,
    observations.filter(row=>row.scenario===scenario&&(row.exclusion??'NONE')===reason).length]))]));
const manifest={schema:'phase38c-v1',source:{symbol:'NVDA',provider:metadata.provider,feed:'sip',adjustment:'split',timeframe:'15m',sha256:replaySourceHashes(paths)},
  codeSha256,observationsSha256:sha(payload),rows:observations.length,indicatorInsufficientCandles:candles.length-observations.length/2,
  exclusions,phase38bReference,scenarios:{ideal:'cierre t; entrada en primera apertura estrictamente posterior',
    delayed:'cierre t + 20 minutos simulados; entrada en primera apertura estrictamente posterior'},
  independence:'Replay retrospectivo exploratorio; no recepción histórica ni ejecución verificadas.'};
const manifestText=JSON.stringify(manifest,null,2)+'\n';
mkdirSync(dirname(out),{recursive:true});mkdirSync(out,{recursive:false});
writeFileSync(join(out,'observations.json'),payload,{flag:'wx'});
writeFileSync(join(out,'manifest.json'),manifestText,{flag:'wx'});
writeFileSync(join(out,'SHA256SUMS'),`${sha(payload)}  observations.json\n${sha(manifestText)}  manifest.json\n`,{flag:'wx'});
process.stdout.write(`${out}\n`);
