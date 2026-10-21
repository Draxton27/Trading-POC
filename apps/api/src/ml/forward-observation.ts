import {existsSync} from 'node:fs';
import {MlProspectiveRecord,type MlProspectiveRecord as Prospective} from '@trading-poc/contracts';
import {latestForwardObservation} from '../../../../trading_poc_001_bollinger/src/phase34-forward-observation.ts';

const absent=(status:'NO_MODEL'|'SOURCE_ABSENT'|'MODEL_INCOMPATIBLE'|'UNAVAILABLE',reason:string):Prospective=>MlProspectiveRecord.parse({status,mode:null,modelId:null,modelSha256:null,source:null,lastObservationUtc:null,receivedAtUtc:null,registeredAtUtc:null,probabilities:null,dominantClass:null,entryAtUtc:null,recordedBeforeNextEntry:null,reason});
/** HTTP only reads an append-only local observer ledger; it never requests inference. */
export function readForwardObservation(logPath:string|undefined,modelSha256:string|undefined,clock:()=>number=Date.now):Prospective{
  if(!modelSha256)return absent('NO_MODEL','No hay experimento XGBoost configurado.');
  if(!logPath||!existsSync(logPath))return absent('SOURCE_ABSENT','No existe una observación adelantada registrada desde el ledger Alpaca SIP retrasado.');
  try{
    const row=latestForwardObservation(logPath);if(!row)throw new Error('Registro vacío.');
    if(row.model.sha256!==modelSha256)return absent('MODEL_INCOMPATIBLE','La observación corresponde a otro modelo congelado.');
    const status=clock()-Date.parse(row.bar.endUtc)>30*60_000?'STALE_DATA':'READY';
    return MlProspectiveRecord.parse({status,mode:row.mode,modelId:row.model.id,modelSha256:row.model.sha256,source:'Alpaca Market Data API · SIP · split · DELAYED',lastObservationUtc:row.bar.endUtc,receivedAtUtc:row.bar.receivedAtUtc,registeredAtUtc:row.registeredAtUtc,probabilities:row.prediction,dominantClass:row.prediction.dominantClass,entryAtUtc:row.entryAtUtc,recordedBeforeNextEntry:row.recordedBeforeNextEntry,recordedBeforeOutcome:row.recordedBeforeOutcome,effectiveDelayMs:Math.max(0,Date.parse(row.registeredAtUtc)-Date.parse(row.bar.endUtc)),reason:status==='READY'?'Observación retrasada registrada antes del cierre del desenlace t+4; no es una señal operativa.':'La última observación adelantada está obsoleta.'});
  }catch{return absent('UNAVAILABLE','No se puede verificar el registro local de observaciones adelantadas.');}
}
