export default async function stopIsolatedDemo():Promise<void>{
  if(process.env.TRADING_POC_E2E_REUSE_DEMO==='1')return;
  const apiPort=Number(process.env.TRADING_POC_E2E_API_PORT??14300);
  const token=process.env.TRADING_POC_E2E_CONTROL_TOKEN;
  if(!token)throw new Error('Falta el token del launcher E2E.');
  const response=await fetch(`http://127.0.0.1:${apiPort+2}/stop`,{method:'POST',headers:{'x-e2e-token':token},signal:AbortSignal.timeout(30_000)});
  if(!response.ok||(await response.json() as {stopped?:boolean}).stopped!==true)throw new Error('El launcher E2E no confirmó la terminación.');
  for(const port of [apiPort,Number(process.env.TRADING_POC_E2E_WEB_PORT??15173)]){
    try{await fetch(`http://127.0.0.1:${port}/`,{signal:AbortSignal.timeout(1500)});throw new Error(`Puerto E2E ${port} sigue ocupado.`);}
    catch(error){if(error instanceof Error&&error.message.includes('sigue ocupado'))throw error;}
  }
}
