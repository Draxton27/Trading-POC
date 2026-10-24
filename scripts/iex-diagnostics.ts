/** Read-only readiness audit for the existing IEX daily coordinator. */
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {config as loadEnv} from 'dotenv';
import {loadMarketCalendar,type MarketCalendar} from '../trading_poc_001_bollinger/src/alpaca-calendar.ts';
import {phase23ContinuousSuffix,calculatePhase23Features} from '../trading_poc_001_bollinger/src/phase23-dataset.ts';
import {scheduledPostDecisionEntry} from '../trading_poc_001_bollinger/src/phase38c-replay.ts';
import {newYorkBarParts} from '../trading_poc_001_bollinger/src/strategy-validation.ts';
import {PHASE31_FEATURES} from '../trading_poc_001_bollinger/src/phase31-inference.ts';
import {readIexLedger,type IexRecord} from '../trading_poc_001_bollinger/src/phase38-iex.ts';
import {readIexObservations,MAX_LIVE_AGE_MS,type IexObservationRecord,type IexFrozen} from '../trading_poc_001_bollinger/src/phase38f-iex-observation.ts';
import {isIexProcessActive} from '../trading_poc_001_bollinger/src/phase38-iex-lock.ts';
import {loadIexWarmup,type IexWarmup} from '../trading_poc_001_bollinger/src/phase38f-warmup.ts';
import {resolvePrivateDir} from '../apps/api/src/news/paths.ts';
import {iexDailyStatePath,iexLedgerPath,iexObservationPath,readIexDailyState,classifyIexStateFailure,IEX_FROZEN_SHA} from './iex-daily.ts';

const root=fileURLToPath(new URL('../',import.meta.url));
const SHA=(data:Buffer|string)=>createHash('sha256').update(data).digest('hex');
const validUtc=(value:unknown):value is string=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const knownStatus=new Set(['CONNECTING','CONNECTED','AUTHENTICATED','SUBSCRIBED','QUIET_ACTIVE_SESSION','DISCONNECTED','AUTH_FAILED','CONNECTION_LIMIT','SUBSCRIPTION_FAILED','INVALID_MESSAGE','OBSERVATION_STARTED','OBSERVATION_ENDED','CALENDAR_UNAVAILABLE']);
const knownObservation=new Set(['NO_LIVE_DATA','STALE_LIVE_DATA','PREEXISTING_LIVE_DATA','FEED_DISCONNECTED','RECORDED','ALREADY_PRESENT','INDICATORS_INSUFFICIENT','HORIZON_INELIGIBLE','MODEL_TOO_RECENT','MODEL_INCOMPATIBLE','MODEL_NOT_CONFIGURED','OBSERVE_FAILED','ERROR']);
const knownError=new Set(['IEX_COLLECT_START_FAILED','IEX_COLLECT_EXITED','IEX_COLLECT_TERMINAL_ERROR','IEX_COLLECT_RETRIES_EXHAUSTED','IEX_EVALUATION_FAILED','IEX_OBSERVE_FAILED','IEX_OBSERVE_OUTPUT_INVALID','IEX_LEDGER_OR_CALENDAR_INVALID','IEX_AUTOMATION_STATE_INVALID','MODEL_NOT_CONFIGURED','MODEL_INCOMPATIBLE','MODEL_TOO_RECENT']);
export type TaskInspection={state:'ABSENT'|'VALID'|'ERROR';enabled?:boolean;running?:boolean;node?:boolean;script?:boolean;workdir?:boolean;once?:boolean;startWhenAvailable?:boolean;ignoreNew?:boolean;localOpenMinutes?:number;triggerMinutes?:number;nextRunUtc?:string|null;lastRunUtc?:string|null;lastResult?:number|null};
export type Check={status:string;detail?:string;count?:number};
export type Readiness={schema:'phase40d1-iex-readiness-v1';checkedAtUtc:string;checks:Record<string,Check>;blocking:string[];warnings:string[];overall:string;
  counts:{minutes:number;completeQuarters:number;quarterRevisions:number;predictions:number;outcomeNotDue:number;dueUnevaluated:number;evaluated:number;missingEntry:number;missingOutcome:number}};
export type DoctorOptions={env?:NodeJS.ProcessEnv;now?:()=>number;task?:TaskInspection;nodeVersion?:string;tsxAvailable?:boolean;python?:Check;repoRoot?:string;
  modelCheck?:{check:Check;model?:IexFrozen}};

