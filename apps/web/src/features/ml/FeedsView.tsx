import {useQuery} from '@tanstack/react-query';
import {api,dateTime,fmt} from '../../lib/api.ts';
import {Card} from '../../components/ui.tsx';

type FeedStatus={status:string;connection:string;feed:'iex';adjustment:'raw';lastBarEndUtc:string|null;receivedAtUtc:string|null;latencyMs:number|null;revision:number|null;coverage:{minuteBars:number;quarterBars:number;expectedMinutes:number;coverage:number|null}|null;comparison:{matched:number;missingIex:number;missingSip:number;iexCoverage:number|null;sipCoverage:number|null;meanTimeGainedMs:number|null;meanRelativeVolumeDifference:number|null;meanAbsoluteOhlcDifference:{open:number;high:number;low:number;close:number}|null;discrepantIntervals:number;priceBasis:string}|null;sip:{status:string;lastBarEndUtc:string|null;lastBarReceivedAtUtc:string|null;effectiveDelayMs:number|null}};
const duration=(ms:number|null|undefined)=>ms===null||ms===undefined?'N/D':`${fmt(ms/1000,1)} s`;
export default function FeedsView(){
  const result=useQuery<FeedStatus>({queryKey:['ml-feeds'],queryFn:()=>api('/ml/feeds?symbol=NVDA&timeframe=15m'),refetchInterval:30_000});
  const d=result.data,c=d?.comparison;
  return <Card><h3>Feeds bursátiles · experimental</h3><p className="subtle">IEX Live cubre una sola bolsa y sus precios no vienen ajustados por splits. SIP retrasado es consolidado y está ajustado por splits. Las diferencias son descriptivas; ninguna vela IEX alimenta el XGBoost SIP ni constituye una señal.</p>
    {result.isPending?<p>Consultando feeds…</p>:result.isError?<p role="alert">No se pudo consultar el estado de los feeds.</p>:<><div className="ml-facts">
      <div><small>IEX / WebSocket</small><strong>{d?.status??'N/D'} · {d?.connection??'N/D'}</strong></div>
      <div><small>IEX última vela / recepción</small><strong>{dateTime(d?.lastBarEndUtc)} / {dateTime(d?.receivedAtUtc)}</strong></div>
      <div><small>IEX latencia / revisión</small><strong>{duration(d?.latencyMs)} / {d?.revision??'N/D'}</strong></div>
      <div><small>IEX cobertura observada</small><strong>{d?.coverage?.coverage===null||d?.coverage?.coverage===undefined?'N/D':`${fmt(d.coverage.coverage*100,1)} %`}</strong></div>
      <div><small>SIP retrasado / última vela</small><strong>{d?.sip.status??'N/D'} / {dateTime(d?.sip.lastBarEndUtc)}</strong></div>
      <div><small>SIP recepción / edad</small><strong>{dateTime(d?.sip.lastBarReceivedAtUtc)} / {duration(d?.sip.effectiveDelayMs)}</strong></div>
    </div>{c&&<><p>Intervalos coincidentes: {c.matched}. Ausentes IEX/SIP: {c.missingIex}/{c.missingSip}. Discrepancias: {c.discrepantIntervals}. Tiempo medio ganado: {duration(c.meanTimeGainedMs)}. Diferencia relativa media de volumen: {c.meanRelativeVolumeDifference===null?'N/D':`${fmt(c.meanRelativeVolumeDifference*100,1)} %`}.</p><p className="subtle">Base de precios: {c.priceBasis}. OHLC medio absoluto: {c.meanAbsoluteOhlcDifference?Object.entries(c.meanAbsoluteOhlcDifference).map(([name,value])=>`${name} ${fmt(value,3)}`).join(' · '):'N/D'}.</p></>}</>}
  </Card>;
}
