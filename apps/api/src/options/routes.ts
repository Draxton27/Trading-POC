import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {spread} from '@trading-poc/market-domain';
import {AgentHub,AgentRequestError} from '../streams/agent-hub.ts';
import {availableStrikes,selectContractStrikes,quoteReference,iexBarReference,type OptionParameter} from './selection.ts';
import {validateOptionIdentity} from './identity.ts';
import type Database from 'better-sqlite3';
import {academyRanges,evaluateAcademyAskRange,selectAcademyReference} from '../academy/service.ts';
import {OptionComparisonRequest} from '@trading-poc/contracts';

type Issue={strike:number|null;code:string;message:string;stage:string;requestId:string|null;ibkrCode:number|null;mismatchFields?:string[];right?:'CALL'|'PUT'};
const messages:Record<string,string>={
  TIMEOUT:'La solicitud tardó demasiado; vuelva a intentar este contrato.',
  PAGE_TIMEOUT:'Se agotó el tiempo de esta página; reduzca el número de contratos.',
  NOT_FOUND:'Contrato no encontrado en IBKR.',
  AMBIGUOUS:'IBKR devolvió más de un contrato; se necesita una definición más precisa.',
  PERMISSION:'Permisos de mercado insuficientes para esta solicitud.',
  PACING:'IBKR limitó las solicitudes; espere antes de reintentar.',
  DISCONNECTED:'El agente Paper se desconectó.',
  LIMIT:'Se alcanzó el límite de suscripciones visibles.',
  INVALID_CONTRACT:'La definición recibida no coincide con el contrato solicitado.',
  BROKER_ERROR:'IBKR no pudo completar la solicitud.'
};
function issue(error:unknown,strike:number|null=null):Issue{
  const e=error instanceof AgentRequestError?error:null;
  const code=e?.code??(error instanceof Error&&/límite de 10/i.test(error.message)?'LIMIT':'BROKER_ERROR');
  return {strike,code,message:messages[code]??messages.BROKER_ERROR!,stage:e?.stage??'backend',
    requestId:e?.requestId||null,ibkrCode:e?.ibkrCode??null};
}
const decimal=z.coerce.number().finite().nonnegative();
const expiration=z.string().regex(/^\d{8}$/);
function nyDateKey(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const part=(type:string)=>parts.find(item=>item.type===type)?.value??'';
  return `${part('year')}${part('month')}${part('day')}`;
}

