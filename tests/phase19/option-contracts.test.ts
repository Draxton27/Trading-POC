import {EventEmitter} from 'node:events';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createApp} from '../../apps/api/src/server.ts';
import {AgentHub,AgentRequestError} from '../../apps/api/src/streams/agent-hub.ts';
import {availableStrikes,quoteReference,selectContractStrikes} from '../../apps/api/src/options/selection.ts';
import {agentRequestBudgets,twsRequestBudgets} from '../../packages/contracts/src/request-budgets.ts';
import {classifyIbkrError,TwsRequestError} from '../../apps/ibkr-agent/src/connection/tws.ts';
import {AgentTransport} from '../../apps/ibkr-agent/src/transport/client.ts';
import {MockReadOnlyAdapter} from '../../apps/ibkr-agent/src/connection/mock.ts';
import {quoteStatus} from '../../apps/api/src/options/routes.ts';

class Socket extends EventEmitter {
  readyState=1;sent:any[]=[];closes:Array<[number|undefined,string|undefined]>=[];
  send(raw:string){this.sent.push(JSON.parse(raw));}
  close(code?:number,reason?:string){this.readyState=3;this.closes.push([code,reason]);this.emit('close');}
}
function connected(hub:AgentHub){
  const socket=new Socket(),connectionId=randomUUID();let sequence=0;
  const reply=(kind:string,payload:Record<string,unknown>,requestId:string|null=null)=>socket.emit('message',JSON.stringify({
    protocolVersion:1,messageId:randomUUID(),requestId,agentId:'synthetic-agent',connectionId,
    sequence:sequence++,issuedAtUtc:new Date().toISOString(),kind,payload}));
  hub.attach(socket);reply('agent.hello',{environment:'PAPER',accountVerified:true,simulation:true,status:{feedType:'DELAYED'}});
  return {socket,reply};
}
const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{vi.useRealTimers();vi.restoreAllMocks();for(const fn of cleanup.splice(0))await fn();});
async function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'phase19-options-'));
  const result=await createApp({mode:'PAPER',privateDir:dir,phase17Private:join(dir,'phase17'),phase16Ledger:join(dir,'phase16'),dbPath:join(dir,'db.sqlite')});
  cleanup.push(async()=>{await result.app.close();rmSync(dir,{recursive:true,force:true});});
  const link=connected(result.hub);return {...result,...link};
}
const parameters=[{exchange:'SMART',tradingClass:'NVDA',multiplier:100,expirations:['20261023','20261030'],strikes:Array.from({length:160},(_,i)=>100+i)}];
const response=(kind:string,payload:Record<string,unknown>)=>({kind,payload,requestId:randomUUID()});

