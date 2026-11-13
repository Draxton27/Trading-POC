import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadMarketCalendar,type MarketCalendar} from './alpaca-calendar.ts';
import {stableQueueHash,type QueueItem} from './phase42b-queue.ts';
import {indexSchedules,indexSmaBeforeEntry,type IndexBar} from './phase42b-spx.ts';

const root=resolve(fileURLToPath(new URL('../..',import.meta.url)),'private','phase42b');
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
function main(){
  const a=process.argv.slice(2),keys=['--queue-run','--source-run','--calendar-old','--calendar-new','--run-id'];
  if(a.length!==10||keys.some((v,i)=>a[i*2]!==v)||![a[1],a[3],a[5],a[7],a[9]].every(v=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(v)))throw Error('USAGE');
  const q=JSON.parse(readFileSync(join(root,'queues',a[1]!,'queue.json'),'utf8')) as {queue:QueueItem[];queueSha256:string};
  if(!Array.isArray(q.queue)||stableQueueHash(q.queue)!==q.queueSha256)throw Error('QUEUE_INVALID');
  const c1=join(root,'calendars',a[5]!,'calendar.json'),c2=join(root,'calendars',a[7]!,'calendar.json');
  const old=loadMarketCalendar(c1),recent=loadMarketCalendar(c2),calendar:MarketCalendar=new Map(old);
  for(const [day,s] of recent){const previous=calendar.get(day);if(previous&&(previous.open!==s.open||previous.close!==s.close))throw Error('CALENDAR_CONFLICT');calendar.set(day,s);}
  const schedules=indexSchedules(calendar),source=join(root,'ibkr-spx',a[3]!),sources:Record<string,{sha256:string;receivedAtUtc:string;count:number;invalidStartsUtc:string[]}>={};
  const series:Record<string,IndexBar[]>={};
  for(const frame of ['ONE_MIN','FIVE_MINS','FIFTEEN_MINS','ONE_HOUR','ONE_DAY']){
    const bytes=readFileSync(join(source,`${frame}.json`));if(bytes.length>20*1024*1024)throw Error('SOURCE_TOO_LARGE');
    const doc=JSON.parse(bytes.toString('utf8')) as {version:string;symbol:string;contractId:number;exchange:string;securityType:string;frame:string;receivedAtUtc:string;
      data:{time:string[];open:number[];high:number[];low:number[];close:number[]}};
    if(doc.version!=='42B-ibkr-spx-v1'||doc.symbol!=='SPX'||doc.contractId!==416904||doc.exchange!=='CBOE'||doc.securityType!=='IND'||doc.frame!==frame||
      !Number.isFinite(Date.parse(doc.receivedAtUtc))||!Array.isArray(doc.data?.time)||
      !['open','high','low','close'].every(k=>Array.isArray(doc.data[k as keyof typeof doc.data])&&(doc.data[k as keyof typeof doc.data] as number[]).length===doc.data.time.length))throw Error('INDEX_SOURCE_INVALID');
    let prior=-Infinity;const invalidStartsUtc:string[]=[];series[frame]=doc.data.time.flatMap((v,i)=>{
      const t=Date.parse(v),o=doc.data.open[i]!,h=doc.data.high[i]!,l=doc.data.low[i]!,c=doc.data.close[i]!;
      if(!Number.isFinite(t)||t<=prior)throw Error('INDEX_TIME_INVALID');prior=t;
      if(![o,h,l,c].every(Number.isFinite)||l<=0||h<Math.max(o,l,c)||l>Math.min(o,c)){invalidStartsUtc.push(new Date(t).toISOString());return [];}
      return [{startUtc:new Date(t).toISOString(),close:c}];
    });
    sources[frame]={sha256:sha(bytes),receivedAtUtc:doc.receivedAtUtc,count:series[frame]!.length,invalidStartsUtc};
  }
  const outcomes=q.queue.filter(item=>item.symbol==='SPXW'||item.symbol==='SPX').map(item=>({sourceRecordId:item.sourceRecordId,
    sourceTradeIds:item.sourceTradeIds,status:'NO_VERIFICABLE',underlying:'SPX',intraday15m:'SIN_COBERTURA_VERIFICADA',
    hour:item.entryUtc?indexSmaBeforeEntry(series.ONE_HOUR!,schedules.hour,item.entryUtc):null,
    day:item.entryUtc?indexSmaBeforeEntry(series.ONE_DAY!,schedules.day,item.entryUtc):null,
    vwap:null,volume:null,limitations:['RECEPCION_HISTORICA_NO_VERIFICADA','VOLUMEN_INDICE_NO_DISPONIBLE','INTRADIA_FUERA_DE_COBERTURA']}));
  const parent=join(root,'spx-audits');mkdirSync(parent,{recursive:true});const dest=join(parent,a[9]!);mkdirSync(dest);
  writeFileSync(join(dest,'audit.json'),JSON.stringify({version:'42B-spx-audit-v1',queueSha256:q.queueSha256,sources,
    calendarHashes:[sha(readFileSync(c1)),sha(readFileSync(c2))],outcomes},null,2)+'\n',{flag:'wx',mode:0o600});
  const count=(frame:'hour'|'day',period:string)=>outcomes.filter(x=>x[frame]?.values?.[period]?.current!==null&&x[frame]?.values?.[period]?.current!==undefined).length;
  console.log(JSON.stringify({status:'SPX_RETROSPECTIVO',records:outcomes.length,hourSma200:count('hour','200'),daySma200:count('day','200')}));
}
try{main();}catch(error){console.error(`Fase 42B: ${error instanceof Error?error.message:'ERROR'}`);process.exitCode=1;}
