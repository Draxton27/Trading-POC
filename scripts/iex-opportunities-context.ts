import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {config as loadEnv} from 'dotenv';
import {resolvePrivateDir} from '../apps/api/src/news/paths.ts';
import {registerIexRestContext} from '../trading_poc_001_bollinger/src/phase41p-rest-context.ts';

const root=fileURLToPath(new URL('../',import.meta.url));
loadEnv({path:resolve(root,'.env.local'),override:false,quiet:true});
if(process.argv.length!==6||process.argv[2]!=='--source'||process.argv[4]!=='--out')
  throw new Error('Uso: npm.cmd run iex:opportunities:context -- --source <run 38D> --out <registro privado nuevo>');
const bases=[resolvePrivateDir({repoRoot:root}),resolve(root,'private')],source=resolve(process.argv[3]!),out=resolve(process.argv[5]!);
for(const path of [source,out]){
  if(!bases.some(base=>{const suffix=relative(base,path);return !!suffix&&!suffix.startsWith('..')&&!isAbsolute(suffix);}))
    throw new Error('Fuente y registro deben estar dentro de un directorio privado.');
}
mkdirSync(dirname(out),{recursive:true});
process.stdout.write(JSON.stringify(registerIexRestContext(source,out))+'\n');
