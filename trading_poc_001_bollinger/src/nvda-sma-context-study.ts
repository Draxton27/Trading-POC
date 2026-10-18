import type {MarketCalendar} from './alpaca-calendar.ts';
import type {Candle, Direction} from './domain.ts';
import {buildDailyCandles, buildHourlyCandles, calculateSmaPoints, lastAvailableSmaPoint,
  SMA_PERIODS, type AggregateCandle, type HigherTimeframe, type SmaPeriod, type SmaPoint} from './multitimeframe.ts';
import {evaluateNvdaHorizon, NVDA_HORIZONS, studyNvdaIndicators,
  type HorizonResult, type Segment, type SignalRecord} from './nvda-indicators-study.ts';
import {newYorkBarParts, type MovementSummary} from './strategy-validation.ts';

export type Position = 'above' | 'below' | 'equal';
export type Slope = 'rising' | 'falling' | 'flat';
export type DirectionalContext = 'bullish' | 'bearish' | 'mixed' | 'insufficient';
export type SmaContext = {
  value: number | null;
  previous: number | null;
  position: Position | null;
  slope: Slope | null;
};
export type TimeframeContext = {
  referenceStartUtc: string | null;
  referenceCloseUtc: string | null;
  availableAtUtc: string | null;
  referenceClose: number | null;
  smas: Record<SmaPeriod, SmaContext>;
  allAvailable: boolean;
  aboveAll: boolean | null;
  belowAll: boolean | null;
  bullishOrder: boolean | null;
  bearishOrder: boolean | null;
  directionalContext: DirectionalContext;
};
export type SmaSignalRecord = SignalRecord & {
  hour: TimeframeContext;
  day: TimeframeContext;
  timeframesAgree: boolean | null;
  timeframesContradict: boolean | null;
};
export type ConditionKind = 'individual' | 'joint' | 'cross';
export type ConditionDefinition = {
  id: string;
  label: string;
  kind: ConditionKind;
  timeframe: HigherTimeframe | 'cross';
  period: SmaPeriod | null;
};
export type SmaAnalysisRow = {
  segment: Segment | 'total';
  direction: Direction;
  horizonMinutes: number;
  conditionId: string;
  originalSignals: number;
  availableSignals: number;
  selectedSignals: number;
  insufficientSignals: number;
  eligible: MovementSummary;
  comparableOriginal: MovementSummary;
  distinctSessions: number;
  differenceMeanPercent: number | null;
  differenceFavorableRate: number | null;
  differenceInterval95Percent: [number, number] | null;
  matchedControls: number;
  controlMeanPercent: number | null;
  differenceVsControlPercent: number | null;
  differenceVsControlInterval95Percent: [number, number] | null;
  smallSample: boolean;
};
export type SmaCoverage = {
  timeframe: HigherTimeframe;
  period: SmaPeriod;
  completeBars: number;
  barsWithSma: number;
  firstSmaAvailableAt: string | null;
  signalsAvailable: number;
  explorationSignalsAvailable: number;
  evaluationSignalsAvailable: number;
};
export type AggregateSummary = {
  total: number;
  complete: number;
  incomplete: number;
  scheduledAbbreviated: number;
  completeScheduledAbbreviated: number;
};
export type NvdaSmaContextStudy = {
  sourceSignalCount: number;
  sourceBullishSignals: number;
  sourceBearishSignals: number;
  splitDate: string | null;
  aggregate: {hour: AggregateSummary; day: AggregateSummary};
  coverage: SmaCoverage[];
  signalsWithAllHourSmas: number;
  signalsWithAllDaySmas: number;
  signalsWithAllSmas: number;
  explorationSignalsWithAllSmas: number;
  evaluationSignalsWithAllSmas: number;
  conditions: ConditionDefinition[];
  signals: SmaSignalRecord[];
  rows: SmaAnalysisRow[];
};