export function registerOptionRoutes(app:FastifyInstance,hub:AgentHub,mode:'DEMO'|'OFFLINE'|'PAPER',demoOptions:()=>unknown[],sqlite:Database.Database){
  let parametersCache:{until:number;connectionId:string|null;items:OptionParameter[]}|null=null;
  let parametersPending:Promise<OptionParameter[]>|null=null;
  const contractCache=new Map<string,{until:number;connectionId:string|null;contract:Record<string,unknown>}>();
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
    throw Object.assign(new AgentRequestError('INVALID_CONTRACT','contract_details',requestId),{mismatchFields:result.mismatchFields});
  };
  const resolutionIssue=(error:unknown,strike:number):Issue=>{
    const fields=error&&typeof error==='object'&&'mismatchFields' in error?(error as {mismatchFields:string[]}).mismatchFields:null;
    return {...issue(error,strike),...(fields?{mismatchFields:fields,message:`Definición incompatible: ${fields.join(', ')}.`}:{})};
  };
  const loadContract=async(right:'CALL'|'PUT',strike:number,selectedExpiration:string,consumerId:string,deadline:number,
    academyReference:ReturnType<typeof selectAcademyReference>):Promise<{item:Record<string,unknown>|null;errors:Issue[]}>=>{
    const remaining=deadline-Date.now();
    if(remaining<1000)return {item:null,errors:[{...issue(null,strike),code:'PAGE_TIMEOUT',message:messages.PAGE_TIMEOUT!}]};
    const cacheKey=`${selectedExpiration}:${right}:${strike}`,cached=contractCache.get(cacheKey);
    let contract=cached&&cached.until>Date.now()&&cached.connectionId===hub.status().connectionId?cached.contract:undefined;
    if(!contract){
      try{const response=await hub.request('option.resolve',{expiration:selectedExpiration,right,strike},remaining);
        contract=validateResolved(response.payload.contract,{right,expiration:selectedExpiration,strike},response.requestId??'');
        contractCache.set(cacheKey,{contract,until:Date.now()+60000,connectionId:hub.status().connectionId});
      }catch(error){return {item:null,errors:[resolutionIssue(error,strike)]};}
    }
    let subscribeError:Issue|null=null;
    try{await hub.subscribe({conId:contract.conId,expiration:selectedExpiration,right,strike},consumerId,deadline-Date.now());}
    catch(error){subscribeError=issue(error,strike);}
    const received=hub.latestQuote(String(contract.conId)) as {receivedAtUtc?:string;marketTimestampUtc?:string;bid?:number|null;ask?:number|null;feedType?:string;marketDataStatus?:string;ibkrErrorCode?:number;provider?:string}|null;
    const stale=!!received&&(!received.receivedAtUtc||Date.now()-Date.parse(received.receivedAtUtc)>30000);
    const noBidAsk=!received||received.bid==null&&received.ask==null;
    const evaluatedQuote=received&&hub.status().simulation?{...received,provider:'PAPER SIMULADO'}:received;
    const academyEvaluation=evaluateAcademyAskRange(academyReference,evaluatedQuote,Date.now(),String(contract.currency??'USD'),Number(contract.multiplier??100));
    const item={...contract,...(received??{}),academyEvaluation,spread:spread(received?.bid??null,received?.ask??null),
      dataStatus:subscribeError?subscribeError.code==='PERMISSION'?'permisos_insuficientes':'suscripcion_fallida':
        !received?'cotizacion_pendiente':stale?'obsoleto':received.marketDataStatus==='permission_denied'?'permisos_insuficientes':
        received.marketDataStatus==='partial'?'cotizacion_parcial':received.marketDataStatus==='unavailable'||noBidAsk?'cotizacion_no_disponible':'recibido',
      stale,permissions:subscribeError?.code==='PERMISSION'||received?.marketDataStatus==='permission_denied'?'Insuficientes':'No verificados',
      provider:hub.status().simulation?'PAPER SIMULADO':'IBKR'};
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
      offset:z.coerce.number().int().min(0).max(100000).default(0),
      limit:z.coerce.number().int().min(1).max(200).default(50)}).safeParse(req.query);
    if(!parsed.success||parsed.data.minPrice!==undefined&&parsed.data.maxPrice!==undefined&&parsed.data.minPrice>parsed.data.maxPrice)
      return reply.code(400).send({error:'Rango de strikes inválido'});
    if(mode==='DEMO')return {items:[210,215,220,225,230],expiration:'2027-01-15',total:5,offset:0,nextOffset:null,source:'DEMO sintético'};
    try{
      const params=await parameters();const selected=parsed.data.expiration??params.flatMap(p=>p.expirations).filter(day=>day>=nyDateKey()).sort()[0]??null;
      const all=selected?availableStrikes(params,selected,parsed.data.minPrice,parsed.data.maxPrice):[];
      const {offset,limit}=parsed.data;
      return {items:all.slice(offset,offset+limit),expiration:selected,total:all.length,offset,
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
    const cached=[...contractCache.values()].find(entry=>entry.contract.conId===conId);
    if(!cached)return reply.code(404).send({error:'Contrato no disponible; vuelva a consultarlo en la cadena'});
    const contract=cached.contract;
    let subscribeError:Issue|null=null;
    try{await hub.subscribe({conId,expiration:contract.expiration,right:contract.right,strike:contract.strike},consumerId);}
    catch(error){subscribeError=issue(error,Number(contract.strike));}
    const received=hub.latestQuote(String(conId)) as {receivedAtUtc?:string;marketTimestampUtc?:string;bid?:number|null;ask?:number|null;feedType?:string;marketDataStatus?:string;provider?:string}|null;
    const stale=!!received&&(!received.receivedAtUtc||Date.now()-Date.parse(received.receivedAtUtc)>30000);
    const right=contract.right==='PUT'?'PUT':'CALL';
    const reference=selectAcademyReference(academyRanges(sqlite,'NVDA'),new Date().toISOString(),right);
    const evaluatedQuote=subscribeError?.code==='PERMISSION'?{...(received??{}),marketDataStatus:'permission_denied'}:
      received&&hub.status().simulation?{...received,provider:'PAPER SIMULADO'}:received;
    const academyEvaluation=evaluateAcademyAskRange(reference,evaluatedQuote,Date.now(),String(contract.currency??'USD'),Number(contract.multiplier??100));
    return {item:{...contract,...(received??{}),academyEvaluation,spread:spread(received?.bid??null,received?.ask??null),
      dataStatus:subscribeError?subscribeError.code==='PERMISSION'?'permisos_insuficientes':'suscripcion_fallida':
        !received?'cotizacion_pendiente':stale?'obsoleto':received.marketDataStatus==='permission_denied'?'permisos_insuficientes':
        received.marketDataStatus==='partial'?'cotizacion_parcial':received.marketDataStatus==='unavailable'||received.bid==null&&received.ask==null?'cotizacion_no_disponible':'recibido',
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
      const received=hub.latestQuote(String(conId)) as {receivedAtUtc?:string;marketTimestampUtc?:string;bid?:number|null;ask?:number|null;
        feedType?:string;marketDataStatus?:string;provider?:string}|null;
      const stale=!!received&&(!received.receivedAtUtc||Date.now()-Date.parse(received.receivedAtUtc)>30000);
      const reference=selectAcademyReference(academyRanges(sqlite,'NVDA'),new Date().toISOString(),contract.right==='PUT'?'PUT':'CALL');
      const evaluatedQuote=received&&hub.status().simulation?{...received,provider:'PAPER SIMULADO'}:received;
      const academyEvaluation=evaluateAcademyAskRange(reference,evaluatedQuote,Date.now(),String(contract.currency??'USD'),Number(contract.multiplier));
      return [{...contract,...(received??{}),academyEvaluation,spread:spread(received?.bid??null,received?.ask??null),
        dataStatus:!received?'cotizacion_pendiente':stale?'obsoleto':received.marketDataStatus==='permission_denied'?'permisos_insuficientes':
          received.marketDataStatus==='partial'?'cotizacion_parcial':received.marketDataStatus==='unavailable'||received.bid==null&&received.ask==null?
          'cotizacion_no_disponible':'recibido',stale,permissions:received?.marketDataStatus==='permission_denied'?'Insuficientes':'No verificados',
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
    let iexReference:number|null=null,iexSnapshot:Record<string,unknown>|null=null;
    if(query.centerStrike===undefined&&marketReference===null){
      try{const response=await app.inject({method:'GET',url:'/api/v1/market/live-technical-context'});
        if(response.statusCode===200){const snapshot=response.json() as Record<string,unknown>;
          iexReference=iexBarReference(snapshot);if(iexReference!==null)iexSnapshot=snapshot;}}catch{/* No verified IEX reference. */}
    }
    const reference=query.centerStrike??marketReference??iexReference;
    const strikes=reference!==null?selectContractStrikes(all,query.limit,reference):
      query.minPrice!==undefined||query.maxPrice!==undefined?all.slice(0,query.limit):[];
    const selectionRequired=strikes.length===0&&all.length>0&&reference===null&&
      query.minPrice===undefined&&query.maxPrice===undefined;
    const referenceSource=query.centerStrike!==undefined?'MANUAL_STRIKE':marketReference!==null?
      'IBKR_LAST_OBSERVED':iexReference!==null?'ALPACA_IEX_LAST_COMPLETE_BAR':query.minPrice!==undefined||query.maxPrice!==undefined?'MANUAL_RANGE_ASCENDING':'NONE';
    const items:Array<Record<string,unknown>>=[],errors:Issue[]=[];
    const academyReference=selectAcademyReference(academyRanges(sqlite,'NVDA'),new Date().toISOString(),query.right);
    const deadline=Date.now()+hub.optionPageTimeoutMs();
    for(const strike of strikes){
      const result=await loadContract(query.right,strike,selectedExpiration,query.consumerId,deadline,academyReference);
      if(result.item)items.push(result.item);
      errors.push(...result.errors);
    }
    return {items,errors,source:hub.status().simulation?'Agente simulado':'IBKR Paper',
      expiration:selectedExpiration,selectionRequired,referenceSource,referencePrice:reference,
      referenceObservedAtUtc:query.centerStrike!==undefined?null:marketReference!==null?quote?.receivedAtUtc??null:iexSnapshot?.barEndUtc??null,
      referenceReceivedAtUtc:query.centerStrike!==undefined?null:marketReference!==null?quote?.receivedAtUtc??null:iexSnapshot?.receivedAtUtc??null,
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
    let iexReference:number|null=null,iexSnapshot:Record<string,unknown>|null=null;
    if(query.centerStrike===undefined&&marketReference===null){
      try{const response=await app.inject({method:'GET',url:'/api/v1/market/live-technical-context'});
        if(response.statusCode===200){const snapshot=response.json() as Record<string,unknown>;
          iexReference=iexBarReference(snapshot);if(iexReference!==null)iexSnapshot=snapshot;}}catch{/* No verified IEX reference. */}
    }
    const reference=query.centerStrike??marketReference??iexReference;
    const strikes=selectContractStrikes(all,query.strikeLevels,reference);
    const errors:Issue[]=[],rows:Array<{strike:number;call:Record<string,unknown>|null;put:Record<string,unknown>|null;issues:Issue[]}>=[];
    const references={CALL:selectAcademyReference(academyRanges(sqlite,'NVDA'),new Date().toISOString(),'CALL'),
      PUT:selectAcademyReference(academyRanges(sqlite,'NVDA'),new Date().toISOString(),'PUT')};
    const deadline=Date.now()+hub.optionPageTimeoutMs();
    for(const strike of strikes){
      const row:{strike:number;call:Record<string,unknown>|null;put:Record<string,unknown>|null;issues:Issue[]}=
        {strike,call:null,put:null,issues:[]};
      for(const right of (query.side==='BOTH'?['CALL','PUT']:[query.side]) as Array<'CALL'|'PUT'>){
        const result=await loadContract(right,strike,selectedExpiration,query.consumerId,deadline,references[right]);
        row[right.toLowerCase() as 'call'|'put']=result.item;
        const sideIssues=result.errors.map(error=>({...error,right}));row.issues.push(...sideIssues);errors.push(...sideIssues);
      }
      rows.push(row);
    }
    return {expiration:selectedExpiration,rows,errors,source:hub.status().simulation?'Agente simulado':'IBKR Paper',
      selectionRequired:reference===null&&all.length>0,referenceSource:query.centerStrike!==undefined?'MANUAL_STRIKE':
        marketReference!==null?'IBKR_LAST_OBSERVED':iexReference!==null?'ALPACA_IEX_LAST_COMPLETE_BAR':'NONE',
      referencePrice:reference,
      referenceObservedAtUtc:query.centerStrike!==undefined?null:marketReference!==null?quote?.receivedAtUtc??null:iexSnapshot?.barEndUtc??null,
      referenceReceivedAtUtc:query.centerStrike!==undefined?null:marketReference!==null?quote?.receivedAtUtc??null:iexSnapshot?.receivedAtUtc??null,
      subscriptionStatus:{requested:strikes.length*(query.side==='BOTH'?2:1),limit:10}};
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
