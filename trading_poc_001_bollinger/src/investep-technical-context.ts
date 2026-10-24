import type {MarketCalendar} from './alpaca-calendar.ts';
import type {Candle} from './domain.ts';
import {newYorkBarParts} from './strategy-validation.ts';
import {buildDailyCandles,buildHourlyCandles,calculateSmaPoints,lastAvailableSmaPoint,SMA_PERIODS,type AggregateCandle,type SmaPeriod,type SmaPoint} from './multitimeframe.ts';

export type TechnicalSymbol='NVDA'|'QQQ'|'SMH';
export type TechnicalFrame='15m'|'1h'|'1d';
export type TechnicalBar={startUtc:string;endUtc:string;open:number;high:number;low:number;close:number;volume:number|null;provider:string;adjustment:string;receivedAtUtc:string|null;isComplete:boolean};
export type TechnicalSlope='RISING'|'FALLING'|'FLAT'|'UNAVAILABLE';
export type TechnicalPair='BULLISH_ALIGNMENT'|'BEARISH_ALIGNMENT'|'MIXED'|'INSUFFICIENT_DATA';
export type TechnicalInteraction='ABOVE'|'BELOW'|'EQUAL'|'CROSSED_ABOVE'|'CROSSED_BELOW'|'TOUCHED_FROM_ABOVE'|'TOUCHED_FROM_BELOW'|'REJECTED_ABOVE'|'REJECTED_BELOW'|'FULL_BODY_BREAK_ABOVE'|'FULL_BODY_BREAK_BELOW'|'FULL_CANDLE_BREAK_ABOVE'|'FULL_CANDLE_BREAK_BELOW';
export type TechnicalEventKind='CROSS'|'FULL_CANDLE_BREAK'|'RETEST'|'REJECTION'|'RECOVERY';
export type SmaTechnical={period:SmaPeriod;value:number|null;previousValue:number|null;slopePercent:number|null;slope:TechnicalSlope;priceDistancePercent:number|null;priceAboveSma:boolean|null;priceBelowSma:boolean|null;interactions:TechnicalInteraction[];availableAtUtc:string|null};
export type TimeframeTechnicalContext={timeframe:TechnicalFrame;lastCompleteBarUtc:string|null;lastBarStartUtc:string|null;scheduledAbbreviated:boolean|null;completeBarsInRun:number;smas:Record<SmaPeriod,SmaTechnical>;shortPair:TechnicalPair;longPair:TechnicalPair;state:TechnicalPair;limitations:string[]};
export type TechnicalEvent={timeframe:TechnicalFrame;kind:TechnicalEventKind;period:SmaPeriod;atUtc:string;barStartUtc:string;direction:'ABOVE'|'BELOW';status:'OBSERVED'|'PENDING'|'FAILED'|'EXPIRED';breakAtUtc:string|null;description:string};
export type TechnicalLevel={symbol:TechnicalSymbol;timeframe:TechnicalFrame;kind:'MOVING_AVERAGE'|'PREVIOUS_PERIOD_HIGH'|'PREVIOUS_PERIOD_LOW'|'PREVIOUS_SESSION_HIGH'|'PREVIOUS_SESSION_LOW';period:number|null;levelPrice:number;distancePercent:number|null;referenceStartUtc:string;referenceEndUtc:string;availableAtUtc:string;source:string;method:string;status:'POTENTIAL'};
export type PreviousRange={sessions:number;high:number|null;low:number|null;distanceToHighPercent:number|null;distanceToLowPercent:number|null;breakAboveHigh:boolean|null;breakBelowLow:boolean|null;referenceStartUtc:string|null;referenceEndUtc:string|null;status:'AVAILABLE'|'UNAVAILABLE'};
export type TechnicalContext={symbol:TechnicalSymbol;asOfUtc:string;source:string;provider:string;feed:string;adjustment:string;historicalOrSynthetic:'HISTORICAL'|'SYNTHETIC';dataStatus:'HISTORICAL'|'SYNTHETIC'|'STALE'|'UNAVAILABLE';lastCompleteBarUtc:string|null;ageMinutes:number|null;timeframes:Record<TechnicalFrame,TimeframeTechnicalContext>;alignment:'ALIGNED_BULLISH'|'ALIGNED_BEARISH'|'SHORT_TERM_PULLBACK'|'SHORT_TERM_RECOVERY'|'CONFLICTING'|'MIXED'|'INSUFFICIENT_DATA';previousRanges:PreviousRange[];levels:TechnicalLevel[];events:TechnicalEvent[];limitations:string[]};