const DIRECTIONS: Direction[] = ['CALL_CONTEXT', 'PUT_CONTEXT'];
const HORIZON_KEYS = {1: '15', 2: '30', 4: '60'} as const;

function emptySmas(): Record<SmaPeriod, SmaContext> {
  return {20: {value:null,previous:null,position:null,slope:null},
    40: {value:null,previous:null,position:null,slope:null},
    100: {value:null,previous:null,position:null,slope:null},
    200: {value:null,previous:null,position:null,slope:null}};
}

function timeframeContext(point: SmaPoint | null): TimeframeContext {
  if (!point) return {referenceStartUtc:null,referenceCloseUtc:null,availableAtUtc:null,referenceClose:null,
    smas:emptySmas(),allAvailable:false,aboveAll:null,belowAll:null,bullishOrder:null,bearishOrder:null,
    directionalContext:'insufficient'};
  const smas = emptySmas();
  for (const period of SMA_PERIODS) {
    const value = point.values[period], previous = point.previous[period];
    smas[period] = {value, previous,
      position: value === null ? null : point.candle.close > value ? 'above' : point.candle.close < value ? 'below' : 'equal',
      slope: value === null || previous === null ? null : value > previous ? 'rising' : value < previous ? 'falling' : 'flat'};
  }
  const allAvailable = SMA_PERIODS.every(period => smas[period].value !== null);
  const values = SMA_PERIODS.map(period => smas[period].value!);
  const aboveAll = allAvailable ? values.every(value => point.candle.close > value) : null;
  const belowAll = allAvailable ? values.every(value => point.candle.close < value) : null;
  const bullishOrder = allAvailable ? values.every((value,index) => index === 0 || values[index-1]! > value) : null;
  const bearishOrder = allAvailable ? values.every((value,index) => index === 0 || values[index-1]! < value) : null;
  return {referenceStartUtc:point.candle.timestamp,referenceCloseUtc:point.candle.endTimestamp,
    availableAtUtc:point.candle.availableAt,referenceClose:point.candle.close,smas,allAvailable,
    aboveAll,belowAll,bullishOrder,bearishOrder,
    directionalContext: !allAvailable ? 'insufficient' : aboveAll ? 'bullish' : belowAll ? 'bearish' : 'mixed'};
}

function agreement(hour: TimeframeContext, day: TimeframeContext): {agree:boolean|null; contradict:boolean|null} {
  if (hour.directionalContext === 'insufficient' || day.directionalContext === 'insufficient') return {agree:null,contradict:null};
  const directional = (value: DirectionalContext) => value === 'bullish' || value === 'bearish';
  if (!directional(hour.directionalContext) || !directional(day.directionalContext)) return {agree:false,contradict:false};
  return {agree:hour.directionalContext === day.directionalContext,
    contradict:hour.directionalContext !== day.directionalContext};
}

export function classifySmaSignal(record: SignalRecord, hourPoints: readonly SmaPoint[],
  dayPoints: readonly SmaPoint[]): SmaSignalRecord {
  const hour = timeframeContext(lastAvailableSmaPoint(hourPoints, record.signal.timestamp));
  const day = timeframeContext(lastAvailableSmaPoint(dayPoints, record.signal.timestamp));
  const {agree,contradict} = agreement(hour,day);
  return {...record,hour,day,timeframesAgree:agree,timeframesContradict:contradict};
}

