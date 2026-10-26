import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import type {RadarResponse} from '@trading-poc/contracts';
import {api,dateTime} from '../../lib/api.ts';
import {Badge,Card,SectionTitle} from '../../components/ui.tsx';
import TechnicalStructure from './TechnicalStructure.tsx';
import InvestepScenarios from './InvestepScenarios.tsx';

const price=(value:number|null)=>value===null?'N/D':`$${value.toFixed(2)}`;
const percent=(value:number|null)=>value===null?'N/D':`${value.toFixed(2)} %`;
const probability=(value:number|undefined)=>value===undefined?'N/D':`${(value*100).toFixed(1)} %`;
const cents=(value:number|null)=>value===null?'N/D':`$${(value/100).toFixed(2)}`;

export default function RadarView(){
  const [right,setRight]=useState<''|'CALL'|'PUT'>('');
  const radar=useQuery<RadarResponse>({queryKey:['radar',right],queryFn:()=>api(`/radar${right?`?right=${right}`:''}`),refetchInterval:60_000});
  return <div className="content-page"><SectionTitle eyebrow="INVESTIGACIÓN DESCRIPTIVA" title="Radar de Mercado" aside={<Badge tone="warning">Solo lectura</Badge>}/>
    <p className="lead">NVDA, QQQ y SMH según fuentes locales verificables. El cierre y las probabilidades registradas tienen tiempos y procedencias diferentes.</p>
    {radar.isPending&&<Card role="status">Cargando fuentes del radar…</Card>}
    {radar.isError&&<Card role="alert">No se pudo consultar el radar. Revise la disponibilidad de los datos locales.</Card>}
    {radar.data&&<>
      <Card><h3>Resumen comparativo</h3><p>Consulta: {dateTime(radar.data.asOfUtc)}. {radar.data.comparison.reason}</p>
        {radar.data.comparison.timestampUtc&&<p>Instante comparable: {dateTime(radar.data.comparison.timestampUtc)} · {radar.data.comparison.source}</p>}
        {radar.data.comparison.items.length>0&&<ul>{radar.data.comparison.items.map((item,i)=><li key={i}>{item}</li>)}</ul>}
        <div className="table-wrap"><table aria-label="Resumen del radar"><thead><tr><th>Activo</th><th>Cierre de vela</th><th>Fecha UTC</th><th>Fuente</th><th>Estado</th><th>Tendencia observada</th><th>Retorno 15 / 60 min</th><th>Modelo</th></tr></thead>
          <tbody>{radar.data.assets.map(a=><tr key={a.symbol}><th>{a.symbol}</th><td>{price(a.metrics.close)}</td><td>{a.timestampUtc?dateTime(a.timestampUtc):'N/D'}</td><td>{a.source} · {a.feed}</td><td>{a.availability}</td><td>{a.trend}</td><td>{percent(a.metrics.return15mPercent)} / {percent(a.metrics.return60mPercent)}</td><td>{a.prediction.status}</td></tr>)}</tbody></table></div></Card>
      <Card><h3>Referencia de opciones Investep</h3><p>Seleccione el lado del contrato para consultar la referencia documental. Sin contrato ni ASK LIVE verificado, el ASK actual es N/D.</p>
        <label htmlFor="radar-right">Tipo de contrato </label><select id="radar-right" value={right} onChange={event=>setRight(event.target.value as ''|'CALL'|'PUT')}><option value="">Sin seleccionar</option><option value="CALL">CALL</option><option value="PUT">PUT</option></select>
      </Card>
      {radar.data.assets.map(a=><Card key={a.symbol}><h3>{a.symbol} · {a.trend}</h3><p>{a.reasons.join(' ')} Fuente {a.source}; última vela {a.timestampUtc?dateTime(a.timestampUtc):'N/D'}; edad {a.ageMinutes===null?'N/D':`${a.ageMinutes.toFixed(0)} min`}.</p>
        <div className="ml-facts"><div><small>SMA 20 / 40</small><strong>{price(a.metrics.sma20)} / {price(a.metrics.sma40)}</strong></div><div><small>SMA 100 / 200</small><strong>{price(a.metrics.sma100)} / {price(a.metrics.sma200)}</strong></div>
          <div><small>Bollinger 20/2 inferior · media · superior</small><strong>{price(a.metrics.bollingerLower)} · {price(a.metrics.bollingerMiddle)} · {price(a.metrics.bollingerUpper)}</strong></div>
          <div><small>RVOL</small><strong>{a.metrics.relativeVolume20===null?'N/D':`${a.metrics.relativeVolume20.toFixed(2)}×`}</strong></div></div>
        <p>Cotización IBKR existente: {a.quote.feedType} · {a.quote.availability} · último {price(a.quote.last)} · BID {price(a.quote.bid)} · ASK {price(a.quote.ask)} · mercado {dateTime(a.quote.marketTimestampUtc)} · recepción {dateTime(a.quote.receivedAtUtc)}. No se abrió ninguna suscripción nueva.</p>
        <h4>Probabilidades experimentales</h4><p>{a.prediction.reason}</p>
        {a.prediction.probabilities&&<><p>ALCISTA {probability(a.prediction.probabilities.ALCISTA)} · BAJISTA {probability(a.prediction.probabilities.BAJISTA)} · LATERAL {probability(a.prediction.probabilities.LATERAL)}</p>
          <p>Modelo {a.prediction.modelVersion} · SHA {a.prediction.modelSha256} · barra {dateTime(a.prediction.barEndUtc)} · registro {dateTime(a.prediction.registeredAtUtc)} · horizonte {dateTime(a.prediction.entryAtUtc)} a {dateTime(a.prediction.outcomeAtUtc)} · evaluación {a.prediction.evaluationStatus}</p></>}
        <h4>Contexto informativo</h4><p>{a.news.summary} {a.news.count} clasificación(es).</p>
        {a.academy&&<><h4>Referencia documental</h4><p>Estado {a.academy.status}; fecha {a.academy.referenceDate??'N/D'}; vigencia {a.academy.validFrom??'N/D'} a {a.academy.validTo??'N/D'}.</p>
          <p>Rango óptimo ASK {cents(a.academy.minAskCents)} a {cents(a.academy.maxAskCents)}; límites adicionales {cents(a.academy.outerMinCents)} a {cents(a.academy.outerMaxCents)}; ASK LIVE {cents(a.academy.liveAskCents)}.</p><p>{a.academy.reason}</p></>}
        <h4>Riesgos y datos faltantes</h4><ul>{a.risks.map((item,i)=><li key={i}>{item}</li>)}</ul></Card>)}
      <Card role="note">{radar.data.note} El movimiento del subyacente no representa rentabilidad de una opción.</Card>
    </>}
    <InvestepScenarios/>
    <TechnicalStructure/>
  </div>;
}
