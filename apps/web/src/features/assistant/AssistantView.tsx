import {useState,type FormEvent} from 'react';
import {api} from '../../lib/api.ts';
import {Badge,Button,Card,SectionTitle} from '../../components/ui.tsx';

export type AssistantMetricObservation={key:string;value:number|null;unit:string;period:string;timestampUtc:string|null;availability:string};
export type AssistantEvidence={source:string;asset:string|null;dateUtc:string|null;documentDate?:string|null;dataType:string;availability:string;summary:string;
  values?:{observations?:AssistantMetricObservation[]}};
export type AssistantSection={title:string;items:string[]};
export type AssistantExchange={question:string;answer:string;sections?:AssistantSection[];evidence:AssistantEvidence[]};
const kinds:Record<string,string>={SYNTHETIC:'SINTÉTICO',HISTORICAL:'HISTÓRICO',LIVE:'LIVE',DELAYED:'RETRASADO',FROZEN:'CONGELADO',DELAYED_FROZEN:'RETRASADO Y CONGELADO',UNKNOWN:'DESCONOCIDO',DOCUMENT:'DOCUMENTAL',SYSTEM:'SISTEMA',PREDICTION:'PREDICCIÓN EXPERIMENTAL'};
const states:Record<string,string>={AVAILABLE:'DISPONIBLE',STALE:'OBSOLETO',UNAVAILABLE:'NO DISPONIBLE',HISTORICAL_ONLY:'SOLO HISTÓRICO',CONFLICT:'CONFLICTO',INSUFFICIENT_HISTORY:'HISTORIAL INSUFICIENTE',INCOMPLETE_WINDOW:'VENTANA INCOMPLETA',INVALID_DENOMINATOR:'DENOMINADOR INVÁLIDO'};
const metricNames:Record<string,string>={close:'Cierre',sma20:'SMA 20',sma40:'SMA 40',sma100:'SMA 100',sma200:'SMA 200',distanceSma20Percent:'Distancia a SMA 20',distanceSma40Percent:'Distancia a SMA 40',distanceSma100Percent:'Distancia a SMA 100',distanceSma200Percent:'Distancia a SMA 200',bollingerUpper:'Bollinger superior',bollingerMiddle:'Bollinger media',bollingerLower:'Bollinger inferior',bollingerPositionPercent:'Posición Bollinger',bollingerWidthPercent:'Ancho relativo Bollinger',distanceUpperBandWidthPercent:'Distancia a banda superior',distanceLowerBandWidthPercent:'Distancia a banda inferior',returnOneBarPercent:'Retorno 15 min',returnFourBarsPercent:'Retorno 60 min',relativeVolume20:'RVOL',volumeReference:'Volumen promedio de referencia',volumeReferenceSessions:'Sesiones previas observadas',volumeMatchingSessions:'Sesiones coincidentes'};
const metricValue=(item:AssistantMetricObservation)=>item.value===null||!Number.isFinite(item.value)?'N/D':item.unit==='USD'?`$${item.value.toFixed(2)}`:item.unit==='percent'?`${item.value.toFixed(2)}%`:item.unit==='ratio'?`${item.value.toFixed(2)}×`:item.value.toLocaleString('es');
export default function AssistantView({exchanges,onChange}:{exchanges:AssistantExchange[];onChange:(entries:AssistantExchange[])=>void}){
  const [message,setMessage]=useState(''),[loading,setLoading]=useState(false),[error,setError]=useState('');
  async function send(event:FormEvent){event.preventDefault();const question=message.trim();if(!question||loading)return;
    setLoading(true);setError('');
    try{const result=await api<{answer:string;sections?:AssistantSection[];evidence:AssistantEvidence[]}>('/assistant/chat',{method:'POST',body:JSON.stringify({message:question,history:exchanges.map(x=>x.question).slice(-6)})});
      onChange([...exchanges,{question,...result}].slice(-30));setMessage('');
    }catch(e){setError(e instanceof Error?e.message:'No se pudo consultar el asistente.');}finally{setLoading(false);}
  }
  return <div className="content-page"><SectionTitle eyebrow="CONSULTA LOCAL" title="Asistente" aside={<Badge tone="info">Solo lectura</Badge>}/>
    <p className="lead">Consultas en español con Ollama local. Las fuentes y sus fechas se muestran debajo de cada respuesta.</p>
    <Card className="assistant-card"><div className="assistant-thread" aria-live="polite">
      {!exchanges.length&&<p className="subtle">Consultá el histórico, los rangos documentales o el estado del sistema. Hasta dos activos por consulta.</p>}
      {exchanges.map((entry,index)=><section className="assistant-exchange" key={index}><div className="assistant-question"><strong>Tu consulta</strong><p>{entry.question}</p></div><div className="assistant-answer"><strong>Respuesta</strong>{entry.sections?.length?<div className="assistant-sections">{entry.sections.map((section,i)=><section key={i}><h3>{section.title}</h3><ul>{section.items.map((item,j)=><li key={j}>{item}</li>)}</ul></section>)}</div>:<p>{entry.answer}</p>}<details open><summary>Fuentes y disponibilidad</summary>{entry.evidence.map((item,i)=>{const kind=item.dataType==='LIVE'?(item.availability==='AVAILABLE'?'LIVE VERIFICADO':'LIVE SIN VIGENCIA CONFIRMADA'):(kinds[item.dataType]??'DESCONOCIDO');return <div className="assistant-evidence" key={i}><Badge tone={item.availability==='AVAILABLE'&&item.dataType==='LIVE'?'success':item.availability==='AVAILABLE'?'info':'warning'}>{kind} · {states[item.availability]??'NO DISPONIBLE'}</Badge><span>{item.asset??'Sistema'} · {item.source}</span><small>{item.documentDate?`Fecha documental: ${item.documentDate}`:item.dateUtc?`Fecha UTC: ${item.dateUtc}`:'Fecha no disponible'}</small>{item.values?.observations?.length?<details className="assistant-metrics"><summary>Métricas, período y disponibilidad</summary><div className="assistant-metrics-scroll"><table><thead><tr><th>Métrica</th><th>Valor</th><th>Período</th><th>Timestamp UTC</th><th>Estado</th></tr></thead><tbody>{item.values.observations.map((metric,j)=><tr key={j}><td>{metricNames[metric.key]??metric.key}</td><td>{metricValue(metric)}</td><td>{metric.period}</td><td>{metric.timestampUtc??'N/D'}</td><td>{states[metric.availability]??metric.availability}</td></tr>)}</tbody></table></div></details>:null}</div>})}</details></div></section>)}
      {loading&&<p role="status">Consultando Ollama local…</p>}
      {error&&<p className="negative" role="alert">{error}</p>}
    </div><form className="assistant-form" onSubmit={send}><label htmlFor="assistant-message">Consulta</label><textarea id="assistant-message" value={message} onChange={e=>setMessage(e.target.value)} maxLength={2000} rows={3} placeholder="Por ejemplo: compará el histórico de NVDA y QQQ"/><div><span className="subtle">{message.length}/2000 · El historial permanece en esta página.</span><Button disabled={loading||!message.trim()}>Enviar consulta</Button></div></form></Card>
    <p className="subtle">El cierre histórico no es una cotización actual. Las referencias documentales históricas no implican vigencia ni recomendación.</p>
  </div>;
}
