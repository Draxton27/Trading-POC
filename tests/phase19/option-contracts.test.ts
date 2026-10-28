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
import {classifyIbkrError} from '../../apps/ibkr-agent/src/connection/tws.ts';

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
    expect(classifyIbkrError(100,'Pacing')).toBe('PACING');
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
  it('reporta presupuesto insuficiente por lado sin ocultar contratos válidos',async()=>{
    const {app,hub}=await prepared();let count=0;
    vi.spyOn(hub,'subscribe').mockImplementation(async()=>{if(++count>4)throw new Error('Límite de 10 suscripciones IBKR');});
    const result=await app.inject(`/api/v1/options/chain?expiration=20261030&centerStrike=150&strikeLevels=3&consumerId=${randomUUID()}`);
    const body=result.json();expect(result.statusCode).toBe(200);
    expect(body.rows.flatMap((row:any)=>[row.call,row.put]).filter(Boolean)).toHaveLength(6);
    expect(body.errors).toHaveLength(2);
    expect(body.rows.flatMap((row:any)=>[row.call,row.put]).filter((item:any)=>item?.dataStatus==='suscripcion_fallida')).toHaveLength(2);
  });
  it('no inventa un centro ni cotizaciones si no hay precio admisible',async()=>{
    const {app,hub}=await prepared();
    const result=await app.inject(`/api/v1/options/chain?expiration=20261030&consumerId=${randomUUID()}`);
    expect(result.json()).toMatchObject({rows:[],selectionRequired:true,referenceSource:'NONE'});
    expect(hub.status().connected).toBe(true);
  });
});