/** Task Scheduler is queried, never changed or started. Neither raw actions nor account names leave this function. */
export function inspectWindowsTask(repoRoot=root):TaskInspection{
  if(process.platform!=='win32')return {state:'ABSENT'};
  const script=`$ErrorActionPreference='Stop'; $z=Get-TimeZone; $utc=[datetime]::SpecifyKind([datetime]'2026-10-26T13:30:00',[System.DateTimeKind]::Utc); $localOpen=[System.TimeZoneInfo]::ConvertTimeFromUtc($utc,$z); $openMinutes=($localOpen.Hour*60+$localOpen.Minute); $t=Get-ScheduledTask -TaskName 'Trading-POC Daily Research' -ErrorAction SilentlyContinue; if($null -eq $t){[pscustomobject]@{absent=$true;localOpenMinutes=$openMinutes}|ConvertTo-Json -Compress;exit}; $i=Get-ScheduledTaskInfo -TaskName 'Trading-POC Daily Research'; [pscustomobject]@{absent=$false;enabled=($t.State -ne 'Disabled');running=($t.State -eq 'Running');execute=$t.Actions[0].Execute;arguments=$t.Actions[0].Arguments;workdir=$t.Actions[0].WorkingDirectory;startWhenAvailable=$t.Settings.StartWhenAvailable;multipleInstances=[string]$t.Settings.MultipleInstances;trigger=$t.Triggers[0].StartBoundary;localOpenMinutes=$openMinutes;nextRun=([datetime]$i.NextRunTime).ToUniversalTime().ToString('o');lastRun=([datetime]$i.LastRunTime).ToUniversalTime().ToString('o');lastResult=$i.LastTaskResult}|ConvertTo-Json -Compress`;
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',timeout:8000,maxBuffer:16000,windowsHide:true});
  if(result.error||result.status!==0)return {state:'ERROR'};
  try{
    const row=JSON.parse(result.stdout.trim()) as Record<string,unknown>;
    if(row.absent===true)return {state:'ABSENT',localOpenMinutes:typeof row.localOpenMinutes==='number'?row.localOpenMinutes:undefined};
    const execute=String(row.execute??''),args=String(row.arguments??''),workdir=String(row.workdir??'');
    const trigger=String(row.trigger??'');const hhmm=/T(\d{2}):(\d{2})/.exec(trigger);
    // The effective Windows zone is checked against the requested Monday's 07:30 local opening.
    const localOpen=Number(row.localOpenMinutes);
    const taskTime=(value:unknown)=>{const time=Date.parse(String(value??''));return Number.isFinite(time)&&time>Date.parse('2000-01-01T00:00:00Z')?new Date(time).toISOString():null;};
    return {state:'VALID',enabled:row.enabled===true,running:row.running===true,node:/[\\/]node(?:\.exe)?$/i.test(execute),
      script:args.includes(resolve(repoRoot,'scripts','daily-orchestrator.ts')),workdir:resolve(workdir).toLowerCase()===resolve(repoRoot).toLowerCase(),
      once:args.includes('--once'),startWhenAvailable:row.startWhenAvailable===true,ignoreNew:row.multipleInstances==='IgnoreNew',
      triggerMinutes:hhmm?Number(hhmm[1])*60+Number(hhmm[2]):undefined,localOpenMinutes:Number.isFinite(localOpen)?localOpen:undefined,
      nextRunUtc:taskTime(row.nextRun),lastRunUtc:taskTime(row.lastRun),
      lastResult:typeof row.lastResult==='number'?row.lastResult:null};
  }catch{return {state:'ERROR'};}
}

function pythonCheck(env:NodeJS.ProcessEnv):Check{
  const executable=env.PYTHON??(process.platform==='win32'?'py':'python3');
  const pyLauncher=process.platform==='win32'&&/^(?:py|py\.exe)$/i.test(executable);
  const args=pyLauncher?['-3.12']:[];
  const result=spawnSync(executable,[...args,'-c',"import json,sys,xgboost;print(json.dumps({'python':list(sys.version_info[:3]),'xgboost':xgboost.__version__}))"],
    {encoding:'utf8',timeout:20_000,maxBuffer:2000,windowsHide:true});
  if(result.error||result.status!==0)return {status:'UNAVAILABLE'};
  try{const row=JSON.parse(result.stdout) as {python:number[];xgboost:string};return {status:row.python[0]===3&&row.python[1]===12&&row.xgboost==='2.1.4'?'AVAILABLE':'INCOMPATIBLE',detail:`Python ${row.python.join('.')} / XGBoost ${row.xgboost}`};}
  catch{return {status:'UNAVAILABLE'};}
}

