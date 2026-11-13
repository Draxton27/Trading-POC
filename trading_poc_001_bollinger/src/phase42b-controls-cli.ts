import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {InputRecord} from '../../apps/api/src/real-trades/normalize.ts';
import {auditControlSnapshots} from './phase42b-controls.ts';

const root=resolve(fileURLToPath(new URL('../..',import.meta.url)),'private','phase42b');
const sha=(v:Buffer)=>createHash('sha256').update(v).digest('hex');
function main(){
  const args=process.argv.slice(2);
  if(args.length!==4||args[0]!=='--source-run'||args[2]!=='--run-id'||![args[1],args[3]].every(x=>typeof x==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(x)))throw Error('USAGE');
  const source=join(root,'sources',args[1]!),manifestBytes=readFileSync(join(source,'manifest.json'));
  const manifest=JSON.parse(manifestBytes.toString('utf8')) as {version:string;tables:Record<string,{sha256:string;count:number}>};
  const sourceBytes=readFileSync(join(source,'table-3.json')), key='Yoel - Snapshot tecnico';
  if(manifest.version!=='42B-source-v1'||manifest.tables?.[key]?.sha256!==sha(sourceBytes))throw Error('SOURCE_HASH_MISMATCH');
  const data=JSON.parse(sourceBytes.toString('utf8')) as {table:string;records:InputRecord[]};
  if(data.table!==key||!Array.isArray(data.records)||data.records.length!==manifest.tables[key]!.count)throw Error('SOURCE_INVALID');
  const controls=auditControlSnapshots(data.records),parent=join(root,'controls');mkdirSync(parent,{recursive:true});
  const target=join(parent,args[3]!);mkdirSync(target);
  writeFileSync(join(target,'controls.json'),JSON.stringify({version:'42B-controls-v1',sourceManifestSha256:sha(manifestBytes),controls},null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:'CONTROLES_AUDITADOS_CON_LIMITACIONES',records:controls.length,
    timingCandidates:controls.filter(x=>x.notStrictlyPriorAssuming1m!==null&&x.notStrictlyPriorAssuming1m>0).length,
    unavailableBars:controls.filter(x=>x.barCount===null).length}));
}
try{main();}catch(error){console.error(`Fase 42B: ${error instanceof Error?error.message:'ERROR'}`);process.exitCode=1;}
