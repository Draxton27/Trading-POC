import {createHash} from 'node:crypto';
import {mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {stableQueueHash,type QueueItem} from './phase42b-queue.ts';

const root=resolve(fileURLToPath(new URL('../..',import.meta.url)),'private','phase42b');
const sha=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
function main(){
  const a=process.argv.slice(2);
  if(a.length!==4||a[0]!=='--queue-run'||a[2]!=='--run-id'||![a[1],a[3]].every(x=>typeof x==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(x)))throw Error('USAGE');
  const q=JSON.parse(readFileSync(join(root,'queues',a[1]!,'queue.json'),'utf8')) as {queue:QueueItem[];queueSha256:string};
  if(!Array.isArray(q.queue)||stableQueueHash(q.queue)!==q.queueSha256)throw Error('QUEUE_INVALID');
  const folder=join(root,'batch-audits'),files=readdirSync(folder,{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>join(folder,d.name,'audit.json')).sort();
  const seen=new Set<string>(),hashes:string[]=[],counts:Record<string,{complete:number;incomplete:number;empty:number;unavailable:number}>={};
  for(const frame of ['1Min','5Min','15Min'])counts[frame]={complete:0,incomplete:0,empty:0,unavailable:0};
  for(const file of files){
    const bytes=readFileSync(file),doc=JSON.parse(bytes.toString('utf8')) as {version:string;queueSha256:string;findings:{sourceRecordId:string;frames:Record<string,{expected?:number|null;missing?:number|null}>}[]};
    if(doc.version!=='42B-batch-audit-v1'||doc.queueSha256!==q.queueSha256||!Array.isArray(doc.findings))throw Error('AUDIT_INVALID');
    hashes.push(sha(bytes));
    for(const item of doc.findings){
      if(seen.has(item.sourceRecordId)||!q.queue.some(v=>v.sourceRecordId===item.sourceRecordId))throw Error('AUDIT_DUPLICATE_OR_UNKNOWN');seen.add(item.sourceRecordId);
      for(const frame of Object.keys(counts)){
        const x=item.frames?.[frame],c=counts[frame]!;
        if(x?.expected===null||x?.expected===undefined||x?.missing===null||x?.missing===undefined)c.unavailable++;
        else if(x.expected===0)c.empty++;else if(x.missing===0)c.complete++;else c.incomplete++;
      }
    }
  }
  const missingIds=q.queue.filter(x=>!seen.has(x.sourceRecordId)).map(x=>x.sourceRecordId);
  const summary={version:'42B-summary-v1',queueSha256:q.queueSha256,auditHashes:hashes,audited:seen.size,total:q.queue.length,missingIds,frames:counts,
    note:'Completitud de barras en sesión, no disponibilidad point-in-time; 1h/1d y eventos corporativos pendientes.'};
  const parent=join(root,'summaries');mkdirSync(parent,{recursive:true});const dest=join(parent,a[3]!);mkdirSync(dest);
  writeFileSync(join(dest,'summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:'RESUMEN_CON_LIMITACIONES',audited:seen.size,total:q.queue.length,frames:counts}));
}
try{main();}catch(error){console.error(`Fase 42B: ${error instanceof Error?error.message:'ERROR'}`);process.exitCode=1;}
