import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import type {OpportunityCase,OpportunityCasePage,OpportunityRadarStatus} from '@trading-poc/contracts';
import {api,dateTime} from '../../lib/api.ts';
import {Badge,Card} from '../../components/ui.tsx';

type Case=OpportunityCase;
export type OpportunityContractTarget={conId:number;right:'CALL'|'PUT';strike:number;expiration:string;candidateId?:string};
const money=(value:number|null)=>value===null?'N/D':`$${value.toFixed(2)}`;
const pct=(value:number|null)=>value===null?'N/D':`${value.toFixed(2)} %`;
const title=(value:string)=>value.replaceAll('_',' ');

function Candidate({item,onNavigate}:{item:Case;onNavigate?:(view:'Opciones'|'Simulador Paper',target?:OpportunityContractTarget)=>void}){
  const candidate=item.candidate,latestUpdate=item.technicalUpdates.at(-1),scenario=latestUpdate?.scenario??candidate.scenario;
  return <Card><h4>NVDA · hipótesis {candidate.directionHypothesis} · {title(scenario.family)}</h4>
    <p>Detectado {dateTime(item.registeredAtUtc)}; vela {dateTime(candidate.barStartUtc)}–{dateTime(candidate.barEndUtc)}.
      Evidencia recibida {dateTime(candidate.technicalEvidenceAvailableAtUtc)}. Estado: <strong>{title(item.currentStatus)}</strong>.</p>
    {latestUpdate&&<p>Actualización técnica posterior {dateTime(latestUpdate.observedAtUtc)}: {latestUpdate.scenarioState}.
      El snapshot inicial conserva {candidate.scenario.state}.</p>}
    <p>Evento {scenario.trigger.description}. SMA {scenario.period??'N/D'} · temporalidad {scenario.timeframe}.
      15m / 1h / 1d: {(['15m','1h','1d'] as const).map(frame=>`${frame} ${scenario.context?.frames[frame].state??'N/D'}`).join(' · ')}.</p>
    <p>Confirmaciones: {scenario.confirmations.map(value=>value.description).join('; ')||'N/D'}.
      Contradicciones: {scenario.contradictions.map(value=>value.detail).join('; ')||'N/D'}.</p>
    <p>Fuente: {candidate.marketSource} · {candidate.marketFeed} · {candidate.adjustment} · calentamiento {candidate.warmup}.
      Primera versión IEX: {candidate.sourceBarHash.slice(0,12)}…</p>
    {item.model&&<p>Contexto experimental XGBoost registrado antes del candidato: ALCISTA {(item.model.probabilities.xgboost.ALCISTA*100).toFixed(1)} %, BAJISTA {(item.model.probabilities.xgboost.BAJISTA*100).toFixed(1)} %, LATERAL {(item.model.probabilities.xgboost.LATERAL*100).toFixed(1)} %.
      Registro {dateTime(item.model.registeredAtUtc)} · modelo {item.model.modelSha256.slice(0,12)}… No estima rentabilidad de opciones.</p>}
    <h5>Contratos asociados</h5>
    {!item.contracts.length&&<p>Contrato y cotización pendientes o no disponibles. La hipótesis técnica permanece registrada sin precio de opción.</p>}
    {item.contractAttempts.length>0&&<p>Consultas acotadas IBKR: {item.contractAttempts.map(value=>`${value.code} (${dateTime(value.attemptAtUtc)})`).join(' · ')}.</p>}
    {item.contracts.length>0&&<div className="table-wrap"><table aria-label="Contratos de oportunidad"><thead><tr><th>Contrato</th><th>Strike / vencimiento</th><th>BID / ASK</th><th>Spread</th><th>Costo / pérdida máxima</th><th>Break-even</th><th>Calidad</th><th>Investep</th><th>Revisión</th></tr></thead><tbody>
      {item.contracts.map((contract,i)=><tr key={`${contract.conId}-${i}`}><td>{contract.conId} · {contract.contract.occSymbol??'OCC N/D'}</td>
        <td>{money(contract.contract.strike)} · {contract.analysis.expiration.expirationDate??'N/D'} · DTE {contract.analysis.expiration.daysCalendar??'N/D'}</td>
        <td>{money(contract.quoteSnapshot.bid)} / {money(contract.quoteSnapshot.ask)} · tamaños {contract.quoteSnapshot.bidSize??'N/D'}/{contract.quoteSnapshot.askSize??'N/D'}</td>
        <td>{money(contract.analysis.spread.absolutePerShareUsd)} · {pct(contract.analysis.spread.percentOfMidpoint)}</td>
        <td>{money(contract.analysis.premium.grossPremiumUsd)} / {money(contract.analysis.premium.maximumPremiumLossUsd)} · máximo con capital hipotético {contract.analysis.capital.maximumWholeContracts??'N/D'}</td>
        <td>{money(contract.analysis.premium.breakEvenGrossUsd)}</td>
        <td>{contract.analysis.quote.status} · {contract.analysis.quote.askCurrentVerified?'ASK verificable':'ASK no verificable'}</td>
        <td>{contract.analysis.academy?.referenceStatus??'NONE'} · ASK {contract.analysis.academy?.minAskCents==null?'N/D':money(contract.analysis.academy.minAskCents/100)}–{contract.analysis.academy?.maxAskCents==null?'N/D':money(contract.analysis.academy.maxAskCents/100)}</td>
        <td><button type="button" disabled={!contract.contract.right||contract.contract.strike===null||!contract.contract.expiration} onClick={()=>{
          if(contract.contract.right&&contract.contract.strike!==null&&contract.contract.expiration)
            onNavigate?.('Opciones',{conId:contract.conId,right:contract.contract.right,
              strike:contract.contract.strike,expiration:contract.contract.expiration,
              candidateId:candidate.candidateId});
        }}>Revisar conId {contract.conId}</button></td></tr>)}</tbody></table></div>}
    <p>Limitaciones: {[...candidate.exclusionReasons,...item.technicalUpdates.flatMap(u=>u.exclusionReasons),...item.contracts.flatMap(c=>c.exclusionReasons)].join(' ')||'Sin información adicional.'}</p>
    <p>Desenlace del subyacente: {item.underlyingOutcome?`${pct(item.underlyingOutcome.movementPercent)} al ${dateTime(item.underlyingOutcome.outcomeEndUtc)}`:'pendiente o no evaluable'}.
      Desenlace económico de la opción: {item.optionOutcome}. Una vela NVDA no representa el P&amp;L del contrato.</p>
    <div className="toolbar"><button type="button" onClick={()=>onNavigate?.('Opciones')}>Abrir Opciones</button>{' '}
      <button type="button" onClick={()=>onNavigate?.('Simulador Paper')}>Abrir simulador manual</button></div>
  </Card>;
}

