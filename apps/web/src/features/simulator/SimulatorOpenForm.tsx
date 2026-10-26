import {useState} from 'react';
import {api,fmt} from '../../lib/api.ts';
import {Button} from '../../components/ui.tsx';

export default function SimulatorOpenForm({row,onCreated,addToPositionId}:{row:Record<string,any>;
  onCreated?:()=>void;addToPositionId?:string}){
  const [visible,setVisible]=useState(false),[quantity,setQuantity]=useState('1');
  const [premium,setPremium]=useState(''),[fee,setFee]=useState('');
  const [origin,setOrigin]=useState<'MANUAL_INPUT'|'OBSERVED_ASK_REFERENCE'>('MANUAL_INPUT');
  const [decision,setDecision]=useState(new Date().toISOString()),[entry,setEntry]=useState(new Date().toISOString());
  const [reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false);
  const [planFields,setPlanFields]=useState({observedTrend:'',reviewedTimeframes:'',expectedConfirmation:'',
    relevantSma:'',supportResistance:'',invalidation:'',profitObjective:'',lossLimit:''});
  const [message,setMessage]=useState(''),[key,setKey]=useState(crypto.randomUUID());
  const changed=()=>{setConfirmed(false);setKey(crypto.randomUUID());};
  const gross=Number(premium)*Number(row.multiplier)*Number(quantity);
  const save=async()=>{
    setBusy(true);setMessage('');
    try{
      const body={idempotencyKey:key,quantity:Number(quantity),premiumPerShare:Number(premium),
        priceOrigin:origin,...(origin==='OBSERVED_ASK_REFERENCE'?{referencePrice:Number(premium)}:{}),
        entryFeeUsd:fee.trim()===''?null:Number(fee),decisionAtUtc:decision,simulatedEntryAtUtc:entry,
        plan:{entryReason:reason,...planFields},confirmHypothetical:true,...(addToPositionId?{}:{conId:Number(row.conId)})};
      const path=addToPositionId?`/simulator/positions/${addToPositionId}/add`:'/simulator/positions';
      await api(path,{method:'POST',body:JSON.stringify(body)});
      setMessage('Entrada hipotética registrada. Consulte Simulador Paper.');setVisible(false);setConfirmed(false);
      setKey(crypto.randomUUID());onCreated?.();
    }catch(error){setMessage(error instanceof Error?error.message:'No se pudo registrar');}
    finally{setBusy(false);}
  };
  return <div className="simulator-open-form">
    <Button variant="secondary" onClick={()=>{setVisible(value=>!value);setDecision(new Date().toISOString());setEntry(new Date().toISOString());}}>
      {addToPositionId?'Agregar lote simulado':'Registrar entrada simulada'}</Button>
    {visible?<div className="simulator-form"><h4>Confirmar entrada hipotética</h4>
      <p>INTERNAL_SIMULATOR · {row.right} NVDA · conId {row.conId} · strike ${fmt(row.strike)} · vence {row.expiration} · multiplicador {row.multiplier}.</p>
      <p>Esto no envía ninguna orden a IBKR Paper. La prima es un dato de simulación, aunque se copie un ASK observado.</p>
      <label>Cantidad <input aria-label="Cantidad de contratos simulados" type="number" min="1" max="10000" step="1" value={quantity} onChange={e=>{changed();setQuantity(e.target.value);}}/></label>
      <label>Prima de entrada por acción USD <input aria-label="Prima hipotética de entrada" type="number" min="0" step="any" value={premium} onChange={e=>{changed();setPremium(e.target.value);}}/></label>
      <Button variant="ghost" disabled={!Number.isFinite(row.ask)||row.ask<=0} onClick={()=>{changed();setPremium(String(row.ask));setOrigin('OBSERVED_ASK_REFERENCE');}}>
        Copiar ASK observado ({Number.isFinite(row.ask)?`$${fmt(row.ask,4)}`:'N/D'})</Button>
      <Button variant="ghost" onClick={()=>{changed();setOrigin('MANUAL_INPUT');}}>Usar prima manual</Button>
      <p>Origen: {origin} · Feed: {row.feedType??'UNKNOWN'} · proveedor: {row.provider??'N/D'} · recepción: {row.receivedAtUtc??'N/D'}.</p>
      <label>Comisión total de entrada USD (vacío = desconocida) <input aria-label="Comisión de entrada simulada" type="number" min="0" step="0.01" value={fee} onChange={e=>{changed();setFee(e.target.value);}}/></label>
      <label>Decisión UTC <input aria-label="Decisión simulada UTC" type="datetime-local" value={decision.slice(0,16)} onChange={e=>{changed();setDecision(new Date(e.target.value+'Z').toISOString());}}/></label>
      <label>Entrada UTC <input aria-label="Entrada simulada UTC" type="datetime-local" value={entry.slice(0,16)} onChange={e=>{changed();setEntry(new Date(e.target.value+'Z').toISOString());}}/></label>
      <label>Motivo de entrada (opcional) <input aria-label="Motivo de entrada simulada" value={reason} onChange={e=>{changed();setReason(e.target.value);}}/></label>
      <details><summary>Plan y contexto técnico opcionales</summary>
        {([
          ['observedTrend','Tendencia observada'],['reviewedTimeframes','Temporalidades revisadas'],
          ['expectedConfirmation','Confirmación esperada'],['relevantSma','SMA relevante'],
          ['supportResistance','Soporte o resistencia'],['invalidation','Invalidación'],
          ['profitObjective','Objetivo de beneficio'],['lossLimit','Límite de pérdida']
        ] as const).map(([field,label])=><label key={field}>{label}
          <input aria-label={label} maxLength={1000} value={planFields[field]}
            onChange={e=>{changed();setPlanFields(current=>({...current,[field]:e.target.value}));}}/>
        </label>)}
      </details>
      <p>Prima bruta hipotética: {Number.isFinite(gross)&&gross>0?`$${fmt(gross)}`:'N/D'} · comisión: {fee===''?'N/D':`$${fmt(Number(fee))}`}.</p>
      <label><input aria-label="Confirmar simulación sin orden" type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Confirmo que es un registro hipotético y no una ejecución.</label>
      <Button disabled={!confirmed||busy||!Number.isInteger(Number(quantity))||Number(quantity)<1||!Number.isFinite(Number(premium))||Number(premium)<=0} onClick={save}>
        {busy?'Registrando...':'Confirmar entrada simulada'}</Button>
    </div>:null}
    {message?<p role="status">{message}</p>:null}
  </div>;
}
