import {createHash,randomUUID} from 'node:crypto';
import type Database from 'better-sqlite3';
import {RealTradeDiagnostic,type RealTradeExecution} from '@trading-poc/contracts';
import {DEFAULT_FIELDS,executionHash,hasStableSourceRecordId,normalizeExecution,sourceRecordId,type FieldMap,type InputRecord} from './normalize.ts';

type Outcome='inserted'|'unchanged'|'revised'|'conflicts'|'rejected';
type IdentityRow={id:string;latest_version_id:string|null;quality:string;conflict:number};
type VersionRow={id:string;content_hash:string;source:string;source_record_id:string;revision:number;kind:string};
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
    const outcome=this.db.transaction(():Outcome=>{
      const current=this.db.prepare('SELECT id,latest_version_id,quality,conflict FROM real_trade_executions WHERE id=?').get(key) as IdentityRow|undefined;
      const latest=current?.latest_version_id?this.db.prepare('SELECT id,content_hash,source,source_record_id,revision,kind FROM real_trade_versions WHERE id=?').get(current.latest_version_id) as VersionRow:undefined;
      if(latest?.content_hash===hash){
        const id=provenanceId(latest.id,this.source,recordId);
        this.db.prepare('INSERT OR IGNORE INTO real_trade_provenance(id,version_id,source,source_record_id,first_seen_at_utc) VALUES (?,?,?,?,?)').run(id,latest.id,this.source,recordId,now);
        return 'unchanged';
      }
      const prior=this.db.prepare('SELECT 1 FROM real_trade_provenance p JOIN real_trade_versions v ON v.id=p.version_id WHERE v.execution_id=? AND p.source=? AND p.source_record_id=? LIMIT 1').get(key,this.source,recordId);
      const kind=current?(prior&&hasStableSourceRecordId(record,this.mapping)?'REVISION':'CONFLICT'):'ORIGINAL';
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
    this.db.prepare('INSERT INTO real_trade_import_runs(id,source,started_at_utc,status,received,inserted,unchanged,revised,conflicts,rejected,coverage) VALUES (?,?,?,\'RUNNING\',0,0,0,0,0,0,\'UNVERIFIED\')').run(id,this.source,started);
    const counts={received:0,inserted:0,unchanged:0,revised:0,conflicts:0,rejected:0};let min:string|null=null,max:string|null=null,errorCode:string|null=null;
    try{
      for await(const record of records){
        if(counts.received>=10000)throw new Error('RECORD_LIMIT');
        counts.received++;
        const result=this.ingestOne(record);counts[result.outcome]++;
        if(result.at){if(min===null||result.at<min)min=result.at;if(max===null||result.at>max)max=result.at;}
      }
    }catch(error){errorCode=error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'IMPORT_FAILED';}
    const status=errorCode?(counts.received>0?'PARTIAL_COVERAGE_UNVERIFIED':'FAILED'):(counts.conflicts||counts.rejected?'PARTIAL_COVERAGE_UNVERIFIED':'SUCCESS_COVERAGE_UNVERIFIED');
    this.db.prepare('UPDATE real_trade_import_runs SET finished_at_utc=?,status=?,received=?,inserted=?,unchanged=?,revised=?,conflicts=?,rejected=?,error_code=?,min_executed_at_utc=?,max_executed_at_utc=? WHERE id=?').run(this.clock(),status,counts.received,counts.inserted,counts.unchanged,counts.revised,counts.conflicts,counts.rejected,errorCode,min,max,id);
    return {id,status,source:this.source,...counts,errorCode,coverage:'UNVERIFIED',minExecutedAtUtc:min,maxExecutedAtUtc:max};
  }
}

export function realTradeDiagnostic(db:Database.Database,configured:boolean){
  const last=db.prepare('SELECT source,started_at_utc,finished_at_utc,status,received,inserted,unchanged,revised,conflicts,rejected,error_code,coverage FROM real_trade_import_runs ORDER BY started_at_utc DESC,id DESC LIMIT 1').get() as Record<string,unknown>|undefined;
  const counts=db.prepare('SELECT COUNT(*) AS executionCount,COALESCE(SUM(CASE WHEN quality IN (\'INCOMPLETE_CONTRACT\',\'INCOMPLETE_CONTRACT_AND_PRICE\') THEN 1 ELSE 0 END),0) AS incompleteIdentityCount,COALESCE(SUM(conflict),0) AS conflictCount FROM real_trade_executions WHERE environment=\'REAL\'').get() as {executionCount:number;incompleteIdentityCount:number;conflictCount:number};
  const pending=(db.prepare('SELECT COUNT(*) n FROM real_trade_executions WHERE quality<>\'COMPLETE\' OR conflict=1').get() as {n:number}).n;
  const diagnostic={configured,lastRun:last?{status:last.status,source:last.source,startedAtUtc:last.started_at_utc,finishedAtUtc:last.finished_at_utc,received:last.received,inserted:last.inserted,unchanged:last.unchanged,revised:last.revised,conflicts:last.conflicts,rejected:last.rejected,errorCode:last.error_code,coverage:last.coverage}:null,
    ...counts,pendingReconciliationCount:pending,coverage:'UNVERIFIED'};
  return RealTradeDiagnostic.parse(diagnostic);
}
