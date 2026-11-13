import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'dotenv';
import {fetchYoelAlpacaHistory,type HistoryFrame} from './phase42b-alpaca.ts';

const repo=resolve(fileURLToPath(new URL('../..',import.meta.url))),envFile=join(repo,'.env.local');
const env={...(existsSync(envFile)?parse(readFileSync(envFile)):{}),...process.env};
async function main(){
  const a=process.argv.slice(2);
  if(a.length!==10||a[0]!=='--symbol'||a[2]!=='--frame'||a[4]!=='--start'||a[6]!=='--end'||a[8]!=='--run-id'||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(a[9]??''))throw Error('USAGE');
  const symbol=a[1]!,frame=a[3] as HistoryFrame,startUtc=a[5]!,endUtc=a[7]!,runId=a[9]!;
  const result=await fetchYoelAlpacaHistory({symbol,frame,startUtc,endUtc,apiKey:env.APCA_API_KEY_ID??'',secretKey:env.APCA_API_SECRET_KEY??''});
  const root=join(repo,'private','phase42b','alpaca');mkdirSync(root,{recursive:true});const destination=join(root,runId);mkdirSync(destination);
  const {pages,bars,...metadata}=result;
  for(const [i,page] of pages.entries())writeFileSync(join(destination,`page-${i+1}.json`),page.body,{flag:'wx',mode:0o600});
  writeFileSync(join(destination,'manifest.json'),JSON.stringify({...metadata,count:bars.length,pages:pages.map(({body:_,...p})=>p),
    session:'UNFILTERED',availability:'RETROSPECTIVE_RECEIPT_UNKNOWN',note:'RTH, ajustes point-in-time y continuidad requieren auditoría por calendario.'},null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:'HISTORICO_RETROSPECTIVO',symbol,frame,bars:bars.length,pages:pages.length}));
}
main().catch(error=>{console.error(`Fase 42B: ${error instanceof Error?error.message:'ERROR'}`);process.exitCode=1;});
