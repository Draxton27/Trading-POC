import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseCandlesCsv} from './csv.ts';
import {loadMetadata} from './data-contract.ts';
import {loadMarketCalendar} from './alpaca-calendar.ts';
import {auditLocal15m} from './phase42b-local-audit.ts';
import {stableQueueHash,type QueueItem} from './phase42b-queue.ts';

const repo=resolve(fileURLToPath(new URL('../..',import.meta.url))),root=join(repo,'private','phase42b');
const sha=(v:Buffer)=>createHash('sha256').update(v).digest('hex');
function main(){
  const args=process.argv.slice(2);
  if(args.length!==4||args[0]!=='--queue-run'||args[2]!=='--run-id'||![args[1],args[3]].every(v=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(v)))
    throw new Error('Uso: npm.cmd run research:42b:audit -- --queue-run ID --run-id ID');
  const queueFile=join(root,'queues',args[1]!,'queue.json'),queueBytes=readFileSync(queueFile);
  const input=JSON.parse(queueBytes.toString('utf8')) as {version:string;queueSha256:string;queue:QueueItem[]};
  if(input.version!=='42B-queue-v1'||!Array.isArray(input.queue)||stableQueueHash(input.queue)!==input.queueSha256)throw new Error('QUEUE_INVALID');
  const findings:unknown[]=[],datasets:Record<string,unknown>={};
  for(const symbol of ['NVDA','QQQ','SMH']){
    const path=join(repo,'trading_poc_001_bollinger','data',`${symbol}_ALPACA_SIP_15min_20211017_20261017.csv`);
    const needed=[path,`${path}.meta.json`,`${path}.calendar.json`,`${path}.provenance.json`];
    if(needed.some(v=>!existsSync(v))){datasets[symbol]={status:'SIN_DATOS'};findings.push(...input.queue.filter(x=>x.symbol===symbol).map(x=>({sourceRecordId:x.sourceRecordId,status:'NO_VERIFICABLE',reasons:['FUENTE_LOCAL_15M_NO_DISPONIBLE']})));continue;}
    const meta=loadMetadata(path);
    if(meta.asset!==symbol||meta.provider!=='Alpaca Market Data API'||meta.feed!=='sip'||meta.adjustment!=='split'||meta.bar_minutes!==15||meta.session!=='regular'||meta.data_class!=='real')throw new Error('SOURCE_METADATA_INCOMPATIBLE');
    const raw=readFileSync(path),candles=parseCandlesCsv(raw.toString('utf8'),meta,{allowIntradayGaps:true});
    const calendar=loadMarketCalendar(`${path}.calendar.json`);
    findings.push(...auditLocal15m(input.queue,symbol,candles,calendar));
    datasets[symbol]={status:'ARCHIVO_DISPONIBLE_RECEPCION_NO_VERIFICADA',rows:candles.length,
      csvSha256:sha(raw),metadataSha256:sha(readFileSync(`${path}.meta.json`)),calendarSha256:sha(readFileSync(`${path}.calendar.json`)),provenanceSha256:sha(readFileSync(`${path}.provenance.json`))};
  }
  const unmatched=input.queue.filter(x=>!['NVDA','QQQ','SMH'].includes(x.symbol??'')).map(x=>({sourceRecordId:x.sourceRecordId,status:'NO_VERIFICABLE',reasons:['FUENTE_LOCAL_15M_NO_DISPONIBLE']}));
  const parent=join(root,'audits');mkdirSync(parent,{recursive:true});const destination=join(parent,args[3]!);mkdirSync(destination);
  const report={version:'42B-local-audit-v1',queueSha256:sha(queueBytes),datasets,findings:[...findings,...unmatched],
    unavailableFrames:['1m','5m','1h','1d'],note:'Auditoría inicial: no demuestra recepción histórica, ajustes point-in-time ni licencia.'};
  writeFileSync(join(destination,'audit.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:'AUDITORIA_PARCIAL',queue:input.queue.length,findings:report.findings.length,framesPending:report.unavailableFrames}));
}
try{main();}catch(error){console.error(`Fase 42B: ${error instanceof Error?error.message:'ERROR'}`);process.exitCode=1;}
