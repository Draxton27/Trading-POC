import {describe,expect,it} from 'vitest';
import {resolveIbkrConnection} from '../../scripts/ibkr-connection.mjs';
import {paperDiagnostic,readPaperDiagnostic,writePaperDiagnostic} from '../../apps/ibkr-agent/src/connection/paper-diagnostic.ts';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const base={IBKR_EXPECTED_PAPER_ACCOUNT:'DU123456',IBKR_TWS_HOST:'127.0.0.1',IBKR_CLIENT_ID:'119'} as NodeJS.ProcessEnv;
describe('41R: selección explícita de aplicación IBKR Paper',()=>{
  it('conserva TWS 7497 y Gateway 4002 aunque exista un puerto TWS legado',()=>{
    const env={...base,IBKR_TWS_PORT:'7497'};
    expect(resolveIbkrConnection(env)).toMatchObject({connectionApplication:'TWS_PAPER',port:7497,environment:'PAPER'});
    expect(resolveIbkrConnection(env,'GATEWAY_PAPER')).toMatchObject({connectionApplication:'GATEWAY_PAPER',port:4002,environment:'PAPER'});
  });
  it('respeta overrides por aplicación sin confundirlos',()=>{
    const env={...base,IBKR_TWS_PORT:'7498',IBKR_GATEWAY_PORT:'4003',TRADING_POC_IBKR_CONNECTION:'GATEWAY_PAPER'};
    expect(resolveIbkrConnection(env).port).toBe(4003);
    expect(resolveIbkrConnection(env,'TWS_PAPER').port).toBe(7498);
  });
  it('rechaza cuenta Live, host remoto, puertos y client ID inválidos',()=>{
    expect(()=>resolveIbkrConnection({...base,IBKR_EXPECTED_PAPER_ACCOUNT:'U123456'})).toThrow(/DU/);
    expect(()=>resolveIbkrConnection({...base,IBKR_TWS_HOST:'0.0.0.0'})).toThrow(/loopback/);
    expect(()=>resolveIbkrConnection({...base,IBKR_GATEWAY_PORT:'0'},'GATEWAY_PAPER')).toThrow(/Puerto/);
    expect(()=>resolveIbkrConnection({...base,IBKR_CLIENT_ID:'-1'})).toThrow(/CLIENT_ID/);
    expect(()=>resolveIbkrConnection(base,'LIVE')).toThrow(/TWS_PAPER/);
  });
  it('etiqueta diagnósticos nuevos por aplicación y admite los anteriores sin sobrescribirlos',()=>{
    const dir=mkdtempSync(join(tmpdir(),'phase41r-diagnostic-')),path=join(dir,'status.json');
    try{
      writePaperDiagnostic(path,paperDiagnostic('TWS_API_HANDSHAKE_TIMEOUT',undefined,false,
        ()=>new Date('2026-10-27T12:00:00Z').toISOString(),'GATEWAY_PAPER'));
      expect(readPaperDiagnostic(path)?.connectionApplication).toBe('GATEWAY_PAPER');
      writePaperDiagnostic(path,paperDiagnostic('TWS_ACCOUNT_MISMATCH'));
      expect(readPaperDiagnostic(path)?.connectionApplication).toBeUndefined();
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
});