const FRAME_ORDER:TechnicalFrame[]=['15m','1h','1d'];
const MS=15*60_000;
const blank=(period:SmaPeriod):SmaTechnical=>({period,value:null,previousValue:null,slopePercent:null,slope:'UNAVAILABLE',priceDistancePercent:null,priceAboveSma:null,priceBelowSma:null,interactions:[],availableAtUtc:null});
export const classifySmaPair=(a:number|null,b:number|null):TechnicalPair=>a===null||b===null?'INSUFFICIENT_DATA':a>b?'BULLISH_ALIGNMENT':a<b?'BEARISH_ALIGNMENT':'MIXED';
export const classifySmaSlope=(current:number|null,previous:number|null):{slope:TechnicalSlope;percent:number|null}=>{
  const percent=current!==null&&previous!==null&&previous!==0?(current-previous)/previous*100:null;
  return {slope:percent===null?'UNAVAILABLE':percent>0?'RISING':percent<0?'FALLING':'FLAT',percent};
};
const pct=(value:number,reference:number)=>reference===0?null:(value-reference)/reference*100;
const localMinute=(utc:string)=>{const [hour,minute]=newYorkBarParts(utc).slot.split(':').map(Number);return hour!*60+minute!;};

function adjacent(previous:AggregateCandle,current:AggregateCandle,calendar:MarketCalendar,days:string[]):boolean{
  if(previous.dateNy===current.dateNy)return previous.endTimestamp===current.timestamp;
  const previousHours=calendar.get(previous.dateNy),currentHours=calendar.get(current.dateNy);
  return !!previousHours&&!!currentHours&&days.indexOf(current.dateNy)===days.indexOf(previous.dateNy)+1&&
    localMinute(previous.endTimestamp)===previousHours.close&&localMinute(current.timestamp)===currentHours.open;
}

function withObservedAvailability(aggregates:AggregateCandle[],bars:readonly TechnicalBar[]):AggregateCandle[]{
  let index=0;
  return aggregates.map(aggregate=>{
    const start=Date.parse(aggregate.timestamp),end=Date.parse(aggregate.endTimestamp);
    while(index<bars.length&&Date.parse(bars[index]!.startUtc)<start)index++;
    let received=end,cursor=index;
    while(cursor<bars.length&&Date.parse(bars[cursor]!.startUtc)<end){
      const at=bars[cursor]!.receivedAtUtc;
      if(at)received=Math.max(received,Date.parse(at));
      cursor++;
    }
    index=cursor;
    return {...aggregate,availableAt:new Date(received).toISOString()};
  });
}

export function classifySmaInteraction(previous:{open:number;high:number;low:number;close:number}|null,bar:{open:number;high:number;low:number;close:number},previousSma:number|null,sma:number):TechnicalInteraction[]{
  const result:TechnicalInteraction[]=[bar.close>sma?'ABOVE':bar.close<sma?'BELOW':'EQUAL'];
  const prior=previous&&previousSma!==null?Math.sign(previous.close-previousSma):0;
  const current=Math.sign(bar.close-sma),touch=bar.low<=sma&&bar.high>=sma;
  if(prior<0&&current>0&&previous)result.push('CROSSED_ABOVE');
  if(prior>0&&current<0&&previous)result.push('CROSSED_BELOW');
  if(touch&&prior>0)result.push('TOUCHED_FROM_ABOVE');
  if(touch&&prior<0)result.push('TOUCHED_FROM_BELOW');
  if(touch&&prior>0&&current>0)result.push('REJECTED_ABOVE');
  if(touch&&prior<0&&current<0)result.push('REJECTED_BELOW');
  if(Math.min(bar.open,bar.close)>sma)result.push('FULL_BODY_BREAK_ABOVE');
  if(Math.max(bar.open,bar.close)<sma)result.push('FULL_BODY_BREAK_BELOW');
  if(bar.low>sma)result.push('FULL_CANDLE_BREAK_ABOVE');
  if(bar.high<sma)result.push('FULL_CANDLE_BREAK_BELOW');
  return result;
}

