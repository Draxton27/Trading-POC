import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {ObserverFailure,boundedCause} from './phase34-observer-errors.ts';
import type {FrozenPrediction} from './phase34-observer.ts';

const MAX_PYTHON_ERROR_OUTPUT_LENGTH=1_024;

/**
 * infer.py reports handled exceptions as one small JSON object on stdout.
 * Treat any other stdout as opaque subprocess output: it must never become a
 * diagnostic cause or reach a public status endpoint.
 */
export function pythonErrorFromStdout(stdout:string|Buffer|undefined):string|null{
  const value=typeof stdout==='string'?stdout:stdout?.toString('utf8')??'';
  if(value.length===0||value.length>MAX_PYTHON_ERROR_OUTPUT_LENGTH)return null;
  try{
    const parsed=JSON.parse(value.trim()) as unknown;
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return null;
    const record=parsed as Record<string,unknown>;
    if(Object.keys(record).length!==1||typeof record.error!=='string'||record.error.trim().length===0||record.error.length>MAX_PYTHON_ERROR_OUTPUT_LENGTH)return null;
    return record.error;
  }catch{return null;}
}

/** Runs only the frozen Fase 31 inference program. A nonzero exit is never a calendar error. */
export function runFrozenPython(modelPath:string,features:Record<string,number>,options:{root:string;python?:string;platform?:NodeJS.Platform;script?:string}):FrozenPrediction{
  const python=options.python??(process.platform==='win32'?'py':'python3');
  const platform=options.platform??process.platform;
  const launcher=platform==='win32'&&/^(py|py\.exe)$/i.test(python.replace(/^.*[\\/]/,''));
  const result=spawnSync(python,[...(launcher?['-3.12']:[]),options.script??resolve(options.root,'ml/phase31/infer.py')],
    {input:JSON.stringify({modelPath,features}),encoding:'utf8',timeout:90_000,maxBuffer:256*1024,windowsHide:true});
  if(result.error)throw new ObserverFailure('PYTHON_ERROR','No se pudo ejecutar Python.',{exitCode:result.status,signal:result.signal,cause:boundedCause(result.error.message),retryable:['ETIMEDOUT','EAGAIN','EBUSY'].includes((result.error as NodeJS.ErrnoException).code??'')});
  if(result.status!==0){
    const jsonError=pythonErrorFromStdout(result.stdout);
    if(jsonError)throw new ObserverFailure('PYTHON_ERROR','El proceso Python finalizo con error.',{exitCode:result.status,signal:result.signal,cause:boundedCause(jsonError),retryable:false});
  }
  if(result.status!==0)throw new ObserverFailure('PYTHON_ERROR','El proceso Python terminó con error.',{exitCode:result.status,signal:result.signal,cause:boundedCause(result.stderr),retryable:false});
  try{return JSON.parse(result.stdout) as FrozenPrediction;}
  catch{throw new ObserverFailure('PYTHON_ERROR','Python devolvió JSON inválido.',{exitCode:result.status,signal:result.signal,cause:'INVALID_JSON',retryable:false});}
}
