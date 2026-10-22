import {spawn,type ChildProcess} from 'node:child_process';
import {resolve} from 'node:path';
import {ObserverFailure,decodeObserverFailure,boundedCause} from './phase34-observer-errors.ts';

export function runObserverProcess(options:{root:string;env?:NodeJS.ProcessEnv;script?:string;timeoutMs?:number;onChild?:(child:ChildProcess|null)=>void}):Promise<{alreadyPresent:boolean}>{
  return new Promise((done,reject)=>{
    const command=options.script?[options.script,'--once']:['--experimental-strip-types',resolve(options.root,'trading_poc_001_bollinger/src/phase34-cli.ts'),'--once'];
    const child=spawn(process.execPath,command,
      {cwd:options.root,env:options.env??process.env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    options.onChild?.(child);
    let output='',errorOutput='',settled=false,timedOut=false,tooLarge=false;
    const finish=(error?:unknown,value?:{alreadyPresent:boolean})=>{if(settled)return;settled=true;clearTimeout(timeout);options.onChild?.(null);if(error)reject(error);else done(value!);};
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',(chunk:string)=>{output+=chunk;if(output.length>16_384){tooLarge=true;child.kill();}});
    child.stderr.on('data',(chunk:string)=>{errorOutput+=chunk;if(errorOutput.length>16_384){tooLarge=true;child.kill();}});
    const timeout=setTimeout(()=>{timedOut=true;child.kill();},options.timeoutMs??120_000);
    child.once('error',error=>finish(new ObserverFailure('ERROR','No se pudo iniciar el observador.',{cause:boundedCause(error.message),retryable:['EAGAIN','EBUSY'].includes((error as NodeJS.ErrnoException).code??'')})));
    child.once('close',(exitCode,signal)=>{
      if(timedOut)return finish(new ObserverFailure('ERROR','El observador agotó el tiempo máximo.',{exitCode,signal,cause:'OBSERVER_TIMEOUT',retryable:true}));
      if(tooLarge)return finish(new ObserverFailure('ERROR','Respuesta del observador demasiado grande.',{exitCode,signal,cause:'OBSERVER_OUTPUT_LIMIT',retryable:false}));
      if(exitCode!==0){const report=decodeObserverFailure(errorOutput);
        return finish(report?new ObserverFailure(report.code,'El observador rechazó la solicitud.',report):new ObserverFailure('ERROR','El observador terminó sin diagnóstico estructurado.',{exitCode,signal,cause:'OBSERVER_PROTOCOL_ERROR',retryable:false}));}
      try{const parsed=JSON.parse(output.trim().split(/\r?\n/).at(-1)!) as {alreadyPresent?:unknown};
        if(typeof parsed.alreadyPresent!=='boolean')throw new Error('invalid response');
        finish(undefined,{alreadyPresent:parsed.alreadyPresent});
      }catch{finish(new ObserverFailure('ERROR','El observador devolvió una respuesta inválida.',{exitCode,signal,cause:'OBSERVER_INVALID_RESPONSE',retryable:false}));}
    });
  });
}
