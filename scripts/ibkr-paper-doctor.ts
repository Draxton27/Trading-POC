/** Explicit read-only local connectivity diagnostic: no order, subscription or TWS API handshake. */
import {createConnection} from 'node:net';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {config as loadEnv} from 'dotenv';
import {classifyPaperConnectivity,paperDiagnosticPath,readPaperDiagnostic} from '../apps/ibkr-agent/src/connection/paper-diagnostic.ts';
import {validPaperAccount} from './local-config.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
export function probeLoopbackPort(port:number,timeoutMs=1500):Promise<boolean>{
  if(!Number.isInteger(port)||port<1||port>65535)return Promise.resolve(false);
  return new Promise(resolve=>{const socket=createConnection({host:'127.0.0.1',port});let done=false;
    const finish=(value:boolean)=>{if(done)return;done=true;socket.destroy();resolve(value);};
    socket.setTimeout(timeoutMs,()=>finish(false));socket.once('connect',()=>finish(true));
    socket.once('error',()=>finish(false));});
}
export async function diagnosePaper(env:NodeJS.ProcessEnv=process.env){
  const host=env.IBKR_TWS_HOST??'127.0.0.1',port=Number(env.IBKR_TWS_PORT??7497),
    configured=validPaperAccount(env.IBKR_EXPECTED_PAPER_ACCOUNT)&&['127.0.0.1','localhost'].includes(host)&&
      Number.isInteger(port)&&port>0&&port<=65535;
  const portReachable=configured?await probeLoopbackPort(port):null;
  let backendConnected=false,backendSimulation=false;
  const apiPort=Number(env.TRADING_POC_API_PORT??4300);
  if(Number.isInteger(apiPort)&&apiPort>0&&apiPort<=65535)try{
    const response=await fetch(`http://127.0.0.1:${apiPort}/api/v1/broker/status`,{signal:AbortSignal.timeout(2000)});
    if(response.ok){const row=await response.json() as {connected?:boolean;simulation?:boolean};
      backendConnected=row.connected===true;backendSimulation=row.simulation===true;}
  }catch{}
  let last=null;try{last=readPaperDiagnostic(paperDiagnosticPath(env));}catch{}
  const status=classifyPaperConnectivity({mode:'PAPER',configured,portReachable,processPresent:null,
    backendConnected,backendSimulation,last,now:Date.now()});
  return {schema:'phase41p-paper-readiness-v1',checkedAtUtc:new Date().toISOString(),
    code:status.code,reason:status.reason,hostLoopback:['127.0.0.1','localhost'].includes(host),
    portConfigured:Number.isInteger(port)&&port>0&&port<=65535,portReachable,
    clientIdConfigured:Number.isInteger(Number(env.IBKR_CLIENT_ID??119))&&Number(env.IBKR_CLIENT_ID??119)>=0,
    expectedPaperAccountConfigured:validPaperAccount(env.IBKR_EXPECTED_PAPER_ACCOUNT),
    backendConnected,backendSimulation,
    handshake:{socketConnected:last?.socketConnected??null,nextValidId:last?.nextValidId??null,
      managedAccounts:last?.managedAccounts??null,paperAccountVerified:last?.paperAccountVerified??null,
      ibkrCode:last?.ibkrCode??null,atUtc:last?.atUtc??null}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  loadEnv({path:resolve(root,'.env.local'),override:false,quiet:true});
  if(process.argv.length!==2)throw new Error('Uso: npm.cmd run ibkr:paper:doctor');
  process.stdout.write(JSON.stringify(await diagnosePaper(),null,2)+'\n');
}
