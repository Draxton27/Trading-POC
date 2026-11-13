import {createHash} from 'node:crypto';
import {mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadMarketCalendar} from './alpaca-calendar.ts';
import {stableQueueHash,type QueueItem} from './phase42b-queue.ts';
import {historicalBollinger15,historicalDailySma15,historicalHourlySma15,historicalSessionMinutes,type HistoricalBar} from './phase42b-retrospective.ts';
import {compareHypotheses} from './phase42b-hypotheses.ts';

const root=resolve(fileURLToPath(new URL('../..',import.meta.url)),'private','phase42b');
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
function load(dir:string,item:QueueItem,frame:string){
  const manifestBytes=readFileSync(join(dir,'manifest.json'));
  const m=JSON.parse(manifestBytes.toString('utf8')) as {symbol:string;frame:string;feed:string;adjustment:string;sourceRecordId:string;count:number;pages:{sha256:string}[]};
  if(m.symbol!==item.symbol||m.sourceRecordId!==item.sourceRecordId||m.frame!==frame||m.feed!=='sip'||m.adjustment!=='raw'||!Array.isArray(m.pages)||m.pages.length>500)throw Error('SOURCE_MANIFEST_INVALID');
  const bars:HistoricalBar[]=[];let previous=-Infinity;
  for(const [i,page] of m.pages.entries()){
    const raw=readFileSync(join(dir,`page-${i+1}.json`));if(sha(raw)!==page.sha256)throw Error('SOURCE_HASH_MISMATCH');
    const d=JSON.parse(raw.toString('utf8')) as {bars:Record<string,Record<string,unknown>[]>|null};
    for(const row of d.bars?.[m.symbol]??[]){
      const t=typeof row.t==='string'?Date.parse(row.t):NaN,nums=[row.o,row.h,row.l,row.c,row.v];
      if(!Number.isFinite(t)||t<=previous||nums.some(x=>typeof x!=='number'||!Number.isFinite(x))||
        (row.l as number)<=0||(row.v as number)<0||(row.h as number)<Math.max(row.o as number,row.c as number,row.l as number)||
        (row.l as number)>Math.min(row.o as number,row.c as number))throw Error('SOURCE_BAR_INVALID');
      previous=t;bars.push({timestamp:new Date(t).toISOString(),open:row.o as number,high:row.h as number,low:row.l as number,
        close:row.c as number,volume:row.v as number,providerVwap:typeof row.vw==='number'&&Number.isFinite(row.vw)&&row.vw>0?row.vw:null});
    }
  }
  if(bars.length!==m.count)throw Error('SOURCE_COUNT_MISMATCH');return {bars,manifestSha256:sha(manifestBytes)};
}
function main(){
  const a=process.argv.slice(2),keys=['--queue-run','--calendar-run','--run-id'];
  if(a.length!==6||keys.some((v,i)=>a[i*2]!==v)||![a[1],a[3],a[5]].every(v=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(v)))throw Error('USAGE');
  const q=JSON.parse(readFileSync(join(root,'queues',a[1]!,'queue.json'),'utf8')) as {queue:QueueItem[];queueSha256:string};
  if(!Array.isArray(q.queue)||stableQueueHash(q.queue)!==q.queueSha256)throw Error('QUEUE_INVALID');
  const calendarPath=join(root,'calendars',a[3]!,'calendar.json'),calendar=loadMarketCalendar(calendarPath);
  const parent=join(root,'batches'),found=new Map<string,string>();
  for(const d of readdirSync(parent,{withFileTypes:true}).filter(x=>x.isDirectory())){
    const path=join(parent,d.name,'batch.json'),batch=JSON.parse(readFileSync(path,'utf8')) as {version:string;queueSha256:string;results:{sourceRecordId:string;frames?:{frame:string;status:string}[]}[]};
    if(batch.version!=='42B-batch-v1'||batch.queueSha256!==q.queueSha256||!Array.isArray(batch.results))throw Error('BATCH_INVALID');
    for(const row of batch.results){if(found.has(row.sourceRecordId))throw Error('DUPLICATE_BATCH_SOURCE');found.set(row.sourceRecordId,d.name);}
  }
  const outcomes=q.queue.map(item=>{
    const base={sourceRecordId:item.sourceRecordId,sourceTradeIds:item.sourceTradeIds,sourceKey:item.sourceKey,status:'NO_VERIFICABLE',
      hypotheses:item.hypotheses,supportingEvidence:[],contradictingEvidence:[],laterEvolution:null};
    if(item.symbol==='SPX'||item.symbol==='SPXW')return {...base,reason:'INDICE_EN_AUDITORIA_SEPARADA'};
    if(!item.entryUtc||!item.entryLocal||!item.symbol)return {...base,reason:'IDENTIDAD_NO_RESUELTA'};
    const batch=found.get(item.sourceRecordId);if(!batch)return {...base,reason:'LOTE_NO_DISPONIBLE'};
    const dir=join(parent,batch);
    try{
      const minute=load(join(dir,`${item.sourceRecordId}-1Min`),item,'1Min'),m15=load(join(dir,`${item.sourceRecordId}-15Min`),item,'15Min');
      const intraday=historicalSessionMinutes(minute.bars,calendar,item.entryLocal),bb=historicalBollinger15(m15.bars,calendar,item.entryUtc),
        sma1h=historicalHourlySma15(m15.bars,calendar,item.entryUtc),sma1d=historicalDailySma15(m15.bars,calendar,item.entryUtc);
      const close=intraday.lastClose,point=bb.value;
      const bandPosition=close!==null&&point?.upper!==null&&point?.upper!==undefined&&point.lower!==null?
        close>point.upper?'POR_ENCIMA':close<point.lower?'POR_DEBAJO':'DENTRO':null;
      const comparisons=compareHypotheses({lastClose:close,vwap:intraday.vwap,bbUpper:point?.upper??null,bbLower:point?.lower??null,relative:{}});
      return {...base,reason:'RECEPCION_HISTORICA_NO_VERIFICADA',limitations:['AJUSTES_Y_EVENTOS_CORPORATIVOS_NO_VERIFICADOS'],sources:{minute:minute.manifestSha256,m15:m15.manifestSha256},
        observedConditional:{intraday,bb15:bb,sma1h,sma1d,bandPosition},comparisons};
    }catch(error){const code=error instanceof Error&&/^SOURCE_[A-Z_]+$/.test(error.message)?error.message:'FUENTE_O_INTEGRIDAD_NO_VERIFICABLE';return {...base,reason:code};}
  });
  const output=join(root,'batch-reconstructions');mkdirSync(output,{recursive:true});const dest=join(output,a[5]!);mkdirSync(dest);
  writeFileSync(join(dest,'report.json'),JSON.stringify({version:'42B-batch-reconstruction-v1',queueSha256:q.queueSha256,
    calendarSha256:sha(readFileSync(calendarPath)),outcomes},null,2)+'\n',{flag:'wx',mode:0o600});
  const conditional=outcomes.filter(x=>'observedConditional' in x).length;
  console.log(JSON.stringify({status:'RECONSTRUCCION_CONDICIONAL_NO_VERIFICADA',total:outcomes.length,conditional}));
}
try{main();}catch(error){console.error(`Fase 42B: ${error instanceof Error?error.message:'ERROR'}`);process.exitCode=1;}
