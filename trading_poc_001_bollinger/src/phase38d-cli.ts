import {config as loadEnv} from 'dotenv';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {downloadIexHistory} from './phase38d-iex-history.ts';

const root=fileURLToPath(new URL('../../',import.meta.url));
loadEnv({path:resolve(root,'.env.local'),override:false,quiet:true});
loadEnv({path:resolve(root,'.env'),override:false,quiet:true});
const args=process.argv.slice(2),allowed=new Set(['--start','--end','--out','--sip-csv']);
if(![6,8].includes(args.length)||args.some((arg,index)=>index%2===0&&!allowed.has(arg))||new Set(args.filter((_,index)=>index%2===0)).size!==args.length/2||
  ['--start','--end','--out'].some(key=>!args.includes(key)))
  throw new Error('Uso: npm run iex:history -- --start YYYY-MM-DD --end YYYY-MM-DD --out private/iex-history/run [--sip-csv ruta]');
const value=(key:string)=>args[args.indexOf(key)+1]!;
const start=value('--start'),end=value('--end'),out=resolve(root,value('--out'));
if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end))throw new Error('Fechas YYYY-MM-DD requeridas.');
const bases=[resolve(root,'private'),resolve(root,'trading_poc_001_bollinger/output/real')];
if(!bases.some(base=>{const suffix=relative(base,out);return suffix&&!suffix.startsWith('..')&&!isAbsolute(suffix);}))
  throw new Error('Salida IEX fuera de un directorio privado.');
const result=await downloadIexHistory({out,start:`${start}T00:00:00.000Z`,end:`${end}T00:00:00.000Z`,
  apiKey:process.env.APCA_API_KEY_ID??'',secretKey:process.env.APCA_API_SECRET_KEY??'',
  sipCsv:args.includes('--sip-csv')?resolve(root,value('--sip-csv')):undefined});
process.stdout.write(JSON.stringify({summary:result.summary,viability:result.viability,status:result.sipComparison.status})+'\n');
