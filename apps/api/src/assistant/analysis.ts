import type {MarketBar} from '@trading-poc/contracts';
import {calculateIndicators} from '@trading-poc/market-domain';
import {calculateVolumeReferences} from '../../../../trading_poc_001_bollinger/src/volume-filter.ts';
import {newYorkBarParts} from '../../../../trading_poc_001_bollinger/src/strategy-validation.ts';
import type {Candle} from '../../../../trading_poc_001_bollinger/src/domain.ts';
import type {MarketCalendar} from '../../../../trading_poc_001_bollinger/src/alpaca-calendar.ts';

const BAR_MS=15*60_000;
const pct=(value:number,base:number)=>!Number.isFinite(value)||!Number.isFinite(base)||base<=0?null:(value/base-1)*100;
const fixed=(value:number|null,digits=2)=>value===null||!Number.isFinite(value)?'N/D':`${value.toFixed(digits)}%`;
const exchangeClock=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});

function localDay(timestamp:string):string{return newYorkBarParts(timestamp).day;}
function localSessionStartUtc(day:string,minute:number):number{
  const [year,month,date]=day.split('-').map(Number),hour=Math.floor(minute/60),mins=minute%60;
  const wanted=Date.UTC(year!,month!-1,date!,hour,mins),parts=Object.fromEntries(exchangeClock.formatToParts(new Date(wanted)).map(p=>[p.type,p.value]));
  const represented=Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),Number(parts.hour),Number(parts.minute));
  return wanted+(wanted-represented);
}
function expectedSessionStarts(day:string,open:number,close:number,through:number):number[]{
  const starts:number[]=[];for(let minute=open;minute<close&&minute<=through;minute+=15)starts.push(localSessionStartUtc(day,minute));return starts;
}

export type AnalysisMetrics={close:number;sma20:number|null;sma40:number|null;sma100:number|null;sma200:number|null;
  distanceSma20Percent:number|null;distanceSma40Percent:number|null;distanceSma100Percent:number|null;distanceSma200Percent:number|null;
  bollingerUpper:number|null;bollingerMiddle:number|null;bollingerLower:number|null;bollingerPositionPercent:number|null;
  bollingerWidthPercent:number|null;distanceUpperBandWidthPercent:number|null;distanceLowerBandWidthPercent:number|null;
  returnOneBarPercent:number|null;returnFourBarsPercent:number|null;relativeVolume20:number|null;volumeReference:number|null;
  volumeReferenceSessions:number;volumeMatchingSessions:number;};
export type MetricObservation={key:keyof AnalysisMetrics;value:number|null;unit:'USD'|'percent'|'ratio'|'shares'|'sessions';period:string;timestampUtc:string|null;
  availability:'AVAILABLE'|'INSUFFICIENT_HISTORY'|'INCOMPLETE_WINDOW'|'INVALID_DENOMINATOR';};
export type MarketAnalysis={asset:string;source:string;dataType:'SYNTHETIC'|'HISTORICAL';availability:'AVAILABLE'|'HISTORICAL_ONLY'|'UNAVAILABLE';dateUtc:string|null;timeframe:'15m';
  metrics:AnalysisMetrics|null;observations:MetricObservation[];sections:Array<{title:string;items:string[]}>;limitations:string[];
  continuity:{calendarAvailable:boolean;consecutiveBars:number;policy:'EXCHANGE_CALENDAR'|'CURRENT_SESSION_ONLY'};};

function validateBars(bars:readonly MarketBar[]):void{
  let prior=-Infinity;
  for(const bar of bars){
    const start=Date.parse(bar.startUtc),end=Date.parse(bar.endUtc);
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<=prior||end-start!==BAR_MS||
      bar.timeframe!=='15m'||![bar.open,bar.high,bar.low,bar.close].every(v=>Number.isFinite(v)&&v>0)||
      bar.high<Math.max(bar.open,bar.close,bar.low)||bar.low>Math.min(bar.open,bar.close)||
      (bar.volume!==null&&(!Number.isFinite(bar.volume)||bar.volume<0)))throw new Error('Velas incompletas, inválidas o fuera de orden.');
    prior=start;
  }
}
function continuousWindow(window:readonly MarketBar[]):boolean{
  if(window.length<2)return false;
  const day=newYorkBarParts(window.at(-1)!.startUtc).day;
  return window.every((bar,i)=>newYorkBarParts(bar.startUtc).day===day&&
    (i===0||Date.parse(bar.startUtc)-Date.parse(window[i-1]!.startUtc)===BAR_MS));
}

