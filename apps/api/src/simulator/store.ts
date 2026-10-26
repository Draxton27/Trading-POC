import {createHash,randomUUID} from 'node:crypto';
import {open,mkdir,readdir,readFile,rename,stat,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {SimulatorLedgerEvent} from '@trading-poc/contracts';
import {replaySimulator,type SimulatorEvent,type SimulatorEventBody} from '@trading-poc/market-domain';

export class SimulatorStoreError extends Error{
  constructor(readonly code:'INTEGRITY'|'CONFLICT'|'LOCKED'|'LIMIT',message:string){super(message);}
}
export const simulatorHash=(text:string)=>createHash('sha256').update(text).digest('hex');
const eventName=(sequence:number)=>`${String(sequence).padStart(8,'0')}.json`;
const MAX_EVENTS=50_000,MAX_FILE_BYTES=64*1024;
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

/** Files are immutable, numbered and hash chained. A failed read never becomes an empty portfolio. */
export class SimulatorStore{
  private memory:SimulatorEvent[]=[];
  private queue:Promise<unknown>=Promise.resolve();
  constructor(readonly directory:string|null){}

  async read():Promise<SimulatorEvent[]>{
    if(this.directory===null)return this.verify([...this.memory]);
    let names:string[];
    try{names=(await readdir(this.directory)).filter(n=>n.endsWith('.json')).sort();}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
    if(names.length>MAX_EVENTS)throw new SimulatorStoreError('LIMIT','Demasiados eventos en el ledger');
    const events:SimulatorEvent[]=[];
    for(const [index,name] of names.entries()){
      if(name!==eventName(index+1))throw new SimulatorStoreError('INTEGRITY','Secuencia del ledger incompleta');
      const path=join(this.directory,name);
      if((await stat(path)).size>MAX_FILE_BYTES)throw new SimulatorStoreError('INTEGRITY','Evento excesivo');
      let raw:unknown;
      try{raw=JSON.parse(await readFile(path,'utf8'));}
      catch{throw new SimulatorStoreError('INTEGRITY','Evento truncado o ilegible');}
      const parsed=SimulatorLedgerEvent.safeParse(raw);
      if(!parsed.success)throw new SimulatorStoreError('INTEGRITY','Esquema de evento inválido');
      events.push(raw as SimulatorEvent);
    }
    return this.verify(events);
  }

  private verify(events:SimulatorEvent[]):SimulatorEvent[]{
    const ids=new Set<string>(),keys=new Set<string>();
    for(const [index,event] of events.entries()){
      const parsed=SimulatorLedgerEvent.safeParse(event);
      if(!parsed.success)throw new SimulatorStoreError('INTEGRITY','Esquema de evento inválido');
      const {hash,...body}=event;
      if(event.sequence!==index+1||event.previousHash!==(events[index-1]?.hash??null)||
          hash!==simulatorHash(JSON.stringify(body))||ids.has(event.simulationEventId)||keys.has(event.idempotencyKey))
        throw new SimulatorStoreError('INTEGRITY','Cadena de hashes o identificadores inválidos');
      ids.add(event.simulationEventId);keys.add(event.idempotencyKey);
    }
    try{replaySimulator(events,new Date().toISOString());}
    catch{throw new SimulatorStoreError('INTEGRITY','Eventos económicos contradictorios');}
    return events;
  }

  private async lock():Promise<()=>Promise<void>>{
    if(this.directory===null)return async()=>{};
    await mkdir(this.directory,{recursive:true,mode:0o700});
    const path=join(this.directory,'.write-lock');
    for(let attempt=0;attempt<100;attempt++){
      try{
        const handle=await open(path,'wx',0o600);
        try{await handle.writeFile(JSON.stringify({pid:process.pid,at:new Date().toISOString()}));
          await handle.sync();}
        catch(error){await handle.close();await unlink(path).catch(()=>{});throw error;}
        return async()=>{await handle.close();await unlink(path).catch(()=>{});};
      }catch(error){
        if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
        // A dead process cannot leave this store permanently locked. Never steal a live lock.
        let age=0;try{age=Date.now()-(await stat(path)).mtimeMs;}catch{continue;}
        if(age>2000){
          let owner:number|null=null;
          try{const info=JSON.parse(await readFile(path,'utf8')) as {pid?:number};
            if(Number.isSafeInteger(info.pid)&&info.pid!>0)owner=info.pid!;}
          catch{/* A crash may have left the lock metadata incomplete. */}
          if(owner!==null){
            let alive=true;try{process.kill(owner,0);}catch(e){alive=(e as NodeJS.ErrnoException).code==='EPERM';}
            if(!alive){await unlink(path).catch(()=>{});continue;}
          }else if(age>30_000){await unlink(path).catch(()=>{});continue;}
        }
        await delay(25);
      }
    }
    throw new SimulatorStoreError('LOCKED','El simulador está ocupado; reintente');
  }

  async append(idempotencyKey:string,requestHash:string,build:(events:readonly SimulatorEvent[],at:string)=>
    {positionId:string;simulationId:string;body:SimulatorEventBody}):Promise<SimulatorEvent>{
    const operation=async()=>{
      const release=await this.lock();
      try{
        const events=await this.read();
        const previous=events.find(event=>event.idempotencyKey===idempotencyKey);
        if(previous){
          if(previous.requestHash!==requestHash)throw new SimulatorStoreError('CONFLICT','Clave de idempotencia reutilizada con otra solicitud');
          return previous;
        }
        if(events.length>=MAX_EVENTS)throw new SimulatorStoreError('LIMIT','Límite de eventos alcanzado');
        const at=new Date().toISOString(),proposal=build(events,at);
        const body={...proposal.body,schemaVersion:1 as const,environment:'INTERNAL_SIMULATOR' as const,
          executionSource:'MANUAL_HYPOTHETICAL' as const,simulationEventId:`SIM41M:EVENT:${randomUUID()}`,
          simulationId:proposal.simulationId,positionId:proposal.positionId,idempotencyKey,requestHash,
          recordedAtUtc:at,sequence:events.length+1,previousHash:events.at(-1)?.hash??null};
        const event={...body,hash:simulatorHash(JSON.stringify(body))} as SimulatorEvent;
        if(!SimulatorLedgerEvent.safeParse(event).success)throw new SimulatorStoreError('CONFLICT','Evento inválido');
        this.verify([...events,event]);
        if(this.directory===null){this.memory.push(event);return event;}
        const name=eventName(event.sequence),target=join(this.directory,name),tmp=join(this.directory,`.${name}.${process.pid}.${randomUUID()}.partial`);
        const handle=await open(tmp,'wx',0o600);
        try{await handle.writeFile(JSON.stringify(event)+'\n');await handle.sync();}
        finally{await handle.close();}
        try{await rename(tmp,target);}catch(error){await unlink(tmp).catch(()=>{});throw error;}
        return event;
      }finally{await release();}
    };
    // In-memory DEMO also serializes calls. File stores additionally coordinate processes.
    const result=this.queue.then(operation,operation);
    this.queue=result.then(()=>{},()=>{});
    return result;
  }
}
