import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {loadMarketCalendar} from './alpaca-calendar.ts';
import {appendForwardObservation,prepareForwardObservation} from './phase34-forward-observation.ts';
import {frozenModel} from './phase31-inference.ts';

export type FrozenPrediction={modelSha256:string;probabilities:{ALCISTA:number;BAJISTA:number;LATERAL:number};dominantClass:'ALCISTA'|'BAJISTA'|'LATERAL'};
export type FrozenPredictor=(modelPath:string,features:Record<string,number>)=>FrozenPrediction;
/** Shared implementation behind ml:observe; dependencies make its private-only flow testable without Alpaca or training. */
export function observeOnce(options:{ledger:string;calendarPath:string;log:string;modelDir:string;predict:FrozenPredictor;clock?:()=>string}){
  if(!existsSync(options.ledger)||!existsSync(options.calendarPath))throw new Error('Falta el ledger o calendario privado de Alpaca; ejecute primero alpaca:ingest.');
  const now=options.clock??(()=>new Date().toISOString()),model=frozenModel(resolve(options.modelDir)),preparation=prepareForwardObservation(options.ledger,loadMarketCalendar(options.calendarPath),model,now());
  const output=options.predict(model.modelPath,preparation.prepared.features);if(output.modelSha256!==model.sha256)throw new Error('Hash de modelo inconsistente.');
  return appendForwardObservation(resolve(options.log),{mode:'DELAYED_FORWARD_OBSERVATION',model:{id:model.id,sha256:model.sha256,createdAtUtc:model.createdAtUtc},bar:{startUtc:preparation.prepared.barStartUtc,endUtc:preparation.prepared.barEndUtc,sessionDateNy:preparation.prepared.sessionDateNy,sourceRecordHash:preparation.candidate.recordHash,sourceResponseSha256:preparation.candidate.responseSha256!,revision:preparation.candidate.bar!.revision,receivedAtUtc:preparation.candidate.receivedAtUtc},sourceBars:preparation.sourceBars,features:{spec:'nvda-15m-v1',hash:preparation.prepared.featureHash,values:preparation.prepared.features},prediction:{...output.probabilities,dominantClass:output.dominantClass},source:{provider:'Alpaca Market Data API',feed:'sip',adjustment:'split',availability:'DELAYED'}},now());
}
