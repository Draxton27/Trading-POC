import {spawn} from 'node:child_process';
import {accessSync,constants,realpathSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';

const scripts=['dev:api','dev:web'];
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));

export function npmCli(env=process.env,execPath=process.execPath){
  const candidates=[env.npm_execpath,resolve(dirname(execPath),'node_modules/npm/bin/npm-cli.js')];
  for(const candidate of candidates){
    if(!candidate)continue;
    try{accessSync(candidate,constants.R_OK);return candidate;}catch{}
  }
  throw new Error('No se encontró npm-cli.js. Ejecute mediante npm run dev o reinstale Node.js con npm.');
}

export async function assertPortsFree(env=process.env){
  for(const [label,value] of [['API',env.TRADING_POC_API_PORT??'4300'],
    ['Vite',env.TRADING_POC_WEB_PORT??'5173']]){
    const port=Number(value);
    if(!Number.isInteger(port)||port<1||port>65535)throw new Error(`Puerto ${label} inválido: ${value}`);
    await new Promise((ok,fail)=>{
      const server=createServer();
      server.once('error',error=>fail(new Error(`Puerto ${label} ${port} no disponible: ${error.message}. Detenga el servicio anterior o elija otro puerto.`)));
      server.listen(port,'127.0.0.1',()=>server.close(ok));
    });
  }
}

export function startDev({names=scripts,env=process.env,spawnProcess=spawn}={}){
  const cli=npmCli(env);
  const children=[];
  let stopping=false,exitCode=0,remaining=names.length;
  const stop=(code=0)=>{
    if(stopping)return;
    stopping=true;exitCode=code;
    for(const child of children){
      if(child.exitCode!==null||child.signalCode!==null||!child.pid)continue;
      if(process.platform==='win32'){
        // npm launches a shell for each script; terminate its entire process tree.
        const killer=spawnProcess('taskkill.exe',['/PID',String(child.pid),'/T','/F'],
          {stdio:'ignore',windowsHide:true});
        killer.on('error',()=>child.kill());
        killer.on('close',code=>{if(code!==0)child.kill();});
      }else{
        try{process.kill(-child.pid,'SIGTERM');}catch{child.kill('SIGTERM');}
      }
    }
  };
  for(const name of names){
    let child;
    try{
      child=spawnProcess(process.execPath,[cli,'run',name],
        {cwd:root,stdio:'inherit',env:{...env},shell:false,windowsHide:true,
          detached:process.platform!=='win32'});
    }catch(error){console.error(`No se pudo iniciar ${name}:`,error);remaining=children.length;stop(1);if(!remaining)process.exitCode=1;break;}
    children.push(child);
    child.on('error',error=>{console.error(`No se pudo iniciar ${name}:`,error);stop(1);});
    child.on('close',(code,signal)=>{
      remaining--;
      if(!stopping){
        console.error(`${name} terminó${signal?` por ${signal}`:` con código ${code}`}; deteniendo los servicios.`);
        stop(code&&code!==0?code:1);
      }
      if(remaining===0){process.exitCode=exitCode;cleanup();}
    });
  }
  const onSignal=()=>stop(0);
  const cleanup=()=>{process.off('SIGINT',onSignal);process.off('SIGTERM',onSignal);};
  process.on('SIGINT',onSignal);process.on('SIGTERM',onSignal);
  return {children,stop};
}

if(process.argv[1]&&realpathSync(resolve(process.argv[1]))===realpathSync(fileURLToPath(import.meta.url))){
  try{await assertPortsFree();startDev();}catch(error){console.error(error);process.exitCode=1;}
}
