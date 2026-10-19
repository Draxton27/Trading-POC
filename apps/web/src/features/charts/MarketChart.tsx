import {useEffect,useRef} from 'react';
import {init,dispose,type Chart,type KLineData} from 'klinecharts';
import {api} from '../../lib/api.ts';
type Bar={startUtc:string;open:number;high:number;low:number;close:number;volume:number|null};
function drawLevels(chart:Chart,levels:Array<{price:number;kind:string}>,timestamp:number|null){
  chart.removeOverlay({groupId:'manual-levels'});
  if(timestamp===null)return;
  for(const level of levels)chart.createOverlay({name:'horizontalStraightLine',groupId:'manual-levels',points:[{timestamp,value:level.price}],styles:{line:{color:level.kind==='resistance'||level.kind==='prior-high'?'#e4aa6f':'#85a9e9',style:'dashed'}}});
}
export default function MarketChart({symbol,timeframe,levels,pages=1,markers=[],anchorUtc}:{symbol:'NVDA'|'QQQ'|'SMH';timeframe:'15m'|'1h'|'1d';levels:Array<{price:number;kind:string}>;pages?:number;markers?:Array<{timestampUtc:string;label:string}>;anchorUtc?:string}){
  const ref=useRef<HTMLDivElement>(null),chartRef=useRef<Chart|null>(null),lastTimestampRef=useRef<number|null>(null);
  useEffect(()=>{
    if(!ref.current)return;
    const chart=init(ref.current);if(!chart)return;chartRef.current=chart;
    chart.setTimezone('America/New_York');chart.setLocale('es-ES');
    chart.setStyles({grid:{show:true,horizontal:{color:'#1e2b39'},vertical:{color:'#1e2b39'}},candle:{bar:{upColor:'#23b77e',downColor:'#f26d6d',noChangeColor:'#8ba1b5'},tooltip:{showRule:'none'}},indicator:{tooltip:{showRule:'none'}}});
    chart.setDataLoader({getBars:async({type,timestamp,callback})=>{
      if(type!=='init'){callback([],false);return;}
      try{let before:string|null=anchorUtc??null;let all:Bar[]=[];
        for(let page=0;page<pages;page++){
          const suffix=before?'&before='+encodeURIComponent(before):'';
          const data=await api<{items:Bar[];nextBefore:string|null}>('/market/bars?symbol='+symbol+'&timeframe='+timeframe+'&limit=260'+suffix);
          all=[...data.items,...all];before=data.nextBefore;if(!before)break;
        }
        const rows:KLineData[]=all.map(b=>({timestamp:Date.parse(b.startUtc),open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume??undefined}));
        callback(rows,false);
        lastTimestampRef.current=rows.at(-1)?.timestamp??null;
        if(chartRef.current===chart)drawLevels(chart,levels,lastTimestampRef.current);
        for(const marker of markers){const t=Date.parse(marker.timestampUtc),bar=all.find(b=>Date.parse(b.startUtc)<=t&&t<Date.parse(b.startUtc)+(timeframe==='15m'?900000:timeframe==='1h'?3600000:86400000));
          if(bar)chart.createOverlay({name:'simpleAnnotation',groupId:'trade-markers',points:[{timestamp:Date.parse(bar.startUtc),value:bar.close}],extendData:marker.label});
        }
      }catch{callback([],false);}
    }});
    chart.setSymbol({ticker:symbol,pricePrecision:2,volumePrecision:0});
    chart.setPeriod(timeframe==='15m'?{type:'minute',span:15}:timeframe==='1h'?{type:'hour',span:1}:{type:'day',span:1});
    chart.createIndicator({name:'MA',paneId:'candle_pane',calcParams:[20,40,100,200]},true);
    chart.createIndicator({name:'BOLL',paneId:'candle_pane',calcParams:[20,2]},true);
    chart.createIndicator({name:'VOL',paneId:'volume_pane'},false);
    return ()=>{dispose(ref.current!);chartRef.current=null;};
  },[symbol,timeframe,pages,anchorUtc,JSON.stringify(markers)]);
  useEffect(()=>{const chart=chartRef.current;if(!chart)return;
    drawLevels(chart,levels,lastTimestampRef.current);
  },[levels,symbol,timeframe]);
  return <div ref={ref} className="market-chart" role="img" aria-label={'Gráfico de velas '+symbol+' '+timeframe}/>;
}
