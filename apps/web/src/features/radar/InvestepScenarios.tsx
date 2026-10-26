import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import type {InvestepScenario,InvestepScenarioResponse} from '@trading-poc/contracts';
import {api,dateTime} from '../../lib/api.ts';
import {Card} from '../../components/ui.tsx';

const symbols=['NVDA','QQQ','SMH'] as const;
const frames=['15m','1h','1d'] as const;
const families={SMA_PULLBACK_REJECTION:'Retroceso y rechazo de SMA',SMA_STRUCTURE_BREAK:'Ruptura de estructura SMA',
  SMA_BREAK_RETEST:'Retesteo tras ruptura',BOLLINGER_VOLUME_CONTEXT:'Contexto Bollinger y volumen'} as const;
const states={OBSERVED:'Observado',AWAITING_CONFIRMATION:'Pendiente',FAILED:'Fallido',EXPIRED:'Expirado',
  NO_SCENARIO:'Sin escenario',INSUFFICIENT_DATA:'Datos insuficientes'} as const;
const display=(value:number|null,digits=2)=>value===null?'N/D':value.toFixed(digits);
const position=(above:boolean|null,below:boolean|null)=>above===null||below===null?'N/D':above?'sobre':below?'bajo':'igual';

function ScenarioCard({item}:{item:InvestepScenario}){
  const frame=item.context?.frames[item.timeframe];
  return <Card><h4>{families[item.family]} · {item.timeframe} · {states[item.state]}</h4>
    <p>{item.trigger.description}</p>
    <p>Dirección geométrica: {item.direction}. SMA: {item.period??'N/D'}. Vela: {dateTime(item.trigger.barStartUtc)}.
      Observación: {dateTime(item.eventAtUtc)}. Disponibilidad verificada: {item.availableAtUtc?dateTime(item.availableAtUtc):'N/D (recepción original no verificada)'}.</p>
    <p>SMA20/40: {frame?.shortPair??'N/D'}; SMA100/200: {frame?.longPair??'N/D'}.
      {item.breakAtUtc&&<> Ruptura original: {dateTime(item.breakAtUtc)}.</>}</p>
    {item.bollingerVolume&&<p>Bollinger: {item.bollingerVolume.position}; banda inferior / media / superior:
      {' '}{display(item.bollingerVolume.lower)} / {display(item.bollingerVolume.middle)} / {display(item.bollingerVolume.upper)}.
      {' '}RVOL: {display(item.bollingerVolume.relativeVolume20)}×. Retorno 15 / 60 min:
      {' '}{display(item.bollingerVolume.returnOneBarPercent)} % / {display(item.bollingerVolume.returnFourBarsPercent)} %.</p>}
    <details><summary>Evidencia, contradicciones y límites</summary>
      <p>Fuente: {item.source.name} · {item.source.feed} · {item.source.adjustment} · {item.source.dataStatus}. Corte: {dateTime(item.asOfUtc)}.</p>
      <p>Compatibilidad multitemporal: {item.context?.alignment??'N/D (contexto histórico no reconstruido)'}. Una divergencia no se resuelve mediante una puntuación.</p>
      <h5>Confirmaciones observadas</h5><ul>{item.confirmations.length?item.confirmations.map((fact,i)=><li key={i}>{fact.kind}: {fact.description}</li>):<li>Ninguna confirmación adicional disponible.</li>}</ul>
      <h5>Contradicciones</h5><ul>{item.contradictions.length?item.contradictions.map((fact,i)=><li key={i}>{fact.detail}</li>):<li>No se detectó orden contrario entre las parejas de SMA disponibles.</li>}</ul>
      <h5>Niveles relacionados</h5><ul>{item.relatedLevels.length?item.relatedLevels.map((level,i)=><li key={i}>{level.timeframe} · SMA {level.period}: ${display(level.levelPrice)} · {level.method}</li>):<li>N/D</li>}</ul>
      <h5>Datos faltantes y límites</h5><ul>{item.limitations.length?item.limitations.map((limit,i)=><li key={i}>{limit}</li>):<li>El evento es descriptivo y no constituye una señal operativa.</li>}</ul>
    </details>
  </Card>;
}

