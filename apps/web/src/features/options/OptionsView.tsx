import {useEffect,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {api,dateTime,fmt} from '../../lib/api.ts';
import {Badge,Button,Card,SectionTitle} from '../../components/ui.tsx';
import {comparisonMetrics,toggleComparison} from './comparison.ts';

type ContractRow=Record<string,any>;
type Issue={strike:number|null;code:string;message:string;requestId:string|null;ibkrCode:number|null};
type Contracts={items:ContractRow[];errors?:Issue[];source:string;selectionRequired?:boolean;referenceSource?:string};
type Strikes={items:number[];total:number;offset:number;nextOffset:number|null;expiration:string|null};
const display=(n:number|null|undefined,digits=2)=>n==null||!Number.isFinite(n)?'N/D':fmt(n,digits);
const statusText:Record<string,string>={
  cotizacion_pendiente:'Cotización pendiente',cotizacion_no_disponible:'Cotización no disponible',
  permisos_insuficientes:'Permisos insuficientes',suscripcion_fallida:'Suscripción fallida',
  cotizacion_parcial:'Cotización parcial',obsoleto:'Cotización obsoleta',recibido:'Cotización recibida'
};
const academyText:Record<string,string>={
  BELOW_RANGE:'ASK por debajo del rango',WITHIN_RANGE:'ASK dentro del rango',ABOVE_RANGE:'ASK por encima del rango',
  NO_REFERENCE:'Sin referencia documental',NO_ASK:'ASK no disponible',STALE_QUOTE:'ASK obsoleto',INSUFFICIENT_DATA:'No evaluable'
};
const referenceText:Record<string,string>={ACTIVE:'vigente',REFERENCE_DATE:'misma fecha documental',HISTORICAL_ONLY:'referencia histórica sin vigencia declarada',CONFLICT:'referencias contradictorias',NONE:'sin referencia'};

function ComparisonRow({conId,mode,onRemove}:{conId:number;mode:string;onRemove:()=>void}){
  const [result,setResult]=useState<{item:ContractRow;error?:Issue|null}|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    const consumer=crypto.randomUUID();
    let active=true,inFlight:Promise<void>|null=null;
    const release=()=>mode==='PAPER'?api('/market/subscriptions/'+conId+'?consumerId='+consumer,{method:'DELETE'}).catch(()=>{}):Promise.resolve();
    const refresh=()=>{
      if(inFlight)return;
      inFlight=(async()=>{
        try{
          const response=await api<{item:ContractRow;error?:Issue|null}>('/options/comparison',{method:'POST',body:JSON.stringify({conId,consumerId:consumer})});
          if(active){setResult(response);setError('');}
        }catch(e){if(active){setResult(null);setError(e instanceof Error?e.message:'Consulta no disponible');}}
      })().finally(()=>{inFlight=null;});
    };
    refresh();const timer=setInterval(refresh,5000);
    return ()=>{active=false;clearInterval(timer);void (inFlight??Promise.resolve()).then(release);};
  },[conId,mode]);
  const row=result?.item,metrics=row?comparisonMetrics({right:row.right,strike:row.strike,expiration:row.expiration,
    multiplier:row.multiplier,bid:row.bid,ask:row.ask}):null;
  const evaluation=row?.academyEvaluation;
  return <tr><td>{row?.right??'N/D'}<small>conId {conId}</small><Button variant="ghost" onClick={onRemove} aria-label={`Quitar contrato ${conId}`}>Quitar</Button></td>
    <td>{display(row?.strike)}</td><td>{row?.expiration??'N/D'}</td><td>{display(row?.bid)} / {display(row?.ask)}</td>
    <td>{display(metrics?.spread.absolute)} / {metrics?.spread.percent==null?'N/D':display(metrics.spread.percent)+'%'}</td>
    <td>{metrics?.dte??'N/D'}</td><td>{display(row?.delta,3)}</td><td>{display(row?.theta,3)}</td>
    <td>{display(metrics?.nominalCost)}</td><td>{display(metrics?.breakEven)}</td>
    <td>{academyText[evaluation?.status]??'N/D'}<small>{evaluation?.reason??'Evaluación pendiente'}</small>
      {evaluation?.reference?<small>Referencia: {display(evaluation.reference.minAskCents/100)} a {display(evaluation.reference.maxAskCents/100)} USD por acción</small>:null}</td>
    <td>{row?.provider==='DEMO sintético'?'DEMO sintético':row?.provider==='PAPER SIMULADO'?'PAPER SIMULADO':row?.feedType??'N/D'}
      <small>{error||result?.error?.message||statusText[row?.dataStatus]||row?.dataStatus||(row?.provider==='DEMO sintético'?'Datos sintéticos':'Consultando...')}</small>
      <small>{row?.receivedAtUtc?dateTime(row.receivedAtUtc):'N/D'}</small></td></tr>;
}