export function smaConditionDefinitions(): ConditionDefinition[] {
  const result: ConditionDefinition[] = [];
  for (const timeframe of ['hour','day'] as const) for (const period of SMA_PERIODS) {
    const prefix = `${timeframe}_sma${period}`;
    for (const [suffix,label] of [
      ['position_aligned','precio alineado con la señal'],
      ['position_contradictory','precio contrario a la señal'],
      ['position_equal','precio igual a la SMA'],
      ['slope_aligned','pendiente alineada con la señal'],
      ['slope_contradictory','pendiente contraria a la señal'],
      ['slope_flat','pendiente plana'],
    ] as const) result.push({id:`${prefix}_${suffix}`,label:`${timeframe === 'hour' ? '1h' : '1d'} SMA ${period}: ${label}`,
      kind:'individual',timeframe,period});
  }
  for (const timeframe of ['hour','day'] as const) for (const [suffix,label] of [
    ['above_all','precio encima de las cuatro SMA'],['below_all','precio debajo de las cuatro SMA'],
    ['bullish_order','orden SMA20 > SMA40 > SMA100 > SMA200'],
    ['bearish_order','orden SMA20 < SMA40 < SMA100 < SMA200'],
  ] as const) result.push({id:`${timeframe}_${suffix}`,label:`${timeframe === 'hour' ? '1h' : '1d'}: ${label}`,
    kind:'joint',timeframe,period:null});
  result.push({id:'timeframes_agree',label:'1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA',
    kind:'cross',timeframe:'cross',period:null});
  result.push({id:'timeframes_contradict',label:'1h y 1d se contradicen en contexto de precio sobre/bajo las cuatro SMA',
    kind:'cross',timeframe:'cross',period:null});
  return result;
}

export function smaConditionStatus(record: SmaSignalRecord, condition: ConditionDefinition): {available:boolean; selected:boolean} {
  if (condition.kind === 'cross') {
    const value = condition.id === 'timeframes_agree' ? record.timeframesAgree : record.timeframesContradict;
    return {available:value !== null,selected:value === true};
  }
  const context = record[condition.timeframe as HigherTimeframe];
  if (condition.kind === 'joint') {
    if (!context.allAvailable) return {available:false,selected:false};
    const field = condition.id.replace(`${condition.timeframe}_`,'');
    const selected = field === 'above_all' ? context.aboveAll : field === 'below_all' ? context.belowAll :
      field === 'bullish_order' ? context.bullishOrder : context.bearishOrder;
    return {available:true,selected:selected === true};
  }
  const sma = context.smas[condition.period!];
  const suffix = condition.id.replace(`${condition.timeframe}_sma${condition.period}_`,'');
  if (suffix.startsWith('position_')) {
    if (sma.position === null) return {available:false,selected:false};
    const aligned = record.signal.direction === 'CALL_CONTEXT' ? sma.position === 'above' : sma.position === 'below';
    const contradictory = record.signal.direction === 'CALL_CONTEXT' ? sma.position === 'below' : sma.position === 'above';
    return {available:true,selected:suffix === 'position_aligned' ? aligned :
      suffix === 'position_contradictory' ? contradictory : sma.position === 'equal'};
  }
  if (sma.slope === null) return {available:false,selected:false};
  const aligned = record.signal.direction === 'CALL_CONTEXT' ? sma.slope === 'rising' : sma.slope === 'falling';
  const contradictory = record.signal.direction === 'CALL_CONTEXT' ? sma.slope === 'falling' : sma.slope === 'rising';
  return {available:true,selected:suffix === 'slope_aligned' ? aligned :
    suffix === 'slope_contradictory' ? contradictory : sma.slope === 'flat'};
}

