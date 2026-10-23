import {spawnSync} from 'node:child_process';

const executable=process.env.PYTHON||'python';
const launcher=/^(py|py\.exe)$/i.test(executable.split(/[\\/]/).at(-1)||'');
const result=spawnSync(executable,[...(launcher&&process.platform==='win32'?['-3']:[]),'-m','ml.phase38b.replay',...process.argv.slice(2)],{stdio:'inherit',env:process.env});
if(result.error){process.stderr.write(`No se pudo iniciar Python: ${result.error.message}\n`);process.exitCode=1;}
else process.exitCode=result.status??1;