/**
 * Indicators use only a verified continuous suffix. A supplied exchange calendar
 * identifies holidays and early closes; without one, history is conservatively
 * limited to the current NY session. Missing or incomplete expected bars break
 * the suffix, so no SMA/Bollinger window is stitched across a data gap.
 */
function continuousSuffix(input:readonly MarketBar[],calendar?:MarketCalendar|null):{bars:MarketBar[];gapDetected:boolean}{
  const completeByStart=new Map(input.filter(bar=>bar.isComplete).map(bar=>[Date.parse(bar.startUtc),bar]));
  const latest=input.at(-1);if(!latest)return {bars:[],gapDetected:false};
  const latestDay=localDay(latest.startUtc);
  const starts:number[]=[],lowerBound=Date.parse(input[0]!.startUtc);
  if(calendar){
    const firstDay=localDay(input[0]!.startUtc);
    for(const [day,hours] of [...calendar].sort(([a],[b])=>a.localeCompare(b))){
      if(day<firstDay||day>latestDay)continue;
      const localThrough=day===latestDay?newYorkBarParts(latest.startUtc).slot.split(':').map(Number).reduce((h,m)=>h*60+m,0):hours.close-15;
      starts.push(...expectedSessionStarts(day,hours.open,hours.close,localThrough).filter(start=>start>=lowerBound));
    }
  }else{
    const sessionBars=input.filter(bar=>localDay(bar.startUtc)===latestDay);
    if(!sessionBars.length)return {bars:[],gapDetected:false};
    const latestMinute=newYorkBarParts(latest.startUtc).slot.split(':').map(Number).reduce((h,m)=>h*60+m,0);
    starts.push(...expectedSessionStarts(latestDay,9*60+30,16*60,latestMinute).filter(start=>start>=Math.max(lowerBound,localSessionStartUtc(latestDay,9*60+30))));
  }
  let suffix:MarketBar[]=[],gapDetected=false;
  for(const start of starts){
    const bar=completeByStart.get(start);
    if(!bar){suffix=[];gapDetected=true;continue;}
    suffix.push(bar);
  }
  return {bars:suffix,gapDetected};
}

