import {spawn} from 'node:child_process';
import {createConnection} from 'node:net';
import {realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertPortsFree,npmCli} from './dev.mjs';
import {ensureLocalAgentSecret,loadLocalEnvironment,redactedAccount,repoRoot,validPaperAccount} from './local-config.mjs';

const usage='Use npm run dev:paper, npm run dev:mock o npm run dev:offline.';
const mode=process.argv[2]?.toUpperCase();
if(!['PAPER','MOCK','OFFLINE'].includes(mode??''))throw new Error(usage);

const env=loadLocalEnvironment();
const agentRequired=mode!=='OFFLINE';
const ensured=agentRequired?ensureLocalAgentSecret():null;
const configured={...env,...(ensured?{TRADING_POC_AGENT_SECRET:ensured.secret}:{}),
  TRADING_POC_MODE:mode==='OFFLINE'?'OFFLINE':'PAPER',
  TRADING_POC_API_HOST:'127.0.0.1',TRADING_POC_AGENT_HOST:'127.0.0.1',
  TRADING_POC_BACKEND_AGENT_URL:`ws://127.0.0.1:${env.TRADING_POC_AGENT_PORT??'4301'}/agent/v1/connect`};
if(mode==='MOCK')configured.TRADING_POC_AGENT_MODE='MOCK';
if(mode==='PAPER')configured.TRADING_POC_AGENT_MODE='TWS';
if(!agentRequired)configured.TRADING_POC_DISABLE_AGENT='1';

function port(name,value){
  const parsed=Number(value);
  if(!Number.isInteger(parsed)||parsed<1||parsed>65535)throw new Error(`Puerto ${name} inválido: ${value}`);
  return parsed;
}
const ports={api:port('API',configured.TRADING_POC_API_PORT??'4300'),web:port('frontend',configured.TRADING_POC_WEB_PORT??'5173'),agent:port('agente',configured.TRADING_POC_AGENT_PORT??'4301')};
function clientId(value){
  const parsed=Number(value);
  if(!Number.isInteger(parsed)||parsed<0||parsed>2147483647)throw new Error(`IBKR_CLIENT_ID invÃ¡lido: ${value}`);
  return parsed;
}
if(mode==='PAPER'){
  if(!validPaperAccount(configured.IBKR_EXPECTED_PAPER_ACCOUNT))throw new Error('PAPER requiere IBKR_EXPECTED_PAPER_ACCOUNT con una cuenta Paper DU válida en .env.local. No se aceptan cuentas reales.');
  if(!['127.0.0.1','localhost'].includes(configured.IBKR_TWS_HOST??'127.0.0.1'))throw new Error('IBKR_TWS_HOST debe ser 127.0.0.1 o localhost.');
  port('TWS',configured.IBKR_TWS_PORT??'7497');clientId(configured.IBKR_CLIENT_ID??'119');
}

function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
async function waitHttp(url,label){
  const until=Date.now()+30000;
  while(Date.now()<until){
    try{const response=await fetch(url);if(response.ok)return;}catch{}
    await wait(200);
  }
  throw new Error(`${label} no respondió en 30 segundos: ${url}`);
}
async function waitTcp(portNumber,label){
  const until=Date.now()+30000;
  while(Date.now()<until){
    const reachable=await new Promise(resolve=>{const socket=createConnection({host:'127.0.0.1',port:portNumber});
      socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));});
    if(reachable)return;
    await wait(200);
  }
  throw new Error(`${label} no está disponible en 127.0.0.1:${portNumber}.`);
}
function ollamaStatus(){
  return new Promise(resolve=>{const socket=createConnection({host:'127.0.0.1',port:11434});
    socket.once('connect',()=>{socket.destroy();resolve('disponible');});socket.once('error',()=>resolve('no disponible'));});
}
function command(script){
  const cli=npmCli(configured),child=spawn(process.execPath,[cli,'run',script],{cwd:repoRoot,env:configured,stdio:'inherit',shell:false,windowsHide:true,detached:process.platform!=='win32'});
  return child;
}
async function stopTree(child){
  if(!child?.pid||child.exitCode!==null)return;
  if(process.platform==='win32'){
    await new Promise(resolve=>{const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});killer.once('close',resolve);killer.once('error',resolve);});
  }else{try{process.kill(-child.pid,'SIGTERM');}catch{child.kill('SIGTERM');}}
}
async function main(){
  await assertPortsFree({TRADING_POC_API_PORT:String(ports.api),TRADING_POC_WEB_PORT:String(ports.web),TRADING_POC_AGENT_PORT:String(ports.agent)});
  const children=[];let stopping=false;
  const stop=async(code=0)=>{if(stopping)return;stopping=true;await Promise.all(children.map(stopTree));process.exitCode=code;};
  const start=(script)=>{const child=command(script);children.push(child);child.once('error',error=>{console.error(`No se pudo iniciar ${script}: ${error.message}`);void stop(1);});child.once('close',(code,signal)=>{if(!stopping){console.error(`${script} terminó${signal?` por ${signal}`:` con código ${code}`}.`);void stop(code&&code!==0?code:1);}});return child;};
  const interrupt=()=>void stop(0);process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
  try{
    start('dev:api');await waitHttp(`http://127.0.0.1:${ports.api}/api/v1/health`,'Fastify');
    if(agentRequired){await waitTcp(ports.agent,'WebSocket del agente');start('dev:agent');}
    start('dev:web');await waitHttp(`http://127.0.0.1:${ports.web}/`,'Frontend');
    const ollama=await ollamaStatus();
    console.log(`\nTrading-POC: ${mode==='MOCK'?'PAPER (agente simulado)':mode}`);
    console.log(`API: ${ports.api}\nFrontend: ${ports.web}\nAgente: ${agentRequired?ports.agent:'deshabilitado'}\nOllama: ${ollama}`);
    console.log(`TWS: ${mode==='PAPER'?'pendiente de conexión':'no requerido'}\nCuenta Paper: ${mode==='PAPER'?`configurada (${redactedAccount(configured.IBKR_EXPECTED_PAPER_ACCOUNT)})`:'no requerida'}`);
    if(ensured?.created)console.log('Se creó .env.local con un secreto local persistente. No se mostró su valor.');
  }catch(error){console.error(error instanceof Error?error.message:String(error));await stop(1);}
}
if(process.argv[1]&&realpathSync(resolve(process.argv[1]))===realpathSync(fileURLToPath(import.meta.url)))await main();