describe('presupuestos y errores de IBKR',()=>{
  it('mantiene el backend por encima del máximo TWS y limita la configuración',()=>{
    expect(twsRequestBudgets({IBKR_CONTRACT_TIMEOUT_MS:'999999'} as NodeJS.ProcessEnv).detailsMs).toBe(15000);
    expect(agentRequestBudgets({TRADING_POC_AGENT_OPTION_TIMEOUT_MS:'1'} as NodeJS.ProcessEnv).optionResolveMs).toBe(20000);
    expect(agentRequestBudgets().optionParametersMs).toBeGreaterThan(twsRequestBudgets().parametersMs);
    expect(()=>twsRequestBudgets({IBKR_CONTRACT_TIMEOUT_MS:'abc'} as NodeJS.ProcessEnv)).toThrow();
    expect(classifyIbkrError(200,'No security definition')).toBe('NOT_FOUND');
    expect(classifyIbkrError(200,'Ambiguous contract')).toBe('AMBIGUOUS');
    expect(classifyIbkrError(354,'Permission')).toBe('PERMISSION');
    expect(classifyIbkrError(10089,'API subscription required')).toBe('PERMISSION');
    expect(classifyIbkrError(10090,'Partial ticks')).toBe('PARTIAL_MARKET_DATA');
    expect(classifyIbkrError(10091,'Partial API ticks')).toBe('PARTIAL_MARKET_DATA');
    expect(classifyIbkrError(101,'Ticker limit')).toBe('SUBSCRIPTION_LIMIT');
    expect(classifyIbkrError(10186,'Delayed disabled')).toBe('DELAYED_DATA_UNAVAILABLE');
    expect(classifyIbkrError(10197,'Competing session')).toBe('SESSION_CONFLICT_REPORTED');
    expect(classifyIbkrError(100,'Pacing')).toBe('PACING');
    const at=new Date().toISOString();
    expect(quoteStatus({receivedAtUtc:at,feedType:'LIVE',bid:2,ask:3})).toBe('LIVE_UNVERIFIED');
    expect(quoteStatus({receivedAtUtc:at,feedType:'DELAYED',bid:2,ask:null})).toBe('DELAYED_PARTIAL');
    expect(quoteStatus({receivedAtUtc:at,feedType:'DELAYED',bid:2,ask:3,ibkrErrorCode:10091})).toBe('DELAYED_PARTIAL');
    expect(quoteStatus({receivedAtUtc:at,feedType:'UNKNOWN',ibkrErrorCode:10089})).toBe('PERMISSION_DENIED');
    expect(quoteStatus({receivedAtUtc:at,feedType:'UNKNOWN',ibkrErrorCode:101})).toBe('SUBSCRIPTION_LIMIT');
    for(const feedType of ['LIVE','DELAYED'] as const)for(const prices of [{bid:2,ask:3},{bid:null,ask:null}])
      expect(quoteStatus({receivedAtUtc:at,feedType,marketDataStatus:'unavailable',...prices})).toBe('UNAVAILABLE');
    expect(quoteStatus({receivedAtUtc:at,feedType:'FROZEN',bid:2,ask:3})).toBe('FROZEN');
    expect(quoteStatus({receivedAtUtc:at,feedType:'DELAYED_FROZEN',bid:2,ask:3})).toBe('DELAYED_FROZEN');
    expect(quoteStatus({receivedAtUtc:at,feedType:'UNKNOWN',bid:null,ask:null,ibkrErrorCode:10197})).toBe('SESSION_CONFLICT_REPORTED');
    expect(quoteStatus({receivedAtUtc:at,feedType:'UNKNOWN',bid:null,ask:null,ibkrErrorCode:10186})).toBe('DELAYED_DATA_UNAVAILABLE');
    expect(quoteStatus({receivedAtUtc:new Date(Date.now()+60_000).toISOString(),feedType:'LIVE',bid:2,ask:3})).toBe('STALE');
  });
  it('filtra vencimiento, rango y referencia sin inventar un precio central',()=>{
    expect(availableStrikes(parameters,'20261023',150,152)).toEqual([150,151,152]);
    expect(availableStrikes(parameters,'20261106')).toEqual([]);
    expect(selectContractStrikes([150,151,152],2,null)).toEqual([]);
    expect(selectContractStrikes([150,151,152],2,151.2)).toEqual([151,152]);
    expect(quoteReference({last:null,receivedAtUtc:new Date().toISOString()})).toBeNull();
    expect(quoteReference({last:151,receivedAtUtc:new Date(Date.now()-31000).toISOString()})).toBeNull();
  });
});

describe('respuestas tardías y reconexión',()=>{
  it('conserva requestId, twsRequestId y código IBKR sin exponer la respuesta cruda',async()=>{
    const hub=new AgentHub('synthetic-secret');const {socket,reply}=connected(hub);
    const pending=hub.request('option.resolve',{strike:140});
    const id=socket.sent.at(-1).requestId;
    reply('agent.error',{code:'NOT_FOUND',stage:'contract_details',ibkrCode:200,twsRequestId:711},id);
    await expect(pending).rejects.toMatchObject({code:'NOT_FOUND',requestId:id,twsRequestId:711,ibkrCode:200});
  });
  it('descarta una respuesta expirada sin cerrar el agente y acepta la siguiente',async()=>{
    vi.useFakeTimers();const hub=new AgentHub('synthetic-secret');const {socket,reply}=connected(hub);
    const first=hub.request('option.resolve',{strike:151},1000);const rejected=expect(first).rejects.toMatchObject({code:'TIMEOUT',stage:'backend'});
    const requestId=socket.sent.at(-1).requestId;
    await vi.advanceTimersByTimeAsync(1001);await rejected;
    reply('option.resolve',{contract:{conId:1}},requestId);
    expect(socket.closes).toHaveLength(0);expect(hub.status().connected).toBe(true);
    const second=hub.request('option.resolve',{strike:152},1000);
    reply('option.resolve',{contract:{conId:2}},socket.sent.at(-1).requestId);
    expect((await second).payload.contract).toEqual({conId:2});
  });
  it('rechaza solicitudes pendientes al reemplazar la conexión y no acepta el socket viejo',async()=>{
    const hub=new AgentHub('synthetic-secret');const old=connected(hub);
    const pending=hub.request('option.resolve',{});const rejected=expect(pending).rejects.toMatchObject({code:'DISCONNECTED'});
    const newer=connected(hub);await rejected;
    old.reply('option.resolve',{},old.socket.sent.at(-1).requestId);
    expect(newer.socket.closes).toHaveLength(0);expect(hub.status().connected).toBe(true);
  });
  it('limpia una suscripción que llega después del timeout',async()=>{
    vi.useFakeTimers();const hub=new AgentHub('synthetic-secret');const {socket,reply}=connected(hub);
    const pending=hub.subscribe({conId:123},'browser',1000);const rejected=expect(pending).rejects.toMatchObject({code:'TIMEOUT'});
    const id=socket.sent.at(-1).requestId;await vi.advanceTimersByTimeAsync(1001);await rejected;
    reply('agent.status',{subscribed:'123'},id);await Promise.resolve();
    expect(socket.sent.at(-1).kind).toBe('market.unsubscribe');
    reply('agent.status',{unsubscribed:'123'},socket.sent.at(-1).requestId);
    expect(socket.closes).toHaveLength(0);
  });
});

