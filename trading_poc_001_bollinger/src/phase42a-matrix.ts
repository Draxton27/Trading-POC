import type {Candle} from './domain.ts';
import type {MarketCalendar} from './alpaca-calendar.ts';
import {auditNvdaCalendar} from './nvda-indicators-study.ts';
import {buildDailyCandles,buildHourlyCandles,type AggregateCandle} from './multitimeframe.ts';
import {newYorkBarParts} from './strategy-validation.ts';

export const PROTOCOL={version:'42A-1',classification:'EXPLORATORIA',freeze:'Antes de calcular resultados; no seleccionar parámetros con períodos ya examinados.',split:'70/30 por sesiones completas; ambos tramos retrospectivos exploratorios y ya vistos por el proyecto. Una evaluación prospectiva requiere recepción y protocolo fijados antes de sus observaciones.',
  sessions:'NYSE según calendario Alpaca; indicadores continuos reiniciados tras huecos.',
  availability:'El cierre es un límite físico; la recepción histórica y ajustes point-in-time no están verificados.',
  comparisons:'Controles del mismo activo, bloque horario y período, excluyendo la misma sesión; sin reemplazar datos faltantes.',
  horizonsMinutes:[15,30,60],directionalReturn:'Retorno del subyacente desde la primera apertura posterior a la disponibilidad; no es rendimiento de opciones.',
  excursions:'MFE y MAE de máximos y mínimos del horizonte, sin presumir secuencia intravela ni fills.',
  uncertainty:'Remuestreo pareado por sesiones completas; sensibilidad por semanas o regímenes, sujeto a muestra suficiente.',
  minObservations:30,minSessions:10,bootstrapReplicates:2000,seed:42001,
  leakage:'Evaluación posterior por sesiones completas; purgar horizontes cruzados y embargo si ventanas de información se solapan.',
  multipleComparisons:'Todas las estrategias, activos y horizontes son comparaciones múltiples exploratorias; no seleccionar ganadores retrospectivos.',
  optionPnl:'NO_CALCULABLE sin contratos, cotizaciones históricas negociables, spreads y costos verificables.'} as const;

