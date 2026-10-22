import {config as loadEnv} from 'dotenv';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fetchAlpacaCalendar, loadMarketCalendar, mergeMarketCalendars, saveMarketCalendar} from './alpaca-calendar.ts';
import {collectIex} from './phase38-iex-stream.ts';
import {resolvePrivateDir} from '../../apps/api/src/news/paths.ts';
import {acquireIexProcessLock} from './phase38-iex-lock.ts';
import {appendIexStatus} from './phase38-iex.ts';

const root=fileURLToPath(new URL('../../',import.meta.url));
loadEnv({path:resolve(root,'.env.local'),override:false,quiet:true});
loadEnv({path:resolve(root,'.env'),override:false,quiet:true});
const args=process.argv.slice(2),probe=args.includes('--probe');
if(args.some(arg=>!['--once','--continuous','--probe'].includes(arg))||(args.includes('--continuous')&&args.includes('--once'))||(!probe&&!args.includes('--continuous')))throw new Error('Uso: iex:probe -- --once o iex:collect -- --continuous.');
const base=resolvePrivateDir({repoRoot:root});
const ledger=process.env.TRADING_POC_IEX_LEDGER??resolve(base,'iex','ledger.jsonl');
const calendarPath=process.env.TRADING_POC_IEX_CALENDAR??resolve(base,'iex','calendar.json');
const key=process.env.APCA_API_KEY_ID??'',secret=process.env.APCA_API_SECRET_KEY??'';

const release=acquireIexProcessLock(ledger);
const controller=new AbortController();
process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());
try{
  if(!key||!secret)throw new Error('Configurar APCA_API_KEY_ID y APCA_API_SECRET_KEY en .env.local.');
  const fetchCalendar=()=>{const today=new Date(),end=new Date(today.getTime()+7*24*60*60_000);return fetchAlpacaCalendar({apiKey:key,secretKey:secret,start:today.toISOString(),end:end.toISOString()});};
  const fresh=await fetchCalendar();
  const prior=!probe&&readable(calendarPath)?loadMarketCalendar(calendarPath):new Map();
  const calendar=mergeMarketCalendars(prior,fresh);
  if(!probe)saveMarketCalendar(calendarPath,calendar);
  let updating=false;
  const refresh=async()=>{
    if(updating||controller.signal.aborted)return;updating=true;
    try{const merged=mergeMarketCalendars(calendar,await fetchCalendar());saveMarketCalendar(calendarPath,merged);calendar.clear();for(const [day,hours] of merged)calendar.set(day,hours);}
    catch{appendIexStatus(ledger,'CALENDAR_UNAVAILABLE');controller.abort();process.exitCode=1;}
    finally{updating=false;}
  };
  const timer=probe?null:setInterval(()=>void refresh(),6*60*60_000);
  try{await collectIex({apiKey:key,secretKey:secret,calendar,ledgerPath:probe?undefined:ledger,probe,signal:controller.signal,onState:state=>{
    if(['AUTH_FAILED','CONNECTION_LIMIT','SUBSCRIPTION_FAILED'].includes(state))process.stderr.write(`IEX: ${state}\n`);
    else if(probe&&state==='SUBSCRIBED')process.stdout.write('IEX NVDA: autenticación y suscripción bars/updatedBars correctas.\n');
  }});}finally{if(timer)clearInterval(timer);}
}catch(error){process.stderr.write(`IEX: ${error instanceof Error?error.message:'Error controlado'}\n`);process.exitCode=1;}
finally{release();}
function readable(path:string){try{readFileSync(path,'utf8');return true;}catch{return false;}}
