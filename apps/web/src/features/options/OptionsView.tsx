import {useCallback,useEffect,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {api,dateTime,fmt} from '../../lib/api.ts';
import {Badge,Button,Card} from '../../components/ui.tsx';
import {comparisonMetrics,toggleComparison} from './comparison.ts';
import OptionAnalysisPanel from './OptionAnalysisPanel.tsx';
import {analyzeComparisonRow,optionQualityLabel} from './analysis.ts';

type ContractRow=Record<string,any>;
type Issue={strike:number|null;code:string;message:string;requestId:string|null;ibkrCode:number|null;mismatchFields?:string[]};
type Contracts={items:ContractRow[];errors?:Issue[];source:string;selectionRequired?:boolean;referenceSource?:string;
  referencePrice?:number|null;referenceObservedAtUtc?:string|null;referenceReceivedAtUtc?:string|null;strikeCount?:number};
type Strikes={items:number[];total:number;offset:number;nextOffset:number|null;expiration:string|null};
const number=(n:number|null|undefined,digits=2)=>n==null||!Number.isFinite(n)?'N/D':fmt(n,digits);
const dollars=(n:number|null|undefined)=>n==null||!Number.isFinite(n)?'N/D':`$${number(n)}`;
const labels:Record<string,string>={cotizacion_pendiente:'Cotización pendiente',cotizacion_no_disponible:'Sin BID/ASK',
  permisos_insuficientes:'Permisos insuficientes',suscripcion_fallida:'Suscripción fallida',cotizacion_parcial:'Cotización parcial',
  obsoleto:'Cotización obsoleta',recibido:'Cotización recibida'};
const referenceLabels:Record<string,string>={IBKR_LAST_OBSERVED:'IBKR · último precio observado',
  ALPACA_IEX_LAST_COMPLETE_BAR:'Alpaca IEX · última vela completa',MANUAL_STRIKE:'Strike elegido manualmente',
  MANUAL_RANGE_ASCENDING:'Rango elegido manualmente',NONE:'Sin referencia actual verificable'};
const stateLabels:Record<string,string>={TWS_DISCONNECTED:'IBKR Paper desconectado',LOADING_EXPIRATIONS:'Cargando vencimientos…',
  LOADING_CONTRACTS:'Consultando contratos…',CONTRACTS_AVAILABLE:'Contratos disponibles',
  CONTRACT_IDENTITY_MISMATCH:'Identidad de contrato incompatible',CONTRACT_NOT_FOUND:'Contrato no encontrado',
  NO_ELIGIBLE_CONTRACTS:'Sin contratos elegibles'};

function ComparisonRow({conId,mode,nowMs,onRemove,onAnalyze,onUpdate}:{conId:number;mode:string;nowMs:number;
  onRemove:()=>void;onAnalyze:()=>void;onUpdate:(conId:number,row:ContractRow|null)=>void}){
  const [result,setResult]=useState<{item:ContractRow;error?:Issue|null}|null>(null);
  useEffect(()=>{
    const consumer=crypto.randomUUID();let active=true,inFlight:Promise<void>|null=null;
    const release=()=>mode==='PAPER'?api('/market/subscriptions/'+conId+'?consumerId='+consumer,{method:'DELETE'}).catch(()=>{}):Promise.resolve();
    const refresh=()=>{if(inFlight)return;inFlight=api<{item:ContractRow;error?:Issue|null}>('/options/comparison',
      {method:'POST',body:JSON.stringify({conId,consumerId:consumer})}).then(response=>{
      if(active){setResult(response);onUpdate(conId,response.item);}}).catch(()=>{if(active){setResult(null);onUpdate(conId,null);}})
      .finally(()=>{inFlight=null;});};
    refresh();const timer=setInterval(refresh,5000);
    return ()=>{active=false;clearInterval(timer);onUpdate(conId,null);void (inFlight??Promise.resolve()).then(release);};
  },[conId,mode,onUpdate]);
  const row=result?.item,metric=row?comparisonMetrics({right:row.right,strike:row.strike,expiration:row.expiration,
    multiplier:row.multiplier,bid:row.bid,ask:row.ask}):null;
  const analysis=row?analyzeComparisonRow(row,{quantity:1,capitalUsd:null,entryFeePerContractUsd:null,
    expirationFeePerContractUsd:null,hypotheticalUnderlyingAtExpirationUsd:null,asOfUtc:new Date(nowMs).toISOString()}):null;
  return <tr><td><strong>{row?.right??'N/D'} {dollars(row?.strike)}</strong><small>conId {conId}</small></td>
    <td>{row?.expiration??'N/D'}</td><td>{dollars(row?.bid)} / {dollars(row?.ask)}</td>
    <td>{metric?.spread.percent==null?'N/D':number(metric.spread.percent)+'%'}</td>
    <td>{dollars(analysis?.premium.grossPremiumUsd)}</td><td>{dollars(metric?.breakEven)}</td>
    <td>{number(row?.delta,3)} / {number(row?.theta,3)}</td>
    <td>{analysis?optionQualityLabel[analysis.quote.status]:'Consultando'}</td>
    <td><Button variant="ghost" onClick={onAnalyze} aria-label={`Analizar contrato ${conId}`}>Analizar</Button>
      <Button variant="ghost" onClick={onRemove} aria-label={`Quitar contrato ${conId}`}>Quitar</Button></td></tr>;
}

function ContractDetail({conId,mode,nowMs}:{conId:number|null;mode:string;nowMs:number}){
  const [consumer]=useState(()=>crypto.randomUUID());
  const q=useQuery<{item:ContractRow}>({queryKey:['option-detail',conId,consumer],enabled:conId!==null,
    queryFn:()=>api('/options/comparison',{method:'POST',body:JSON.stringify({conId,consumerId:consumer})}),
    refetchInterval:conId!==null?5000:false});
  useEffect(()=>()=>{if(mode==='PAPER'&&conId!==null)void api('/market/subscriptions/'+conId+'?consumerId='+consumer,{method:'DELETE'}).catch(()=>{});},[conId,mode,consumer]);
  return <div id="option-contract-detail"><OptionAnalysisPanel row={q.data?.item??null} conId={conId} nowMs={nowMs}/>
    {q.error?<p role="alert">No se pudo cargar el análisis: {(q.error as Error).message}</p>:null}</div>;
}

export default function OptionsView({mode,consumerId,initialContract}:{mode:string;consumerId:string;
  initialContract?:{conId:number;right:'CALL'|'PUT';strike:number;expiration:string}|null}){
  const [right,setRight]=useState<'CALL'|'PUT'>('CALL'),[expiration,setExpiration]=useState('');
  const [centerStrike,setCenterStrike]=useState(''),[allStrikes,setAllStrikes]=useState(false),[offset,setOffset]=useState(0);
  const [draftMin,setDraftMin]=useState(''),[draftMax,setDraftMax]=useState(''),[range,setRange]=useState({min:'',max:''});
  const [now,setNow]=useState(Date.now()),[selected,setSelected]=useState<number[]>([]),[selectedRows,setSelectedRows]=useState<Record<number,ContractRow>>({});
  const [analysisConId,setAnalysisConId]=useState<number|null>(null);
  useEffect(()=>{if(!initialContract)return;setRight(initialContract.right);setExpiration(initialContract.expiration);
    setCenterStrike(String(initialContract.strike));setAnalysisConId(initialContract.conId);},[initialContract]);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),5000);return ()=>clearInterval(timer);},[]);
  const updateComparison=useCallback((conId:number,row:ContractRow|null)=>setSelectedRows(previous=>{
    if(!row){if(!(conId in previous))return previous;const next={...previous};delete next[conId];return next;}
    return {...previous,[conId]:row};}),[]);
  const expirations=useQuery<{items:string[];source:string}>({queryKey:['option-expirations',mode],queryFn:()=>api('/options/expirations')});
  const chosen=expiration||expirations.data?.items[0]||'';
  const strikeQuery=useQuery<Strikes>({queryKey:['option-strikes',mode,chosen,range.min,range.max,offset],
    enabled:mode==='PAPER'&&!!chosen,queryFn:()=>api('/options/strikes?'+new URLSearchParams({expiration:chosen,
      offset:String(offset),limit:'50',...(range.min?{minPrice:range.min}:{}),...(range.max?{maxPrice:range.max}:{})}))});
  const params=new URLSearchParams({expiration:chosen,right,limit:'5',consumerId});
  if(centerStrike)params.set('centerStrike',centerStrike);
  if(range.min)params.set('minPrice',range.min);if(range.max)params.set('maxPrice',range.max);
  const q=useQuery<Contracts>({queryKey:['options',mode,right,chosen,centerStrike,range.min,range.max],
    enabled:mode==='DEMO'||!!chosen,queryFn:()=>api(mode==='DEMO'?'/options/contracts':'/options/contracts?'+params),
    refetchInterval:mode==='PAPER'?60000:false});
  const contractKeys=(q.data?.items??[]).filter(row=>row.right===right).map(row=>String(row.conId)).join(',');
  const quotes=useQuery<{items:ContractRow[]}>({queryKey:['option-visible-quotes',mode,contractKeys],
    enabled:mode==='PAPER'&&!!contractKeys,queryFn:()=>api('/options/quotes?conIds='+contractKeys),refetchInterval:5000});
  const latest=new Map((quotes.data?.items??[]).map(row=>[row.conId,row]));
  const rows=(q.data?.items??[]).filter(row=>row.right===right).map(row=>latest.get(row.conId)??row);
  useEffect(()=>()=>{if(mode==='PAPER')for(const key of contractKeys.split(',').filter(Boolean))
    void api('/market/subscriptions/'+key+'?consumerId='+consumerId,{method:'DELETE'}).catch(()=>{});
  },[mode,consumerId,contractKeys]);
  const problems=q.data?.errors??[],mismatch=problems.filter(problem=>problem.code==='INVALID_CONTRACT').length;
  const chooseStrike=(value:number)=>{setCenterStrike(String(value));setAllStrikes(false);};
  const applyRange=()=>{const min=draftMin.trim(),max=draftMax.trim();if(min&&max&&Number(min)>Number(max))return;
    setRange({min,max});setOffset(0);setCenterStrike('');};
  const state=mode==='PAPER'&&expirations.data?.source==='IBKR desconectado'?'TWS_DISCONNECTED':
    expirations.isLoading?'LOADING_EXPIRATIONS':q.isLoading?'LOADING_CONTRACTS':rows.length?'CONTRACTS_AVAILABLE':
    mismatch?'CONTRACT_IDENTITY_MISMATCH':problems.some(p=>p.code==='NOT_FOUND')?'CONTRACT_NOT_FOUND':'NO_ELIGIBLE_CONTRACTS';
  return <div className="content-page options-page">
    <header className="options-hero"><div><span className="eyebrow">NVDA · {mode==='DEMO'?'DEMO SINTÉTICO':'IBKR PAPER'}</span><h1>Cadena de opciones</h1>
      <p>Explore contratos y riesgo hipotético. Sin órdenes ni precios de ejecución garantizados.</p></div>
      <div className="options-observed"><span>SUBYACENTE OBSERVADO</span><strong>{dollars(q.data?.referencePrice)}</strong>
        <small>{referenceLabels[q.data?.referenceSource??'NONE']??'Sin referencia actual verificable'}</small>
        {q.data?.referenceObservedAtUtc?<small>Observado: {dateTime(q.data.referenceObservedAtUtc)}</small>:null}
        {q.data?.referenceReceivedAtUtc?<small>Recibido: {dateTime(q.data.referenceReceivedAtUtc)}</small>:null}
        <small>{mode==='DEMO'?'DEMO sintético':expirations.data?.source??'Comprobando IBKR Paper'}</small></div></header>
    <Card className="options-chain"><div className="options-chain-head"><div><span className="eyebrow">EXPLORAR CONTRATOS</span>
      <h2>{right} · {chosen||'Vencimiento pendiente'}</h2></div><Badge tone={mode==='DEMO'?'warning':'info'}>{mode}</Badge></div>
      <div className="options-primary-controls"><div className="segmented" role="group" aria-label="Tipo de opción">
        <button type="button" aria-pressed={right==='CALL'} className={right==='CALL'?'selected':''} onClick={()=>setRight('CALL')}>CALL</button>
        <button type="button" aria-pressed={right==='PUT'} className={right==='PUT'?'selected':''} onClick={()=>setRight('PUT')}>PUT</button></div>
        <label>Vencimiento <select aria-label="Vencimiento" value={chosen} onChange={event=>{setExpiration(event.target.value);setCenterStrike('');setOffset(0);}}>
          {(expirations.data?.items??[]).map(value=><option value={value} key={value}>{value}</option>)}</select></label>
        {mode==='PAPER'?<div className="segmented" role="group" aria-label="Vista de strikes">
          <button type="button" aria-pressed={!allStrikes} className={!allStrikes?'selected':''} onClick={()=>setAllStrikes(false)}>Strikes cercanos</button>
          <button type="button" aria-pressed={allStrikes} className={allStrikes?'selected':''} onClick={()=>setAllStrikes(true)}>Todos los strikes</button></div>:null}
        <Button variant="ghost" onClick={()=>{void expirations.refetch();void strikeQuery.refetch();void q.refetch();}}>Actualizar</Button></div>
      {mode==='PAPER'&&allStrikes?<div className="options-strike-browser"><p>{strikeQuery.data?.total??0} strikes disponibles. Seleccione uno para cargar hasta cinco definiciones cercanas.</p>
        <div className="options-strike-list">{strikeQuery.data?.items.map(strike=><button type="button" key={strike}
          className={centerStrike===String(strike)?'selected':''} onClick={()=>chooseStrike(strike)}>{dollars(strike)}</button>)}</div>
        <div className="options-pager"><Button variant="ghost" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-50))}>Anteriores</Button>
          <Button variant="ghost" disabled={strikeQuery.data?.nextOffset==null} onClick={()=>setOffset(strikeQuery.data!.nextOffset!)}>Siguientes</Button></div></div>:null}
      {mode==='PAPER'?<details className="options-advanced"><summary>Selección avanzada de strikes</summary><div className="options-controls">
        <label>Strike de referencia <select aria-label="Strike de referencia" value={centerStrike} onChange={event=>setCenterStrike(event.target.value)}>
          <option value="">Referencia automática</option>{(strikeQuery.data?.items??[]).map(value=><option key={value} value={value}>{value}</option>)}</select></label>
        <label>Strike mínimo <input aria-label="Strike mínimo" type="number" min="0" step="0.5" value={draftMin} onChange={event=>setDraftMin(event.target.value)}/></label>
        <label>Strike máximo <input aria-label="Strike máximo" type="number" min="0" step="0.5" value={draftMax} onChange={event=>setDraftMax(event.target.value)}/></label>
        <Button onClick={applyRange}>Aplicar rango</Button></div></details>:null}
      <div className="options-state" role="status" data-state={state}><span>{stateLabels[state]}</span>{q.isFetching&&!q.isLoading?' · Actualizando cotizaciones…':''}
        {q.data?.selectionRequired?' · Sin referencia actual verificable. Elija un strike disponible.':''}</div>
      <div className="table-wrap"><table className="options-table" aria-label="Cadena de opciones"><thead><tr>
        <th>Strike</th><th>BID / acción</th><th>ASK / acción</th><th>Spread %</th><th>Costo / contrato</th>
        <th>Vencimiento</th><th>Calidad</th><th>Acción</th></tr></thead><tbody>
        {rows.length?rows.map(row=>{const analysis=analyzeComparisonRow(row,{quantity:1,capitalUsd:null,
          entryFeePerContractUsd:null,expirationFeePerContractUsd:null,hypotheticalUnderlyingAtExpirationUsd:null,asOfUtc:new Date(now).toISOString()});
          const stale=mode==='PAPER'&&!!row.receivedAtUtc&&now-Date.parse(row.receivedAtUtc)>30000;
          return <tr key={row.conId}><td className="options-strike-cell">{dollars(row.strike)}<small>{row.right}</small></td>
            <td className="num">{dollars(row.bid)}</td><td className="num options-ask">{dollars(row.ask)}</td>
            <td className="num">{analysis.spread.percentOfMidpoint==null?'N/D':number(analysis.spread.percentOfMidpoint)+'%'}</td>
            <td className="num">{dollars(analysis.premium.grossPremiumUsd)}<small>×{row.multiplier??'N/D'} acciones</small></td>
            <td>{row.expiration??'N/D'}</td><td><Badge tone={stale||analysis.quote.status!=='LIVE_RECENT'?'warning':'success'}>
              {stale?'Obsoleta':optionQualityLabel[analysis.quote.status]}</Badge><small>{mode==='DEMO'?'Datos sintéticos':labels[row.dataStatus]??row.dataStatus??'N/D'}</small></td>
            <td><div className="options-actions"><Button variant="secondary" onClick={()=>setAnalysisConId(row.conId)}>Ver análisis</Button>
              <Button variant="ghost" disabled={!selected.includes(row.conId)&&selected.length>=4}
                onClick={()=>setSelected(ids=>toggleComparison(ids,row.conId))}>
                {selected.includes(row.conId)?'Quitar':'Comparar'}</Button></div></td></tr>;})
          :<tr><td colSpan={8} className="empty">{q.isLoading?'Consultando vencimientos y contratos…':q.error?
            (q.error as Error).message:q.data?.selectionRequired?'Sin referencia admisible. Abra «Todos los strikes» para elegir uno.':
            problems.length?'No se pudieron validar contratos; consulte el diagnóstico.':'No hay contratos elegibles.'}</td></tr>}
      </tbody></table></div>
      {problems.length?<div className="options-errors" role="status"><strong>No fue posible cargar {problems.length} contrato(s).</strong>
        <p>{mismatch?'La definición de IBKR no coincide con el contrato solicitado.':''} Los contratos válidos siguen visibles.</p>
        <details><summary>Ver detalles técnicos</summary>{problems.map((problem,index)=><p key={`${problem.strike}-${index}`}>
          Strike {problem.strike??'N/D'} · {problem.code} · {problem.message}
          {problem.mismatchFields?.length?` Campos: ${problem.mismatchFields.join(', ')}`:''}
          {problem.ibkrCode!==null?` · IBKR ${problem.ibkrCode}`:''}
          {problem.requestId?` · Solicitud ${problem.requestId}`:''}</p>)}</details>
        <Button variant="ghost" onClick={()=>void q.refetch()}>Reintentar</Button></div>:null}
      <p className="options-chain-foot">Se resuelven como máximo cinco contratos por consulta. Contrato validado ≠ cotización OPRA disponible.
        {q.data?.referenceSource==='ALPACA_IEX_LAST_COMPLETE_BAR'?' El cierre IEX es una vela observada, no un tick actual.':''}</p>
    </Card>
    {analysisConId!==null?<ContractDetail conId={analysisConId} mode={mode} nowMs={now}/>:null}
    <details className="options-comparison"><summary>Comparador de contratos ({selected.length}/4)</summary>
      <Card><p>Hasta cuatro contratos. Costos brutos por contrato; comisiones desconocidas excluidas.</p>
        {selected.length?<div className="table-wrap"><table aria-label="Comparador de opciones"><thead><tr><th>Contrato</th><th>Vencimiento</th>
          <th>BID / ASK</th><th>Spread %</th><th>Costo bruto</th><th>Equilibrio</th><th>Delta / Theta</th><th>Calidad</th><th>Acción</th></tr></thead>
          <tbody>{selected.map(id=><ComparisonRow key={id} conId={id} mode={mode} nowMs={now}
            onAnalyze={()=>setAnalysisConId(id)} onRemove={()=>setSelected(ids=>toggleComparison(ids,id))} onUpdate={updateComparison}/>)}</tbody></table></div>
          :<p className="subtle">Seleccione contratos de la cadena para comparar.</p>}
        <div className="options-comparison-hidden" aria-hidden="true">{Object.keys(selectedRows).length} cotizaciones cargadas</div>
      </Card></details>
    <Card className="options-disclaimer"><strong>Consulta de solo lectura</strong><p>La prima ASK es por acción y el costo usa el multiplicador del contrato.
      Resolver una definición no acredita permisos de cotización ni garantiza ejecución. El simulador requiere una decisión manual.</p></Card>
  </div>;
}
