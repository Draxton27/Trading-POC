import {spawnSync} from 'node:child_process';
import {existsSync,readdirSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const supplied=process.argv.slice(2);
const base=process.env.TRADING_POC_PHASE23_DATASET_DIR??join(root,'trading_poc_001_bollinger','output','real','phase23-ml-dataset');
function latestDataset(){
  if(!existsSync(base))return null;
  return readdirSync(base).map(name=>join(base,name)).filter(path=>statSync(path).isDirectory()&&existsSync(join(path,'dataset.csv'))&&existsSync(join(path,'metadata.json')))
    .sort().at(-1)??null;
}
const dataset=process.env.TRADING_POC_PHASE23_DATASET??latestDataset();
if(!dataset){
  console.error('No se encontro dataset Fase 23 local. Ejecute: npm.cmd run dataset:phase23 -w trading-poc-001-bollinger');
  process.exitCode=1;
}else{
  const python=process.env.PYTHON??(process.platform==='win32'?'py':'python3');
  // `py` is the Windows launcher; a venv executable must not receive `-3`.
  const isWindowsLauncher=process.platform==='win32'&&/^(py|py\.exe)$/i.test(python.replace(/^.*[\\/]/,''));
  const args=[...(isWindowsLauncher?['-3.12']:[]),'ml/phase28/train.py','--dataset',dataset,...supplied];
  const result=spawnSync(python,args,{cwd:root,stdio:'inherit'});
  if(result.error?.code==='ENOENT'){
    console.error('Python 3.12 de 64 bits no esta disponible. En Windows use: py -3.12 -m venv .venv\\phase28; .venv\\phase28\\Scripts\\python -m pip install --only-binary=:all: -r ml\\phase28\\requirements.txt');
    process.exitCode=1;
  }else process.exitCode=result.status??1;
}
