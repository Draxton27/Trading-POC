import type {FastifyInstance} from 'fastify';
import {z,ZodError} from 'zod';
import {SimulatorService,SimulatorInputError} from './service.ts';
import {SimulatorStoreError} from './store.ts';

const id=z.string().regex(/^SIM41M:POSITION:[0-9a-f-]{36}$/i);
const page=z.object({offset:z.coerce.number().int().min(0).max(100_000).default(0),
  limit:z.coerce.number().int().min(1).max(100).default(25)}).strict();
export function registerSimulatorRoutes(app:FastifyInstance,service:SimulatorService){
  const guard=async(reply:any,operation:()=>Promise<unknown>,created=false)=>{
    try{return reply.code(created?201:200).send(await operation());}
    catch(error){
      if(error instanceof ZodError)return reply.code(400).send({code:'INVALID_REQUEST',error:'Solicitud de simulación inválida'});
      if(error instanceof SimulatorInputError)return reply.code(error.status).send({code:'SIMULATOR_REJECTED',error:error.message});
      if(error instanceof SimulatorStoreError)return reply.code(error.code==='CONFLICT'?409:error.code==='LOCKED'?423:503)
        .send({code:error.code==='INTEGRITY'?'INVALID_LEDGER':error.code,
          error:error.code==='INTEGRITY'?'Ledger privado inválido; no se modificó':error.message});
      app.log.error({errorType:error instanceof Error?error.name:'unknown'},'simulator_failure');
      return reply.code(503).send({code:'UNAVAILABLE',error:'Simulador no disponible; no se modificó el ledger'});
    }
  };
  app.get('/api/v1/simulator/positions',(req,reply)=>guard(reply,()=>{
    const query=page.parse(req.query);return service.positions(query.offset,query.limit);
  }));
  app.get('/api/v1/simulator/positions/:id',(req,reply)=>guard(reply,()=>{
    const key=id.parse((req.params as {id:string}).id),query=page.parse(req.query);
    return service.position(key,query.offset,query.limit);
  }));
  app.post('/api/v1/simulator/positions',{bodyLimit:16*1024},(req,reply)=>guard(reply,()=>service.open(req.body),true));
  app.post('/api/v1/simulator/positions/:id/add',{bodyLimit:16*1024},(req,reply)=>guard(reply,()=>
    service.addLot(id.parse((req.params as {id:string}).id),req.body),true));
  app.post('/api/v1/simulator/positions/:id/close',{bodyLimit:16*1024},(req,reply)=>guard(reply,()=>
    service.close(id.parse((req.params as {id:string}).id),req.body),true));
  app.post('/api/v1/simulator/positions/:id/notes',{bodyLimit:16*1024},(req,reply)=>guard(reply,()=>
    service.note(id.parse((req.params as {id:string}).id),req.body),true));
  app.post('/api/v1/simulator/positions/:id/plan',{bodyLimit:16*1024},(req,reply)=>guard(reply,()=>
    service.plan(id.parse((req.params as {id:string}).id),req.body),true));
  app.get('/api/v1/simulator/performance',(_req,reply)=>guard(reply,()=>service.performance()));
  app.get('/api/v1/simulator/ledger/verify',(_req,reply)=>guard(reply,()=>service.verify()));
}