type Pending={direction:'ABOVE'|'BELOW';breakIndex:number;breakAtUtc:string;retested:boolean};
export function detectSmaEvents(points:readonly SmaPoint[],frame:TechnicalFrame):TechnicalEvent[]{
  const events:TechnicalEvent[]=[];
  for(const period of SMA_PERIODS){
    let pending:Pending|null=null;
    for(let i=1;i<points.length;i++){
      const point=points[i]!,prior=points[i-1]!,value=point.values[period],previousValue=prior.values[period];
      if(value===null||previousValue===null)continue;
      const atUtc=point.candle.availableAt,barStartUtc=point.candle.timestamp;
      const interaction=classifySmaInteraction(prior.candle,point.candle,previousValue,value);
      const emit=(kind:TechnicalEventKind,direction:'ABOVE'|'BELOW',status:TechnicalEvent['status'],breakAtUtc:string|null,description:string)=>
        events.push({timeframe:frame,kind,period,atUtc,barStartUtc,direction,status,breakAtUtc,description});
      if(pending){
        const barsAfterBreak=i-pending.breakIndex;
        const side=pending.direction==='ABOVE'?point.candle.close>value:point.candle.close<value;
        const touches=point.candle.low<=value&&point.candle.high>=value;
        if(!side){emit('RECOVERY',pending.direction,'FAILED',pending.breakAtUtc,'La ruptura regresó al lado anterior.');pending=null;}
        else if(touches){
          pending.retested=true;
          emit('RETEST',pending.direction,'OBSERVED',pending.breakAtUtc,'Regreso al nivel y cierre del lado de la ruptura.');
          pending=null;
        }else if(barsAfterBreak>=4){
          emit('RETEST',pending.direction,'EXPIRED',pending.breakAtUtc,'Sin retesteo confirmado en las cuatro velas cerradas siguientes.');
          pending=null;
        }
      }
      if(interaction.includes('CROSSED_ABOVE')||interaction.includes('CROSSED_BELOW')){
        const direction=interaction.includes('CROSSED_ABOVE')?'ABOVE':'BELOW';
        emit('CROSS',direction,'OBSERVED',null,'Cruce de cierres respecto a las SMA vigentes.');
        pending={direction,breakIndex:i,breakAtUtc:atUtc,retested:false};
      }
      // Keep the per-candle geometric interaction, but emit a break event only
      // when the candle first enters that state. Continued residence is not a new break.
      const previousWasFullAbove=prior.candle.low>previousValue;
      const previousWasFullBelow=prior.candle.high<previousValue;
      if(interaction.includes('FULL_CANDLE_BREAK_ABOVE')&&!previousWasFullAbove)emit('FULL_CANDLE_BREAK','ABOVE','OBSERVED',null,'Primera vela entera sobre la SMA tras no estarlo en la vela anterior.');
      if(interaction.includes('FULL_CANDLE_BREAK_BELOW')&&!previousWasFullBelow)emit('FULL_CANDLE_BREAK','BELOW','OBSERVED',null,'Primera vela entera bajo la SMA tras no estarlo en la vela anterior.');
      if(interaction.includes('REJECTED_ABOVE'))emit('REJECTION','ABOVE','OBSERVED',null,'Toque y cierre sobre la SMA.');
      if(interaction.includes('REJECTED_BELOW'))emit('REJECTION','BELOW','OBSERVED',null,'Toque y cierre bajo la SMA.');
    }
    if(pending&&points.length-1-pending.breakIndex<4){const p=points.at(-1)!;events.push({timeframe:frame,kind:'RETEST',period,atUtc:p.candle.availableAt,barStartUtc:p.candle.timestamp,direction:pending.direction,status:'PENDING',breakAtUtc:pending.breakAtUtc,description:'Ruptura observada; retesteo aún no confirmado dentro de las cuatro velas siguientes.'});}
  }
  return events;
}

