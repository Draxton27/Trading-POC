import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import type {DecisionReviewSummary,DecisionReviewPage,DecisionReviewCase} from '@trading-poc/contracts';
import {api,dateTime,fmt} from '../../lib/api.ts';
import {Badge,Button,Card,SectionTitle} from '../../components/ui.tsx';

const base='/research/decision-review';
const money=(n:number|null|undefined)=>n==null?'N/D':`$${fmt(n)}`;
const pct=(n:number)=>`${fmt(n*100)}%`;
const verification=(value:string)=>({VERIFIED_AVAILABLE:'Disponible y verificado',CAUSALLY_RECONSTRUCTED:'Reconstruido causalmente',
  SELF_REPORTED_UNVERIFIED:'Declarado sin verificación',HISTORICAL_ONLY:'Solo histórico',UNAVAILABLE:'No disponible',
  INVALID_EVIDENCE:'Evidencia inválida'} as Record<string,string>)[value]??value;
const source=(value:string)=>({F17:'Decisiones humanas F17',F16:'Señales congeladas F16',F41M:'Simulador interno 41M',
  F41I:'Predicciones IEX 41I',F41K:'Contexto técnico 41K',BROKER:'Fills vinculados F17'} as Record<string,string>)[value]??value;

function Detail({id}:{id:string}){
  const detail=useQuery<DecisionReviewCase>({queryKey:['decision-review',id],queryFn:()=>api(`${base}/cases/${encodeURIComponent(id)}`)});
  if(detail.isPending)return <Card><p>Reconstruyendo la evidencia de esta decisión...</p></Card>;
  if(detail.isError||!detail.data)return <Card role="alert">No se pudo verificar el caso. {detail.error?.message}</Card>;
  const c=detail.data,d=c.decisionTimeView.decision,prior=c.decisionTimeView,post=c.postOutcomeReview;
  return <div className="decision-review-detail">
    <Card><h3>{d.origin==='F17_HUMAN'?'Decisión humana F17':'Entrada hipotética 41M'}</h3>
      <p><strong>{d.direction}</strong> · {d.operationType} · decisión {dateTime(d.decisionAtUtc)} · documentada {dateTime(d.documentedAtUtc)}</p>
      <p>Clasificación: {d.classification} · contrato {d.contractOccSymbol??'N/D'} · cantidad {d.quantity??'N/D'} · prima {money(d.premiumPerShare)} por acción.</p>
      {d.simulatedEntryAtUtc&&<p>Entrada hipotética: {dateTime(d.simulatedEntryAtUtc)} · posición {d.positionId} · simulación {d.simulationId}. {d.contract?.right} {d.contract?.strike} vence {d.contract?.expiration}. Plan inicial: {d.plan?.entryReason??'N/D'}.</p>}
      {d.quoteReference&&<p>Referencia de cotización: {d.quoteReference.provider??'proveedor desconocido'} · {d.quoteReference.feedType} · {d.quoteReference.quality} · recibida {dateTime(d.quoteReference.receivedAtUtc)}.</p>}
      {d.chartCaptureId&&<p>Captura disponible al corte: {d.chartCaptureId} · {dateTime(d.chartCapturedAtUtc)}.</p>}
      <p>Origen del precio: {d.priceOrigin??'N/D'} · motivo: {d.reason??'N/D'}.</p>
      {d.linkedHumanDecisionId&&<p>Vínculo explícito con F17: {d.linkedHumanDecisionId}. Se conserva la identidad de ambas fuentes.</p>}
      <small>IDs de origen: {d.sourceIds.join(', ')}. Hashes: {d.sourceHashes.join(', ')||'N/D'}.</small>
    </Card>
    <section aria-label="Vista al momento de decidir"><Card><h3>Qué se sabía al decidir</h3>
      <p>Esta vista usa el corte {dateTime(d.decisionAtUtc)}. Evidencia histórica sin recepción verificada no se atribuye al operador.</p>
      {prior.model?<div><h4>Predicción IEX 41I · {verification(prior.model.evidence.verificationStatus)}</h4>
        <p>Vela cerrada {dateTime(prior.model.barEndUtc)} · registrada {dateTime(prior.model.registeredAtUtc)} · clase dominante {prior.model.dominantClass}.</p>
        <div className="stat-grid">{(['xgboost','linear','frequency'] as const).map(name=><div key={name}><strong>{name}</strong><p>ALCISTA {pct(prior.model!.probabilities[name].ALCISTA)} · BAJISTA {pct(prior.model!.probabilities[name].BAJISTA)} · LATERAL {pct(prior.model!.probabilities[name].LATERAL)}</p></div>)}</div>
        <small>Modelo {prior.model.modelSha256} · protocolo {prior.model.protocolSha256}. Asociación por la última predicción registrada dentro de los 15 minutos previos y la misma sesión NYSE. No demuestra que el operador la haya visto.</small></div>:
        <p>Predicción IEX: NONE. Sin asociación temporal válida.</p>}
      {prior.technical?<div><h4>Contexto Investep 41K · {verification(prior.technical.evidence.verificationStatus)}</h4>
        <p>Fuente {prior.technical.evidence.source} · {prior.technical.sourceFeed}/{prior.technical.adjustment} · alineación {prior.technical.alignment} · Bollinger {prior.technical.bollingerPosition??'N/D'}.</p>
        <div className="table-wrap"><table><thead><tr><th>Temporalidad</th><th>SMA 20/40</th><th>SMA 100/200</th><th>Estado</th><th>Última vela</th></tr></thead><tbody>{prior.technical.frames.map(frame=><tr key={frame.timeframe}><td>{frame.timeframe}</td><td>{frame.shortPair}</td><td>{frame.longPair}</td><td>{frame.state}</td><td>{dateTime(frame.barEndUtc)}</td></tr>)}</tbody></table></div>
        <p>Escenarios: {prior.technical.scenarios.length?prior.technical.scenarios.map(s=>`${s.family} ${s.direction} ${s.timeframe} SMA${s.period??'—'} ${s.state}`).join(' · '):'ninguno verificable al corte'}.</p>
        <small>{prior.technical.evidence.limitations.join(' ')}</small></div>:
        <p>Contexto 41K no disponible para este corte.</p>}
      {prior.humanContext&&<p>Contexto humano F17: {verification(prior.humanContext.verificationStatus)}. {prior.humanContext.limitations.join(' ')}</p>}
      {prior.signalComparison&&<p>Señal F16: {prior.signalComparison.status} · {prior.signalComparison.reason} {prior.signalComparison.signals.map(s=>`${s.family} ${s.direction}`).join(', ')}</p>}
      {prior.agreements.length>0&&<div><h4>Coincidencias descriptivas</h4><ul>{prior.agreements.map((a,i)=><li key={i}>{a.left} / {a.right}: {a.state}. {a.reason}</li>)}</ul></div>}
      {prior.missing.map((v,i)=><p key={i}>{v}</p>)}
      <small>{prior.limitations.join(' ')}</small>
    </Card></section>
    <section aria-label="Revisión posterior"><Card><h3>Qué sucedió después</h3>
      {post.modelOutcome?<p>Desenlace del modelo: {post.modelOutcome.status} · predijo {post.modelOutcome.predictedClass} · resultado {post.modelOutcome.actualClass??'pendiente'} · movimiento ATR {post.modelOutcome.movementAtr==null?'N/D':fmt(post.modelOutcome.movementAtr)} · evaluado {dateTime(post.modelOutcome.evaluatedAtUtc)}.</p>:
        <p>Sin desenlace del modelo asociado.</p>}
      {post.technicalLater.length?<p>Evolución técnica posterior: {post.technicalLater.map(s=>`${s.scenarioId} ${s.state}`).join(' · ')}</p>:<p>Sin evolución técnica posterior verificada en esta revisión.</p>}
      {post.tradeOutcome?<p>Resultado {post.tradeOutcome.source==='F41M_HYPOTHETICAL'?'hipotético interno':'broker vinculado'} ({post.tradeOutcome.scope}): {post.tradeOutcome.status}. Comprados {post.tradeOutcome.initialQuantity??'N/D'}, cerrados {post.tradeOutcome.closedQuantity??'N/D'}, restantes {post.tradeOutcome.remainingQuantity??'N/D'}. Primas de salida {post.tradeOutcome.exitPremiumsPerShare.length?post.tradeOutcome.exitPremiumsPerShare.map(money).join(', '):'N/D'}. Bruto realizado {money(post.tradeOutcome.realizedGrossUsd)}; neto {money(post.tradeOutcome.realizedNetUsd)}; comisiones conocidas {money(post.tradeOutcome.knownCommissionUsd)}.</p>:
        <p>Sin resultado económico vinculado. N/D no equivale a cero.</p>}
      {post.laterNotes.length>0&&<p>Anotaciones posteriores: {post.laterNotes.map(note=>`${note.kind} ${dateTime(note.recordedAtUtc)}: ${note.detail}`).join(' · ')}</p>}
      <small>{post.limitations.join(' ')}</small>
    </Card></section>
  </div>;
}

