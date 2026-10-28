import {validPaperAccount} from './local-config.mjs';

/** One read-only Paper connection contract shared by launcher, agent and doctor. */
export function resolveIbkrConnection(env=process.env,application=env.TRADING_POC_IBKR_CONNECTION??'TWS_PAPER'){
  if(!['TWS_PAPER','GATEWAY_PAPER'].includes(application))throw new Error('TRADING_POC_IBKR_CONNECTION debe ser TWS_PAPER o GATEWAY_PAPER');
  const host=env.IBKR_TWS_HOST??'127.0.0.1';
  if(!['127.0.0.1','localhost'].includes(host))throw new Error('IBKR solo admite host loopback');
  const rawPort=application==='GATEWAY_PAPER'?env.IBKR_GATEWAY_PORT??'4002':env.IBKR_TWS_PORT??'7497';
  const port=Number(rawPort),clientId=Number(env.IBKR_CLIENT_ID??'119');
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Puerto IBKR Paper inválido');
  if(!Number.isInteger(clientId)||clientId<0||clientId>2147483647)throw new Error('IBKR_CLIENT_ID inválido');
  const expectedPaperAccount=env.IBKR_EXPECTED_PAPER_ACCOUNT??'';
  if(!validPaperAccount(expectedPaperAccount))throw new Error('IBKR_EXPECTED_PAPER_ACCOUNT debe ser una cuenta DU Paper válida');
  return {connectionApplication:application,host,port,clientId,expectedPaperAccount,environment:'PAPER'};
}
