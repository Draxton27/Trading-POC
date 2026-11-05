import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {config as loadDotenv} from 'dotenv';
import {openDatabase} from '../persistence/db.ts';
import {resolvePrivateDir} from '../news/paths.ts';
import {importFlexFile} from './flex.ts';
import {rebuildSnapshot} from './reconciliation.ts';

const root=fileURLToPath(new URL('../../../../',import.meta.url));
loadDotenv({path:resolve(root,'.env.local'),override:false,quiet:true});
loadDotenv({path:resolve(root,'.env'),override:false,quiet:true});
const privateDir=resolvePrivateDir({repoRoot:root,env:process.env});
const args=process.argv.slice(2);
try{
  if(!((args[0]==='file'&&args.length===3&&args[2]==='--confirm-real-primary')||(args[0]==='rebuild'&&args.length===1)))throw Error('ARGUMENTS_INVALID');
  const db=openDatabase(process.env.TRADING_POC_DB_PATH??resolve(privateDir,'trading-poc.sqlite'));
  try{const result=args[0]==='file'?importFlexFile(db.sqlite,args[1]!,privateDir,process.env.TRADING_POC_REAL_ACCOUNT_ID??'',process.env.TRADING_POC_FLEX_TIMEZONE??''):rebuildSnapshot(db.sqlite);process.stdout.write(JSON.stringify(result)+'\n');}finally{db.sqlite.close();}
}catch(error){const code=error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'RECONCILIATION_FAILED';process.stderr.write(`${code}\n`);process.exitCode=1;}
