import {closeSync,mkdirSync,openSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {dirname} from 'node:path';

export function isIexProcessActive(path:string,probe:(pid:number)=>void=(pid)=>process.kill(pid,0)):boolean{
  try{const pid=Number(readFileSync(`${path}.process.lock`,'utf8').split(':')[0]);if(!Number.isSafeInteger(pid)||pid<=0)return false;probe(pid);return true;}
  catch(error){if((error as NodeJS.ErrnoException).code==='EPERM')return true;return false;}
}
/** Exclusive collector lock. Never terminates an existing process. */
export function acquireIexProcessLock(path:string,probe:(pid:number)=>void=(pid)=>process.kill(pid,0)):()=>void{
  mkdirSync(dirname(path),{recursive:true});const lock=`${path}.process.lock`,token=`${process.pid}:${randomUUID()}`;
  for(let attempt=0;attempt<2;attempt++){
    try{const fd=openSync(lock,'wx');try{writeFileSync(fd,token);}finally{closeSync(fd);}return()=>{try{if(readFileSync(lock,'utf8')===token)rmSync(lock,{force:true});}catch{}};}
    catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
      if(isIexProcessActive(path,probe))throw new Error('Ya existe un recolector IEX activo.');
      rmSync(lock,{force:true});
    }
  }
  throw new Error('No se pudo obtener el bloqueo IEX.');
}
