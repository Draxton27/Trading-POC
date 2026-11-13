import type {InputRecord} from '../../apps/api/src/real-trades/normalize.ts';
import {newYorkLocalToUtc} from './phase42b-queue.ts';

/** Audit existing snapshots as assertions, not verified prices or demonstrated trading intent. */
export function auditControlSnapshots(records:readonly InputRecord[]){
  const seen=new Set<string>();
  return records.map(record=>{
    if(!record.id||seen.has(record.id))throw new Error('CONTROL_SOURCE_ID_INVALID');seen.add(record.id);
    const fields=record.fields,entry=typeof fields['Entrada ET']==='string'?fields['Entrada ET']:null;
    let entryUtc:string|null=null;try{if(entry)entryUtc=newYorkLocalToUtc(entry);}catch{/* represented below */}
    let context:unknown=null;
    try{if(typeof fields['Velas contexto JSON']==='string')context=JSON.parse(fields['Velas contexto JSON']);}catch{/* represented below */}
    const content=context&&typeof context==='object'&&!Array.isArray(context)?context as Record<string,unknown>:null;
    const bars=Array.isArray(content?.confirmedBeforeEntry)?content.confirmedBeforeEntry:null;
    let invalid=0,notBefore=0,prior=0;
    for(const value of bars??[]){
      const bar=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
      if(!entryUtc||!entry||typeof bar?.t!=='string'||!/^\d{2}:\d{2}$/.test(bar.t)){invalid++;continue;}
      try{
        const time=Date.parse(newYorkLocalToUtc(`${entry.slice(0,10)}T${bar.t}:00`));
        if(time+60_000>=Date.parse(entryUtc))notBefore++;else prior++;
      }catch{invalid++;}
    }
    return {sourceRecordId:record.id,entryUtc,linkedTradeIds:Array.isArray(fields['Trade relacionado'])?fields['Trade relacionado']:[],
      assumedCadence:'1m_NO_VERIFICADA',barCount:bars?.length??null,priorAssuming1m:bars?prior:null,
      notStrictlyPriorAssuming1m:bars?notBefore:null,invalid:bars?invalid:null,
      status:'NO_VERIFICABLE' as const,reasons:['FUENTE_Y_RECEPCION_HISTORICA_NO_VERIFICADAS',
        ...(bars?['INTERVALO_DE_BARRAS_NO_VERIFICADO']:['BARRAS_DE_CONTROL_NO_DISPONIBLES'])]};
  });
}
