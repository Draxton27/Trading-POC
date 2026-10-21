import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const child=spawn(process.execPath,['--experimental-strip-types',resolve(root,'trading_poc_001_bollinger/src/phase34-collect-cli.ts'),...process.argv.slice(2)],{cwd:root,stdio:'inherit',windowsHide:true});
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
child.once('error',error=>{process.stderr.write(`${error.message}\n`);process.exitCode=1;});
child.once('close',code=>{process.exitCode=code??1;});
