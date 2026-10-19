import {useQuery} from '@tanstack/react-query';
import MarketChart from './MarketChart.tsx';
import {api,dateTime,fmt} from '../../lib/api.ts';
import {Card} from '../../components/ui.tsx';

type Fill={executionId:string;side:'BUY'|'SELL';executedAtUtc:string;quantity:number;
  premiumPerShare:number;commission:number|null};
type Detail={item:{positionId:string;occSymbol:string;underlyingSymbol:string};fills:Fill[]};

export default function TradeReviewChart({positionId}:{positionId:string}){
  const query=useQuery<Detail>({queryKey:['trade-detail',positionId],
    queryFn:()=>api('/trades/'+encodeURIComponent(positionId))});
  if(query.isLoading)return <Card>Cargando ejecuciones verificadas de F17...</Card>;
  if(query.error||!query.data)return <Card>No se pudo revisar la operación: {String(query.error)}</Card>;
  const {item,fills}=query.data;
  const symbol=item.underlyingSymbol;
  if(symbol!=='NVDA'&&symbol!=='QQQ'&&symbol!=='SMH')return <Card>Subyacente sin gráfico local compatible.</Card>;
  const markers=fills.map(fill=>({timestampUtc:fill.executedAtUtc,
    label:`${fill.side==='BUY'?'Compra':'Venta'} ${fill.quantity} (${fill.executionId})`}));
  return <Card className="trade-chart-card"><h3>{item.occSymbol} · ejecuciones sobre {symbol}</h3>
    {fills.length>0&&<MarketChart symbol={symbol} timeframe="15m" levels={[]}
      anchorUtc={fills.at(-1)!.executedAtUtc} rangeStartUtc={fills[0]!.executedAtUtc} markers={markers}/>}
    <div className="table-wrap"><table><thead><tr><th>Ejecución</th><th>Hora UTC verificada</th><th>Lado</th><th>Contratos</th><th>Prima por acción</th><th>Comisión</th></tr></thead><tbody>
      {fills.map(fill=><tr key={fill.executionId}><td>{fill.executionId}</td><td>{dateTime(fill.executedAtUtc)}</td>
        <td>{fill.side}</td><td>{fill.quantity}</td><td>{fmt(fill.premiumPerShare)}</td><td>{fill.commission===null?'desconocida':fmt(fill.commission)}</td></tr>)}
    </tbody></table></div>
    <p>Los marcadores usan la hora UTC validada del CSV F17 y muestran el subyacente. La prima solo consta en las ejecuciones; no se infiere una serie histórica de la opción.</p>
  </Card>;
}
