import {iexDailyStatePath,readIexDailyState,classifyIexStateFailure} from '../../../../scripts/iex-daily.ts';

/** Explicit public projection: never return paths, process IDs, credentials or raw diagnostics. */
export function readIexAutomationStatus(path=iexDailyStatePath()){
  const feedCodes=new Set(['CONNECTING','CONNECTED','AUTHENTICATED','SUBSCRIBED','QUIET_ACTIVE_SESSION','DISCONNECTED',
    'AUTH_FAILED','CONNECTION_LIMIT','SUBSCRIPTION_FAILED','INVALID_MESSAGE','OBSERVATION_STARTED','OBSERVATION_ENDED','CALENDAR_UNAVAILABLE']);
  const observationCodes=new Set(['NO_LIVE_DATA','STALE_LIVE_DATA','PREEXISTING_LIVE_DATA','FEED_DISCONNECTED','RECORDED','ALREADY_PRESENT',
    'INDICATORS_INSUFFICIENT','HORIZON_INELIGIBLE','MODEL_TOO_RECENT','MODEL_INCOMPATIBLE','MODEL_NOT_CONFIGURED','OBSERVE_FAILED','ERROR']);
  const errorCodes=new Set(['IEX_COLLECT_START_FAILED','IEX_COLLECT_EXITED','IEX_COLLECT_TERMINAL_ERROR','IEX_COLLECT_RETRIES_EXHAUSTED','IEX_EVALUATION_FAILED','IEX_OBSERVE_FAILED',
    'IEX_OBSERVE_OUTPUT_INVALID','IEX_LEDGER_OR_CALENDAR_INVALID','IEX_AUTOMATION_STATE_INVALID','MODEL_NOT_CONFIGURED','MODEL_INCOMPATIBLE','MODEL_TOO_RECENT']);
  try{const row=readIexDailyState(path);
    return {stateFile:row?'VALID':'ABSENT',collector:row?.collector??'STOPPED',owner:['MANAGED','EXTERNAL','NONE'].includes(row?.owner??'')?row!.owner:'NONE',
      feedStatus:row?.feedStatus&&feedCodes.has(row.feedStatus)?row.feedStatus:null,
      lastCompleteBarEndUtc:row?.lastCompleteBarEndUtc??null,lastCompleteReceivedAtUtc:row?.lastCompleteReceivedAtUtc??null,
      lastPredictionAtUtc:row?.lastPredictionAtUtc??null,pendingEvaluations:row?.pendingEvaluations??0,
      completedEvaluations:row?.completedEvaluations??0,lastErrorCode:row?.lastErrorCode&&errorCodes.has(row.lastErrorCode)?row.lastErrorCode:null,
      freshness:row?.freshness??'NO_LIVE_DATA',observationStatus:row?row.observationStatus&&observationCodes.has(row.observationStatus)?row.observationStatus:'ERROR':'STATE_ABSENT',
      nextCheckAtUtc:row?.nextCheckAtUtc??null};
  }catch(error){const stateFile=classifyIexStateFailure(error);return {stateFile,collector:'STOPPED',owner:'NONE',feedStatus:null,lastCompleteBarEndUtc:null,lastCompleteReceivedAtUtc:null,
    lastPredictionAtUtc:null,pendingEvaluations:0,completedEvaluations:0,lastErrorCode:stateFile==='READ_ERROR'?'IEX_AUTOMATION_STATE_READ_FAILED':stateFile==='INVALID'?'IEX_AUTOMATION_STATE_INVALID':null,
    freshness:'NO_LIVE_DATA',observationStatus:'ERROR',nextCheckAtUtc:null};}
}
