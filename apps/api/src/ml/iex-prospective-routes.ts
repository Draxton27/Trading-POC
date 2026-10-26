import {createHash} from 'node:crypto';
import {existsSync,readFileSync,readdirSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {phase41iPrivateRoot,phase41iProtocolDir} from '../../../../trading_poc_001_bollinger/src/phase41i-prospective.ts';
import {iexProspectiveDetail,iexProspectiveHistory,readIexProspective,type IexProspectivePaths,
  type IexProspectiveDependencies} from './iex-prospective-reader.ts';

const listQuery=z.object({symbol:z.literal('NVDA').default('NVDA'),timeframe:z.literal('15m').default('15m'),
  offset:z.coerce.number().int().min(0).max(100_000).default(0),limit:z.coerce.number().int().min(1).max(100).default(25),
  from:z.iso.date().optional(),to:z.iso.date().optional(),dominantClass:z.enum(['ALCISTA','BAJISTA','LATERAL']).optional(),
  actualClass:z.enum(['ALCISTA','BAJISTA','LATERAL']).optional(),
  evaluationStatus:z.enum(['PENDING','OVERDUE_UNEVALUATED','EVALUATED','MISSING_ENTRY','MISSING_OUTCOME']).optional(),
  evaluatedOnly:z.enum(['true','false']).transform(value=>value==='true').optional()}).strict();
const detailParam=z.object({predictionId:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export function iexProspectivePaths(privateDir:string,env:NodeJS.ProcessEnv=process.env):IexProspectivePaths{
  const source=resolve(privateDir);
  return {protocolDir:phase41iProtocolDir(env),modelDir:env.TRADING_POC_IEX_FROZEN_DIR?
    resolve(env.TRADING_POC_IEX_FROZEN_DIR):undefined,
    observationLog:env.TRADING_POC_IEX_OBSERVATION_LEDGER??resolve(source,'ml-iex','observations.jsonl'),
    iexLog:env.TRADING_POC_IEX_LEDGER??resolve(source,'iex','ledger.jsonl'),
    calendar:env.TRADING_POC_IEX_CALENDAR??resolve(source,'iex','calendar.json'),
    warmupRegistry:env.TRADING_POC_IEX_WARMUP_REGISTRY,
    reportDir:env.TRADING_POC_IEX_41J_REPORT_DIR?
      resolve(env.TRADING_POC_IEX_41J_REPORT_DIR):resolve(phase41iPrivateRoot(env),'ml-iex','phase41i-prospective-report-v2')};
}
export function registerIexProspectiveRoutes(app:FastifyInstance,paths:IexProspectivePaths,deps:IexProspectiveDependencies={}){
  // Cache only a previously verified projection. Any relevant file change invalidates it;
  // time-derived states are recomputed at least every two seconds.
  let cached:{fingerprint:string;until:number;value:ReturnType<typeof readIexProspective>}|null=null;
  const fingerprint=()=>{
    const hash=createHash('sha256');
    const file=(path:string)=>{
      if(!existsSync(path)){hash.update(path+':missing;');return;}
      const stat=statSync(path);
      hash.update([path,stat.size,stat.mtimeMs,stat.ctimeMs,stat.ino].join(':')+';');
    };
    const directory=(path:string,pattern:RegExp)=>{
      file(path);
      if(existsSync(path))for(const name of readdirSync(path).filter(name=>pattern.test(name)).sort())file(join(path,name));
    };
    for(const path of [paths.observationLog,paths.iexLog,paths.calendar,paths.warmupRegistry])if(path)file(path);
    if(paths.modelDir)for(const name of ['SHA256SUMS','freeze.json','model.json','linear.json'])file(join(paths.modelDir,name));
    for(const name of ['SHA256SUMS','protocol.json','activation.json','source-integrity.json'])file(join(paths.protocolDir,name));
    directory(join(paths.protocolDir,'eligibility-ledger'),/^\d{8}\.json$/);
    directory(paths.reportDir,/^(?:SHA256SUMS|[a-z-]+\.(?:json|md))$/);
    if(paths.warmupRegistry&&existsSync(paths.warmupRegistry)){
      if(statSync(paths.warmupRegistry).size>4096)throw new Error('Registro privado demasiado grande.');
      const registry=JSON.parse(readFileSync(paths.warmupRegistry,'utf8')) as {sourceDir?:string};
      if(registry.sourceDir)for(const name of ['query.json','calendar.json','strict-15m.csv','report.json','SHA256SUMS'])
        file(join(registry.sourceDir,name));
    }
    return hash.digest('hex');
  };
  const projection=()=>{
    let key:string;
    try{key=fingerprint();}catch{return readIexProspective(paths,deps);}
    const now=Date.now();
    if(cached&&cached.fingerprint===key&&now<cached.until)return cached.value;
    const value=readIexProspective(paths,deps);
    cached={fingerprint:key,until:now+2000,value};
    return value;
  };
  app.get('/api/v1/ml/iex/prospective/overview',()=>projection().overview);
  app.get('/api/v1/ml/iex/prospective/coverage',()=>projection().coverage);
  app.get('/api/v1/ml/iex/prospective/metrics',()=>projection().metrics);
  app.get('/api/v1/ml/iex/prospective/history',(request,reply)=>{
    const parsed=listQuery.safeParse(request.query);
    if(!parsed.success||parsed.data.from&&parsed.data.to&&parsed.data.from>parsed.data.to)
      return reply.code(400).send({error:'Filtros de historia prospectiva inválidos.'});
    return iexProspectiveHistory(projection(),parsed.data);
  });
  app.get('/api/v1/ml/iex/prospective/history/:predictionId',(request,reply)=>{
    const parsed=detailParam.safeParse(request.params);
    if(!parsed.success)return reply.code(400).send({error:'Identificador de predicción inválido.'});
    const current=projection();
    if(current.overview.status==='INVALID_ARTIFACT')return reply.code(422).send({error:current.overview.reason});
    const detail=iexProspectiveDetail(current,parsed.data.predictionId);
    return detail?{status:current.overview.status,item:detail}:reply.code(404).send({error:'Predicción no encontrada.'});
  });
}