function checkModel(directory:string|undefined):{check:Check;model?:IexFrozen}{
  if(!directory)return {check:{status:'NOT_CONFIGURED'}};
  if(!existsSync(join(directory,'freeze.json'))||!existsSync(join(directory,'model.json')))return {check:{status:'ABSENT'}};
  try{
    if(statSync(join(directory,'freeze.json')).size>1024*1024||statSync(join(directory,'model.json')).size>64*1024*1024)throw Error();
    const model=JSON.parse(readFileSync(join(directory,'freeze.json'),'utf8')) as IexFrozen;
    const actual=SHA(readFileSync(join(directory,'model.json')));
    if(model.schema!=='phase38f-frozen-v1'||actual!==IEX_FROZEN_SHA||model.modelSha256!==actual||model.feed!=='iex'||model.adjustment!=='raw'||
      JSON.stringify(model.features)!==JSON.stringify(PHASE31_FEATURES)||JSON.stringify(model.classes)!==JSON.stringify(['ALCISTA','BAJISTA','LATERAL'])||
      !validUtc(model.cutoffUtc)||!validUtc(model.frozenAtUtc)||model.cutoffUtc>model.frozenAtUtc)return {check:{status:'INCOMPATIBLE'}};
    return {check:{status:'VERIFIED',detail:`SHA-256 ${actual}`},model};
  }catch{return {check:{status:'INVALID'}};}
}