export default function DecisionReviewView(){
  const [offset,setOffset]=useState(0),[sourceFilter,setSourceFilter]=useState(''),[prediction,setPrediction]=useState(''),
    [technical,setTechnical]=useState(''),[selected,setSelected]=useState<string|null>(null);
  const params=new URLSearchParams({offset:String(offset),limit:'25'});
  if(sourceFilter)params.set('source',sourceFilter);
  if(prediction)params.set('hasPrediction',prediction);
  if(technical)params.set('hasTechnicalContext',technical);
  const summary=useQuery<DecisionReviewSummary>({queryKey:['decision-review-summary'],queryFn:()=>api(`${base}/summary`),
    staleTime:0,refetchOnMount:'always'});
  const page=useQuery<DecisionReviewPage>({queryKey:['decision-review-page',params.toString()],queryFn:()=>api(`${base}/cases?${params}`),
    staleTime:0,refetchOnMount:'always'});
  return <div className="content-page"><SectionTitle eyebrow="INVESTIGACIÓN · FASE 41N" title="Revisión de decisiones"/>
    <Card><p>Comparación retrospectiva y de solo lectura. Separamos lo disponible al decidir de lo observado después. Una coincidencia entre fuentes no demuestra causalidad ni recomienda CALL o PUT.</p>
      {summary.isPending?<p>Cargando fuentes verificadas...</p>:summary.isError?<p role="alert">No se pudo leer el resumen: {summary.error.message}</p>:
        summary.data&&<><p>Estado: <Badge tone={summary.data.status==='AVAILABLE'?'success':'warning'}>{summary.data.status}</Badge> · Decisiones {summary.data.totalDecisions} · F17 prospectivas elegibles {summary.data.prospectiveQualified} · 41M documentadas a tiempo {summary.data.documentedOnTimeSimulator} · históricas {summary.data.historicalDecisions} · DEMO {summary.data.syntheticDecisions}.</p>
          <p>Con ML válido {summary.data.withVerifiedMl} · contexto con recepción verificable {summary.data.withVerifiedTechnical} · contexto reconstruido causalmente {summary.data.withReconstructedTechnical} · contexto histórico sin recepción {summary.data.withHistoricalTechnical} · contexto ausente {summary.data.withUnavailableTechnical} · resultados vinculados {summary.data.withLinkedTradeOutcome} · vínculos explícitos F17/41M {summary.data.linkedHumanSimulatorPairs}.</p>
          <p>{Object.entries(summary.data.sourceStatus).map(([name,state])=>`${source(name)}: ${state}`).join(' · ')}</p>
          <small>{summary.data.limitations.join(' ')}</small></>}
    </Card>
    <Card><h3>Casos</h3><div className="form-grid">
      <label>Origen<select aria-label="Origen de decisiones" value={sourceFilter} onChange={e=>{setSourceFilter(e.target.value);setOffset(0);setSelected(null);}}><option value="">Todos</option><option value="F17_HUMAN">F17 humano</option><option value="F41M_SIMULATOR">41M hipotético</option></select></label>
      <label>Predicción<select aria-label="Predicción asociada" value={prediction} onChange={e=>{setPrediction(e.target.value);setOffset(0);setSelected(null);}}><option value="">Todas</option><option value="true">Con predicción</option><option value="false">Sin predicción</option></select></label>
      <label>Contexto técnico<select aria-label="Contexto técnico" value={technical} onChange={e=>{setTechnical(e.target.value);setOffset(0);setSelected(null);}}><option value="">Todos</option><option value="true">Con contexto</option><option value="false">Sin contexto</option></select></label>
    </div>
      {page.isPending?<p>Cargando casos...</p>:page.isError?<p role="alert">No se pudieron leer los casos: {page.error.message}</p>:
        page.data?.items.length?<><div className="table-wrap"><table><thead><tr><th>Decisión</th><th>Origen</th><th>Clasificación</th><th>Dirección</th><th>41K</th><th>41I</th><th>Resultado</th></tr></thead><tbody>{page.data.items.map(item=><tr key={item.id}><td><button type="button" onClick={()=>setSelected(item.id)}>{dateTime(item.decisionAtUtc)}</button></td><td>{item.origin}</td><td>{item.classification}</td><td>{item.direction}</td><td>{verification(item.technicalStatus)}</td><td>{item.predictionMatch}</td><td>{item.outcomeStatus}</td></tr>)}</tbody></table></div>
          <p>{page.data.total} casos · página desde {page.data.offset+1}</p><Button onClick={()=>{setOffset(Math.max(0,offset-25));setSelected(null);}} disabled={offset===0}>Anterior</Button> <Button onClick={()=>{setOffset(page.data!.nextOffset!);setSelected(null);}} disabled={page.data.nextOffset===null}>Siguiente</Button></>:
          <p>{page.data?.status==='NO_DECISIONS'?'Todavía no hay decisiones en los ledgers privados.':'No hay casos para estos filtros.'}</p>}
    </Card>
    {selected&&<Detail id={selected}/>}
  </div>;
}
