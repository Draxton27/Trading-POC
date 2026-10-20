import {describe,it,expect} from 'vitest';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// @ts-ignore - shared by the directly executable Node launcher.
import {ensureLocalAgentSecret,loadLocalEnvironment,validPaperAccount} from '../../scripts/local-config.mjs';

describe('configuraciÃ³n local persistente',()=>{
  it('crea un secreto de al menos 32 bytes una sola vez y lo reutiliza',()=>{
    const dir=mkdtempSync(join(tmpdir(),'trading-poc-local-config-'));
    const envFile=join(dir,'.env.local');
    try{
      const first=ensureLocalAgentSecret(envFile),saved=readFileSync(envFile,'utf8');
      const second=ensureLocalAgentSecret(envFile);
      expect(first.created).toBe(true);
      expect(Buffer.from(first.secret,'base64url').byteLength).toBeGreaterThanOrEqual(32);
      expect(second).toMatchObject({created:false,secret:first.secret});
      expect(readFileSync(envFile,'utf8')).toBe(saved);
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
  it('carga los archivos desde rutas explÃ­citas y preserva variables ya definidas',()=>{
    const dir=mkdtempSync(join(tmpdir(),'trading-poc-local-env-'));
    try{
      const legacy=join(dir,'.env'),local=join(dir,'.env.local');
      writeFileSync(legacy,'TRADING_POC_API_PORT=4300\nVALUE=legacy\n');
      writeFileSync(local,'TRADING_POC_API_PORT=4310\nVALUE=local\n');
      expect(loadLocalEnvironment({VALUE:'process'},{legacyPath:legacy,localPath:local}))
        .toMatchObject({TRADING_POC_API_PORT:'4310',VALUE:'process'});
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
  it('solo reconoce cuentas Paper DU',()=>{
    expect(validPaperAccount('DU123456')).toBe(true);
    expect(validPaperAccount('U123456')).toBe(false);
    expect(validPaperAccount('DU')).toBe(false);
  });
});