function auditLive(rows:IexRecord[],calendar:MarketCalendar|undefined){
  const first=new Map<string,IexRecord>(),seen=new Map<string,number>();let priorReceived=0,minutes=0,revisions=0,disconnects=0;
  for(const row of rows){
    if(!validUtc(row.receivedAtUtc)||Date.parse(row.receivedAtUtc)<priorReceived)throw Error('LEDGER_CHRONOLOGY');
    priorReceived=Date.parse(row.receivedAtUtc);
    if(row.kind==='status'){if(!knownStatus.has(row.status)||row.bar)throw Error('LEDGER_STATUS');if(row.status==='DISCONNECTED')disconnects++;continue;}
    const bar=row.bar;if(!bar||!validUtc(bar.startUtc)||!validUtc(bar.endUtc)||!Number.isInteger(row.revision)||row.revision!==(seen.get(`${row.kind}:${bar.startUtc}`)??0)+1||
      Date.parse(bar.endUtc)-Date.parse(bar.startUtc)!==(row.kind==='minute'?60_000:900_000)||
      Date.parse(row.receivedAtUtc)<Date.parse(bar.endUtc))throw Error('LEDGER_BAR');
    if(bar.open<=0||bar.low<=0||bar.high<Math.max(bar.open,bar.close,bar.low)||bar.low>Math.min(bar.open,bar.close)||
      !Number.isSafeInteger(bar.volume)||bar.volume<0||!Number.isSafeInteger(bar.tradeCount)||bar.tradeCount<0)throw Error('LEDGER_OHLCV');
    if(calendar&&!calendarHas(calendar,bar.startUtc))throw Error('LEDGER_CALENDAR');
    seen.set(`${row.kind}:${bar.startUtc}`,row.revision!);
    if(row.kind==='minute')minutes++;
    else{if(row.status!=='COMPLETE')throw Error('LEDGER_QUARTER');if(!first.has(bar.startUtc))first.set(bar.startUtc,row);else revisions++;}
  }
  return {first:[...first.values()].sort((a,b)=>a.bar!.startUtc.localeCompare(b.bar!.startUtc)),minutes,revisions,disconnects};
}
function inspectQuarterEvidence(records:IexRecord[],quarters:IexRecord[]){
  let verified=0,missing=0,mismatch=0;
  const minutes=records.filter(row=>row.kind==='minute'&&row.bar);
  for(const quarter of quarters){
    const start=Date.parse(quarter.bar!.startUtc),received=Date.parse(quarter.receivedAtUtc);
    const values=[] as IexRecord[];
    for(let i=0;i<15;i++){
      const slot=new Date(start+i*60_000).toISOString();
      const latest=minutes.filter(row=>row.bar!.startUtc===slot&&Date.parse(row.receivedAtUtc)<=received).at(-1);
      if(!latest)break;values.push(latest);
    }
    if(values.length!==15){missing++;continue;}
    const bars=values.map(row=>row.bar!),candidate=quarter.bar!;
    if(candidate.open!==bars[0]!.open||candidate.close!==bars[14]!.close||candidate.high!==Math.max(...bars.map(bar=>bar.high))||
      candidate.low!==Math.min(...bars.map(bar=>bar.low))||candidate.volume!==bars.reduce((sum,bar)=>sum+bar.volume,0)||
      candidate.tradeCount!==bars.reduce((sum,bar)=>sum+bar.tradeCount,0))mismatch++;
    else verified++;
  }
  return {verified,missing,mismatch};
}
function inspectLastSession(quarters:IexRecord[],calendar:MarketCalendar,now:number):Check{
  if(!quarters.length)return {status:'NO_COMPLETE_LIVE_BAR'};
  const latest=quarters.at(-1)!.bar!,local=newYorkBarParts(latest.startUtc),hours=calendar.get(local.day);
  if(!hours)return {status:'CALENDAR_UNAVAILABLE'};
  const sessionRows=quarters.filter(row=>newYorkBarParts(row.bar!.startUtc).day===local.day);
  const first=sessionRows[0]!.bar!,[h,m]=newYorkBarParts(first.startUtc).slot.split(':').map(Number);
  const openUtc=Date.parse(first.startUtc)-(h!*60+m!-hours.open)*60_000;
  const closeUtc=openUtc+(hours.close-hours.open)*60_000;
  const starts=new Set(sessionRows.map(row=>row.bar!.startUtc));
  const expected=Math.min((hours.close-hours.open)/15,Math.max(0,Math.floor((Math.min(now,closeUtc)-openUtc)/900_000)));
  const absent=Array.from({length:expected},(_,i)=>new Date(openUtc+i*900_000).toISOString()).filter(slot=>!starts.has(slot));
  if(absent.length===0)return {status:now>=closeUtc?'COMPLETE':'PARTIAL_IN_PROGRESS',detail:`${sessionRows.length}/${(hours.close-hours.open)/15} velas`};
  const firstExpected=new Date(openUtc).toISOString(),lastExpected=new Date(closeUtc-900_000).toISOString();
  const status=absent.includes(firstExpected)?'MISSING_FIRST':now>=closeUtc&&absent.includes(lastExpected)?'MISSING_CLOSE':'INTRADAY_GAP';
  return {status,detail:`${absent.length} de ${expected} velas exigibles ausentes`};
}
function calendarHas(calendar:MarketCalendar,utc:string){
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(utc));
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(utc));
  const session=calendar.get(date),[hour,minute]=parts.split(':').map(Number),slot=hour!*60+minute!;
  return !!session&&slot>=session.open&&slot<session.close;
}
function auditObservations(rows:IexObservationRecord[],now:number,quarters:IexRecord[]){
  const predictions=new Map<string,Extract<IexObservationRecord,{kind:'PREDICTION'}>>(),evaluations=new Map<string,Extract<IexObservationRecord,{kind:'EVALUATION'}>>();
  const uniqueBars=new Set<string>(),byStart=new Map(quarters.map(row=>[row.bar!.startUtc,row]));
  for(const row of rows){
    if(row.kind==='PREDICTION'){
      const key=`${row.modelSha256}:${row.barStartUtc}`;
      if(predictions.has(row.id)||uniqueBars.has(key)||[row.barStartUtc,row.barEndUtc,row.receivedAtUtc,row.registeredAtUtc,row.entryAtUtc,row.outcomeAtUtc].some(x=>!validUtc(x))||
        Date.parse(row.registeredAtUtc)>=Date.parse(row.outcomeAtUtc)||Date.parse(row.registeredAtUtc)<Date.parse(row.receivedAtUtc)||
        Date.parse(row.entryAtUtc)<=Date.parse(row.registeredAtUtc)||Date.parse(row.outcomeAtUtc)-Date.parse(row.entryAtUtc)!==4*900_000||
        row.source?.symbol!=='NVDA'||row.source.feed!=='iex'||row.source.adjustment!=='raw'||row.source.timeframe!=='15m')throw Error('PREDICTION_INVALID');
      for(const values of Object.values(row.probabilities??{}))if(!Array.isArray(values)||values.length!==3||values.some(n=>!Number.isFinite(n)||n<0||n>1)||Math.abs(values.reduce((sum,n)=>sum+n,0)-1)>1e-6)throw Error('PREDICTION_PROBABILITIES');
      if(Object.keys(row.probabilities??{}).length!==3)throw Error('PREDICTION_PROBABILITIES');
      predictions.set(row.id,row);uniqueBars.add(key);
    }else{
      if(evaluations.has(row.predictionId)||!['EVALUATED','MISSING_ENTRY','MISSING_OUTCOME'].includes(row.status)||!validUtc(row.evaluatedAtUtc))throw Error('EVALUATION_INVALID');
      evaluations.set(row.predictionId,row);
    }
  }
  let notDue=0,due=0,evaluated=0,missingEntry=0,missingOutcome=0;
  for(const [id,prediction] of predictions){const result=evaluations.get(id);
    if(!result){if(now<Date.parse(prediction.outcomeAtUtc)+30*60_000)notDue++;else due++;continue;}
    if(Date.parse(result.evaluatedAtUtc)<Date.parse(prediction.outcomeAtUtc))throw Error('EVALUATION_PREMATURE');
    if(result.status==='EVALUATED'){
      if(!result.entrySourceHash||!result.outcomeSourceHash||!Number.isFinite(result.entryOpen)||!Number.isFinite(result.outcomeClose)||!result.label)throw Error('EVALUATION_INCOMPLETE');
      const bars=Array.from({length:4},(_,i)=>byStart.get(new Date(Date.parse(prediction.entryAtUtc)+i*900_000).toISOString()));
      if(bars.some(bar=>!bar)||bars[0]!.recordHash!==result.entrySourceHash||bars[3]!.recordHash!==result.outcomeSourceHash||
        bars[0]!.bar!.open!==result.entryOpen||bars[3]!.bar!.close!==result.outcomeClose)throw Error('EVALUATION_SOURCE_MISMATCH');
      evaluated++;
    }else if(result.status==='MISSING_ENTRY')missingEntry++;
    else missingOutcome++;
  }
  if([...evaluations.keys()].some(id=>!predictions.has(id)))throw Error('EVALUATION_ORPHAN');
  return {predictions:predictions.size,notDue,due,evaluated,missingEntry,missingOutcome};
}

