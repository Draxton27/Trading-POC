import {useCallback,useEffect,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {api,dateTime,fmt} from '../../lib/api.ts';
import {Badge,Button,Card} from '../../components/ui.tsx';
import {comparisonMetrics,toggleComparison} from './comparison.ts';
import OptionAnalysisPanel from './OptionAnalysisPanel.tsx';
import {analyzeComparisonRow,optionQualityLabel} from './analysis.ts';
import {describeMoneyness,expiryLabel,type Side} from './chain-view.ts';
import type {InvestepScenarioResponse} from '@trading-poc/contracts';

type ContractRow=Record<string,any>;
type Issue={strike:number|null;right?:'CALL'|'PUT';code:string;message:string;requestId:string|null;ibkrCode:number|null;
  twsRequestId?:number|null;elapsedMs?:number;mismatchFields?:string[]};
type Strikes={items:number[];total:number;offset:number;nextOffset:number|null;expiration:string|null};
type ChainRow={strike:number;call:ContractRow|null;put:ContractRow|null;issues:Issue[]};
type Chain={rows:ChainRow[];errors:Issue[];source:string;selectionRequired?:boolean;referenceSource?:string;
  referencePrice?:number|null;referenceObservedAtUtc?:string|null;referenceReceivedAtUtc?:string|null;
  referenceKind?:string;sessionDate?:string|null;ageTradingSessions?:number|null;isCurrent?:boolean;isExecutable?:boolean;
  subscriptionStatus?:{requested:number;limit:number}};
const number=(n:number|null|undefined,digits=2)=>n==null||!Number.isFinite(n)?'N/D':fmt(n,digits);
const dollars=(n:number|null|undefined)=>n==null||!Number.isFinite(n)?'N/D':`$${number(n)}`;
const labels:Record<string,string>={cotizacion_pendiente:'Cotización pendiente',cotizacion_no_disponible:'Sin BID/ASK',
  permisos_insuficientes:'Permisos insuficientes',suscripcion_fallida:'Suscripción fallida',cotizacion_parcial:'Cotización parcial',
  obsoleto:'Cotización obsoleta',recibido:'Cotización recibida'};
const referenceLabels:Record<string,string>={IBKR_LAST_OBSERVED:'IBKR · último precio observado',
  ALPACA_IEX_LAST_COMPLETE_BAR:'Alpaca IEX · última vela completa',MANUAL_STRIKE:'Strike elegido manualmente',
  ALPACA_IEX_VERIFIED_SESSION_CLOSE:'Alpaca IEX · última vela de la sesión regular verificada',
  MANUAL_RANGE_ASCENDING:'Rango elegido manualmente',DEMO_SYNTHETIC:'DEMO · referencia sintética',NONE:'Sin referencia actual verificable'};
const stateLabels:Record<string,string>={IBKR_DISCONNECTED:'IBKR Paper desconectado',LOADING_EXPIRATIONS:'Cargando vencimientos…',
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
    <td>{row?.expiration??'N/D'}</td><td>{analysis?.expiration.daysCalendar??'N/D'}</td><td>{dollars(row?.ask)}</td>
    <td>{metric?.spread.percent==null?'N/D':number(metric.spread.percent)+'%'}</td>
    <td>{dollars(analysis?.premium.grossPremiumUsd)}</td><td>{dollars(analysis?.premium.maximumPremiumLossUsd)}</td>
    <td>{dollars(metric?.breakEven)}</td>
    <td>{analysis?optionQualityLabel[analysis.quote.status]:'Consultando'}</td>
    <td><Button variant="ghost" onClick={onAnalyze} aria-label={`Analizar contrato ${conId}`}>Analizar</Button>
      <Button variant="ghost" onClick={onRemove} aria-label={`Quitar contrato ${conId}`}>Quitar</Button></td></tr>;
}

function TechnicalContext({candidateId}:{candidateId?:string}){
  const current=useQuery<InvestepScenarioResponse>({queryKey:['option-scenarios','NVDA'],
    queryFn:()=>api('/radar/scenarios?symbol=NVDA'),staleTime:60_000});
  const radar=useQuery<any>({queryKey:['option-radar-candidate',candidateId],enabled:!!candidateId,
    queryFn:()=>api('/radar/opportunities/'+encodeURIComponent(candidateId!))});
  const caseItem=radar.data?.item,original=caseItem?.candidate?.scenario,
    latest=caseItem?.technicalUpdates?.at(-1)?.scenario??original;
  return <section className="option-technical-context"><h4>Análisis técnico NVDA</h4>
    <p>Contexto descriptivo del subyacente. No estima la rentabilidad ni la ejecución de este contrato.</p>
    {candidateId?<div><strong>Radar · candidato {candidateId}</strong>
      {radar.isPending?<p>Consultando la evidencia original…</p>:radar.isError?<p>El candidato original no está disponible.</p>:
        <><p>Detectado {dateTime(caseItem?.registeredAtUtc)}. Estado {caseItem?.currentStatus??'N/D'}.
          Evento {latest?.trigger?.description??'N/D'}; SMA {latest?.period??'N/D'} · {latest?.timeframe??'N/D'}.</p>
          <p>Condiciones pendientes: {(latest?.limitations??[]).join('; ')||'N/D'}.
            Contradicciones: {(latest?.contradictions??[]).map((item:any)=>item.detail).join('; ')||'N/D'}.</p>
          <small>El snapshot inicial de Radar conserva {original?.state??'N/D'} y su disponibilidad original; las actualizaciones no cambian aquella decisión.</small></>}
    </div>:null}
    {current.isPending?<p>Consultando escenarios actuales disponibles…</p>:current.isError?<p>Escenarios técnicos no disponibles con los datos locales.</p>:
      <><p>Fuente {current.data?.source.name??'N/D'} · {current.data?.source.dataStatus??'N/D'} · corte {dateTime(current.data?.asOfUtc)}.</p>
        <p>SMA20/40 y SMA100/200 por temporalidad:</p><ul>{(['15m','1h','1d'] as const).map(frame=><li key={frame}>
          {frame}: {current.data?.frames[frame].shortPair??'N/D'} · {current.data?.frames[frame].longPair??'N/D'}</li>)}</ul>
        <p>Escenarios observados: {current.data?.current.length??0}. Pendientes: {current.data?.current.filter(item=>item.state==='AWAITING_CONFIRMATION').length??0}.
          Contradicciones: {current.data?.current.flatMap(item=>item.contradictions).length??0}.</p></>}
  </section>;
}

function ContractDetail({conId,mode,nowMs,candidateId,onClose}:{conId:number|null;mode:string;nowMs:number;
  candidateId?:string;onClose:()=>void}){
  const [consumer]=useState(()=>crypto.randomUUID());
  useEffect(()=>{const dismiss=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose();};
    window.addEventListener('keydown',dismiss);return ()=>window.removeEventListener('keydown',dismiss);},[onClose]);
  const q=useQuery<{item:ContractRow}>({queryKey:['option-detail',conId,consumer],enabled:conId!==null,
    queryFn:()=>api('/options/comparison',{method:'POST',body:JSON.stringify({conId,consumerId:consumer})}),
    refetchInterval:conId!==null?5000:false});
  useEffect(()=>()=>{if(mode==='PAPER'&&conId!==null)void api('/market/subscriptions/'+conId+'?consumerId='+consumer,{method:'DELETE'}).catch(()=>{});},[conId,mode,consumer]);
  return <aside id="option-contract-detail" className="options-drawer" role="dialog" aria-label="Panel de contrato">
    <div className="options-drawer-head"><strong>Contrato seleccionado · conId {conId??'N/D'}</strong>
      <Button variant="ghost" onClick={onClose} aria-label="Cerrar panel de contrato">Cerrar ×</Button></div>
    <OptionAnalysisPanel row={q.data?.item??null} conId={conId} nowMs={nowMs}/>
    <TechnicalContext candidateId={candidateId}/>
    {q.error?<p role="alert">No se pudo cargar el contrato exacto: {(q.error as Error).message}</p>:null}</aside>;
}