/** Pure, deterministic descriptions from complete 15-minute bars known at their close. */
export function analyzeMarketBars(asset:string,source:string,dataType:'SYNTHETIC'|'HISTORICAL',inputBars:readonly MarketBar[],asOfUtc?:string,calendar?:MarketCalendar|null):MarketAnalysis{
  const asOf=asOfUtc===undefined?Infinity:Date.parse(asOfUtc);if(!Number.isFinite(asOf)&&asOf!==Infinity)throw new Error('Instante de análisis inválido.');
  const available=inputBars.filter(bar=>Number.isFinite(Date.parse(bar.endUtc))&&Date.parse(bar.endUtc)<=asOf);
  validateBars(available);
  const latest=available.filter(bar=>bar.isComplete).at(-1);
  if(!latest)return {asset,source,dataType,availability:'UNAVAILABLE',dateUtc:null,timeframe:'15m',metrics:null,observations:[],
    sections:[{title:'Datos observados',items:[`${asset}: no hay velas completas disponibles.`]}],limitations:['No se pueden interpretar indicadores sin velas completas.'],
    continuity:{calendarAvailable:Boolean(calendar),consecutiveBars:0,policy:calendar?'EXCHANGE_CALENDAR':'CURRENT_SESSION_ONLY'}};
  const eligible=available.filter(bar=>Date.parse(bar.endUtc)<=Date.parse(latest.endUtc));
  const continuityCheck=continuousSuffix(eligible,calendar),bars=continuityCheck.bars;
  const last=latest;
  const tail=bars.at(-1);
  const suffixMatchesLatest=tail?.startUtc===latest.startUtc;
  const indicatorBars=suffixMatchesLatest?bars:[];
  const points=calculateIndicators(indicatorBars.slice(-200)),point=points.at(-1);
  const close=last.close,width=point?.bbUpper!=null&&point.bbLower!=null?point.bbUpper-point.bbLower:null;
  const prior=eligible.length>=2?eligible.slice(-2):[],oneContiguous=prior.length===2&&prior.every(bar=>bar.isComplete)&&continuousWindow(prior);
  const oneReturn=oneContiguous?pct(close,prior[0]!.close):null;
  const four=eligible.length>=5?eligible.slice(-5):[],fourReturn=four.length===5&&four.every(bar=>bar.isComplete)&&continuousWindow(four)?pct(close,four[0]!.close):null;
  let volumeReference:number|null=null,relativeVolume20:number|null=null,volumeReferenceSessions=0,volumeMatchingSessions=0;
  const sessionBars=eligible.filter(bar=>bar.isComplete).map(bar=>({bar,day:newYorkBarParts(bar.startUtc).day}));
  const lastDays=[...new Set(sessionBars.map(item=>item.day))].slice(-21),volumeBars=sessionBars.filter(item=>lastDays.includes(item.day)).map(item=>item.bar);
  if(volumeBars.every(bar=>bar.volume!==null&&Number.isFinite(bar.volume)&&bar.volume>=0)){
    const candles:Candle[]=volumeBars.map(bar=>({timestamp:bar.startUtc,open:bar.open,high:bar.high,low:bar.low,close:bar.close,volume:bar.volume!}));
    try{const reference=calculateVolumeReferences(candles).at(-1)!;
      volumeReference=reference.average;volumeReferenceSessions=reference.priorSessions;volumeMatchingSessions=reference.matchingSessions;
      if(reference.average!==null&&reference.average>0&&last.volume!==null)relativeVolume20=last.volume/reference.average;
    }catch{/* Missing or invalid volume history remains unavailable. */}
  }
  const metrics:AnalysisMetrics={close,sma20:point?.sma20??null,sma40:point?.sma40??null,sma100:point?.sma100??null,sma200:point?.sma200??null,
    distanceSma20Percent:point?.sma20==null?null:pct(close,point.sma20),distanceSma40Percent:point?.sma40==null?null:pct(close,point.sma40),
    distanceSma100Percent:point?.sma100==null?null:pct(close,point.sma100),distanceSma200Percent:point?.sma200==null?null:pct(close,point.sma200),
    bollingerUpper:point?.bbUpper??null,bollingerMiddle:point?.bbMiddle??null,bollingerLower:point?.bbLower??null,
    bollingerPositionPercent:width!==null&&width>0&&point?.bbLower!=null?100*(close-point.bbLower)/width:null,
    bollingerWidthPercent:width!==null&&point?.bbMiddle!=null&&point.bbMiddle>0?100*width/point.bbMiddle:null,
    distanceUpperBandWidthPercent:width!==null&&width>0&&point?.bbUpper!=null?100*(point.bbUpper-close)/width:null,
    distanceLowerBandWidthPercent:width!==null&&width>0&&point?.bbLower!=null?100*(close-point.bbLower)/width:null,
    returnOneBarPercent:oneReturn,returnFourBarsPercent:fourReturn,relativeVolume20,volumeReference,
    volumeReferenceSessions,volumeMatchingSessions};
  const timestampUtc=last.endUtc;
  const definitions:Array<[keyof AnalysisMetrics,string,'USD'|'percent'|'ratio'|'shares'|'sessions']>=[
    ['close','1 vela completa','USD'],['sma20','20 velas','USD'],['sma40','40 velas','USD'],['sma100','100 velas','USD'],['sma200','200 velas','USD'],
    ['distanceSma20Percent','20 velas','percent'],['distanceSma40Percent','40 velas','percent'],['distanceSma100Percent','100 velas','percent'],['distanceSma200Percent','200 velas','percent'],
    ['bollingerUpper','20 velas, 2 desviaciones estándar','USD'],['bollingerMiddle','20 velas','USD'],['bollingerLower','20 velas, 2 desviaciones estándar','USD'],
    ['bollingerPositionPercent','20 velas, 2 desviaciones estándar','percent'],['bollingerWidthPercent','20 velas, 2 desviaciones estándar','percent'],
    ['distanceUpperBandWidthPercent','20 velas, 2 desviaciones estándar','percent'],['distanceLowerBandWidthPercent','20 velas, 2 desviaciones estándar','percent'],
    ['returnOneBarPercent','1 intervalo de 15 minutos','percent'],['returnFourBarsPercent','4 intervalos consecutivos de 15 minutos','percent'],
    ['relativeVolume20','20 sesiones anteriores, mismo horario NY','ratio'],['volumeReference','20 sesiones anteriores, mismo horario NY','shares'],
    ['volumeReferenceSessions','sesiones previas observadas','sessions'],['volumeMatchingSessions','sesiones previas con horario coincidente','sessions']];
  const observations:MetricObservation[]=definitions.map(([key,period,unit])=>{
    const value=metrics[key] as number|null;
    let availability:MetricObservation['availability']=value===null?'INSUFFICIENT_HISTORY':'AVAILABLE';
    const requiredWindow:Partial<Record<keyof AnalysisMetrics,number>>={sma20:20,sma40:40,sma100:100,sma200:200,
      distanceSma20Percent:20,distanceSma40Percent:40,distanceSma100Percent:100,distanceSma200Percent:200,
      bollingerUpper:20,bollingerMiddle:20,bollingerLower:20,bollingerPositionPercent:20,bollingerWidthPercent:20,
      distanceUpperBandWidthPercent:20,distanceLowerBandWidthPercent:20};
    if(value===null&&continuityCheck.gapDetected&&requiredWindow[key]!==undefined)availability='INCOMPLETE_WINDOW';
    if(value===null&&(['returnOneBarPercent','returnFourBarsPercent'] as (keyof AnalysisMetrics)[]).includes(key))availability='INCOMPLETE_WINDOW';
    if(value===null&&(['bollingerPositionPercent','bollingerWidthPercent','distanceUpperBandWidthPercent','distanceLowerBandWidthPercent'] as (keyof AnalysisMetrics)[]).includes(key)&&width!==null)availability='INVALID_DENOMINATOR';
    return {key,value,unit,period,timestampUtc,availability};
  });
  const facts:string[]=[`Cierre de la última vela completa de 15 min: ${close.toFixed(2)}. Observado al cierre ${timestampUtc}; no es cotización actual.`];
  for(const [period,value,distance] of [[20,point?.sma20??null,metrics.distanceSma20Percent],[40,point?.sma40??null,metrics.distanceSma40Percent],
    [100,point?.sma100??null,metrics.distanceSma100Percent],[200,point?.sma200??null,metrics.distanceSma200Percent]] as const){
    facts.push(value===null?`SMA ${period}: N/D (ventana continua incompleta o historial insuficiente).`:`SMA ${period}: cierre ${distance!>=0?'por encima':'por debajo'} en ${fixed(distance!)} del valor de la media.`);
  }
  if(point?.bbLower==null||point.bbUpper==null||width===null||width<=0)facts.push('Bandas de Bollinger 20/2: N/D (historial continuo insuficiente o ancho cero).');
  else {const position=metrics.bollingerPositionPercent!;
    const location=position<0?'debajo de la banda inferior':position>100?'encima de la banda superior':'dentro de las bandas';
    facts.push(`Bollinger 20/2: ${location}; posición ${position.toFixed(1)}% del ancho (0% inferior, 100% superior); ancho relativo ${metrics.bollingerWidthPercent!.toFixed(2)}% de la media.`);
  }
  facts.push(oneReturn===null?'Retorno de 1 vela: N/D (falta una vela consecutiva en la sesión).':`Retorno de 1 intervalo completo (15 min): ${fixed(oneReturn)}.`);
  facts.push(fourReturn===null?'Retorno de 4 velas: N/D (faltan cuatro intervalos consecutivos en la sesión).':`Retorno de cuatro intervalos completos (60 min): ${fixed(fourReturn)}.`);
  if(relativeVolume20!==null)facts.push(`RVOL: ${relativeVolume20.toFixed(2)}× frente al promedio del mismo horario local en ${volumeReferenceSessions} sesiones anteriores observadas.`);
  else facts.push(`RVOL: N/D (${volumeReferenceSessions} sesiones previas; ${volumeMatchingSessions} con ese horario y volumen disponible; se requieren 20).`);
  const interpretations:string[]=[];
  const measures=[metrics.distanceSma20Percent,metrics.distanceSma40Percent,metrics.distanceSma100Percent,metrics.distanceSma200Percent].filter((v):v is number=>v!==null);
  if(measures.length){const above=measures.filter(v=>v>0).length,below=measures.filter(v=>v<0).length;
    interpretations.push(above&&below?`Las medias disponibles discrepan: cierre sobre ${above} y bajo ${below}.`:above?`El cierre está sobre las ${above} medias disponibles.`:below?`El cierre está bajo las ${below} medias disponibles.`:'El cierre coincide con una o más medias disponibles.');
  }else interpretations.push('No hay medias disponibles para describir la relación del cierre.');
  if(metrics.distanceSma20Percent!==null&&fourReturn!==null){const a=Math.sign(metrics.distanceSma20Percent),b=Math.sign(fourReturn);
    interpretations.push(a===0||b===0?'Al menos una medida queda cerca de cero; no se describe coincidencia ni discrepancia direccional.':a===b?`La distancia a SMA 20 y el retorno de 60 min comparten signo (${a>0?'positivo':'negativo'}); son dos observaciones retrospectivas, no confirmación de tendencia.`:'La distancia a SMA 20 y el retorno de 60 min tienen signos distintos; la lectura de estos horizontes es mixta, sin confirmar reversión.');
  }else interpretations.push('La lectura conjunta de SMA 20 y retorno de 60 min es incompleta por falta de observaciones.');
  if(metrics.bollingerPositionPercent!==null){const p=metrics.bollingerPositionPercent;interpretations.push(`Posición Bollinger: ${p<0?'fuera por debajo':p>100?'fuera por encima':'dentro'}; la posición por sí sola no establece sobrecompra, sobreventa ni reversión.`);}
  const limitations:string[]=[];
  limitations.push(calendar?'Las medias y Bollinger usan solo el tramo continuo confirmado por el calendario bursátil; cada vela esperada ausente o incompleta reinicia la ventana.':
    'No se proporcionó calendario bursátil: para evitar cruzar sesiones potencialmente ausentes, las medias y Bollinger se limitan a la sesión NY actual.');
  if(continuityCheck.gapDetected)limitations.push('Se detectaron velas esperadas ausentes o incompletas antes del cierre analizado; las ventanas que no vuelven a completarse se marcan INCOMPLETE_WINDOW.');
  if(indicatorBars.length<200)limitations.push(`Ventana continua disponible: ${indicatorBars.length} velas; SMA/Bollinger solo se informan cuando su período completo cabe en ese tramo.`);
  if(point?.sma200==null)limitations.push('SMA 200 no disponible por historial continuo insuficiente.');
  if(relativeVolume20===null)limitations.push('RVOL requiere volumen en el mismo horario de 20 sesiones observadas anteriores.');
  if(oneReturn===null||fourReturn===null)limitations.push('Los retornos solo se calculan con intervalos completos y consecutivos dentro de la misma sesión local.');
  limitations.push(dataType==='SYNTHETIC'?'Los datos son sintéticos de demostración.':'Los indicadores describen cierres históricos locales, no precios en vivo.');
  return {asset,source,dataType,availability:dataType==='HISTORICAL'?'HISTORICAL_ONLY':'AVAILABLE',dateUtc:timestampUtc,timeframe:'15m',metrics,observations,
    sections:[{title:'Datos observados',items:facts},{title:'Interpretación técnica',items:interpretations}],limitations,
    continuity:{calendarAvailable:Boolean(calendar),consecutiveBars:indicatorBars.length,policy:calendar?'EXCHANGE_CALENDAR':'CURRENT_SESSION_ONLY'}};
}

