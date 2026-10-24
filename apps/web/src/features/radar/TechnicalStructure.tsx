import {useQuery} from '@tanstack/react-query';
import type {TechnicalContext} from '@trading-poc/contracts';
import {api,dateTime,fmt} from '../../lib/api.ts';
import {Card} from '../../components/ui.tsx';

const frames=['15m','1h','1d'] as const;
const symbols=['NVDA','QQQ','SMH'] as const;
const pair=(value:string)=>value==='BULLISH_ALIGNMENT'?'alcista':value==='BEARISH_ALIGNMENT'?'bajista':value==='MIXED'?'igualdad o mezcla':'N/D';

function StructureFor({symbol}:{symbol:typeof symbols[number]}){
  const query=useQuery<TechnicalContext>({queryKey:['technical-context',symbol],queryFn:()=>api(`/market/technical-context?symbol=${symbol}`),refetchInterval:60_000});
  return <Card><h3>{symbol} · estructura técnica</h3>
    {query.isPending&&<p role="status">Calculando estructura de velas cerradas…</p>}
    {query.isError&&<p role="alert">Contexto técnico no disponible; compruebe calendario e histórico local.</p>}
    {query.data&&<><p>Compatibilidad: {query.data.alignment}. Fuente: {query.data.source}. Estado: {query.data.dataStatus}. Última vela: {dateTime(query.data.lastCompleteBarUtc)}.</p>
      <div className="table-wrap"><table aria-label={`Estructura técnica ${symbol}`}><thead><tr><th>Temporalidad</th><th>SMA20/40</th><th>SMA100/200</th><th>Pendientes 20 / 40 / 100 / 200</th><th>Última vela completa</th></tr></thead>
        <tbody>{frames.map(frame=>{const item=query.data!.timeframes[frame];return <tr key={frame}><th>{frame}</th><td>{pair(item.shortPair)}</td><td>{pair(item.longPair)}</td>
          <td>{[20,40,100,200].map(period=>item.smas[period as 20|40|100|200].slope).join(' / ')}</td><td>{dateTime(item.lastCompleteBarUtc)}{item.scheduledAbbreviated?' · barra horaria abreviada':''}</td></tr>;})}</tbody></table></div>
      <p>Niveles potenciales: {query.data.levels.length}. Eventos observados en hasta 205 velas continuas: {query.data.events.filter(event=>event.status==='OBSERVED').length}. Las medias no confirman por sí solas un cambio de tendencia.</p>
      <details><summary>Niveles y eventos</summary><ul>{query.data.levels.slice(-15).map((level,i)=><li key={i}>{level.timeframe} · {level.kind} {level.period??''}: ${fmt(level.levelPrice)} · distancia {level.distancePercent===null?'N/D':`${fmt(level.distancePercent)} %`} · disponible {dateTime(level.availableAtUtc)}.</li>)}</ul>
        <ul>{query.data.events.slice(-12).map((event,i)=><li key={i}>{event.timeframe} · {event.kind} {event.period} · {event.status} · {dateTime(event.atUtc)}. {event.description}</li>)}</ul></details>
      {!!query.data.limitations.length&&<p>{query.data.limitations.join(' ')}</p>}
    </>}
  </Card>;
}

export default function TechnicalStructure(){return <section aria-label="Estructura técnica multitemporal"><h2>Estructura técnica multitemporal</h2><p>SMA y niveles descriptivos con velas cerradas. La fuente puede ser histórica u obsoleta; ningún nivel es una recomendación operativa.</p>
  {symbols.map(symbol=><StructureFor key={symbol} symbol={symbol}/>)}</section>;}