function ChainCell({row,issue,right,now,referenceSource,referencePrice,visual,selected,compareDisabled,onAnalyze,onCompare}:{row:ContractRow|null;
  issue?:Issue;
  right:'CALL'|'PUT';now:number;referenceSource:string;referencePrice:number|null;
  visual:{advanced:boolean;cost:boolean;spread:boolean;moneyness:boolean};selected:boolean;compareDisabled:boolean;
  onAnalyze:()=>void;onCompare:()=>void}){
  if(!row)return <div className="chain-side-empty">{issue?`${issue.code}: ${issue.message}`:'Contrato no disponible'} <small>BID / ASK N/D</small></div>;
  const analysis=analyzeComparisonRow(row,{quantity:1,capitalUsd:null,entryFeePerContractUsd:null,
    expirationFeePerContractUsd:null,hypotheticalUnderlyingAtExpirationUsd:null,asOfUtc:new Date(now).toISOString()});
  const stale=referenceSource!=='DEMO_SYNTHETIC'&&!!row.receivedAtUtc&&now-Date.parse(row.receivedAtUtc)>30000;
  const moneyness=describeMoneyness(right,Number(row.strike),referencePrice,referenceSource);
  return <div className={`chain-contract ${right.toLowerCase()}`} data-conid={row.conId}>
    <button type="button" className="chain-prices" onClick={onAnalyze}
      aria-label={`Seleccionar ${right} strike ${number(row.strike)}`}><span><small>BID</small><strong>{dollars(row.bid)}</strong></span>
      <span><small>ASK</small><strong>{dollars(row.ask)}</strong></span></button>
    <div className="chain-contract-meta">
      {visual.spread?<span>Spread <b>{analysis.spread.percentOfMidpoint==null?'N/D':number(analysis.spread.percentOfMidpoint)+'%'}</b></span>:null}
      {visual.cost?<span>Costo bruto <b>{dollars(analysis.premium.grossPremiumUsd)}</b></span>:null}
      {visual.moneyness&&moneyness?<span className="chain-moneyness">{moneyness}</span>:null}
      {visual.advanced?<span>Δ {number(row.delta,3)} · Θ {number(row.theta,3)}</span>:null}
    </div>
    <div className="chain-contract-foot"><Badge tone={analysis.quote.status==='LIVE_RECENT'&&!stale?'success':'warning'}>
      {stale?'Obsoleta':optionQualityLabel[analysis.quote.status]}</Badge>
      <small>{labels[row.dataStatus]??row.dataStatus??'N/D'}</small></div>
    <div className="chain-contract-actions"><Button variant="secondary" onClick={onAnalyze} aria-label={`Analizar ${right} strike ${number(row.strike)}`}>Analizar</Button>
      <Button variant="ghost" disabled={compareDisabled} onClick={onCompare}
        aria-label={`${selected?'Quitar':'Comparar'} ${right} strike ${number(row.strike)}`}>{selected?'Quitar':'Comparar'}</Button></div>
  </div>;
}

