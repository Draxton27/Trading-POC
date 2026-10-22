export default async function verifyIsolatedDemo():Promise<void>{
  const apiPort=Number(process.env.TRADING_POC_E2E_API_PORT??14300);
  const webPort=Number(process.env.TRADING_POC_E2E_WEB_PORT??15173);
  for(const [label,url] of [['API',`http://127.0.0.1:${apiPort}/api/v1/health`],
    ['proxy web',`http://127.0.0.1:${webPort}/api/v1/health`]]){
    // Vite can announce its own readiness before Fastify is listening. Wait for
    // the isolated DEMO health endpoint instead of racing the two child services.
    let response:Response|undefined;
    const deadline=Date.now()+30_000;
    while(Date.now()<deadline){
      try{const candidate=await fetch(url);if(candidate.ok){response=candidate;break;}}catch{}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(!response)throw new Error(`${label} E2E no estuvo disponible dentro de 30 segundos.`);
    if(!response.ok)throw new Error(`${label} E2E no respondió correctamente: HTTP ${response.status}`);
    const health=await response.json() as {mode?:string};
    if(health.mode!=='DEMO')throw new Error(`La suite E2E requiere DEMO aislado en ${label}; modo recibido: ${health.mode??'desconocido'}.`);
  }
}
