import {useCallback,useEffect,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {api,dateTime,fmt} from '../../lib/api.ts';
import {Badge,Button,Card} from '../../components/ui.tsx';
import {comparisonMetrics,toggleComparison} from './comparison.ts';
import OptionAnalysisPanel from './OptionAnalysisPanel.tsx';
import {analyzeComparisonRow,optionQualityLabel} from './analysis.ts';
import {describeMoneyness,expiryLabel,type Side} from './chain-view.ts';
import {emptyEconomicFilters,evaluateEconomicContract,parseEconomicNumber,type EconomicConfig,
  type EconomicFilters} from './economic-explorer.ts';
import type {InvestepScenarioResponse} from '@trading-poc/contracts';

type ContractRow=Record<string,any>;
type Issue={strike:number|null;right?:'CALL'|'PUT';code:string;message:string;requestId:string|null;ibkrCode:number|null;
  twsRequestId?:number|null;elapsedMs?:number;mismatchFields?:string[]};
type Strikes={items:number[];total:number;offset:number;nextOffset:number|null;expiration:string|null};
type ChainRow={strike:number;call:ContractRow|null;put:ContractRow|null;issues:Issue[];
  replacementFor?:{right:'CALL'|'PUT';requestedStrike:number}};
type Chain={rows:ChainRow[];errors:Issue[];source:string;selectionRequired?:boolean;referenceSource?:string;
  referencePrice?:number|null;referenceObservedAtUtc?:string|null;referenceReceivedAtUtc?:string|null;
  referenceKind?:string;sessionDate?:string|null;ageTradingSessions?:number|null;isCurrent?:boolean;isExecutable?:boolean;
  subscriptionStatus?:{requested:number;limit:number};fallback?:{additionalAttemptLimit:number;attemptedCount:number;
    notFoundCount:number;resolvedCount:number;attempts:Array<{right:'CALL'|'PUT';requestedStrike:number;
      resolvedStrike:number|null;reason:string}>}};
const number=(n:number|null|undefined,digits=2)=>n==null||!Number.isFinite(n)?'N/D':fmt(n,digits);
const dollars=(n:number|null|undefined)=>n==null||!Number.isFinite(n)?'N/D':`$${number(n)}`;
const labels:Record<string,string>={cotizacion_pendiente:'Cotización pendiente',cotizacion_no_disponible:'Cotización no disponible',
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
const rangeText=(values:Array<number|null>,suffix='')=>{
  const present=values.filter((value):value is number=>value!==null&&Number.isFinite(value));
  if(present.length<2)return 'N/D';
  return `${number(Math.min(...present))}${suffix} a ${number(Math.max(...present))}${suffix}`;
};

function ComparisonRow({conId,mode,nowMs,config,referencePrice,referenceSource,onRemove,onAnalyze,onUpdate}:{conId:number;mode:string;nowMs:number;
  config:EconomicConfig|null;referencePrice:number|null;referenceSource:string;
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
  const analysis=row?analyzeComparisonRow(row,{quantity:config?.quantity??1,capitalUsd:config?.capitalUsd??null,
    entryFeePerContractUsd:config?.entryFeePerContractUsd??null,
    expirationFeePerContractUsd:null,hypotheticalUnderlyingAtExpirationUsd:null,asOfUtc:new Date(nowMs).toISOString()}):null;
  const distance=row&&referencePrice!==null&&Number.isFinite(row.strike)?Math.abs(row.strike-referencePrice):null;
  return <tr><td><strong>{row?.right??'N/D'} {dollars(row?.strike)}</strong><small>conId {conId}</small></td>
    <td>{row?.expiration??'N/D'}</td><td>{analysis?.expiration.daysCalendar??'N/D'}</td><td>{dollars(row?.bid)}</td><td>{dollars(row?.ask)}</td>
    <td>{metric?.spread.percent==null?'N/D':number(metric.spread.percent)+'%'}</td>
    <td>{dollars(analysis?.premium.grossPremiumUsd)}</td><td>{dollars(analysis?.premium.maximumPremiumLossUsd)}</td>
    <td>{analysis?.capital.committedPercent==null?'N/D':number(analysis.capital.committedPercent)+'%'}</td>
    <td>{dollars(metric?.breakEven)}</td><td>{distance===null?'N/D':`${dollars(distance)} (${referenceSource})`}</td>
    <td>{analysis?`${optionQualityLabel[analysis.quote.status]} · ${analysis.quote.feedType} · ${dateTime(analysis.quote.receivedAtUtc)}`:'Consultando'}</td>
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

function ContractDetail({conId,mode,nowMs,candidateId,defaults,onClose}:{conId:number|null;mode:string;nowMs:number;
  defaults:EconomicConfig|null;
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
    <OptionAnalysisPanel row={q.data?.item??null} conId={conId} nowMs={nowMs} defaults={defaults??undefined}/>
    <TechnicalContext candidateId={candidateId}/>
    {q.error?<p role="alert">No se pudo cargar el contrato exacto: {(q.error as Error).message}</p>:null}</aside>;
}

function ChainCell({row,issue,hiddenByFilter,right,now,referenceSource,referencePrice,visual,config,selected,compareDisabled,onAnalyze,onCompare}:{row:ContractRow|null;
  issue?:Issue;hiddenByFilter?:boolean;
  right:'CALL'|'PUT';now:number;referenceSource:string;referencePrice:number|null;
  visual:{advanced:boolean;cost:boolean;spread:boolean;moneyness:boolean};config:EconomicConfig|null;
  selected:boolean;compareDisabled:boolean;
  onAnalyze:()=>void;onCompare:()=>void}){
  if(!row)return <div className="chain-side-empty">{hiddenByFilter?'Oculto por filtro; sigue disponible en la vista general.':
    issue?`${issue.code}: ${issue.message}`:'Contrato no disponible'} {!hiddenByFilter?<small>BID / ASK N/D</small>:null}</div>;
  const analysis=analyzeComparisonRow(row,{quantity:1,capitalUsd:null,entryFeePerContractUsd:null,
    expirationFeePerContractUsd:null,hypotheticalUnderlyingAtExpirationUsd:null,asOfUtc:new Date(now).toISOString()});
  const economic=config?evaluateEconomicContract(row,config):null;
  const stale=referenceSource!=='DEMO_SYNTHETIC'&&!!row.receivedAtUtc&&now-Date.parse(row.receivedAtUtc)>30000;
  const moneyness=describeMoneyness(right,Number(row.strike),referencePrice,referenceSource);
  const unavailable=row.quoteStatus==='UNAVAILABLE'||row.quoteStatus==='SUBSCRIPTION_FAILED'||
    row.quoteStatus==='SUBSCRIPTION_LIMIT'||row.subscriptionStatus==='FAILED';
  return <div className={`chain-contract ${right.toLowerCase()}`} data-conid={row.conId}>
    <button type="button" className="chain-prices" onClick={onAnalyze}
      aria-label={`Seleccionar ${right} strike ${number(row.strike)}`}><span><small>BID</small><strong>{dollars(row.bid)}</strong></span>
      <span><small>ASK</small><strong>{dollars(row.ask)}</strong></span></button>
    <div className="chain-contract-meta">
      <span>Costo bruto <b>{dollars(economic?.analysis.premium.grossPremiumUsd??analysis.premium.grossPremiumUsd)}</b></span>
      {visual.spread?<span>Spread <b>{analysis.spread.percentOfMidpoint==null?'N/D':number(analysis.spread.percentOfMidpoint)+'%'}</b></span>:null}
      <span>DTE <b>{analysis.expiration.daysCalendar??'N/D'}</b></span>
      {config?.capitalUsd!==null&&config?.capitalUsd!==undefined?<span>Capital comprometido <b>{economic?.analysis.capital.committedPercent==null?'N/D':number(economic.analysis.capital.committedPercent)+'%'}</b></span>:null}
      {visual.moneyness&&moneyness?<span className="chain-moneyness">{moneyness}</span>:null}
      {referenceSource==='ALPACA_IEX_VERIFIED_SESSION_CLOSE'&&referencePrice!==null?
        <span>Distancia a referencia histórica <b>{dollars(Math.abs(Number(row.strike)-referencePrice))}</b></span>:null}
      {visual.advanced?<span>Δ {number(row.delta,3)} · Θ {number(row.theta,3)}</span>:null}
    </div>
    {economic?<div className="chain-economic-result" role="status"><strong>{economic.status==='MATCH'?'Dentro de límites hipotéticos':
      economic.status==='EXCEEDS'?'Excede un límite':'Filtro no evaluable'}</strong>
      <small>{[...economic.failures,...economic.unknown].join('; ')||'Sin restricciones incumplidas.'}</small></div>:null}
    <div className="chain-contract-foot"><Badge tone={!unavailable&&analysis.quote.status==='LIVE_RECENT'&&!stale?'success':'warning'}>
      {unavailable?labels[row.dataStatus]??'Cotización no disponible':stale?'Obsoleta':optionQualityLabel[analysis.quote.status]}</Badge>
      <small>{labels[row.dataStatus]??row.dataStatus??'N/D'}</small></div>
    <div className="chain-contract-actions"><Button variant="secondary" onClick={onAnalyze} aria-label={`Analizar ${right} strike ${number(row.strike)}`}>Analizar</Button>
      <Button variant="ghost" disabled={compareDisabled} onClick={onCompare}
        aria-label={`${selected?'Quitar':'Comparar'} ${right} strike ${number(row.strike)}`}>{selected?'Quitar':'Comparar'}</Button></div>
  </div>;
}

export default function OptionsView({mode,consumerId,initialContract}:{mode:string;consumerId:string;
  initialContract?:{conId:number;right:'CALL'|'PUT';strike:number;expiration:string;candidateId?:string}|null}){
  const [navigation,setNavigation]=useState<'NEAR'|'BUDGET'|'FREE'>('NEAR');
  const [quantityInput,setQuantityInput]=useState('1'),[capitalInput,setCapitalInput]=useState('');
  const [unitCostInput,setUnitCostInput]=useState(''),[entryFeeInput,setEntryFeeInput]=useState('');
  const [filterInputs,setFilterInputs]=useState<Record<keyof EconomicFilters,string>>({minAsk:'',maxAsk:'',maxCost:'',
    maxSpreadPercent:'',minDte:'',maxDte:''});
  const [onlyMatching,setOnlyMatching]=useState(false);
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
  const quantity=parseEconomicNumber(quantityInput,{integer:true,positive:true});
  const capitalUsd=parseEconomicNumber(capitalInput,{positive:true});
  const maxUnitCostUsd=parseEconomicNumber(unitCostInput);
  const entryFeePerContractUsd=parseEconomicNumber(entryFeeInput);
  const filters=Object.fromEntries(Object.entries(filterInputs).map(([key,value])=>[key,
    parseEconomicNumber(value,{integer:key==='minDte'||key==='maxDte'})])) as EconomicFilters;
  const invalidEconomic=quantity===null||quantity>10000||capitalUsd!==null&&capitalUsd>1e12||
    entryFeePerContractUsd!==null&&entryFeePerContractUsd>1e6||
    [quantity,capitalUsd,maxUnitCostUsd,entryFeePerContractUsd,...Object.values(filters)]
    .some(value=>value!==null&&!Number.isFinite(value))||
    filters.minAsk!==null&&filters.maxAsk!==null&&filters.minAsk>filters.maxAsk||
    filters.minDte!==null&&filters.maxDte!==null&&filters.minDte>filters.maxDte;
  const economicConfig:EconomicConfig|null=invalidEconomic?null:{quantity:quantity!,capitalUsd,maxUnitCostUsd,
    entryFeePerContractUsd,filters,asOfUtc:new Date(now).toISOString()};
  const economicActive=capitalUsd!==null||maxUnitCostUsd!==null||entryFeePerContractUsd!==null||quantity!==1||
    Object.values(filters).some(value=>value!==null);
  const setFilter=(key:keyof EconomicFilters,value:string)=>setFilterInputs(previous=>({...previous,[key]:value}));
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
  const matches=(item:ContractRow|null)=>!!item&&economicConfig!==null&&
    evaluateEconomicContract(item,economicConfig).status==='MATCH';
  const displayedRows=onlyMatching&&economicActive&&economicConfig?rows.filter(row=>
    side!=='PUT'&&matches(row.call)||side!=='CALL'&&matches(row.put)):rows;
  useEffect(()=>()=>{if(mode==='PAPER')for(const key of contractKeys.split(',').filter(Boolean))
    void api('/market/subscriptions/'+key+'?consumerId='+consumerId,{method:'DELETE'}).catch(()=>{});
  },[mode,consumerId,contractKeys]);
  useEffect(()=>{if(!target||!q.data)return;
    if(q.data.rows.some(row=>row.call?.conId===target.conId||row.put?.conId===target.conId))setAnalysisConId(target.conId);
  },[target,q.data]);
  const problems=q.data?.errors??[],mismatch=problems.filter(problem=>problem.code==='INVALID_CONTRACT').length;
  const requested=q.data?.subscriptionStatus?.requested??0;
  const definitions=rows.flatMap(row=>[row.call,row.put]).filter(Boolean) as ContractRow[];
  const bidAskPresent=definitions.filter(row=>row.bid!=null&&row.ask!=null).length;
  const partialQuotes=definitions.filter(row=>(row.bid!=null)!==(row.ask!=null)||row.marketDataStatus==='partial').length;
  const reasons=Object.entries(problems.reduce((counts,problem)=>({...counts,[problem.code]:(counts[problem.code]??0)+1}),{} as Record<string,number>));
  const referenceSource=q.data?.referenceSource??'NONE';
  const referencePrice=q.data?.referencePrice??null;
  const compared=selected.map(id=>selectedRows[id]).filter((row):row is ContractRow=>!!row);
  const comparedMetrics=compared.map(row=>comparisonMetrics({right:row.right,strike:row.strike,
    expiration:row.expiration,multiplier:row.multiplier,bid:row.bid,ask:row.ask},new Date(now)));
  const comparisonRanges={cost:rangeText(comparedMetrics.map(item=>item.nominalCost===null?null:
    item.nominalCost*(economicConfig?.quantity??1))),spread:rangeText(comparedMetrics.map(item=>item.spread.percent),'%'),
    dte:rangeText(comparedMetrics.map(item=>item.dte),' días'),
    distance:rangeText(compared.map(row=>referencePrice===null?null:Math.abs(Number(row.strike)-referencePrice)))};
  const chooseStrike=(value:number)=>{setCenterStrike(String(value));setAllStrikes(false);setAnalysisConId(null);setTarget(null);};
  const state=mode==='PAPER'&&q.data?.source==='IBKR desconectado'?'IBKR_DISCONNECTED':
    expirations.isLoading?'LOADING_EXPIRATIONS':q.isLoading?'LOADING_CONTRACTS':rows.length?'CONTRACTS_AVAILABLE':
    mismatch?'CONTRACT_IDENTITY_MISMATCH':problems.some(p=>p.code==='NOT_FOUND')?'CONTRACT_NOT_FOUND':'NO_ELIGIBLE_CONTRACTS';
  const observedReference=['IBKR_LAST_OBSERVED','ALPACA_IEX_LAST_COMPLETE_BAR','DEMO_SYNTHETIC'].includes(referenceSource);
  const marker=observedReference&&referencePrice!==null?displayedRows.findIndex(row=>row.strike>=referencePrice):-1;
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
      <div className="segmented" role="group" aria-label="Modo de exploración">
        {([['NEAR','Cerca del precio'],['BUDGET','Por presupuesto'],['FREE','Exploración libre']] as const).map(([value,label])=>
          <button key={value} type="button" aria-pressed={navigation===value} className={navigation===value?'selected':''}
            onClick={()=>{setNavigation(value);if(value==='FREE')setAllStrikes(true);}}>{label}</button>)}</div>
      <p className="subtle">Los filtros se aplican a los contratos consultados, no a toda la cadena de IBKR.
        Los importes retrasados o congelados son descriptivos y no garantizan ejecución.</p>
      {navigation==='NEAR'&&economicActive?<p className="subtle">Los parámetros económicos introducidos siguen activos.
        Abra «Por presupuesto» para revisarlos o cambie los filtros opcionales.</p>:null}
      {centerStrike?<Button variant="ghost" onClick={()=>{setCenterStrike('');setAnalysisConId(null);setTarget(null);}}>
        Volver a la referencia de NVDA</Button>:null}
      {navigation==='BUDGET'||navigation==='FREE'?<div className="options-economic-controls">
        <label>Capital hipotético USD <input aria-label="Capital del explorador" type="number" min="0.01" step="any"
          value={capitalInput} onChange={e=>setCapitalInput(e.target.value)} placeholder="Opcional"/></label>
        <label>Costo máximo por contrato USD <input aria-label="Costo máximo por contrato" type="number" min="0" step="any"
          value={unitCostInput} onChange={e=>setUnitCostInput(e.target.value)} placeholder="Opcional"/></label>
        <label>Cantidad hipotética de contratos <input aria-label="Cantidad del explorador" type="number" min="1" max="10000" step="1"
          value={quantityInput} onChange={e=>setQuantityInput(e.target.value)}/></label>
        <label>Comisión de entrada declarada por contrato USD <input aria-label="Comisión del explorador" type="number" min="0" step="any"
          value={entryFeeInput} onChange={e=>setEntryFeeInput(e.target.value)} placeholder="Desconocida"/></label>
      </div>:null}
      <details className="options-advanced"><summary>Filtros económicos opcionales</summary><div className="options-economic-controls">
        {([['minAsk','ASK mínimo'],['maxAsk','ASK máximo'],['maxCost','Costo bruto máximo total'],
          ['maxSpreadPercent','Spread máximo %'],['minDte','DTE mínimo'],['maxDte','DTE máximo']] as const).map(([key,label])=>
          <label key={key}>{label}<input aria-label={label} type="number" min="0"
            step={key==='minDte'||key==='maxDte'?'1':'any'} value={filterInputs[key]}
            onChange={e=>setFilter(key,e.target.value)} placeholder="Sin límite"/></label>)}
      </div></details>
      {invalidEconomic?<p role="alert" className="option-analysis-warning">Revise cantidad, valores y rangos de los filtros. No se aplican hasta corregirlos.</p>:null}
      {economicActive&&economicConfig?<label className="options-filter-toggle"><input type="checkbox" checked={onlyMatching}
        onChange={e=>setOnlyMatching(e.target.checked)}/> Mostrar solo coincidencias evaluables</label>:null}
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
        {([['advanced','Modo avanzado'],['spread','Mostrar spread'],
          ['moneyness','Mostrar ITM / OTM']] as const).map(([key,label])=><label key={key}>
          <input type="checkbox" checked={visual[key]} onChange={()=>flip(key)}/>{label}</label>)}</div></details>
      <div className="options-state" role="status" data-state={state}><span>{problems.length&&definitions.length?'Consulta parcial':stateLabels[state]}</span>{q.isFetching&&!q.isLoading?' · Actualizando cotizaciones…':''}
        {q.data?.selectionRequired?' · Sin referencia actual verificable. Elija un strike disponible.':''}</div>
      {requested>0?<div className="options-chain-summary" aria-label="Resumen de cadena">
        {requested} contratos solicitados · {definitions.length} definiciones válidas · {problems.length} incidencias ·
        BID/ASK presentes (no necesariamente vigentes) {bidAskPresent} · un lado o ticks parciales {partialQuotes}.
        {q.data?.fallback?.attemptedCount?<small>Búsqueda acotada: {q.data.fallback.attemptedCount}/2 resoluciones adicionales;
          {q.data.fallback.resolvedCount} contratos encontrados. Cada nivel conserva su strike y lado.</small>:null}
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
        </tr></thead><tbody>{displayedRows.length?displayedRows.flatMap((row,index)=>{
          const result=[];
          if(index===marker)result.push(<tr key={`marker-${row.strike}`} className="chain-reference-row"><td colSpan={3}>
            Referencia {referenceSource==='DEMO_SYNTHETIC'?'sintética':referenceSource==='ALPACA_IEX_LAST_COMPLETE_BAR'?'IEX aproximada':'IBKR observada'}: {dollars(referencePrice)}</td></tr>);
          result.push(<tr key={row.strike} className="chain-strike-row">
            <td className="chain-call-cell">{side==='PUT'?<span className="chain-side-empty">CALL oculto</span>:<ChainCell row={onlyMatching&&economicActive&&!matches(row.call)?null:row.call}
              hiddenByFilter={onlyMatching&&economicActive&&!!row.call&&!matches(row.call)}
              issue={row.issues.find(item=>item.right==='CALL')} right="CALL"
              now={now} referenceSource={referenceSource} referencePrice={referencePrice} visual={visual}
              config={economicActive?economicConfig:null}
              selected={!!row.call&&selected.includes(row.call.conId)} compareDisabled={!!row.call&&!selected.includes(row.call.conId)&&selected.length>=4}
              onAnalyze={()=>{if(row.call){setAnalysisConId(row.call.conId);setAnalysisPinned(false);setTarget(null);}}}
              onCompare={()=>row.call&&setSelected(ids=>toggleComparison(ids,row.call!.conId))}/>}</td>
            <td className="options-strike-cell"><strong>{dollars(row.strike)}</strong><small>Ejercicio</small>
              {row.replacementFor?<small>Consulta adicional por {row.replacementFor.right} {dollars(row.replacementFor.requestedStrike)} no encontrado</small>:null}</td>
            <td className="chain-put-cell">{side==='CALL'?<span className="chain-side-empty">PUT oculto</span>:<ChainCell row={onlyMatching&&economicActive&&!matches(row.put)?null:row.put}
              hiddenByFilter={onlyMatching&&economicActive&&!!row.put&&!matches(row.put)}
              issue={row.issues.find(item=>item.right==='PUT')} right="PUT"
              now={now} referenceSource={referenceSource} referencePrice={referencePrice} visual={visual}
              config={economicActive?economicConfig:null}
              selected={!!row.put&&selected.includes(row.put.conId)} compareDisabled={!!row.put&&!selected.includes(row.put.conId)&&selected.length>=4}
              onAnalyze={()=>{if(row.put){setAnalysisConId(row.put.conId);setAnalysisPinned(false);setTarget(null);}}}
              onCompare={()=>row.put&&setSelected(ids=>toggleComparison(ids,row.put!.conId))}/>}</td></tr>);
          return result;
        }):<tr><td colSpan={3} className="empty">{rows.length&&onlyMatching?'Ninguno de los contratos consultados coincide con todos los filtros evaluables. Desactive el filtro para ver los no evaluables.':
          q.isLoading?'Consultando vencimientos y contratos…':q.error?
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
      <p className="options-chain-foot">Hasta {levels*(side==='BOTH'?2:1)} definiciones iniciales y dos intentos adicionales de resolución solo ante NOT_FOUND; límite global de 10 suscripciones
        compartidas con Radar y comparador. Contrato validado ≠ cotización OPRA disponible.
        {q.data?.referenceSource==='ALPACA_IEX_LAST_COMPLETE_BAR'?' El cierre IEX es una vela observada, no un tick actual.':''}</p>
    </Card>
    {analysisConId!==null?<>{analysisPinned?<p className="options-pinned-note">Análisis fijado desde el comparador, independiente del filtro de la cadena. Verifique tipo y vencimiento del contrato.</p>:null}
      <ContractDetail key={analysisConId} conId={analysisConId} mode={mode} nowMs={now}
        defaults={economicConfig}
        candidateId={!analysisPinned&&target?.conId===analysisConId?target.candidateId:undefined}
        onClose={()=>setAnalysisConId(null)}/></>:null}
    <section className="options-comparison"><button type="button" className="chain-comparison-toggle" aria-expanded={comparisonOpen}
      onClick={()=>setComparisonOpen(value=>!value)}>Comparar contratos ({selected.length}/4) {comparisonOpen?'▾':'▸'}</button>
      {comparisonOpen?<Card><p>Hasta cuatro contratos fijados. Distintos strikes, lados, vencimientos, horas o feeds no son escenarios directamente equivalentes.
        Costos brutos para {economicConfig?.quantity??1} contrato(s); comisiones desconocidas excluidas.</p>
        {selected.length>1?<p className="subtle">Diferencias descriptivas entre datos disponibles: costo bruto {comparisonRanges.cost} USD;
          spread {comparisonRanges.spread}; DTE {comparisonRanges.dte}; distancia a referencia {comparisonRanges.distance} USD.
          No se elige automáticamente un contrato.</p>:null}
        {selected.length?<><p className="subtle">En pantallas estrechas, deslice la tabla horizontalmente para ver todas las columnas.</p>
          <div className="table-wrap"><table aria-label="Comparador de opciones"><thead><tr><th>Contrato</th><th>Vencimiento</th>
          <th>DTE</th><th>BID</th><th>ASK</th><th>Spread %</th><th>Costo bruto</th><th>Pérdida máxima bruta</th>
          <th>Capital %</th><th>Equilibrio</th><th>Distancia a referencia</th><th>Calidad / feed / hora</th><th>Acción</th></tr></thead>
          <tbody>{selected.map(id=><ComparisonRow key={id} conId={id} mode={mode} nowMs={now}
            config={economicConfig} referencePrice={referencePrice} referenceSource={referenceSource}
            onAnalyze={()=>{setAnalysisConId(id);setAnalysisPinned(true);}} onRemove={()=>setSelected(ids=>toggleComparison(ids,id))} onUpdate={updateComparison}/>)}</tbody></table></div></>
          :<p className="subtle">Seleccione contratos de la cadena para comparar.</p>}
        <div className="options-comparison-hidden" aria-hidden="true">{Object.keys(selectedRows).length} cotizaciones cargadas</div>
      </Card>:null}</section>
    <Card className="options-disclaimer"><strong>Consulta de solo lectura</strong><p>La prima ASK es por acción y el costo usa el multiplicador del contrato.
      Resolver una definición no acredita permisos de cotización ni garantiza ejecución. El simulador requiere una decisión manual.</p></Card>
  </div>;
}
