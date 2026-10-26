import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {InvestepScenarioResponse} from '@trading-poc/contracts';
import {buildInvestepScenarios} from '../../../../trading_poc_001_bollinger/src/phase41k-scenarios.ts';
import {analyzeMarketBars} from '../assistant/analysis.ts';
import {technicalContextFor,type TechnicalContextDeps} from '../technical-context/routes.ts';

const query=z.object({symbol:z.enum(['NVDA','QQQ','SMH']),asOfUtc:z.iso.datetime({offset:true}).optional()}).strict();

export function registerScenarioRoutes(app:FastifyInstance,deps:TechnicalContextDeps){
  app.get('/api/v1/radar/scenarios',(request,reply)=>{
    const parsed=query.safeParse(request.query);
    if(!parsed.success)return reply.code(400).send({error:'Símbolo o asOfUtc inválido.'});
    const asOfUtc=parsed.data.asOfUtc??new Date((deps.clock??Date.now)()).toISOString(),cutoff=Date.parse(asOfUtc);
    if(cutoff>(deps.clock??Date.now)())return reply.code(400).send({error:'asOfUtc no puede ser futuro.'});
    try{
      const symbol=parsed.data.symbol,allBars=deps.barsFor(symbol);
      const context=technicalContextFor(deps,symbol,asOfUtc,allBars);
      const bars=allBars.filter(bar=>Date.parse(bar.endUtc)<=cutoff&&
        (bar.receivedAtUtc===null||Date.parse(bar.receivedAtUtc)<=cutoff)).slice(-8000);
      const receiptVerified=bars.length>0&&bars.every(bar=>bar.receivedAtUtc!==null);
      const analysis=analyzeMarketBars(symbol,context.source,context.historicalOrSynthetic,bars,asOfUtc,
        deps.mode==='DEMO'?null:deps.calendarFor(symbol));
      const metrics=analysis.dateUtc===context.timeframes['15m'].lastCompleteBarUtc?analysis.metrics:null;
      const lastEnd=context.timeframes['15m'].lastCompleteBarUtc;
      const dataAvailableAtUtc=receiptVerified&&lastEnd!==null?new Date(Math.max(...bars.filter(bar=>bar.isComplete&&
        Date.parse(bar.endUtc)<=Date.parse(lastEnd)).map(bar=>Date.parse(bar.receivedAtUtc!)))).toISOString():null;
      return InvestepScenarioResponse.parse(buildInvestepScenarios(context,metrics,receiptVerified,dataAvailableAtUtc));
    }catch{return reply.code(503).send({error:'Escenarios técnicos no disponibles: compruebe procedencia, calendario e integridad del histórico local.'});}
  });
}