export default function OptionsView({mode,consumerId}:{mode:string;consumerId:string}){
  const [right,setRight]=useState<'CALL'|'PUT'>('CALL');
  const [expiration,setExpiration]=useState('');
  const [referenceStrike,setReferenceStrike]=useState('');
  const [draftMin,setDraftMin]=useState(''),[draftMax,setDraftMax]=useState('');
  const [range,setRange]=useState({min:'',max:''}),[offset,setOffset]=useState(0);
  const [now,setNow]=useState(Date.now());
  const [selected,setSelected]=useState<number[]>([]);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),5000);return ()=>clearInterval(timer);},[]);
  const expirations=useQuery<{items:string[];source:string}>({queryKey:['option-expirations',mode],
    queryFn:()=>api('/options/expirations')});
  const chosen=expiration||expirations.data?.items[0]||'';
  const filters=new URLSearchParams();if(chosen)filters.set('expiration',chosen);
  if(range.min)filters.set('minPrice',range.min);if(range.max)filters.set('maxPrice',range.max);
  const strikeQuery=useQuery<Strikes>({queryKey:['option-strikes',mode,chosen,range.min,range.max,offset],
    enabled:mode==='PAPER'&&!!chosen,
    queryFn:()=>api('/options/strikes?'+new URLSearchParams({...Object.fromEntries(filters),offset:String(offset),limit:'50'}))});
  const contractQuery=new URLSearchParams(filters);contractQuery.set('right',right);
  contractQuery.set('limit','5');contractQuery.set('consumerId',consumerId);
  if(referenceStrike)contractQuery.set('centerStrike',referenceStrike);
  const q=useQuery<Contracts>({queryKey:['options',mode,right,chosen,referenceStrike,range.min,range.max],
    enabled:mode==='DEMO'||!!chosen,
    queryFn:()=>api(mode==='DEMO'?'/options/contracts':'/options/contracts?'+contractQuery),
    refetchInterval:mode==='PAPER'?60000:false});
  const rows=(q.data?.items??[]).filter(row=>row.right===right);
  const contractKeys=rows.map(row=>String(row.conId)).join(',');
  useEffect(()=>()=>{if(mode==='PAPER')for(const key of contractKeys.split(',').filter(Boolean))
    api('/market/subscriptions/'+key+'?consumerId='+consumerId,{method:'DELETE'}).catch(()=>{});
  },[mode,consumerId,contractKeys]);
  const applyRange=()=>{const min=draftMin.trim(),max=draftMax.trim();
    if(min&&max&&Number(min)>Number(max))return;
    setRange({min,max});setOffset(0);setReferenceStrike('');};
  const empty=q.isLoading?'Consultando contratos...':q.error?
    (q.error instanceof Error?q.error.message:'No se pudo consultar IBKR'):
    q.data?.selectionRequired?'NVDA no tiene un precio de referencia disponible. Seleccione un strike o un rango para consultar contratos.':
    !chosen?'Esperando vencimientos de IBKR...':'No se encontraron contratos para esta selección.';
  return <div className="content-page">
    <SectionTitle eyebrow="CONSULTA DE CONTRATOS" title="Opciones de NVDA"
      aside={<Badge tone={mode==='DEMO'?'warning':'info'}>{mode==='DEMO'?'SINTÉTICO':mode}</Badge>}/>
    <p className="lead">La definición de un contrato y la disponibilidad de cotizaciones son verificaciones distintas. No hay funciones de compra o venta.</p>
    <Card><div className="toolbar">
      <div className="segmented"><button className={right==='CALL'?'selected':''} onClick={()=>setRight('CALL')}>CALL</button>
        <button className={right==='PUT'?'selected':''} onClick={()=>setRight('PUT')}>PUT</button></div>
      <label className="subtle">Vencimiento · <select aria-label="Vencimiento" value={chosen}
        onChange={event=>{setExpiration(event.target.value);setOffset(0);setReferenceStrike('');}}>
        {(expirations.data?.items??[]).map(value=><option key={value} value={value}>{value}</option>)}
      </select></label>
      <span className="subtle">Fuente: {q.data?.source??'—'}</span>
      {q.isFetching&&!q.isLoading?<span className="subtle">Actualizando...</span>:null}
    </div>
    {mode==='PAPER'?<div className="options-controls">
      <label>Strike de referencia <select aria-label="Strike de referencia" value={referenceStrike}
        onChange={event=>setReferenceStrike(event.target.value)}>
        <option value="">Usar cotización NVDA si existe</option>
        {(strikeQuery.data?.items??[]).map(value=><option key={value} value={value}>{value}</option>)}
      </select></label>
      <label>Strike mínimo <input aria-label="Strike mínimo" type="number" min="0" step="0.5" value={draftMin}
        onChange={event=>setDraftMin(event.target.value)}/></label>
      <label>Strike máximo <input aria-label="Strike máximo" type="number" min="0" step="0.5" value={draftMax}
        onChange={event=>setDraftMax(event.target.value)}/></label>
      <Button onClick={applyRange}>Aplicar rango</Button>
      <Button variant="ghost" disabled={offset===0} onClick={()=>{setOffset(Math.max(0,offset-50));setReferenceStrike('');}}>Strikes anteriores</Button>
      <Button variant="ghost" disabled={strikeQuery.data?.nextOffset==null}
        onClick={()=>{setOffset(strikeQuery.data!.nextOffset!);setReferenceStrike('');}}>Más strikes</Button>
      <Button variant="ghost" onClick={()=>q.refetch()}>Reintentar</Button>
      <span className="subtle">{strikeQuery.data?`${strikeQuery.data.total} strikes en el rango · página ${Math.floor(offset/50)+1}`:'Cargando strikes...'}
        {strikeQuery.error?' · '+(strikeQuery.error as Error).message:''}</span>
    </div>:null}
    <div className="table-wrap"><table><thead><tr><th>Comparar</th><th>Tipo / contrato / ID</th><th>Vencimiento / strike / multiplicador</th>
      <th>Bid / ask</th><th>Spread abs. / %</th><th>Tamaño bid / ask</th><th>Delta / gamma</th>
      <th>Theta / vega / IV</th><th>Recepción / feed / permisos</th></tr></thead><tbody>
      {rows.length?rows.map(row=>{
        const stale=!!row.receivedAtUtc&&now-Date.parse(row.receivedAtUtc)>30000;
        const status=stale?'obsoleto':row.dataStatus;
        return <tr key={row.conId}><td><input type="checkbox" aria-label={`Comparar contrato ${row.conId}`} checked={selected.includes(row.conId)}
          disabled={!selected.includes(row.conId)&&selected.length>=4} onChange={()=>setSelected(ids=>toggleComparison(ids,row.conId))}/></td><td className="table-title">{row.right} · {row.occSymbol??'—'}<small>conId {row.conId}</small></td>
          <td>{row.expiration??'—'} · ${fmt(row.strike)} · ×{row.multiplier??'—'}</td>
          <td>{fmt(row.bid)} / {fmt(row.ask)}</td><td>{fmt(row.spread?.absolute)} / {fmt(row.spread?.percent)}%</td>
          <td>{row.bidSize??'—'} / {row.askSize??'—'}</td><td>{fmt(row.delta,3)} / {fmt(row.gamma,4)}</td>
          <td>{fmt(row.theta,3)} / {fmt(row.vega,3)} / {fmt(row.impliedVolatility,3)}</td>
          <td><Badge tone="warning">{row.provider==='DEMO sintético'?'DEMO':row.feedType??statusText[status]??'Pendiente'}</Badge>
            <small>{statusText[status]??status??'—'} · {row.permissions??'Permisos no verificados'}</small>
            <small>{dateTime(row.receivedAtUtc)}</small></td></tr>;
      }):<tr><td colSpan={9} className="empty">{empty}</td></tr>}
    </tbody></table></div>
    {q.data?.errors?.length?<div className="options-errors" role="status">{q.data.errors.map((error,index)=><p key={`${error.strike}-${index}`}>
      Strike {error.strike??'—'}: {error.message} {error.ibkrCode!==null?`(IBKR ${error.ibkrCode})`:''}
      {error.requestId?<small>Solicitud {error.requestId}</small>:null}</p>)}</div>:null}
    {q.data?.referenceSource&&q.data.referenceSource!=='NONE'?<p className="subtle options-reference">
      Selección de strikes: {q.data.referenceSource}. Una cotización retrasada no es un precio actual ejecutable.</p>:null}
    </Card>
    <Card><h3>Comparador de contratos ({selected.length}/4)</h3>
      <p>Seleccione hasta cuatro contratos, incluso de distintos vencimientos o tipos. DTE son días calendario desde la fecha de Nueva York. Costo nominal = ASK × multiplicador; equilibrio al vencimiento para posiciones largas = strike ± ASK, sin comisiones. Son cálculos indicativos, no precios de ejecución.</p>
      {selected.length?<div className="table-wrap"><table aria-label="Comparador de opciones"><thead><tr><th>Contrato</th><th>Strike</th><th>Vencimiento</th><th>BID / ASK</th><th>Spread / % medio</th><th>DTE</th><th>Delta</th><th>Theta</th><th>Costo nominal USD</th><th>Equilibrio USD</th><th>Referencia ASK</th><th>Feed / estado</th></tr></thead>
        <tbody>{selected.map(id=><ComparisonRow key={id} conId={id} mode={mode} onRemove={()=>setSelected(ids=>toggleComparison(ids,id))}/>)}</tbody></table></div>:<p className="subtle">Seleccione contratos de la cadena para compararlos.</p>}
    </Card>
    <Card className="academy-reference"><h3>Referencia de la academia</h3>
      <p>Los rangos documentales se expresan como prima ASK por acción. No son una señal de compra ni sustituyen la cotización del bróker.</p>
      {rows.length?<div className="academy-grid">{rows.map(row=>{const evaluation=row.academyEvaluation,reference=evaluation?.reference;
        return <div className="academy-row" key={`academy-${row.conId}`}><strong>{row.right} ${fmt(row.strike)}</strong>
          {reference?<><span>ASK documentado: ${fmt(reference.minAskCents/100)} a ${fmt(reference.maxAskCents/100)}</span>
            <small>Fecha: {reference.referenceDate??'sin fecha'} · {referenceText[evaluation.referenceStatus]??evaluation.referenceStatus}</small>
            <small>Fuente privada local: {reference.sourceFile} · {reference.sourceLocation}</small></>:<span>Sin rango documental aplicable</span>}
          <Badge tone={evaluation?.status==='WITHIN_RANGE'?'success':evaluation?.status==='BELOW_RANGE'||evaluation?.status==='ABOVE_RANGE'?'warning':'info'}>{academyText[evaluation?.status]??'Pendiente'}</Badge>
          <small>{evaluation?.reason??'Pendiente de evaluación'}{evaluation?.distancePercent!=null?` · distancia ${fmt(evaluation.distancePercent,2)}%`:''}</small>
        </div>;})}</div>:<p className="subtle">La comparación aparecerá cuando haya contratos visibles.</p>}
    </Card>
    <div className="info-row"><Card><h3>La prima es por acción</h3><p>Multiplicador nominal: 100 para contratos estándar. Los precios sintéticos sirven solo para ensayar la interfaz.</p></Card>
      <Card><h3>Calidad temporal</h3><p>Resolver el contrato no demuestra permisos OPRA. Compruebe bid/ask, feed y hora de recepción de cada cotización.</p></Card></div>
  </div>;
}
