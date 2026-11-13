import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadMarketCalendar} from './alpaca-calendar.ts';
import {auditSessionCoverage} from './phase42b-local-audit.ts';
import {stableQueueHash,type QueueItem} from './phase42b-queue.ts';
import type {Candle} from './domain.ts';

const root=resolve(fileURLToPath(new URL('../..',import.meta.url)),'private','phase42b');
const sha=(v:Buffer)=>createHash('sha256').update(v).digest('hex');
function main(){
  const a=process.argv.slice(2),keys=['--queue-run','--batch-run','--calendar-run','--run-id'];
  if(a.length!==8||keys.some((x,i)=>a[i*2]!==x)||![a[1],a[3],a[5],a[7]].every(x=>typeof x==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(x)))throw Error('USAGE');
  const q=JSON.parse(readFileSync(join(root,'queues',a[1]!,'queue.json'),'utf8')) as {queue:QueueItem[];queueSha256:string};
  if(!Array.isArray(q.queue)||stableQueueHash(q.queue)!==q.queueSha256)throw Error('QUEUE_INVALID');
  const batchRoot=join(root,'batches',a[3]!),batchBytes=readFileSync(join(batchRoot,'batch.json'));
  const batch=JSON.parse(batchBytes.toString('utf8')) as {version:string;queueSha256:string;results:{sourceRecordId:string;frames?:{frame:string;status:string}[]}[]};
  if(batch.version!=='42B-batch-v1'||batch.queueSha256!==q.queueSha256||!Array.isArray(batch.results))throw Error('BATCH_INVALID');
  const calendarPath=join(root,'calendars',a[5]!,'calendar.json'),calendar=loadMarketCalendar(calendarPath),findings:unknown[]=[];
  for(const item of batch.results){
    const found=q.queue.filter(v=>v.sourceRecordId===item.sourceRecordId);if(found.length!==1)throw Error('SOURCE_ID_INVALID');
    const frames:Record<string,unknown>={};
    for(const [frame,minute] of [['1Min',1],['5Min',5],['15Min',15]] as const){
      const f=item.frames?.find(x=>x.frame===frame);if(!f||!['RECUPERADO_RETROSPECTIVO','SIN_VELAS'].includes(f.status)){
        frames[frame]={status:'NO_VERIFICABLE',reason:'FUENTE_NO_DISPONIBLE'};continue;}
      const directory=join(batchRoot,`${item.sourceRecordId}-${frame}`),manifest=JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8')) as
        {symbol:string;frame:string;feed:string;adjustment:string;count:number;pages:{sha256:string}[]};
      if(manifest.symbol!==found[0]!.symbol||manifest.frame!==frame||manifest.feed!=='sip'||manifest.adjustment!=='raw'||!Array.isArray(manifest.pages)||manifest.pages.length>500)throw Error('MANIFEST_INVALID');
      const candles:Candle[]=[];
      for(const [i,page] of manifest.pages.entries()){
        const bytes=readFileSync(join(directory,`page-${i+1}.json`));if(sha(bytes)!==page.sha256)throw Error('PAGE_HASH_MISMATCH');
        const data=JSON.parse(bytes.toString('utf8')) as {bars:Record<string,Record<string,unknown>[]>|null};
        for(const b of data.bars?.[manifest.symbol]??[]){
          const time=typeof b.t==='string'?Date.parse(b.t):NaN,nums=[b.o,b.h,b.l,b.c,b.v];
          if(!Number.isFinite(time)||nums.some(x=>typeof x!=='number'||!Number.isFinite(x))||(b.l as number)<=0||(b.v as number)<0||
            (b.h as number)<Math.max(b.o as number,b.c as number,b.l as number)||(b.l as number)>Math.min(b.o as number,b.c as number))throw Error('BAR_INVALID');
          candles.push({timestamp:new Date(time).toISOString(),open:b.o as number,high:b.h as number,low:b.l as number,close:b.c as number,volume:b.v as number});
        }
      }
      if(candles.length!==manifest.count||candles.some((v,i)=>i>0&&v.timestamp<=candles[i-1]!.timestamp))throw Error('BAR_ORDER_OR_COUNT_INVALID');
      frames[frame]=auditSessionCoverage(found[0]!,candles,calendar,minute);
    }
    frames['1Hour']={status:'NO_VERIFICABLE',reason:'ALINEACION_HORARIA_Y_CONTINUIDAD_NO_AUDITADAS'};
    frames['1Day']={status:'NO_VERIFICABLE',reason:'HISTORIAL_INSUFICIENTE_PARA_SMA200_Y_AJUSTES_NO_VERIFICADOS'};
    findings.push({sourceRecordId:item.sourceRecordId,status:'NO_VERIFICABLE',frames});
  }
  const parent=join(root,'batch-audits');mkdirSync(parent,{recursive:true});const target=join(parent,a[7]!);mkdirSync(target);
  writeFileSync(join(target,'audit.json'),JSON.stringify({version:'42B-batch-audit-v1',queueSha256:q.queueSha256,batchSha256:sha(batchBytes),calendarSha256:sha(readFileSync(calendarPath)),findings},null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:'AUDITORIA_CON_LIMITACIONES',records:findings.length}));
}
try{main();}catch(error){console.error(`Fase 42B: ${error instanceof Error?error.message:'ERROR'}`);process.exitCode=1;}
