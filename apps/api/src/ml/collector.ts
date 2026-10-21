import {MlCollectorStatus} from '@trading-poc/contracts';
import {isCollectorActive,readCollectorStatus} from '../../../../trading_poc_001_bollinger/src/phase34-collector.ts';

export function readMlCollectorStatus(path:string|undefined){
  const empty={state:'NOT_CONFIGURED',active:false,updatedAtUtc:null,lastSuccessfulIngestionAtUtc:null,lastBarEndUtc:null,lastObservationAtUtc:null,nextQueryAtUtc:null,lastError:null,newObservations:0};
  if(!path)return MlCollectorStatus.parse(empty);
  try{
    const status=readCollectorStatus(path);
    if(!status)return MlCollectorStatus.parse(empty);
    return MlCollectorStatus.parse({state:status.state,active:isCollectorActive(path),updatedAtUtc:status.updatedAtUtc,lastSuccessfulIngestionAtUtc:status.lastSuccessfulIngestionAtUtc,lastBarEndUtc:status.lastBarEndUtc,lastObservationAtUtc:status.lastObservationAtUtc,nextQueryAtUtc:status.nextQueryAtUtc,lastError:status.lastError,newObservations:status.newObservations});
  }catch{return MlCollectorStatus.parse({...empty,state:'ERROR',lastError:'Estado local del recolector inválido.'});}
}