export function diagnoseIex(options:DoctorOptions={}):Readiness{
  const env=options.env??process.env,now=options.now?.()??Date.now(),checks:Record<string,Check>={},blocking:string[]=[],warnings:string[]=[];
  const counts={minutes:0,completeQuarters:0,quarterRevisions:0,predictions:0,outcomeNotDue:0,dueUnevaluated:0,evaluated:0,missingEntry:0,missingOutcome:0};
  const set=(name:string,status:string,detail?:string)=>{checks[name]={status,...(detail?{detail}:{})};};
  const base=resolvePrivateDir({repoRoot:options.repoRoot??root,env});
  set('node',/^v(?:22|24)\./.test(options.nodeVersion??process.version)?'AVAILABLE':'INCOMPATIBLE',options.nodeVersion??process.version);
  set('tsx',options.tsxAvailable??existsSync(resolve(options.repoRoot??root,'node_modules','tsx'))?'AVAILABLE':'UNAVAILABLE');
  set('envLocal',existsSync(resolve(options.repoRoot??root,'.env.local'))?'PRESENT':'ABSENT');
  set('alpacaCredentials',env.APCA_API_KEY_ID&&env.APCA_API_SECRET_KEY?'PRESENT':'MISSING');
  checks.python=options.python??pythonCheck(env);
  const task=options.task??inspectWindowsTask(options.repoRoot??root);
  set('windowsLocalOpen',task.localOpenMinutes===450?'07:30_EXPECTED':task.localOpenMinutes===undefined?'UNKNOWN':'OTHER_TIME_ZONE');
  if(task.state==='ABSENT')set('windowsTask','NOT_INSTALLED');
  else if(task.state==='ERROR')set('windowsTask','READ_ERROR');
  else{
    const valid=task.enabled&&task.node&&task.script&&task.workdir&&task.once&&task.startWhenAvailable&&task.ignoreNew&&
      task.localOpenMinutes===450&&task.triggerMinutes===360;
    set('windowsTask',valid?'CONFIGURED':'MISCONFIGURED',task.running?'RUNNING':'READY');
    set('taskLastResult',task.lastRunUtc?task.lastResult===0?'SUCCESS':'NONZERO':'NEVER_RUN',task.lastRunUtc?`UTC ${task.lastRunUtc}; código ${task.lastResult??'N/D'}`:undefined);
    set('taskNextRun',task.nextRunUtc?'SCHEDULED':'UNKNOWN',task.nextRunUtc?`UTC ${task.nextRunUtc}`:undefined);
  }
  const model=options.modelCheck??checkModel(env.TRADING_POC_IEX_FROZEN_DIR);checks.frozenModel=model.check;
  const ledgerPath=iexLedgerPath(env),calendarPath=env.TRADING_POC_IEX_CALENDAR??resolve(base,'iex','calendar.json'),observationPath=iexObservationPath(env),statePath=iexDailyStatePath(env);
  // Paths are resolved by the same functions as the collector. Only their presence, never the paths, is reported.
  set('storage','RESOLVED');
  let calendar:MarketCalendar|undefined,live:IexRecord[]=[],first:IexRecord[]=[];
  try{if(!existsSync(calendarPath))set('calendar','ABSENT');else{calendar=loadMarketCalendar(calendarPath);set('calendar','VALID',`${calendar.size} sesiones oficiales`);}}
  catch{set('calendar','INVALID');}
  set('marketSession',calendar?calendarHas(calendar,new Date(now).toISOString())?'OPEN':'CLOSED':'CALENDAR_UNAVAILABLE');
  try{if(!existsSync(ledgerPath))set('iexLedger','ABSENT');else{
    live=readIexLedger(ledgerPath);const audit=auditLive(live,calendar);first=audit.first;
    counts.minutes=audit.minutes;counts.completeQuarters=first.length;counts.quarterRevisions=audit.revisions;
    set('iexLedger',live.length?'VALID':'EMPTY',`${audit.disconnects} desconexiones; ${audit.revisions} revisiones de 15m`);
    const evidence=inspectQuarterEvidence(live,first);
    set('quarterEvidence',evidence.mismatch?'MISMATCH':evidence.missing?'INCOMPLETE':'VERIFIED',`${evidence.verified} verificadas; ${evidence.missing} sin 15 minutos; ${evidence.mismatch} contradictorias`);
    if(calendar)checks.lastSession=inspectLastSession(first,calendar,now);
  }}catch{set('iexLedger','INVALID');}
  let observations:IexObservationRecord[]=[];
  try{if(!existsSync(observationPath))set('observationLedger','ABSENT');else{
    observations=readIexObservations(observationPath);const audit=auditObservations(observations,now,first);
    Object.assign(counts,{predictions:audit.predictions,outcomeNotDue:audit.notDue,dueUnevaluated:audit.due,evaluated:audit.evaluated,missingEntry:audit.missingEntry,missingOutcome:audit.missingOutcome});
    set('observationLedger',observations.length?'VALID':'EMPTY');
  }}catch{set('observationLedger','INVALID');}
  try{const state=readIexDailyState(statePath);if(!state)set('automationState','ABSENT');
    else {set('automationState','VALID',`${state.collector}/${['MANAGED','EXTERNAL','NONE'].includes(state.owner)?state.owner:'UNKNOWN'}/${knownObservation.has(state.observationStatus)?state.observationStatus:'UNKNOWN'}`);
      if(state.lastErrorCode)checks.lastExecution={status:'ERROR',detail:knownError.has(state.lastErrorCode)?state.lastErrorCode:'UNKNOWN_ERROR'};
      else set('lastExecution','NO_RECORDED_ERROR');}}
  catch(error){set('automationState',classifyIexStateFailure(error));}
  set('collectorProcess',isIexProcessActive(ledgerPath)?'ACTIVE':'INACTIVE');
  let warmup:IexWarmup|undefined;
  if(!env.TRADING_POC_IEX_WARMUP_REGISTRY)set('warmup','NOT_CONFIGURED');
  else try{const loaded=loadIexWarmup(env.TRADING_POC_IEX_WARMUP_REGISTRY);
    if(!validUtc(loaded.registeredAtUtc)||loaded.candles.some(bar=>Date.parse(bar.timestamp)+900_000>Date.parse(loaded.registeredAtUtc)))throw Error();
    warmup=loaded;set('warmup','VERIFIED',`${loaded.candles.length} velas REST para indicadores`);
  }catch{set('warmup','INVALID');}
  if(first.length&&calendar){
    try{
      const candidate=first.at(-1)!;const historical=warmup?.candles.filter(bar=>bar.timestamp<first[0]!.bar!.startUtc)??[];
      const merged=new Map(calendar);for(const [date,hours] of warmup?.calendar??[])if(merged.has(date)&&JSON.stringify(merged.get(date))!==JSON.stringify(hours))throw Error('CALENDAR_CONFLICT');else merged.set(date,hours);
      const candles=[...historical,...first.map(row=>({timestamp:row.bar!.startUtc,open:row.bar!.open,high:row.bar!.high,low:row.bar!.low,close:row.bar!.close,volume:row.bar!.volume}))];
      const suffix=phase23ContinuousSuffix(candles,merged),features=calculatePhase23Features(suffix,merged).at(-1);
      const length=suffix.length;
      if(warmup)set('warmupBridge',suffix.some(bar=>bar.timestamp<first[0]!.bar!.startUtc)?'CONNECTED':'DISCONNECTED');
      set('continuity',length>=21&&features?'SUFFICIENT':'INSUFFICIENT',`${length} velas continuas verificables hasta ${candidate.bar!.endUtc}`);
      if(warmup&&Date.parse(warmup.registeredAtUtc)>=Date.parse(candidate.bar!.startUtc))set('warmup','TOO_LATE_FOR_CANDIDATE');
    }catch{set('continuity','INVALID_CALENDAR_OR_GAP');}
  }else set('continuity',first.length?'CALENDAR_UNAVAILABLE':'NO_COMPLETE_LIVE_BAR');
  if(checks.warmup.status==='NOT_CONFIGURED'&&checks.continuity.status!=='SUFFICIENT')set('warmupAdvice','WARMUP_RECOMMENDED');
  const latest=first.at(-1),feed=live.filter(row=>row.kind==='status').at(-1)?.status;
  if(!latest)set('candidate','NO_LIVE_DATA');
  else if(now-Date.parse(latest.receivedAtUtc)>MAX_LIVE_AGE_MS)set('candidate','STALE_LIVE_DATA');
  else if(feed==='DISCONNECTED'||feed==='OBSERVATION_ENDED')set('candidate','FEED_DISCONNECTED');
  else if(model.model&&Date.parse(model.model.frozenAtUtc)>=Date.parse(latest.bar!.startUtc))set('candidate','MODEL_TOO_RECENT');
  else if(observations.some(row=>row.kind==='PREDICTION'&&row.modelSha256===IEX_FROZEN_SHA&&row.barStartUtc===latest.bar!.startUtc))set('candidate','ALREADY_PRESENT');
  else if(calendar){
    const local=newYorkBarParts(latest.bar!.startUtc),session=calendar.get(local.day);
    try{
      if(!session)throw Error('CALENDAR');
      const [hour,minute]=local.slot.split(':').map(Number);
      const horizon=scheduledPostDecisionEntry(latest.bar!.startUtc,new Date(now).toISOString(),hour!*60+minute!,session);
      set('candidate',horizon.horizonEndUtc?'FRESH_BAR_REQUIRES_RUNNING_OBSERVER':'HORIZON_INELIGIBLE');
    }catch{set('candidate','HORIZON_INELIGIBLE');}
  }else set('candidate','CALENDAR_UNAVAILABLE');
  set('evaluations',counts.dueUnevaluated?'DUE_UNEVALUATED':counts.outcomeNotDue?'PENDING_HORIZON':counts.evaluated+counts.missingEntry+counts.missingOutcome?'RECORDED':'NONE');
  set('statisticalEvidence','INSUFFICIENT_EVIDENCE');
  const dataInvalid=['iexLedger','observationLedger','calendar','continuity','warmup','quarterEvidence'].some(name=>['INVALID','INVALID_CALENDAR_OR_GAP','MISMATCH'].includes(checks[name]?.status??''));
  for(const name of ['iexLedger','observationLedger','calendar'])if(checks[name]?.status==='INVALID')blocking.push(name);
  if(checks.windowsTask?.status!=='CONFIGURED')blocking.push('windowsTask');
  for(const name of ['node','tsx','alpacaCredentials','python','frozenModel'])if(!['AVAILABLE','PRESENT','VERIFIED'].includes(checks[name]?.status??''))blocking.push(name);
  if(checks.warmup.status==='INVALID')blocking.push('warmup');
  if(['INVALID','READ_ERROR'].includes(checks.automationState.status))blocking.push('automationState');
  if(checks.continuity.status!=='SUFFICIENT')warnings.push('continuity');
  if(checks.quarterEvidence?.status==='INCOMPLETE')warnings.push('quarterEvidence');
  if(checks.warmupBridge?.status==='DISCONNECTED')warnings.push('warmupBridge');
  if(['MISSING_FIRST','MISSING_CLOSE','INTRADAY_GAP'].includes(checks.lastSession?.status??''))warnings.push('lastSession');
  if(counts.dueUnevaluated)warnings.push('dueUnevaluated');
  if(checks.automationState.status==='ABSENT')warnings.push('automationStateAbsent');
  const offHours=checks.marketSession.status==='CLOSED';
  const nonTaskBlocks=blocking.filter(name=>name!=='windowsTask'&&name!=='automationState');
  const overall=dataInvalid?'BLOCKED_DATA_INTEGRITY':nonTaskBlocks.length?'BLOCKED_CONFIGURATION':
    checks.windowsTask.status!=='CONFIGURED'||blocking.includes('automationState')?'BLOCKED_AUTOMATION':
    checks.continuity.status!=='SUFFICIENT'?'WAITING_FOR_CONTINUOUS_HISTORY':counts.dueUnevaluated?'EVALUATIONS_PENDING':
    offHours?'OFF_HOURS_CONFIGURED':checks.candidate.status==='HORIZON_INELIGIBLE'?'WAITING_FOR_ELIGIBLE_HORIZON':
    checks.candidate.status==='NO_LIVE_DATA'?'WAITING_FOR_COMPLETE_BAR':checks.windowsTask.detail==='RUNNING'?'COLLECTING':
    counts.predictions?'PREDICTIONS_RECORDED':'READY_FOR_NEXT_SESSION';
  return {schema:'phase40d1-iex-readiness-v1',checkedAtUtc:new Date(now).toISOString(),checks,blocking,warnings,overall,counts};
}

