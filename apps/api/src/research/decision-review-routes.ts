import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {DecisionReviewCase,DecisionReviewPage,DecisionReviewSummary} from '@trading-poc/contracts';
import {DecisionReviewService} from './decision-review-service.ts';

const query=z.object({from:z.iso.date().optional(),to:z.iso.date().optional(),
  source:z.enum(['F17_HUMAN','F41M_SIMULATOR']).optional(),classification:z.string().max(80).optional(),
  hasPrediction:z.enum(['true','false']).transform(v=>v==='true').optional(),
  hasTechnicalContext:z.enum(['true','false']).transform(v=>v==='true').optional(),
  outcomeStatus:z.string().max(80).optional(),offset:z.coerce.number().int().min(0).max(100_000).default(0),
  limit:z.coerce.number().int().min(1).max(100).default(25)}).strict();
const params=z.object({id:z.string().min(1).max(160)}).strict();

export function registerDecisionReviewRoutes(app:FastifyInstance,service:DecisionReviewService){
  const unavailable=(reply:any)=>reply.code(503).send({code:'UNAVAILABLE',
    error:'Revisión de decisiones no disponible; compruebe las fuentes privadas y su integridad.'});
  app.get('/api/v1/research/decision-review/summary',async(_request,reply)=>{
    try{return DecisionReviewSummary.parse(await service.summary());}
    catch(error){app.log.error({errorType:error instanceof Error?error.name:'unknown'},'decision_review_summary');return unavailable(reply);}
  });
  app.get('/api/v1/research/decision-review/cases',async(request,reply)=>{
    const parsed=query.safeParse(request.query);
    if(!parsed.success||parsed.data.from&&parsed.data.to&&parsed.data.from>parsed.data.to)
      return reply.code(400).send({code:'INVALID_QUERY',error:'Filtros de revisión inválidos.'});
    try{return DecisionReviewPage.parse(await service.page(parsed.data));}
    catch(error){app.log.error({errorType:error instanceof Error?error.name:'unknown'},'decision_review_page');return unavailable(reply);}
  });
  app.get('/api/v1/research/decision-review/cases/:id',async(request,reply)=>{
    const parsed=params.safeParse(request.params);
    if(!parsed.success)return reply.code(400).send({code:'INVALID_QUERY',error:'ID de decisión inválido.'});
    try{const item=await service.detail(parsed.data.id);
      return item?DecisionReviewCase.parse(item):reply.code(404).send({code:'NOT_FOUND',error:'Decisión no encontrada.'});}
    catch(error){app.log.error({errorType:error instanceof Error?error.name:'unknown'},'decision_review_detail');return unavailable(reply);}
  });
}
