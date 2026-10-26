import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,dateTime,fmt} from '../../lib/api.ts';
import {Badge,Button,Card,SectionTitle} from '../../components/ui.tsx';
import SimulatorOpenForm from './SimulatorOpenForm.tsx';

type Position=Record<string,any>;
type Event=Record<string,any>;
const money=(value:number|null|undefined)=>value==null||!Number.isFinite(value)?'N/D':`$${fmt(value)}`;
function PositionDetail({id,onSaved}:{id:string;onSaved:()=>void}){
  const [eventOffset,setEventOffset]=useState(0);
  const detail=useQuery<{position:Position;events:Event[];totalEvents:number}>({queryKey:['simulator-position',id,eventOffset],
    queryFn:()=>api(`/simulator/positions/${id}?offset=${eventOffset}&limit=25`)});
  const [quantity,setQuantity]=useState('1'),[premium,setPremium]=useState(''),[fee,setFee]=useState('');
  const [reason,setReason]=useState(''),[note,setNote]=useState(''),[confirmed,setConfirmed]=useState(false);
  const [origin,setOrigin]=useState<'MANUAL_INPUT'|'OBSERVED_BID_REFERENCE'>('MANUAL_INPUT');
  const [key,setKey]=useState(crypto.randomUUID()),[noteKey,setNoteKey]=useState(crypto.randomUUID());
  const [planKey,setPlanKey]=useState(crypto.randomUUID()),[planReason,setPlanReason]=useState('');
  const [invalidation,setInvalidation]=useState(''),[objective,setObjective]=useState(''),[lossLimit,setLossLimit]=useState('');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const changed=()=>{setConfirmed(false);setKey(crypto.randomUUID());};
  if(detail.isLoading)return <Card><p>Cargando posición...</p></Card>;
  if(detail.error||!detail.data)return <Card role="alert">No se pudo leer la posición: {(detail.error as Error)?.message}</Card>;
  const p=detail.data.position;
  const close=async()=>{
    setBusy(true);setError('');try{
      const at=new Date().toISOString();
      await api(`/simulator/positions/${id}/close`,{method:'POST',body:JSON.stringify({idempotencyKey:key,
        quantity:Number(quantity),premiumPerShare:Number(premium),priceOrigin:origin,
        ...(origin==='OBSERVED_BID_REFERENCE'?{referencePrice:Number(premium)}:{}),
        exitFeeUsd:fee===''?null:Number(fee),decisionAtUtc:at,simulatedExitAtUtc:at,
        reason,confirmHypothetical:true})});
      setKey(crypto.randomUUID());setPremium('');setReason('');setConfirmed(false);onSaved();
    }catch(e){setError(e instanceof Error?e.message:'No se pudo registrar');}finally{setBusy(false);}
  };
  const addNote=async()=>{try{await api(`/simulator/positions/${id}/notes`,{method:'POST',
    body:JSON.stringify({idempotencyKey:noteKey,note})});setNote('');setNoteKey(crypto.randomUUID());setError('');onSaved();}
    catch(e){setError(e instanceof Error?e.message:'No se pudo registrar la nota');}};
  const updatePlan=async()=>{try{await api(`/simulator/positions/${id}/plan`,{method:'POST',
    body:JSON.stringify({idempotencyKey:planKey,reason:planReason,plan:{...p.plan,
      ...(invalidation.trim()?{invalidation:invalidation.trim()}:{}),
      ...(objective.trim()?{profitObjective:objective.trim()}:{}),
      ...(lossLimit.trim()?{lossLimit:lossLimit.trim()}:{}),}})});
    setPlanReason('');setInvalidation('');setObjective('');setLossLimit('');setPlanKey(crypto.randomUUID());
    setError('');onSaved();}catch(e){setError(e instanceof Error?e.message:'No se pudo actualizar el plan');}};
  return <Card><h3>Detalle · {p.contract.right} {p.contract.occSymbol??p.contract.conId}</h3>
    <p>{p.status} · {p.classification} · registrado {dateTime(p.openedAtUtc)}.</p>
    <p>Entrada bruta {money(p.grossEntryCostUsd)} · costo cerrado {money(p.closedCostBasisUsd)} · salidas {money(p.grossExitProceedsUsd)}.</p>
    <p>P&L bruto realizado {money(p.realizedGrossPnlUsd)} · neto {money(p.realizedNetPnlUsd)}. Comisiones desconocidas no son cero.</p>
    <p>Exposición restante {money(p.remainingPremiumExposureUsd)} · último BID {p.mark?.status==='MARK_AVAILABLE'?money(p.mark.bid):'N/D'} · valoración actual {money(p.mark?.markValueUsd)} · no realizado actual {money(p.mark?.unrealizedGrossPnlUsd)}.</p>
    <p>Marca: {p.mark?.status} · fuente {p.mark?.markSource} · feed {p.mark?.feedType} · recibida {dateTime(p.mark?.receivedAtUtc)}. Un BID no garantiza liquidez ni ejecución.</p>
    {p.status==='EXPIRED_UNRESOLVED'?<p role="status">Vencimiento pasado sin resolución documentada. No hay venta ni pérdida automática.</p>:null}
    <p>Contexto técnico a la entrada: UNAVAILABLE sin referencia causal. Predicción ML: no vinculada.</p>
    <p>Motivo: {p.plan?.entryReason||'N/D'} · invalidación: {p.plan?.invalidation||'N/D'} · objetivo: {p.plan?.profitObjective||'N/D'}.</p>
    {p.remainingQuantity>0&&p.status!=='EXPIRED_UNRESOLVED'?<div className="simulator-form"><h4>Registrar salida hipotética</h4>
      <p>No se envía una orden a IBKR. Cantidad máxima: {p.remainingQuantity}.</p>
      <label>Cantidad a cerrar <input aria-label="Cantidad de salida simulada" type="number" min="1" max={p.remainingQuantity} step="1" value={quantity} onChange={e=>{changed();setQuantity(e.target.value);}}/></label>
      <label>Prima de salida por acción USD <input aria-label="Prima hipotética de salida" type="number" min="0" step="any" value={premium} onChange={e=>{changed();setPremium(e.target.value);}}/></label>
      <Button variant="ghost" disabled={p.mark?.status!=='MARK_AVAILABLE'} onClick={()=>{changed();setPremium(String(p.mark.bid));setOrigin('OBSERVED_BID_REFERENCE');}}>Copiar BID verificado ({money(p.mark?.bid)})</Button>
      <Button variant="ghost" onClick={()=>{changed();setOrigin('MANUAL_INPUT');}}>Prima manual</Button><p>Origen: {origin}</p>
      <label>Comisión total de salida USD (vacío = desconocida) <input aria-label="Comisión de salida simulada" type="number" min="0" step="0.01" value={fee} onChange={e=>{changed();setFee(e.target.value);}}/></label>
      <label>Motivo de salida <input aria-label="Motivo de salida simulada" value={reason} onChange={e=>{changed();setReason(e.target.value);}}/></label>
      <label><input aria-label="Confirmar salida simulada" type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Confirmo una salida hipotética sin orden.</label>
      <Button disabled={!confirmed||busy||!Number.isInteger(Number(quantity))||Number(quantity)<1||Number(quantity)>p.remainingQuantity||!Number.isFinite(Number(premium))||Number(premium)<=0||!reason.trim()} onClick={close}>{busy?'Registrando...':'Confirmar salida simulada'}</Button>
      <SimulatorOpenForm row={{...p.contract,ask:null,feedType:'UNKNOWN',provider:null}} addToPositionId={id} onCreated={onSaved}/>
    </div>:null}
    <div className="simulator-form"><label>Nota manual <input aria-label="Nota de posición simulada" value={note} onChange={e=>{setNote(e.target.value);setNoteKey(crypto.randomUUID());}}/></label>
      <Button disabled={!note.trim()} onClick={addNote}>Agregar nota</Button>{error?<p role="alert">{error}</p>:null}</div>
    <div className="simulator-form"><h4>Revision explicita del plan</h4>
      <label>Nueva invalidacion <input aria-label="Nueva invalidacion simulada" maxLength={1000} value={invalidation} onChange={e=>{setInvalidation(e.target.value);setPlanKey(crypto.randomUUID());}}/></label>
      <label>Nuevo objetivo <input aria-label="Nuevo objetivo simulado" maxLength={1000} value={objective} onChange={e=>{setObjective(e.target.value);setPlanKey(crypto.randomUUID());}}/></label>
      <label>Nuevo limite de perdida <input aria-label="Nuevo limite de perdida simulado" maxLength={1000} value={lossLimit} onChange={e=>{setLossLimit(e.target.value);setPlanKey(crypto.randomUUID());}}/></label>
      <label>Motivo del cambio <input aria-label="Motivo de cambio de plan" maxLength={1000} value={planReason} onChange={e=>{setPlanReason(e.target.value);setPlanKey(crypto.randomUUID());}}/></label>
      <Button disabled={!planReason.trim()||(!invalidation.trim()&&!objective.trim()&&!lossLimit.trim())} onClick={updatePlan}>Registrar cambio de plan</Button>
    </div>
    <h4>Historial append-only</h4><div className="table-wrap"><table><thead><tr><th>Evento</th><th>Registro UTC</th><th>Detalle</th><th>Hash</th></tr></thead><tbody>
      {detail.data.events.map(e=><tr key={e.simulationEventId}><td>{e.kind}</td><td>{e.recordedAtUtc}</td>
        <td>{e.kind.includes('CLOSED')?`${e.payload.quantity} · ${money(e.payload.premiumPerShare)} · ${e.payload.reason}`:
          e.kind==='SIM_POSITION_NOTE_ADDED'?e.payload.note:e.kind==='SIM_POSITION_OPENED'?`${e.payload.lot.quantity} · ${money(e.payload.lot.premiumPerShare)}`:'Registro explícito'}</td>
        <td>{String(e.hash).slice(0,12)}…</td></tr>)}</tbody></table></div>
    <div className="toolbar"><Button variant="ghost" disabled={eventOffset===0} onClick={()=>setEventOffset(Math.max(0,eventOffset-25))}>Eventos anteriores</Button>
      <span>{detail.data.totalEvents} eventos · página {Math.floor(eventOffset/25)+1}</span>
      <Button variant="ghost" disabled={eventOffset+25>=detail.data.totalEvents} onClick={()=>setEventOffset(eventOffset+25)}>Más eventos</Button></div>
  </Card>;
}
export default function PaperSimulatorView({mode}:{mode:string}){
  const [offset,setOffset]=useState(0),[selected,setSelected]=useState<string|null>(null),[capital,setCapital]=useState('');
  const client=useQueryClient();
  const list=useQuery<{items:Position[];total:number;source:string}>({queryKey:['simulator-positions',offset],queryFn:()=>api(`/simulator/positions?offset=${offset}&limit=25`)});
  const performance=useQuery<Record<string,Record<string,number|null>>>({queryKey:['simulator-performance'],queryFn:()=>api('/simulator/performance')});
  const verify=useQuery<{valid:boolean;eventCount:number;headHash:string|null}>({queryKey:['simulator-ledger'],queryFn:()=>api('/simulator/ledger/verify')});
  const refresh=()=>{client.invalidateQueries({queryKey:['simulator-positions']});client.invalidateQueries({queryKey:['simulator-position']});
    client.invalidateQueries({queryKey:['simulator-performance']});client.invalidateQueries({queryKey:['simulator-ledger']});};
  const positions=list.data?.items??[],exposure=positions.filter(p=>p.status!=='CLOSED').reduce((sum,p)=>sum+p.remainingPremiumExposureUsd,0);
  const cap=capital===''?null:Number(capital),metrics=mode==='DEMO'?performance.data?.demo:performance.data?.documentedOnTime;
  return <div className="content-page"><SectionTitle eyebrow="SIMULACIÓN INTERNA · SIN ÓRDENES" title="Simulador Paper" aside={<Badge tone="warning">{mode==='DEMO'?'DEMO_SYNTHETIC':'INTERNAL_SIMULATOR'}</Badge>}/>
    <p className="lead">Operaciones hipotéticas con opciones NVDA. No son ejecuciones de IBKR Paper ni señales de XGBoost. No se consulta la cuenta del bróker.</p>
    {(list.error||verify.error)?<Card role="alert">No se puede leer el ledger; no se sustituye por una cartera vacía. {((list.error??verify.error) as Error).message}</Card>:null}
    <div className="info-row"><Card><h3>Capital hipotético informativo</h3><label>Capital USD <input aria-label="Capital hipotético del simulador" type="number" min="0" step="0.01" value={capital} onChange={e=>setCapital(e.target.value)}/></label>
      <p>Prima restante comprometida {money(exposure)} · capital indicado {money(cap)} · restante {cap===null?'N/D':money(cap-exposure)}.</p><small>No consulta saldos reales.</small></Card>
      <Card><h3>Integridad</h3><p>{verify.isLoading?'Verificando...':verify.data?.valid?`Ledger válido · ${verify.data.eventCount} eventos`:'No disponible'}</p><small>Eventos privados con SHA-256.</small></Card></div>
    <Card><h3>Posiciones</h3>{list.isLoading?<p>Cargando...</p>:positions.length?<div className="table-wrap"><table><thead><tr><th>Contrato</th><th>Estado</th><th>Cantidad</th><th>Entrada</th><th>Exposición</th><th>BID / marca</th><th>Realizado</th><th>Acción</th></tr></thead><tbody>
      {positions.map(p=><tr key={p.positionId}><td>{p.contract.right} NVDA {p.contract.strike}<small>{p.contract.expiration} · conId {p.contract.conId}</small></td>
        <td>{p.status}<small>{p.classification}</small></td><td>{p.remainingQuantity}/{p.initialQuantity}</td><td>{money(p.grossEntryCostUsd)}</td>
        <td>{money(p.remainingPremiumExposureUsd)}</td><td>{p.mark?.status==='MARK_AVAILABLE'?money(p.mark.bid):'N/D'}<small>{p.mark?.status}</small></td>
        <td>Bruto {money(p.realizedGrossPnlUsd)}<small>Neto {money(p.realizedNetPnlUsd)}</small></td>
        <td><Button variant="ghost" onClick={()=>setSelected(p.positionId)}>Ver detalle / registrar salida</Button></td></tr>)}</tbody></table></div>:<p>No hay posiciones. Seleccione un contrato en Opciones para registrar una entrada explícita.</p>}
      <div className="toolbar"><Button variant="ghost" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-25))}>Anterior</Button><span>{list.data?.total??0} posiciones · página {Math.floor(offset/25)+1}</span>
        <Button variant="ghost" disabled={offset+25>=(list.data?.total??0)} onClick={()=>setOffset(offset+25)}>Siguiente</Button></div></Card>
    {selected?<PositionDetail id={selected} onSaved={refresh}/>:null}
    <Card><h3>Estadísticas descriptivas · posiciones completamente cerradas</h3><p>Cohorte {mode==='DEMO'?'sintética DEMO':'documentada a tiempo'}. Las entradas históricas están separadas.</p>
      <dl><dt>Cerradas / ganadoras / perdedoras / planas</dt><dd>{metrics?.closedPositions??0} / {metrics?.winningClosedPositions??0} / {metrics?.losingClosedPositions??0} / {metrics?.flatClosedPositions??0}</dd>
        <dt>P&L bruto / neto</dt><dd>{money(metrics?.realizedGrossPnlUsd)} / {money(metrics?.realizedNetPnlUsd)}</dd>
        <dt>Resultado medio / tasa ganadora</dt><dd>{money(metrics?.averageRealizedGrossPnlUsd)} / {metrics?.winRatePercent==null?'N/D':`${fmt(metrics.winRatePercent)} %`}</dd>
        <dt>Ganancia media / pérdida media</dt><dd>{money(metrics?.averageGainUsd)} / {money(metrics?.averageLossUsd)}</dd>
        <dt>Realización parcial en posiciones abiertas</dt><dd>{money(metrics?.partialRealizedGrossPnlUsd)}</dd></dl>
      {mode!=='DEMO'?<p>Históricas cerradas: {performance.data?.historical?.closedPositions??0}; bruto {money(performance.data?.historical?.realizedGrossPnlUsd)}.</p>:null}
      <small>No son fills garantizados ni evidencia de ventaja estadística.</small></Card></div>;
}
