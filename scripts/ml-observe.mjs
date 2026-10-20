import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const result=spawnSync(process.execPath,['--experimental-strip-types',resolve(root,'trading_poc_001_bollinger/src/phase34-cli.ts'),...process.argv.slice(2)],{cwd:root,stdio:'inherit'});
process.exitCode=result.status??1;
