import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'dotenv';
import {fetchAlpacaCalendar,saveMarketCalendar} from './alpaca-calendar.ts';

const repo=resolve(fileURLToPath(new URL('../..',import.meta.url))),envFile=join(repo,'.env.local');
const env={...(existsSync(envFile)?parse(readFileSync(envFile)):{}),...process.env};
async function main(){
  const a=process.argv.slice(2);
  if(a.length!==6||a[0]!=='--start'||a[2]!=='--end'||a[4]!=='--run-id'||!/^\d{4}-\d{2}-\d{2}$/.test(a[1]??'')||
    !/^\d{4}-\d{2}-\d{2}$/.test(a[3]??'')||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(a[5]??''))throw Error('USAGE');
  const start=Date.parse(`${a[1]}T00:00:00Z`),end=Date.parse(`${a[3]}T00:00:00Z`);
  if(!Number.isFinite(start)||!Number.isFinite(end)||new Date(start).toISOString().slice(0,10)!==a[1]||
    new Date(end).toISOString().slice(0,10)!==a[3]||start>end||end-start>366*86400_000)throw Error('CALENDAR_RANGE_INVALID');
  const calendar=await fetchAlpacaCalendar({apiKey:env.APCA_API_KEY_ID??'',secretKey:env.APCA_API_SECRET_KEY??'',start:a[1]!,end:a[3]!});
  const root=join(repo,'private','phase42b','calendars');mkdirSync(root,{recursive:true});const dest=join(root,a[5]!);mkdirSync(dest);
  saveMarketCalendar(join(dest,'calendar.json'),calendar);
  console.log(JSON.stringify({status:'CALENDARIO_GUARDADO',sessions:calendar.size}));
}
main().catch(error=>{console.error(`Fase 42B: ${error instanceof Error?error.message:'ERROR'}`);process.exitCode=1;});
