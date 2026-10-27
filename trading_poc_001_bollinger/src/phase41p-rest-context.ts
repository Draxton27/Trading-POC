/** Versioned, private REST context for future 41P evaluations; independent of the frozen 38F registry. */
import {createHash} from 'node:crypto';
import {linkSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import {verifyIexHistoricalRun} from './phase38f-warmup.ts';
import type {RestContext} from './phase41p-continuity.ts';

const sha=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const validUtc=(value:string)=>Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
export type IexRestContextRegistry={schema:'IEX_REST_CONTEXT_SNAPSHOT';snapshotId:string;
  sourceDir:string;feed:'iex';adjustment:'raw';symbol:'NVDA';
  requestedWindow:{start:string;end:string};retrievedAtUtc:null;registeredAtUtc:string;
  calendarHash:string;contentHash:string;manifestSha256:string;
  coverage:{sessionsComplete:number;sessionsPartial:number;strict15m:number;missingIntervals:number};
  availabilityStatus:'REGISTERED_FOR_FUTURE_EVALUATIONS'};

export function registerIexRestContext(source:string,out:string,clock:()=>string=()=>new Date().toISOString()){
  const sourceDir=resolve(source),verified=verifyIexHistoricalRun(sourceDir);
  const registeredAtUtc=clock();
  if(!validUtc(registeredAtUtc)||verified.candles.some(bar=>Date.parse(bar.timestamp)+900_000>Date.parse(registeredAtUtc)))
    throw new Error('CONTEXT_REGISTRATION_TIME_INVALID');
  const query=verified.query as {start:string;end:string},summary=verified.report.summary as Record<string,number>;
  if(!validUtc(query.start)||!validUtc(query.end)||Date.parse(query.end)>Date.parse(registeredAtUtc))
    throw new Error('CONTEXT_WINDOW_INVALID');
  const calendarHash=sha(readFileSync(join(sourceDir,'calendar.json')));
  const snapshotId=sha(JSON.stringify([verified.manifestSha256,registeredAtUtc]));
  const registry:IexRestContextRegistry={schema:'IEX_REST_CONTEXT_SNAPSHOT',snapshotId,sourceDir,
    feed:'iex',adjustment:'raw',symbol:'NVDA',requestedWindow:{start:query.start,end:query.end},
    retrievedAtUtc:null,registeredAtUtc,calendarHash,contentHash:verified.csvSha256,
    manifestSha256:verified.manifestSha256,
    coverage:{sessionsComplete:summary.sessionsComplete??0,sessionsPartial:summary.sessionsPartial??0,
      strict15m:summary.strict15m??0,missingIntervals:summary.missingMinutes??0},
    availabilityStatus:'REGISTERED_FOR_FUTURE_EVALUATIONS'};
  // Same-directory hard link publishes a complete file and refuses to replace a prior registry.
  const temporary=`${out}.${randomUUID()}.tmp`;
  try{writeFileSync(temporary,JSON.stringify(registry,null,2)+'\n',{flag:'wx',mode:0o600});
    linkSync(temporary,out);
  }finally{rmSync(temporary,{force:true});}
  return {snapshotId,registeredAtUtc,coverage:registry.coverage};
}

export function loadIexRestContext(path:string):RestContext & {snapshotId:string;registry:IexRestContextRegistry}{
  const registry=JSON.parse(readFileSync(path,'utf8')) as IexRestContextRegistry;
  if(registry.schema!=='IEX_REST_CONTEXT_SNAPSHOT'||registry.symbol!=='NVDA'||registry.feed!=='iex'||
    registry.adjustment!=='raw'||registry.availabilityStatus!=='REGISTERED_FOR_FUTURE_EVALUATIONS'||
    !validUtc(registry.registeredAtUtc)||
    registry.snapshotId!==sha(JSON.stringify([registry.manifestSha256,registry.registeredAtUtc])))
    throw new Error('CONTEXT_REGISTRY_INVALID');
  const verified=verifyIexHistoricalRun(registry.sourceDir);
  const calendarHash=sha(readFileSync(join(registry.sourceDir,'calendar.json')));
  if(verified.manifestSha256!==registry.manifestSha256||verified.csvSha256!==registry.contentHash||
    calendarHash!==registry.calendarHash||verified.query.start!==registry.requestedWindow.start||
    verified.query.end!==registry.requestedWindow.end||
    verified.candles.some(bar=>Date.parse(bar.timestamp)+900_000>Date.parse(registry.registeredAtUtc)))
    throw new Error('CONTEXT_SOURCE_CHANGED');
  return {candles:verified.candles,calendar:verified.calendar,registeredAtUtc:registry.registeredAtUtc,
    csvSha256:verified.csvSha256,manifestSha256:verified.manifestSha256,
    kind:'41P_REST_CONTEXT',snapshotId:registry.snapshotId,registry};
}
