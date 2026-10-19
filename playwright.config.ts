import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests/phase19-e2e',timeout:30000,workers:1,
  use:{baseURL:'http://127.0.0.1:5173',browserName:'chromium',launchOptions:process.platform==='linux'?{executablePath:'/usr/bin/chromium',args:['--no-sandbox']}:{}},
  webServer:{command:'npm run dev',url:'http://127.0.0.1:5173/',reuseExistingServer:!process.env.CI,timeout:60000}
});
