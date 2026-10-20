import {existsSync} from 'node:fs';
import {MlProspectiveRecord,type MlProspectiveRecord as Prospective} from '@trading-poc/contracts';
import {latestPhase31Record} from '../../../../trading_poc_001_bollinger/src/phase31-inference.ts';

/** The API is read-only: captures are produced only by npm run ml:infer. */
export function readProspectiveInference(logPath:string|undefined,modelConfigured:boolean):Prospective{
  if(!modelConfigured)return MlProspectiveRecord.parse({status:'NO_MODEL',mode:null,modelId:null,modelSha256:null,source:null,lastObservationUtc:null,receivedAtUtc:null,registeredAtUtc:null,probabilities:null,dominantClass:null,entryAtUtc:null,recordedBeforeNextEntry:null,reason:'No hay experimento XGBoost configurado.'});
  if(!logPath||!existsSync(logPath))return MlProspectiveRecord.parse({status:'SOURCE_ABSENT',mode:null,modelId:null,modelSha256:null,source:null,lastObservationUtc:null,receivedAtUtc:null,registeredAtUtc:null,probabilities:null,dominantClass:null,entryAtUtc:null,recordedBeforeNextEntry:null,reason:'No existe una captura local de velas Alpaca SIP verificadas.'});
  try{
    const row=latestPhase31Record(logPath);if(!row)throw new Error('Registro vacío.');
    const age=Date.now()-Date.parse(row.bar.endUtc);
    const status=row.mode==='REPLAY'?'HISTORICAL_DATA':age>30*60_000?'STALE_DATA':'READY';
    return MlProspectiveRecord.parse({status,mode:row.mode,modelId:row.model.id,modelSha256:row.model.sha256,source:`${row.source.provider} · ${row.source.feed} · ${row.source.adjustment}`,lastObservationUtc:row.bar.endUtc,receivedAtUtc:row.bar.receivedAtUtc,registeredAtUtc:row.registeredAtUtc,probabilities:row.prediction,dominantClass:row.prediction.dominantClass,entryAtUtc:row.bar.endUtc,recordedBeforeNextEntry:row.recordedBeforeNextEntry,reason:status==='READY'?'Captura prospectiva registrada antes de conocer su horizonte.':status==='HISTORICAL_DATA'?'Registro recalculado históricamente; no es una predicción vigente.':'La última captura prospectiva excede 30 minutos.'});
  }catch{return MlProspectiveRecord.parse({status:'UNAVAILABLE',mode:null,modelId:null,modelSha256:null,source:null,lastObservationUtc:null,receivedAtUtc:null,registeredAtUtc:null,probabilities:null,dominantClass:null,entryAtUtc:null,recordedBeforeNextEntry:null,reason:'No se puede verificar el registro local de inferencias.'});}
}
