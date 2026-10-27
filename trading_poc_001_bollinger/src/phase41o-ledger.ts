import {createHash} from 'node:crypto';
import {open,mkdir,readFile,stat,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {OpportunityLedgerRecord,type OpportunityLedgerRecord as RecordRow} from '@trading-poc/contracts';

const MAX_BYTES=32*1024*1024,MAX_RECORDS=10_000;
export const opportunityHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Kind=RecordRow['kind'];
type Payload<K extends Kind>=Extract<RecordRow,{kind:K}>['payload'];
const candidateId=(row:RecordRow)=>row.payload.candidateId;

/** A verified JSONL chain. A truncated final line is an integrity error, not an empty ledger. */
export async function readOpportunityLedger(path:string):Promise<RecordRow[]>{
  let raw:string;
  try{if((await stat(path)).size>MAX_BYTES)throw new Error('OPPORTUNITY_LEDGER_LIMIT');raw=await readFile(path,'utf8');}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
  if(raw.length&&!raw.endsWith('\n'))throw new Error('OPPORTUNITY_LEDGER_TRUNCATED');
  const lines=raw.split('\n').filter(Boolean);
  if(lines.length>MAX_RECORDS)throw new Error('OPPORTUNITY_LEDGER_LIMIT');
  const records:RecordRow[]=[],ids=new Set<string>(),detected=new Map<string,string>(),outcomes=new Set<string>();
  for(const line of lines){
    let parsed:unknown;try{parsed=JSON.parse(line);}catch{throw new Error('OPPORTUNITY_LEDGER_TRUNCATED');}
    const result=OpportunityLedgerRecord.safeParse(parsed);
    if(!result.success)throw new Error('OPPORTUNITY_LEDGER_SCHEMA');
    const row=result.data,{recordHash,...unsigned}=row;
    if(row.previousHash!==(records.at(-1)?.recordHash??null)||opportunityHash(unsigned)!==recordHash||
      ids.has(row.recordId)||row.recordId!==opportunityHash([row.kind,row.payload]))
      throw new Error('OPPORTUNITY_LEDGER_INTEGRITY');
    const id=candidateId(row);
    if(row.kind==='DETECTED'){
      if(detected.has(id)||row.payload.technicalEvidenceAvailableAtUtc>row.registeredAtUtc||
        row.payload.detectedAtUtc>row.registeredAtUtc||row.payload.barEndUtc>row.payload.detectedAtUtc||
        row.payload.sourceHashCount<row.payload.sourceHashes.length)
        throw new Error('OPPORTUNITY_LEDGER_CAUSALITY');
      detected.set(id,row.registeredAtUtc);
    }else{
      if(!detected.has(id)||row.registeredAtUtc<detected.get(id)!)throw new Error('OPPORTUNITY_LEDGER_CAUSALITY');
      if(row.kind==='CONTRACT_OBSERVED'&&(
        row.payload.quoteSnapshot.receivedAtUtc!==null&&row.payload.quoteSnapshot.receivedAtUtc>row.registeredAtUtc||
        row.payload.observedAtUtc>row.registeredAtUtc||row.payload.analysis.identity.conId!==row.payload.conId))
        throw new Error('OPPORTUNITY_LEDGER_CAUSALITY');
      if(row.kind==='CONTRACT_ATTEMPT'&&row.payload.attemptAtUtc>row.registeredAtUtc)
        throw new Error('OPPORTUNITY_LEDGER_CAUSALITY');
      if(row.kind==='TECHNICAL_UPDATE'&&(row.payload.evidenceAvailableAtUtc>row.registeredAtUtc||
        row.payload.observedAtUtc>row.registeredAtUtc||row.payload.scenario.availableAtUtc!==row.payload.evidenceAvailableAtUtc||
        row.payload.scenario.id!==row.payload.scenarioId||row.payload.scenario.state!==row.payload.scenarioState))
        throw new Error('OPPORTUNITY_LEDGER_CAUSALITY');
      if(row.kind==='UNDERLYING_OUTCOME'){
        if(outcomes.has(id)||row.payload.outcomeEndUtc>row.registeredAtUtc||row.payload.evaluatedAtUtc>row.registeredAtUtc)
          throw new Error('OPPORTUNITY_LEDGER_CAUSALITY');
        outcomes.add(id);
      }
    }
    ids.add(row.recordId);records.push(row);
  }
  return records;
}

/** Serializes local callers and coordinates other processes before read/decide/append. */
export class OpportunityStore{
  private queue:Promise<unknown>=Promise.resolve();
  private memory:RecordRow[]=[];
  readonly path:string|null;
  constructor(path:string|null){this.path=path;}
  async read():Promise<RecordRow[]>{
    if(this.path===null)return this.verifyMemory();
    const lockPath=`${this.path}.write-lock`;
    const locked=async()=>stat(lockPath).then(()=>true,error=>{
      if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;
    });
    for(let attempt=0;attempt<200;attempt++){
      if(await locked()){await new Promise(resolve=>setTimeout(resolve,25));continue;}
      try{return await readOpportunityLedger(this.path);}
      catch(error){if(!await locked())throw error;await new Promise(resolve=>setTimeout(resolve,25));}
    }
    throw new Error('OPPORTUNITY_LEDGER_LOCKED');
  }
  private async verifyMemory(){
    if(!this.memory.length)return [];
    // The same chain verifier is used for disk; DEMO memory is written only through append().
    return [...this.memory];
  }
  private async lock():Promise<()=>Promise<void>>{
    if(this.path===null)return async()=>{};
    await mkdir(dirname(this.path),{recursive:true,mode:0o700});const lockPath=`${this.path}.write-lock`;
    for(let attempt=0;attempt<200;attempt++){
      try{
        const file=await open(lockPath,'wx',0o600);
        try{await file.writeFile(JSON.stringify({pid:process.pid}));await file.sync();}
        catch(error){await file.close();await unlink(lockPath).catch(()=>{});throw error;}
        return async()=>{await file.close();await unlink(lockPath).catch(()=>{});};
      }catch(error){
        if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
        let age=0;try{age=Date.now()-(await stat(lockPath)).mtimeMs;}catch{continue;}
        if(age>2000){let owner:number|null=null;
          try{const info=JSON.parse(await readFile(lockPath,'utf8')) as {pid?:number};
            if(Number.isSafeInteger(info.pid)&&info.pid!>0)owner=info.pid!;}catch{}
          if(owner!==null){let alive=true;try{process.kill(owner,0);}catch(e){alive=(e as NodeJS.ErrnoException).code==='EPERM';}
            if(!alive){await unlink(lockPath).catch(()=>{});continue;}}
          else if(age>30_000){await unlink(lockPath).catch(()=>{});continue;}
        }
        await new Promise(resolve=>setTimeout(resolve,25));
      }
    }
    throw new Error('OPPORTUNITY_LEDGER_LOCKED');
  }
  async append<K extends Kind>(kind:K,payload:Payload<K>,clock:()=>string=()=>new Date().toISOString(),
    guard?:(records:readonly RecordRow[])=>void){
    const operation=async()=>{const release=await this.lock();try{
      const records=this.path===null?await this.verifyMemory():await readOpportunityLedger(this.path),
        recordId=opportunityHash([kind,payload]);
      guard?.(records);
      const prior=records.find(row=>row.recordId===recordId);
      if(prior)return {record:prior,alreadyPresent:true};
      if(kind==='DETECTED'&&records.some(row=>row.kind==='DETECTED'&&row.payload.candidateId===payload.candidateId))
        throw new Error('OPPORTUNITY_DUPLICATE_CANDIDATE');
      if(kind!=='DETECTED'&&!records.some(row=>row.kind==='DETECTED'&&row.payload.candidateId===payload.candidateId))
        throw new Error('OPPORTUNITY_CANDIDATE_MISSING');
      if(kind==='UNDERLYING_OUTCOME'&&records.some(row=>row.kind==='UNDERLYING_OUTCOME'&&row.payload.candidateId===payload.candidateId))
        throw new Error('OPPORTUNITY_OUTCOME_ALREADY_RECORDED');
      if(records.length>=MAX_RECORDS)throw new Error('OPPORTUNITY_LEDGER_LIMIT');
      const unsigned={schema:'phase41o-opportunity-v1' as const,kind,recordId,
        previousHash:records.at(-1)?.recordHash??null,registeredAtUtc:clock(),payload};
      const row=OpportunityLedgerRecord.parse({...unsigned,recordHash:opportunityHash(unsigned)}) as RecordRow;
      if(row.kind==='DETECTED'&&(
        row.payload.technicalEvidenceAvailableAtUtc>row.registeredAtUtc||row.payload.detectedAtUtc>row.registeredAtUtc))
        throw new Error('OPPORTUNITY_FUTURE_EVIDENCE');
      if(row.kind==='CONTRACT_OBSERVED'&&row.payload.quoteSnapshot.receivedAtUtc!==null&&
        row.payload.quoteSnapshot.receivedAtUtc>row.registeredAtUtc)throw new Error('OPPORTUNITY_FUTURE_QUOTE');
      if(row.kind==='CONTRACT_ATTEMPT'&&row.payload.attemptAtUtc>row.registeredAtUtc)
        throw new Error('OPPORTUNITY_FUTURE_EVIDENCE');
      if(row.kind==='TECHNICAL_UPDATE'&&(row.payload.evidenceAvailableAtUtc>row.registeredAtUtc||
        row.payload.scenario.id!==row.payload.scenarioId||row.payload.scenario.state!==row.payload.scenarioState))
        throw new Error('OPPORTUNITY_FUTURE_EVIDENCE');
      if(this.path===null){this.memory.push(row);return {record:row,alreadyPresent:false};}
      const file=await open(this.path,'a',0o600);
      try{await file.writeFile(JSON.stringify(row)+'\n');await file.sync();}finally{await file.close();}
      return {record:row,alreadyPresent:false};
    }finally{await release();}};
    const result=this.queue.then(operation,operation);this.queue=result.then(()=>{},()=>{});return result;
  }
}