function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((sum,value) => sum+value,0)/values.length : null;
}
function movement(values: readonly number[]): MovementSummary {
  const favorable=values.filter(value=>value>0), unfavorable=values.filter(value=>value<0);
  return {count:values.length,favorableRate:values.length?favorable.length/values.length:null,
    meanSignedPercent:mean(values),meanGainPercent:mean(favorable),meanLossPercent:mean(unfavorable),
    meanAbsolutePercent:mean(values.map(Math.abs))};
}
function bootstrap(items: readonly {day:string;selected:boolean;value:number}[]): [number,number]|null {
  const selected=items.filter(item=>item.selected);
  const days=[...new Set(items.map(item=>item.day))];
  if(selected.length<30||new Set(selected.map(item=>item.day)).size<10)return null;
  const byDay=new Map(days.map(day=>[day,items.filter(item=>item.day===day)]));
  let seed=731297;
  const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/2**32;};
  const draws:number[]=[];
  for(let iteration=0;iteration<2000;iteration++){
    const sampled=Array.from({length:days.length},()=>byDay.get(days[Math.floor(random()*days.length)]!)!).flat();
    const filtered=sampled.filter(item=>item.selected);
    if(filtered.length)draws.push(mean(filtered.map(item=>item.value))!-mean(sampled.map(item=>item.value))!);
  }
  draws.sort((a,b)=>a-b);
  return draws.length<1900?null:[draws[Math.floor(draws.length*.025)]!,draws[Math.floor(draws.length*.975)]!];
}
function bootstrapControl(items: readonly {day:string;value:number}[]): [number,number]|null {
  const days=[...new Set(items.map(item=>item.day))];
  if(items.length<30||days.length<10)return null;
  const byDay=new Map(days.map(day=>[day,items.filter(item=>item.day===day).map(item=>item.value)]));
  let seed=193127;
  const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/2**32;};
  const draws:number[]=[];
  for(let iteration=0;iteration<2000;iteration++){
    const sampled=Array.from({length:days.length},()=>byDay.get(days[Math.floor(random()*days.length)]!)!).flat();
    draws.push(mean(sampled)!);
  }
  draws.sort((a,b)=>a-b);
  return [draws[50]!,draws[1950]!];
}
function aggregateSummary(candles: readonly AggregateCandle[]): AggregateSummary {
  return {total:candles.length,complete:candles.filter(c=>c.complete).length,
    incomplete:candles.filter(c=>!c.complete).length,
    scheduledAbbreviated:candles.filter(c=>c.scheduledAbbreviated).length,
    completeScheduledAbbreviated:candles.filter(c=>c.scheduledAbbreviated&&c.complete).length};
}

