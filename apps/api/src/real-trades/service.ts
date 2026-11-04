import {createHash,randomUUID} from 'node:crypto';
import type Database from 'better-sqlite3';
import {RealTradeDiagnostic,type RealTradeExecution} from '@trading-poc/contracts';
import {DEFAULT_FIELDS,executionHash,hasStableSourceRecordId,normalizeExecution,sourceRecordId,type FieldMap,type InputRecord} from './normalize.ts';

type Outcome='inserted'|'unchanged'|'revised'|'conflicts'|'rejected';
type IdentityRow={id:string;latest_version_id:string|null;quality:string;conflict:number};
type VersionRow={id:string;content_hash:string;source:string;source_record_id:string;revision:number;kind:string};
type SourceIdentityRow={execution_id:string};
export const RUN_ACTIVITY_MAX_AGE_MS=5*60_000;
const identity=(value:RealTradeExecution)=>createHash('sha256').update(`${value.environment}\0${value.accountAlias}\0${value.executionId}`).digest('hex');
const provenanceId=(versionId:string,source:string,recordId:string)=>createHash('sha256').update(`${versionId}\0${source}\0${recordId}`).digest('hex');
export type RunSummary={id:string;status:'SUCCESS_COVERAGE_UNVERIFIED'|'PARTIAL_COVERAGE_UNVERIFIED'|'FAILED';source:string;received:number;inserted:number;unchanged:number;revised:number;conflicts:number;rejected:number;errorCode:string|null;coverage:'UNVERIFIED';minExecutedAtUtc:string|null;maxExecutedAtUtc:string|null};

