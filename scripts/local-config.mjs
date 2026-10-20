import {randomBytes} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,chmodSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'dotenv';

export const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const localEnvPath=resolve(repoRoot,'.env.local');
const legacyEnvPath=resolve(repoRoot,'.env');

function readEnv(path){
  return existsSync(path)?parse(readFileSync(path)):{};
}

/** Loads the root files explicitly, independently from npm's working directory. */
export function loadLocalEnvironment(base=process.env,{legacyPath=legacyEnvPath,localPath=localEnvPath}={}){
  return {...readEnv(legacyPath),...readEnv(localPath),...base};
}

export function ensureLocalAgentSecret(path=localEnvPath){
  const existing=readEnv(path).TRADING_POC_AGENT_SECRET;
  if(existing)return {secret:existing,created:false,path};
  const secret=randomBytes(32).toString('base64url');
  const suffix=existsSync(path)&&readFileSync(path,'utf8').trim()?"\n":"";
  writeFileSync(path,`${suffix}TRADING_POC_AGENT_SECRET=${secret}\n`,{encoding:'utf8',flag:'a',mode:0o600});
  try{chmodSync(path,0o600);}catch{/* Windows ACLs and inherited local-directory permissions apply. */}
  return {secret,created:true,path};
}

export function redactedAccount(value){
  return value?`${value.slice(0,2)}${'•'.repeat(Math.max(0,value.length-4))}${value.slice(-2)}`:'no configurada';
}

export function validPaperAccount(value){
  return /^DU[A-Z0-9]{4,16}$/.test(value??'');
}
