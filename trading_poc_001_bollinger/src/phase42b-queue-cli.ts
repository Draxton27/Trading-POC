import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildPendingQueue,stableQueueHash} from './phase42b-queue.ts';
import {YOEL_TABLES} from './phase42b-source.ts';

const root=resolve(fileURLToPath(new URL('../..',import.meta.url)),'private','phase42b');
const sha=(v:Buffer)=>createHash('sha256').update(v).digest('hex');
function main(){
  const args=process.argv.slice(2);
  if(args.length!==4||args[0]!=='--source-run'||args[2]!=='--run-id'||![args[1],args[3]].every(v=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(v)))
    throw new Error('Uso: npm.cmd run research:42b:queue -- --source-run ID --run-id ID');
  const source=join(root,'sources',args[1]!),manifestPath=join(source,'manifest.json');
  if(statSync(manifestPath).size>1024*1024)throw new Error('MANIFEST_TOO_LARGE');
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8')) as {version:string;tables:Record<string,{sha256:string;count:number}>};
  if(manifest.version!=='42B-source-v1')throw new Error('MANIFEST_INVALID');
  let pending:unknown;
  for(const [i,table] of YOEL_TABLES.entries()){
    const path=join(source,`table-${i+1}.json`);if(statSync(path).size>32*1024*1024)throw new Error('SOURCE_TOO_LARGE');
    const content=readFileSync(path);if(sha(content)!==manifest.tables?.[table]?.sha256)throw new Error('SOURCE_HASH_MISMATCH');
    const data=JSON.parse(content.toString('utf8')) as {table:string;records:unknown[]};
    if(data.table!==table||!Array.isArray(data.records)||data.records.length!==manifest.tables[table]!.count)throw new Error('SOURCE_INVALID');
    if(i===3)pending=data.records;
  }
  const queue=buildPendingQueue(pending as Parameters<typeof buildPendingQueue>[0]);
  const parent=join(root,'queues');mkdirSync(parent,{recursive:true});const destination=join(parent,args[3]!);mkdirSync(destination);
  const output={version:'42B-queue-v1',sourceManifestSha256:sha(readFileSync(manifestPath)),queueSha256:stableQueueHash(queue),
    note:'Datos pendientes de verificación, no son señales, conclusiones ni reconstrucciones.',queue};
  writeFileSync(join(destination,'queue.json'),JSON.stringify(output,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:'COLA_PREPARADA',records:queue.length,conflicts:queue.filter(x=>x.status==='IDENTITY_CONFLICT').length,
    timeUnverifiable:queue.filter(x=>!x.entryUtc).length}));
}
try{main();}catch(error){console.error(`Fase 42B: ${error instanceof Error?error.message:'ERROR'}`);process.exitCode=1;}
