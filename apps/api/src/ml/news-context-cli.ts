import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {config as loadDotenv} from 'dotenv';
import {newsPaths,resolvePrivateDir} from '../news/paths.ts';
import {loadMlRun} from './reader.ts';
import {buildNewsContext} from './news-context.ts';

const repoRoot=fileURLToPath(new URL('../../../../',import.meta.url));
loadDotenv({path:resolve(repoRoot,'.env.local'),override:false,quiet:true});
loadDotenv({path:resolve(repoRoot,'.env'),override:false,quiet:true});
if(process.argv.slice(2).join(' ')!=='--once'){
  process.stderr.write('Uso: npm run ml:news-context -- --once\n');process.exitCode=2;
}else{
  const privateDir=resolvePrivateDir({repoRoot,env:process.env}),run=loadMlRun(process.env.TRADING_POC_ML_RUN_DIR);
  if(run.status!=='READY'){process.stderr.write('Configure un modelo congelado válido en TRADING_POC_ML_RUN_DIR.\n');process.exitCode=1;}
  else try{
    const news=newsPaths({repoRoot,privateDir,env:process.env});
    const result=buildNewsContext({observationLog:process.env.TRADING_POC_ML_FORWARD_OBSERVATION_LOG??resolve(repoRoot,'private','ml-forward-observation','records.jsonl'),evaluationLog:process.env.TRADING_POC_ML_EVALUATION_LOG??resolve(repoRoot,'private','ml-evaluation','records.jsonl'),newsLog:news.newsLog,analysisLog:news.analysisLog,outputDir:process.env.TRADING_POC_ML_NEWS_CONTEXT_DIR??resolve(privateDir,'ml-news-context'),modelSha256:run.modelSha256});
    process.stdout.write(JSON.stringify({observations:result.summary.observations,evaluated:result.summary.evaluated,withNews:result.summary.withNews,sessions:result.summary.sessions,csvSha256:result.manifest.csvSha256})+'\n');
  }catch(error){process.stderr.write((error instanceof Error?error.message:'NEWS_CONTEXT_ERROR')+'\n');process.exitCode=1;}
}
