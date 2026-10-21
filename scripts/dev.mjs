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
  const services=[['API',env.TRADING_POC_API_PORT??'4300'],
    ['Vite',env.TRADING_POC_WEB_PORT??'5173']];
  if(env.TRADING_POC_AGENT_PORT!==undefined)services.push(['agente',env.TRADING_POC_AGENT_PORT]);
  for(const [label,value] of services){
    const port=Number(value);
    if(!Number.isInteger(port)||port<1||port>65535)throw new Error(`Puerto ${label} inválido: ${value}`);
    await new Promise((ok,fail)=>{
      const server=createServer();
      server.once('error',error=>fail(new Error(`Puerto ${label} ${port} no disponible: ${error.message}. Detenga el servicio anterior o elija otro puerto.`)));
      server.listen(port,'127.0.0.1',()=>server.close(ok));
    });
  }
}

export function startDev({names=scripts,env=process.env,spawnProcess=spawn,platform=process.platform}={}){
  const cli=npmCli(env);
  const children=[];
  let stopping=false,exitCode=0,remaining=0,pendingTerminators=0,finished=false;
  let onSignal;
  let resolveCompletion;
  const completion=new Promise(resolve=>{resolveCompletion=resolve;});
  const cleanup=()=>{
    if(onSignal){process.off('SIGINT',onSignal);process.off('SIGTERM',onSignal);}
  };
  const finish=()=>{
    if(finished||remaining!==0||pendingTerminators!==0)return;
    finished=true;
    process.exitCode=exitCode;
    cleanup();
    resolveCompletion(exitCode);
  };
  const terminateWindowsTree=child=>{
    pendingTerminators++;
    let settled=false;
    const settle=()=>{
      if(settled)return;
      settled=true;
      pendingTerminators--;
      finish();
    };
    let killer;
    try{
      killer=spawnProcess('taskkill.exe',['/PID',String(child.pid),'/T','/F'],
        {stdio:'ignore',windowsHide:true});
    }catch{
      child.kill();
      settle();
      return;
    }
    killer.once('error',()=>{child.kill();settle();});
    killer.once('close',code=>{if(code!==0)child.kill();settle();});
  };
  const stop=(code=0)=>{
    if(stopping)return completion;
    stopping=true;exitCode=code;
    for(const child of children){
      if(child.exitCode!==null||child.signalCode!==null||!child.pid)continue;
      if(platform==='win32'){
        // npm launches a shell for each script; terminate its entire process tree.
        terminateWindowsTree(child);
      }else{
        try{process.kill(-child.pid,'SIGTERM');}catch{child.kill('SIGTERM');}
      }
    }
    finish();
    return completion;
  };
  for(const name of names){
    let child;
    try{
      // On Windows, npm adds cmd.exe between the launcher and Vite. If a sibling
      // fails while that shell is starting, taskkill can miss the new Vite process.
      // Make the process that owns the listening socket a direct child instead.
      const directWeb=platform==='win32'&&name==='dev:web';
      child=spawnProcess(process.execPath,directWeb
        ?[resolve(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1']
        :[cli,'run',name],
        {cwd:directWeb?resolve(root,'apps/web'):root,stdio:'inherit',env:{...env},shell:false,windowsHide:true,
          detached:platform!=='win32'});
    }catch(error){console.error(`No se pudo iniciar ${name}:`,error);stop(1);break;}
    children.push(child);
    remaining++;
    child.on('error',error=>{console.error(`No se pudo iniciar ${name}:`,error);stop(1);});
    child.on('close',(code,signal)=>{
      remaining--;
      if(!stopping){
        console.error(`${name} terminó${signal?` por ${signal}`:` con código ${code}`}; deteniendo los servicios.`);
        stop(code&&code!==0?code:1);
      }
      finish();
    });
  }
  onSignal=()=>stop(0);
  process.on('SIGINT',onSignal);process.on('SIGTERM',onSignal);
  finish();
  return {children,stop,completion};
}

if(process.argv[1]&&realpathSync(resolve(process.argv[1]))===realpathSync(fileURLToPath(import.meta.url))){
  try{await assertPortsFree();startDev();}catch(error){console.error(error);process.exitCode=1;}
}
