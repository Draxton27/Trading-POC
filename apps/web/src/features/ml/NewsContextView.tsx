import {useQuery} from '@tanstack/react-query';
import type {MlNewsContextSummary} from '@trading-poc/contracts';
import {api,fmt} from '../../lib/api.ts';
import {Card} from '../../components/ui.tsx';

type Response=MlNewsContextSummary|{status:'NO_MODEL'|'NO_DATA'|'INVALID_ARTIFACT';reason:string};
const percent=(value:number)=>`${fmt(value*100,1)} %`;
export default function NewsContextView(){
  const query=useQuery<Response>({queryKey:['ml-news-context'],queryFn:()=>api('/ml/news-context?symbol=NVDA&timeframe=15m'),refetchInterval:60_000});
  const data=query.data;
  return <Card><h3>Contexto informativo experimental</h3><p className="subtle">Noticias recibidas y clasificadas antes del registro de cada predicción. Las probabilidades XGBoost permanecen intactas. Las asociaciones no demuestran causalidad ni son señales operativas.</p>
    {query.isPending?<p role="status">Cargando resumen local…</p>:query.isError?<p role="alert">No se pudo consultar el contexto informativo.</p>:data?.status!=='READY'?<p role="status">{data?.reason??'Sin dataset de contexto informativo.'}</p>:<>
      <div className="ml-facts"><div><small>Observaciones</small><strong>{data.observations}</strong></div><div><small>Desenlaces verificados</small><strong>{data.evaluated}</strong></div><div><small>Con noticias disponibles</small><strong>{data.withNews}</strong></div><div><small>Sesiones NYSE</small><strong>{data.sessions}</strong></div></div>
      <div className="table-wrap"><table aria-label="Contexto informativo por período"><thead><tr><th>Período</th><th>Observaciones</th><th>Evaluadas</th><th>Con noticias</th><th>Accuracy XGBoost</th><th>Log loss XGBoost</th><th>IC 95 % diferencia descriptiva</th></tr></thead><tbody>{([['Desarrollo 70 %',data.development],['Tramo posterior 30 %',data.laterExploratory]] as const).map(([label,group])=><tr key={label}><td>{label}</td><td>{group.observations}</td><td>{group.evaluated}</td><td>{group.withNews}</td><td>{group.baseline?percent(group.baseline.accuracy):'N/D'}</td><td>{group.baseline?fmt(group.baseline.logLoss,3):'N/D'}</td><td>{group.sessionBootstrap95?`${percent(group.sessionBootstrap95[0])} a ${percent(group.sessionBootstrap95[1])}`:'Muestra insuficiente'}</td></tr>)}</tbody></table></div>
      <p className="subtle">Cobertura por recepción antes de la predicción: {Object.entries(data.laterExploratory.windows).map(([minutes,value])=>`${minutes} min: ${value.observations}`).join(' · ')} observaciones en el tramo posterior.</p>
      {Object.values(data.laterExploratory.byDimension).some(groups=>Object.keys(groups).length>0)&&<div className="table-wrap"><table aria-label="Asociaciones informativas del tramo posterior"><thead><tr><th>Dimensión</th><th>Grupo</th><th>Muestra</th><th>Accuracy XGBoost</th><th>Residuo ALCISTA</th></tr></thead><tbody>{Object.entries(data.laterExploratory.byDimension).flatMap(([dimension,groups])=>Object.entries(groups).map(([group,value])=><tr key={`${dimension}-${group}`}><td>{dimension}</td><td>{group}</td><td>{value?.n??0}</td><td>{value?percent(value.accuracy):'N/D'}</td><td>{value?fmt(value.meanResidual.ALCISTA,3):'N/D'}</td></tr>))}</tbody></table></div>}
      <p className="subtle">{data.warning}</p>
    </>}
  </Card>;
}
