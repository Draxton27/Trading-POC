import {useState,type ChangeEvent} from 'react';
import {useQuery} from '@tanstack/react-query';
import type {IexProspectiveCoverage,IexProspectiveDetail,IexProspectiveHistory,IexProspectiveMetrics,IexProspectiveOverview,
  IexProspectiveScore,IexProbabilities} from '@trading-poc/contracts';
import {api,dateTime,fmt} from '../../lib/api.ts';
import {Badge,Button,Card} from '../../components/ui.tsx';

const names=['ALCISTA','BAJISTA','LATERAL'] as const;
const percent=(n:number|null|undefined)=>n==null?'N/D':`${fmt(n*100,1)} %`;
function Probabilities({values}:{values:IexProbabilities}){
  return <div className="iex-probabilities">{names.map(name=><div key={name}><span>{name}</span>
    <div className="iex-probability-track" role="img" aria-label={`${name}: ${percent(values[name])}`}>
      <span style={{width:`${values[name]*100}%`}}/></div><strong>{percent(values[name])}</strong></div>)}</div>;
}
function scoreRows(score:IexProspectiveScore|null){
  if(!score)return null;
  return <><tr><td>Accuracy</td><td>{percent(score.accuracy)}</td></tr>
    <tr><td>Balanced accuracy</td><td>{percent(score.balancedAccuracy)}</td></tr>
    <tr><td>Macro F1</td><td>{fmt(score.macroF1,3)}</td></tr>
    <tr><td>Log loss</td><td>{fmt(score.logLoss,3)}</td></tr>
    <tr><td>Brier multiclase</td><td>{fmt(score.brier,3)}</td></tr>
    <tr><td>BAJISTA · precision / recall / F1</td><td>{score.perClass.BAJISTA.support?
      `${percent(score.perClass.BAJISTA.precision)} / ${percent(score.perClass.BAJISTA.recall)} / ${fmt(score.perClass.BAJISTA.f1,3)}`:'N/D (sin desenlaces BAJISTA)'}</td></tr>
    <tr><td>BAJISTA · ROC-AUC / PR-AUC / prevalencia</td><td>{score.bearishRocAuc==null?'N/D':fmt(score.bearishRocAuc,3)} / {score.bearishAveragePrecision==null?'N/D':fmt(score.bearishAveragePrecision,3)} / {percent(score.bearishPrevalence)}</td></tr></>;
}
export default function IexProspectiveDashboard({freshness}:{freshness?:string}){
  const [offset,setOffset]=useState(0),[from,setFrom]=useState(''),[to,setTo]=useState('');
  const [dominantClass,setDominantClass]=useState(''),[actualClass,setActualClass]=useState(''),[evaluationStatus,setEvaluationStatus]=useState('');
  const [evaluatedOnly,setEvaluatedOnly]=useState(false),[selected,setSelected]=useState<string|null>(null);
  const overview=useQuery<IexProspectiveOverview>({queryKey:['iex-prospective-overview'],queryFn:()=>api('/ml/iex/prospective/overview'),refetchInterval:30_000,retry:false});
  const coverage=useQuery<IexProspectiveCoverage>({queryKey:['iex-prospective-coverage'],queryFn:()=>api('/ml/iex/prospective/coverage'),refetchInterval:60_000,retry:false});
  const metrics=useQuery<IexProspectiveMetrics>({queryKey:['iex-prospective-metrics'],queryFn:()=>api('/ml/iex/prospective/metrics'),refetchInterval:120_000,retry:false});
  const newest=useQuery<IexProspectiveHistory>({queryKey:['iex-prospective-latest'],
    queryFn:()=>api('/ml/iex/prospective/history?symbol=NVDA&timeframe=15m&offset=0&limit=1'),refetchInterval:30_000,retry:false});
  const filters=new URLSearchParams({symbol:'NVDA',timeframe:'15m',offset:String(offset),limit:'25'});
  if(from)filters.set('from',from);if(to)filters.set('to',to);if(dominantClass)filters.set('dominantClass',dominantClass);
  if(actualClass)filters.set('actualClass',actualClass);
  if(evaluationStatus)filters.set('evaluationStatus',evaluationStatus);if(evaluatedOnly)filters.set('evaluatedOnly','true');
  const history=useQuery<IexProspectiveHistory>({queryKey:['iex-prospective-history',offset,from,to,dominantClass,actualClass,evaluationStatus,evaluatedOnly],
    queryFn:()=>api(`/ml/iex/prospective/history?${filters}`),refetchInterval:60_000,retry:false});
  const detail=useQuery<{status:string;item:IexProspectiveDetail}>({queryKey:['iex-prospective-detail',selected],
    queryFn:()=>api(`/ml/iex/prospective/history/${selected}`),enabled:!!selected,retry:false});
  const current=overview.data,latest=newest.data?.items[0],report=metrics.data,score=report?.scores;
  const setFilter=(setter:(value:string)=>void)=>(event:ChangeEvent<HTMLInputElement|HTMLSelectElement>)=>{setter(event.target.value);setOffset(0);setSelected(null);};
  return <section aria-label="Dashboard prospectivo IEX" className="iex-prospective-dashboard">
    <Card className="ml-warning" role="note"><strong>IEX Live · 41I v2 · modelo experimental. Evaluación prospectiva observacional;
      probabilidades no calibradas para uso operativo. No constituye señal ni recomendación CALL o PUT.</strong></Card>
    <Card><div className="iex-heading"><h2>Predicciones prospectivas IEX</h2><Badge tone="warning">EXPERIMENTAL</Badge></div>
      {overview.isPending?<p role="status">Verificando protocolo y ledgers IEX…</p>:overview.isError?
        <p role="alert">No se pudo leer el estado prospectivo.</p>:<>
        <p className="subtle">{current?.reason}</p>
        {current?.status==='INVALID_ARTIFACT'&&<p role="alert">Artefactos prospectivos inválidos. No se muestran predicciones.</p>}
        {current?.status==='UNAVAILABLE'&&<p role="status">Protocolo o modelo IEX no disponible en esta instalación.</p>}
        {current?.status==='NO_PROSPECTIVE_DATA'&&<p role="status">Todavía no existen predicciones prospectivas verificadas.</p>}
        <div className="ml-facts">
          <div><small>Estado / evidencia</small><strong>{current?.status??'N/D'} · {current?.evidenceStatus??'N/D'}</strong></div>
          <div><small>Modelo / protocolo</small><strong>{current?.modelLabel??'N/D'} · {current?.protocolVersion??'N/D'}</strong></div>
          <div><small>Activación</small><strong>{dateTime(current?.activatedAtUtc)}</strong></div>
          <div><small>Fuente</small><strong>NVDA · IEX Live · 15m · raw</strong></div>
          <div><small>Predicciones</small><strong>{current?.predictions??0}</strong></div>
          <div><small>Evaluadas / pendientes / vencidas</small><strong>{current?.evaluated??0} / {current?.pending??0} / {current?.overdue??0}</strong></div>
          <div><small>No evaluables</small><strong>{current?.nonEvaluable??0}</strong></div>
          <div><small>Sesiones con resultados</small><strong>{current?.sessionsWithResults??0}</strong></div>
          <div><small>Último registro</small><strong>{dateTime(current?.lastPredictionAtUtc)}</strong></div>
          <div><small>Última evaluación</small><strong>{dateTime(current?.lastEvaluationAtUtc)}</strong></div>
          <div><small>Mercado</small><strong>{current?.marketStatus??'N/D'}</strong></div>
          <div><small>Cobertura de velas completas</small><strong>{percent(current?.coverage)} ({current?.receivedCompleteBars??'N/D'} / {current?.expectedCompleteBars??'N/D'})</strong></div>
        </div>
        {current?.marketStatus==='MARKET_CLOSED'&&<p role="status">Mercado cerrado según el calendario oficial almacenado; no se esperan nuevas velas regulares ahora.</p>}
        {current?.marketStatus==='OPEN'&&freshness==='STALE'&&<p role="status">STALE_DATA: la última recepción Live está obsoleta. No se infiere ninguna nueva predicción desde esta pantalla.</p>}
        {!!current?.pending&&<p role="status">PENDING_EVALUATION: {current.pending} desenlace(s) aún no evaluado(s).</p>}
        {latest&&<div className="iex-latest"><h3>Última predicción de la cohorte</h3><p>Vela {dateTime(latest.barStartUtc)} · recibida {dateTime(latest.receivedAtUtc)} · registrada {dateTime(latest.registeredAtUtc)} · clase XGBoost {latest.dominantClass} · estado {latest.evaluationStatus}.</p>
          <div className="iex-score-grid">{(['xgboost','linear','frequency'] as const).map(name=><div key={name}>
            <h4>{name==='xgboost'?'XGBoost 38F':name==='linear'?'Regresión logística':'Frecuencia histórica'}</h4>
            <Probabilities values={latest.probabilities[name]}/></div>)}</div>
          <p className="subtle">Referencia de entrada {dateTime(latest.entryAtUtc)}; desenlace {dateTime(latest.outcomeAtUtc)}. Aperturas OHLC no garantizan ejecuciones.</p></div>}
      </>}</Card>
    <Card><h3>Historial prospectivo registrado</h3><p className="subtle">Solo predicciones enlazadas al protocolo 41I v2. Los filtros y la paginación se aplican en el servidor.</p>
      <div className="iex-filters"><label>Desde NY<input type="date" value={from} onChange={setFilter(setFrom)}/></label>
        <label>Hasta NY<input type="date" value={to} onChange={setFilter(setTo)}/></label>
        <label>Clase dominante<select value={dominantClass} onChange={setFilter(setDominantClass)}><option value="">Todas</option>{names.map(name=><option key={name}>{name}</option>)}</select></label>
        <label>Clase real<select value={actualClass} onChange={setFilter(setActualClass)}><option value="">Todas</option>{names.map(name=><option key={name}>{name}</option>)}</select></label>
        <label>Evaluación<select value={evaluationStatus} onChange={setFilter(setEvaluationStatus)}><option value="">Todas</option>
          {['PENDING','OVERDUE_UNEVALUATED','EVALUATED','MISSING_ENTRY','MISSING_OUTCOME'].map(name=><option key={name}>{name}</option>)}</select></label>
        <label><input type="checkbox" checked={evaluatedOnly} onChange={event=>{setEvaluatedOnly(event.target.checked);setOffset(0);}}/> Solo evaluadas</label></div>
      {history.isPending?<p role="status">Cargando historial…</p>:history.isError?<p role="alert">No se pudo consultar el historial IEX.</p>:
        <><div className="table-wrap"><table aria-label="Predicciones prospectivas IEX"><thead><tr><th>Sesión NY / vela UTC</th><th>Registro NY</th>
          <th>ALCISTA</th><th>BAJISTA</th><th>LATERAL</th><th>Dominante</th><th>Resultado</th><th>Estado</th><th>Detalle</th></tr></thead>
          <tbody>{history.data?.items.map(item=><tr key={item.predictionId}><td>{item.sessionDateNy}<br/>{item.barStartUtc}</td><td>{dateTime(item.registeredAtUtc)}</td>
            <td>{percent(item.probabilities.xgboost.ALCISTA)}</td><td>{percent(item.probabilities.xgboost.BAJISTA)}</td>
            <td>{percent(item.probabilities.xgboost.LATERAL)}</td><td>{item.dominantClass}</td><td>{item.actualClass??'N/D'}</td>
            <td>{item.evaluationStatus}</td><td><Button variant="secondary" onClick={()=>setSelected(item.predictionId)}>Ver</Button></td></tr>)}
            {!history.data?.items.length&&<tr><td colSpan={9}>No hay predicciones para este período y filtros.</td></tr>}</tbody></table></div>
          <div className="ml-pagination"><span>{history.data?.total??0} observaciones</span>
            <Button variant="secondary" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-25))}>Anterior</Button>
            <Button variant="secondary" disabled={history.data?.nextOffset==null} onClick={()=>setOffset(history.data!.nextOffset!)}>Siguiente</Button></div></>}
      {selected&&<div className="iex-detail"><h3>Detalle verificable</h3>{detail.isPending?<p>Cargando…</p>:detail.isError?<p role="alert">No se pudo comprobar el registro seleccionado.</p>:<><div className="ml-facts">
        <div><small>Predicción / registro</small><strong>{detail.data?.item.predictionId} / {detail.data?.item.predictionRecordHash}</strong></div>
        <div><small>Modelo / protocolo</small><strong title={detail.data?.item.modelSha256}>{detail.data?.item.modelSha256.slice(0,12)}…</strong><strong title={detail.data?.item.protocolSha256}>{detail.data?.item.protocolSha256.slice(0,12)}…</strong></div>
        <div><small>Variables SHA</small><strong>{detail.data?.item.featureHash}</strong></div>
        <div><small>ATR14</small><strong>{fmt(detail.data?.item.atr14PriceUnits,3)}</strong></div>
        <div><small>Apertura / cierre observados</small><strong>{fmt(detail.data?.item.entryOpen,3)} / {fmt(detail.data?.item.outcomeClose,3)}</strong></div>
        <div><small>Movimiento / ATR</small><strong>{fmt(detail.data?.item.movementAtr,3)}</strong></div>
        <div><small>Velas fuente causales</small><strong>{detail.data?.item.sourceBarCount??0} (últimas {detail.data?.item.sourceBars.length??0} visibles)</strong></div></div>
        <p className="subtle">Última fuente verificada: {detail.data?.item.sourceBars.at(-1)?.origin??'N/D'} · versión SHA {detail.data?.item.sourceBars.at(-1)?.recordHash??'N/D'}.</p>
        <div className="table-wrap"><table aria-label="Comparación pareada de modelos IEX"><thead><tr><th>Modelo</th><th>ALCISTA</th><th>BAJISTA</th><th>LATERAL</th><th>Clase argmax</th><th>Coincide con real</th></tr></thead>
          <tbody>{(['xgboost','linear','frequency'] as const).map(name=>{
            const row=detail.data!.item.probabilities[name],dominant=names.reduce((best,next)=>row[next]>row[best]?next:best,'ALCISTA' as typeof names[number]);
            const match=detail.data!.item.matches[name];
            return <tr key={name}><td>{name}</td><td>{percent(row.ALCISTA)}</td><td>{percent(row.BAJISTA)}</td>
              <td>{percent(row.LATERAL)}</td><td>{dominant}</td><td>{match===null?'N/D':match?'Sí':'No'}</td></tr>;})}</tbody></table></div>
        <p>Estado: {detail.data?.item.evaluationStatus}; clase real: {detail.data?.item.actualClass??'PENDIENTE / NO EVALUABLE'}.
          Recepción: {dateTime(detail.data?.item.receivedAtUtc)}; registro: {dateTime(detail.data?.item.registeredAtUtc)};
          entrada de referencia: {dateTime(detail.data?.item.entryAtUtc)}; final del horizonte: {dateTime(detail.data?.item.outcomeAtUtc)}.</p>
        <p className="subtle">Las versiones de origen y su integridad se verifican localmente antes de mostrar este detalle. La predicción no es una orden ni un fill.</p></>}</div>}</Card>
    <Card><h3>Cobertura y abstenciones 41I</h3>{coverage.isPending?<p>Cargando cobertura…</p>:coverage.isError?
      <p role="alert">No se pudo consultar la cobertura.</p>:<><div className="ml-facts">
      <div><small>Decisiones / velas únicas</small><strong>{coverage.data?.decisionRecords??0} / {coverage.data?.candidateBars??0}</strong></div>
      <div><small>Admitidas / no admitidas</small><strong>{coverage.data?.admittedBars??0} / {coverage.data?.finallyNotAdmitted??0}</strong></div>
      <div><small>Intentos fallidos antes de recuperación</small><strong>{coverage.data?.failedAttemptsBeforeRecovery??0}</strong></div>
      <div><small>Sesiones con captura / programadas</small><strong>{coverage.data?.sessionsWithCapture??'N/D'} / {coverage.data?.scheduledSessions??'N/D'}</strong></div>
      </div><p>{Object.entries(coverage.data?.abstentionsByReason??{}).map(([name,count])=>`${name}: ${count}`).join(' · ')||'Sin abstenciones finales registradas.'}</p>
      <p className="subtle">{coverage.data?.reason}</p></>}</Card>
    <Card><h3>Evaluación comparativa · misma cohorte</h3>{metrics.isPending?<p>Cargando métricas…</p>:metrics.isError?
      <p role="alert">No se pudo consultar el reporte 41I.</p>:<>
      <p className="subtle">{report?.warning} Snapshot: {report?.snapshotStatus??'N/D'} · {dateTime(report?.generatedAtUtc)} · {report?.evaluatedInSnapshot??0} evaluaciones.</p>
      {report?.snapshotStatus==='INVALID_ARTIFACT'&&<p role="alert">Reporte alterado o incompatible: métricas ocultas.</p>}
      {!score&&<p role="status">Aún no hay métricas prospectivas verificadas para comparar.</p>}
      {score&&<div className="iex-score-grid">{(['xgboost','linear','frequency'] as const).map(name=><div key={name}><h4>{name==='xgboost'?'XGBoost 38F':name==='linear'?'Regresión logística':'Frecuencia'}</h4>
        <table aria-label={`Métricas prospectivas ${name}`}><tbody>{scoreRows(score[name])}</tbody></table>
        <p className="subtle">Matriz de confusión · filas reales ALCISTA / BAJISTA / LATERAL; columnas predichas.</p>
        <table aria-label={`Matriz de confusión ${name}`}><thead><tr><th>Real</th>{names.map(label=><th key={label}>{label}</th>)}</tr></thead>
          <tbody>{score[name].confusionMatrix.map((row,index)=><tr key={names[index]}><th>{names[index]}</th>{row.map((count,column)=><td key={column}>{count}</td>)}</tr>)}</tbody></table></div>)}</div>}
      <p className="subtle">BAJISTA con soporte cero: precisión/recall/F1 no estimables. Los resultados son descriptivos y dependen de cobertura y tamaño de muestra; no constituyen evidencia independiente suficiente.</p>
      </>}</Card>
  </section>;
}