export const CATALOG_VERSION='42A-catalogo-1';
export type StrategyId='E1'|'E2'|'E3'|'E4'|'E5'|'E6'|'E7'|'E8';
export const CATALOG:ReadonlyArray<{id:StrategyId;direction:'CALL'|'PUT';originalRules:string;timeframes:string;confirmation:string;invalidation:string;evidence:string;engineering:string;requirements:string[]}>= [
  {id:'E1',direction:'CALL',originalRules:'Directriz sobre máximos de tendencia bajista y ruptura alcista, incluida apertura con salto.',timeframes:'1h contexto y ruptura; 15m confirmación',confirmation:'Superar SMA20 horaria, cierre alcista y tendencia totalmente alcista en 15m.',invalidation:'No especificada de forma cuantitativa.',evidence:'Cuaderno aportado, páginas 3–4, figuras 1–2.',engineering:'Trazado, ruptura y tendencia completa no tienen algoritmo objetivo acordado.',requirements:['Directriz causal','Ruptura verificable','SMA20 1h','Cierre de confirmación 1h','Tendencia 15m']},
  {id:'E2',direction:'PUT',originalRules:'Directriz bajo mínimos de tendencia alcista y ruptura bajista, incluida apertura con salto.',timeframes:'1h contexto y ruptura; 15m confirmación',confirmation:'Cruzar bajo SMA20 horaria, cierre bajista y tendencia totalmente bajista en 15m.',invalidation:'No especificada de forma cuantitativa.',evidence:'Cuaderno aportado, páginas 5–6, figuras 3–4.',engineering:'El detector privado anterior E2 es una aproximación y requiere cotejo; no sustituye la directriz.',requirements:['Directriz causal','Ruptura verificable','SMA20 1h','Cierre de confirmación 1h','Tendencia 15m']},
  {id:'E3',direction:'CALL',originalRules:'Tendencia diaria alcista, corrección horaria bajista y aproximación a la media central diaria.',timeframes:'1d contexto; 1h corrección y confirmación; 15m giro',confirmation:'Toque y respeto de SMA20 diaria, rebote 15m y cierre horario alcista.',invalidation:'El texto requiere no cruzar la media; umbrales no especificados.',evidence:'Cuaderno aportado, páginas 7–8, figuras 5–6.',engineering:'La cercanía y la tendencia del proxy previo son convenciones, no reglas originales.',requirements:['Bollinger diario','SMA20 diaria','Corrección 1h','Rebote 15m','Confirmación 1h']},
  {id:'E4',direction:'PUT',originalRules:'Tendencia diaria bajista, corrección horaria alcista y aproximación a la media central diaria.',timeframes:'1d contexto; 1h corrección y confirmación; 15m giro',confirmation:'Toque y respeto de SMA20 diaria, rechazo 15m y cierre horario bajista.',invalidation:'El texto requiere no cruzar la media; umbrales no especificados.',evidence:'Cuaderno aportado, páginas 9–10, figuras 7–8.',engineering:'La cercanía y la tendencia del proxy previo son convenciones, no reglas originales.',requirements:['Bollinger diario','SMA20 diaria','Corrección 1h','Rechazo 15m','Confirmación 1h']},
  {id:'E5',direction:'PUT',originalRules:'Bollinger lateral de baja volatilidad y apertura con salto alcista alejada de banda superior.',timeframes:'15m contexto; primeros 5m de apertura',confirmation:'Inicio de descenso después del salto; ventana de primeros cinco minutos.',invalidation:'Después de la ventana podría perder validez; sin umbral exacto.',evidence:'Cuaderno aportado, página 11, figura 9.',engineering:'Lateralidad, baja volatilidad y distancia no tienen umbrales definidos.',requirements:['Bollinger 15m previo','Salto alcista','Movimiento inicial','Disponibilidad intradía']},
  {id:'E6',direction:'CALL',originalRules:'Bollinger lateral de baja volatilidad y apertura con salto bajista alejada de banda inferior.',timeframes:'15m contexto; primeros 5m de apertura',confirmation:'Inicio de subida después del salto; ventana de primeros cinco minutos.',invalidation:'Después de la ventana podría perder validez; sin umbral exacto.',evidence:'Cuaderno aportado, página 12, figura 10.',engineering:'Lateralidad, baja volatilidad y distancia no tienen umbrales definidos.',requirements:['Bollinger 15m previo','Salto bajista','Movimiento inicial','Disponibilidad intradía']},
  {id:'E7',direction:'CALL',originalRules:'Tendencia horaria bajista de varios días, salto bajista y precio alejado de SMA20; primera vela 15m fuera de banda inferior.',timeframes:'1h SMA20/40 y volumen; 15m Bollinger',confirmation:'Cruce visual de la barra de volumen con la línea roja de Worden Stochastics al comenzar a formarse.',invalidation:'No especificada de forma cuantitativa.',evidence:'Cuaderno aportado, páginas 13–14, figuras 11–12.',engineering:'Worden, cruce visual y parámetros no están verificados; no se sustituyen por RSI, estocástico convencional ni RVOL.',requirements:['SMA20/40 1h','Bollinger 15m','Worden Stochastics','Cruce visual de volumen']},
  {id:'E8',direction:'PUT',originalRules:'Tendencia horaria alcista de varios días, salto alcista y precio alejado de SMA20; primera vela 15m fuera de banda superior.',timeframes:'1h SMA20/40 y volumen; 15m Bollinger',confirmation:'Cruce visual de la barra de volumen con la línea roja de Worden Stochastics al comenzar a formarse.',invalidation:'No especificada de forma cuantitativa.',evidence:'Cuaderno aportado, páginas 15–16, figuras 13–14.',engineering:'Worden, cruce visual y parámetros no están verificados; no se sustituyen por RSI, estocástico convencional ni RVOL.',requirements:['SMA20/40 1h','Bollinger 15m','Worden Stochastics','Cruce visual de volumen']},
];