export function exportPrivateReport(report:Readiness,directory:string){
  if(existsSync(directory))throw new Error('El destino ya existe; el diagnóstico no sobrescribe reportes.');
  mkdirSync(directory,{recursive:true});
  const json=JSON.stringify(report,null,2)+'\n';
  const md=`# IEX READINESS\n\nFecha: ${report.checkedAtUtc}\n\nEstado: **${report.overall}**\n\n| Comprobación | Estado |\n|---|---|\n${Object.entries(report.checks).map(([name,check])=>`| ${name} | ${check.status} |`).join('\n')}\n\nPredicciones: ${report.counts.predictions}; evaluadas: ${report.counts.evaluated}; pendientes vencidas: ${report.counts.dueUnevaluated}.\n`;
  writeFileSync(join(directory,'report.json'),json,{flag:'wx'});writeFileSync(join(directory,'report.md'),md,{flag:'wx'});
  writeFileSync(join(directory,'SHA256SUMS'),`${SHA(json)}  report.json\n${SHA(md)}  report.md\n`,{flag:'wx'});
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  loadEnv({path:resolve(root,'.env.local'),override:false,quiet:true});loadEnv({path:resolve(root,'.env'),override:false,quiet:true});
  const args=process.argv.slice(2);
  if(args.length&&!(args.length===2&&args[0]==='--output-dir'))throw new Error('Uso: npm.cmd run iex:doctor -- [--output-dir ruta_privada_nueva]');
  const report=diagnoseIex();
  process.stdout.write(`IEX READINESS\n${Object.entries(report.checks).map(([name,check])=>`${name}: ${check.status}${check.detail?` (${check.detail})`:''}`).join('\n')}\n`+
    `Predicciones: ${report.counts.predictions}; evaluadas: ${report.counts.evaluated}; pendientes vencidas: ${report.counts.dueUnevaluated}\nOverall: ${report.overall}\n`);
  if(args.length){
    const privateRoot=resolvePrivateDir({repoRoot:root}),destination=resolve(args[1]!),inside=relative(privateRoot,destination);
    if(!inside||inside.startsWith('..')||isAbsolute(inside))throw new Error('El reporte debe guardarse en una carpeta nueva dentro del directorio privado configurado.');
    exportPrivateReport(report,destination);
  }
}
