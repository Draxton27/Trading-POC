import {createHmac} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {IBApi,EventName,SecType,OptionType,MarketDataType,type Contract,type ContractDetails,type Execution} from '@stoqey/ib';
import {MarketBar,MarketQuote,OptionQuote,twsRequestBudgets,type MarketBar as Bar,type MarketQuote as Quote,type OptionQuote as OQuote} from '@trading-poc/contracts';
import {quoteNumber} from '@trading-poc/market-domain';
import type {ReadOnlyBrokerAdapter,ResolvedContract,OptionParameters,SubscriptionHandle} from './adapter.ts';
import {TickBook} from './tick-normalizer.ts';

type Feed='LIVE'|'DELAYED'|'FROZEN'|'DELAYED_FROZEN'|'UNKNOWN';
export {normalizeFeed} from './tick-normalizer.ts';
const contract=(c:ResolvedContract):Contract=>{if(c.secType==='UNKNOWN')throw new Error('Tipo de contrato no admitido');
  return {conId:c.conId,symbol:c.symbol,secType:c.secType==='STK'?SecType.STK:SecType.OPT,exchange:c.exchange,currency:c.currency};};
export class TwsRequestError extends Error {
  constructor(public readonly code:string,public readonly stage:string,public readonly twsRequestId:number,
    public readonly ibkrCode:number|null=null){super(code);this.name='TwsRequestError';}
}
export type TwsHandshakeCode='TWS_API_HANDSHAKE_TIMEOUT'|'TWS_API_AUTHORIZATION_UNCONFIRMED'|
  'TWS_ACCOUNT_MISMATCH'|'TWS_ACCOUNT_VERIFIED'|'TWS_DISCONNECTED';
export type TwsHandshakeDiagnostic={code:TwsHandshakeCode;socketConnected:boolean;nextValidId:boolean;
  managedAccounts:boolean;paperAccountVerified:boolean;ibkrCode:number|null;atUtc:string};
