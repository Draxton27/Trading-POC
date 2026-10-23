import {config as loadEnv} from 'dotenv';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {registerIexWarmup} from './phase38f-warmup.ts';

const root=fileURLToPath(new URL('../../',import.meta.url));
loadEnv({path:resolve(root,'.env.local'),override:false,quiet:true});
const args=process.argv.slice(2);
if(args.length!==4||args[0]!=='--source'||args[2]!=='--out')throw new Error('Uso: npm run ml:iex:warmup -- --source <run 38D privado> --out <registro privado nuevo>');
const result=registerIexWarmup(resolve(args[1]!),resolve(args[3]!));
process.stdout.write(JSON.stringify(result)+'\n');
