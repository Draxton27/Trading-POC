import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'dotenv';
import {airtableYoelReader, captureYoelSources} from './phase42b-source.ts';

const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const envFile=resolve(root,'.env.local');
const local=existsSync(envFile)?parse(readFileSync(envFile)):{};
const env={...local,...process.env};
async function main(){
  const args=process.argv.slice(2);
  if(args.length!==2 || args[0]!=='--run-id')throw new Error('Uso: npm.cmd run research:42b:capture -- --run-id ID');
  const baseId=env.TRADING_POC_AIRTABLE_BASE_ID ?? 'appRLKun7tUrD1eI2';
  if(baseId!=='appRLKun7tUrD1eI2')throw new Error('BASE_AIRTABLE_INCORRECTA');
  const token=env.TRADING_POC_AIRTABLE_TOKEN;
  if(!token)throw new Error('TOKEN_AIRTABLE_NO_CONFIGURADO');
  const result=await captureYoelSources({root:resolve(root,'private','phase42b','sources'),runId:args[1]!,baseId,
    read:airtableYoelReader(baseId,token)});
  console.log(JSON.stringify({status:'CAPTURA_COMPLETA_SOLO_LECTURA',receivedAtUtc:result.receivedAtUtc,
    counts:Object.fromEntries(Object.entries(result.tables).map(([name,v])=>[name,v.count]))}));
}
main().catch(error=>{console.error(`Fase 42B: ${error instanceof Error?error.message:'ERROR'}`);process.exitCode=1;});
