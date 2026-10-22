/** Stable, bounded protocol between the local observer and the coordinated collector. */
export const OBSERVER_ERROR_PREFIX='TRADING_POC_OBSERVER_ERROR:';
export type ObserverCode='PYTHON_ERROR'|'HORIZON_INELIGIBLE'|'INDICATORS_INSUFFICIENT'|'OUTCOME_PASSED'|'LEDGER_INVALID'|'MODEL_NOT_CONFIGURED'|'ERROR';
const codes=new Set<ObserverCode>(['PYTHON_ERROR','HORIZON_INELIGIBLE','INDICATORS_INSUFFICIENT','OUTCOME_PASSED','LEDGER_INVALID','MODEL_NOT_CONFIGURED','ERROR']);
export type ObserverErrorReport={code:ObserverCode;exitCode:number|null;signal:string|null;cause:string;retryable:boolean};

export class ObserverFailure extends Error{
  readonly code:ObserverCode;
  readonly details:Partial<Omit<ObserverErrorReport,'code'>>;
  constructor(code:ObserverCode,message:string,details:Partial<Omit<ObserverErrorReport,'code'>>={}){
    super(message);this.name='ObserverFailure';this.code=code;this.details=details;
  }
}

/** Never carry raw subprocess output, filesystem paths, or environment secrets into status or API. */
export function boundedCause(raw:string):string{
  const secretValues=['APCA_API_KEY_ID','APCA_API_SECRET_KEY','TRADING_POC_AGENT_SECRET'].map(name=>process.env[name]).filter((value):value is string=>!!value&&value.length>=4);
  let value=raw.split(/\r?\n/).filter(Boolean).at(-1)??'UNKNOWN';
  for(const secret of secretValues)value=value.replaceAll(secret,'[REDACTED]');
  value=value.replace(/[A-Za-z]:\\[^\s"']+/g,'[PATH]').replace(/(?:\/[^\s"']+){2,}/g,'[PATH]')
    .replace(/\b(?:DU|U)\d{5,}\b/gi,'[ACCOUNT]');
  return value.replace(/[\x00-\x1f\x7f]/g,' ').slice(0,500)||'UNKNOWN';
}

export function observerFailure(error:unknown):ObserverErrorReport{
  if(error instanceof ObserverFailure)return {code:error.code,exitCode:error.details.exitCode??null,signal:error.details.signal??null,cause:boundedCause(error.details.cause??error.message),retryable:error.details.retryable??false};
  const message=error instanceof Error?error.message:String(error);
  let code:ObserverCode='ERROR';
  if(/horizonte Fase 23/i.test(message))code='HORIZON_INELIGIBLE';
  else if(/Indicadores insuficientes|continuidad temporal/i.test(message))code='INDICATORS_INSUFFICIENT';
  else if(/desenlace|backfill/i.test(message))code='OUTCOME_PASSED';
  else if(/modelo|TRADING_POC_ML_RUN_DIR|artefactos/i.test(message))code='MODEL_NOT_CONFIGURED';
  else if(/ledger|registro de ingesta|calendario|hash|secuencial|alterado/i.test(message)||error instanceof SyntaxError)code='LEDGER_INVALID';
  return {code,exitCode:null,signal:null,cause:boundedCause(message),retryable:false};
}

export function encodeObserverFailure(error:unknown):string{return OBSERVER_ERROR_PREFIX+JSON.stringify(observerFailure(error));}
export function decodeObserverFailure(output:string):ObserverErrorReport|null{
  const line=output.split(/\r?\n/).find(part=>part.startsWith(OBSERVER_ERROR_PREFIX));if(!line)return null;
  try{const row=JSON.parse(line.slice(OBSERVER_ERROR_PREFIX.length)) as Partial<ObserverErrorReport>;
    if(!codes.has(row.code as ObserverCode)||row.exitCode!==null&&(!Number.isInteger(row.exitCode)||Math.abs(row.exitCode!)>1_000_000)||row.signal!==null&&typeof row.signal!=='string'||typeof row.cause!=='string'||typeof row.retryable!=='boolean')return null;
    return {code:row.code!,exitCode:row.exitCode??null,signal:row.signal??null,cause:boundedCause(row.cause),retryable:row.retryable};
  }catch{return null;}
}
