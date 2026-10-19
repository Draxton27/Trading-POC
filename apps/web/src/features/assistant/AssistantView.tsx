import {useState,type FormEvent} from 'react';
import {api} from '../../lib/api.ts';
import {Badge,Button,Card,SectionTitle} from '../../components/ui.tsx';

export type AssistantEvidence={source:string;asset:string|null;dateUtc:string|null;documentDate?:string|null;dataType:string;availability:string;summary:string};
export type AssistantExchange={question:string;answer:string;evidence:AssistantEvidence[]};
const kinds:Record<string,string>={SYNTHETIC:'SINTÉTICO',HISTORICAL:'HISTÓRICO',LIVE:'LIVE',DELAYED:'RETRASADO',FROZEN:'CONGELADO',DELAYED_FROZEN:'RETRASADO Y CONGELADO',UNKNOWN:'DESCONOCIDO',DOCUMENT:'DOCUMENTAL',SYSTEM:'SISTEMA'};
const states:Record<string,string>={AVAILABLE:'DISPONIBLE',STALE:'OBSOLETO',UNAVAILABLE:'NO DISPONIBLE',HISTORICAL_ONLY:'SOLO HISTÓRICO',CONFLICT:'CONFLICTO'};
export default function AssistantView({exchanges,onChange}:{exchanges:AssistantExchange[];onChange:(entries:AssistantExchange[])=>void}){
  const [message,setMessage]=useState(''),[loading,setLoading]=useState(false),[error,setError]=useState('');
  async function send(event:FormEvent){event.preventDefault();const question=message.trim();if(!question||loading)return;
    setLoading(true);setError('');
    try{const result=await api<{answer:string;evidence:AssistantEvidence[]}>('/assistant/chat',{method:'POST',body:JSON.stringify({message:question,history:exchanges.map(x=>x.question).slice(-6)})});
      onChange([...exchanges,{question,...result}].slice(-30));setMessage('');
    }catch(e){setError(e instanceof Error?e.message:'No se pudo consultar el asistente.');}finally{setLoading(false);}
  }
  return <div className="content-page"><SectionTitle eyebrow="CONSULTA LOCAL" title="Asistente" aside={<Badge tone="info">Solo lectura</Badge>}/>
    <p className="lead">Consultas en español con Ollama local. Las fuentes y sus fechas se muestran debajo de cada respuesta.</p>
    <Card className="assistant-card"><div className="assistant-thread" aria-live="polite">
      {!exchanges.length&&<p className="subtle">Consultá el histórico, los rangos documentales o el estado del sistema. Hasta dos activos por consulta.</p>}
      {exchanges.map((entry,index)=><section className="assistant-exchange" key={index}><div className="assistant-question"><strong>Tu consulta</strong><p>{entry.question}</p></div><div className="assistant-answer"><strong>Respuesta</strong><p>{entry.answer}</p><details open><summary>Fuentes y disponibilidad</summary>{entry.evidence.map((item,i)=><div className="assistant-evidence" key={i}><Badge tone={item.availability==='AVAILABLE'&&item.dataType==='LIVE'?'success':item.availability==='AVAILABLE'?'info':'warning'}>{kinds[item.dataType]??'DESCONOCIDO'} · {states[item.availability]??'NO DISPONIBLE'}</Badge><span>{item.asset??'Sistema'} · {item.source}</span><small>{item.documentDate?`Fecha documental: ${item.documentDate}`:item.dateUtc?`Fecha UTC: ${item.dateUtc}`:'Fecha no disponible'}</small></div>)}</details></div></section>)}
      {loading&&<p role="status">Consultando Ollama local…</p>}
      {error&&<p className="negative" role="alert">{error}</p>}
    </div><form className="assistant-form" onSubmit={send}><label htmlFor="assistant-message">Consulta</label><textarea id="assistant-message" value={message} onChange={e=>setMessage(e.target.value)} maxLength={2000} rows={3} placeholder="Por ejemplo: compará el histórico de NVDA y QQQ"/><div><span className="subtle">{message.length}/2000 · El historial permanece en esta página.</span><Button disabled={loading||!message.trim()}>Enviar consulta</Button></div></form></Card>
    <p className="subtle">El cierre histórico no es una cotización actual. Las referencias documentales históricas no implican vigencia ni recomendación.</p>
  </div>;
}
