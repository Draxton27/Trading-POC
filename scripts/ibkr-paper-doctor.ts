/** Explicit read-only local connectivity diagnostic: no order, subscription or TWS API handshake. */
import {createConnection} from 'node:net';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {config as loadEnv} from 'dotenv';
import {classifyPaperConnectivity,paperDiagnosticPath,readPaperDiagnostic} from '../apps/ibkr-agent/src/connection/paper-diagnostic.ts';
import {validPaperAccount} from './local-config.mjs';
import {resolveIbkrConnection} from './ibkr-connection.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
export function probeLoopbackPort(port:number,timeoutMs=1500):Promise<boolean>{
  if(!Number.isInteger(port)||port<1||port>65535)return Promise.resolve(false);
  return new Promise(resolve=>{const socket=createConnection({host:'127.0.0.1',port});let done=false;
    const finish=(value:boolean)=>{if(done)return;done=true;socket.destroy();resolve(value);};
    socket.setTimeout(timeoutMs,()=>finish(false));socket.once('connect',()=>finish(true));
    socket.once('error',()=>finish(false));});
}
export async function diagnosePaper(env:NodeJS.ProcessEnv=process.env,application?:'TWS_PAPER'|'GATEWAY_PAPER'){
  let connection:ReturnType<typeof resolveIbkrConnection>|null=null,configurationError:string|null=null;
  try{connection=resolveIbkrConnection(env,application);}catch(error){configurationError=error instanceof Error?error.message:'Configuración inválida';}
  const host=connection?.host??env.IBKR_TWS_HOST??'127.0.0.1';
  const port=connection?.port??Number((application==='GATEWAY_PAPER'?env.IBKR_GATEWAY_PORT:env.IBKR_TWS_PORT)??
    (application==='GATEWAY_PAPER'?4002:7497));
  const configured=connection!==null;
  const portReachable=configured?await probeLoopbackPort(port):null;
  let backendConnected=false,backendSimulation=false;
  let feedType:'LIVE'|'DELAYED'|'UNKNOWN'='UNKNOWN';
  const apiPort=Number(env.TRADING_POC_API_PORT??4300);
  if(Number.isInteger(apiPort)&&apiPort>0&&apiPort<=65535)try{
    const response=await fetch(`http://127.0.0.1:${apiPort}/api/v1/broker/status`,{signal:AbortSignal.timeout(2000)});
    if(response.ok){const row=await response.json() as {connected?:boolean;simulation?:boolean;feedType?:string;
      connectionApplication?:string};
      backendConnected=row.connected===true&&row.connectionApplication===(connection?.connectionApplication??application??'TWS_PAPER');
      backendSimulation=row.simulation===true;
      feedType=row.feedType==='LIVE'?'LIVE':row.feedType==='DELAYED'?'DELAYED':'UNKNOWN';}
  }catch{}
  let last=null;try{last=readPaperDiagnostic(paperDiagnosticPath(env));}catch{}
  if(last&&((last.connectionApplication??'TWS_PAPER')!==(connection?.connectionApplication??application??'TWS_PAPER')))last=null;
  const status=classifyPaperConnectivity({mode:'PAPER',configured,portReachable,processPresent:null,
    backendConnected,backendSimulation,last,now:Date.now()});
  const code=!configured?'UNKNOWN_CAUSE':backendConnected&&!backendSimulation?'READY':
    portReachable===false?'APPLICATION_NOT_REACHABLE':
    last?.code==='TWS_ACCOUNT_MISMATCH'?'PAPER_ACCOUNT_MISMATCH':
    last?.code==='TWS_API_HANDSHAKE_TIMEOUT'?'API_HANDSHAKE_TIMEOUT':
    last?.code==='TWS_API_AUTHORIZATION_UNCONFIRMED'?'API_AUTHORIZATION_PENDING':
    last?.ibkrCode===10197?'SESSION_CONFLICT_REPORTED':
    last?.ibkrCode===354||last?.ibkrCode===10186||last?.ibkrCode===10091?'MARKET_DATA_PERMISSION_ERROR':
    last?.code==='AGENT_BACKEND_DISCONNECTED'?'BACKEND_DISCONNECTED':'UNKNOWN_CAUSE';
  return {schema:'phase41p-paper-readiness-v1',checkedAtUtc:new Date().toISOString(),
    code,legacyCode:status.code,reason:configurationError??status.reason,
    connectionApplication:connection?.connectionApplication??application??env.TRADING_POC_IBKR_CONNECTION??'TWS_PAPER',
    effectiveHost:host,effectivePort:port,hostLoopback:['127.0.0.1','localhost'].includes(host),
    portConfigured:Number.isInteger(port)&&port>0&&port<=65535,portReachable,
    clientIdConfigured:connection!==null,
    expectedPaperAccountConfigured:validPaperAccount(env.IBKR_EXPECTED_PAPER_ACCOUNT),
    backendConnected,backendSimulation,feedType,optionQuotesVerified:false,
    handshake:{socketConnected:last?.socketConnected??null,nextValidId:last?.nextValidId??null,
      managedAccounts:last?.managedAccounts??null,paperAccountVerified:last?.paperAccountVerified??null,
      ibkrCode:last?.ibkrCode??null,atUtc:last?.atUtc??null}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  loadEnv({path:resolve(root,'.env.local'),override:false,quiet:true});
  if(process.argv.length>3||process.argv[2]&&process.argv[2]!=='--gateway')throw new Error('Uso: npm.cmd run ibkr:paper:doctor o ibkr:gateway:doctor');
  process.stdout.write(JSON.stringify(await diagnosePaper(process.env,process.argv[2]==='--gateway'?'GATEWAY_PAPER':'TWS_PAPER'),null,2)+'\n');
}