export type FrameAudit={total:number;complete:number;incomplete:number;abbreviated:number;maxContinuous:number;ready:Record<string,number>};
const minutes=(slot:string)=>{const [h,m]=slot.split(':').map(Number);return h!*60+m!;};
function frameAudit(bars:readonly AggregateCandle[],calendar:MarketCalendar):FrameAudit{
  const days=[...calendar.keys()].sort(),previousDay=new Map(days.slice(1).map((day,i)=>[day,days[i]!]));
  let run=0,maxContinuous=0,previous:AggregateCandle|null=null;const ready:Record<string,number>={'20':0,'40':0,'100':0,'200':0};
  for(const bar of bars){
    if(!bar.complete){run=0;previous=null;continue;}
    let adjacent=false;
    if(previous){if(previous.dateNy===bar.dateNy)adjacent=previous.endTimestamp===bar.timestamp;
      else {const before=calendar.get(previous.dateNy),after=calendar.get(bar.dateNy);
        adjacent=!!before&&!!after&&previousDay.get(bar.dateNy)===previous.dateNy&&minutes(newYorkBarParts(previous.endTimestamp).slot)===before.close&&minutes(newYorkBarParts(bar.timestamp).slot)===after.open;}}
    run=adjacent?run+1:1;maxContinuous=Math.max(maxContinuous,run);for(const p of [20,40,100,200])if(run>=p)ready[String(p)]!++;
    previous=bar;
  }
  return {total:bars.length,complete:bars.filter(x=>x.complete).length,incomplete:bars.filter(x=>!x.complete).length,abbreviated:bars.filter(x=>x.scheduledAbbreviated).length,maxContinuous,ready};
}
export function auditDataset(candles:readonly Candle[],calendar:MarketCalendar){
  const calendarAudit=auditNvdaCalendar(candles,calendar);
  const fifteen:AggregateCandle[]=candles.map(c=>({ ...c,endTimestamp:new Date(Date.parse(c.timestamp)+900000).toISOString(),availableAt:new Date(Date.parse(c.timestamp)+900000).toISOString(),dateNy:newYorkBarParts(c.timestamp).day,timeframe:'hour',durationMinutes:15,expectedSourceBars:1,observedSourceBars:1,complete:true,scheduledAbbreviated:false}));
  const hourly=buildHourlyCandles(candles,calendar),daily=buildDailyCandles(candles,calendar);
  return {bars:candles.length,first:candles[0]!.timestamp,last:candles.at(-1)!.timestamp,calendarAudit,
    frames:{'15m':frameAudit(fifteen,calendar),'1h':frameAudit(hourly,calendar),'1d':frameAudit(daily,calendar)}};
}
export type AuditState='DISPONIBLE'|'SIN_DATOS'|'NO_VERIFICABLE';
export function buildMatrix(audits:Record<'NVDA'|'AMD'|'AMZN',AuditState>){
  return (['NVDA','AMD','AMZN'] as const).flatMap(asset=>CATALOG.map(strategy=>({asset,strategy:strategy.id,
    status:asset==='NVDA'&&(strategy.id==='E5'||strategy.id==='E6')?'CONGELADA':audits[asset]==='SIN_DATOS'?'SIN_DATOS':
      audits[asset]==='NO_VERIFICABLE'?'NO_VERIFICABLE':['E1','E2','E7','E8'].includes(strategy.id)?'NO_VERIFICABLE':'PENDIENTE',
    reason:asset==='NVDA'&&(strategy.id==='E5'||strategy.id==='E6')?'Investigación anterior congelada; reglas y artefactos requieren localización.':
      audits[asset]==='SIN_DATOS'?'Faltan CSV 15m, metadatos y calendario oficial locales.':
      audits[asset]==='NO_VERIFICABLE'?'La procedencia o integridad no pudo acreditarse.':'Faltan definiciones operables o recepción histórica verificable.'})));
}
/** Every row is an examined bar, not a detected opportunity or a signal. */
export function* pilotRows(candles:readonly Candle[],asset:'NVDA'|'AMD'|'AMZN',asOfUtc:string){
  const cutoff=Date.parse(asOfUtc);if(!Number.isFinite(cutoff))throw Error('CORTE_INVALIDO');
  for(const candle of candles){if(Date.parse(candle.timestamp)+900000>cutoff)continue;for(const strategy of ['E1','E2'] as const)yield {asset,strategy,barStartUtc:candle.timestamp,
    observedAtUtc:new Date(Date.parse(candle.timestamp)+900000).toISOString(),availableAtUtc:null,
    status:'NO_EVALUABLE',scope:'VELA_EXAMINADA_NO_ES_SENAL',reasons:['DIRECTRIZ_SIN_DEFINICION_OBJETIVA','TENDENCIA_15M_SIN_DEFINICION_OBJETIVA','CONFIRMACION_SIN_DEFINICION_OBJETIVA','RECEPCION_HISTORICA_NO_VERIFICADA','AJUSTE_POINT_IN_TIME_NO_VERIFICADO'],confirmation:null,invalidation:null};
  }
}