export class RealTradeImporter{
  constructor(private readonly db:Database.Database,private readonly source:string,private readonly mapping:FieldMap=DEFAULT_FIELDS,private readonly clock:()=>string=()=>new Date().toISOString()){}
  private ingestOne(record:InputRecord):{outcome:Outcome;at:string|null}{
    let value:RealTradeExecution;
    try{value=normalizeExecution(record,this.mapping);}catch(error){
      const reason=error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'INVALID_RECORD';
      const rawHash=createHash('sha256').update(JSON.stringify(record)).digest('hex');
      const sourceHash=createHash('sha256').update(`${this.source}\0${sourceRecordId(record,this.mapping)}`).digest('hex');
      const id=createHash('sha256').update(`${this.source}\0${sourceHash}\0${rawHash}\0${reason}`).digest('hex');
      this.db.prepare('INSERT OR IGNORE INTO real_trade_rejections(id,source,source_record_hash,reason,first_seen_at_utc) VALUES (?,?,?,?,?)').run(id,this.source,sourceHash,reason,this.clock());
      return {outcome:'rejected',at:null};
    }
    const key=identity(value),hash=executionHash(value),recordId=sourceRecordId(record,this.mapping),now=this.clock();
    // Only the REST adapter's validated rec ID is a verified source identity.
    // A CSV/JSON field or execution-derived fallback is an operator assertion.
    const verifiedAirtableId=this.source==='AIRTABLE'&&typeof record.id==='string'&&/^rec[A-Za-z0-9]{14}$/.test(record.id);
    const explicitAirtableShapedId=hasStableSourceRecordId(record,this.mapping)&&/^rec[A-Za-z0-9]{14}$/.test(recordId);
    const outcome=this.db.transaction(():Outcome=>{
      if(explicitAirtableShapedId){
        const origins=this.db.prepare(`SELECT v.execution_id FROM real_trade_provenance p
          JOIN real_trade_versions v ON v.id=p.version_id
          WHERE p.source_record_id=?
          ORDER BY p.first_seen_at_utc,v.revision,v.id`).all(recordId) as SourceIdentityRow[];
        if(origins.some(row=>row.execution_id!==key)){
          // Keep the first financial identity canonical. A changed executionId is
          // evidence attached to it, never a second execution created by us.
          const canonical=origins[0]!.execution_id;
          for(const existingKey of new Set([...origins.map(row=>row.execution_id),key]))
            this.db.prepare('UPDATE real_trade_executions SET conflict=1 WHERE id=?').run(existingKey);
          const priorConflict=this.db.prepare(`SELECT v.id FROM real_trade_versions v JOIN real_trade_provenance p ON p.version_id=v.id
            WHERE v.execution_id=? AND v.content_hash=? AND v.kind='IDENTITY_CONFLICT'
              AND p.source_record_id=? LIMIT 1`).get(canonical,hash,recordId) as {id:string}|undefined;
          if(priorConflict){
            this.db.prepare('INSERT OR IGNORE INTO real_trade_provenance(id,version_id,source,source_record_id,first_seen_at_utc) VALUES (?,?,?,?,?)').run(provenanceId(priorConflict.id,this.source,recordId),priorConflict.id,this.source,recordId,now);
            return 'unchanged';
          }
          const revision=(this.db.prepare('SELECT COALESCE(MAX(revision),0)+1 AS next FROM real_trade_versions WHERE execution_id=?').get(canonical) as {next:number}).next;
          const versionId=randomUUID();
          this.db.prepare('INSERT INTO real_trade_versions(id,execution_id,revision,content_hash,normalized,source,source_record_id,imported_at_utc,kind) VALUES (?,?,?,?,?,?,?,?,?)').run(versionId,canonical,revision,hash,JSON.stringify(value),this.source,recordId,now,'IDENTITY_CONFLICT');
          this.db.prepare('INSERT INTO real_trade_provenance(id,version_id,source,source_record_id,first_seen_at_utc) VALUES (?,?,?,?,?)').run(provenanceId(versionId,this.source,recordId),versionId,this.source,recordId,now);
          return 'conflicts';
        }
      }
      const current=this.db.prepare('SELECT id,latest_version_id,quality,conflict FROM real_trade_executions WHERE id=?').get(key) as IdentityRow|undefined;
      const latest=current?.latest_version_id?this.db.prepare('SELECT id,content_hash,source,source_record_id,revision,kind FROM real_trade_versions WHERE id=?').get(current.latest_version_id) as VersionRow:undefined;
      if(latest?.content_hash===hash){
        const id=provenanceId(latest.id,this.source,recordId);
        this.db.prepare('INSERT OR IGNORE INTO real_trade_provenance(id,version_id,source,source_record_id,first_seen_at_utc) VALUES (?,?,?,?,?)').run(id,latest.id,this.source,recordId,now);
        return 'unchanged';
      }
      const prior=this.db.prepare('SELECT 1 FROM real_trade_provenance p JOIN real_trade_versions v ON v.id=p.version_id WHERE v.execution_id=? AND p.source=? AND p.source_record_id=? LIMIT 1').get(key,this.source,recordId);
      const kind=current?(prior&&verifiedAirtableId?'REVISION':'CONFLICT'):'ORIGINAL';
      const revision=(this.db.prepare('SELECT COALESCE(MAX(revision),0)+1 AS next FROM real_trade_versions WHERE execution_id=?').get(key) as {next:number}).next;
      const versionId=randomUUID();
      if(!current)this.db.prepare('INSERT INTO real_trade_executions(id,environment,account_alias,execution_id,latest_version_id,quality,conflict) VALUES (?,?,?,?,?,?,0)').run(key,'REAL','Primary',value.executionId,versionId,value.quality);
      this.db.prepare('INSERT INTO real_trade_versions(id,execution_id,revision,content_hash,normalized,source,source_record_id,imported_at_utc,kind) VALUES (?,?,?,?,?,?,?,?,?)').run(versionId,key,revision,hash,JSON.stringify(value),this.source,recordId,now,kind);
      this.db.prepare('INSERT INTO real_trade_provenance(id,version_id,source,source_record_id,first_seen_at_utc) VALUES (?,?,?,?,?)').run(provenanceId(versionId,this.source,recordId),versionId,this.source,recordId,now);
      if(kind==='REVISION')this.db.prepare('UPDATE real_trade_executions SET latest_version_id=?,quality=? WHERE id=?').run(versionId,value.quality,key);
      if(kind==='CONFLICT')this.db.prepare('UPDATE real_trade_executions SET conflict=1 WHERE id=?').run(key);
      return kind==='ORIGINAL'?'inserted':kind==='REVISION'?'revised':'conflicts';
    })();
    return {outcome,at:value.executedAtUtc};
  }
  async run(records:AsyncIterable<InputRecord>|Iterable<InputRecord>):Promise<RunSummary>{
    const id=randomUUID(),started=this.clock();
    this.db.prepare('INSERT INTO real_trade_import_runs(id,source,started_at_utc,last_activity_at_utc,owner_pid,status,received,inserted,unchanged,revised,conflicts,rejected,coverage) VALUES (?,?,?,?,?,\'RUNNING\',0,0,0,0,0,0,\'UNVERIFIED\')').run(id,this.source,started,started,process.pid);
    const counts={received:0,inserted:0,unchanged:0,revised:0,conflicts:0,rejected:0};let min:string|null=null,max:string|null=null,errorCode:string|null=null;
    try{
      for await(const record of records){
        if(counts.received>=10000)throw new Error('RECORD_LIMIT');
        counts.received++;
        const result=this.ingestOne(record);counts[result.outcome]++;
        if(result.at){if(min===null||result.at<min)min=result.at;if(max===null||result.at>max)max=result.at;}
        this.db.prepare('UPDATE real_trade_import_runs SET last_activity_at_utc=?,received=?,inserted=?,unchanged=?,revised=?,conflicts=?,rejected=? WHERE id=?').run(this.clock(),counts.received,counts.inserted,counts.unchanged,counts.revised,counts.conflicts,counts.rejected,id);
      }
    }catch(error){errorCode=error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'IMPORT_FAILED';}
    const status=errorCode?(counts.received>0?'PARTIAL_COVERAGE_UNVERIFIED':'FAILED'):(counts.conflicts||counts.rejected?'PARTIAL_COVERAGE_UNVERIFIED':'SUCCESS_COVERAGE_UNVERIFIED');
    const finished=this.clock();
    this.db.prepare('UPDATE real_trade_import_runs SET last_activity_at_utc=?,finished_at_utc=?,status=?,received=?,inserted=?,unchanged=?,revised=?,conflicts=?,rejected=?,error_code=?,min_executed_at_utc=?,max_executed_at_utc=? WHERE id=?').run(finished,finished,status,counts.received,counts.inserted,counts.unchanged,counts.revised,counts.conflicts,counts.rejected,errorCode,min,max,id);
    return {id,status,source:this.source,...counts,errorCode,coverage:'UNVERIFIED',minExecutedAtUtc:min,maxExecutedAtUtc:max};
  }
}

