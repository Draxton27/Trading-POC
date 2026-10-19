export const TWS_REQUEST_MIN_MS=5000;
export const TWS_REQUEST_MAX_MS=15000;
export const HUB_OPTION_RESOLVE_MIN_MS=TWS_REQUEST_MAX_MS+5000;
export const HUB_OPTION_PARAMETERS_MIN_MS=2*TWS_REQUEST_MAX_MS+5000;

export function boundedMs(raw:string|undefined,fallback:number,min:number,max:number){
  if(raw===undefined||raw==='')return fallback;
  const value=Number(raw);
  if(!Number.isInteger(value))throw new Error(`Tiempo de espera inválido; indique un entero entre ${min} y ${max} ms`);
  return Math.max(min,Math.min(max,value));
}

export function agentRequestBudgets(env:NodeJS.ProcessEnv=process.env){
  return {
    ordinaryMs:5000,
    optionResolveMs:boundedMs(env.TRADING_POC_AGENT_OPTION_TIMEOUT_MS,20000,HUB_OPTION_RESOLVE_MIN_MS,30000),
    optionParametersMs:boundedMs(env.TRADING_POC_AGENT_PARAMETERS_TIMEOUT_MS,35000,HUB_OPTION_PARAMETERS_MIN_MS,45000),
    optionSubscribeMs:boundedMs(env.TRADING_POC_AGENT_SUBSCRIBE_TIMEOUT_MS,20000,HUB_OPTION_RESOLVE_MIN_MS,30000),
    optionPageMs:boundedMs(env.TRADING_POC_OPTION_PAGE_TIMEOUT_MS,60000,40000,120000)
  };
}

export function twsRequestBudgets(env:NodeJS.ProcessEnv=process.env){
  return {
    detailsMs:boundedMs(env.IBKR_CONTRACT_TIMEOUT_MS,10000,TWS_REQUEST_MIN_MS,TWS_REQUEST_MAX_MS),
    parametersMs:boundedMs(env.IBKR_OPTION_PARAMETERS_TIMEOUT_MS,10000,TWS_REQUEST_MIN_MS,TWS_REQUEST_MAX_MS)
  };
}