function frameContext(frame:TechnicalFrame,aggregates:AggregateCandle[],calendar:MarketCalendar,asOfUtc:string){
  const days=[...calendar.keys()].sort();let run:AggregateCandle[]=[],lastRun:AggregateCandle[]=[];
  for(const candle of aggregates){
    if(Date.parse(candle.availableAt)>Date.parse(asOfUtc))break;
    if(!candle.complete){run=[];continue;}
    if(run.length&&!adjacent(run.at(-1)!,candle,calendar,days))run=[];
    run.push(candle);lastRun=run;
  }
  const allPoints=calculateSmaPoints(lastRun);
  const previousPoint=allPoints.at(-2)??null,lastPoint=lastAvailableSmaPoint(allPoints,asOfUtc);
  const latest=lastPoint?.candle??null,prior=previousPoint?.candle??null;
  const smas={} as Record<SmaPeriod,SmaTechnical>;
  for(const period of SMA_PERIODS){
    const value=lastPoint?.values[period]??null,previousValue=previousPoint?.values[period]??null;
    const slope=classifySmaSlope(value,previousValue);
    smas[period]={...blank(period),value,previousValue,slopePercent:slope.percent,slope:slope.slope,
      priceDistancePercent:value!==null&&latest?pct(latest.close,value):null,priceAboveSma:value!==null&&latest?latest.close>value:null,priceBelowSma:value!==null&&latest?latest.close<value:null,
      interactions:value!==null&&latest?classifySmaInteraction(prior,latest,previousValue,value):[],availableAtUtc:value!==null?latest?.availableAt??null:null};
  }
  const shortPair=classifySmaPair(smas[20].value,smas[40].value),longPair=classifySmaPair(smas[100].value,smas[200].value);
  const state=shortPair==='INSUFFICIENT_DATA'||longPair==='INSUFFICIENT_DATA'?'INSUFFICIENT_DATA':shortPair===longPair?shortPair:'MIXED';
  const limitations:string[]=[];
  if(!latest)limitations.push('No hay vela completa y continua disponible.');
  if(Object.values(smas).some(s=>s.value===null))limitations.push('Historial continuo insuficiente para todas las SMA.');
  if(aggregates.some(c=>!c.complete&&Date.parse(c.availableAt)<=Date.parse(asOfUtc)))limitations.push('Hay agregados incompletos; las SMA se reinician después de un hueco.');
  const context:TimeframeTechnicalContext={timeframe:frame,lastCompleteBarUtc:latest?.endTimestamp??null,lastBarStartUtc:latest?.timestamp??null,scheduledAbbreviated:latest?.scheduledAbbreviated??null,completeBarsInRun:lastRun.length,smas,shortPair,longPair,state,limitations};
  return {context,events:detectSmaEvents(allPoints.slice(-205),frame),last:latest};
}

export function classifyTimeframeAlignment(frames:Record<TechnicalFrame,Pick<TimeframeTechnicalContext,'state'>>):TechnicalContext['alignment']{
  const [short,hour,day]=FRAME_ORDER.map(f=>frames[f].state);
  if([short,hour,day].includes('INSUFFICIENT_DATA'))return 'INSUFFICIENT_DATA';
  if(short===hour&&hour===day&&short==='BULLISH_ALIGNMENT')return 'ALIGNED_BULLISH';
  if(short===hour&&hour===day&&short==='BEARISH_ALIGNMENT')return 'ALIGNED_BEARISH';
  if(short==='BEARISH_ALIGNMENT'&&hour===day&&day==='BULLISH_ALIGNMENT')return 'SHORT_TERM_PULLBACK';
  if(short==='BULLISH_ALIGNMENT'&&hour===day&&day==='BEARISH_ALIGNMENT')return 'SHORT_TERM_RECOVERY';
  if(short==='MIXED'||hour==='MIXED'||day==='MIXED')return 'MIXED';
  return 'CONFLICTING';
}

function expectedBarMissing(lastEndUtc:string|null,asOfUtc:string,calendar:MarketCalendar):boolean{
  const date=newYorkBarParts(asOfUtc).day,minute=localMinute(asOfUtc),days=[...calendar.keys()].sort();
  const current=calendar.get(date),priorDay=days.filter(d=>d<date).at(-1);
  let expectedDay:string|undefined,expectedMinute:number|undefined;
  if(current){
    const completeMinutes=Math.max(0,Math.min(current.close-current.open,Math.floor((minute-current.open)/15)*15));
    if(completeMinutes>0){expectedDay=date;expectedMinute=current.open+completeMinutes;}
  }
  if(!expectedDay&&priorDay){expectedDay=priorDay;expectedMinute=calendar.get(priorDay)!.close;}
  if(!expectedDay||expectedMinute===undefined)return false;
  return !lastEndUtc||newYorkBarParts(lastEndUtc).day!==expectedDay||localMinute(lastEndUtc)<expectedMinute;
}

