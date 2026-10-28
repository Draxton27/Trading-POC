import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {spread} from '@trading-poc/market-domain';
import {AgentHub,AgentRequestError} from '../streams/agent-hub.ts';
import {availableStrikes,selectContractStrikes,quoteReference,iexBarReference,type OptionParameter} from './selection.ts';
import {validateOptionIdentity} from './identity.ts';
import type Database from 'better-sqlite3';
import {academyRanges,evaluateAcademyAskRange,selectAcademyReference} from '../academy/service.ts';
import {OptionComparisonRequest} from '@trading-poc/contracts';

type Issue={strike:number|null;code:string;message:string;stage:string;requestId:string|null;ibkrCode:number|null;
  twsRequestId?:number|null;elapsedMs?:number;resolved?:boolean;subscribed?:boolean;quoteReceived?:boolean;
  mismatchFields?:string[];right?:'CALL'|'PUT'};
const messages:Record<string,string>={
  TIMEOUT:'La solicitud tardó demasiado; vuelva a intentar este contrato.',
  PAGE_TIMEOUT:'Se agotó el tiempo de esta página; reduzca el número de contratos.',
  NOT_FOUND:'Contrato no encontrado en IBKR.',
  AMBIGUOUS:'IBKR devolvió más de un contrato; se necesita una definición más precisa.',
  PERMISSION:'Permisos de mercado insuficientes para esta solicitud.',
  PACING:'IBKR limitó las solicitudes; espere antes de reintentar.',
  DISCONNECTED:'El agente Paper se desconectó.',
  SUBSCRIPTION_LIMIT:'Se alcanzó el límite de suscripciones de mercado.',
  INVALID_CONTRACT:'La definición recibida no coincide con el contrato solicitado.',
  BROKER_ERROR:'IBKR no pudo completar la solicitud.',
  PARTIAL_MARKET_DATA:'IBKR indicó que faltan permisos para algunos ticks; los precios recibidos se conservan.',
  DELAYED_DATA_UNAVAILABLE:'IBKR indicó que los datos retrasados solicitados no están habilitados.',
  SESSION_CONFLICT_REPORTED:'IBKR informó un conflicto de sesiones de datos de mercado.'
};
function issue(error:unknown,strike:number|null=null):Issue{
  const e=error instanceof AgentRequestError?error:null;
  const code=e?.code??(error instanceof Error&&/límite de 10/i.test(error.message)?'SUBSCRIPTION_LIMIT':'BROKER_ERROR');
  return {strike,code,message:messages[code]??messages.BROKER_ERROR!,stage:e?.stage??'backend',
    requestId:e?.requestId||null,ibkrCode:e?.ibkrCode??null,twsRequestId:e?.twsRequestId??null};
}
const decimal=z.coerce.number().finite().nonnegative();
const expiration=z.string().regex(/^\d{8}$/);
export function quoteStatus(received:{receivedAtUtc?:string;bid?:number|null;ask?:number|null;feedType?:string;
  marketDataStatus?:string;ibkrErrorCode?:number}|null,now=Date.now()){
  if(received?.ibkrErrorCode===10197)return 'SESSION_CONFLICT_REPORTED';
  if(received?.ibkrErrorCode===10186)return 'DELAYED_DATA_UNAVAILABLE';
  if(received?.ibkrErrorCode===101)return 'SUBSCRIPTION_LIMIT';
  if(received?.marketDataStatus==='permission_denied'||received?.ibkrErrorCode===10089)return 'PERMISSION_DENIED';
  if(received?.marketDataStatus==='unavailable')return 'UNAVAILABLE';
  if(!received)return 'MISSING';
  const receivedAt=received.receivedAtUtc?Date.parse(received.receivedAtUtc):NaN;
  if(!Number.isFinite(receivedAt)||receivedAt>now||now-receivedAt>30000)return 'STALE';
  const complete=received.bid!=null&&received.ask!=null;
  const partial=received.marketDataStatus==='partial'||received.ibkrErrorCode===10090||received.ibkrErrorCode===10091||!complete;
  if(received.feedType==='DELAYED_FROZEN')return partial?'DELAYED_FROZEN_PARTIAL':'DELAYED_FROZEN';
  if(received.feedType==='DELAYED')return partial?'DELAYED_PARTIAL':'DELAYED';
  if(received.feedType==='FROZEN')return partial?'FROZEN_PARTIAL':'FROZEN';
  if(partial)return 'PARTIAL';
  return received.feedType==='LIVE'?'LIVE_UNVERIFIED':'UNKNOWN';
}
function quoteDataStatus(received:{bid?:number|null;ask?:number|null}|null,state:string,subscriptionError:Issue|null=null){
  if(subscriptionError)return subscriptionError.code==='PERMISSION'?'permisos_insuficientes':'suscripcion_fallida';
  if(state==='PERMISSION_DENIED')return 'permisos_insuficientes';
  if(state==='UNAVAILABLE'||state==='DELAYED_DATA_UNAVAILABLE'||state==='SESSION_CONFLICT_REPORTED'||
    state==='SUBSCRIPTION_LIMIT')return 'cotizacion_no_disponible';
  if(!received)return 'cotizacion_pendiente';
  if(state==='STALE')return 'obsoleto';
  if(received.bid==null&&received.ask==null)return 'cotizacion_no_disponible';
  if(state==='PARTIAL'||state.endsWith('_PARTIAL'))return 'cotizacion_parcial';
  return 'recibido';
}
function subscriptionQuoteStatus(received:Parameters<typeof quoteStatus>[0],subscriptionError:Issue|null){
  if(!subscriptionError)return quoteStatus(received);
  return subscriptionError.code==='PERMISSION'?'PERMISSION_DENIED':
    subscriptionError.code==='SUBSCRIPTION_LIMIT'?'SUBSCRIPTION_LIMIT':'SUBSCRIPTION_FAILED';
}
function nyDateKey(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const part=(type:string)=>parts.find(item=>item.type===type)?.value??'';
  return `${part('year')}${part('month')}${part('day')}`;
}

