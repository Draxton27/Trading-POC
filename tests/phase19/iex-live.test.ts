import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {appendIexMinute,appendIexStatus,iexCoverage,parseIexMinute,readIexLedger} from '../../trading_poc_001_bollinger/src/phase38-iex.ts';
import {connectIex,collectIex,type SocketLike} from '../../trading_poc_001_bollinger/src/phase38-iex-stream.ts';
import {compareIexSip} from '../../trading_poc_001_bollinger/src/phase38-iex-compare.ts';
import {appendSuccessfulCapture,readIngestion} from '../../trading_poc_001_bollinger/src/phase32-ingestion.ts';
import type {MarketCalendar} from '../../trading_poc_001_bollinger/src/alpaca-calendar.ts';
import {saveMarketCalendar} from '../../trading_poc_001_bollinger/src/alpaca-calendar.ts';
import {readIexFeedStatus} from '../../apps/api/src/ml/iex.ts';
import {registerIexRoutes} from '../../apps/api/src/ml/iex.ts';
import Fastify from 'fastify';
import {acquireIexProcessLock,isIexProcessActive} from '../../trading_poc_001_bollinger/src/phase38-iex-lock.ts';

const dirs:string[]=[];
afterEach(()=>{for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
const paths=()=>{const dir=mkdtempSync(join(tmpdir(),'iex-test-'));dirs.push(dir);return {iex:join(dir,'iex','ledger.jsonl'),sip:join(dir,'sip.jsonl')};};
const calendar:MarketCalendar=new Map([['2026-10-20',{open:570,close:960}],['2026-10-21',{open:570,close:960}],['2026-11-27',{open:570,close:780}],['2026-03-06',{open:570,close:960}],['2026-03-09',{open:570,close:960}]]);
const raw=(at:string,close=101,T:'b'|'u'='b')=>({T,S:'NVDA',t:at,o:100,h:102,l:99,c:close,v:10,n:2});

class MockSocket implements SocketLike{
  listeners=new Map<string,((event:any)=>void)[]>();sent:string[]=[];
  send(data:string){this.sent.push(data);}close(){this.emit('close',{});}
  addEventListener(type:'open'|'message'|'close'|'error',listener:(event:any)=>void){this.listeners.set(type,[...(this.listeners.get(type)??[]),listener]);}
  emit(type:string,event:any){for(const listener of this.listeners.get(type)??[])listener(event);}
  message(value:unknown){this.emit('message',{data:JSON.stringify(value)});}
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

describe('Alpaca IEX aislado',()=>{
  it('autentica y se suscribe solo a NVDA sin persistir credenciales en probe',async()=>{
    const socket=new MockSocket(),run=connectIex({apiKey:'private-key',secretKey:'private-secret',calendar,probe:true,socketFactory:()=>socket});
    socket.emit('open',{});socket.message([{T:'success',msg:'connected'}]);
    expect(JSON.parse(socket.sent[0]!)).toEqual({action:'auth',key:'private-key',secret:'private-secret'});
    socket.message([{T:'success',msg:'authenticated'}]);
    expect(JSON.parse(socket.sent[1]!)).toEqual({action:'subscribe',bars:['NVDA'],updatedBars:['NVDA']});
    socket.message([{T:'subscription',bars:['NVDA'],updatedBars:['NVDA'],trades:[],quotes:[]}]);
    await expect(run).resolves.toBeUndefined();
  });
  it.each([[401,'AUTH_FAILED'],[406,'CONNECTION_LIMIT'],[409,'SUBSCRIPTION_FAILED']] as const)('clasifica error %i como %s',async(code,state)=>{
    const socket=new MockSocket(),run=connectIex({apiKey:'x',secretKey:'y',calendar,probe:true,socketFactory:()=>socket});
    socket.message([{T:'error',code,msg:'private server detail'}]);
    await expect(run).rejects.toMatchObject({state,message:state});
  });
  it('reconecta con backoff limitado tras desconexión, sin reintentar errores deterministas',async()=>{
    const sockets=[new MockSocket(),new MockSocket()];let count=0;
    const controller=new AbortController(),pauses:number[]=[];
    const run=collectIex({apiKey:'x',secretKey:'y',calendar,signal:controller.signal,socketFactory:()=>sockets[count++]!,pause:async ms=>{pauses.push(ms);},maxReconnects:1});
    sockets[0]!.emit('close',{});await tick();expect(pauses).toEqual([1000]);
    controller.abort();await expect(run).resolves.toBeUndefined();
  });
  it('cancela la espera de reconexión al cerrar el recolector administrado',async()=>{
    vi.useFakeTimers();
    try{
      const socket=new MockSocket(),controller=new AbortController();let attempts=0;
      const run=collectIex({apiKey:'x',secretKey:'y',calendar,signal:controller.signal,socketFactory:()=>{attempts++;return socket;}});
      socket.emit('close',{});await vi.advanceTimersByTimeAsync(0);
      controller.abort();await expect(run).resolves.toBeUndefined();
      expect(attempts).toBe(1);expect(vi.getTimerCount()).toBe(0);
    }finally{vi.useRealTimers();}
  });
  it('no desconecta una suscripción sana al vencer el timeout de autenticación',async()=>{
    vi.useFakeTimers();
    try{
      const socket=new MockSocket(),controller=new AbortController();
      const run=connectIex({apiKey:'x',secretKey:'y',calendar,signal:controller.signal,socketFactory:()=>socket});
      let settled=false;void run.then(()=>{settled=true;},()=>{settled=true;});
      socket.message([{T:'success',msg:'connected'}]);socket.message([{T:'success',msg:'authenticated'}]);
      socket.message([{T:'subscription',bars:['NVDA'],updatedBars:['NVDA'],trades:[],quotes:[]}]);
      await vi.advanceTimersByTimeAsync(13_000);expect(settled).toBe(false);
      controller.abort();await expect(run).resolves.toBeUndefined();
    }finally{vi.useRealTimers();}
  });
  it('exige minutos completos; revisiones no reescriben el primer agregado',()=>{
    const {iex}=paths(),start=Date.parse('2026-10-21T13:30:00Z'),received='2026-10-21T13:45:03.000Z';
    for(let index=0;index<14;index++)appendIexMinute(iex,parseIexMinute(raw(new Date(start+index*60_000).toISOString()),received,calendar),received,calendar);
    expect(readIexLedger(iex).filter(r=>r.kind==='quarter')).toHaveLength(0);
    appendIexMinute(iex,parseIexMinute(raw(new Date(start+14*60_000).toISOString()),received,calendar),received,calendar);
    expect(readIexLedger(iex).filter(r=>r.kind==='quarter')).toHaveLength(1);
    expect(appendIexMinute(iex,parseIexMinute(raw(new Date(start+14*60_000).toISOString()),received,calendar),received,calendar).minuteAdded).toBe(false);
    appendIexMinute(iex,parseIexMinute(raw(new Date(start+14*60_000).toISOString(),100,'u'),'2026-10-21T13:45:30.000Z',calendar),'2026-10-21T13:45:30.000Z',calendar);
    const quarters=readIexLedger(iex).filter(r=>r.kind==='quarter');expect(quarters.map(r=>r.revision)).toEqual([1,2]);expect(quarters[0]!.bar!.close).toBe(101);expect(quarters[1]!.bar!.close).toBe(100);
    expect(iexCoverage(readIexLedger(iex),calendar).minuteBars).toBe(15);
  });
  it('preserva revisión A-B-A, idempotencia e integridad del ledger',()=>{
    const {iex}=paths(),received='2026-10-21T13:31:02.000Z',at='2026-10-21T13:30:00.000Z';
    for(const close of [101,100,101])appendIexMinute(iex,parseIexMinute(raw(at,close),received,calendar),received,calendar);
    expect(readIexLedger(iex).map(r=>r.revision)).toEqual([1,2,3]);
    const text=readFileSync(iex,'utf8');writeFileSync(iex,text.replace('"close":100','"close":99'));
    expect(()=>readIexLedger(iex)).toThrow(/Integridad/);
  });
  it('acepta llegada fuera de orden sin adelantar el cierre de la ventana',()=>{
    const {iex}=paths(),start=Date.parse('2026-10-21T13:30:00Z'),received='2026-10-21T13:45:30.000Z';
    for(let index=14;index>=0;index--){const at=new Date(start+index*60_000).toISOString();appendIexMinute(iex,parseIexMinute(raw(at),received,calendar),received,calendar);}
    const quarters=readIexLedger(iex).filter(r=>r.kind==='quarter');
    expect(quarters).toHaveLength(1);expect(quarters[0]?.bar?.startUtc).toBe('2026-10-21T13:30:00.000Z');
  });
  it('rechaza OHLC inválido, latencia negativa/excesiva y no inventa minutos sin barras',()=>{
    expect(()=>parseIexMinute({...raw('2026-10-21T13:30:00Z'),h:1},'2026-10-21T13:31:00Z',calendar)).toThrow();
    expect(()=>parseIexMinute(raw('2026-10-21T13:30:00Z'),'2026-10-21T13:30:30Z',calendar)).toThrow(/Latencia/);
    expect(()=>parseIexMinute(raw('2026-10-21T13:30:00Z'),'2026-10-21T13:47:00Z',calendar)).toThrow(/Latencia/);
    expect(parseIexMinute(raw('2026-10-21T13:30:00Z'),'2026-10-21T13:31:00Z',calendar)?.bar.tradeCount).toBe(2);
    expect(parseIexMinute({...raw('2026-10-21T13:30:00Z'),v:0,n:0},'2026-10-21T13:31:00Z',calendar)?.bar.volume).toBe(0);
  });
  it('respeta cierre temprano y cambio EDT/EST del calendario oficial',()=>{
    expect(parseIexMinute(raw('2026-11-27T17:59:00Z'),'2026-11-27T18:00:00Z',calendar)).not.toBeNull();
    expect(parseIexMinute(raw('2026-11-27T18:00:00Z'),'2026-11-27T18:01:00Z',calendar)).toBeNull();
    expect(parseIexMinute(raw('2026-03-06T14:30:00Z'),'2026-03-06T14:31:00Z',calendar)).not.toBeNull();
    expect(parseIexMinute(raw('2026-03-09T13:30:00Z'),'2026-03-09T13:31:00Z',calendar)).not.toBeNull();
  });
  it('compara únicamente intervalos iguales y mantiene precio raw frente a split',()=>{
    const {iex,sip}=paths(),start=Date.parse('2026-10-21T13:30:00Z');
    for(let index=0;index<15;index++){
      const at=new Date(start+index*60_000).toISOString(),received=new Date(start+(index+1)*60_000+2000).toISOString();
      appendIexMinute(iex,parseIexMinute(raw(at),received,calendar),received,calendar);
    }
    appendSuccessfulCapture(sip,{candles:[{timestamp:new Date(start).toISOString(),open:100,high:102,low:99,close:101,volume:500}],queryAtUtc:'2026-10-21T14:10:00.000Z',receivedAtUtc:'2026-10-21T14:10:01.000Z',responseSha256:'x',availability:'DELAYED',barAgeMs:1500000});
    const result=compareIexSip(readIexLedger(iex),readIngestion(sip),calendar);
    expect(result).toMatchObject({matched:1,missingIex:null,missingSip:null,priceBasis:'IEX_RAW_VS_SIP_SPLIT_ADJUSTED',iexBars:1,sipBars:1,iexCoverage:null,monitoredPeriodCoverageIex:null});
    expect(result.meanTimeGainedMs).toBeGreaterThan(0);
  });
  it('does not count IEX absences before a late observation start',()=>{
    const {iex,sip}=paths();
    appendSuccessfulCapture(sip,{candles:[{timestamp:'2026-10-20T13:30:00.000Z',open:100,high:102,low:99,close:101,volume:500},{timestamp:'2026-10-21T13:30:00.000Z',open:100,high:102,low:99,close:101,volume:500}],queryAtUtc:'2026-10-22T00:00:00.000Z',receivedAtUtc:'2026-10-22T00:00:01.000Z',responseSha256:'x',availability:'DELAYED',barAgeMs:1_000});
    appendIexStatus(iex,'OBSERVATION_STARTED','2026-10-21T13:44:00.000Z');appendIexStatus(iex,'SUBSCRIBED','2026-10-21T13:45:00.000Z');appendIexStatus(iex,'DISCONNECTED','2026-10-21T14:00:00.000Z');appendIexStatus(iex,'OBSERVATION_ENDED','2026-10-21T14:01:00.000Z');
    const result=compareIexSip(readIexLedger(iex),readIngestion(sip),calendar,Date.parse('2026-10-22T00:00:00.000Z'));
    expect(result).toMatchObject({fullSessionsObserved:0,partiallyMonitoredSessions:1,unmonitoredSessions:1,monitoredPeriodExpectedIntervals:1,monitoredPeriodCoverageIex:0,missingIex:1,missingSip:1,missingSessionsIex:0,observationStartedAtUtc:'2026-10-21T13:44:00.000Z',observationEndedAtUtc:'2026-10-21T14:01:00.000Z'});
  });
  it('uses first receipts for initial latency and reports later revisions separately',()=>{
    const {iex,sip}=paths(),start=Date.parse('2026-10-21T13:30:00.000Z');
    for(let index=0;index<15;index++){const received=new Date(start+(index+1)*60_000+5_000).toISOString();appendIexMinute(iex,parseIexMinute(raw(new Date(start+index*60_000).toISOString()),received,calendar),received,calendar);}
    appendIexMinute(iex,parseIexMinute(raw(new Date(start+14*60_000).toISOString(),99,'u'),'2026-10-21T14:10:00.000Z',calendar),'2026-10-21T14:10:00.000Z',calendar);
    const original={timestamp:new Date(start).toISOString(),open:100,high:102,low:99,close:101,volume:500};
    appendSuccessfulCapture(sip,{candles:[original],queryAtUtc:'2026-10-21T14:10:00.000Z',receivedAtUtc:'2026-10-21T14:10:10.000Z',responseSha256:'a',availability:'DELAYED',barAgeMs:10});
    appendSuccessfulCapture(sip,{candles:[{...original,close:99}],queryAtUtc:'2026-10-21T14:20:00.000Z',receivedAtUtc:'2026-10-21T14:20:10.000Z',responseSha256:'b',availability:'DELAYED',barAgeMs:10});
    appendIexStatus(iex,'SUBSCRIBED','2026-10-21T13:30:00.000Z');appendIexStatus(iex,'DISCONNECTED','2026-10-21T14:21:00.000Z');
    const result=compareIexSip(readIexLedger(iex),readIngestion(sip),calendar);
    expect(result.iexRevisions).toBe(1);expect(result.sipRevisions).toBe(1);
    expect(result.meanIexLatencyMs).toBe(5_000);expect(result.meanSipLatencyMs).toBe(25*60_000+10_000);
    expect(result.meanIexCorrectionLatencyMs).toBe(25*60_000);expect(result.meanSipCorrectionLatencyMs).toBe(35*60_000+10_000);
    expect(result.meanTimeGainedMs).toBe(25*60_000+5_000);
  });
  it('marks a silent connection during market hours without disconnecting and ignores quiet after close',async()=>{
    vi.useFakeTimers();
    try{
      const time={now:Date.parse('2026-10-21T14:00:00Z')},socket=new MockSocket(),controller=new AbortController(),states:string[]=[];
      const active=connectIex({apiKey:'x',secretKey:'y',calendar,clock:()=>time.now,silenceThresholdMs:180_000,socketFactory:()=>socket,signal:controller.signal,onState:value=>states.push(value)});
      socket.emit('open',{});socket.message([{T:'success',msg:'connected'}]);socket.message([{T:'success',msg:'authenticated'}]);socket.message([{T:'subscription',bars:['NVDA'],updatedBars:['NVDA'],trades:[],quotes:[]}]);
      for(let index=0;index<7;index++){await vi.advanceTimersByTimeAsync(30_000);time.now+=30_000;}
      expect(states).toContain('QUIET_ACTIVE_SESSION');expect(states).not.toContain('DISCONNECTED');controller.abort();await active;
      const closedSocket=new MockSocket(),closedController=new AbortController(),closedStates:string[]=[];time.now=Date.parse('2026-10-21T21:00:00Z');
      const closed=connectIex({apiKey:'x',secretKey:'y',calendar,clock:()=>time.now,silenceThresholdMs:180_000,socketFactory:()=>closedSocket,signal:closedController.signal,onState:value=>closedStates.push(value)});
      closedSocket.emit('open',{});closedSocket.message([{T:'success',msg:'connected'}]);closedSocket.message([{T:'success',msg:'authenticated'}]);closedSocket.message([{T:'subscription',bars:['NVDA'],updatedBars:['NVDA'],trades:[],quotes:[]}]);
      time.now+=600_000;await vi.advanceTimersByTimeAsync(600_000);expect(closedStates).not.toContain('QUIET_ACTIVE_SESSION');closedController.abort();await closed;
    }finally{vi.useRealTimers();}
  });
  it('API de solo lectura proyecta estado privado sin revelar rutas ni datos de modelo',()=>{
    const {iex,sip}=paths(),cal=`${iex}.calendar.json`;
    saveMarketCalendar(cal,calendar);
    appendIexMinute(iex,parseIexMinute(raw('2026-10-21T13:30:00Z'),'2026-10-21T13:31:02Z',calendar),'2026-10-21T13:31:02Z',calendar);
    const status=readIexFeedStatus({iexLog:iex,calendar:cal,sipLog:sip},()=>Date.parse('2026-10-21T13:32:00Z'));
    expect(status.status).toBe('NO_DATA');
    expect(JSON.stringify(status)).not.toContain(iex);
    expect(JSON.stringify(status)).not.toContain('probabilities');
  });
  it('API encuentra el ledger SIP del comando existente con rutas predeterminadas',async()=>{
    const root=mkdtempSync(join(tmpdir(),'iex-route-'));dirs.push(root);
    const sip=join(root,'private','alpaca-ingestion','ledger.jsonl');
    appendSuccessfulCapture(sip,{candles:[{timestamp:'2026-10-21T13:30:00.000Z',open:100,high:101,low:99,close:100,volume:500}],queryAtUtc:'2026-10-21T14:10:00.000Z',receivedAtUtc:'2026-10-21T14:10:01.000Z',responseSha256:'x',availability:'DELAYED',barAgeMs:1500000});
    const app=Fastify();registerIexRoutes(app,join(root,'appdata'),root,{});
    try{
      const response=await app.inject('/api/v1/ml/feeds?symbol=NVDA&timeframe=15m');
      expect(response.statusCode).toBe(200);
      expect(response.json().sip.lastBarStartUtc).toBe('2026-10-21T13:30:00.000Z');
      expect((await app.inject('/api/v1/ml/feeds?symbol=QQQ')).statusCode).toBe(400);
      expect((await app.inject({method:'POST',url:'/api/v1/ml/feeds'})).statusCode).toBe(404);
    }finally{await app.close();}
    const isolated=Fastify();registerIexRoutes(isolated,join(root,'demo-private'),root,{TRADING_POC_PRIVATE_DIR:join(root,'demo-private')});
    try{expect((await isolated.inject('/api/v1/ml/feeds')).json().sip.lastBarStartUtc).toBeNull();}
    finally{await isolated.close();}
  });
  it('rechaza un segundo proceso y libera el bloqueo al detenerse; recupera uno huérfano',()=>{
    const {iex}=paths(),release=acquireIexProcessLock(iex);
    expect(isIexProcessActive(iex)).toBe(true);
    expect(()=>acquireIexProcessLock(iex)).toThrow(/activo/);
    release();expect(isIexProcessActive(iex)).toBe(false);
    writeFileSync(`${iex}.process.lock`,'99999999:stale');
    const recovered=acquireIexProcessLock(iex,()=>{throw Object.assign(new Error('gone'),{code:'ESRCH'});});
    expect(isIexProcessActive(iex,()=>{})).toBe(true);recovered();
  });
});
