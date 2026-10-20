export default async function verifyIsolatedDemo():Promise<void>{
  const apiPort=Number(process.env.TRADING_POC_E2E_API_PORT??14300);
  const webPort=Number(process.env.TRADING_POC_E2E_WEB_PORT??15173);
  for(const [label,url] of [['API',`http://127.0.0.1:${apiPort}/api/v1/health`],
    ['proxy web',`http://127.0.0.1:${webPort}/api/v1/health`]]){
    const response=await fetch(url);
    if(!response.ok)throw new Error(`${label} E2E no respondió correctamente: HTTP ${response.status}`);
    const health=await response.json() as {mode?:string};
    if(health.mode!=='DEMO')throw new Error(`La suite E2E requiere DEMO aislado en ${label}; modo recibido: ${health.mode??'desconocido'}.`);
  }
}