export type ComparableSeries={asset:string;source:string;dataType:'SYNTHETIC'|'HISTORICAL';bars:readonly MarketBar[];calendar?:MarketCalendar|null};
export function analyzeAtCommonTimestamp(a:ComparableSeries,b:ComparableSeries,asOfUtc?:string):{analyses:[MarketAnalysis,MarketAnalysis];commonTimestamp:string|null}{
  const first=analyzeMarketBars(a.asset,a.source,a.dataType,a.bars,asOfUtc,a.calendar),second=analyzeMarketBars(b.asset,b.source,b.dataType,b.bars,asOfUtc,b.calendar);
  if(a.source!==b.source||a.dataType!==b.dataType)return {analyses:[first,second],commonTimestamp:null};
  const timestamps=new Set(a.bars.filter(bar=>bar.isComplete&&(!asOfUtc||Date.parse(bar.endUtc)<=Date.parse(asOfUtc))).map(bar=>bar.endUtc));
  const common=[...b.bars].reverse().find(bar=>timestamps.has(bar.endUtc)&&bar.isComplete&&(!asOfUtc||Date.parse(bar.endUtc)<=Date.parse(asOfUtc)));
  if(!common)return {analyses:[first,second],commonTimestamp:null};
  return {analyses:[
    analyzeMarketBars(a.asset,a.source,a.dataType,a.bars.filter(bar=>bar.endUtc<=common.endUtc),common.endUtc,a.calendar),
    analyzeMarketBars(b.asset,b.source,b.dataType,b.bars.filter(bar=>bar.endUtc<=common.endUtc),common.endUtc,b.calendar)
  ],commonTimestamp:common.endUtc};
}

