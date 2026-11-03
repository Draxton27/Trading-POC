import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {config as loadDotenv} from 'dotenv';
import {openDatabase} from '../persistence/db.ts';
import {resolvePrivateDir} from '../news/paths.ts';
import {RealTradeImporter,realTradeDiagnostic} from './service.ts';
import {airtableRecords,fieldMapFromJson,readImportFile} from './sources.ts';

const repoRoot=fileURLToPath(new URL('../../../../',import.meta.url));
loadDotenv({path:resolve(repoRoot,'.env.local'),override:false,quiet:true});
loadDotenv({path:resolve(repoRoot,'.env'),override:false,quiet:true});
const privateDir=resolvePrivateDir({repoRoot,env:process.env});
const args=process.argv.slice(2),mode=args[0];
async function main(){
  if(!['status','airtable','file'].includes(mode??''))throw new Error('USAGE: real-trades:import -- status|airtable|file <private/real-trades/imports/file.csv|json> --confirm-real-primary');
  if(mode==='file'&&(args.length!==3||!args[1]||args[2]!=='--confirm-real-primary'))throw new Error('REAL_PRIMARY_CONFIRMATION_REQUIRED');
  if(mode!=='file'&&args.length!==1)throw new Error('ARGUMENTS_INVALID');
  const db=openDatabase(process.env.TRADING_POC_DB_PATH??resolve(privateDir,'trading-poc.sqlite'));
  try{
    if(mode==='status'){console.log(JSON.stringify(realTradeDiagnostic(db.sqlite,!!process.env.TRADING_POC_AIRTABLE_TOKEN)));return;}
    const mapping=fieldMapFromJson(process.env.TRADING_POC_AIRTABLE_FIELD_MAP_JSON);
    if(mode==='airtable'){
      const records=airtableRecords({token:process.env.TRADING_POC_AIRTABLE_TOKEN,baseId:process.env.TRADING_POC_AIRTABLE_BASE_ID??'',table:process.env.TRADING_POC_AIRTABLE_EXECUTIONS_TABLE??'Ejecuciones IBKR',timeoutMs:Number(process.env.TRADING_POC_AIRTABLE_TIMEOUT_MS??10000)});
      const result=await new RealTradeImporter(db.sqlite,'AIRTABLE',mapping).run(records);console.log(JSON.stringify(result));if(result.status!=='SUCCESS_COVERAGE_UNVERIFIED')process.exitCode=1;return;
    }
    const file=readImportFile(args[1]!,privateDir),result=await new RealTradeImporter(db.sqlite,file.source,mapping).run(file.records);
    console.log(JSON.stringify(result));if(result.status!=='SUCCESS_COVERAGE_UNVERIFIED')process.exitCode=1;
  }finally{db.sqlite.close();}
}
main().catch(error=>{const code=error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'IMPORT_FAILED';process.stderr.write(`${code}\n`);process.exitCode=1;});
