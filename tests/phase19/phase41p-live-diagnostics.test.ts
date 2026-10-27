import {afterEach,describe,expect,it} from 'vitest';
import Fastify from 'fastify';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {registerLiveDiagnostics} from '../../apps/api/src/radar/live-diagnostics.ts';
import {classifyPaperConnectivity,paperDiagnostic,readPaperDiagnostic,writePaperDiagnostic}
  from '../../apps/ibkr-agent/src/connection/paper-diagnostic.ts';

const dirs:string[]=[];
afterEach(()=>{for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
const directory=()=>{const dir=mkdtempSync(join(tmpdir(),'phase41p-api-'));dirs.push(dir);return dir;};

describe('41P diagnósticos locales de solo lectura',()=>{
  it('DEMO nunca abre IEX ni expone rutas privadas en los tres GET',async()=>{
    const dir=directory(),app=Fastify();
    registerLiveDiagnostics(app,{mode:'DEMO',paths:{ledger:join(dir,'iex.jsonl'),calendar:join(dir,'calendar.json'),
      warmup:null,context:null,opportunities:join(dir,'opportunities.jsonl')},
      broker:()=>({connected:false,simulation:true})});
    try{for(const url of ['/api/v1/ml/iex/continuity','/api/v1/market/live-technical-context',
      '/api/v1/radar/opportunities/diagnostics']){
      const result=await app.inject({method:'GET',url});
      expect(result.statusCode).toBe(200);expect(result.json()).toMatchObject({state:'DEMO'});
      expect(result.body).not.toContain(dir);
    }}finally{await app.close();}
  });
  it('OFFLINE con calendario ausente devuelve estado controlado sin intentar recuperación',async()=>{
    const dir=directory(),app=Fastify();
    registerLiveDiagnostics(app,{mode:'OFFLINE',paths:{ledger:join(dir,'iex.jsonl'),calendar:join(dir,'calendar.json'),
      warmup:null,context:null,opportunities:join(dir,'opportunities.jsonl')},
      broker:()=>({connected:false,simulation:false})});
    try{expect((await app.inject('/api/v1/ml/iex/continuity')).json()).toMatchObject({
      state:'INVALID_SOURCE',reason:'CALENDAR_UNAVAILABLE'});}finally{await app.close();}
  });
  it('diagnóstico Paper distingue puerto, handshake y cuenta sin guardar el identificador',()=>{
    const dir=directory(),path=join(dir,'paper.json');
    const at='2026-10-27T15:00:00.000Z',now=Date.parse(at);
    const handshake={code:'TWS_ACCOUNT_MISMATCH' as const,socketConnected:true,nextValidId:true,
      managedAccounts:true,paperAccountVerified:false,ibkrCode:null,atUtc:at};
    writePaperDiagnostic(path,paperDiagnostic('TWS_ACCOUNT_MISMATCH',handshake,false,()=>at));
    const last=readPaperDiagnostic(path);
    expect(last?.managedAccounts).toBe(true);
    expect(readFileSync(path,'utf8')).not.toMatch(/DU[A-Z0-9]{4,16}/);
    const base={mode:'PAPER' as const,configured:true,portReachable:true,processPresent:null,
      backendConnected:false,backendSimulation:false,last,now};
    expect(classifyPaperConnectivity(base).code).toBe('TWS_ACCOUNT_MISMATCH');
    expect(classifyPaperConnectivity({...base,portReachable:false}).code).toBe('TWS_PORT_NOT_REACHABLE');
    expect(classifyPaperConnectivity({...base,processPresent:false,portReachable:false}).code).toBe('TWS_PROCESS_NOT_AVAILABLE');
    expect(classifyPaperConnectivity({...base,last:paperDiagnostic('TWS_API_HANDSHAKE_TIMEOUT',
      {...handshake,nextValidId:false,managedAccounts:false},false,()=>at)}).code).toBe('TWS_API_HANDSHAKE_TIMEOUT');
    expect(classifyPaperConnectivity({...base,last:paperDiagnostic('TWS_ACCOUNT_VERIFIED',
      {...handshake,paperAccountVerified:true},false,()=>at)}).code).toBe('AGENT_BACKEND_DISCONNECTED');
    expect(classifyPaperConnectivity({...base,backendConnected:true,last:null}).code).toBe('AGENT_READY');
    expect(classifyPaperConnectivity({...base,last:null}).code).toBe('UNKNOWN_CAUSE');
  });
});