export function compareMarketAnalyses(a:MarketAnalysis,b:MarketAnalysis):{items:string[];sufficient:boolean}{
  if(!a.metrics||!b.metrics||a.availability==='UNAVAILABLE'||b.availability==='UNAVAILABLE')return {items:['Evidencia insuficiente: faltan indicadores de uno o ambos activos.'],sufficient:false};
  if(a.timeframe!==b.timeframe)return {items:['Evidencia insuficiente: los marcos temporales no coinciden.'],sufficient:false};
  if(a.dateUtc!==b.dateUtc)return {items:[`No existe un corte temporal común (${a.asset}: ${a.dateUtc??'N/D'}; ${b.asset}: ${b.dateUtc??'N/D'}). No se concluye fortaleza relativa.`],sufficient:false};
  if(a.dataType!==b.dataType||a.source!==b.source)return {items:[`La procedencia difiere (${a.source} frente a ${b.source}); no se concluye fortaleza relativa entre fuentes distintas.`],sufficient:false};
  const x=a.metrics,y=b.metrics,items:string[]=[];
  items.push(`${a.asset}: retorno 15 min ${fixed(x.returnOneBarPercent)}; retorno 60 min ${fixed(x.returnFourBarsPercent)}; distancia a SMA 20 ${fixed(x.distanceSma20Percent)}; posición Bollinger ${x.bollingerPositionPercent===null?'N/D':x.bollingerPositionPercent.toFixed(1)+'%'}.`);
  items.push(`${b.asset}: retorno 15 min ${fixed(y.returnOneBarPercent)}; retorno 60 min ${fixed(y.returnFourBarsPercent)}; distancia a SMA 20 ${fixed(y.distanceSma20Percent)}; posición Bollinger ${y.bollingerPositionPercent===null?'N/D':y.bollingerPositionPercent.toFixed(1)+'%'}.`);
  if(x.returnOneBarPercent===null||y.returnOneBarPercent===null||x.returnFourBarsPercent===null||y.returnFourBarsPercent===null)
    return {items:[...items,'Evidencia insuficiente para comparar fortaleza relativa: faltan retornos de uno o ambos horizontes equivalentes.'],sufficient:false};
  const short=Math.sign(x.returnOneBarPercent-y.returnOneBarPercent),long=Math.sign(x.returnFourBarsPercent-y.returnFourBarsPercent);
  if(short===0&&long===0)items.push('Los retornos porcentuales de ambos horizontes son iguales; no se distingue mayor fortaleza relativa.');
  else if(short!==0&&long!==0&&short===long)items.push(`${short>0?a.asset:b.asset} muestra retornos porcentuales relativamente mayores en los horizontes equivalentes de 15 y 60 minutos, en el corte ${a.dateUtc}. Esta comparación descriptiva no predice movimientos futuros.`);
  else items.push('Los retornos de 15 y 60 minutos no coinciden o uno queda empatado; la comparación de fortaleza relativa es mixta o inconclusa. No se comparan precios absolutos.');
  return {items,sufficient:true};
}

