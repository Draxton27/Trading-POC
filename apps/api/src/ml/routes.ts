import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {loadMlRun,predictionsPage} from './reader.ts';
import {readProspectiveInference} from './inference.ts';
import {readAlpacaIngestionStatus} from './ingestion.ts';
import {readForwardObservation} from './forward-observation.ts';
import {readMlCollectorStatus} from './collector.ts';
import {readDailyAutomation} from './daily.ts';
import {evaluationStatus,evaluationMetrics,evaluationClasses,evaluationHistory} from './evaluation.ts';
import {readNewsContextSummary} from './news-context.ts';
import {join} from 'node:path';

const query=z.object({symbol:z.literal('NVDA').default('NVDA'),timeframe:z.literal('15m').default('15m')}).strict();
const pageQuery=query.extend({offset:z.coerce.number().int().min(0).max(100000).default(0),limit:z.coerce.number().int().min(1).max(100).default(25)});
export function registerMlRoutes(app:FastifyInstance,configuredDirectory:string|undefined,inferenceLog:string|undefined,ingestionLog:string|undefined,forwardObservationLog:string|undefined,collectorStatusPath?:string,evaluationLog?:string,evaluationStatusPath?:string,newsContextDir?:string){
  const run=loadMlRun(configuredDirectory);
  const evalPaths={observationLog:forwardObservationLog,evaluationLog,statusPath:evaluationStatusPath,runDir:configuredDirectory,modelSha256:run.status==='READY'?run.modelSha256:undefined};
  app.get('/api/v1/ml/status',()=>run.status==='READY'?{status:'READY',reason:null,experimentId:run.summary.experimentId}:run);
  app.get('/api/v1/ml/summary',(req,reply)=>{if(!query.safeParse(req.query).success)return reply.code(400).send({error:'Solo NVDA de 15 minutos.'});return run.status==='READY'?run.summary:run;});
  app.get('/api/v1/ml/metrics',(req,reply)=>{if(!query.safeParse(req.query).success)return reply.code(400).send({error:'Solo NVDA de 15 minutos.'});return run.status==='READY'?run.metrics:run;});
  app.get('/api/v1/ml/predictions',(req,reply)=>{const parsed=pageQuery.safeParse(req.query);if(!parsed.success)return reply.code(400).send({error:'Consulta histórica inválida; solo NVDA de 15 minutos y páginas de hasta 100 filas.'});return run.status==='READY'?predictionsPage(run,parsed.data.offset,parsed.data.limit):run;});
  app.get('/api/v1/ml/prospective',(req,reply)=>{if(!query.safeParse(req.query).success)return reply.code(400).send({error:'Solo NVDA de 15 minutos.'});return readProspectiveInference(inferenceLog,run.status==='READY'?run.modelSha256:undefined);});
  app.get('/api/v1/ml/forward-observation',(req,reply)=>{if(!query.safeParse(req.query).success)return reply.code(400).send({error:'Solo NVDA de 15 minutos.'});return readForwardObservation(forwardObservationLog,run.status==='READY'?run.modelSha256:undefined);});
  app.get('/api/v1/ml/ingestion',(req,reply)=>{if(!query.safeParse(req.query).success)return reply.code(400).send({error:'Solo NVDA de 15 minutos.'});return readAlpacaIngestionStatus(ingestionLog);});
  app.get('/api/v1/ml/collector',(req,reply)=>{if(!query.safeParse(req.query).success)return reply.code(400).send({error:'Solo NVDA de 15 minutos.'});return readMlCollectorStatus(collectorStatusPath);});
  app.get('/api/v1/ml/daily-automation',()=>readDailyAutomation());
  app.get('/api/v1/ml/news-context',(req,reply)=>{if(!query.safeParse(req.query).success)return reply.code(400).send({error:'Solo NVDA de 15 minutos.'});return newsContextDir?readNewsContextSummary(join(newsContextDir,'summary.json'),run.status==='READY'?run.modelSha256:undefined):{status:run.status==='READY'?'NO_DATA':'NO_MODEL',reason:'Dataset de contexto informativo no configurado.'};});
  app.get('/api/v1/ml/evaluation/status',(req,reply)=>{if(!query.safeParse(req.query).success)return reply.code(400).send({error:'Solo NVDA de 15 minutos.'});return evaluationStatus(evalPaths);});
  app.get('/api/v1/ml/evaluation/metrics',(req,reply)=>{if(!query.safeParse(req.query).success)return reply.code(400).send({error:'Solo NVDA de 15 minutos.'});return evaluationMetrics(evalPaths);});
  app.get('/api/v1/ml/evaluation/classes',(req,reply)=>{if(!query.safeParse(req.query).success)return reply.code(400).send({error:'Solo NVDA de 15 minutos.'});return evaluationClasses(evalPaths);});
  app.get('/api/v1/ml/evaluation/history',(req,reply)=>{const parsed=pageQuery.safeParse(req.query);if(!parsed.success)return reply.code(400).send({error:'Consulta inválida.'});return evaluationHistory(evalPaths,parsed.data.offset,parsed.data.limit);});
}
