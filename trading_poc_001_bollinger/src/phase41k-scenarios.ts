import {createHash} from 'node:crypto';
import type {TechnicalContext,InvestepScenario,InvestepScenarioResponse} from '@trading-poc/contracts';

type Frame='15m'|'1h'|'1d';
type Event=TechnicalContext['events'][number];
type Metrics={close:number;bollingerUpper:number|null;bollingerMiddle:number|null;bollingerLower:number|null;
  relativeVolume20:number|null;returnOneBarPercent:number|null;returnFourBarsPercent:number|null};
const frames:Frame[]=['15m','1h','1d'];
const note='Escenarios técnicos descriptivos de la última vela disponible. No son predicciones, probabilidades ni señales CALL/PUT.';
const hash=(parts:unknown[])=>createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const pairOpposes=(pair:string,direction:'ABOVE'|'BELOW')=>direction==='ABOVE'?pair==='BEARISH_ALIGNMENT':pair==='BULLISH_ALIGNMENT';

/** Composición causal de evidencia ya calculada por 41A y Radar. No recalcula indicadores. */
export function buildInvestepScenarios(context:TechnicalContext,metrics:Metrics|null,receiptVerified=false,
  dataAvailableAtUtc:string|null=null):InvestepScenarioResponse{
  const source={name:context.source,provider:context.provider,feed:context.feed,adjustment:context.adjustment,
    dataStatus:context.dataStatus,receiptVerified};
  const frameContext=Object.fromEntries(frames.map(timeframe=>{
    const frame=context.timeframes[timeframe];
    return [timeframe,{timeframe,barEndUtc:frame.lastCompleteBarUtc,shortPair:frame.shortPair,longPair:frame.longPair,state:frame.state,
      smas:Object.fromEntries(([20,40,100,200] as const).map(period=>[period,{value:frame.smas[period].value,slope:frame.smas[period].slope,
        priceDistancePercent:frame.smas[period].priceDistancePercent,priceAboveSma:frame.smas[period].priceAboveSma,
        priceBelowSma:frame.smas[period].priceBelowSma}]))}];
  })) as InvestepScenarioResponse['frames'];
  const visibleLevels=context.levels.filter(level=>Date.parse(level.availableAtUtc)<=Date.parse(context.asOfUtc));
  const limitations=[...context.limitations];
  if(!receiptVerified)limitations.push('No existe evidencia verificada de recepción para todas las velas: availableAtUtc se deja sin determinar.');
  if(context.dataStatus==='HISTORICAL'||context.dataStatus==='STALE')limitations.push('La última vela disponible es histórica u obsoleta; ningún escenario representa el mercado actual.');
  if(context.dataStatus==='SYNTHETIC')limitations.push('Los datos son sintéticos y solo sirven para demostrar la interfaz.');
  const common={symbol:context.symbol,asOfUtc:context.asOfUtc,source,feed:context.feed,adjustment:context.adjustment,
    dataStatus:context.dataStatus};
  const presentContext={alignment:context.alignment,frames:frameContext};
  function contextAt(event:Event,knownAtUtc:string):InvestepScenario['context']{
    const eventTime=Date.parse(knownAtUtc);
    const available=Object.fromEntries(frames.map(timeframe=>{
      const item=frameContext[timeframe],technical=context.timeframes[timeframe];
      const known=item.barEndUtc!==null&&Date.parse(item.barEndUtc)<=eventTime&&
        ([20,40,100,200] as const).every(period=>technical.smas[period].value===null||
          technical.smas[period].availableAtUtc!==null&&Date.parse(technical.smas[period].availableAtUtc!)<=eventTime);
      return [timeframe,known?item:{...item,barEndUtc:null,shortPair:'INSUFFICIENT_DATA',longPair:'INSUFFICIENT_DATA',
        state:'INSUFFICIENT_DATA',smas:Object.fromEntries(([20,40,100,200] as const).map(period=>[period,
          {value:null,slope:'UNAVAILABLE',priceDistancePercent:null,priceAboveSma:null,priceBelowSma:null}]))}];
    })) as InvestepScenarioResponse['frames'];
    const complete=frames.every(timeframe=>available[timeframe].barEndUtc!==null);
    return {alignment:complete?context.alignment:'INSUFFICIENT_DATA',frames:available};
  }

  function eventScenario(event:Event,scope:'CURRENT'|'HISTORICAL'):InvestepScenario{
    const family=event.kind==='REJECTION'?'SMA_PULLBACK_REJECTION':event.kind==='CROSS'||event.kind==='FULL_CANDLE_BREAK'?
      'SMA_STRUCTURE_BREAK':'SMA_BREAK_RETEST';
    const state=event.status==='PENDING'?'AWAITING_CONFIRMATION':event.status;
    const availableAtUtc=receiptVerified?new Date(Math.max(Date.parse(event.atUtc),Date.parse(dataAvailableAtUtc??event.atUtc))).toISOString():null;
    const eventContext=scope==='CURRENT'?contextAt(event,availableAtUtc??event.atUtc):null;
    const contradictions:InvestepScenario['contradictions']=[];
    for(const timeframe of frames){
      const frame=eventContext?.frames[timeframe];if(!frame||frame.barEndUtc===null)continue;
      if(pairOpposes(frame.shortPair,event.direction))contradictions.push({timeframe,component:'SMA20_40',
        detail:`La pareja SMA20/40 de ${timeframe} conserva orden opuesto a la dirección ${event.direction}.`});
      if(pairOpposes(frame.longPair,event.direction))contradictions.push({timeframe,component:'SMA100_200',
        detail:`La pareja SMA100/200 de ${timeframe} conserva orden opuesto a la dirección ${event.direction}.`});
    }
    const trigger={kind:event.kind,description:event.description,barStartUtc:event.barStartUtc,observedAtUtc:event.atUtc,availableAtUtc};
    const relatedLevels=scope==='CURRENT'?visibleLevels.filter(level=>level.timeframe===event.timeframe&&level.kind==='MOVING_AVERAGE'&&
      level.period===event.period&&Date.parse(level.availableAtUtc)<=Date.parse(availableAtUtc??event.atUtc)&&
      Date.parse(level.referenceEndUtc)<=Date.parse(event.atUtc)).slice(0,8):[];
    const eventLimitations:string[]=[];
    if(!receiptVerified)eventLimitations.push('La hora original de recepción de la evidencia no está verificada.');
    if(scope==='HISTORICAL')eventLimitations.push('No se reconstruyeron medias, contradicciones ni niveles al instante histórico del evento.');
    else if(eventContext?.alignment==='INSUFFICIENT_DATA'&&context.alignment!=='INSUFFICIENT_DATA')
      eventLimitations.push('Una o más temporalidades de la consulta son posteriores al evento y se ocultan en este escenario.');
    if(state==='AWAITING_CONFIRMATION')eventLimitations.push('Retesteo pendiente: 41A todavía no confirmó ni descartó el evento.');
    if(state==='FAILED'||state==='EXPIRED')eventLimitations.push('El evento falló o expiró según la ventana causal de 41A.');
    const episode=event.kind==='RETEST'||event.kind==='RECOVERY'?event.breakAtUtc:event.barStartUtc;
    const identityKind=event.kind==='RECOVERY'?'RETEST':event.kind;
    return {...common,context:eventContext,id:hash([context.symbol,family,identityKind,event.timeframe,event.period,event.direction,episode]),family,
      timeframe:event.timeframe,direction:event.direction,state,scope,period:event.period,breakAtUtc:event.breakAtUtc,
      barsSinceBreak:null,eventAtUtc:event.atUtc,availableAtUtc,trigger,confirmations:state==='OBSERVED'?[trigger]:[],
      contradictions,limitations:eventLimitations,relatedLevels,bollingerVolume:null};
  }
  const current:InvestepScenario[]=[],historical:InvestepScenario[]=[];
  for(const event of context.events){
    const scope=context.timeframes[event.timeframe].lastBarStartUtc===event.barStartUtc?'CURRENT':'HISTORICAL';
    (scope==='CURRENT'?current:historical).push(eventScenario(event,scope));
  }
  const fifteen=context.timeframes['15m'];
  if(metrics&&fifteen.lastBarStartUtc&&fifteen.lastCompleteBarUtc&&Number.isFinite(metrics.close)&&metrics.close>0){
    const {bollingerUpper:upper,bollingerLower:lower,bollingerMiddle:middle}=metrics;
    const complete=upper!==null&&lower!==null&&middle!==null&&[upper,lower,middle].every(Number.isFinite)&&
      upper>lower&&middle>0;
    const position=!complete?'UNAVAILABLE':metrics.close>upper!?'ABOVE_UPPER':metrics.close<lower!?'BELOW_LOWER':
      metrics.close===upper||metrics.close===lower?'ON_BAND':'INSIDE';
    const direction=position==='ABOVE_UPPER'?'ABOVE':position==='BELOW_LOWER'?'BELOW':'NEUTRAL';
    const availableAtUtc=receiptVerified&&dataAvailableAtUtc!==null&&
      Date.parse(dataAvailableAtUtc)<=Date.parse(context.asOfUtc)?dataAvailableAtUtc:null;
    const trigger={kind:'BOLLINGER_VOLUME' as const,description:'Posición de la última vela frente a Bollinger 20/2 y volumen relativo calculados por Radar.',
      barStartUtc:fifteen.lastBarStartUtc,observedAtUtc:fifteen.lastCompleteBarUtc,availableAtUtc};
    const limitationsForContext=['El volumen relativo y las bandas describen contexto; no establecen una regla operativa ni una ventaja estadística.'];
    if(!complete)limitationsForContext.push('La banda de Bollinger está incompleta para esta observación.');
    if(metrics.relativeVolume20===null)limitationsForContext.push('El historial de volumen no permite calcular RVOL.');
    current.push({...common,context:presentContext,id:hash([context.symbol,'BOLLINGER_VOLUME_CONTEXT',fifteen.lastBarStartUtc]),family:'BOLLINGER_VOLUME_CONTEXT',
      timeframe:'15m',direction,state:complete?'OBSERVED':'INSUFFICIENT_DATA',scope:'CURRENT',period:20,
      breakAtUtc:null,barsSinceBreak:null,eventAtUtc:fifteen.lastCompleteBarUtc,availableAtUtc,trigger,
      confirmations:complete?[trigger]:[],contradictions:[],limitations:limitationsForContext,relatedLevels:[],
      bollingerVolume:{close:metrics.close,upper,middle,lower,position,relativeVolume20:metrics.relativeVolume20,
        returnOneBarPercent:metrics.returnOneBarPercent,returnFourBarsPercent:metrics.returnFourBarsPercent}});
  }
  const sort=(a:InvestepScenario,b:InvestepScenario)=>Date.parse(b.eventAtUtc)-Date.parse(a.eventAtUtc)||
    frames.indexOf(a.timeframe)-frames.indexOf(b.timeframe)||a.family.localeCompare(b.family)||
    (a.period??0)-(b.period??0)||a.id.localeCompare(b.id);
  current.sort(sort);historical.sort(sort);
  const unique=(rows:InvestepScenario[])=>Array.from(new Map(rows.map(row=>[row.id,row])).values());
  const currentRows=unique(current).slice(0,40),currentIds=new Set(currentRows.map(row=>row.id));
  const historicalRows=unique(historical).filter(row=>!currentIds.has(row.id)).slice(0,50);
  const status=context.dataStatus==='UNAVAILABLE'?'UNAVAILABLE':context.timeframes['15m'].lastCompleteBarUtc===null?
    'INSUFFICIENT_DATA':currentRows.length===0?'NO_SCENARIO':currentRows.every(row=>row.state==='INSUFFICIENT_DATA')?
      'INSUFFICIENT_DATA':'AVAILABLE';
  return {status,symbol:context.symbol,asOfUtc:context.asOfUtc,source,alignment:context.alignment,frames:frameContext,
    current:currentRows,historical:historicalRows,levels:visibleLevels.slice(0,1000),previousRanges:context.previousRanges,limitations,note};
}