describe('API de contratos Paper simulados',()=>{
  it('conserva un contrato por conId con consumidor separado y sin inventar cotizaciones',async()=>{
    const {app,hub,token}=await fixture();
    vi.spyOn(hub,'request').mockImplementation(async(kind,payload)=>kind==='option.parameters'?response(kind,{items:parameters}) as any:
      response(kind,{contract:{conId:1150,symbol:'NVDA',secType:'OPT',currency:'USD',tradingClass:'NVDA',right:'CALL',expiration:'20261023',strike:Number(payload.strike),multiplier:100}}) as any);
    const subscribe=vi.spyOn(hub,'subscribe').mockResolvedValue(undefined);
    const chainConsumer=randomUUID(),comparisonConsumer=randomUUID();
    await app.inject(`/api/v1/options/contracts?expiration=20261023&centerStrike=150&limit=1&consumerId=${chainConsumer}`);
    const result=await app.inject({method:'POST',url:'/api/v1/options/comparison',headers:{'x-local-token':token},payload:{conId:1150,consumerId:comparisonConsumer}});
    expect(result.statusCode).toBe(200);
    expect(result.json().item).toMatchObject({conId:1150,dataStatus:'cotizacion_pendiente',academyEvaluation:{status:'NO_REFERENCE'}});
    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({conId:1150}),comparisonConsumer);
    const unknown=await app.inject({method:'POST',url:'/api/v1/options/comparison',headers:{'x-local-token':token},payload:{conId:9999,consumerId:comparisonConsumer}});
    expect(unknown.statusCode).toBe(404);
  });
  it('pagina más de 100 strikes y exige selección sin cotización NVDA',async()=>{
    const {app,hub}=await fixture();
    vi.spyOn(hub,'request').mockResolvedValue(response('option.parameters',{items:parameters}) as any);
    const page=await app.inject('/api/v1/options/strikes?expiration=20261023&offset=100&limit=30');
    expect(page.statusCode).toBe(200);expect(page.json()).toMatchObject({total:160,offset:100,nextOffset:130});
    expect(page.json().items).toEqual(Array.from({length:30},(_,i)=>200+i));
    const nearby=await app.inject('/api/v1/options/strikes?expiration=20261023&near=220&limit=5');
    expect(nearby.json().items).toEqual([220,219,221,218,222]);
    const result=await app.inject(`/api/v1/options/contracts?expiration=20261023&consumerId=${randomUUID()}`);
    expect(result.statusCode).toBe(200);expect(result.json()).toMatchObject({items:[],selectionRequired:true,referenceSource:'NONE'});
    expect(hub.request).toHaveBeenCalledTimes(1);
  });
  it('devuelve contratos parciales y errores específicos aun sin precios OPRA',async()=>{
    const {app,hub}=await fixture();let resolved=0;
    vi.spyOn(hub,'request').mockImplementation(async(kind,payload)=>{
      if(kind==='option.parameters')return response(kind,{items:parameters}) as any;
      if(kind==='option.resolve'){
        resolved++;const strike=Number(payload.strike);
        if(strike===151)throw new AgentRequestError('NOT_FOUND','contract_details','req-151',200);
        return response(kind,{contract:{conId:1000+strike,symbol:'NVDA',secType:'OPT',right:'CALL',
          expiration:'20261023',strike,multiplier:100,localSymbol:null,currency:'USD',tradingClass:'NVDA',exchange:'SMART'}}) as any;
      }
      throw Error('unexpected');
    });
    vi.spyOn(hub,'subscribe').mockResolvedValue(undefined);
    const url=`/api/v1/options/contracts?expiration=20261023&right=CALL&centerStrike=151&limit=3&consumerId=${randomUUID()}`;
    const result=await app.inject(url),body=result.json();
    expect(result.statusCode).toBe(200);expect(resolved).toBe(3);
    expect(body.items).toHaveLength(2);expect(body.items.every((item:any)=>item.dataStatus==='cotizacion_pendiente')).toBe(true);
    expect(body.errors).toMatchObject([{strike:151,code:'NOT_FOUND',stage:'contract_details',ibkrCode:200}]);
    expect(body.referenceSource).toBe('MANUAL_STRIKE');
  });
  it('informa permisos de cotización sin perder el contrato resuelto',async()=>{
    const {app,hub}=await fixture();
    vi.spyOn(hub,'request').mockImplementation(async(kind,payload)=>kind==='option.parameters'?response(kind,{items:parameters}) as any:
      response(kind,{contract:{conId:1150,symbol:'NVDA',secType:'OPT',currency:'USD',tradingClass:'NVDA',right:'CALL',expiration:'20261023',strike:Number(payload.strike),multiplier:100}}) as any);
    vi.spyOn(hub,'subscribe').mockRejectedValue(new AgentRequestError('PERMISSION','market_data','subscription',354));
    const result=await app.inject(`/api/v1/options/contracts?expiration=20261023&right=CALL&centerStrike=150&limit=1&consumerId=${randomUUID()}`);
    expect(result.statusCode).toBe(200);
    expect(result.json().items[0].dataStatus).toBe('permisos_insuficientes');
    expect(result.json().errors).toMatchObject([{code:'PERMISSION',ibkrCode:354}]);
  });
  it('valida cinco definiciones por campo, conserva cuatro y refresca quotes sin nuevas suscripciones',async()=>{
    const {app,hub}=await fixture();
    const resolve=vi.spyOn(hub,'request').mockImplementation(async(kind,payload)=>kind==='option.parameters'?
      response(kind,{items:parameters}) as any:response(kind,{contract:{conId:1000+Number(payload.strike),
        symbol:'NVDA',secType:'OPT',currency:'USD',tradingClass:'NVDA',right:'C',
        expiration:Number(payload.strike)===149?'20261030':'20261023 16:00:00',
        strike:String(payload.strike),multiplier:'100',twsRequestId:77}}) as any);
    const subscribe=vi.spyOn(hub,'subscribe').mockResolvedValue(undefined);
    const consumerId=randomUUID();
    const first=await app.inject(`/api/v1/options/contracts?expiration=20261023&centerStrike=150&limit=5&consumerId=${consumerId}`);
    expect(first.statusCode).toBe(200);
    const body=first.json();
    expect(body.items).toHaveLength(4);
    expect(body.errors).toMatchObject([{strike:149,code:'INVALID_CONTRACT',mismatchFields:['expiration']}]);
    expect(subscribe).toHaveBeenCalledTimes(4);
    const calls=resolve.mock.calls.length;
    const quote=await app.inject('/api/v1/options/quotes?conIds='+body.items.map((item:any)=>item.conId).join(','));
    expect(quote.statusCode).toBe(200);expect(quote.json().items).toHaveLength(4);
    expect(quote.json().items.every((item:any)=>item.dataStatus==='cotizacion_pendiente')).toBe(true);
    expect(resolve).toHaveBeenCalledTimes(calls);expect(subscribe).toHaveBeenCalledTimes(4);
    vi.spyOn(hub,'latestQuote').mockImplementation(key=>key==='1148'?{conId:1148,provider:'IBKR',feedType:'DELAYED',
      receivedAtUtc:new Date().toISOString(),marketTimestampUtc:null,bid:2,ask:2.2} as any:null);
    const updated=await app.inject('/api/v1/options/quotes?conIds=1148');
    expect(updated.json().items[0]).toMatchObject({conId:1148,bid:2,ask:2.2,feedType:'DELAYED'});
    expect(subscribe).toHaveBeenCalledTimes(4);
    const second=await app.inject(`/api/v1/options/contracts?expiration=20261023&centerStrike=150&limit=5&consumerId=${consumerId}`);
    expect(second.json().items).toHaveLength(4);
    expect(resolve).toHaveBeenCalledTimes(calls+1); // Only the mismatching definition is retried.
  });
});

