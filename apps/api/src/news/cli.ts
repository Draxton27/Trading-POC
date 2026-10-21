import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {config as loadDotenv} from 'dotenv';
import {analyzeOnce,collectOnce} from './service.ts';

const root=fileURLToPath(new URL('../../../../',import.meta.url));
loadDotenv({path:resolve(root,'.env.local'),override:false,quiet:true});
loadDotenv({path:resolve(root,'.env'),override:false,quiet:true});
const [action,...args]=process.argv.slice(2);
if(!['collect','analyze'].includes(action??'')||args.length!==1||args[0]!=='--once'){
  process.stderr.write('Uso: news:collect -- --once o news:analyze -- --once\n');process.exitCode=2;
}else{
  const base=resolve(process.env.TRADING_POC_NEWS_DIR??resolve(root,'private','news'));
  const paths={newsLog:resolve(base,'news.jsonl'),analysisLog:resolve(base,'analysis.jsonl'),statusPath:resolve(base,'status.json')};
  try{
    if(action==='collect'){
      const result=await collectOnce(paths);process.stdout.write(JSON.stringify(result)+'\n');
      if(result.providers.every(row=>row.errorCode))process.exitCode=1;
    }else{
      const result=await analyzeOnce(paths);process.stdout.write(JSON.stringify(result)+'\n');
      if(Object.keys(result.errors).length)process.exitCode=1;
    }
  }catch(error){process.stderr.write((error instanceof Error?error.message:'NEWS_ERROR')+'\n');process.exitCode=1;}
}
