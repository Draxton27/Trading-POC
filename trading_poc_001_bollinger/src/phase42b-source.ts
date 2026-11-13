import {createHash} from 'node:crypto';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {airtableRecords} from '../../apps/api/src/real-trades/sources.ts';
import type {InputRecord} from '../../apps/api/src/real-trades/normalize.ts';

export const YOEL_TABLES = ['Yoel - Capturas 364','Yoel - Trades reconstruidos',
  'Yoel - Snapshot tecnico','Yoel - Pendientes intradia'] as const;
export type SourceTable = typeof YOEL_TABLES[number];
export type TableReader = (table: SourceTable) => AsyncIterable<InputRecord>;
const sha = (text:string) => createHash('sha256').update(text).digest('hex');

/** Capture every page before publishing a new directory. Never mutate Airtable or an earlier capture. */
export async function captureYoelSources(options:{root:string; runId:string; baseId:string; read:TableReader; now?:()=>Date}) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(options.runId)) throw new Error('RUN_ID_INVALID');
  if (!/^app[A-Za-z0-9]{14}$/.test(options.baseId)) throw new Error('BASE_INVALID');
  const clock=options.now??(()=>new Date()), startedAtUtc=clock().toISOString();
  const tables:Record<string,{count:number;sha256:string}>={};
  const content:Record<string,string>={};
  for(const [index, table] of YOEL_TABLES.entries()){
    const records:InputRecord[]=[];const ids=new Set<string>();
    for await(const record of options.read(table)){
      if(!record.id || !/^rec[A-Za-z0-9]{14}$/.test(record.id) || ids.has(record.id)) throw new Error('SOURCE_ID_INVALID_OR_DUPLICATE');
      ids.add(record.id);records.push(record);
    }
    records.sort((a,b)=>a.id!.localeCompare(b.id!));
    const file=`table-${index+1}.json`;content[file]=JSON.stringify({table,records},null,2)+'\n';
    tables[table]={count:records.length,sha256:sha(content[file]!)};
  }
  const receivedAtUtc=clock().toISOString();
  if(Date.parse(receivedAtUtc)<Date.parse(startedAtUtc))throw new Error('CLOCK_REVERSED');
  const root=resolve(options.root);mkdirSync(root,{recursive:true});
  const destination=join(root,options.runId);
  // Exclusive directory creation prevents both overwrite and concurrent reuse. A crash leaves
  // an incomplete directory without a manifest; it is never treated as a complete capture.
  mkdirSync(destination);
  for(const [file,data] of Object.entries(content))writeFileSync(join(destination,file),data,{flag:'wx',mode:0o600});
  const manifest=JSON.stringify({version:'42B-source-v1',baseId:options.baseId,startedAtUtc,receivedAtUtc,tables,
    note:'Captura actual de Airtable; no acredita recepción histórica de velas.'},null,2)+'\n';
  writeFileSync(join(destination,'manifest.json'),manifest,{flag:'wx',mode:0o600});
  return {receivedAtUtc,tables};
}

export function airtableYoelReader(baseId:string,token:string):TableReader {
  return table=>airtableRecords({baseId,token,table,maxRecords:5000});
}