export function registerOptionRoutes(app:FastifyInstance,hub:AgentHub,mode:'DEMO'|'OFFLINE'|'PAPER',demoOptions:()=>unknown[],sqlite:Database.Database){
  let parametersCache:{until:number;connectionId:string|null;items:OptionParameter[]}|null=null;
  let parametersPending:Promise<OptionParameter[]>|null=null;
  const contractCache=new Map<string,{until:number;connectionId:string|null;contract:Record<string,unknown>}>();
  // A negative result belongs to one exact definition and one broker connection.
  const notFoundCache=new Map<string,{until:number;connectionId:string|null;problem:Issue}>();
  const subscriptionFailures=new Map<number,{connectionId:string|null;problem:Issue;until:number}>();
  const rememberSubscriptionFailure=(conId:number,problem:Issue)=>{
    const connectionId=hub.status().connectionId,now=Date.now();
    for(const [id,entry] of subscriptionFailures)if(entry.connectionId!==connectionId||entry.until<=now)
      subscriptionFailures.delete(id);
    subscriptionFailures.set(conId,{connectionId,problem,until:now+60000});
  };
  const parameters=async():Promise<OptionParameter[]>=>{
    if(mode!=='PAPER'||!hub.status().connected)return [];
    if(parametersCache&&parametersCache.until>Date.now()&&parametersCache.connectionId===hub.status().connectionId)return parametersCache.items;
    if(parametersPending)return parametersPending;
    parametersPending=(async()=>{
      const response=await hub.request('option.parameters',{symbol:'NVDA'});
      const items=z.array(z.object({exchange:z.string(),tradingClass:z.string(),multiplier:z.number(),
        expirations:z.array(z.string()),strikes:z.array(z.number())})).parse(response.payload.items)
        .filter(p=>p.tradingClass==='NVDA'&&p.multiplier===100);
      parametersCache={items,until:Date.now()+60000,connectionId:hub.status().connectionId};
      return items;
    })();
    try{return await parametersPending;}finally{parametersPending=null;}
  };
  const unavailable=(reply:any,error:unknown)=>{
    const problem=issue(error);return reply.code(problem.code==='DISCONNECTED'?503:504)
      .send({code:problem.code,error:problem.message,stage:problem.stage,requestId:problem.requestId});
  };
  const validateResolved=(raw:unknown,requested:{right:'CALL'|'PUT';expiration:string;strike:number},requestId:string)=>{
    const result=validateOptionIdentity(raw,{symbol:'NVDA',...requested});
    if(result.contract)return result.contract;
    const c=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};
    app.log.warn({component:'options',event:'contract_identity_mismatch',requestId,twsRequestId:c.twsRequestId??null,
      conId:c.conId??null,requestedSymbol:'NVDA',resolvedSymbol:c.symbol??null,requestedRight:requested.right,
      resolvedRight:c.right??null,requestedExpiration:requested.expiration,resolvedExpiration:c.expiration??null,
      requestedStrike:requested.strike,resolvedStrike:c.strike??null,requestedMultiplier:100,resolvedMultiplier:c.multiplier??null,
      requestedSecType:'OPT',resolvedSecType:c.secType??null,requestedTradingClass:'NVDA',
      resolvedTradingClass:c.tradingClass??null,requestedCurrency:'USD',resolvedCurrency:c.currency??null,
      mismatchFields:result.mismatchFields});
    throw Object.assign(new AgentRequestError('INVALID_CONTRACT','contract_details',requestId,null,
      typeof c.twsRequestId==='number'?c.twsRequestId:null),{mismatchFields:result.mismatchFields});
  };
  const resolutionIssue=(error:unknown,strike:number):Issue=>{
    const fields=error&&typeof error==='object'&&'mismatchFields' in error?(error as {mismatchFields:string[]}).mismatchFields:null;
    return {...issue(error,strike),...(fields?{mismatchFields:fields,message:`Definición incompatible: ${fields.join(', ')}.`}:{})};
  };
  const iexReferences=async()=>{
    try{const response=await app.inject({method:'GET',url:'/api/v1/market/live-technical-context'});
      if(response.statusCode!==200)return {current:null,historical:null,snapshot:null};
      const snapshot=response.json() as Record<string,unknown>;
      const historical=z.object({referencePrice:z.number().positive(),referenceKind:z.literal('HISTORICAL_EXPLORATION'),
        referenceSource:z.literal('ALPACA_IEX_VERIFIED_SESSION_CLOSE'),observedAtUtc:z.iso.datetime(),
        receivedAtUtc:z.iso.datetime(),sessionDate:z.string(),ageTradingSessions:z.number().int().min(0).max(1),
        isCurrent:z.literal(false),isExecutable:z.literal(false)}).safeParse(snapshot.explorationReference);
      return {current:iexBarReference(snapshot),historical:historical.success?historical.data:null,snapshot};
    }catch{return {current:null,historical:null,snapshot:null};}
  };
  const loadContract=async(right:'CALL'|'PUT',strike:number,selectedExpiration:string,consumerId:string,deadline:number,
    academyReference:ReturnType<typeof selectAcademyReference>):Promise<{item:Record<string,unknown>|null;errors:Issue[]}>=>{
    const startedAt=Date.now();
    const diagnosed=(problem:Issue,resolved=false,subscribed=false,quoteReceived=false):Issue=>
      ({...problem,elapsedMs:Date.now()-startedAt,resolved,subscribed,quoteReceived});
    const remaining=deadline-Date.now();
    if(remaining<1000)return {item:null,errors:[diagnosed({...issue(null,strike),code:'PAGE_TIMEOUT',stage:'page_budget',message:messages.PAGE_TIMEOUT!})]};
    const cacheKey=`${selectedExpiration}:${right}:${strike}`,cached=contractCache.get(cacheKey);
    const negative=notFoundCache.get(cacheKey);
    if(negative&&negative.until>Date.now()&&negative.connectionId===hub.status().connectionId)
      return {item:null,errors:[diagnosed(negative.problem)]};
    let resolutionRequestId:string|null=null;
    let contract=cached&&cached.until>Date.now()&&cached.connectionId===hub.status().connectionId?cached.contract:undefined;
    if(!contract){
      try{const response=await hub.request('option.resolve',{expiration:selectedExpiration,right,strike},remaining);
        resolutionRequestId=response.requestId;
        contract=validateResolved(response.payload.contract,{right,expiration:selectedExpiration,strike},response.requestId??'');
        contractCache.set(cacheKey,{contract,until:Date.now()+60000,connectionId:hub.status().connectionId});
        notFoundCache.delete(cacheKey);
      }catch(error){const failure=diagnosed(resolutionIssue(error,strike));
        if(failure.code==='NOT_FOUND'){
          const now=Date.now(),connectionId=hub.status().connectionId;
          for(const [key,entry] of notFoundCache)if(entry.until<=now||entry.connectionId!==connectionId)
            notFoundCache.delete(key);
          notFoundCache.set(cacheKey,{until:now+60000,connectionId,problem:failure});
        }
        app.log.warn({component:'options',event:'chain_resolution_failed',expiration:selectedExpiration,strike,right,
          requestId:failure.requestId,twsRequestId:failure.twsRequestId,stage:failure.stage,code:failure.code,
          ibkrCode:failure.ibkrCode,elapsedMs:failure.elapsedMs,mismatchFields:failure.mismatchFields});
        return {item:null,errors:[failure]};}
    }
    let subscribeError:Issue|null=null;
    try{await hub.subscribe({conId:contract.conId,expiration:selectedExpiration,right,strike},consumerId,deadline-Date.now());
      subscriptionFailures.delete(Number(contract.conId));}
    catch(error){subscribeError=diagnosed(issue(error,strike),true);
      rememberSubscriptionFailure(Number(contract.conId),subscribeError);}
    const received=hub.latestQuote(String(contract.conId)) as {receivedAtUtc?:string;marketTimestampUtc?:string;bid?:number|null;ask?:number|null;feedType?:string;marketDataStatus?:string;ibkrErrorCode?:number;provider?:string}|null;
    const stale=!!received&&(!received.receivedAtUtc||Date.now()-Date.parse(received.receivedAtUtc)>30000);
    const evaluatedQuote=subscribeError?{...(received??{}),marketDataStatus:subscribeError.code==='PERMISSION'?'permission_denied':'unavailable'}:
      received&&hub.status().simulation?{...received,provider:'PAPER SIMULADO'}:received;
    const academyEvaluation=evaluateAcademyAskRange(academyReference,evaluatedQuote,Date.now(),String(contract.currency??'USD'),Number(contract.multiplier??100));
    const quoteState=subscriptionQuoteStatus(received,subscribeError);
    const item={...contract,...(received??{}),academyEvaluation,spread:spread(received?.bid??null,received?.ask??null),
      definitionStatus:'VALID',subscriptionStatus:subscribeError?'FAILED':'ACTIVE',quoteStatus:quoteState,
      diagnostic:{expiration:selectedExpiration,strike,right,requestId:resolutionRequestId,
        twsRequestId:typeof contract.twsRequestId==='number'?contract.twsRequestId:null,
        stage:subscribeError?.stage??'quote',elapsedMs:Date.now()-startedAt,resolved:true,
        subscribed:!subscribeError,quoteReceived:!!received},
      dataStatus:quoteDataStatus(received,quoteState,subscribeError),
      stale,permissions:subscribeError?.code==='PERMISSION'||received?.marketDataStatus==='permission_denied'?'Insuficientes':'No verificados',
      provider:hub.status().simulation?'PAPER SIMULADO':'IBKR'};
    app.log.info({component:'options',event:'chain_contract_checked',expiration:selectedExpiration,strike,right,
      requestId:resolutionRequestId,twsRequestId:item.diagnostic.twsRequestId,elapsedMs:item.diagnostic.elapsedMs,
      resolved:true,subscribed:!subscribeError,quoteReceived:!!received,quoteStatus:quoteState});
    return {item,errors:subscribeError?[subscribeError]:[]};
  };

  app.get('/api/v1/options/expirations',async(_req,reply)=>{
    if(mode==='DEMO')return {items:['2027-01-15'],source:'DEMO sintético'};
    try{return {items:[...new Set((await parameters()).flatMap(p=>p.expirations))].filter(day=>day>=nyDateKey()).sort(),
      source:hub.status().connected?(hub.status().simulation?'Agente simulado':'IBKR Paper'):'IBKR desconectado'};}
    catch(error){return unavailable(reply,error);}
  });
  app.get('/api/v1/options/strikes',async(req,reply)=>{
    const parsed=z.object({expiration:expiration.optional(),minPrice:decimal.optional(),maxPrice:decimal.optional(),
      near:decimal.positive().optional(),
      offset:z.coerce.number().int().min(0).max(100000).default(0),
      limit:z.coerce.number().int().min(1).max(200).default(50)}).safeParse(req.query);
    if(!parsed.success||parsed.data.minPrice!==undefined&&parsed.data.maxPrice!==undefined&&parsed.data.minPrice>parsed.data.maxPrice)
      return reply.code(400).send({error:'Rango de strikes inválido'});
    if(mode==='DEMO')return {items:[210,215,220,225,230],expiration:'2027-01-15',total:5,offset:0,nextOffset:null,source:'DEMO sintético'};
    try{
      const params=await parameters();const selected=parsed.data.expiration??params.flatMap(p=>p.expirations).filter(day=>day>=nyDateKey()).sort()[0]??null;
      const all=selected?availableStrikes(params,selected,parsed.data.minPrice,parsed.data.maxPrice):[];
      const ordered=parsed.data.near===undefined?all:[...all].sort((a,b)=>Math.abs(a-parsed.data.near!)-Math.abs(b-parsed.data.near!)||a-b);
      const {offset,limit}=parsed.data;
      return {items:ordered.slice(offset,offset+limit),expiration:selected,total:ordered.length,offset,
        nextOffset:offset+limit<all.length?offset+limit:null,source:hub.status().simulation?'Agente simulado':'IBKR Paper'};
    }catch(error){return unavailable(reply,error);}
  });
  app.post('/api/v1/options/comparison',async(req,reply)=>{
    const parsed=OptionComparisonRequest.safeParse(req.body);
    if(!parsed.success)return reply.code(400).send({error:'Seleccion de contrato invalida'});
    const {conId,consumerId}=parsed.data;
    if(mode==='DEMO'){
      const item=(demoOptions() as Array<Record<string,unknown>>).find(row=>row.conId===conId);
      if(!item)return reply.code(404).send({error:'Contrato no encontrado'});
      return {item:{...item,academyEvaluation:{status:'INSUFFICIENT_DATA',referenceStatus:'NONE',reference:null,askCents:null,distancePercent:null,quoteReceivedAtUtc:null,reason:'DEMO usa contratos sinteticos; no se comparan con referencias documentales'}},source:'DEMO sintetico'};
    }
    if(mode!=='PAPER'||!hub.status().connected)return reply.code(503).send({error:'IBKR Paper desconectado'});
    const cached=[...contractCache.values()].find(entry=>entry.until>Date.now()&&
      entry.connectionId===hub.status().connectionId&&entry.contract.conId===conId);
    if(!cached)return reply.code(404).send({error:'Contrato no disponible; vuelva a consultarlo en la cadena'});
    const contract=cached.contract;
    let subscribeError:Issue|null=null;
    try{await hub.subscribe({conId,expiration:contract.expiration,right:contract.right,strike:contract.strike},consumerId);
      subscriptionFailures.delete(conId);}
    catch(error){subscribeError=issue(error,Number(contract.strike));
      rememberSubscriptionFailure(conId,subscribeError);}
    const received=hub.latestQuote(String(conId)) as {receivedAtUtc?:string;marketTimestampUtc?:string;bid?:number|null;ask?:number|null;feedType?:string;marketDataStatus?:string;provider?:string}|null;
    const stale=!!received&&(!received.receivedAtUtc||Date.now()-Date.parse(received.receivedAtUtc)>30000);
    const right=contract.right==='PUT'?'PUT':'CALL';
    const reference=selectAcademyReference(academyRanges(sqlite,'NVDA'),new Date().toISOString(),right);
    const evaluatedQuote=subscribeError?{...(received??{}),marketDataStatus:subscribeError.code==='PERMISSION'?'permission_denied':'unavailable'}:
      received&&hub.status().simulation?{...received,provider:'PAPER SIMULADO'}:received;
    const academyEvaluation=evaluateAcademyAskRange(reference,evaluatedQuote,Date.now(),String(contract.currency??'USD'),Number(contract.multiplier??100));
    const quoteState=subscriptionQuoteStatus(received,subscribeError);
    return {item:{...contract,...(received??{}),academyEvaluation,spread:spread(received?.bid??null,received?.ask??null),
      definitionStatus:'VALID',subscriptionStatus:subscribeError?'FAILED':'ACTIVE',quoteStatus:quoteState,
      dataStatus:quoteDataStatus(received,quoteState,subscribeError),
      permissions:subscribeError?.code==='PERMISSION'||received?.marketDataStatus==='permission_denied'?'Insuficientes':'No verificados',
      stale,provider:hub.status().simulation?'PAPER SIMULADO':'IBKR'},error:subscribeError,source:hub.status().simulation?'Agente simulado':'IBKR Paper'};
  });
  // Poll only the quotes for contracts already resolved by the chain. No new TWS requests or subscriptions.
  app.get('/api/v1/options/quotes',async(req,reply)=>{
    const parsed=z.object({conIds:z.string().regex(/^\d{1,12}(?:,\d{1,12}){0,9}$/).optional()}).safeParse(req.query);
    if(!parsed.success)return reply.code(400).send({error:'Contratos inválidos'});
    const ids=parsed.data.conIds?[...new Set(parsed.data.conIds.split(',').map(Number))]:[];
    if(mode==='DEMO')return {items:(demoOptions() as Array<Record<string,unknown>>).filter(item=>!parsed.data.conIds||ids.includes(Number(item.conId))),source:'DEMO sintético'};
    if(mode!=='PAPER'||!hub.status().connected||!parsed.data.conIds)return {items:[],source:'Consulte /options/contracts para suscribirse a contratos visibles'};
    const items=ids.flatMap(conId=>{
      const entry=[...contractCache.values()].find(value=>value.until>Date.now()&&
        value.connectionId===hub.status().connectionId&&value.contract.conId===conId);
      if(!entry)return [];
      const contract=entry.contract;
      const recorded=subscriptionFailures.get(conId);
      const subscribeError=recorded?.connectionId===hub.status().connectionId&&recorded.until>Date.now()?recorded.problem:null;
      const received=hub.latestQuote(String(conId)) as {receivedAtUtc?:string;marketTimestampUtc?:string;bid?:number|null;ask?:number|null;
        feedType?:string;marketDataStatus?:string;ibkrErrorCode?:number;provider?:string}|null;
      const stale=!!received&&(!received.receivedAtUtc||Date.now()-Date.parse(received.receivedAtUtc)>30000);
      const reference=selectAcademyReference(academyRanges(sqlite,'NVDA'),new Date().toISOString(),contract.right==='PUT'?'PUT':'CALL');
      const evaluatedQuote=subscribeError?{...(received??{}),marketDataStatus:subscribeError.code==='PERMISSION'?'permission_denied':'unavailable'}:
        received&&hub.status().simulation?{...received,provider:'PAPER SIMULADO'}:received;
      const academyEvaluation=evaluateAcademyAskRange(reference,evaluatedQuote,Date.now(),String(contract.currency??'USD'),Number(contract.multiplier));
      const quoteState=subscriptionQuoteStatus(received,subscribeError);
      return [{...contract,...(received??{}),academyEvaluation,spread:spread(received?.bid??null,received?.ask??null),
        definitionStatus:'VALID',subscriptionStatus:subscribeError?'FAILED':'NOT_VERIFIED_BY_READ',quoteStatus:quoteState,
        dataStatus:quoteDataStatus(received,quoteState,subscribeError),stale,
        permissions:subscribeError?.code==='PERMISSION'||received?.marketDataStatus==='permission_denied'?'Insuficientes':'No verificados',
        provider:hub.status().simulation?'PAPER SIMULADO':'IBKR'}];
    });
    return {items,source:hub.status().simulation?'Agente simulado':'IBKR Paper'};
  });
  app.get('/api/v1/options/contracts',async(req,reply)=>{
    if(mode==='DEMO')return {items:(demoOptions() as Array<Record<string,unknown>>).map(item=>({...item,academyEvaluation:{status:'INSUFFICIENT_DATA',referenceStatus:'NONE',reference:null,askCents:null,distancePercent:null,quoteReceivedAtUtc:null,reason:'DEMO usa contratos sintéticos; no se comparan con referencias documentales'}})),errors:[],source:'DEMO sintético'};
    if(mode!=='PAPER'||!hub.status().connected)return {items:[],errors:[],source:'IBKR desconectado'};
    const parsed=z.object({right:z.enum(['CALL','PUT']).default('CALL'),expiration:expiration.optional(),
      limit:z.coerce.number().int().min(1).max(10).default(5),consumerId:z.uuid(),
      centerStrike:decimal.positive().optional(),minPrice:decimal.optional(),maxPrice:decimal.optional()}).safeParse(req.query);
    if(!parsed.success||parsed.data.minPrice!==undefined&&parsed.data.maxPrice!==undefined&&parsed.data.minPrice>parsed.data.maxPrice)
      return reply.code(400).send({error:'Consulta de opciones inválida'});
    const query=parsed.data;
    let params:OptionParameter[];
    try{params=await parameters();}catch(error){return unavailable(reply,error);}
    const today=nyDateKey();
    const selectedExpiration=query.expiration??params.flatMap(p=>p.expirations).filter(day=>day>=today).sort()[0]??null;
    if(!selectedExpiration)return {items:[],errors:[],source:'IBKR sin vencimientos',selectionRequired:false};
    const all=availableStrikes(params,selectedExpiration,query.minPrice,query.maxPrice);
    const quote=hub.latestQuote('NVDA') as {last?:unknown;receivedAtUtc?:unknown;feedType?:unknown;provider?:unknown}|null;
    const marketReference=hub.status().simulation?null:quoteReference(quote);
    let iexReference:number|null=null,iexSnapshot:Record<string,unknown>|null=null,historical:Awaited<ReturnType<typeof iexReferences>>['historical']=null;
    if(query.centerStrike===undefined&&marketReference===null){
      const found=await iexReferences();iexReference=found.current;historical=found.historical;
      if(iexReference!==null)iexSnapshot=found.snapshot;
    }
    const reference=query.centerStrike??marketReference??iexReference??historical?.referencePrice??null;
    const strikes=reference!==null?selectContractStrikes(all,query.limit,reference):
      query.minPrice!==undefined||query.maxPrice!==undefined?all.slice(0,query.limit):[];
    const selectionRequired=strikes.length===0&&all.length>0&&reference===null&&
      query.minPrice===undefined&&query.maxPrice===undefined;
    const referenceSource=query.centerStrike!==undefined?'MANUAL_STRIKE':marketReference!==null?
      'IBKR_LAST_OBSERVED':iexReference!==null?'ALPACA_IEX_LAST_COMPLETE_BAR':historical?'ALPACA_IEX_VERIFIED_SESSION_CLOSE':query.minPrice!==undefined||query.maxPrice!==undefined?'MANUAL_RANGE_ASCENDING':'NONE';
    const items:Array<Record<string,unknown>>=[],errors:Issue[]=[];
    const academyReference=selectAcademyReference(academyRanges(sqlite,'NVDA'),new Date().toISOString(),query.right);
    const deadline=Date.now()+hub.optionPageTimeoutMs();
    // Resolve nearby strikes first. Sequential requests preserve IBKR pacing.
    for(const strike of [...strikes].sort((a,b)=>Math.abs(a-reference!)-Math.abs(b-reference!)||a-b)){
      const result=await loadContract(query.right,strike,selectedExpiration,query.consumerId,deadline,academyReference);
      if(result.item)items.push(result.item);
      errors.push(...result.errors);
    }
    return {items,errors,source:hub.status().simulation?'Agente simulado':'IBKR Paper',
      expiration:selectedExpiration,selectionRequired,referenceSource,referencePrice:reference,
      referenceObservedAtUtc:query.centerStrike!==undefined?null:marketReference!==null?quote?.receivedAtUtc??null:iexReference!==null?iexSnapshot?.barEndUtc??null:historical?.observedAtUtc??null,
      referenceReceivedAtUtc:query.centerStrike!==undefined?null:marketReference!==null?quote?.receivedAtUtc??null:iexReference!==null?iexSnapshot?.receivedAtUtc??null:historical?.receivedAtUtc??null,
      referenceKind:historical&&query.centerStrike===undefined&&marketReference===null&&iexReference===null?'HISTORICAL_EXPLORATION':'CURRENT_OR_MANUAL',
      sessionDate:historical?.sessionDate??null,ageTradingSessions:historical?.ageTradingSessions??null,
      isCurrent:marketReference!==null||iexReference!==null,isExecutable:false,
      strikeCount:all.length};
  });
  app.get('/api/v1/options/chain',async(req,reply)=>{
    const parsed=z.object({expiration:expiration.optional(),strikeLevels:z.coerce.number().int().refine(n=>n===3||n===5).default(3),
      consumerId:z.uuid(),centerStrike:decimal.positive().optional(),side:z.enum(['BOTH','CALL','PUT']).default('BOTH')}).safeParse(req.query);
    if(!parsed.success)return reply.code(400).send({error:'Consulta de cadena inválida: elija 3 o 5 niveles'});
    const query=parsed.data;
    if(mode==='DEMO'){
      const demo=demoOptions() as Array<Record<string,unknown>>;
      const strikes=selectContractStrikes([...new Set(demo.map(row=>Number(row.strike)))],query.strikeLevels,query.centerStrike??220);
      return {expiration:'2027-01-15',rows:strikes.map(strike=>({strike,
        call:query.side==='PUT'?null:demo.find(row=>row.strike===strike&&row.right==='CALL')??null,
        put:query.side==='CALL'?null:demo.find(row=>row.strike===strike&&row.right==='PUT')??null,issues:[]})),errors:[],source:'DEMO sintético',
        selectionRequired:false,referenceSource:query.centerStrike===undefined?'DEMO_SYNTHETIC':'MANUAL_STRIKE',
        referencePrice:query.centerStrike??220,referenceObservedAtUtc:null,referenceReceivedAtUtc:null,
        subscriptionStatus:{requested:strikes.length*(query.side==='BOTH'?2:1),limit:10}};
    }
    if(mode!=='PAPER'||!hub.status().connected)return {expiration:null,rows:[],errors:[],source:'IBKR desconectado',
      selectionRequired:false,referenceSource:'NONE',referencePrice:null,subscriptionStatus:{requested:0,limit:10}};
    let params:OptionParameter[];
    try{params=await parameters();}catch(error){return unavailable(reply,error);}
    const selectedExpiration=query.expiration??params.flatMap(p=>p.expirations).filter(day=>day>=nyDateKey()).sort()[0]??null;
    if(!selectedExpiration)return {expiration:null,rows:[],errors:[],source:'IBKR sin vencimientos',
      selectionRequired:false,referenceSource:'NONE',referencePrice:null,subscriptionStatus:{requested:0,limit:10}};
    const all=availableStrikes(params,selectedExpiration);
    const quote=hub.latestQuote('NVDA') as {last?:unknown;receivedAtUtc?:unknown;feedType?:unknown;provider?:unknown}|null;
    const marketReference=hub.status().simulation?null:quoteReference(quote);
    let iexReference:number|null=null,iexSnapshot:Record<string,unknown>|null=null,historical:Awaited<ReturnType<typeof iexReferences>>['historical']=null;
    if(query.centerStrike===undefined&&marketReference===null){
      const found=await iexReferences();iexReference=found.current;historical=found.historical;
      if(iexReference!==null)iexSnapshot=found.snapshot;
    }
    const reference=query.centerStrike??marketReference??iexReference??historical?.referencePrice??null;
    const strikes=selectContractStrikes(all,query.strikeLevels,reference);
    const errors:Issue[]=[],rows:Array<{strike:number;call:Record<string,unknown>|null;put:Record<string,unknown>|null;issues:Issue[];
      replacementFor?:{right:'CALL'|'PUT';requestedStrike:number}}>=[];
    const references={CALL:selectAcademyReference(academyRanges(sqlite,'NVDA'),new Date().toISOString(),'CALL'),
      PUT:selectAcademyReference(academyRanges(sqlite,'NVDA'),new Date().toISOString(),'PUT')};
    const deadline=Date.now()+hub.optionPageTimeoutMs();
    // A shared page budget reaches the central CALL/PUT pair first; keep the displayed rows sorted.
    for(const strike of [...strikes].sort((a,b)=>Math.abs(a-reference!)-Math.abs(b-reference!)||a-b)){
      const row:{strike:number;call:Record<string,unknown>|null;put:Record<string,unknown>|null;issues:Issue[]}=
        {strike,call:null,put:null,issues:[]};
      for(const right of (query.side==='BOTH'?['CALL','PUT']:[query.side]) as Array<'CALL'|'PUT'>){
        const result=await loadContract(right,strike,selectedExpiration,query.consumerId,deadline,references[right]);
        row[right.toLowerCase() as 'call'|'put']=result.item;
        const sideIssues=result.errors.map(error=>({...error,right}));row.issues.push(...sideIssues);errors.push(...sideIssues);
      }
      rows.push(row);
    }
    // At most two extra contract resolutions per page, only after a definitive NOT_FOUND.
    // A replacement is a separate, correctly identified strike, never a substituted conId.
    let additionalAttempts=0,notFoundCount=0,resolvedCount=0;
    const fallbackAttempts:Array<{requestedStrike:number;resolvedStrike:number|null;right:'CALL'|'PUT';expiration:string;
      attemptedCount:number;notFoundCount:number;resolvedCount:number;reason:string}>=[];
    const attempted=new Set(strikes.map(String));
    const candidates=reference===null?[]:[...all].sort((a,b)=>Math.abs(a-reference)-Math.abs(b-reference)||a-b);
    for(const missing of [...rows]){
      for(const right of (query.side==='BOTH'?['CALL','PUT']:[query.side]) as Array<'CALL'|'PUT'>){
        if(!missing.issues.some(item=>item.right===right&&item.code==='NOT_FOUND'))continue;
        notFoundCount++;
        let replacement:number|undefined,reason='BUDGET_EXHAUSTED',sideAttempts=0,sideNotFound=0,sideResolved=0;
        while(additionalAttempts<2&&deadline-Date.now()>=1000){
          replacement=candidates.find(strike=>{
            if(attempted.has(String(strike)))return false;
            const known=notFoundCache.get(`${selectedExpiration}:${right}:${strike}`);
            return !known||known.until<=Date.now()||known.connectionId!==hub.status().connectionId;
          });
          if(replacement===undefined){reason='NO_CANDIDATES';break;}
          attempted.add(String(replacement));additionalAttempts++;sideAttempts++;
          const result=await loadContract(right,replacement,selectedExpiration,query.consumerId,deadline,references[right]);
          const sideIssues=result.errors.map(error=>({...error,right}));errors.push(...sideIssues);
          if(result.item){resolvedCount++;sideResolved++;reason='RESOLVED';
            rows.push({strike:replacement,call:right==='CALL'?result.item:null,put:right==='PUT'?result.item:null,
              issues:sideIssues,replacementFor:{right,requestedStrike:missing.strike}});break;
          }
          if(sideIssues.length){rows.push({strike:replacement,call:null,put:null,issues:sideIssues,
            replacementFor:{right,requestedStrike:missing.strike}});}
          if(!sideIssues.some(item=>item.code==='NOT_FOUND')){reason=sideIssues[0]?.code??'NO_RESULT';break;}
          notFoundCount++;sideNotFound++;reason='NOT_FOUND';
        }
        fallbackAttempts.push({requestedStrike:missing.strike,resolvedStrike:sideResolved?replacement??null:null,
          right,expiration:selectedExpiration,attemptedCount:sideAttempts,notFoundCount:sideNotFound,
          resolvedCount:sideResolved,reason});
      }
    }
    rows.sort((a,b)=>a.strike-b.strike);
    return {expiration:selectedExpiration,rows,errors,source:hub.status().simulation?'Agente simulado':'IBKR Paper',
      selectionRequired:reference===null&&all.length>0,referenceSource:query.centerStrike!==undefined?'MANUAL_STRIKE':
        marketReference!==null?'IBKR_LAST_OBSERVED':iexReference!==null?'ALPACA_IEX_LAST_COMPLETE_BAR':historical?'ALPACA_IEX_VERIFIED_SESSION_CLOSE':'NONE',
      referencePrice:reference,
      referenceObservedAtUtc:query.centerStrike!==undefined?null:marketReference!==null?quote?.receivedAtUtc??null:iexReference!==null?iexSnapshot?.barEndUtc??null:historical?.observedAtUtc??null,
      referenceReceivedAtUtc:query.centerStrike!==undefined?null:marketReference!==null?quote?.receivedAtUtc??null:iexReference!==null?iexSnapshot?.receivedAtUtc??null:historical?.receivedAtUtc??null,
      referenceKind:historical&&query.centerStrike===undefined&&marketReference===null&&iexReference===null?'HISTORICAL_EXPLORATION':'CURRENT_OR_MANUAL',
      sessionDate:historical?.sessionDate??null,ageTradingSessions:historical?.ageTradingSessions??null,
      isCurrent:marketReference!==null||iexReference!==null,isExecutable:false,
      subscriptionStatus:{requested:strikes.length*(query.side==='BOTH'?2:1),limit:10},
      fallback:{additionalAttemptLimit:2,attemptedCount:additionalAttempts,notFoundCount,resolvedCount,attempts:fallbackAttempts}};
  });
  /** Bounded background inspection for 41O. Reuses parameters and the same contract cache. */
  const inspectOpportunity=async(right:'CALL'|'PUT',referencePrice:number,count:number,consumerId:string)=>{
    if(mode!=='PAPER'||!hub.status().connected)return {items:[],errors:[issue(new AgentRequestError('DISCONNECTED','backend',''))]};
    const params=await parameters(),today=nyDateKey();
    const selectedExpiration=[...new Set(params.flatMap(p=>p.expirations))].filter(day=>day>=today).sort()[0];
    if(!selectedExpiration)return {items:[],errors:[]};
    const strikes=selectContractStrikes(availableStrikes(params,selectedExpiration),Math.min(Math.max(count,1),4),referencePrice);
    const items:Array<{contract:Record<string,unknown>;quote:Record<string,unknown>|null;error:Issue|null}>=[],errors:Issue[]=[];
    const deadline=Date.now()+hub.optionPageTimeoutMs();
    for(const strike of strikes){
      const remaining=deadline-Date.now();if(remaining<1000){errors.push({...issue(null,strike),code:'PAGE_TIMEOUT',message:messages.PAGE_TIMEOUT!});break;}
      const cacheKey=`${selectedExpiration}:${right}:${strike}`,cached=contractCache.get(cacheKey);
      let contract=cached&&cached.until>Date.now()&&cached.connectionId===hub.status().connectionId?cached.contract:undefined;
      try{
        if(!contract){const response=await hub.request('option.resolve',{expiration:selectedExpiration,right,strike},remaining);
          contract=validateResolved(response.payload.contract,{right,expiration:selectedExpiration,strike},response.requestId??'');
          contractCache.set(cacheKey,{contract,until:Date.now()+60000,connectionId:hub.status().connectionId});
        }
      }catch(error){errors.push(resolutionIssue(error,strike));continue;}
      let subscribeError:Issue|null=null;
      try{
        await hub.subscribe({conId:contract.conId,expiration:selectedExpiration,right,strike},consumerId,Math.max(1000,deadline-Date.now()));
        if(!hub.latestQuote(String(contract.conId)))await new Promise(done=>setTimeout(done,Math.min(800,Math.max(0,deadline-Date.now()))));
        const quote=hub.latestQuote(String(contract.conId)) as Record<string,unknown>|null;
        items.push({contract,quote,error:null});
      }catch(error){subscribeError=issue(error,strike);errors.push(subscribeError);items.push({contract,quote:null,error:subscribeError});}
      finally{await hub.release(String(contract.conId),consumerId).catch(()=>{});}
    }
    return {items,errors};
  };
  // Read only: simulator may use a contract already resolved for the visible chain.
  // This accessor never resolves a new contract or opens a market subscription.
  return {inspectOpportunity,cachedContract:(conId:number):Record<string,unknown>|null=>{
    if(mode==='DEMO')return (demoOptions() as Array<Record<string,unknown>>).find(row=>row.conId===conId)??null;
    if(mode!=='PAPER'||!hub.status().connected)return null;
    return [...contractCache.values()].find(entry=>entry.until>Date.now()&&
      entry.connectionId===hub.status().connectionId&&entry.contract.conId===conId)?.contract??null;
  }};
}