export type IndicatorName='SMA20'|'SMA40'|'SMA100'|'SMA200'|'BOLLINGER'|'MOMENTUM'|'RVOL';
const guide:Record<IndicatorName,string>={
  SMA20:'SMA 20: promedio simple de los cierres de las últimas 20 velas; informa la posición del último cierre, no confirma por sí sola una tendencia.',
  SMA40:'SMA 40: promedio simple de los cierres de las últimas 40 velas completas.',
  SMA100:'SMA 100: promedio simple de los últimos 100 cierres completos; requiere historial suficiente.',
  SMA200:'SMA 200: promedio simple de los últimos 200 cierres completos; requiere historial suficiente.',
  BOLLINGER:'Bollinger 20/2: banda media SMA 20 y bandas a dos desviaciones estándar poblacionales de esa ventana; posición y ancho describen valores numéricos, no sobrecompra ni sobreventa.',
  MOMENTUM:'Retorno de 1 vela mide un intervalo completo de 15 minutos. Retorno de cuatro velas mide cuatro intervalos consecutivos completos (60 minutos); ambos son retrospectivos.',
  RVOL:'RVOL: volumen de una vela dividido por el promedio del mismo horario de Nueva York en 20 sesiones observadas anteriores; puede quedar N/D si hay datos faltantes.'};
export function explainIndicators(names:readonly IndicatorName[]):string[]{return [...new Set(names)].map(name=>guide[name]);}
