import {z} from 'zod';
import type {FastifyInstance} from 'fastify';
import type Database from 'better-sqlite3';
import {RealFlexFill,RealReconstructionSnapshot} from '@trading-poc/contracts';
import {sha256} from './flex.ts';
import {reconcile,reconciliationCodeHash} from './reconciliation.ts';

export function registerRealReconciliationRoutes(app:FastifyInstance,db:Database.Database,token:string){
  app.get('/api/v1/real-trades/reconciliation',async(req,reply)=>{
    if(req.headers['x-local-token']!==token)return reply.code(403).send({error:'Token local requerido'});
    const query=z.object({view:z.enum(['summary','executions','episodes','evidence']).default('summary'),limit:z.coerce.number().int().min(1).max(100).default(25),offset:z.coerce.number().int().min(0).max(10000).default(0),id:z.string().regex(/^[a-f0-9]{64}$/).optional(),snapshot:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict().safeParse(req.query);
    if(!query.success)return reply.code(400).send({error:'Consulta inválida'});
    if(query.data.view==='evidence'){
      if(!query.data.id)return reply.code(400).send({error:'Identificador requerido'});
      const evidence=db.prepare(`SELECT r.id,r.document_sha256,r.content_hash,r.payload,d.imported_at_utc,d.provenance FROM real_flex_records r JOIN real_flex_documents d ON d.sha256=r.document_sha256 WHERE r.id=?`).get(query.data.id) as {id:string;document_sha256:string;content_hash:string;payload:string;imported_at_utc:string;provenance:string}|undefined;
      if(!evidence)return reply.code(404).send({error:'Evidencia no encontrada'});
      if(sha256(evidence.payload)!==evidence.content_hash)return reply.code(503).send({error:'Evidencia inválida'});
      let value:unknown;try{value=JSON.parse(evidence.payload);}catch{return reply.code(503).send({error:'Evidencia inválida'});}
      const parsed=RealFlexFill.safeParse(value);if(!parsed.success)return reply.code(503).send({error:'Evidencia inválida'});
      return {id:evidence.id,documentHash:evidence.document_sha256,contentHash:evidence.content_hash,importedAtUtc:evidence.imported_at_utc,provenance:evidence.provenance,fill:parsed.data};
    }
    const row=(query.data.snapshot?db.prepare('SELECT sha256,created_at_utc,payload FROM real_reconstruction_snapshots WHERE sha256=?').get(query.data.snapshot):db.prepare('SELECT sha256,created_at_utc,payload FROM real_reconstruction_snapshots ORDER BY created_at_utc DESC, rowid DESC LIMIT 1').get()) as {sha256:string;created_at_utc:string;payload:string}|undefined;
    const doc=db.prepare('SELECT sha256,imported_at_utc,record_count,provenance FROM real_flex_documents ORDER BY imported_at_utc DESC,rowid DESC LIMIT 1').get()??null;
    if(!row){if(query.data.snapshot)return reply.code(404).send({error:'Proyección no encontrada'});return {status:'NO_RECONSTRUCTION',lastExtract:doc,coverage:'UNVERIFIED'};}
    if(Buffer.byteLength(row.payload)>32*1024*1024||sha256(row.payload)!==row.sha256)return reply.code(503).send({error:'Proyección inválida'});
    let decoded:unknown;try{decoded=JSON.parse(row.payload);}catch{return reply.code(503).send({error:'Proyección inválida'});}
    const parsed=RealReconstructionSnapshot.safeParse(decoded);if(!parsed.success)return reply.code(503).send({error:'Proyección inválida'});
    const snapshot=parsed.data,identity={sha256:row.sha256,createdAtUtc:row.created_at_utc,algorithm:snapshot.algorithm,codeHash:snapshot.codeHash,inputHash:snapshot.inputHash,coverage:snapshot.coverage};
    let status:'PARTIAL'|'STALE';try{const fresh=sha256(JSON.stringify(reconcile(db)))===snapshot.inputHash&&reconciliationCodeHash()===snapshot.codeHash;status=fresh?'PARTIAL':'STALE';}catch{return reply.code(503).send({error:'Proyección no disponible'});}
    if(query.data.view==='summary')return {...identity,status,lastExtract:doc,executionCount:snapshot.executions.length,identifiedCount:snapshot.executions.filter(x=>['VERIFIED_CONTRACT','DOCUMENTED_CONTRACT'].includes(x.status)).length,ambiguousCount:snapshot.executions.filter(x=>x.status==='AMBIGUOUS_CONTRACT').length,reconstructedCount:snapshot.episodes.filter(x=>x.status==='RECONSTRUCTED').length,partiallyOpenCount:snapshot.episodes.filter(x=>x.status==='PARTIALLY_OPEN').length,netCalculatedCount:snapshot.episodes.filter(x=>x.netPnl!==null).length,pendingExecutionCount:snapshot.executions.filter(x=>x.status!=='VERIFIED_CONTRACT').length};
    const all=query.data.view==='executions'?snapshot.executions:snapshot.episodes;
    const selected=query.data.id?all.filter(x=>x.id===query.data.id):all;
    return {...identity,status,total:selected.length,items:selected.slice(query.data.offset,query.data.offset+query.data.limit)};
  });
}
