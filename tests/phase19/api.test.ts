import {afterEach,describe,it,expect} from 'vitest';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import Database from 'better-sqlite3';
import {createApp} from '../../apps/api/src/server.ts';
import {BROKER_COLUMNS} from '../../trading_poc_001_bollinger/src/phase17-broker.ts';

const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const fn of cleanup.splice(0))await fn();});
async function fixture(mode:'DEMO'|'OFFLINE'|'PAPER'='DEMO'){
  const dir=mkdtempSync(join(tmpdir(),'phase19-api-'));
  const result=await createApp({mode,privateDir:dir,phase17Private:join(dir,'phase17'),phase16Ledger:join(dir,'phase16'),dbPath:join(dir,'db.sqlite')});
  cleanup.push(async()=>{await result.app.close();rmSync(dir,{recursive:true,force:true});});return {...result,dir};
}
describe('API local y privacidad',()=>{
  it('sirve DEMO paginado con indicadores y 3 símbolos',async()=>{
    const {app}=await fixture();
    expect((await app.inject('/api/v1/health')).json().mode).toBe('DEMO');
    expect((await app.inject('/api/v1/market/symbols')).json().items.map((x:any)=>x.symbol)).toEqual(['NVDA','QQQ','SMH']);
    const bars=(await app.inject('/api/v1/market/bars?symbol=SMH&limit=15')).json();
    expect(bars.items).toHaveLength(15);expect(bars.source).toContain('sintético');
    const ind=(await app.inject('/api/v1/market/indicators?symbol=SMH&limit=15')).json();
    expect(ind.items).toHaveLength(15);expect(ind.items.at(-1).sma200).toBeTypeOf('number');
    expect((await app.inject('/api/v1/market/bars?symbol=BAD')).statusCode).toBe(400);
    expect((await app.inject('/api/v1/market/bars?symbol=NVDA&limit=1000')).statusCode).toBe(400);
  });
  it('rechaza órdenes y escrituras sin token u origen válido',async()=>{
    const {app,token}=await fixture();
    expect((await app.inject({method:'POST',url:'/api/v1/orders',headers:{'x-local-token':token}})).statusCode).toBe(404);
    expect((await app.inject({method:'POST',url:'/api/v1/market/drawings',payload:{}})).statusCode).toBe(403);
    expect((await app.inject({method:'GET',url:'/api/v1/health',headers:{origin:'https://malicioso.example'}})).statusCode).toBe(403);
    expect(app.printRoutes()).not.toMatch(/orders|cancelOrder|placeOrder/);
  });
  it('dibujo manual persiste separado y diario es append-only',async()=>{
    const {app,token,dir}=await fixture();const headers={'x-local-token':token,origin:'http://127.0.0.1:5173'};
    const drawing={symbol:'NVDA',timeframe:'15m',kind:'support',price:210,author:'test sintético'};
    expect((await app.inject({method:'POST',url:'/api/v1/market/drawings',headers,payload:drawing})).statusCode).toBe(201);
    expect((await app.inject('/api/v1/market/drawings?symbol=NVDA')).json().items).toHaveLength(1);
    const now=new Date().toISOString(),decision={id:'synthetic-test-1',symbol:'NVDA',decisionAtUtc:now,documentedAtUtc:now,direction:'no_trade',reason:'Solo prueba sintética',recordMode:'historical_reconstruction'};
    const request={method:'POST' as const,url:'/api/v1/journal/decisions',headers,payload:decision};
    expect((await app.inject(request)).statusCode).toBe(201);
    expect((await app.inject(request)).statusCode).toBe(201);
    expect((await app.inject({...request,payload:{...decision,reason:'Cambio'}})).statusCode).toBe(409);
    expect((await app.inject('/api/v1/journal')).json().items).toHaveLength(1);
    const raw=readFileSync(join(dir,'phase19-journal','00000001.json'),'utf8');
    expect(raw).toContain('previousHash');
  });
  it('importa CSV privado de Fase 17 de manera idempotente',async()=>{
    const {app,token,dir}=await fixture();const headers={'x-local-token':token,origin:'http://127.0.0.1:5173'};
    const row='E1,NVDA,NVDA  261120C00150000,CALL,150,2026-11-20,BUY,2026-10-18T10:00:00.000Z,2,1.50,1.00,';
    const csv=BROKER_COLUMNS.join(',')+'\n'+row+'\n';
    const request={method:'POST' as const,url:'/api/v1/trades/import',headers,payload:{fileName:'synthetic.csv',csv}};
    const first=await app.inject(request);expect(first.statusCode).toBe(200);
    expect(first.json().alreadyPresent).toBe(false);
    expect((await app.inject(request)).json().alreadyPresent).toBe(true);
    expect((await app.inject('/api/v1/trades')).json().items).toHaveLength(1);
    expect(readFileSync(join(dir,'phase17','broker-sources',first.json().sourceSha256+'.json'),'utf8')).toContain('rawCsvBase64');
  });
  it('persiste sesión y cotización validadas sin cuenta cruda',async()=>{
    const {hub,dir}=await fixture('PAPER');
    class Socket extends EventEmitter{readyState=1;send(_value:string){}close(){this.readyState=3;this.emit('close');}}
    const socket=new Socket(),connectionId=crypto.randomUUID(),now=new Date().toISOString();
    const envelope=(kind:string,sequence:number,payload:Record<string,unknown>)=>({protocolVersion:1,messageId:crypto.randomUUID(),requestId:null,agentId:'synthetic-agent',connectionId,sequence,issuedAtUtc:now,kind,payload});
    hub.attach(socket);
    socket.emit('message',JSON.stringify(envelope('agent.hello',0,{environment:'PAPER',accountVerified:true,simulation:true,status:{feedType:'UNKNOWN'}})));
    socket.emit('message',JSON.stringify(envelope('market.quote',1,{symbol:'NVDA',bid:200,ask:200.1,last:200.05,marketTimestampUtc:null,receivedAtUtc:now,feedType:'DELAYED',provider:'IBKR'})));
    const db=new Database(join(dir,'db.sqlite'),{readonly:true});
    try{expect((db.prepare('SELECT count(*) AS n FROM agent_sessions').get() as any).n).toBe(1);
      expect((db.prepare('SELECT count(*) AS n FROM market_quotes').get() as any).n).toBe(1);
      expect(hub.status().feedType).toBe('DELAYED');expect(hub.status().simulation).toBe(true);
    }finally{db.close();}
  });
});
