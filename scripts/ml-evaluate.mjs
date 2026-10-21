import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const child=spawn(process.execPath,[resolve(root,'node_modules/tsx/dist/cli.mjs'),resolve(root,'trading_poc_001_bollinger/src/phase35-cli.ts'),...process.argv.slice(2)],{cwd:root,stdio:'inherit',env:process.env,windowsHide:true});
child.once('error',error=>{console.error(error);process.exitCode=1;});child.once('close',code=>{process.exitCode=code??1;});
