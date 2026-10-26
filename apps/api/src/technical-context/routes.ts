import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {TechnicalContext as TechnicalContextSchema} from '@trading-poc/contracts';
import type {MarketBar} from '@trading-poc/contracts';
import type {Symbol} from '@trading-poc/research-adapter';
import type {DataMetadata} from '../../../../trading_poc_001_bollinger/src/data-contract.ts';
import type {MarketCalendar} from '../../../../trading_poc_001_bollinger/src/alpaca-calendar.ts';
import {buildInvestepTechnicalContext} from '../../../../trading_poc_001_bollinger/src/investep-technical-context.ts';
import {newYorkBarParts} from '../../../../trading_poc_001_bollinger/src/strategy-validation.ts';

export type TechnicalContextDeps={mode:'DEMO'|'OFFLINE'|'PAPER';barsFor:(symbol:Symbol)=>MarketBar[];metadataFor:(symbol:Symbol)=>DataMetadata;
  calendarFor:(symbol:Symbol)=>MarketCalendar|null;clock?:()=>number};
const query=z.object({symbol:z.enum(['NVDA','QQQ','SMH']),asOfUtc:z.iso.datetime({offset:true}).optional()}).strict();

export function technicalContextFor(deps:TechnicalContextDeps,symbol:Symbol,asOfUtc:string,providedBars?:MarketBar[]){
  const synthetic=deps.mode==='DEMO';
  const metadata=synthetic?null:deps.metadataFor(symbol);
  if(metadata&&(
    metadata.asset!==symbol||metadata.bar_minutes!==15||metadata.session!=='regular'||metadata.exchange_timezone!=='America/New_York'||
    metadata.provider!=='Alpaca Market Data API'||metadata.feed!=='sip'||metadata.adjustment!=='split'||metadata.data_class!=='real'))
    throw new Error('Procedencia incompatible');
  const provider=synthetic?'DEMO sintético':metadata!.provider,feed=synthetic?'synthetic':metadata!.feed!,adjustment=synthetic?'none':metadata!.adjustment!;
  const cutoff=Date.parse(asOfUtc);
  const bars=(providedBars??deps.barsFor(symbol)).filter(b=>Date.parse(b.endUtc)<=cutoff).slice(-8000);
  // DEMO's fixed fixture uses 09:30–16:00 NY; this is explicitly synthetic, never an official calendar.
  const syntheticCalendar:MarketCalendar=new Map(bars.map(b=>[newYorkBarParts(b.startUtc).day,{open:570,close:960}]));
  return TechnicalContextSchema.parse(buildInvestepTechnicalContext({symbol,asOfUtc,bars,calendar:synthetic?syntheticCalendar:deps.calendarFor(symbol),provider,feed,adjustment,
    historicalOrSynthetic:synthetic?'SYNTHETIC':'HISTORICAL'}));
}

export function registerTechnicalContextRoutes(app:FastifyInstance,deps:TechnicalContextDeps){
  app.get('/api/v1/market/technical-context',(request,reply)=>{
    const parsed=query.safeParse(request.query);
    if(!parsed.success)return reply.code(400).send({error:'Símbolo o asOfUtc inválido.'});
    const asOfUtc=parsed.data.asOfUtc??new Date((deps.clock??Date.now)()).toISOString();
    if(Date.parse(asOfUtc)>(deps.clock??Date.now)())return reply.code(400).send({error:'asOfUtc no puede ser futuro.'});
    try{return technicalContextFor(deps,parsed.data.symbol,asOfUtc);}
    catch{return reply.code(503).send({error:'Contexto técnico no disponible: compruebe procedencia, calendario e integridad del histórico local.'});}
  });
}
