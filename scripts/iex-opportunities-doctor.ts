/** Offline, read-only audit of the IEX REST-to-Live bridge and 41O candidates. */
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {config as loadEnv} from 'dotenv';
import {resolvePrivateDir} from '../apps/api/src/news/paths.ts';
import {readIexLedger} from '../trading_poc_001_bollinger/src/phase38-iex.ts';
import {isIexProcessActive} from '../trading_poc_001_bollinger/src/phase38-iex-lock.ts';
import {loadMarketCalendar} from '../trading_poc_001_bollinger/src/alpaca-calendar.ts';
import {loadIexWarmup} from '../trading_poc_001_bollinger/src/phase38f-warmup.ts';
import {OpportunityStore} from '../trading_poc_001_bollinger/src/phase41o-ledger.ts';
import {diagnoseOpportunityContinuity,warmupAsRestContext} from '../trading_poc_001_bollinger/src/phase41p-continuity.ts';
import {loadIexRestContext} from '../trading_poc_001_bollinger/src/phase41p-rest-context.ts';
import {iexLedgerPath} from './iex-daily.ts';

const root=fileURLToPath(new URL('../',import.meta.url));
export async function opportunityDoctor(env:NodeJS.ProcessEnv=process.env,nowUtc=new Date().toISOString()){
  const base=resolvePrivateDir({repoRoot:root,env});
  const calendarPath=env.TRADING_POC_IEX_CALENDAR??resolve(base,'iex','calendar.json');
  const ledgerPath=iexLedgerPath(env);
  const opportunityPath=env.TRADING_POC_OPPORTUNITY_LEDGER??resolve(base,'radar','opportunities.jsonl');
  const registry=env.TRADING_POC_IEX_WARMUP_REGISTRY;
  const records=readIexLedger(ledgerPath),calendar=loadMarketCalendar(calendarPath);
  const warmup=registry&&existsSync(registry)?warmupAsRestContext(loadIexWarmup(registry)):null;
  const contextRegistry=env.TRADING_POC_IEX_OPPORTUNITY_CONTEXT_REGISTRY;
  const context=contextRegistry&&existsSync(contextRegistry)?loadIexRestContext(contextRegistry):null;
  const candidates=await new OpportunityStore(opportunityPath).read();
  return diagnoseOpportunityContinuity({records,calendar,rest:[warmup,context].filter(x=>x!==null),nowUtc,
    collectorActive:isIexProcessActive(ledgerPath),candidateRecords:candidates});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  loadEnv({path:resolve(root,'.env.local'),override:false,quiet:true});
  loadEnv({path:resolve(root,'.env'),override:false,quiet:true});
  if(process.argv.length!==2)throw new Error('Uso: npm.cmd run iex:opportunities:doctor');
  const report=await opportunityDoctor();
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}