export default function OpportunityRadar({onNavigate}:{onNavigate?:(view:'Opciones'|'Simulador Paper',target?:OpportunityContractTarget)=>void}){
  const [offset,setOffset]=useState(0),[capital,setCapital]=useState('');
  const capitalParam=capital.trim()!==''&&Number.isFinite(Number(capital))&&Number(capital)>=0&&Number(capital)<=1e12?
    `&capitalUsd=${encodeURIComponent(capital)}`:'';
  const status=useQuery<OpportunityRadarStatus>({queryKey:['opportunity-status'],
    queryFn:()=>api('/radar/opportunities/status'),refetchInterval:10_000});
  const current=useQuery<OpportunityCasePage>({queryKey:['opportunity-current',capitalParam],
    queryFn:()=>api(`/radar/opportunities/current?limit=10${capitalParam}`),refetchInterval:10_000});
  const history=useQuery<OpportunityCasePage>({queryKey:['opportunity-history',offset,capitalParam],
    queryFn:()=>api(`/radar/opportunities/history?limit=10&offset=${offset}${capitalParam}`),refetchInterval:10_000});
  return <section aria-label="Oportunidades Paper"><h2>Oportunidades Paper</h2>
    <p>Radar experimental para revisión humana. No crea órdenes ni entradas del simulador.</p>
    {status.isPending&&<Card role="status">Consultando estado IEX y del registro…</Card>}
    {(status.isError||current.isError||history.isError)&&<Card role="alert">No se pudieron verificar los registros de oportunidades. No se muestran candidatos como válidos.</Card>}
    {status.data&&<Card><h3>Radar de oportunidades</h3><p><Badge tone={status.data.status==='AVAILABLE'?'success':'warning'}>{status.data.status}</Badge>{' '}
      IEX {status.data.collectorStatus??'N/D'} · última vela {dateTime(status.data.lastCompleteBarEndUtc)} · recibida {dateTime(status.data.lastCompleteReceivedAtUtc)} · edad {status.data.ageMinutes?.toFixed(1)??'N/D'} min.</p>
      <p>IBKR {status.data.ibkrConnected?'conectado':'desconectado'}{status.data.ibkrSimulation?' · simulado':''}. {status.data.quoteVerification}</p>
      <p>{status.data.limitations.join(' ')}</p></Card>}
    {status.data?.mode==='DEMO'&&<Card><h3>Escenarios de demostración</h3>
      <p>Fixtures sintéticos aislados. No son candidatos reales, no tienen precios de opciones y no se registran en el ledger.</p>
      <ul>{[
        ['CALL','TECHNICAL_CANDIDATE','Cruce SMA observado; contrato pendiente.'],
        ['PUT','TECHNICAL_CANDIDATE','Rechazo SMA observado; contrato pendiente.'],
        ['CALL','AWAITING_CONFIRMATION','Retesteo aún sin confirmar.'],
        ['PUT','CONTRADICTORY_CONTEXT','Temporalidades contradictorias.'],
        ['CALL','CONTRACT_QUOTE_UNVERIFIED','Hora de mercado BID/ASK ausente.'],
        ['PUT','CONTRACT_CONSTRAINT_FAILED','Permisos OPRA insuficientes.'],
        ['—','NO_CANDIDATE','No se detectó un evento nuevo.'],
        ['—','STALE_MARKET_DATA','Última vela obsoleta.']
      ].map(([side,state,reason],i)=><li key={i}>{side} · {title(state!)} · {reason}</li>)}</ul></Card>}
    <label htmlFor="opportunity-capital">Capital hipotético opcional (USD) </label>
    <input id="opportunity-capital" type="number" min="0" max="1000000000000" value={capital} onChange={event=>setCapital(event.target.value)}/>
    <p>El análisis usa Fase 41L. No consulta saldo IBKR ni incluye comisiones desconocidas.</p>
    <h3>Candidatos técnicos</h3>{current.data?.items.length?current.data.items.map(item=><Candidate key={item.candidate.candidateId} item={item} onNavigate={onNavigate}/>):
      <Card>Sin candidatos prospectivos actuales. El sistema no fabrica señales cuando faltan velas, historial o conexión.</Card>}
    <h3>Historial</h3>{history.data?.items.length?<><p>{history.data.total} candidato(s) registrados.</p>
      {history.data.items.map(item=><Candidate key={item.candidate.candidateId} item={item} onNavigate={onNavigate}/>)}
      <button type="button" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-10))}>Anterior</button>{' '}
      <button type="button" disabled={history.data.nextOffset===null} onClick={()=>setOffset(history.data!.nextOffset!)}>Siguiente</button></>:
      <Card>Sin candidatos registrados. Las consultas de esta vista no crean eventos.</Card>}
  </section>;
}