export default function InvestepScenarios(){
  const [symbol,setSymbol]=useState<typeof symbols[number]>('NVDA');
  const [family,setFamily]=useState<'ALL'|keyof typeof families>('ALL');
  const [state,setState]=useState<'ALL'|keyof typeof states>('ALL');
  const query=useQuery<InvestepScenarioResponse>({queryKey:['investep-scenarios',symbol],
    queryFn:()=>api(`/radar/scenarios?symbol=${symbol}`),refetchInterval:60_000});
  const filter=(items:InvestepScenario[])=>items.filter(item=>(family==='ALL'||item.family===family)&&(state==='ALL'||item.state===state));
  const current=query.data?filter(query.data.current):[],historical=query.data?filter(query.data.historical):[];
  return <section className="investep-scenarios" aria-label="Escenarios técnicos Investep"><h2>Escenarios técnicos Investep</h2>
    <p>Hechos geométricos de velas cerradas. Las condiciones observadas y pendientes no son predicciones ni recomendaciones CALL/PUT.</p>
    <div className="scenario-filters"><label htmlFor="scenario-symbol">Activo </label><select id="scenario-symbol" value={symbol} onChange={event=>setSymbol(event.target.value as typeof symbol)}>
      {symbols.map(item=><option key={item} value={item}>{item}</option>)}</select>
      <label htmlFor="scenario-family"> Familia </label><select id="scenario-family" value={family} onChange={event=>setFamily(event.target.value as typeof family)}>
        <option value="ALL">Todas</option>{Object.entries(families).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
      <label htmlFor="scenario-state"> Estado </label><select id="scenario-state" value={state} onChange={event=>setState(event.target.value as typeof state)}>
        <option value="ALL">Todos</option>{Object.entries(states).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div>
    {query.isPending&&<Card role="status">Consultando escenarios técnicos…</Card>}
    {query.isError&&<Card role="alert">Escenarios técnicos no disponibles. Revise el histórico y el calendario local.</Card>}
    {query.data&&<><Card><h3>{symbol} · estructura de la última vela disponible</h3>
      <p>Estado {query.data.source.dataStatus}; fuente {query.data.source.name}; feed {query.data.source.feed}; ajuste {query.data.source.adjustment};
        corte {dateTime(query.data.asOfUtc)}. Compatibilidad: {query.data.alignment}.</p>
      <div className="table-wrap"><table aria-label="SMA multitemporal de escenarios"><thead><tr><th>Marco</th><th>SMA20/40</th><th>SMA100/200</th><th>Pendientes 20 / 40 / 100 / 200</th><th>Precio frente a SMA20 / 40 / 100 / 200</th><th>Última vela</th></tr></thead>
        <tbody>{frames.map(key=>{const frame=query.data!.frames[key];return <tr key={key}><th>{key}</th><td>{frame.shortPair}</td><td>{frame.longPair}</td>
          <td>{[20,40,100,200].map(period=>frame.smas[period as 20|40|100|200].slope).join(' / ')}</td>
          <td>{[20,40,100,200].map(period=>{const sma=frame.smas[period as 20|40|100|200];return position(sma.priceAboveSma,sma.priceBelowSma);}).join(' / ')}</td>
          <td>{dateTime(frame.barEndUtc)}</td></tr>;})}</tbody></table></div>
      <p>Niveles potenciales: {query.data.levels.length}. Ninguna coincidencia de medias demuestra rentabilidad.</p>
      <details><summary>Niveles y rangos previos</summary>
        <div className="table-wrap"><table aria-label="Niveles técnicos potenciales"><thead><tr><th>Marco</th><th>Tipo</th><th>Valor</th><th>Distancia</th><th>Referencia</th><th>Disponibilidad calculada</th></tr></thead>
          <tbody>{query.data.levels.map((level,i)=><tr key={i}><td>{level.timeframe}</td><td>{level.kind} {level.period??''}</td>
            <td>${display(level.levelPrice)}</td><td>{display(level.distancePercent)} %</td><td>{dateTime(level.referenceEndUtc)}</td><td>{dateTime(level.availableAtUtc)}</td></tr>)}</tbody></table></div>
        <ul>{query.data.previousRanges.map(range=><li key={range.sessions}>{range.sessions} sesiones: máximo {display(range.high)}, mínimo {display(range.low)}, estado {range.status}.</li>)}</ul>
        <p>Los tiempos de niveles históricos calculados desde cierres no acreditan recepción original cuando la fuente indica `receiptVerified=false`.</p>
      </details>
      {!!query.data.limitations.length&&<details><summary>Limitaciones de datos</summary><ul>{query.data.limitations.map((limit,i)=><li key={i}>{limit}</li>)}</ul></details>}</Card>
      <h3>Escenarios de la última vela</h3>
      {current.length?current.map(item=><ScenarioCard key={item.id} item={item}/>):<Card>No hay escenarios de esa familia y estado en la última vela disponible.</Card>}
      <details><summary>Eventos históricos anteriores ({historical.length})</summary>
        <p>Estos eventos son retrospectivos y no representan oportunidades actuales.</p>
        {historical.length?historical.map(item=><ScenarioCard key={item.id} item={item}/>):<p>Sin eventos históricos para los filtros seleccionados.</p>}</details>
      <Card role="note">{query.data.note}</Card></>}
  </section>;
}
