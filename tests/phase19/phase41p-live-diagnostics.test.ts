import {afterEach,describe,expect,it} from 'vitest';
import Fastify from 'fastify';
import {createHash} from 'node:crypto';
import {appendFileSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {registerLiveDiagnostics} from '../../apps/api/src/radar/live-diagnostics.ts';
import {saveMarketCalendar} from '../../trading_poc_001_bollinger/src/alpaca-calendar.ts';
import {classifyPaperConnectivity,paperDiagnostic,readPaperDiagnostic,writePaperDiagnostic}
  from '../../apps/ibkr-agent/src/connection/paper-diagnostic.ts';

const dirs:string[]=[];
afterEach(()=>{for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
const directory=()=>{const dir=mkdtempSync(join(tmpdir(),'phase41p-api-'));dirs.push(dir);return dir;};
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
function makeLiveLedger(path:string){
  let previousHash:string|null=null;
  const append=(input:Record<string,unknown>)=>{
    const unsigned={schema:'phase38-iex-v1' as const,id:sha(JSON.stringify(input)),previousHash,...input};
    const recordHash=sha(JSON.stringify(unsigned));
    appendFileSync(path,JSON.stringify({...unsigned,recordHash})+'\n');previousHash=recordHash;
  };
  const open=Date.parse('2026-10-27T13:30:00.000Z');
  append({kind:'status',feed:'iex',adjustment:'raw',symbol:'NVDA',eventAtUtc:null,
    receivedAtUtc:new Date(open).toISOString(),status:'SUBSCRIBED',bar:null,revision:null,
    sourceMessageHash:null,latencyMs:null});
  for(let i=0;i<21;i++){
    const start=open+i*900_000,end=start+900_000,price=100+i;
    append({kind:'quarter',feed:'iex',adjustment:'raw',symbol:'NVDA',eventAtUtc:new Date(end).toISOString(),
      receivedAtUtc:new Date(end+1000).toISOString(),status:'COMPLETE',revision:1,
      sourceMessageHash:sha(`source-${i}`),latencyMs:1000,bar:{startUtc:new Date(start).toISOString(),
        endUtc:new Date(end).toISOString(),open:price,high:price+1,low:price-1,close:price,volume:1000,tradeCount:50}});
  }
  return {now:open+21*900_000+20_000,appendStatus:(receivedAtUtc:string,status='SUBSCRIBED')=>append({
    kind:'status',feed:'iex',adjustment:'raw',symbol:'NVDA',eventAtUtc:null,receivedAtUtc,status,
    bar:null,revision:null,sourceMessageHash:null,latencyMs:null})};
}

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
  it('recolector inactivo invalida actualidad pero conserva la vela e indicadores; al reactivar vuelve a PARTIAL sin escrituras GET',async()=>{
    const dir=directory(),app=Fastify(),ledger=join(dir,'iex.jsonl'),calendarPath=join(dir,'calendar.json');
    const fixture=makeLiveLedger(ledger);let now=fixture.now;
    const calendar=new Map([['2026-10-27',{open:570,close:960}]]);
    const opportunities=join(dir,'opportunities.jsonl');
    saveMarketCalendar(calendarPath,calendar);
    let active=false;
    registerLiveDiagnostics(app,{mode:'PAPER',paths:{ledger,calendar:calendarPath,warmup:null,context:null,
      opportunities},clock:()=>now,collectorActive:()=>active,
      broker:()=>({connected:false,simulation:false})});
    try{
      const original=readFileSync(ledger,'utf8'),url='/api/v1/market/live-technical-context';
      const stopped=await app.inject({method:'GET',url});
      expect(stopped.statusCode).toBe(200);
      expect(stopped.json()).toMatchObject({state:'FEED_DISCONNECTED',collectorProcessStatus:'INACTIVE',
        collectorStatus:'SUBSCRIBED',close:120});
      expect(stopped.json().ageMinutes).toBeCloseTo(19_000/60_000);
      expect(stopped.json().continuity.indicators.timeframes['15m'].smas['20'].value).not.toBeNull();
      expect(stopped.json().continuity.live.collectorProcess).toBe('INACTIVE');
      expect(readFileSync(ledger,'utf8')).toBe(original);
      expect(()=>(readFileSync(opportunities,'utf8'))).toThrow();
      active=true;
      now+=1000;fixture.appendStatus(new Date(now).toISOString());
      const afterReconnect=readFileSync(ledger,'utf8');
      const reconnected=await app.inject({method:'GET',url});
      expect(reconnected.json()).toMatchObject({state:'PARTIAL',collectorProcessStatus:'ACTIVE',collectorStatus:'SUBSCRIBED'});
      expect(reconnected.json().close).toBe(120);
      expect(readFileSync(ledger,'utf8')).toBe(afterReconnect);
    }finally{await app.close();}
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
