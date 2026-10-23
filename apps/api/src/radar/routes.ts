import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {RadarSymbol} from '@trading-poc/contracts';
import {buildRadar} from './service.ts';

const query=z.object({symbols:z.string().max(24).optional(),right:z.enum(['CALL','PUT']).optional()}).strict();
type Deps=Parameters<typeof buildRadar>[0];
export function registerRadarRoutes(app:FastifyInstance,deps:Deps){
  app.get('/api/v1/radar',(request,reply)=>{
    const parsed=query.safeParse(request.query);
    if(!parsed.success)return reply.code(400).send({error:'Consulta de radar inválida.'});
    const symbols=parsed.data.symbols?.split(',')??['NVDA','QQQ','SMH'];
    const valid=z.array(RadarSymbol).min(1).max(3).refine(items=>new Set(items).size===items.length).safeParse(symbols);
    if(!valid.success)return reply.code(400).send({error:'Solo NVDA, QQQ y SMH sin duplicados.'});
    try{return buildRadar(deps,valid.data,parsed.data.right);}
    catch{return reply.code(503).send({error:'Radar no disponible; compruebe la integridad de las fuentes locales.'});}
  });
}
