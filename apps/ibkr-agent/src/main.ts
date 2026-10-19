import 'dotenv/config';
import {MockReadOnlyAdapter} from './connection/mock.ts';
import {TwsReadOnlyAdapter} from './connection/tws.ts';
import {AgentTransport} from './transport/client.ts';
import type {ReadOnlyBrokerAdapter} from './connection/adapter.ts';

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
  let backoff=1000;
  while(true){
    try{await adapter.connect();await transport.connect();backoff=1000;
      process.stdout.write('Agente '+mode+' conectado en modo de lectura.\n');
      while(transport.connected&&(await adapter.getStatus()).connected)await Promise.race([transport.waitUntilClosed(),new Promise(r=>setTimeout(r,5000))]);
    }catch(e){process.stderr.write('Agente desconectado: '+String(e)+'\n');}
    await transport.close();await adapter.disconnect();await new Promise(r=>setTimeout(r,backoff));backoff=Math.min(backoff*2,30000);
  }
}
main().catch(e=>{process.stderr.write(String(e)+'\n');process.exitCode=1;});
