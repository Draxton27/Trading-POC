import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {stableQueueHash,type QueueItem} from './phase42b-queue.ts';

const root=resolve(fileURLToPath(new URL('../..',import.meta.url)),'private','phase42b');
const sha=(v:Buffer)=>createHash('sha256').update(v).digest('hex');
function main(){
  const a=process.argv.slice(2),keys=['--queue-run','--equity-run','--spx-run','--run-id'];
  if(a.length!==8||keys.some((x,i)=>a[2*i]!==x)||![a[1],a[3],a[5],a[7]].every(x=>typeof x==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(x)))throw Error('USAGE');
  const q=JSON.parse(readFileSync(join(root,'queues',a[1]!,'queue.json'),'utf8')) as {queue:QueueItem[];queueSha256:string};
  if(!Array.isArray(q.queue)||stableQueueHash(q.queue)!==q.queueSha256)throw Error('QUEUE_INVALID');
  const equity=readFileSync(join(root,'batch-reconstructions',a[3]!,'report.json')),
    spx=readFileSync(join(root,'spx-audits',a[5]!,'audit.json'));
  const e=JSON.parse(equity.toString('utf8')) as {version:string;queueSha256:string;outcomes:{sourceRecordId:string}[]};
  const s=JSON.parse(spx.toString('utf8')) as {version:string;queueSha256:string;outcomes:{sourceRecordId:string}[]};
  if(e.version!=='42B-batch-reconstruction-v1'||s.version!=='42B-spx-audit-v1'||e.queueSha256!==q.queueSha256||s.queueSha256!==q.queueSha256||
    !Array.isArray(e.outcomes)||!Array.isArray(s.outcomes))throw Error('SOURCE_INVALID');
  const index=<T extends {sourceRecordId:string}>(rows:T[])=>{const m=new Map<string,T>();for(const r of rows){if(m.has(r.sourceRecordId))throw Error('DUPLICATE_SOURCE_ID');m.set(r.sourceRecordId,r);}return m;};
  const ei=index(e.outcomes),si=index(s.outcomes);
  if(ei.size!==q.queue.length||q.queue.some(x=>!ei.has(x.sourceRecordId))||
    si.size!==q.queue.filter(x=>x.symbol==='SPXW'||x.symbol==='SPX').length||
    q.queue.some(x=>(x.symbol==='SPXW'||x.symbol==='SPX')!==si.has(x.sourceRecordId)))throw Error('SOURCE_COVERAGE_INVALID');
  const rows=q.queue.map(item=>({sourceRecordId:item.sourceRecordId,sourceTradeIds:item.sourceTradeIds,sourceKey:item.sourceKey,
    status:'NO_VERIFICABLE',equity:ei.get(item.sourceRecordId),spx:si.get(item.sourceRecordId)??null,
    separation:{observations:'RETROSPECTIVAS_CONDICIONALES',hypotheses:item.hypotheses,
      supportingEvidence:[],contradictingEvidence:[],laterEvolution:null},
    limitations:['RECEPCION_HISTORICA_NO_VERIFICADA','MOTIVACION_DEL_OPERADOR_DESCONOCIDA','MUESTRA_SELECCIONADA']}));
  const parent=join(root,'reports');mkdirSync(parent,{recursive:true});const dest=join(parent,a[7]!);mkdirSync(dest);
  const report={version:'42B-research-report-v1',queueSha256:q.queueSha256,sourceHashes:{equity:sha(equity),spx:sha(spx)},rows};
  writeFileSync(join(dest,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:'INCOMPLETO_SIN_INTERPRETACION_OPERATIVA',rows:rows.length,spx:si.size}));
}
try{main();}catch(error){console.error(`Fase 42B: ${error instanceof Error?error.message:'ERROR'}`);process.exitCode=1;}
