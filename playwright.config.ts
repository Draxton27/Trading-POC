import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

const apiPort=Number(process.env.TRADING_POC_E2E_API_PORT??14300);
const webPort=Number(process.env.TRADING_POC_E2E_WEB_PORT??15173);
const privateDir=resolve(process.cwd(),'private',`playwright-${process.pid}`);
process.env.TRADING_POC_E2E_CONTROL_TOKEN=randomUUID();
const serverEnv={...process.env,TRADING_POC_MODE:'DEMO',TRADING_POC_API_PORT:String(apiPort),TRADING_POC_WEB_PORT:String(webPort),
  TRADING_POC_E2E_CONTROL_PORT:String(apiPort+2),
  TRADING_POC_PRIVATE_DIR:privateDir,TRADING_POC_DB_PATH:resolve(privateDir,'trading-poc.sqlite'),
  TRADING_POC_PHASE16_LEDGER:resolve(privateDir,'phase16-ledger'),TRADING_POC_PHASE17_PRIVATE_DIR:resolve(privateDir,'phase17'),
  TRADING_POC_AGENT_SECRET:'',TRADING_POC_DISABLE_AGENT:'1',TRADING_POC_AGENT_PORT:String(apiPort+1),
  // An empty value is treated as unset by PowerShell, allowing .env.local to leak a private run into DEMO.
  TRADING_POC_ML_RUN_DIR:resolve(privateDir,'missing-ml-run')};

export default defineConfig({
  testDir:'./tests/phase19-e2e',timeout:30000,workers:1,globalSetup:'./tests/phase19-e2e/demo-global-setup.ts',globalTeardown:'./tests/phase19-e2e/demo-global-teardown.ts',
  use:{baseURL:`http://127.0.0.1:${webPort}`,browserName:'chromium',launchOptions:process.env.TRADING_POC_CHROMIUM_PATH?
    {executablePath:process.env.TRADING_POC_CHROMIUM_PATH}:process.platform==='linux'?{executablePath:'/usr/bin/chromium',args:['--no-sandbox']}:{},
    trace:'retain-on-failure',screenshot:'only-on-failure'},
  // Start isolated DEMO services on dedicated ports; never inherit a running PAPER server.
  webServer:{command:'node scripts/e2e-server.mjs',url:`http://127.0.0.1:${webPort}/`,
    reuseExistingServer:process.env.TRADING_POC_E2E_REUSE_DEMO==='1',timeout:60000,env:serverEnv},
});