export function buildInvestepTechnicalContext(input:{symbol:TechnicalSymbol;asOfUtc:string;bars:readonly TechnicalBar[];calendar:MarketCalendar|null;provider:string;feed:string;adjustment:string;historicalOrSynthetic:'HISTORICAL'|'SYNTHETIC'}):TechnicalContext{
  const {symbol,asOfUtc,calendar,provider,feed,adjustment,historicalOrSynthetic}=input;
  const cutoff=Date.parse(asOfUtc);if(!Number.isFinite(cutoff))throw new Error('asOfUtc inválido');
  const source=`${provider} · ${feed} · ${adjustment}`;
  const limitations:string[]=[];
  const empty=():TimeframeTechnicalContext=>({timeframe:'15m',lastCompleteBarUtc:null,lastBarStartUtc:null,scheduledAbbreviated:null,completeBarsInRun:0,
    smas:Object.fromEntries(SMA_PERIODS.map(p=>[p,blank(p)])) as Record<SmaPeriod,SmaTechnical>,shortPair:'INSUFFICIENT_DATA',longPair:'INSUFFICIENT_DATA',state:'INSUFFICIENT_DATA',limitations:['Datos no disponibles.']});
  const timeframes:Record<TechnicalFrame,TimeframeTechnicalContext>={ '15m':empty(),'1h':{...empty(),timeframe:'1h'},'1d':{...empty(),timeframe:'1d'}};
  const base:TechnicalContext={symbol,asOfUtc,source,provider,feed,adjustment,historicalOrSynthetic,dataStatus:'UNAVAILABLE',lastCompleteBarUtc:null,ageMinutes:null,timeframes,alignment:'INSUFFICIENT_DATA',previousRanges:[],levels:[],events:[],limitations};
  if(!calendar?.size){limitations.push('Calendario de sesiones no disponible; no se calculan agregados ni niveles.');return base;}
  const candidates=input.bars.filter(b=>Date.parse(b.endUtc)<=cutoff);let prior=-Infinity;
  for(const bar of candidates){const start=Date.parse(bar.startUtc),end=Date.parse(bar.endUtc);
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<=prior||end-start!==MS||
      (bar.receivedAtUtc!==null&&(!Number.isFinite(Date.parse(bar.receivedAtUtc))||Date.parse(bar.receivedAtUtc)<end))||bar.provider!==provider||bar.adjustment!==adjustment||
      ![bar.open,bar.high,bar.low,bar.close].every(x=>Number.isFinite(x)&&x>0)||bar.high<Math.max(bar.open,bar.close,bar.low)||bar.low>Math.min(bar.open,bar.close)||
      bar.volume===null||!Number.isFinite(bar.volume)||bar.volume<0)throw new Error('Fuente, orden, disponibilidad u OHLCV incompatible.');
    const date=newYorkBarParts(bar.startUtc).day,session=calendar.get(date),minute=localMinute(bar.startUtc);
    if(!session||minute<session.open||minute+15>session.close)throw new Error('Vela fuera del calendario oficial.');
    prior=start;
  }
  const bars=candidates.filter(b=>b.isComplete&&(b.receivedAtUtc===null||Date.parse(b.receivedAtUtc)<=cutoff));
  if(!bars.length){limitations.push('No hay velas completas disponibles al instante solicitado.');return base;}
  const candles:Candle[]=bars.map(b=>({timestamp:b.startUtc,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume!}));
  const make15=(bar:Candle):AggregateCandle=>({ ...bar,endTimestamp:new Date(Date.parse(bar.timestamp)+MS).toISOString(),availableAt:new Date(Date.parse(bar.timestamp)+MS).toISOString(),dateNy:newYorkBarParts(bar.timestamp).day,
    timeframe:'hour',durationMinutes:15,expectedSourceBars:1,observedSourceBars:1,complete:true,scheduledAbbreviated:false});
  const aggregated:Record<TechnicalFrame,AggregateCandle[]>={
    '15m':withObservedAvailability(candles.map(make15),bars),
    '1h':withObservedAvailability(buildHourlyCandles(candles,calendar),bars),
    '1d':withObservedAvailability(buildDailyCandles(candles,calendar),bars),
  };
  const latest:Partial<Record<TechnicalFrame,AggregateCandle>>={};
  for(const frame of FRAME_ORDER){const result=frameContext(frame,aggregated[frame],calendar,asOfUtc);timeframes[frame]=result.context;latest[frame]=result.last??undefined;base.events.push(...result.events);}
  base.alignment=classifyTimeframeAlignment(timeframes);
  base.lastCompleteBarUtc=timeframes['15m'].lastCompleteBarUtc;
  base.ageMinutes=base.lastCompleteBarUtc?(cutoff-Date.parse(base.lastCompleteBarUtc))/60_000:null;
  const missingExpected=expectedBarMissing(base.lastCompleteBarUtc,asOfUtc,calendar);
  base.dataStatus=historicalOrSynthetic==='SYNTHETIC'?'SYNTHETIC':missingExpected||base.ageMinutes!==null&&base.ageMinutes>7*24*60?'STALE':'HISTORICAL';
  if(base.dataStatus==='STALE')limitations.push(missingExpected?'Faltan velas programadas y cerradas antes del corte; la fuente no describe el estado actual.':'El último cierre histórico tiene más de siete días; no describe el mercado actual.');
  if(!timeframes['1d'].lastCompleteBarUtc)limitations.push('No existe una sesión diaria completa antes del corte.');
  for(const frame of FRAME_ORDER){const bar=latest[frame];if(!bar)continue;for(const period of SMA_PERIODS){const sma=timeframes[frame].smas[period];if(sma.value===null||!sma.availableAtUtc)continue;
    base.levels.push({symbol,timeframe:frame,kind:'MOVING_AVERAGE',period,levelPrice:sma.value,distancePercent:pct(bar.close,sma.value),referenceStartUtc:bar.timestamp,referenceEndUtc:bar.endTimestamp,availableAtUtc:sma.availableAtUtc,source,method:`SMA${period} de cierres completos y continuos`,status:'POTENTIAL'});
  }}
  const asOfDay=newYorkBarParts(asOfUtc).day;
  const daily=aggregated['1d'].filter(d=>d.complete&&d.dateNy<asOfDay&&Date.parse(d.availableAt)<=cutoff);
  const calendarDays=[...calendar.keys()].filter(d=>d<asOfDay).sort();
  const latestDay=daily.at(-1),referencePrice=latest['15m']?.close??null;
  for(const sessions of [5,20,60]){
    const expected=calendarDays.slice(-sessions),window=daily.filter(d=>expected.includes(d.dateNy));
    const available=expected.length===sessions&&window.length===sessions&&window.every((d,i)=>d.dateNy===expected[i]);
    const first=available?window[0]!:null,last=available?window.at(-1)!:null;
    const high=available?Math.max(...window.map(d=>d.high)):null,low=available?Math.min(...window.map(d=>d.low)):null;
    base.previousRanges.push({sessions,high,low,distanceToHighPercent:high!==null&&referencePrice!==null?pct(referencePrice,high):null,
      distanceToLowPercent:low!==null&&referencePrice!==null?pct(referencePrice,low):null,
      breakAboveHigh:high!==null&&referencePrice!==null?referencePrice>high:null,breakBelowLow:low!==null&&referencePrice!==null?referencePrice<low:null,
      referenceStartUtc:first?.timestamp??null,referenceEndUtc:last?.endTimestamp??null,status:available?'AVAILABLE':'UNAVAILABLE'});
    if(available&&first&&last&&high!==null&&low!==null){for(const [kind,price] of [['PREVIOUS_PERIOD_HIGH',high],['PREVIOUS_PERIOD_LOW',low]] as const)
      base.levels.push({symbol,timeframe:'1d',kind,period:sessions,levelPrice:price,distancePercent:referencePrice!==null?pct(referencePrice,price):null,
        referenceStartUtc:first.timestamp,referenceEndUtc:last.endTimestamp,availableAtUtc:last.availableAt,source,method:`Extremo de ${sessions} sesiones completas previas`,status:'POTENTIAL'});
    }
  }
  if(latestDay&&calendarDays.at(-1)===latestDay.dateNy){for(const [kind,price] of [['PREVIOUS_SESSION_HIGH',latestDay.high],['PREVIOUS_SESSION_LOW',latestDay.low]] as const)
    base.levels.push({symbol,timeframe:'1d',kind,period:1,levelPrice:price,distancePercent:referencePrice!==null?pct(referencePrice,price):null,
      referenceStartUtc:latestDay.timestamp,referenceEndUtc:latestDay.endTimestamp,availableAtUtc:latestDay.availableAt,source,method:'Extremo de la sesión anterior completa',status:'POTENTIAL'});
  }
  if(base.previousRanges.some(r=>r.status==='UNAVAILABLE'))limitations.push('Algunas ventanas de sesiones previas están incompletas o carecen de calendario.');
  return base;
}
