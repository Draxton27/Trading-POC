import {useQuery} from '@tanstack/react-query';
import {api,dateTime} from '../../lib/api.ts';
import {Badge,Card,SectionTitle} from '../../components/ui.tsx';

type Classification={assets:string[];category:string;sentiment:string;relevance:string;justification:string;insufficientEvidence:boolean};
type Item={id:string;revision:number;source:string;canonicalUrl:string;title:string;description:string;publishedAtUtc:string|null;publicationStatus:string;firstSeenAtUtc:string;receivedAtUtc:string;updatedAtUtc:string|null;classification:Classification|null;classificationModel:string|null;analyzedAtUtc:string|null};
type Page={state:string;total:number;offset:number;limit:number;items:Item[]};
type Run={stage:string;state:string;errorCode:string|null;atUtc:string};
type Status={state:string;articleCount:number;revisionCount:number;classificationCount:number;collection:Run|null;analysis:Run|null};
const errorLabel=(code:string|null)=>code==='OLLAMA_UNAVAILABLE'?'Ollama local no disponible':code==='NEWS_NETWORK_ERROR'?'Error de red':code==='NEWS_SOURCE_UNAVAILABLE'?'Fuente no disponible':code==='NEWS_INVALID_FEED'?'RSS/Atom inválido':code==='NEWS_INSTRUCTION_CONTENT'?'Contenido con instrucciones rechazado':code??'Sin errores';

export default function NewsView(){
  const status=useQuery<Status>({queryKey:['news-status'],queryFn:()=>api('/news/status'),refetchInterval:30000});
  const page=useQuery<Page>({queryKey:['news-items'],queryFn:()=>api('/news/items?limit=50')});
  return <div className="content-page"><SectionTitle eyebrow="CONTEXTO DOCUMENTAL" title="Noticias verificables" aside={<Badge tone="info">Solo lectura</Badge>}/>
    <p className="lead">Noticias recibidas por fuentes RSS oficiales. La publicación declarada no prueba cuándo estuvieron disponibles para este sistema. La clasificación de Ollama es descriptiva y no predice movimientos.</p>
    <Card><h3>Estado de recopilación y análisis</h3>
      {status.isLoading?<p>Consultando estado…</p>:status.isError?<p>No se pudo consultar el estado.</p>:status.data?.state==='INVALID_LEDGER'?<p>El registro privado no superó la verificación de integridad.</p>:<p>{status.data?.articleCount??0} noticias · {status.data?.revisionCount??0} versiones · {status.data?.classificationCount??0} clasificaciones.</p>}
      <p>Fuente: {status.data?.collection?`${dateTime(status.data.collection.atUtc)} · ${status.data.collection.state==='OK'?'correcta':errorLabel(status.data.collection.errorCode)}`:'sin consulta registrada'}.</p>
      <p>Ollama: {status.data?.analysis?`${dateTime(status.data.analysis.atUtc)} · ${status.data.analysis.state==='OK'?'análisis completado':errorLabel(status.data.analysis.errorCode)}`:'sin ejecutar o estado no comprobado'}.</p>
    </Card>
    <Card><h3>Noticias recibidas</h3>
      {page.isLoading?<p>Cargando noticias…</p>:page.isError?<p>No se pudieron consultar las noticias.</p>:!page.data?.items.length?<p>No hay noticias reales disponibles. Ejecute <code>npm.cmd run news:collect -- --once</code> para consultar las fuentes configuradas.</p>:<div className="table-wrap"><table><thead><tr><th>Fuente y titular</th><th>Publicación declarada</th><th>Primera recepción</th><th>Clasificación de IA</th></tr></thead><tbody>{page.data.items.map(item=><tr key={item.id}><td><a href={item.canonicalUrl} target="_blank" rel="noopener noreferrer">{item.title}</a><small>{item.source} · revisión {item.revision}</small><p>{item.description}</p></td><td>{item.publicationStatus==='KNOWN'?dateTime(item.publishedAtUtc):item.publicationStatus==='INCONSISTENT'?'Fecha inconsistente':item.publicationStatus==='INVALID'?'Fecha inválida':'Fecha desconocida'}</td><td>{dateTime(item.firstSeenAtUtc)}</td><td>{item.classification?<><strong>{item.classification.category}</strong><small>{item.classification.assets.join(', ')||'Sin activo explícito'} · {item.classification.sentiment} · relevancia {item.classification.relevance}</small><p>IA: {item.classification.justification}</p><small>{item.classification.insufficientEvidence?'Evidencia insuficiente · ':''}{item.classificationModel} · {dateTime(item.analyzedAtUtc)}</small></>:<span>Sin análisis de Ollama</span>}</td></tr>)}</tbody></table></div>}
    </Card><p className="subtle">Contenido de fuente, recepción local y análisis de IA se muestran por separado. No son recomendaciones CALL/PUT ni entradas del modelo XGBoost.</p>
  </div>;
}