export function studyNvdaSmaContext(candles: readonly Candle[], calendar: MarketCalendar): NvdaSmaContextStudy {
  const phase9=studyNvdaIndicators(candles,calendar);
  const hourly=buildHourlyCandles(candles,calendar),daily=buildDailyCandles(candles,calendar);
  const hourPoints=calculateSmaPoints(hourly),dayPoints=calculateSmaPoints(daily);
  const signals=phase9.signals.map(record=>classifySmaSignal(record,hourPoints,dayPoints));
  const conditions=smaConditionDefinitions();
  const coverage:SmaCoverage[]=[];
  for(const [timeframe,points] of [['hour',hourPoints],['day',dayPoints]] as const)for(const period of SMA_PERIODS){
    const available=signals.filter(record=>record[timeframe].smas[period].value!==null);
    const withSma=points.filter(point=>point.values[period]!==null);
    coverage.push({timeframe,period,completeBars:points.filter(point=>point.candle.complete).length,
      barsWithSma:withSma.length,firstSmaAvailableAt:withSma[0]?.candle.availableAt??null,
      signalsAvailable:available.length,
      explorationSignalsAvailable:available.filter(record=>record.segment==='exploracion').length,
      evaluationSignalsAvailable:available.filter(record=>record.segment==='evaluacion').length});
  }
  const signalIndices=new Set(phase9.signals.map(record=>record.signal.index));
  const controls=new Map<string,number[]>();
  for(let index=0;index<candles.length;index++){
    if(signalIndices.has(index))continue;
    const {day,slot}=newYorkBarParts(candles[index]!.timestamp);
    const segment:Segment=phase9.splitDate!==null&&day>=phase9.splitDate?'evaluacion':'exploracion';
    for(const direction of DIRECTIONS)for(const bars of NVDA_HORIZONS){
      const value=evaluateNvdaHorizon(candles,index,bars,direction,calendar).value;
      if(value!==null){const key=`${segment}|${direction}|${bars}|${slot}`;controls.set(key,[...(controls.get(key)??[]),value]);}
    }
  }
  const rows:SmaAnalysisRow[]=[];
  for(const segment of ['total','exploracion','evaluacion'] as const)for(const direction of DIRECTIONS){
    const originals=signals.filter(record=>(segment==='total'||record.segment===segment)&&record.signal.direction===direction);
    for(const bars of NVDA_HORIZONS)for(const condition of conditions){
      const key=HORIZON_KEYS[bars];
      const classified=originals.map(record=>({record,status:smaConditionStatus(record,condition)}));
      const available=classified.filter(item=>item.status.available);
      const selected=available.filter(item=>item.status.selected);
      const comparable=available.filter(item=>item.record.horizons[key].value!==null);
      const eligible=selected.filter(item=>item.record.horizons[key].value!==null);
      const selectedValues=eligible.map(item=>item.record.horizons[key].value!);
      const baseValues=comparable.map(item=>item.record.horizons[key].value!);
      const matched:number[]=[],controlMeans:number[]=[],controlDifferences:{day:string;value:number}[]=[];
      for(const item of eligible){
        const record=item.record;
        const pool=controls.get(`${record.segment}|${direction}|${bars}|${record.slotNy}`)??[];
        if(pool.length){const control=mean(pool)!;matched.push(record.horizons[key].value!);controlMeans.push(control);
          controlDifferences.push({day:record.dateNy,value:record.horizons[key].value!-control});}
      }
      const selectedSummary=movement(selectedValues),baseSummary=movement(baseValues);
      const selectedMean=selectedSummary.meanSignedPercent,baseMean=baseSummary.meanSignedPercent;
      const controlMean=mean(controlMeans),matchedMean=mean(matched);
      const distinctSessions=new Set(eligible.map(item=>item.record.dateNy)).size;
      rows.push({segment,direction,horizonMinutes:bars*15,conditionId:condition.id,
        originalSignals:originals.length,availableSignals:available.length,selectedSignals:selected.length,
        insufficientSignals:originals.length-available.length,eligible:selectedSummary,comparableOriginal:baseSummary,
        distinctSessions,
        differenceMeanPercent:selectedMean===null||baseMean===null?null:selectedMean-baseMean,
        differenceFavorableRate:selectedSummary.favorableRate===null||baseSummary.favorableRate===null?null:
          selectedSummary.favorableRate-baseSummary.favorableRate,
        differenceInterval95Percent:bootstrap(comparable.map(item=>({day:item.record.dateNy,
          selected:item.status.selected,value:item.record.horizons[key].value!}))),
        matchedControls:matched.length,controlMeanPercent:controlMean,
        differenceVsControlPercent:matchedMean===null||controlMean===null?null:matchedMean-controlMean,
        differenceVsControlInterval95Percent:bootstrapControl(controlDifferences),
        smallSample:selectedSummary.count<30||distinctSessions<10});
    }
  }
  const allHour=(record:SmaSignalRecord)=>record.hour.allAvailable;
  const allDay=(record:SmaSignalRecord)=>record.day.allAvailable;
  const all=(record:SmaSignalRecord)=>allHour(record)&&allDay(record);
  return {sourceSignalCount:signals.length,
    sourceBullishSignals:signals.filter(record=>record.signal.direction==='CALL_CONTEXT').length,
    sourceBearishSignals:signals.filter(record=>record.signal.direction==='PUT_CONTEXT').length,
    splitDate:phase9.splitDate,aggregate:{hour:aggregateSummary(hourly),day:aggregateSummary(daily)},coverage,
    signalsWithAllHourSmas:signals.filter(allHour).length,signalsWithAllDaySmas:signals.filter(allDay).length,
    signalsWithAllSmas:signals.filter(all).length,
    explorationSignalsWithAllSmas:signals.filter(record=>all(record)&&record.segment==='exploracion').length,
    evaluationSignalsWithAllSmas:signals.filter(record=>all(record)&&record.segment==='evaluacion').length,
    conditions,signals,rows};
}
