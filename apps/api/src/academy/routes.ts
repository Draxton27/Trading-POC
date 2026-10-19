import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type Database from 'better-sqlite3';
import {academyRanges,academySummary,selectAcademyReference} from './service.ts';

const asset=z.string().regex(/^[A-Z.]{1,12}$/),date=z.string().date();
export function registerAcademyRoutes(app:FastifyInstance,sqlite:Database.Database){
  app.get('/api/v1/academy/summary',()=>academySummary(sqlite));
  app.get('/api/v1/academy/ranges',(req,reply)=>{const parsed=z.object({symbol:asset,asOf:date.optional(),right:z.enum(['CALL','PUT']).optional()}).safeParse(req.query);if(!parsed.success)return reply.code(400).send({error:'Consulta de referencia académica inválida'});const ranges=academyRanges(sqlite,parsed.data.symbol),reference=selectAcademyReference(ranges,parsed.data.asOf??new Date().toISOString(),parsed.data.right??null);return {items:ranges,reference};});
}