export default function OptionsView({mode,consumerId,initialContract}:{mode:string;consumerId:string;
  initialContract?:{conId:number;right:'CALL'|'PUT';strike:number;expiration:string;candidateId?:string}|null}){
  const [side,setSide]=useState<Side>('BOTH'),[mobileSide,setMobileSide]=useState<'CALL'|'PUT'>('CALL');
  const [levels,setLevels]=useState<3|5>(3),[expiration,setExpiration]=useState('');
  const [centerStrike,setCenterStrike]=useState(''),[allStrikes,setAllStrikes]=useState(false),[offset,setOffset]=useState(0);
  const [nearInput,setNearInput]=useState(''),[near,setNear]=useState('');
  const [now,setNow]=useState(Date.now()),[selected,setSelected]=useState<number[]>([]),[selectedRows,setSelectedRows]=useState<Record<number,ContractRow>>({});
  const [analysisConId,setAnalysisConId]=useState<number|null>(null),[analysisPinned,setAnalysisPinned]=useState(false);
  const [target,setTarget]=useState(initialContract??null),[comparisonOpen,setComparisonOpen]=useState(false);
  const [visual,setVisual]=useState(()=>{try{return {...{advanced:false,cost:true,spread:true,moneyness:true},
    ...JSON.parse(localStorage.getItem('trading-poc:option-chain-2')??'{}')};}catch{return {advanced:false,cost:true,spread:true,moneyness:true};}});
  useEffect(()=>{try{localStorage.setItem('trading-poc:option-chain-2',JSON.stringify(visual));}catch{/* Optional local UI state. */}},[visual]);
  useEffect(()=>{if(!initialContract)return;setSide('BOTH');setExpiration(initialContract.expiration);
    setCenterStrike(String(initialContract.strike));setTarget(initialContract);setAnalysisConId(null);setAnalysisPinned(false);},[initialContract]);
  const changeSide=(next:Side)=>{if(next===side)return;setSide(next);setAnalysisConId(null);setAnalysisPinned(false);setTarget(null);};
  const changeExpiration=(next:string)=>{if(next===chosen)return;setExpiration(next);setCenterStrike('');setOffset(0);
    setAnalysisConId(null);setAnalysisPinned(false);setTarget(null);};
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),5000);return ()=>clearInterval(timer);},[]);
  const updateComparison=useCallback((conId:number,row:ContractRow|null)=>setSelectedRows(previous=>{
    if(!row){if(!(conId in previous))return previous;const next={...previous};delete next[conId];return next;}
    return {...previous,[conId]:row};}),[]);
  const expirations=useQuery<{items:string[];source:string}>({queryKey:['option-expirations',mode],queryFn:()=>api('/options/expirations')});
  const chosen=expiration||expirations.data?.items[0]||'';
  const strikeQuery=useQuery<Strikes>({queryKey:['option-strikes',mode,chosen,offset,near],
    enabled:mode==='PAPER'&&!!chosen,queryFn:()=>api('/options/strikes?'+new URLSearchParams({expiration:chosen,
      offset:String(offset),limit:'50',...(near?{near}:{})}))});
  const params=new URLSearchParams({consumerId,strikeLevels:String(levels),side});
  if(chosen&&mode==='PAPER')params.set('expiration',chosen);
  if(centerStrike)params.set('centerStrike',centerStrike);
  const q=useQuery<Chain>({queryKey:['option-chain',mode,side,chosen,levels,centerStrike,consumerId],
    enabled:mode==='DEMO'||!!chosen,queryFn:()=>api('/options/chain?'+params),
    refetchInterval:mode==='PAPER'?60000:false});
  const contractKeys=(q.data?.rows??[]).flatMap(row=>[row.call?.conId,row.put?.conId])
    .filter((id):id is number=>Number.isInteger(id)).map(String).join(',');
  const quotes=useQuery<{items:ContractRow[]}>({queryKey:['option-visible-quotes',mode,contractKeys],
    enabled:mode==='PAPER'&&!!contractKeys,queryFn:()=>api('/options/quotes?conIds='+contractKeys),refetchInterval:5000});
  const latest=new Map((quotes.data?.items??[]).map(row=>[row.conId,row]));
  const rows=(q.data?.rows??[]).map(row=>({...row,call:latest.get(row.call?.conId)??row.call,
    put:latest.get(row.put?.conId)??row.put}));
  useEffect(()=>()=>{if(mode==='PAPER')for(const key of contractKeys.split(',').filter(Boolean))
    void api('/market/subscriptions/'+key+'?consumerId='+consumerId,{method:'DELETE'}).catch(()=>{});
  },[mode,consumerId,contractKeys]);
  useEffect(()=>{if(!target||!q.data)return;
    if(q.data.rows.some(row=>row.call?.conId===target.conId||row.put?.conId===target.conId))setAnalysisConId(target.conId);
  },[target,q.data]);
  const problems=q.data?.errors??[],mismatch=problems.filter(problem=>problem.code==='INVALID_CONTRACT').length;
  const requested=q.data?.subscriptionStatus?.requested??0;
  const definitions=rows.flatMap(row=>[row.call,row.put]).filter(Boolean) as ContractRow[];
  const completeQuotes=definitions.filter(row=>row.bid!=null&&row.ask!=null).length;
  const partialQuotes=definitions.filter(row=>(row.bid!=null)!==(row.ask!=null)||row.marketDataStatus==='partial').length;
  const reasons=Object.entries(problems.reduce((counts,problem)=>({...counts,[problem.code]:(counts[problem.code]??0)+1}),{} as Record<string,number>));
  const chooseStrike=(value:number)=>{setCenterStrike(String(value));setAllStrikes(false);setAnalysisConId(null);setTarget(null);};
  const state=mode==='PAPER'&&q.data?.source==='IBKR desconectado'?'IBKR_DISCONNECTED':
    expirations.isLoading?'LOADING_EXPIRATIONS':q.isLoading?'LOADING_CONTRACTS':rows.length?'CONTRACTS_AVAILABLE':
    mismatch?'CONTRACT_IDENTITY_MISMATCH':problems.some(p=>p.code==='NOT_FOUND')?'CONTRACT_NOT_FOUND':'NO_ELIGIBLE_CONTRACTS';
  const referenceSource=q.data?.referenceSource??'NONE';
  const referencePrice=q.data?.referencePrice??null;
  const observedReference=['IBKR_LAST_OBSERVED','ALPACA_IEX_LAST_COMPLETE_BAR','DEMO_SYNTHETIC'].includes(referenceSource);
  const marker=observedReference&&referencePrice!==null?rows.findIndex(row=>row.strike>=referencePrice):-1;
  const displayedDates=expirations.data?.items.slice(0,4)??[];
  if(chosen&&!displayedDates.includes(chosen))displayedDates.push(chosen);
  const flip=(key:'advanced'|'cost'|'spread'|'moneyness')=>setVisual((current:any)=>({...current,[key]:!current[key]}));
  return <div className="content-page options-page">
    <header className="options-hero"><div><span className="eyebrow">NVDA · {mode==='DEMO'?'DEMO SINTÉTICO':mode==='PAPER'?'IBKR PAPER':'OFFLINE'}</span><h1>Cadena de opciones</h1>
      <p>Explore contratos y riesgo hipotético. Sin órdenes ni precios de ejecución garantizados.</p></div>
      <div className="options-observed"><span>{q.data?.referenceSource==='MANUAL_STRIKE'?'STRIKE DE REFERENCIA MANUAL':
        q.data?.referenceSource==='DEMO_SYNTHETIC'?'REFERENCIA SINTÉTICA':
        q.data?.referenceSource==='ALPACA_IEX_LAST_COMPLETE_BAR'?'REFERENCIA IEX APROXIMADA':
        q.data?.referenceSource==='ALPACA_IEX_VERIFIED_SESSION_CLOSE'?'ÚLTIMA OBSERVACIÓN VERIFICADA DE NVDA':
        q.data?.referenceSource==='NONE'||!q.data?.referenceSource?'REFERENCIA NO DISPONIBLE':'SUBYACENTE OBSERVADO'}</span><strong>{dollars(q.data?.referencePrice)}</strong>
        <small>{referenceLabels[q.data?.referenceSource??'NONE']??'Sin referencia actual verificable'}</small>
        {q.data?.referenceObservedAtUtc?<small>Observado: {dateTime(q.data.referenceObservedAtUtc)}</small>:null}
        {q.data?.referenceReceivedAtUtc?<small>Recibido: {dateTime(q.data.referenceReceivedAtUtc)}</small>:null}
        {referenceSource==='ALPACA_IEX_VERIFIED_SESSION_CLOSE'?<small>Sesión {q.data?.sessionDate} · Histórico, no es precio actual ni ejecutable.</small>:null}
        <small>{mode==='DEMO'?'DEMO sintético':expirations.data?.source??'Comprobando IBKR Paper'}</small></div></header>
    <Card className="options-chain"><div className="options-chain-head"><div><span className="eyebrow">EXPLORAR CONTRATOS</span>
      <h2>CALL · {chosen?expiryLabel(chosen):'Vencimiento pendiente'} · PUT</h2></div><Badge tone={mode==='DEMO'?'warning':'info'}>{mode}</Badge></div>
      <div className="chain-expirations" role="group" aria-label="Vencimientos">
        {displayedDates.map(value=><button key={value} type="button" className={chosen===value?'active':''} aria-pressed={chosen===value}
          onClick={()=>changeExpiration(value)}>{expiryLabel(value)} <small>{value}</small></button>)}
        <label>Más fechas <select aria-label="Vencimiento" value={chosen} onChange={event=>changeExpiration(event.target.value)}>
          {(expirations.data?.items??[]).map(value=><option value={value} key={value}>{value}</option>)}</select></label></div>
      <div className="options-primary-controls"><div className="segmented" role="group" aria-label="Niveles visibles">
        <button type="button" aria-pressed={levels===3} className={levels===3?'selected':''} onClick={()=>setLevels(3)}>3 strikes</button>
        <button type="button" aria-pressed={levels===5} className={levels===5?'selected':''} onClick={()=>setLevels(5)}>5 strikes</button></div>
        <div className="segmented" role="group" aria-label="Lados visibles">
          {(['BOTH','CALL','PUT'] as const).map(value=><button type="button" key={value} aria-pressed={side===value}
            className={side===value?'selected':''} onClick={()=>changeSide(value)}>{value==='BOTH'?'Ambos':value}</button>)}</div>
        {mode==='PAPER'?<div className="segmented" role="group" aria-label="Vista de strikes">
          <button type="button" aria-pressed={allStrikes} className={allStrikes?'selected':''} onClick={()=>setAllStrikes(value=>!value)}>Más strikes</button></div>:null}
        <Button variant="ghost" onClick={()=>{void expirations.refetch();void strikeQuery.refetch();void q.refetch();}}>Actualizar</Button></div>
      {mode==='PAPER'&&allStrikes?<div className="options-strike-browser"><p>{strikeQuery.data?.total??0} strikes reportados por IBKR. Seleccione uno como centro manual, sin convertirlo en precio observado.</p>
        <form onSubmit={event=>{event.preventDefault();const value=Number(nearInput);if(Number.isFinite(value)&&value>0){setNear(String(value));setOffset(0);}}}>
          <label>Buscar cerca del precio o strike <input type="number" min="0.01" step="any" value={nearInput} onChange={event=>setNearInput(event.target.value)}/></label>
          <Button type="submit">Buscar strikes</Button></form>
        <div className="options-strike-list">{strikeQuery.data?.items.map(strike=><button type="button" key={strike}
          className={centerStrike===String(strike)?'selected':''} onClick={()=>chooseStrike(strike)}>{dollars(strike)}</button>)}</div>
        <div className="options-pager"><Button variant="ghost" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-50))}>Anteriores</Button>
          <Button variant="ghost" disabled={strikeQuery.data?.nextOffset==null} onClick={()=>setOffset(strikeQuery.data!.nextOffset!)}>Siguientes</Button></div></div>:null}
      <details className="options-advanced"><summary>Preferencias visuales</summary><div className="chain-preferences">
        {([['advanced','Modo avanzado'],['cost','Mostrar costo bruto'],['spread','Mostrar spread'],
          ['moneyness','Mostrar ITM / OTM']] as const).map(([key,label])=><label key={key}>
          <input type="checkbox" checked={visual[key]} onChange={()=>flip(key)}/>{label}</label>)}</div></details>
      <div className="options-state" role="status" data-state={state}><span>{problems.length&&definitions.length?'Consulta parcial':stateLabels[state]}</span>{q.isFetching&&!q.isLoading?' · Actualizando cotizaciones…':''}
        {q.data?.selectionRequired?' · Sin referencia actual verificable. Elija un strike disponible.':''}</div>
      {requested>0?<div className="options-chain-summary" aria-label="Resumen de cadena">
        {requested} contratos solicitados · {definitions.length} definiciones válidas · {problems.length} incidencias ·
        cotizaciones completas {completeQuotes} · parciales {partialQuotes}.
        {reasons.length?<small>Motivos: {reasons.map(([code,count])=>`${code} ${count}`).join(' · ')}.</small>:null}
      </div>:null}
      {target&&q.data&&!rows.some(row=>row.call?.conId===target.conId||row.put?.conId===target.conId)?
        <p className="options-target-warning" role="alert">El contrato exacto conId {target.conId} enviado por Radar no está disponible.
          No se sustituye por otro strike. Revise identidad y disponibilidad temporal.</p>:null}
      <div className="chain-mobile-side" role="group" aria-label="Lado en móvil">
        <button type="button" className={mobileSide==='CALL'?'selected':''} onClick={()=>setMobileSide('CALL')}>Ver CALL</button>
        <button type="button" className={mobileSide==='PUT'?'selected':''} onClick={()=>setMobileSide('PUT')}>Ver PUT</button></div>
      <div className={`chain-grid-wrap side-${side.toLowerCase()} mobile-show-${mobileSide.toLowerCase()}`}>
        <table className="options-table chain-grid" aria-label="Cadena de opciones"><thead><tr>
          <th className="chain-call-head">CALL · BID / ASK</th><th className="chain-strike-head">STRIKE</th><th className="chain-put-head">PUT · BID / ASK</th>
        </tr></thead><tbody>{rows.length?rows.flatMap((row,index)=>{
          const result=[];
          if(index===marker)result.push(<tr key={`marker-${row.strike}`} className="chain-reference-row"><td colSpan={3}>
            Referencia {referenceSource==='DEMO_SYNTHETIC'?'sintética':referenceSource==='ALPACA_IEX_LAST_COMPLETE_BAR'?'IEX aproximada':'IBKR observada'}: {dollars(referencePrice)}</td></tr>);
          result.push(<tr key={row.strike} className="chain-strike-row">
            <td className="chain-call-cell">{side==='PUT'?<span className="chain-side-empty">CALL oculto</span>:<ChainCell row={row.call} issue={row.issues.find(item=>item.right==='CALL')} right="CALL"
              now={now} referenceSource={referenceSource} referencePrice={referencePrice} visual={visual}
              selected={!!row.call&&selected.includes(row.call.conId)} compareDisabled={!!row.call&&!selected.includes(row.call.conId)&&selected.length>=4}
              onAnalyze={()=>{if(row.call){setAnalysisConId(row.call.conId);setAnalysisPinned(false);setTarget(null);}}}
              onCompare={()=>row.call&&setSelected(ids=>toggleComparison(ids,row.call!.conId))}/>}</td>
            <td className="options-strike-cell"><strong>{dollars(row.strike)}</strong><small>Ejercicio</small></td>
            <td className="chain-put-cell">{side==='CALL'?<span className="chain-side-empty">PUT oculto</span>:<ChainCell row={row.put} issue={row.issues.find(item=>item.right==='PUT')} right="PUT"
              now={now} referenceSource={referenceSource} referencePrice={referencePrice} visual={visual}
              selected={!!row.put&&selected.includes(row.put.conId)} compareDisabled={!!row.put&&!selected.includes(row.put.conId)&&selected.length>=4}
              onAnalyze={()=>{if(row.put){setAnalysisConId(row.put.conId);setAnalysisPinned(false);setTarget(null);}}}
              onCompare={()=>row.put&&setSelected(ids=>toggleComparison(ids,row.put!.conId))}/>}</td></tr>);
          return result;
        }):<tr><td colSpan={3} className="empty">{q.isLoading?'Consultando vencimientos y contratos…':q.error?
          (q.error as Error).message:q.data?.selectionRequired?'Sin precio admisible. Abra «Más strikes» para elegir un centro manual.':
          problems.length?'No se pudieron validar contratos; consulte el diagnóstico.':'No hay contratos elegibles.'}</td></tr>}</tbody></table></div>
      {problems.length?<div className="options-errors" role="status"><strong>No fue posible cargar {problems.length} contrato(s).</strong>
        <p>{mismatch?'La definición de IBKR no coincide con el contrato solicitado.':''} Los contratos válidos siguen visibles.</p>
        <details><summary>Ver detalles técnicos</summary>{problems.map((problem,index)=><p key={`${problem.right}-${problem.strike}-${index}`}>
          {problem.right??'N/D'} · strike {problem.strike??'N/D'} · {problem.code} · {problem.message}
          {problem.mismatchFields?.length?` Campos: ${problem.mismatchFields.join(', ')}`:''}
          {problem.ibkrCode!==null?` · IBKR ${problem.ibkrCode}`:''}
          {problem.requestId?` · Solicitud ${problem.requestId}`:''}
          {problem.twsRequestId!=null?` · TWS ${problem.twsRequestId}`:''}
          {problem.elapsedMs!=null?` · ${problem.elapsedMs} ms`:''}</p>)}</details>
        <Button variant="ghost" onClick={()=>void q.refetch()}>Reintentar</Button></div>:null}
      <p className="options-chain-foot">Máximo {levels*(side==='BOTH'?2:1)} definiciones en esta consulta; límite global de 10 suscripciones
        compartidas con Radar y comparador. Contrato validado ≠ cotización OPRA disponible.
        {q.data?.referenceSource==='ALPACA_IEX_LAST_COMPLETE_BAR'?' El cierre IEX es una vela observada, no un tick actual.':''}</p>
    </Card>
    {analysisConId!==null?<>{analysisPinned?<p className="options-pinned-note">Análisis fijado desde el comparador, independiente del filtro de la cadena. Verifique tipo y vencimiento del contrato.</p>:null}
      <ContractDetail key={analysisConId} conId={analysisConId} mode={mode} nowMs={now}
        candidateId={!analysisPinned&&target?.conId===analysisConId?target.candidateId:undefined}
        onClose={()=>setAnalysisConId(null)}/></>:null}
    <section className="options-comparison"><button type="button" className="chain-comparison-toggle" aria-expanded={comparisonOpen}
      onClick={()=>setComparisonOpen(value=>!value)}>Comparar contratos ({selected.length}/4) {comparisonOpen?'▾':'▸'}</button>
      {comparisonOpen?<Card><p>Hasta cuatro contratos fijados. Distintos strikes, lados o vencimientos no son escenarios directamente equivalentes.
        Costos brutos por contrato; comisiones desconocidas excluidas.</p>
        {selected.length?<div className="table-wrap"><table aria-label="Comparador de opciones"><thead><tr><th>Contrato</th><th>Vencimiento</th>
          <th>DTE</th><th>ASK</th><th>Spread %</th><th>Costo bruto</th><th>Pérdida máxima bruta</th><th>Equilibrio</th><th>Calidad</th><th>Acción</th></tr></thead>
          <tbody>{selected.map(id=><ComparisonRow key={id} conId={id} mode={mode} nowMs={now}
            onAnalyze={()=>{setAnalysisConId(id);setAnalysisPinned(true);}} onRemove={()=>setSelected(ids=>toggleComparison(ids,id))} onUpdate={updateComparison}/>)}</tbody></table></div>
          :<p className="subtle">Seleccione contratos de la cadena para comparar.</p>}
        <div className="options-comparison-hidden" aria-hidden="true">{Object.keys(selectedRows).length} cotizaciones cargadas</div>
      </Card>:null}</section>
    <Card className="options-disclaimer"><strong>Consulta de solo lectura</strong><p>La prima ASK es por acción y el costo usa el multiplicador del contrato.
      Resolver una definición no acredita permisos de cotización ni garantiza ejecución. El simulador requiere una decisión manual.</p></Card>
  </div>;
}
