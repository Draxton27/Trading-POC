import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {spread} from '@trading-poc/market-domain';
import {AgentHub,AgentRequestError} from '../streams/agent-hub.ts';
import {availableStrikes,selectContractStrikes,quoteReference,type OptionParameter} from './selection.ts';
import type Database from 'better-sqlite3';
import {academyRanges,evaluateAcademyAskRange,selectAcademyReference} from '../academy/service.ts';

type Issue={strike:number|null;code:string;message:string;stage:string;requestId:string|null;ibkrCode:number|null};
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

  app.get('/api/v1/options/expirations',async(_req,reply)=>{
    if(mode==='DEMO')return {items:['2026-10-23'],source:'DEMO sintético'};
    try{return {items:[...new Set((await parameters()).flatMap(p=>p.expirations))].sort(),
      source:hub.status().connected?(hub.status().simulation?'Agente simulado':'IBKR Paper'):'IBKR desconectado'};}
    catch(error){return unavailable(reply,error);}
  });
  app.get('/api/v1/options/strikes',async(req,reply)=>{
    const parsed=z.object({expiration:expiration.optional(),minPrice:decimal.optional(),maxPrice:decimal.optional(),
      offset:z.coerce.number().int().min(0).max(100000).default(0),
      limit:z.coerce.number().int().min(1).max(200).default(50)}).safeParse(req.query);
    if(!parsed.success||parsed.data.minPrice!==undefined&&parsed.data.maxPrice!==undefined&&parsed.data.minPrice>parsed.data.maxPrice)
      return reply.code(400).send({error:'Rango de strikes inválido'});
    if(mode==='DEMO')return {items:[210,215,220,225,230],expiration:'2026-10-23',total:5,offset:0,nextOffset:null,source:'DEMO sintético'};
    try{
      const params=await parameters();const selected=parsed.data.expiration??params.flatMap(p=>p.expirations).sort()[0]??null;
      const all=selected?availableStrikes(params,selected,parsed.data.minPrice,parsed.data.maxPrice):[];
      const {offset,limit}=parsed.data;
      return {items:all.slice(offset,offset+limit),expiration:selected,total:all.length,offset,
        nextOffset:offset+limit<all.length?offset+limit:null,source:hub.status().simulation?'Agente simulado':'IBKR Paper'};
    }catch(error){return unavailable(reply,error);}
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
    const selectedExpiration=query.expiration??params.flatMap(p=>p.expirations).sort()[0]??null;
    if(!selectedExpiration)return {items:[],errors:[],source:'IBKR sin vencimientos',selectionRequired:false};
    const all=availableStrikes(params,selectedExpiration,query.minPrice,query.maxPrice);
    const quote=hub.latestQuote('NVDA') as {last?:unknown;receivedAtUtc?:unknown;feedType?:unknown}|null;
    const marketReference=quoteReference(quote);
    const reference=query.centerStrike??marketReference;
    const strikes=reference!==null?selectContractStrikes(all,query.limit,reference):
      query.minPrice!==undefined||query.maxPrice!==undefined?all.slice(0,query.limit):[];
    const selectionRequired=strikes.length===0&&all.length>0&&reference===null&&
      query.minPrice===undefined&&query.maxPrice===undefined;
    const referenceSource=query.centerStrike!==undefined?'MANUAL_STRIKE':marketReference!==null?
      `IBKR_${String(quote?.feedType??'UNKNOWN')}`:query.minPrice!==undefined||query.maxPrice!==undefined?'MANUAL_RANGE_ASCENDING':'NONE';
    const items:Array<Record<string,unknown>>=[],errors:Issue[]=[];
    const academyReference=selectAcademyReference(academyRanges(sqlite,'NVDA'),new Date().toISOString(),query.right);
    const deadline=Date.now()+hub.optionPageTimeoutMs();
    for(const strike of strikes){
      const remaining=deadline-Date.now();
      if(remaining<1000){errors.push({...issue(null,strike),code:'PAGE_TIMEOUT',message:messages.PAGE_TIMEOUT!});continue;}
      const cacheKey=`${selectedExpiration}:${query.right}:${strike}`;
      const cached=contractCache.get(cacheKey);
      let contract=cached&&cached.until>Date.now()&&cached.connectionId===hub.status().connectionId?cached.contract:undefined;
      if(!contract){
        try{
          const response=await hub.request('option.resolve',{expiration:selectedExpiration,right:query.right,strike},remaining);
          contract=response.payload.contract as Record<string,unknown>|undefined;
          if(!contract||!Number.isInteger(contract.conId)||Number(contract.conId)<=0||contract.symbol!=='NVDA'||
            contract.right!==query.right||contract.expiration!==selectedExpiration||contract.strike!==strike||contract.multiplier!==100)
            throw new AgentRequestError('INVALID_CONTRACT','contract_details',response.requestId??'');
          contractCache.set(cacheKey,{contract,until:Date.now()+60000,connectionId:hub.status().connectionId});
        }catch(error){errors.push(issue(error,strike));continue;}
      }
      let subscribeError:Issue|null=null;
      try{await hub.subscribe({conId:contract.conId,expiration:selectedExpiration,right:query.right,strike},query.consumerId,
        deadline-Date.now());}
      catch(error){subscribeError=issue(error,strike);errors.push(subscribeError);}
      const received=hub.latestQuote(String(contract.conId)) as {receivedAtUtc?:string;bid?:number|null;ask?:number|null;feedType?:string;marketDataStatus?:string;ibkrErrorCode?:number}|null;
      const stale=!!received&&(!received.receivedAtUtc||Date.now()-Date.parse(received.receivedAtUtc)>30000);
      const noBidAsk=!received||received.bid==null&&received.ask==null;
      const academyEvaluation=evaluateAcademyAskRange(academyReference,received,Date.now(),String(contract.currency??'USD'),Number(contract.multiplier??100));
      items.push({...contract,...(received??{}),academyEvaluation,spread:spread(received?.bid??null,received?.ask??null),
        dataStatus:subscribeError?subscribeError.code==='PERMISSION'?'permisos_insuficientes':'suscripcion_fallida':
          !received?'cotizacion_pendiente':stale?'obsoleto':received.marketDataStatus==='permission_denied'?'permisos_insuficientes':
          received.marketDataStatus==='partial'?'cotizacion_parcial':received.marketDataStatus==='unavailable'||noBidAsk?'cotizacion_no_disponible':'recibido',
        stale,permissions:subscribeError?.code==='PERMISSION'||received?.marketDataStatus==='permission_denied'?'Insuficientes':'No verificados',
        provider:hub.status().simulation?'PAPER SIMULADO':'IBKR'});
    }
    return {items,errors,source:hub.status().simulation?'Agente simulado':'IBKR Paper',
      expiration:selectedExpiration,selectionRequired,referenceSource,strikeCount:all.length};
  });
}