export class TwsHandshakeError extends Error{
  constructor(public readonly code:TwsHandshakeCode){super(code);this.name='TwsHandshakeError';}
}
export function classifyIbkrError(code:number,message:string){
  if(code===200)return /ambiguous|ambig/i.test(message)?'AMBIGUOUS':'NOT_FOUND';
  if(code===354||code===10089)return 'PERMISSION';
  if(code===10090||code===10091)return 'PARTIAL_MARKET_DATA';
  if(code===10186)return 'DELAYED_DATA_UNAVAILABLE';
  if(code===10197)return 'SESSION_CONFLICT_REPORTED';
  if(code===101)return 'SUBSCRIPTION_LIMIT';
  if(code===100)return 'PACING';
  return 'BROKER_ERROR';
}
export class TwsReadOnlyAdapter implements ReadOnlyBrokerAdapter {
  private readonly api:IBApi;private readonly bus:EventEmitter;
  private ready=false;private accountVerified=false;private req=1000;private lastRequest=0;
  private paceQueue:Promise<void>=Promise.resolve();private readonly budgets=twsRequestBudgets();
  private books=new Map<number,TickBook>();private subscriptions=new Set<number>();
  private handshake:TwsHandshakeDiagnostic={code:'TWS_DISCONNECTED',socketConnected:false,nextValidId:false,
    managedAccounts:false,paperAccountVerified:false,ibkrCode:null,atUtc:new Date().toISOString()};
  constructor(private readonly config:{host:string;port:number;clientId:number;expectedPaperAccount:string;aliasSecret:string}){
    if(!['127.0.0.1','localhost'].includes(config.host))throw new Error('TWS solo en loopback');
    if(!config.expectedPaperAccount||!config.aliasSecret)throw new Error('Cuenta Paper esperada y secreto local requeridos');
    this.api=new IBApi({host:config.host,port:config.port,maxReqPerSec:5});this.bus=this.api as unknown as EventEmitter;
    this.bus.on(EventName.disconnected,()=>{this.ready=false;this.accountVerified=false;this.books.clear();
      this.handshake={...this.handshake,code:'TWS_DISCONNECTED',socketConnected:false,paperAccountVerified:false,atUtc:new Date().toISOString()};});
    this.bus.on(EventName.connectionClosed,()=>{this.ready=false;this.accountVerified=false;this.books.clear();
      this.handshake={...this.handshake,code:'TWS_DISCONNECTED',socketConnected:false,paperAccountVerified:false,atUtc:new Date().toISOString()};});
    this.bus.on(EventName.marketDataType,(id:number,kind:number)=>this.books.get(id)?.setFeed(kind));
  }
  private async pace(){const step=this.paceQueue.then(async()=>{const wait=220-(Date.now()-this.lastRequest);
    if(wait>0)await new Promise(r=>setTimeout(r,wait));this.lastRequest=Date.now();});
    this.paceQueue=step.catch(()=>{});await step;}
  private requireReady(){if(!this.ready||!this.accountVerified||!this.api.isConnected)throw new Error('Handshake de TWS Paper incompleto');}
  getHandshakeDiagnostic(){return {...this.handshake};}
  async connect(){
    await new Promise<void>((resolve,reject)=>{
      let id=false,account=false,accountsSeen=false,socket=false,ibkrCode:number|null=null;
      const snapshot=(code:TwsHandshakeCode):TwsHandshakeDiagnostic=>({code,socketConnected:socket,
        nextValidId:id,managedAccounts:accountsSeen,paperAccountVerified:account&&id,
        ibkrCode,atUtc:new Date().toISOString()});
      const cleanup=()=>{clearTimeout(timer);this.bus.off(EventName.connected,onConnected);
        this.bus.off(EventName.error,onError);this.bus.off(EventName.nextValidId,onId);
        this.bus.off(EventName.managedAccounts,onAccounts);};
      const done=()=>{if(id&&account){cleanup();this.api.reqMarketDataType(MarketDataType.DELAYED);
        this.ready=true;this.accountVerified=true;this.handshake=snapshot('TWS_ACCOUNT_VERIFIED');resolve();}};
      const onConnected=()=>{socket=true;};
      const onError=(_error:Error,code:number)=>{if(Number.isInteger(code))ibkrCode=code;};
      const onId=()=>{socket=true;id=true;done();};
      const onAccounts=(list:string)=>{socket=true;accountsSeen=true;
        account=list.split(',').includes(this.config.expectedPaperAccount);
        if(!account){cleanup();this.api.disconnect();this.handshake=snapshot('TWS_ACCOUNT_MISMATCH');
          reject(new TwsHandshakeError('TWS_ACCOUNT_MISMATCH'));}else done();};
      const timer=setTimeout(()=>{const code=socket?'TWS_API_AUTHORIZATION_UNCONFIRMED':'TWS_API_HANDSHAKE_TIMEOUT';
        cleanup();this.api.disconnect();this.handshake=snapshot(code);reject(new TwsHandshakeError(code));},15000);
      this.bus.on(EventName.connected,onConnected);this.bus.on(EventName.error,onError);
      this.bus.on(EventName.nextValidId,onId);this.bus.on(EventName.managedAccounts,onAccounts);this.api.connect(this.config.clientId);
    });
  }
  async disconnect(){for(const id of this.subscriptions)this.api.cancelMktData(id);this.subscriptions.clear();this.books.clear();this.api.disconnect();this.ready=false;}
  async getStatus(){const feeds=new Set([...this.books.values()].map(book=>book.feed));const feedType:Feed=feeds.size===1?feeds.values().next().value!:'UNKNOWN';
    return {connected:this.ready&&this.api.isConnected,environment:this.accountVerified?'PAPER' as const:'UNKNOWN' as const,accountVerified:this.accountVerified,feedType,asOfUtc:new Date().toISOString(),detail:this.ready?null:'TWS no disponible'};}
  private async details(query:Contract):Promise<ResolvedContract>{
    this.requireReady();await this.pace();const id=++this.req,rows:ContractDetails[]=[];
    return new Promise((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);this.bus.off(EventName.contractDetails,onRow);this.bus.off(EventName.contractDetailsEnd,onEnd);this.bus.off(EventName.error,onError);};
      const onRow=(n:number,d:ContractDetails)=>{if(n===id)rows.push(d);};
      const onError=(error:Error,code:number,n:number)=>{if(n!==id)return;cleanup();
        console.warn(JSON.stringify({component:'tws',stage:'contract_details',twsRequestId:id,ibkrCode:code}));
        reject(new TwsRequestError(classifyIbkrError(code,error.message),'contract_details',id,code));};
      const onEnd=(n:number)=>{if(n!==id)return;cleanup();if(rows.length!==1){reject(new TwsRequestError(rows.length?'AMBIGUOUS':'NOT_FOUND','contract_details',id));return;}
        const c=rows[0]!.contract;resolve({conId:c.conId!,symbol:c.symbol!,secType:c.secType===SecType.STK?'STK':c.secType===SecType.OPT?'OPT':'UNKNOWN',localSymbol:c.localSymbol??null,currency:c.currency??'',exchange:c.exchange??'SMART',right:c.right===OptionType.Call?'CALL':c.right===OptionType.Put?'PUT':null,strike:c.strike??null,expiration:c.lastTradeDateOrContractMonth??null,multiplier:c.multiplier??null,tradingClass:c.tradingClass??null,twsRequestId:id});};
      const timer=setTimeout(()=>{cleanup();reject(new TwsRequestError('TIMEOUT','contract_details',id));},this.budgets.detailsMs);
      this.bus.on(EventName.contractDetails,onRow);this.bus.on(EventName.contractDetailsEnd,onEnd);this.bus.on(EventName.error,onError);
      try{this.api.reqContractDetails(id,query);}catch{cleanup();reject(new TwsRequestError('BROKER_ERROR','contract_details',id));}
    });
  }
  async resolveStock(symbol:string){if(!['NVDA','QQQ','SMH'].includes(symbol))throw new Error('Símbolo no permitido');return this.details({symbol,secType:SecType.STK,exchange:'SMART',currency:'USD'});}
  async resolveOption(q:{symbol:string;expiration:string;right:'CALL'|'PUT';strike:number}){
    if(q.symbol!=='NVDA'||!/^\d{8}$/.test(q.expiration)||q.strike<=0)throw new Error('Contrato inválido');
    return this.details({symbol:q.symbol,secType:SecType.OPT,lastTradeDateOrContractMonth:q.expiration,right:q.right==='CALL'?OptionType.Call:OptionType.Put,strike:q.strike,tradingClass:'NVDA',multiplier:100,exchange:'SMART',currency:'USD'});
  }
  async getOptionParameters(underlyingConId:number):Promise<OptionParameters[]>{
    this.requireReady();await this.pace();const id=++this.req,rows:OptionParameters[]=[];
    return new Promise((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);this.bus.off(EventName.securityDefinitionOptionParameter,onRow);this.bus.off(EventName.securityDefinitionOptionParameterEnd,onEnd);this.bus.off(EventName.error,onError);};
      const onRow=(n:number,exchange:string,_underlying:number,tradingClass:string,multiplier:string,expirations:string[],strikes:number[])=>{if(n===id)rows.push({exchange,tradingClass,multiplier:Number(multiplier),expirations,strikes});};
      const onEnd=(n:number)=>{if(n===id){cleanup();resolve(rows);}};
      const onError=(error:Error,code:number,n:number)=>{if(n!==id)return;cleanup();
        console.warn(JSON.stringify({component:'tws',stage:'option_parameters',twsRequestId:id,ibkrCode:code}));
        reject(new TwsRequestError(classifyIbkrError(code,error.message),'option_parameters',id,code));};
      const timer=setTimeout(()=>{cleanup();reject(new TwsRequestError('TIMEOUT','option_parameters',id));},this.budgets.parametersMs);
      this.bus.on(EventName.securityDefinitionOptionParameter,onRow);this.bus.on(EventName.securityDefinitionOptionParameterEnd,onEnd);this.bus.on(EventName.error,onError);
      try{this.api.reqSecDefOptParams(id,'NVDA','',SecType.STK,underlyingConId);}catch{cleanup();reject(new TwsRequestError('BROKER_ERROR','option_parameters',id));}
    });
  }
  async getHistoricalBars(q:{contract:ResolvedContract;endUtc:string;duration:string;barSize:'15 mins'|'1 hour'|'1 day'}):Promise<Bar[]>{
    this.requireReady();await this.pace();const id=++this.req,rows:Bar[]=[];
    return new Promise((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);this.bus.off(EventName.historicalData,onRow);};
      const onRow=(n:number,time:string,open:number,high:number,low:number,close:number,volume:number)=>{
        if(n!==id)return;if(time.toLowerCase().startsWith('finished')){cleanup();resolve(rows);return;}
        // formatDate=2 exige época UTC en segundos; no interpretar fechas sin zona local.
        const start=/^\d{10}$/.test(time)?Number(time)*1000:NaN;if(!Number.isFinite(start))return;
        const duration=q.barSize==='15 mins'?900000:q.barSize==='1 hour'?3600000:86400000;
        const parsed=MarketBar.safeParse({symbol:q.contract.symbol,timeframe:q.barSize==='15 mins'?'15m':q.barSize==='1 hour'?'1h':'1d',startUtc:new Date(start).toISOString(),endUtc:new Date(start+duration).toISOString(),open,high,low,close,volume:quoteNumber(volume),provider:'IBKR',adjustment:'IBKR reported',receivedAtUtc:new Date().toISOString(),isComplete:true});
        if(parsed.success)rows.push(parsed.data);
      };
      const timer=setTimeout(()=>{cleanup();reject(new Error('Histórico sin final verificable'));},20000);
      this.bus.on(EventName.historicalData,onRow);this.api.reqHistoricalData(id,contract(q.contract),q.endUtc,q.duration,q.barSize as any,'TRADES' as any,true,2,false);
    });
  }
  async subscribeQuotes(contracts:ResolvedContract[],callback:(quote:Quote|OQuote)=>void):Promise<SubscriptionHandle>{
    this.requireReady();if(contracts.length>10)throw new Error('Límite de 10 contratos visibles');
    const ids:number[]=[],byId=new Map<number,ResolvedContract>();
    const qualityById=new Map<number,{marketDataStatus:'permission_denied'|'unavailable'|'partial';ibkrErrorCode:number}>();
    const emit=(id:number,marketDataStatus?:'permission_denied'|'unavailable'|'partial',ibkrErrorCode?:number)=>{const c=byId.get(id),book=this.books.get(id);if(!c||!book)return;const s=book.snapshot(),now=new Date().toISOString(),feedType=s.feedType;
      const quality=marketDataStatus?{marketDataStatus,ibkrErrorCode}:qualityById.get(id)??{};
      if(c.secType==='STK'){const p=MarketQuote.safeParse({symbol:c.symbol,bid:s.bid,ask:s.ask,last:s.last,marketTimestampUtc:null,receivedAtUtc:now,feedType,provider:'IBKR',...quality});if(p.success)callback(p.data);}
      else{const p=OptionQuote.safeParse({conId:c.conId,occSymbol:c.localSymbol,bid:s.bid,ask:s.ask,bidSize:s.bidSize,askSize:s.askSize,last:s.last,delta:s.delta,gamma:s.gamma,theta:s.theta,vega:s.vega,impliedVolatility:s.impliedVolatility,greeksSource:s.greeksSource,marketTimestampUtc:null,receivedAtUtc:now,feedType,provider:'IBKR',...quality});if(p.success)callback(p.data);}
    };
    const onPrice=(id:number,field:number,value:number)=>{if(this.books.get(id)?.price(field,value))emit(id);};
    const onSize=(id:number,field:number,value:number)=>{if(this.books.get(id)?.size(field,value))emit(id);};
    const onGreek=(id:number,field:number,_attr:number,iv:number,delta:number,_opt:number,_pv:number,gamma:number,vega:number,theta:number)=>{if(this.books.get(id)?.greeks(field,iv,delta,gamma,vega,theta))emit(id);};
    const onError=(_error:Error,code:number,id:number)=>{if(!byId.has(id))return;
      const status=[10090,10091].includes(code)?'partial':[354,10089].includes(code)?'permission_denied':
        [101,10186,10197,200].includes(code)?'unavailable':null;
      if(!status)return;
      console.warn(JSON.stringify({component:'tws',stage:'market_data',twsRequestId:id,ibkrCode:code}));
      qualityById.set(id,{marketDataStatus:status,ibkrErrorCode:code});
      emit(id,status,code);
    };
    this.bus.on(EventName.tickPrice,onPrice);this.bus.on(EventName.tickSize,onSize);this.bus.on(EventName.tickOptionComputation,onGreek);this.bus.on(EventName.error,onError);
    for(const c of contracts){await this.pace();const id=++this.req;ids.push(id);this.subscriptions.add(id);byId.set(id,c);this.books.set(id,new TickBook());this.api.reqMktData(id,contract(c),'',false,false);}
    return {cancel:async()=>{for(const id of ids){this.api.cancelMktData(id);this.subscriptions.delete(id);this.books.delete(id);}this.bus.off(EventName.tickPrice,onPrice);this.bus.off(EventName.tickSize,onSize);this.bus.off(EventName.tickOptionComputation,onGreek);this.bus.off(EventName.error,onError);}};
  }
  private alias(account:string){return createHmac('sha256',this.config.aliasSecret).update(account).digest('hex').slice(0,16);}
  async getPositions():Promise<Array<Record<string,unknown>>>{this.requireReady();await this.pace();const rows:Array<Record<string,unknown>>=[];
    return new Promise((resolve,reject)=>{const cleanup=()=>{clearTimeout(timer);this.bus.off(EventName.position,onRow);this.bus.off(EventName.positionEnd,onEnd);};
      const onRow=(account:string,c:Contract,qty:number,avgCost?:number)=>{if(account!==this.config.expectedPaperAccount||!c.conId)return;rows.push({accountAlias:this.alias(account),environment:'PAPER',conId:c.conId,occSymbol:c.localSymbol??null,symbol:c.symbol??null,quantity:qty,averageCost:avgCost??null,asOfUtc:new Date().toISOString()});};
      const onEnd=()=>{cleanup();resolve(rows);};const timer=setTimeout(()=>{cleanup();reject(new Error('Timeout posiciones'));},15000);this.bus.on(EventName.position,onRow);this.bus.on(EventName.positionEnd,onEnd);this.api.reqPositions();
    });}
  async getExecutions():Promise<Array<Record<string,unknown>>>{this.requireReady();await this.pace();const id=++this.req,rows:Array<Record<string,unknown>>=[];
    return new Promise((resolve,reject)=>{const cleanup=()=>{clearTimeout(timer);this.bus.off(EventName.execDetails,onRow);this.bus.off(EventName.execDetailsEnd,onEnd);};
      const onRow=(n:number,c:Contract,e:Execution)=>{if(n!==id||e.acctNumber!==this.config.expectedPaperAccount)return;rows.push({executionId:e.execId??null,accountAlias:this.alias(e.acctNumber),environment:'PAPER',conId:c.conId??null,occSymbol:c.localSymbol??null,side:e.side==='BOT'?'BUY':e.side==='SLD'?'SELL':'UNKNOWN',quantity:e.shares??null,price:e.price??null,commission:null,rawBrokerTime:e.time??null,executedAtUtc:null,receivedAtUtc:new Date().toISOString(),timeStatus:'sin zona UTC verificada'});};
      const onEnd=(n:number)=>{if(n===id){cleanup();resolve(rows);}};const timer=setTimeout(()=>{cleanup();reject(new Error('Timeout ejecuciones'));},15000);this.bus.on(EventName.execDetails,onRow);this.bus.on(EventName.execDetailsEnd,onEnd);this.api.reqExecutions(id,{});
    });}
}
