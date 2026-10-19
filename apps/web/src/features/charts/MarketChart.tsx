import {useEffect,useRef,useState} from 'react';
import {init,dispose,registerIndicator,type Chart,type KLineData} from 'klinecharts';
import {api} from '../../lib/api.ts';
import {alignTradeMarkers} from './trade-markers.ts';
type Bar={startUtc:string;endUtc:string;open:number;high:number;low:number;close:number;volume:number|null;isComplete:boolean};
type Point={startUtc:string;sma20:number|null;sma40:number|null;sma100:number|null;sma200:number|null;
  bbUpper:number|null;bbLower:number|null;bbMiddle:number|null};
const line=(key:keyof Point,title:string,color:string)=>({key,title,type:'line',styles:()=>({color,size:1})});
registerIndicator({name:'POC_SMA',shortName:'SMA 20/40/100/200',series:'price',
  figures:[line('sma20','SMA20','#23b77e'),line('sma40','SMA40','#62a5eb'),
    line('sma100','SMA100','#e4aa6f'),line('sma200','SMA200','#bd83d8')],calc:()=>[]});
registerIndicator({name:'POC_BOLL',shortName:'BOLL 20/2',series:'price',
  figures:[line('bbUpper','Superior','#7f9ee6'),line('bbMiddle','SMA20','#a8b8ce'),
    line('bbLower','Inferior','#7f9ee6')],calc:()=>[]});
function drawLevels(chart:Chart,levels:Array<{price:number;kind:string}>,timestamp:number|null){
  chart.removeOverlay({groupId:'manual-levels'});
  if(timestamp===null)return;
  for(const level of levels)chart.createOverlay({name:'horizontalStraightLine',groupId:'manual-levels',points:[{timestamp,value:level.price}],styles:{line:{color:level.kind==='resistance'||level.kind==='prior-high'?'#e4aa6f':'#85a9e9',style:'dashed'}}});
}
export default function MarketChart({symbol,timeframe,levels,pages=1,markers=[],anchorUtc,rangeStartUtc}:{symbol:'NVDA'|'QQQ'|'SMH';timeframe:'15m'|'1h'|'1d';levels:Array<{price:number;kind:string}>;pages?:number;markers?:Array<{timestampUtc:string;label:string}>;anchorUtc?:string;rangeStartUtc?:string}){
  const ref=useRef<HTMLDivElement>(null),chartRef=useRef<Chart|null>(null),lastTimestampRef=useRef<number|null>(null);
  const [missingMarkers,setMissingMarkers]=useState<string[]>([]);
  useEffect(()=>{
    if(!ref.current)return;
    const chart=init(ref.current);if(!chart)return;chartRef.current=chart;
    chart.setTimezone('America/New_York');chart.setLocale('es-ES');
    chart.setStyles({grid:{show:true,horizontal:{color:'#1e2b39'},vertical:{color:'#1e2b39'}},candle:{bar:{upColor:'#23b77e',downColor:'#f26d6d',noChangeColor:'#8ba1b5'},tooltip:{showRule:'none'}},indicator:{tooltip:{showRule:'none'}}});
    chart.setDataLoader({getBars:async({type,timestamp,callback})=>{
      if(type!=='init'){callback([],false);return;}
      try{let before:string|null=anchorUtc??null;let all:Bar[]=[],points:Point[]=[];
        for(let page=0;page<(rangeStartUtc?50:pages);page++){
          const suffix=before?'&before='+encodeURIComponent(before):'';
          const path='?symbol='+symbol+'&timeframe='+timeframe+'&limit=260'+suffix;
          const [data,indicators]=await Promise.all([
            api<{items:Bar[];nextBefore:string|null}>('/market/bars'+path),
            api<{items:Point[]}>('/market/indicators'+path)]);
          all=[...data.items,...all];points=[...indicators.items,...points];before=data.nextBefore;
          if(!before||rangeStartUtc&&Date.parse(all[0]!.startUtc)<=Date.parse(rangeStartUtc))break;
        }
        const rows:KLineData[]=all.map(b=>({timestamp:Date.parse(b.startUtc),open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume??undefined}));
        callback(rows,false);
        const byTimestamp=new Map(points.map(p=>[Date.parse(p.startUtc),p]));
        const values=(data:KLineData[])=>data.map(bar=>{
          const p=byTimestamp.get(bar.timestamp);
          return {sma20:p?.sma20??undefined,sma40:p?.sma40??undefined,
            sma100:p?.sma100??undefined,sma200:p?.sma200??undefined,
            bbUpper:p?.bbUpper??undefined,bbMiddle:p?.bbMiddle??undefined,bbLower:p?.bbLower??undefined};
        });
        chart.createIndicator({name:'POC_SMA',paneId:'candle_pane',calc:values},true);
        chart.createIndicator({name:'POC_BOLL',paneId:'candle_pane',calc:values},true);
        lastTimestampRef.current=rows.at(-1)?.timestamp??null;
        if(chartRef.current===chart)drawLevels(chart,levels,lastTimestampRef.current);
        const aligned=alignTradeMarkers(all,markers);setMissingMarkers(aligned.missing.map(row=>row.label));
        for(const marker of aligned.placed){
          chart.createOverlay({name:'simpleAnnotation',groupId:'trade-markers',
            points:[{timestamp:Date.parse(marker.barStartUtc),value:marker.barClose}],extendData:marker.label});
        }
      }catch{callback([],false);}
    }});
    chart.setSymbol({ticker:symbol,pricePrecision:2,volumePrecision:0});
    chart.setPeriod(timeframe==='15m'?{type:'minute',span:15}:timeframe==='1h'?{type:'hour',span:1}:{type:'day',span:1});
    chart.createIndicator({name:'VOL',paneId:'volume_pane'},false);
    return ()=>{dispose(ref.current!);chartRef.current=null;};
  },[symbol,timeframe,pages,anchorUtc,rangeStartUtc,JSON.stringify(markers)]);
  useEffect(()=>{const chart=chartRef.current;if(!chart)return;
    drawLevels(chart,levels,lastTimestampRef.current);
  },[levels,symbol,timeframe]);
  return <><div ref={ref} className="market-chart" role="img" aria-label={'Gráfico de velas '+symbol+' '+timeframe}/>
    {missingMarkers.length>0&&<p className="subtle">Sin vela del subyacente para: {missingMarkers.join(', ')}. No se dibujó un marcador aproximado.</p>}</>;
}
