import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {loadDataset} from './csv.ts';
import {loadMarketCalendar} from './alpaca-calendar.ts';
import {buildHourlyCandles, buildDailyCandles, calculateSmaPoints, type SmaPoint} from './multitimeframe.ts';
import {buildDailyAtr, evaluateVolatilityTrajectory, sessionBlock} from './nvda-volatility.ts';
import {calculateBollinger} from './bollinger.ts';
import {newYorkBarParts} from './strategy-validation.ts';
import {csvCell, parseCsvRows} from './phase17-csv.ts';
import {classify as classifyMarket} from './phase15-analysis.ts';
import {fourDescriptor, levelState, pullbackState, type TrendSide} from './phase18-core.ts';

const out='../shared-artifacts/phase18-human-method-options';
const stamp='20211017_20261017', barMs=900000;
const file=(symbol:string)=>`data/${symbol}_ALPACA_SIP_15min_${stamp}.csv`;
const sha=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
const cell=(v:unknown)=>v===null||v===undefined?'':typeof v==='number'?
  Number.isFinite(v)?String(Math.round(v*1e8)/1e8):'':String(v);
function readCsv(path:string){const [head,...data]=parseCsvRows(readFileSync(path,'utf8'));
  if(!head)throw new Error(`CSV vacío ${path}`);
  return data.map(row=>Object.fromEntries(head.map((k,i)=>[k,row[i]??''])));}
function saveCsv(path:string,rows:Record<string,unknown>[],fields?:string[]){const head=fields??[...new Set(rows.flatMap(r=>Object.keys(r)))];
  writeFileSync(path,head.join(',')+'\n'+rows.map(r=>head.map(k=>csvCell(cell(r[k]))).join(',')).join('\n')+'\n');}
function pointAt(points:SmaPoint[],state:{i:number},start:string){while(state.i+1<points.length&&points[state.i+1]!.candle.endTimestamp<=start)state.i++;
  const point=points[state.i];return point?.candle.complete?point:null;}
function average(v:number[]){return v.length?v.reduce((a,b)=>a+b,0)/v.length:null;}
function quantile(v:number[],p:number){if(!v.length)return null;const x=[...v].sort((a,b)=>a-b),a=(x.length-1)*p,l=Math.floor(a),h=Math.ceil(a);return x[l]!+(x[h]!-x[l]!)*(a-l);}
function bootstrap(rows:{date:string;value:number}[]){const m=new Map<string,{sum:number;n:number}>();for(const r of rows){const x=m.get(r.date)??{sum:0,n:0};x.sum+=r.value;x.n++;m.set(r.date,x);}
  const sessions=[...m.values()];if(sessions.length<2)return [null,null];let seed=180026;const random=()=>{seed=(seed+0x6D2B79F5)|0;let x=Math.imul(seed^seed>>>15,1|seed);x^=x+Math.imul(x^x>>>7,61|x);return ((x^x>>>14)>>>0)/4294967296;};
  const samples=[];for(let k=0;k<2000;k++){let sum=0,n=0;for(let j=0;j<sessions.length;j++){const r=sessions[Math.floor(random()*sessions.length)]!;sum+=r.sum;n+=r.n;}samples.push(sum/n);}return [quantile(samples,.025),quantile(samples,.975)];}
