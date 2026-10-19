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
          expiration:'20261023',strike,multiplier:100,localSymbol:null,currency:'USD',exchange:'SMART'}}) as any;
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
      response(kind,{contract:{conId:1150,symbol:'NVDA',right:'CALL',expiration:'20261023',strike:Number(payload.strike),multiplier:100}}) as any);
    vi.spyOn(hub,'subscribe').mockRejectedValue(new AgentRequestError('PERMISSION','market_data','subscription',354));
    const result=await app.inject(`/api/v1/options/contracts?expiration=20261023&right=CALL&centerStrike=150&limit=1&consumerId=${randomUUID()}`);
    expect(result.statusCode).toBe(200);
    expect(result.json().items[0].dataStatus).toBe('permisos_insuficientes');
    expect(result.json().errors).toMatchObject([{code:'PERMISSION',ibkrCode:354}]);
  });
});
