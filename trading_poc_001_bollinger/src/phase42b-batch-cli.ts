import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'dotenv';
import {stableQueueHash,type QueueItem} from './phase42b-queue.ts';
import {fetchYoelAlpacaHistory,type HistoryFrame} from './phase42b-alpaca.ts';

const repo=resolve(fileURLToPath(new URL('../..',import.meta.url))),root=join(repo,'private','phase42b');
const envFile=join(repo,'.env.local'),env={...(existsSync(envFile)?parse(readFileSync(envFile)):{}),...process.env};
const plan:{frame:HistoryFrame;durationMs:number;lookbackMs:number}[]=[
  {frame:'1Min',durationMs:60_000,lookbackMs:2*86400_000},{frame:'5Min',durationMs:5*60_000,lookbackMs:7*86400_000},
  {frame:'15Min',durationMs:15*60_000,lookbackMs:30*86400_000},{frame:'1Hour',durationMs:3600_000,lookbackMs:30*86400_000},
  {frame:'1Day',durationMs:86400_000,lookbackMs:30*86400_000}];
async function main(){
  const a=process.argv.slice(2);
  const offset=a.length===8&&a[4]==='--offset'?Number(a[5]):0,runArg=a.length===8?6:4;
  if(![6,8].includes(a.length)||a[0]!=='--queue-run'||a[2]!=='--limit'||a[runArg]!=='--run-id'||
    (a.length===8&&(a[4]!=='--offset'||!/^\d{1,4}$/.test(a[5]??'')||offset>5000))||
    ![a[1],a[runArg+1]].every(x=>typeof x==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(x))||!/^([1-9]|10)$/.test(a[3]??''))throw Error('USAGE');
  const queue=JSON.parse(readFileSync(join(root,'queues',a[1]!,'queue.json'),'utf8')) as {version:string;queueSha256:string;queue:QueueItem[]};
  if(queue.version!=='42B-queue-v1'||!Array.isArray(queue.queue)||stableQueueHash(queue.queue)!==queue.queueSha256)throw Error('QUEUE_INVALID');
  const apiKey=env.APCA_API_KEY_ID??'',secretKey=env.APCA_API_SECRET_KEY??'';if(!apiKey||!secretKey)throw Error('ALPACA_AUTH_MISSING');
  const parent=join(root,'batches');mkdirSync(parent,{recursive:true});const destination=join(parent,a[runArg+1]!);mkdirSync(destination);
  const selected=queue.queue.slice(offset,offset+Number(a[3])),results:unknown[]=[];
  for(const item of selected){
    if(!item.symbol||!item.entryUtc||item.status==='IDENTITY_CONFLICT'||item.symbol==='SPXW'||item.symbol==='SPX'){
      results.push({sourceRecordId:item.sourceRecordId,status:'NO_VERIFICABLE',reason:'IDENTIDAD_O_INDICE_NO_RESUELTO'});continue;
    }
    const entry=Date.parse(item.entryUtc),frames:unknown[]=[];
    for(const p of plan){
      const end=entry-p.durationMs-1,start=end-p.lookbackMs;
      try{
        const result=await fetchYoelAlpacaHistory({symbol:item.symbol,frame:p.frame,startUtc:new Date(start).toISOString(),endUtc:new Date(end).toISOString(),apiKey,secretKey});
        const directory=join(destination,`${item.sourceRecordId}-${p.frame}`);mkdirSync(directory);
        for(const [i,page] of result.pages.entries())writeFileSync(join(directory,`page-${i+1}.json`),page.body,{flag:'wx',mode:0o600});
        const {pages,bars,...metadata}=result;
        writeFileSync(join(directory,'manifest.json'),JSON.stringify({...metadata,count:bars.length,pages:pages.map(({body:_,...v})=>v),
          sourceRecordId:item.sourceRecordId,entryUtc:item.entryUtc,session:'UNFILTERED',note:'Ventana acotada, cobertura y ajustes no verificados.'},null,2)+'\n',{flag:'wx',mode:0o600});
        frames.push({frame:p.frame,status:bars.length?'RECUPERADO_RETROSPECTIVO':'SIN_VELAS',count:bars.length});
      } catch(error){frames.push({frame:p.frame,status:'NO_VERIFICABLE',reason:error instanceof Error&&/^ALPACA_[A-Z_]+$/.test(error.message)?error.message:'HISTORIAL_NO_DISPONIBLE'});}
      await new Promise(done=>setTimeout(done,500));
    }
    results.push({sourceRecordId:item.sourceRecordId,sourceTradeIds:item.sourceTradeIds,status:'COBERTURA_NO_VERIFICADA',frames});
  }
  writeFileSync(join(destination,'batch.json'),JSON.stringify({version:'42B-batch-v1',queueSha256:queue.queueSha256,offset,results},null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:'LOTE_DESCARGADO_SIN_EVALUAR',offset,requested:selected.length}));
}
main().catch(error=>{console.error(`Fase 42B: ${error instanceof Error?error.message:'ERROR'}`);process.exitCode=1;});