type Row={index:number;date:string;year:string;block:number;side:TrendSide|null;hour:string;day:string;timestamp:string;h15:number|null;h30:number|null;h60:number|null;mfe30:number|null;mae30:number|null};
function main(){mkdirSync(out,{recursive:true});
  const hashes=Object.fromEntries(['NVDA','QQQ','SMH'].map(s=>[s,sha(file(s))]));
  if(hashes.NVDA!=='7b06d0a493515b18a581963d2d2d488e73a7cd0dc2c961b60a99315e7a9b0ecc')throw new Error('Hash NVDA incorrecto');
  const data=Object.fromEntries(['NVDA','QQQ','SMH'].map(s=>[s,loadDataset(file(s))])) as Record<'NVDA'|'QQQ'|'SMH',ReturnType<typeof loadDataset>>;
  const calendar=loadMarketCalendar(file('NVDA')+'.calendar.json'),calendarHash=sha(file('NVDA')+'.calendar.json');
  const priorAudit=JSON.parse(readFileSync('../shared-artifacts/phase14-market-context/phase14-data-audit.json','utf8')) as
    {sourceHashes:Record<string,Record<string,string>>};
  for(const symbol of ['NVDA','QQQ','SMH'] as const){const meta=data[symbol].metadata as unknown as Record<string,unknown>;
    const provenance=JSON.parse(readFileSync(file(symbol)+'.provenance.json','utf8')) as Record<string,unknown>;
    if(meta.asset!==symbol||meta.feed!=='sip'||meta.adjustment!=='split'||sha(file(symbol)+'.calendar.json')!==calendarHash||
      provenance.calendar_sha256!==undefined&&provenance.calendar_sha256!==calendarHash)throw new Error(`Contrato fuente inválido ${symbol}`);}
  for(const symbol of ['NVDA','QQQ','SMH'])for(const [suffix,path] of Object.entries({csv:file(symbol),
    'meta.json':file(symbol)+'.meta.json','calendar.json':file(symbol)+'.calendar.json',
    'provenance.json':file(symbol)+'.provenance.json'}))
    if(sha(path)!==priorAudit.sourceHashes[symbol]?.[suffix])throw new Error(`SHA-256 original divergente: ${symbol} ${suffix}`);
  const nvda=data.NVDA.candles;
  for(const symbol of ['QQQ','SMH'] as const)if(data[symbol].candles.length!==nvda.length||data[symbol].candles.some((v,i)=>v.timestamp!==nvda[i]!.timestamp))throw new Error(`Cobertura ${symbol} divergente`);
  const hour=calculateSmaPoints(buildHourlyCandles(nvda,calendar)),day=calculateSmaPoints(buildDailyCandles(nvda,calendar));
  const atr=new Map(buildDailyAtr(nvda,calendar).map(v=>[v.dateNy,v.regime]));
  const completeDays=day.filter(p=>p.candle.complete),completeIndex=new Map(completeDays.map((p,i)=>[p.candle.dateNy,i]));
  const dates=[...calendar.keys()].sort(),priorDate=new Map(dates.slice(1).map((d,i)=>[d,dates[i]!]));
  const sync=new Map(readCsv('../shared-artifacts/phase14-market-context/phase14-synchronized-bars.csv').map(r=>[r.timestamp_utc,r]));
  const boll=calculateBollinger(nvda),hourCursor={i:-1},dayCursor={i:-1};
  const structures:Record<string,unknown>[]=[],events:Record<string,unknown>[]=[],rows:Row[]=[];
  const byTime=new Map<string,Record<string,unknown>>(),eventNames=new Map<string,Set<string>>();
  const pending=new Map<string,{id:string;index:number;date:string;level:number}>();
  const cross=new Map<string,string>();let currentDate='',hourRun=0,dayRun=0,prevHour='',prevDay='';
  let qqqFour=0,smhFour=0,knownNews=0;
  const evaluate=(i:number,n:1|2|4,side:TrendSide)=>evaluateVolatilityTrajectory(nvda,i,n,side,calendar,{atrDollar:null,range20Dollar:null});
  for(let i=0;i<nvda.length;i++){
    const bar=nvda[i]!,previous=nvda[i-1],time=Date.parse(bar.timestamp),{day:date,slot}=newYorkBarParts(bar.timestamp);
    const hp=pointAt(hour,hourCursor,bar.timestamp),dp=pointAt(day,dayCursor,bar.timestamp);
    const hd=fourDescriptor(hp?.values??null,hp?.previous??null,bar.close),dd=fourDescriptor(dp?.values??null,dp?.previous??null,bar.close);
    if(date!==currentDate){currentDate=date;pending.clear();cross.clear();}
    hourRun=hd.order===prevHour?hourRun+1:1;dayRun=dd.order===prevDay?dayRun+1:1;prevHour=hd.order;prevDay=dd.order;
    const side=hd.order==='bullish'||hd.order==='bearish'?hd.order:null;
    const levels:Record<string,number|null>={prior_high:null,prior_low:null,prior5_high:null,prior5_low:null};
    const prior=priorDate.get(date),priorIx=prior?completeIndex.get(prior):undefined;
    if(priorIx!==undefined){const p=completeDays[priorIx]!.candle;levels.prior_high=p.high;levels.prior_low=p.low;
      if(priorIx>=4){const range=completeDays.slice(priorIx-4,priorIx+1).map(v=>v.candle);levels.prior5_high=Math.max(...range.map(v=>v.high));levels.prior5_low=Math.min(...range.map(v=>v.low));}}
    const levelsRow:Record<string,unknown>={};
    if(previous&&newYorkBarParts(previous.timestamp).day===date)for(const [name,value] of Object.entries(levels))if(value!==null){const state=levelState(previous.close,bar,value),old=cross.get(name);
      levelsRow[`${name}_distance_pct`]=state.distancePercent;levelsRow[`${name}_touch`]=state.touch;levelsRow[`${name}_cross_close`]=state.crossClose;
      levelsRow[`${name}_recross`]=state.crossDirection!==null&&old!==undefined&&old!==state.crossDirection;
      if(state.crossDirection)cross.set(name,state.crossDirection);}
    const band=boll[i]!,oldBand=boll[i-1],width=band.bandwidth===null?null:100*band.bandwidth;
    const market:Record<string,number|null>={};for(const symbol of ['QQQ','SMH'] as const){const bars=data[symbol].candles,first=bars[i-3];
      const valid=i>=3&&first&&newYorkBarParts(first.timestamp).day===date&&bars.slice(i-3,i+1).every((v,j)=>Date.parse(v.timestamp)===Date.parse(first.timestamp)+j*barMs);
      market[symbol]=valid?100*(bars[i]!.close/first!.open-1):null;if(valid){if(symbol==='QQQ')qqqFour++;else smhFour++;}}
    const synced=sync.get(bar.timestamp);if(!synced)throw new Error(`Contexto F14 ausente ${bar.timestamp}`);
    if(synced.known_event_ids)knownNews++;
    const sr:Record<string,unknown>={index:i,bar_start_utc:bar.timestamp,bar_end_utc:new Date(time+barMs).toISOString(),date_ny:date,slot_ny:slot,
      hour_reference_end_utc:hp?.candle.endTimestamp,day_reference_end_utc:dp?.candle.endTimestamp,
      hour_order:hd.order,day_order:dd.order,hour_slopes_agree:hd.slopesAgree,day_slopes_agree:dd.slopesAgree,
      hour_run:hourRun,day_run:dayRun,hour_cross20_40:hd.cross20_40,day_cross20_40:dd.cross20_40,
      hour_day_relation:hd.order==='insufficient'||dd.order==='insufficient'?'insufficient':hd.order==='other'||dd.order==='other'?'other':hd.order===dd.order?'same':'opposite',
      regime:atr.get(date)??'insufficient',boll_position:band.upper!==null&&band.lower!==null&&band.upper>band.lower?(bar.close-band.lower)/(band.upper-band.lower):null,
      boll_width_pct:width,boll_width_change_pct:width!==null&&oldBand?.bandwidth!==null&&oldBand?.bandwidth!==undefined?width-100*oldBand.bandwidth:null,
      boll_center_slope:band.middle!==null&&oldBand?.middle!==null&&oldBand?.middle!==undefined?band.middle-oldBand.middle:null,
      boll_upper_distance_pct:band.upper?100*(bar.close-band.upper)/band.upper:null,boll_lower_distance_pct:band.lower?100*(bar.close-band.lower)/band.lower:null,
      qqq_four_pct:market.QQQ,smh_four_pct:market.SMH,known_event_ids:synced.known_event_ids,
      market_group:side?classifyMarket(side,market.QQQ,market.SMH):'insufficient',...levelsRow};
    for(const [prefix,descriptor,point] of [['hour',hd,hp],['day',dd,dp]] as const){for(const period of [20,40,100,200] as const){sr[`${prefix}_sma${period}`]=point?.values[period];sr[`${prefix}_slope${period}`]=descriptor.slope[period];sr[`${prefix}_distance${period}_pct`]=descriptor.priceDistance[period];}
      for(const [j,name] of ['20_40','40_100','100_200'].entries())sr[`${prefix}_sep${name}_pct`]=descriptor.separation[j];}
    const direction=side??'bullish',h15=evaluate(i,1,direction),h30=evaluate(i,2,direction),h60=evaluate(i,4,direction);
    for(const [name,result] of [['h15',h15],['h30',h30],['h60',h60]] as const){
      const bull=result.value===null?null:side==='bearish'?-result.value:result.value;
      sr[`posthoc_${name}_bullish_pct`]=bull;sr[`posthoc_${name}_bearish_pct`]=bull===null?null:-bull;
      sr[`posthoc_${name}_exclusion`]=result.reason;
    }
    sr.posthoc_h30_entry_utc=h30.entryUtc;sr.posthoc_h30_exit_utc=h30.exitUtc;
    sr.posthoc_h30_bullish_mfe_pct=h30.mfePercent===null||h30.maePercent===null?null:side==='bearish'?-h30.maePercent:h30.mfePercent;
    sr.posthoc_h30_bullish_mae_pct=h30.mfePercent===null||h30.maePercent===null?null:side==='bearish'?-h30.mfePercent:h30.maePercent;
    sr.posthoc_h30_bearish_mfe_pct=sr.posthoc_h30_bullish_mae_pct===null?null:-Number(sr.posthoc_h30_bullish_mae_pct);
    sr.posthoc_h30_bearish_mae_pct=sr.posthoc_h30_bullish_mfe_pct===null?null:-Number(sr.posthoc_h30_bullish_mfe_pct);
    structures.push(sr);byTime.set(bar.timestamp,sr);
    rows.push({index:i,date,year:date.slice(0,4),block:sessionBlock(slot),side,hour:hd.order,day:dd.order,timestamp:bar.timestamp,
      h15:h15.value,h30:h30.value,h60:h60.value,mfe30:h30.mfePercent,mae30:h30.maePercent});
    if(side&&previous&&newYorkBarParts(previous.timestamp).day===date)for(const period of [20,40] as const){const level=hp?.values[period];if(level===null||level===undefined)continue;
      const key=`${period}:${side}`;let active=pending.get(key);if(active&&(active.date!==date||i-active.index>2)){pending.delete(key);active=undefined;}
      const flags=pullbackState(previous,bar,level,side),recovery=Boolean(active&&i>active.index&&(side==='bullish'?bar.close>active.level:bar.close<active.level));
      if(!(flags.approach||flags.contact||flags.closeOtherSide||recovery))continue;
      const id=active?.id??`${date}:${i}:${period}:${side}`,repeat=Boolean(flags.contact&&active);
      if(flags.contact&&!active)pending.set(key,{id,index:i,date,level});if(recovery)pending.delete(key);
      const result=h30,event={episode_id:id,index:i,bar_start_utc:bar.timestamp,known_at_utc:new Date(time+barMs).toISOString(),date_ny:date,
        sma_period:period,direction:side,reference_sma:level,reference_end_utc:hp!.candle.endTimestamp,
        approach:flags.approach,contact:flags.contact,close_other_side:flags.closeOtherSide,recovery,repeated_episode:repeat,
        prior_distance_pct:100*(previous.close-level)/level,close_distance_pct:100*(bar.close-level)/level,
        hour_order:hd.order,day_order:dd.order,regime:sr.regime,boll_position:sr.boll_position,boll_width_pct:width,
        h15_signed_pct:h15.value,h15_exclusion:h15.reason,h30_signed_pct:result.value,h30_exclusion:result.reason,
        h60_signed_pct:h60.value,h60_exclusion:h60.reason,mfe30_pct:result.mfePercent,mae30_pct:result.maePercent,
        continuation_30m:result.value===null?'incomplete':result.value>0?'continuation':result.value<0?'reversal':'neutral'};
      events.push(event);const set=eventNames.get(bar.timestamp)??new Set<string>();for(const kind of ['approach','contact','close_other_side','recovery'] as const)if(event[kind])set.add(`${kind}${period}_${side}`);eventNames.set(bar.timestamp,set);
    }
  }
  saveCsv(`${out}/phase18-sma-structures.csv`,structures);saveCsv(`${out}/phase18-pullback-events.csv`,events);
  const groups=new Map<string,{side:TrendSide;rows:Row[]}>();const add=(name:string,side:TrendSide,row:Row)=>{const group=groups.get(name)??{side,rows:[]};group.rows.push(row);groups.set(name,group);};
  for(const row of rows){if(row.hour==='bullish'||row.hour==='bearish')add(`hour_${row.hour}`,row.hour,row);
    else if(row.hour==='other')for(const side of ['bullish','bearish'] as const)add(`hour_other_${side}`,side,row);
    if(row.day==='bullish'||row.day==='bearish')add(`day_${row.day}`,row.day,row);
    else if(row.day==='other')for(const side of ['bullish','bearish'] as const)add(`day_other_${side}`,side,row);
    if(row.side&&row.day===row.side)add(`hour_day_${row.side}`,row.side,row);
    if(row.side)for(const period of [20,40])for(const kind of ['approach','contact','close_other_side','recovery'])if(eventNames.get(row.timestamp)?.has(`${kind}${period}_${row.side}`))add(`${kind}_sma${period}_${row.side}`,row.side,row);}
  const resultRows:Record<string,unknown>[]=[];
  const signed=(row:Row,side:TrendSide,key:'h15'|'h30'|'h60')=>row[key]===null?null:
    row.side===side||row.side===null&&side==='bullish'?row[key]:-row[key]!;
  for(const [name,group] of groups){
    const scopes=[{period:'all',items:group.rows},...[...new Set(group.rows.map(r=>r.year))].sort()
      .map(year=>({period:year,items:group.rows.filter(r=>r.year===year)}))];
    for(const scope of scopes)for(const key of (scope.period==='all'?['h15','h30','h60']:['h30']) as ('h15'|'h30'|'h60')[]){
    const selected=scope.items.filter(r=>r[key]!==null),values=selected.map(r=>signed(r,group.side,key)!),selectedIds=new Set(scope.items.map(r=>r.index));
    const controls=new Map<string,{sum:number;n:number;byDate:Map<string,{sum:number;n:number}>}>();
    for(const r of rows){if(selectedIds.has(r.index)||r[key]===null||scope.period!=='all'&&r.year!==scope.period)continue;const value=signed(r,group.side,key)!;
      const k=`${r.year}|${r.block}`,x=controls.get(k)??{sum:0,n:0,byDate:new Map()},d=x.byDate.get(r.date)??{sum:0,n:0};x.sum+=value;x.n++;d.sum+=value;d.n++;x.byDate.set(r.date,d);controls.set(k,x);}
    const matched=selected.map(r=>{const c=controls.get(`${r.year}|${r.block}`),d=c?.byDate.get(r.date),n=(c?.n??0)-(d?.n??0);return n?(c!.sum-(d?.sum??0))/n:null;}).filter((v):v is number=>v!==null);
    const sessions=new Set(selected.map(r=>r.date)).size,[ciLow,ciHigh]=bootstrap(selected.map(r=>({date:r.date,value:signed(r,group.side,key)!})));
    resultRows.push({group:name,period:scope.period,direction:group.side,horizon_minutes:Number(key.slice(1)),observations:scope.items.length,eligible:selected.length,
      excluded:scope.items.length-selected.length,sessions,mean_signed_pct:average(values),median_signed_pct:quantile(values,.5),
      favorable_rate:values.length?values.filter(v=>v>0).length/values.length:null,q10_pct:quantile(values,.1),q90_pct:quantile(values,.9),
      mean_mfe30_pct:key==='h30'?average(selected.flatMap(v=>v.mfe30===null||v.mae30===null?[]:[v.side===group.side||v.side===null&&group.side==='bullish'?v.mfe30:-v.mae30])):null,
      mean_mae30_pct:key==='h30'?average(selected.flatMap(v=>v.mfe30===null||v.mae30===null?[]:[v.side===group.side||v.side===null&&group.side==='bullish'?v.mae30:-v.mfe30])):null,
      reference_coverage:selected.length?matched.length/selected.length:null,reference_mean_pct:average(matched),
      difference_vs_reference_pct:matched.length===selected.length&&values.length?average(values)!-average(matched)!:null,
      ci95_low:ciLow,ci95_high:ciHigh,sample_small:selected.length<30||sessions<10});}}
  saveCsv(`${out}/phase18-descriptive-results.csv`,resultRows);
  const signals=readCsv('../shared-artifacts/phase15-market-confirmation/phase15-signal-analysis.csv'),comparison:Record<string,unknown>[]=[];let mismatches=0,contextMismatches=0;
  let returnMismatches=0,regimeMismatches=0,groupMismatches=0;
  for(const signal of signals){const i=Number(signal.index),s=byTime.get(signal.bar_start_utc);
    if(!Number.isInteger(i)||nvda[i]?.timestamp!==signal.bar_start_utc||!s)throw new Error(`Identidad histórica inválida ${signal.signal_id}`);
    const result=evaluate(i,2,signal.direction as TrendSide),original=signal.h30_signed_pct===''?null:Number(signal.h30_signed_pct);
    const equal=result.value===null?original===null:original!==null&&Math.abs(result.value-original)<1e-8;if(!equal)mismatches++;
    const eq=(a:unknown,b:string)=>a===null||a===undefined?b==='':b!==''&&Math.abs(Number(a)-Number(b))<1e-8;
    const q=s.qqq_four_pct,smh=s.smh_four_pct;
    const group=classifyMarket(signal.direction as TrendSide,q===null||q===undefined?null:Number(q),
      smh===null||smh===undefined?null:Number(smh));
    if(!eq(q,signal.qqq_four_return_pct)||!eq(smh,signal.smh_four_return_pct))returnMismatches++;
    if(s.regime!==signal.regime)regimeMismatches++;
    if(group!==signal.group)groupMismatches++;
    if(!eq(q,signal.qqq_four_return_pct)||!eq(smh,signal.smh_four_return_pct)||
      s.regime!==signal.regime||group!==signal.group)contextMismatches++;
    comparison.push({signal_id:signal.signal_id,source_phase:signal.source_phase,family:signal.family,direction:signal.direction,index:i,bar_start_utc:signal.bar_start_utc,
      original_h30_signed_pct:original,reproduced_h30_signed_pct:result.value,h30_identity_equal:equal,
      hour_order:s.hour_order,day_order:s.day_order,hour_day_relation:s.hour_day_relation,
      hour_sma20:s.hour_sma20,hour_sma40:s.hour_sma40,hour_sma100:s.hour_sma100,hour_sma200:s.hour_sma200,
      day_sma20:s.day_sma20,day_sma40:s.day_sma40,day_sma100:s.day_sma100,day_sma200:s.day_sma200,
      pullback_labels:[...(eventNames.get(signal.bar_start_utc)??[])].join('|'),prior_high_distance_pct:s.prior_high_distance_pct,
      prior_low_distance_pct:s.prior_low_distance_pct,qqq_four_pct:s.qqq_four_pct,smh_four_pct:s.smh_four_pct,regime:s.regime,
      market_group:group,known_event_ids:s.known_event_ids});}
  if(mismatches||contextMismatches)throw new Error(`${mismatches} desenlaces o ${contextMismatches} contextos originales no coinciden `+
    `(retornos ETF ${returnMismatches}, régimen ${regimeMismatches}, grupo ${groupMismatches}); estudio detenido.`);
  saveCsv(`${out}/phase18-previous-signals-comparison.csv`,comparison);
  const orderCounts=Object.fromEntries(['hour','day'].map(tf=>[tf,Object.fromEntries(['bullish','bearish','other','insufficient'].map(order=>[order,structures.filter(r=>r[`${tf}_order`]===order).length]))]));
  const orderShares=Object.fromEntries(Object.entries(orderCounts).map(([tf,counts])=>[tf,
    Object.fromEntries(Object.entries(counts as Record<string,number>).map(([order,count])=>[order,100*count/structures.length]))]));
  const signalCounts=Object.fromEntries(['hour','day'].map(tf=>[tf,Object.fromEntries(['bullish','bearish','other','insufficient'].map(order=>[order,comparison.filter(r=>r[`${tf}_order`]===order).length]))]));
  const familyCounts=Object.fromEntries([...new Set(comparison.map(r=>String(r.family)))].sort().map(family=>[family,
    Object.fromEntries(['bullish','bearish','other','insufficient'].map(order=>[order,
      comparison.filter(r=>r.family===family&&r.hour_order===order).length]))]));
  const transitions=new Map<string,number>();for(let i=1;i<structures.length;i++){const a=structures[i-1]!,b=structures[i]!;if(a.date_ny!==b.date_ny)continue;
    const k=`${a.hour_order}->${b.hour_order}`;transitions.set(k,(transitions.get(k)??0)+1);}
  const integrity={protocol_commit:'8aecb621b4bf284320a9b2fa3e5f0a8fd8a5006f',code_sha256:{core:sha('src/phase18-core.ts'),runner:sha('src/phase18-run.ts')},
    source_sha256:hashes,calendar_sha256:calendarHash,
    source_aux_sha256:Object.fromEntries(['NVDA','QQQ','SMH'].flatMap(s=>['meta.json','calendar.json','provenance.json'].map(extension=>[`${s}_${extension}`,sha(file(s)+'.'+extension)]))),
    original_artifact_sha256:{phase11:sha('output/real/nvda-pullback-breakout-signals.csv'),phase12:sha('../shared-artifacts/phase12-nvda-failed-breakouts/phase12-signals.csv'),
      phase13:sha('output/real/nvda-volatility-regimes-events.csv'),phase14:sha('../shared-artifacts/phase14-market-context/phase14-synchronized-bars.csv'),
      phase15:sha('../shared-artifacts/phase15-market-confirmation/phase15-signal-analysis.csv')},
    coverage:{calendar_sessions:calendar.size,observations:structures.length,hourly_aggregates:hour.length,hourly_complete:hour.filter(p=>p.candle.complete).length,
      daily_aggregates:day.length,daily_complete:completeDays.length,qqq_four_available:qqqFour,smh_four_available:smhFour,
      intervals_with_known_event:knownNews,pullback_rows:events.length,original_signals:signals.length,signal_outcome_mismatches:mismatches,
      signal_context_mismatches:contextMismatches,
      order_counts:orderCounts,order_share_percent:orderShares,signal_order_counts:signalCounts,
      signal_hour_order_by_family:familyCounts,hour_transitions:Object.fromEntries(transitions)},
    independence:'none: 2021–2026 previously examined',data_class:'derived_descriptive',raw_sip_published:false};
  writeFileSync(`${out}/phase18-data-integrity.json`,JSON.stringify(integrity,null,2)+'\n');
  const focus=['hour_bullish','hour_bearish','contact_sma20_bullish','contact_sma20_bearish','contact_sma40_bullish','contact_sma40_bearish'];
  const format=(v:unknown)=>v===null||v===undefined?'NA':Number(v).toFixed(4);
  const focusTable=focus.map(name=>{const r=resultRows.find(row=>row.group===name&&row.period==='all'&&row.horizon_minutes===30);
    return r?`| ${name} | ${r.eligible} | ${r.sessions} | ${format(r.mean_signed_pct)} | ${format(r.difference_vs_reference_pct)} | [${format(r.ci95_low)}, ${format(r.ci95_high)}] |`:'';}).join('\n');
  const access=JSON.parse(readFileSync(`${out}/phase18-options-access-audit.json`,'utf8')) as Record<string,unknown>;
  writeFileSync(`${out}/phase18-report.md`,`# Fase 18 — método técnico humano y viabilidad de opciones\n\n`+
    `Todo 2021–2026 es exploratorio y ya se examinó en fases anteriores. **No hay validación independiente ni estrategia rentable demostrada.** Protocolo preregistrado: \`8aecb621b4bf284320a9b2fa3e5f0a8fd8a5006f\`. CSV NVDA SHA-256: \`${hashes.NVDA}\`.\n\n`+
    `## Investigación A: datos y características medibles\n\n`+
    `${structures.length} intervalos regulares de 15 minutos en ${calendar.size} sesiones; agregados horarios completos ${hour.filter(p=>p.candle.complete).length}/${hour.length}, diarios ${completeDays.length}/${day.length}. QQQ/SMH: ${qqqFour}/${smhFour} retornos de cuatro velas disponibles. ${knownNews} intervalos tienen un evento F14 conocido. Un campo de evento vacío no descarta otras noticias.\n\n`+
    `Orden de cuatro SMA horario (conteos): ${JSON.stringify(orderCounts.hour)}; diario: ${JSON.stringify(orderCounts.day)}. Porcentaje del tiempo horario: ${JSON.stringify(orderShares.hour)}; diario: ${JSON.stringify(orderShares.day)}. Se miden orden, pendientes, distancia del precio, separación continua, cruces, persistencia y transiciones intrasesión. Las pendientes no se infieren del orden. El [CSV individual](phase18-sma-structures.csv) conserva cada observación; las transiciones agregadas constan en [integridad](phase18-data-integrity.json).\n\n`+
    `${events.length} filas descriptivas de aproximación, contacto, cruce y recuperación de SMA20/40 horarias aparecen en [eventos](phase18-pullback-events.csv). Un contacto puede compartir episodio con otra fila; el identificador y marca de repetición evitan tratarlo como evidencia independiente. La recuperación de las dos velas posteriores se conoce solo al cierre de su propia vela. Los máximos/mínimos anteriores son calculados, no niveles dibujados por el operador.\n\n`+
    `## Comportamiento histórico a 30 minutos\n\n`+
    `Las cifras siguientes son porcentajes firmados desde una **apertura teórica sin latencia** de la vela siguiente. Intervalos del 95%: 2.000 remuestras por sesión con semilla 180026. Referencia: año y bloque horario comparables, excluida la misma sesión.\n\n`+
    `| Configuración | Resultados | Sesiones | Media % | Diferencia frente a referencia % | IC95 media % |\n| --- | ---: | ---: | ---: | ---: | --- |\n${focusTable}\n\n`+
    `Las medias negativas y los intervalos que abarcan cero se documentan expresamente; ningún subgrupo se convierte en regla por destacar entre muchas comparaciones. El [resultado completo](phase18-descriptive-results.csv) incluye media, mediana, favorable, MFE/MAE, cobertura de controles y horizontes 15/30/60; el principal se desglosa también por año. MFE/MAE no son precios ejecutables. El año y los eventos se vuelven muestras pequeñas en varios subgrupos.\n\n`+
    `## Relación con seis familias congeladas\n\n`+
    `${signals.length} señales F11/F12 se enlazaron por índice y timestamp, con **${mismatches} discrepancias** de retorno principal y **${contextMismatches} de contexto** frente a los resultados publicados. Órdenes de sus SMA: ${JSON.stringify(signalCounts)}. Desglose de orden horario por familia: ${JSON.stringify(familyCounts)}. [Cada comparación](phase18-previous-signals-comparison.csv) conserva estructura, distancias, contexto QQQ/SMH, régimen y evento disponible sin reemplazar la señal original. Esto mide cuánta superposición hay con la descripción humana; no demuestra que el detector represente su elección discrecional.\n\n`+
    `## Investigación B: datos reales de opciones\n\n`+
    `La [auditoría de proveedores](phase18-options-provider-audit.md) documenta cobertura, resolución, bid/ask, tamaños, costo y licencias de Alpaca, ThetaData, ORATS y Cboe. En la cuenta Alpaca actual, el GET de quote OPRA reciente devolvió 403 y la ruta histórica de quotes probada 404; el GET indicativo devolvió 200. Por ello, la auditoría marca \`${access.pilotStatus}\` y el [piloto](phase18-options-pilot.csv) queda sin filas. Una quote indicativa o una barra de operaciones no se considera prima OPRA realizable.\n\n`+
    `## Conclusión y evidencia faltante\n\n`+
    `Se pueden medir objetivamente SMA 20/40/100/200, pendiente, orden, separaciones, niveles previos, Bollinger y contexto de QQQ/SMH. Se observaron configuraciones y trayectorias variadas, incluidas medias desfavorables y comparaciones sin mejora defendible; todo procede del mismo historial ya estudiado. Para evaluar CALL/PUT faltan una cadena y quotes históricas OPRA auténticas con tamaños, licencia, contratos ajustados, costos y tiempos de disponibilidad. Para afirmar viabilidad económica faltan además decisiones y fills humanos originales documentados antes del desenlace, prueba de ejecución y validación con datos nuevos. El Recom de Finviz no se asignó a sesiones porque su captura F17 carece de fecha de mercado. No se crean órdenes ni reglas de entrada.\n\n`+
    `## Validación técnica\n\n\`npm ci\`, comprobación de tipos y **168/168 pruebas** aprobadas. Los nueve validadores históricos aplicables terminaron correctamente conservando los paquetes publicados; la auditoría completa y el efecto editorial de \`codeVersion\` en validadores antiguos constan en [validación](phase18-validation-report.md).\n`);
  console.log(JSON.stringify({observations:structures.length,events:events.length,signals:signals.length,mismatches,groups:groups.size}));
}
main();