describe('Fase 41S: cadena conjunta acotada',()=>{
  const prepared=async()=>{
    const {app,hub}=await fixture();
    const request=vi.spyOn(hub,'request').mockImplementation(async(kind,payload)=>kind==='option.parameters'?
      response(kind,{items:parameters}) as any:response(kind,{contract:{conId:100000+Number(payload.strike)*2+(payload.right==='PUT'?1:0),
        symbol:'NVDA',secType:'OPT',currency:'USD',tradingClass:'NVDA',right:payload.right==='PUT'?'P':'C',
        expiration:'20261030 16:00:00',strike:String(payload.strike),multiplier:'100'}}) as any);
    const subscribe=vi.spyOn(hub,'subscribe').mockResolvedValue(undefined);
    return {app,hub,request,subscribe};
  };
  it.each([[3,6],[5,10]])('consulta %i strikes y a lo sumo %i definiciones entre CALL y PUT',async(levels,definitions)=>{
    const {app,request,subscribe}=await prepared();
    const result=await app.inject(`/api/v1/options/chain?expiration=20261030&centerStrike=150&strikeLevels=${levels}&consumerId=${randomUUID()}`);
    expect(result.statusCode).toBe(200);
    const body=result.json();expect(body.rows).toHaveLength(levels);
    expect(body.rows.every((row:any)=>row.call?.right==='CALL'&&row.put?.right==='PUT'&&
      row.call.strike===row.put.strike&&row.call.multiplier===100&&row.put.multiplier===100)).toBe(true);
    expect(body.subscriptionStatus).toMatchObject({requested:definitions,limit:10});
    expect(request.mock.calls.filter(([kind])=>kind==='option.resolve')).toHaveLength(definitions);
    expect(subscribe).toHaveBeenCalledTimes(definitions);
    const ids=body.rows.flatMap((row:any)=>[row.call.conId,row.put.conId]);
    const refreshed=await app.inject('/api/v1/options/quotes?conIds='+ids.join(','));
    expect(refreshed.statusCode).toBe(200);expect(refreshed.json().items).toHaveLength(definitions);
    expect(subscribe).toHaveBeenCalledTimes(definitions);
  });
  it('conserva el PUT aunque CALL tenga identidad incompatible',async()=>{
    const {app,hub,request}=await prepared();
    request.mockImplementation(async(kind,payload)=>kind==='option.parameters'?response(kind,{items:parameters}) as any:
      response(kind,{contract:{conId:100000+Number(payload.strike)*2+(payload.right==='PUT'?1:0),symbol:'NVDA',
        secType:'OPT',currency:'USD',tradingClass:'NVDA',right:payload.right==='PUT'?'P':'C',
        expiration:payload.right==='CALL'&&Number(payload.strike)===150?'20261106':'20261030 16:00:00',
        strike:String(payload.strike),multiplier:'100'}}) as any);
    const result=await app.inject(`/api/v1/options/chain?expiration=20261030&centerStrike=150&consumerId=${randomUUID()}`);
    const row=result.json().rows.find((item:any)=>item.strike===150);
    expect(row.call).toBeNull();expect(row.put).toMatchObject({right:'PUT',strike:150});
    expect(row.issues).toMatchObject([{right:'CALL',code:'INVALID_CONTRACT',mismatchFields:['expiration']}]);
    expect(hub.status().simulation).toBe(true);
  });
  it('busca otro strike cercano solo tras NOT_FOUND y conserva cada identidad',async()=>{
    const {app,hub,request,subscribe}=await prepared();
    request.mockImplementation(async(kind,payload)=>{
      if(kind==='option.parameters')return response(kind,{items:parameters}) as any;
      if(Number(payload.strike)===150&&payload.right==='CALL')
        throw new AgentRequestError('NOT_FOUND','contract_details','missing-call',200,91);
      return response(kind,{contract:{conId:100000+Number(payload.strike)*2+(payload.right==='PUT'?1:0),
        symbol:'NVDA',secType:'OPT',currency:'USD',tradingClass:'NVDA',right:payload.right==='PUT'?'P':'C',
        expiration:'20261030',strike:Number(payload.strike),multiplier:100}}) as any;
    });
    const url=`/api/v1/options/chain?expiration=20261030&centerStrike=150&consumerId=${randomUUID()}`;
    const first=(await app.inject(url)).json();
    expect(first.rows.find((row:any)=>row.strike===150)).toMatchObject({call:null,put:{strike:150,right:'PUT'}});
    expect(first.rows.find((row:any)=>row.strike===148)).toMatchObject({call:{strike:148,right:'CALL'},
      replacementFor:{right:'CALL',requestedStrike:150}});
    expect(first.fallback).toMatchObject({additionalAttemptLimit:2,attemptedCount:1,resolvedCount:1,
      attempts:[{requestedStrike:150,resolvedStrike:148,right:'CALL',reason:'RESOLVED'}]});
    expect(subscribe).toHaveBeenCalledTimes(6); // five originals (one NOT_FOUND) and one replacement
    const before=request.mock.calls.filter(([kind,payload])=>kind==='option.resolve'&&Number(payload.strike)===150&&payload.right==='CALL').length;
    await app.inject(url);
    expect(request.mock.calls.filter(([kind,payload])=>kind==='option.resolve'&&Number(payload.strike)===150&&payload.right==='CALL')).toHaveLength(before);
    connected(hub); // A new connection invalidates negative and positive definition caches.
    await app.inject(url);
    expect(request.mock.calls.filter(([kind,payload])=>kind==='option.resolve'&&Number(payload.strike)===150&&payload.right==='CALL')).toHaveLength(before+1);
  });
  it('no busca un strike alternativo ante TIMEOUT o identidad incompatible',async()=>{
    const {app,request}=await prepared();
    request.mockImplementation(async(kind,payload)=>{
      if(kind==='option.parameters')return response(kind,{items:parameters}) as any;
      if(Number(payload.strike)===150&&payload.right==='CALL')
        throw new AgentRequestError('TIMEOUT','contract_details','slow',null,92);
      return response(kind,{contract:{conId:100000+Number(payload.strike)*2+(payload.right==='PUT'?1:0),
        symbol:'NVDA',secType:'OPT',currency:'USD',tradingClass:'NVDA',right:payload.right==='PUT'?'P':'C',
        expiration:Number(payload.strike)===149&&payload.right==='PUT'?'20261106':'20261030',
        strike:Number(payload.strike),multiplier:100}}) as any;
    });
    const result=(await app.inject(`/api/v1/options/chain?expiration=20261030&centerStrike=150&consumerId=${randomUUID()}`)).json();
    expect(result.fallback.attemptedCount).toBe(0);
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({code:'TIMEOUT'}),
      expect.objectContaining({code:'INVALID_CONTRACT'})]));
    expect(request.mock.calls.filter(([kind])=>kind==='option.resolve')).toHaveLength(6);
  });
  it('detiene el fallback si el candidato adicional responde con PACING',async()=>{
    const {app,request}=await prepared();
    request.mockImplementation(async(kind,payload)=>{
      if(kind==='option.parameters')return response(kind,{items:parameters}) as any;
      if(payload.right==='CALL'&&Number(payload.strike)===150)
        throw new AgentRequestError('NOT_FOUND','contract_details','missing',200);
      if(payload.right==='CALL'&&Number(payload.strike)===148)
        throw new AgentRequestError('PACING','contract_details','limited',100);
      return response(kind,{contract:{conId:100000+Number(payload.strike)*2+(payload.right==='PUT'?1:0),
        symbol:'NVDA',secType:'OPT',currency:'USD',tradingClass:'NVDA',right:payload.right==='PUT'?'P':'C',
        expiration:'20261030',strike:Number(payload.strike),multiplier:100}}) as any;
    });
    const result=(await app.inject(`/api/v1/options/chain?expiration=20261030&centerStrike=150&consumerId=${randomUUID()}`)).json();
    expect(result.fallback).toMatchObject({attemptedCount:1,resolvedCount:0,attempts:[{reason:'PACING'}]});
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({code:'NOT_FOUND',right:'CALL'}),
      expect.objectContaining({code:'PACING',right:'CALL',strike:148})]));
    expect(request.mock.calls.filter(([kind])=>kind==='option.resolve')).toHaveLength(7);
  });
  it.each(['CALL','PUT'] as const)('propaga el 101 de TWS a través del transporte, AgentHub y la cadena para %s',async failingRight=>{
    const {app,hub}=await fixture();
    const adapter=new MockReadOnlyAdapter();await adapter.connect();
    vi.spyOn(adapter,'getOptionParameters').mockResolvedValue([{exchange:'SMART',tradingClass:'NVDA',multiplier:100,
      expirations:['20261030'],strikes:[150]}]);
    const original=adapter.resolveOption.bind(adapter);
    vi.spyOn(adapter,'resolveOption').mockImplementation(async query=>({...await original(query),
      conId:query.right==='CALL'?90001:90002,tradingClass:'NVDA'}));
    const originalSubscribe=adapter.subscribeQuotes.bind(adapter);
    vi.spyOn(adapter,'subscribeQuotes').mockImplementation(async(contracts,callback)=>{
      if(contracts[0]?.right===failingRight)throw new TwsRequestError(classifyIbkrError(101,'Max number of tickers'),
        'market_data',711,101);
      return originalSubscribe(contracts,callback);
    });
    const transport=new AgentTransport(adapter,{url:'ws://127.0.0.1:4301/agent/v1/connect',agentId:'synthetic-agent',secret:'synthetic-secret'});
    const bridge=new Socket();
    bridge.send=(raw:string)=>{bridge.sent.push(JSON.parse(raw));void (transport as any).onMessage(raw);};
    (transport as any).socket={readyState:1,send:(raw:string)=>bridge.emit('message',raw),close:()=>{}};
    hub.attach(bridge);
    (transport as any).send('agent.hello',{environment:'PAPER',accountVerified:true,simulation:true,
      status:{feedType:'UNKNOWN'}});
    cleanup.push(async()=>{await transport.close();await adapter.disconnect();});
    const result=await app.inject(`/api/v1/options/chain?expiration=20261030&centerStrike=150&consumerId=${randomUUID()}`);
    const body=result.json(),row=body.rows[0];
    expect(result.statusCode).toBe(200);
    expect(row.issues).toContainEqual(expect.objectContaining({right:failingRight,strike:150,code:'SUBSCRIPTION_LIMIT',
      ibkrCode:101,twsRequestId:711,stage:'market_data',resolved:true,subscribed:false}));
    expect(body.errors).toContainEqual(expect.objectContaining({right:failingRight,ibkrCode:101,twsRequestId:711}));
    expect(row[failingRight.toLowerCase()]).toMatchObject({definitionStatus:'VALID',subscriptionStatus:'FAILED',
      quoteStatus:'SUBSCRIPTION_LIMIT',strike:150});
    expect(row[failingRight==='CALL'?'put':'call']).toMatchObject({definitionStatus:'VALID',strike:150});
  });
  it('separa un NOT_FOUND y un PACING de las definiciones válidas del mismo strike',async()=>{
    const {app,request}=await prepared();
    request.mockImplementation(async(kind,payload)=>{
      if(kind==='option.parameters')return response(kind,{items:parameters}) as any;
      if(Number(payload.strike)===150&&payload.right==='CALL')throw new AgentRequestError('NOT_FOUND','contract_details','call-150',200,77);
      if(Number(payload.strike)===149&&payload.right==='PUT')throw new AgentRequestError('PACING','contract_details','put-149',100,78);
      return response(kind,{contract:{conId:100000+Number(payload.strike)*2+(payload.right==='PUT'?1:0),
        symbol:'NVDA',secType:'OPT',currency:'USD',tradingClass:'NVDA',right:payload.right==='PUT'?'P':'C',
        expiration:'20261030',strike:Number(payload.strike),multiplier:100}}) as any;
    });
    const result=await app.inject(`/api/v1/options/chain?expiration=20261030&centerStrike=150&consumerId=${randomUUID()}`);
    const body=result.json();expect(body.errors).toContainEqual(expect.objectContaining({right:'CALL',strike:150,code:'NOT_FOUND',ibkrCode:200,twsRequestId:77}));
    expect(body.errors).toContainEqual(expect.objectContaining({right:'PUT',strike:149,code:'PACING',ibkrCode:100,twsRequestId:78}));
    expect(body.rows.find((row:any)=>row.strike===150).put.definitionStatus).toBe('VALID');
  });
  it('reporta presupuesto insuficiente por lado sin ocultar contratos válidos',async()=>{
    const {app,hub}=await prepared();let count=0;
    vi.spyOn(hub,'subscribe').mockImplementation(async()=>{if(++count>4)throw new Error('Límite de 10 suscripciones IBKR');});
    const result=await app.inject(`/api/v1/options/chain?expiration=20261030&centerStrike=150&strikeLevels=3&consumerId=${randomUUID()}`);
    const body=result.json();expect(result.statusCode).toBe(200);
    expect(body.rows.flatMap((row:any)=>[row.call,row.put]).filter(Boolean)).toHaveLength(6);
    expect(body.errors).toHaveLength(2);
    expect(body.rows.flatMap((row:any)=>[row.call,row.put]).filter((item:any)=>item?.dataStatus==='suscripcion_fallida')).toHaveLength(2);
  });
  it('distingue presupuesto de página de contrato inexistente',async()=>{
    const {app,hub,request}=await prepared();
    vi.spyOn(hub,'optionPageTimeoutMs').mockReturnValue(1);
    const result=await app.inject(`/api/v1/options/chain?expiration=20261030&centerStrike=150&consumerId=${randomUUID()}`);
    expect(result.json().errors).toHaveLength(6);
    expect(result.json().errors.every((item:any)=>item.code==='PAGE_TIMEOUT'&&item.stage==='page_budget')).toBe(true);
    expect(request.mock.calls.filter(([kind])=>kind==='option.resolve')).toHaveLength(0);
  });
  it('conserva BID recibido con error IBKR 10090 y ASK ausente',async()=>{
    const {app,hub}=await prepared();
    vi.spyOn(hub,'latestQuote').mockImplementation(key=>key==='100300'?{
      conId:100300,provider:'IBKR',feedType:'DELAYED',receivedAtUtc:new Date().toISOString(),
      marketTimestampUtc:null,marketDataStatus:'partial',ibkrErrorCode:10090,bid:2,ask:null} as any:null);
    const result=await app.inject(`/api/v1/options/chain?expiration=20261030&centerStrike=150&consumerId=${randomUUID()}`);
    expect(result.json().rows.find((item:any)=>item.strike===150).call).toMatchObject({
      definitionStatus:'VALID',subscriptionStatus:'ACTIVE',quoteStatus:'DELAYED_PARTIAL',bid:2,ask:null,ibkrErrorCode:10090});
  });
  it('no eleva ticks anteriores a Live cuando IBKR declara la cotización no disponible',async()=>{
    const {app,hub}=await prepared();
    vi.spyOn(hub,'latestQuote').mockImplementation(key=>key==='100300'?{
      conId:100300,provider:'IBKR',feedType:'LIVE',receivedAtUtc:new Date().toISOString(),
      marketTimestampUtc:new Date().toISOString(),marketDataStatus:'unavailable',bid:2,ask:2.2} as any:null);
    const result=await app.inject(`/api/v1/options/chain?expiration=20261030&centerStrike=150&consumerId=${randomUUID()}`);
    const call=result.json().rows.find((item:any)=>item.strike===150).call;
    expect(call).toMatchObject({definitionStatus:'VALID',quoteStatus:'UNAVAILABLE',dataStatus:'cotizacion_no_disponible',
      bid:2,ask:2.2});
    const refresh=await app.inject(`/api/v1/options/quotes?conIds=${call.conId}`);
    expect(refresh.json().items[0]).toMatchObject({quoteStatus:'UNAVAILABLE',dataStatus:'cotizacion_no_disponible'});
  });
  it('no revalida ticks previos tras fallar la suscripción y recupera el estado al reintentar',async()=>{
    const {app,hub}=await prepared();
    const subscribe=vi.spyOn(hub,'subscribe').mockRejectedValueOnce(new AgentRequestError('SUBSCRIPTION_LIMIT',
      'market_data','subscribe-101',101,812));
    vi.spyOn(hub,'latestQuote').mockImplementation(key=>key==='100300'?{
      conId:100300,provider:'IBKR',feedType:'LIVE',receivedAtUtc:new Date().toISOString(),
      marketTimestampUtc:new Date().toISOString(),marketDataStatus:'available',bid:2,ask:2.2} as any:null);
    const url=`/api/v1/options/chain?expiration=20261030&centerStrike=150&side=CALL&consumerId=${randomUUID()}`;
    const first=await app.inject(url),call=first.json().rows.find((item:any)=>item.strike===150).call;
    expect(call).toMatchObject({subscriptionStatus:'FAILED',quoteStatus:'SUBSCRIPTION_LIMIT',dataStatus:'suscripcion_fallida'});
    expect(first.json().errors).toContainEqual(expect.objectContaining({right:'CALL',ibkrCode:101,twsRequestId:812}));
    const refresh=await app.inject(`/api/v1/options/quotes?conIds=${call.conId}`);
    expect(refresh.json().items[0]).toMatchObject({subscriptionStatus:'FAILED',quoteStatus:'SUBSCRIPTION_LIMIT'});
    subscribe.mockResolvedValue(undefined);
    const second=await app.inject(url);
    expect(second.json().rows.find((item:any)=>item.strike===150).call.subscriptionStatus).toBe('ACTIVE');
    const recovered=await app.inject(`/api/v1/options/quotes?conIds=${call.conId}`);
    expect(recovered.json().items[0].quoteStatus).not.toBe('SUBSCRIPTION_LIMIT');
  });
  it('no inventa un centro ni cotizaciones si no hay precio admisible',async()=>{
    const {app,hub}=await prepared();
    const result=await app.inject(`/api/v1/options/chain?expiration=20261030&consumerId=${randomUUID()}`);
    expect(result.json()).toMatchObject({rows:[],selectionRequired:true,referenceSource:'NONE'});
    expect(hub.status().connected).toBe(true);
  });
  it('centra contratos solo para exploración con un cierre IEX verificado de sesión anterior',async()=>{
    const {app}=await prepared();
    const original=app.inject.bind(app);
    vi.spyOn(app,'inject').mockImplementation(((input:any)=>{
      if(typeof input==='object'&&input.url==='/api/v1/market/live-technical-context')
        return Promise.resolve({statusCode:200,json:()=>({state:'FEED_DISCONNECTED',
          explorationReference:{referencePrice:150,referenceKind:'HISTORICAL_EXPLORATION',
            referenceSource:'ALPACA_IEX_VERIFIED_SESSION_CLOSE',observedAtUtc:'2026-10-27T20:00:00Z',
            receivedAtUtc:'2026-10-27T20:00:30Z',sessionDate:'2026-10-27',ageTradingSessions:1,
            isCurrent:false,isExecutable:false}})}) as any;
      return original(input);
    }) as any);
    const result=await app.inject(`/api/v1/options/chain?expiration=20261030&consumerId=${randomUUID()}`);
    expect(result.json()).toMatchObject({referenceSource:'ALPACA_IEX_VERIFIED_SESSION_CLOSE',referencePrice:150,
      referenceKind:'HISTORICAL_EXPLORATION',isCurrent:false,isExecutable:false,selectionRequired:false});
    expect(result.json().rows).toHaveLength(3);
  });
});
