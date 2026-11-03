import {readFileSync,realpathSync,statSync} from 'node:fs';
import {extname,isAbsolute,relative,resolve} from 'node:path';
import {z} from 'zod';
import {parseCsvRows} from '../../../../trading_poc_001_bollinger/src/phase17-csv.ts';
import {DEFAULT_FIELDS,type FieldMap,type InputRecord} from './normalize.ts';

const airtableRecord=z.object({id:z.string().regex(/^rec[A-Za-z0-9]{14}$/),fields:z.record(z.string(),z.unknown())}).strict();
const airtablePage=z.object({records:z.array(airtableRecord).max(100),offset:z.string().min(1).max(500).optional()}).strict();
export type AirtableOptions={token?:string;baseId:string;table:string;fetchImpl?:typeof fetch;sleep?:(ms:number)=>Promise<void>;timeoutMs?:number;maxRecords?:number};
export class AirtableReadError extends Error{constructor(readonly code:string){super(code);}}
const bounded=(value:number|undefined,min:number,max:number,fallback:number)=>Number.isFinite(value)&&value!>=min&&value!<=max?value!:fallback;
async function boundedBody(response:Response,maxBytes=1024*1024){
  if(Number(response.headers.get('content-length')??0)>maxBytes)throw new AirtableReadError('RESPONSE_TOO_LARGE');
  if(!response.body)return '';
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let bytes=0;
  try{for(;;){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>maxBytes)throw new AirtableReadError('RESPONSE_TOO_LARGE');chunks.push(next.value);}}finally{reader.releaseLock();}
  return new TextDecoder().decode(Buffer.concat(chunks.map(x=>Buffer.from(x))));
}
export async function* airtableRecords(options:AirtableOptions):AsyncGenerator<InputRecord>{
  if(!options.token)throw new AirtableReadError('TOKEN_MISSING');
  if(!/^app[A-Za-z0-9]{14}$/.test(options.baseId)||!options.table||options.table.length>100)throw new AirtableReadError('CONFIG_INVALID');
  const fetchImpl=options.fetchImpl??fetch,sleep=options.sleep??(ms=>new Promise(done=>setTimeout(done,ms)));
  const timeoutMs=bounded(options.timeoutMs,1000,30000,10000),maxRecords=bounded(options.maxRecords,1,10000,10000);
  let offset:string|undefined,received=0;const seenOffsets=new Set<string>();
  do{
    const url=new URL(`https://api.airtable.com/v0/${options.baseId}/${encodeURIComponent(options.table)}`);url.searchParams.set('pageSize','100');if(offset)url.searchParams.set('offset',offset);
    let response:Response|undefined;
    for(let attempt=0;attempt<3;attempt++){
      try{response=await fetchImpl(url,{method:'GET',headers:{Authorization:`Bearer ${options.token}`,Accept:'application/json'},signal:AbortSignal.timeout(timeoutMs)});}
      catch(error){if(attempt===2)throw new AirtableReadError(error instanceof Error&&error.name==='TimeoutError'?'TIMEOUT':'NETWORK_ERROR');await sleep(1000*(attempt+1));continue;}
      if(response.status===429||response.status>=500){if(attempt===2)throw new AirtableReadError(response.status===429?'RATE_LIMITED':'SERVER_ERROR');await response.body?.cancel();await sleep(response.status===429?30000:1000*(attempt+1));continue;}
      break;
    }
    if(!response)throw new AirtableReadError('NETWORK_ERROR');
    if(response.status===401){await response.body?.cancel();throw new AirtableReadError('AUTH_INVALID');}
    if(response.status===403){await response.body?.cancel();throw new AirtableReadError('PERMISSION_DENIED');}
    if(!response.ok){await response.body?.cancel();throw new AirtableReadError('HTTP_ERROR');}
    let page:z.infer<typeof airtablePage>;
    try{page=airtablePage.parse(JSON.parse(await boundedBody(response)));}catch(error){if(error instanceof AirtableReadError)throw error;throw new AirtableReadError('INVALID_RESPONSE');}
    for(const record of page.records){if(received>=maxRecords)throw new AirtableReadError('RECORD_LIMIT');received++;yield record;}
    offset=page.offset;if(offset){if(seenOffsets.has(offset))throw new AirtableReadError('OFFSET_LOOP');seenOffsets.add(offset);await sleep(250);}
  }while(offset);
}
export function fieldMapFromJson(input:string|undefined):FieldMap{
  if(!input)return DEFAULT_FIELDS;
  let parsed:unknown;try{parsed=JSON.parse(input);}catch{throw new Error('FIELD_MAP_INVALID');}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('FIELD_MAP_INVALID');
  const entries=Object.entries(parsed);if(entries.some(([k,v])=>!Object.hasOwn(DEFAULT_FIELDS,k)||typeof v!=='string'||!v.trim()||v.length>100))throw new Error('FIELD_MAP_INVALID');
  return {...DEFAULT_FIELDS,...parsed};
}
export function readImportFile(path:string,privateDir:string):{source:'CSV'|'JSON';records:InputRecord[]}{
  const root=realpathSync(resolve(privateDir,'real-trades','imports'));
  const file=realpathSync(resolve(path));const rel=relative(root,file);
  if(rel.startsWith('..')||isAbsolute(rel)||rel==='')throw new Error('FILE_OUTSIDE_PRIVATE_IMPORTS');
  if(statSync(file).size>5*1024*1024)throw new Error('FILE_TOO_LARGE');
  const text=readFileSync(file,'utf8').replace(/^\uFEFF/,'');
  if(extname(file).toLowerCase()==='.csv'){
    let rows:string[][];try{rows=parseCsvRows(text);}catch{throw new Error('CSV_INVALID');}
    if(rows.length<2||rows.length>10001)throw new Error('CSV_INVALID');
    const [header,...body]=rows;if(!header||new Set(header).size!==header.length||header.some(x=>!x)||body.some(x=>x.length!==header.length))throw new Error('CSV_INVALID');
    return {source:'CSV',records:body.map(row=>({fields:Object.fromEntries(header.map((key,i)=>[key,row[i]]))}))};
  }
  if(extname(file).toLowerCase()==='.json'){
    let data:unknown;try{data=JSON.parse(text);}catch{throw new Error('JSON_INVALID');}
    if(!Array.isArray(data)||data.length>10000)throw new Error('JSON_INVALID');
    return {source:'JSON',records:data.map(item=>{
      if(item&&typeof item==='object'&&'fields' in item)return airtableRecord.parse(item);
      if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('JSON_INVALID');
      return {fields:item as Record<string,unknown>};
    })};
  }
  throw new Error('FILE_TYPE_UNSUPPORTED');
}