function ownerProcessAlive(pid:number):boolean|null{
  if(pid===process.pid)return true;
  try{process.kill(pid,0);return true;}catch(error){return (error as NodeJS.ErrnoException).code==='ESRCH'?false:null;}
}
function runActivity(row:{status:unknown;last_activity_at_utc:unknown;owner_pid:unknown;finished_at_utc:unknown},nowMs:number,isAlive:(pid:number)=>boolean|null){
  if(row.status!=='RUNNING')return row.finished_at_utc===null?'UNKNOWN' as const:'COMPLETED' as const;
  if(row.finished_at_utc!==null)return 'UNKNOWN' as const;
  const heartbeat=typeof row.last_activity_at_utc==='string'?Date.parse(row.last_activity_at_utc):Number.NaN;
  if(!Number.isFinite(heartbeat))return 'INTERRUPTED' as const;
  const age=nowMs-heartbeat;
  if(age<0)return 'UNKNOWN' as const;
  if(age>RUN_ACTIVITY_MAX_AGE_MS)return 'INTERRUPTED' as const;
  if(typeof row.owner_pid!=='number'||!Number.isSafeInteger(row.owner_pid)||row.owner_pid<=0)return 'INTERRUPTED' as const;
  const alive=isAlive(row.owner_pid);
  return alive===true?'ACTIVE' as const:alive===false?'INTERRUPTED' as const:'UNKNOWN' as const;
}
export function realTradeDiagnostic(db:Database.Database,configured:boolean,now:()=>string=()=>new Date().toISOString(),isAlive:(pid:number)=>boolean|null=ownerProcessAlive){
  const nowMs=Date.parse(now());
  const last=db.prepare('SELECT source,started_at_utc,last_activity_at_utc,owner_pid,finished_at_utc,status,received,inserted,unchanged,revised,conflicts,rejected,error_code,coverage FROM real_trade_import_runs ORDER BY started_at_utc DESC,id DESC LIMIT 1').get() as ({status:unknown;last_activity_at_utc:unknown;owner_pid:unknown;finished_at_utc:unknown;[key:string]:unknown})|undefined;
  const running=db.prepare("SELECT status,last_activity_at_utc,owner_pid,finished_at_utc FROM real_trade_import_runs WHERE status='RUNNING'").all() as Array<{status:unknown;last_activity_at_utc:unknown;owner_pid:unknown;finished_at_utc:unknown}>;
  const interruptedRunCount=running.filter(row=>runActivity(row,nowMs,isAlive)==='INTERRUPTED').length;
  const counts=db.prepare('SELECT COUNT(*) AS executionCount,COALESCE(SUM(CASE WHEN quality IN (\'INCOMPLETE_CONTRACT\',\'INCOMPLETE_CONTRACT_AND_PRICE\') THEN 1 ELSE 0 END),0) AS incompleteIdentityCount,COALESCE(SUM(conflict),0) AS conflictCount FROM real_trade_executions WHERE environment=\'REAL\'').get() as {executionCount:number;incompleteIdentityCount:number;conflictCount:number};
  const pending=(db.prepare('SELECT COUNT(*) n FROM real_trade_executions WHERE quality<>\'COMPLETE\' OR conflict=1').get() as {n:number}).n;
  const diagnostic={configured,lastRun:last?{status:last.status,activity:runActivity(last,nowMs,isAlive),source:last.source,startedAtUtc:last.started_at_utc,lastActivityAtUtc:last.last_activity_at_utc,finishedAtUtc:last.finished_at_utc,received:last.received,inserted:last.inserted,unchanged:last.unchanged,revised:last.revised,conflicts:last.conflicts,rejected:last.rejected,errorCode:last.error_code,coverage:last.coverage}:null,
    interruptedRunCount,...counts,pendingReconciliationCount:pending,coverage:'UNVERIFIED'};
  return RealTradeDiagnostic.parse(diagnostic);
}
