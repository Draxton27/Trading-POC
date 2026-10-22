import {resolve} from 'node:path';

export type NewsPathOptions={repoRoot:string;newsDir?:string;privateDir?:string;env?:NodeJS.ProcessEnv;platform?:NodeJS.Platform;localAppData?:string};

/** Resolves local-only storage without depending on the current working directory. */
export function resolvePrivateDir({repoRoot,privateDir,env=process.env,platform=process.platform,localAppData=env.LOCALAPPDATA}:NewsPathOptions):string{
  if(privateDir)return resolve(privateDir);
  if(env.TRADING_POC_PRIVATE_DIR)return resolve(env.TRADING_POC_PRIVATE_DIR);
  return platform==='win32'&&localAppData?resolve(localAppData,'Trading-POC'):resolve(repoRoot,'private');
}

/** CLI and API intentionally share this exact default. No legacy directory is moved. */
export function resolveNewsDir(options:NewsPathOptions):string{
  const env=options.env??process.env;
  if(options.newsDir)return resolve(options.newsDir);
  if(env.TRADING_POC_NEWS_DIR)return resolve(env.TRADING_POC_NEWS_DIR);
  return resolve(resolvePrivateDir({...options,env}),'news');
}

export function newsPaths(options:NewsPathOptions){
  const base=resolveNewsDir(options);
  return {base,newsLog:resolve(base,'news.jsonl'),analysisLog:resolve(base,'analysis.jsonl'),statusPath:resolve(base,'status.json')};
}
