import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {config as loadDotenv} from 'dotenv';
import {MockReadOnlyAdapter} from './connection/mock.ts';
import {TwsReadOnlyAdapter,TwsHandshakeError} from './connection/tws.ts';
import {paperDiagnostic,paperDiagnosticPath,writePaperDiagnostic,type PaperDiagnosticCode} from './connection/paper-diagnostic.ts';
import {AgentTransport} from './transport/client.ts';
import type {ReadOnlyBrokerAdapter} from './connection/adapter.ts';

const repoRoot=fileURLToPath(new URL('../../../',import.meta.url));
// Load the root configuration explicitly so `npm run dev:agent` behaves the
// same from every workspace directory. Environment variables remain higher
// priority for test isolation and one-off diagnostics.
loadDotenv({path:resolve(repoRoot,'.env.local'),override:false,quiet:true});
loadDotenv({path:resolve(repoRoot,'.env'),override:false,quiet:true});

async function main(){
  const mode=process.env.TRADING_POC_AGENT_MODE??'MOCK';
  if(!['MOCK','TWS'].includes(mode))throw new Error('Modo de agente inválido');
  const secret=process.env.TRADING_POC_AGENT_SECRET??'';
  if(!secret)throw new Error('Falta TRADING_POC_AGENT_SECRET');
  const adapter:ReadOnlyBrokerAdapter=mode==='MOCK'?new MockReadOnlyAdapter():new TwsReadOnlyAdapter({
    host:process.env.IBKR_TWS_HOST??'127.0.0.1',port:Number(process.env.IBKR_TWS_PORT??7497),
    clientId:Number(process.env.IBKR_CLIENT_ID??119),expectedPaperAccount:process.env.IBKR_EXPECTED_PAPER_ACCOUNT??'',aliasSecret:secret
  });
  const url=process.env.TRADING_POC_BACKEND_AGENT_URL??'ws://127.0.0.1:4301/agent/v1/connect';
  const transport=new AgentTransport(adapter,{url,agentId:process.env.TRADING_POC_AGENT_ID??'paper-agent-a',secret,simulation:mode==='MOCK'});
  const tws=mode==='TWS'?adapter as TwsReadOnlyAdapter:null,diagnosticPath=paperDiagnosticPath();
  const record=(code:PaperDiagnosticCode,connected=false)=>{if(!tws)return;
    try{writePaperDiagnostic(diagnosticPath,paperDiagnostic(code,tws.getHandshakeDiagnostic(),connected));}
    catch{process.stderr.write('No se pudo guardar el diagnóstico privado de TWS.\n');}};
  let backoff=1000;
  while(true){
    let stage:'TWS'|'BACKEND'|'READY'='TWS';
    try{await adapter.connect();record('TWS_ACCOUNT_VERIFIED');stage='BACKEND';
      await transport.connect();stage='READY';record('AGENT_READY',true);backoff=1000;
      process.stdout.write('Agente '+mode+' conectado en modo de lectura.\n');
      while(transport.connected&&(await adapter.getStatus()).connected)await Promise.race([transport.waitUntilClosed(),new Promise(r=>setTimeout(r,5000))]);
    }catch(e){const code:PaperDiagnosticCode=e instanceof TwsHandshakeError&&e.code!=='TWS_DISCONNECTED'?e.code:
      stage==='BACKEND'?'AGENT_BACKEND_DISCONNECTED':'UNKNOWN_CAUSE';
      record(code);process.stderr.write('Agente desconectado: '+code+'\n');}
    if(stage==='READY')record('AGENT_BACKEND_DISCONNECTED');
    await transport.close();await adapter.disconnect();await new Promise(r=>setTimeout(r,backoff));backoff=Math.min(backoff*2,30000);
  }
}
main().catch(e=>{process.stderr.write(String(e)+'\n');process.exitCode=1;});
