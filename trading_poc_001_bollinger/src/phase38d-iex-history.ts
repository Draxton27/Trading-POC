import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {Candle} from './domain.ts';
import {fetchAlpacaCalendar,isCalendarBar,saveMarketCalendar,type MarketCalendar} from './alpaca-calendar.ts';
import {calculatePhase23Features} from './phase23-dataset.ts';
import {newYorkBarParts} from './strategy-validation.ts';
import {loadMetadata} from './data-contract.ts';
import {parseCandlesCsv} from './csv.ts';

export type IexMinute=Candle&{tradeCount:number};
export type IexHttp=(url:URL,headers:Record<string,string>)=>Promise<Response>;
const minuteMs=60_000,dayMs=86_400_000,sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const stamp=(time:number)=>new Date(time).toISOString();
function assertMinute(value:unknown):IexMinute {
  if(typeof value!=='object'||value===null||Array.isArray(value))throw new Error('Barra IEX inválida.');
  const v=value as Record<string,unknown>,time=Date.parse(String(v.t));
  const numbers=[v.o,v.h,v.l,v.c,v.v];
  if(!Number.isFinite(time)||time%minuteMs!==0||numbers.some(n=>typeof n!=='number'||!Number.isFinite(n))||
    numbers.slice(0,4).some(n=>(n as number)<=0)||!Number.isSafeInteger(v.v)||
    (v.v as number)<0||!Number.isSafeInteger(v.n)||(v.n as number)<0||
    (v.h as number)<Math.max(v.o as number,v.c as number,v.l as number)||
    (v.l as number)>Math.min(v.o as number,v.c as number))throw new Error('OHLCV o número de transacciones IEX inválido.');
  return {timestamp:stamp(time),open:v.o as number,high:v.h as number,low:v.l as number,
    close:v.c as number,volume:v.v as number,tradeCount:v.n as number};
}
export async function fetchIexWindow(options:{start:number;end:number;apiKey:string;secretKey:string;
  get?:IexHttp;pause?:(ms:number)=>Promise<void>;requestIntervalMs?:number}):Promise<IexMinute[]> {
  const {start,end}=options;
  if(!Number.isInteger(start)||!Number.isInteger(end)||start%minuteMs||end%minuteMs||end<=start||end-start>30*dayMs)
    throw new Error('Ventana IEX inválida: máximo 30 días.');
  const get=options.get??((url,headers)=>fetch(url,{headers}));
  const pause=options.pause??((ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms)));
  const spacing=options.requestIntervalMs??500;
  if(spacing<500)throw new Error('Pacing IEX insuficiente.');
  const headers={'APCA-API-KEY-ID':options.apiKey,'APCA-API-SECRET-KEY':options.secretKey};
  const bars:IexMinute[]=[],tokens=new Set<string>();let token:string|null=null,lastTime=-Infinity,lastRequest=0;
  do {
    const url=new URL('https://data.alpaca.markets/v2/stocks/NVDA/bars');
    for(const [key,value] of Object.entries({start:stamp(start),end:stamp(end),timeframe:'1Min',feed:'iex',adjustment:'raw',limit:'10000',sort:'asc'}))url.searchParams.set(key,value);
    if(token)url.searchParams.set('page_token',token);
    let response:Response|undefined;
    for(let attempt=0;attempt<4;attempt++){
      const wait=lastRequest+spacing-Date.now();if(wait>0)await pause(wait);lastRequest=Date.now();
      try{response=await get(url,headers);}catch{if(attempt===3)throw new Error('IEX_NETWORK_ERROR');await pause(1000*2**attempt);continue;}
      if(response.status===401)throw new Error('IEX_AUTHENTICATION_ERROR');
      if(response.status===403)throw new Error('IEX_PERMISSION_DENIED');
      if(response.status===429||response.status>=500){if(attempt===3)throw new Error(response.status===429?'IEX_RATE_LIMIT':'IEX_HTTP_ERROR');
        const retry=Number(response.headers.get('retry-after'));await pause(Number.isFinite(retry)&&retry>=0?Math.min(retry*1000,30_000):1000*2**attempt);continue;}
      if(!response.ok)throw new Error(`IEX_HTTP_${response.status}`);break;
    }
    const payload:unknown=await response!.json();
    if(typeof payload!=='object'||payload===null||Array.isArray(payload))throw new Error('Página IEX inválida.');
    const page=payload as Record<string,unknown>;
    if(!Array.isArray(page.bars))throw new Error('Lista de barras IEX inválida.');
    for(const raw of page.bars){const bar=assertMinute(raw),time=Date.parse(bar.timestamp);
      if(time<start||time>end||time<=lastTime)throw new Error('Barra IEX fuera de rango, duplicada o desordenada.');
      lastTime=time;if(time<end)bars.push(bar);
    }
    const next=page.next_page_token;
    if(next!==null&&next!==undefined&&(typeof next!=='string'||!next||tokens.has(next)))throw new Error('Paginación IEX inválida.');
    token=typeof next==='string'?next:null;if(token)tokens.add(token);
  }while(token);
  return bars;
}
export function auditIex(minutes:readonly IexMinute[],calendar:MarketCalendar){
  const observed=new Map(minutes.map(bar=>[bar.timestamp,bar]));
  if(observed.size!==minutes.length)throw new Error('Minutos IEX duplicados.');
  for(let i=0;i<minutes.length;i++){
    const bar=minutes[i]!;
    if(i&&bar.timestamp<=minutes[i-1]!.timestamp)throw new Error('Minutos IEX desordenados.');
    if(!isCalendarBar(Date.parse(bar.timestamp),calendar))throw new Error('Barra IEX fuera de calendario oficial.');
  }
  const byDay=new Map<string,IexMinute[]>();
  for(const bar of minutes){const day=newYorkBarParts(bar.timestamp).day;const group=byDay.get(day)??[];group.push(bar);byDay.set(day,group);}
  const sessions=[] as Array<{date:string;expectedMinutes:number;observedMinutes:number;missingMinutes:number;coverage:number;volume:number;transactions:number;strict15m:number}>;
  const strict:Candle[]=[];
  for(const [date,hours] of [...calendar].sort(([a],[b])=>a.localeCompare(b))){
    const dayBars=byDay.get(date)??[];
    const byMinute=new Map(dayBars.map(bar=>[Date.parse(bar.timestamp),bar]));
    const expected=(hours.close-hours.open),first=dayBars[0];
    // Locate the official open in UTC using an observed bar or the NY time zone conversion.
    const anchor=first?Date.parse(first.timestamp)-(Number(newYorkBarParts(first.timestamp).slot.slice(0,2))*60+Number(newYorkBarParts(first.timestamp).slot.slice(3))-hours.open)*minuteMs:null;
    let complete=0;
    if(anchor!==null)for(let slot=0;slot+15<=expected;slot+=15){
      const group=Array.from({length:15},(_,offset)=>byMinute.get(anchor+(slot+offset)*minuteMs));
      if(group.some(bar=>!bar))continue;
      const bars=group as IexMinute[];strict.push({timestamp:stamp(anchor+slot*minuteMs),open:bars[0]!.open,
        high:Math.max(...bars.map(bar=>bar.high)),low:Math.min(...bars.map(bar=>bar.low)),
        close:bars[14]!.close,volume:bars.reduce((sum,bar)=>sum+bar.volume,0)});complete++;
    }
    sessions.push({date,expectedMinutes:expected,observedMinutes:dayBars.length,missingMinutes:expected-dayBars.length,
      coverage:dayBars.length/expected,volume:dayBars.reduce((sum,bar)=>sum+bar.volume,0),
      transactions:dayBars.reduce((sum,bar)=>sum+bar.tradeCount,0),strict15m:complete});
  }
  const eligible=calculatePhase23Features(strict,calendar).filter(Boolean).length;
  return {sessions,strict15m:strict,featureEligible15m:eligible,summary:{expectedMinutes:sessions.reduce((n,s)=>n+s.expectedMinutes,0),
    observedMinutes:minutes.length,missingMinutes:sessions.reduce((n,s)=>n+s.missingMinutes,0),
    strict15m:strict.length,featureEligible15m:eligible}};
}
export async function downloadIexHistory(options:{out:string;start:string;end:string;apiKey:string;secretKey:string;
  get?:IexHttp;pause?:(ms:number)=>Promise<void>;calendarGet?:IexHttp;sipCsv?:string}){
  const start=Date.parse(options.start),end=Date.parse(options.end);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start%minuteMs||end%minuteMs||end<=start||end>Date.now()-20*minuteMs)
    throw new Error('Rango histórico IEX inválido o demasiado reciente.');
  if(!options.apiKey||!options.secretKey)throw new Error('Faltan credenciales Alpaca en el entorno local.');
  const out=options.out,parts=join(out,'parts'),settings={schema:'phase38d-v1',symbol:'NVDA',feed:'iex',timeframe:'1Min',adjustment:'raw',start:stamp(start),end:stamp(end),windowDays:30,endpoint:'/v2/stocks/NVDA/bars'};
  mkdirSync(parts,{recursive:true});const settingsPath=join(out,'query.json'),settingsText=JSON.stringify(settings,null,2)+'\n';
  if(existsSync(settingsPath)){if(readFileSync(settingsPath,'utf8')!==settingsText)throw new Error('Parámetros distintos en descarga existente.');}
  else writeFileSync(settingsPath,settingsText,{flag:'wx'});
  const calendar=await fetchAlpacaCalendar({apiKey:options.apiKey,secretKey:options.secretKey,start:stamp(start),end:stamp(end),httpGet:options.calendarGet});
  saveMarketCalendar(join(out,'calendar.json'),calendar);
  const all:IexMinute[]=[],partHashes:Record<string,string>={};
  for(let from=start;from<end;from+=30*dayMs){const until=Math.min(from+30*dayMs,end),name=`${stamp(from).slice(0,10)}_${stamp(until).slice(0,10)}.json`,path=join(parts,name),checksumPath=`${path}.sha256`;
    const data=existsSync(path)?readFileSync(path,'utf8'):JSON.stringify(await fetchIexWindow({...options,start:from,end:until}))+'\n';
    if(existsSync(path)&&(!existsSync(checksumPath)||readFileSync(checksumPath,'utf8').trim()!==sha(data)))throw new Error('Parte IEX previa sin hash válido.');
    const parsed:unknown=JSON.parse(data);if(!Array.isArray(parsed))throw new Error('Parte IEX inválida.');
    const bars=parsed.map(entry=>assertMinute({t:(entry as IexMinute).timestamp,o:(entry as IexMinute).open,h:(entry as IexMinute).high,l:(entry as IexMinute).low,c:(entry as IexMinute).close,v:(entry as IexMinute).volume,n:(entry as IexMinute).tradeCount}));
    if(bars.some(bar=>Date.parse(bar.timestamp)<from||Date.parse(bar.timestamp)>=until))throw new Error('Parte IEX fuera de ventana.');
    if(!existsSync(path)){const temp=`${path}.tmp`;writeFileSync(temp,data,{flag:'wx'});renameSync(temp,path);writeFileSync(checksumPath,sha(data)+'\n',{flag:'wx'});}
    partHashes[name]=sha(data);all.push(...bars);
  }
  const regular=all.filter(bar=>isCalendarBar(Date.parse(bar.timestamp),calendar));
  const audit=auditIex(regular,calendar);
  const csv=['timestamp,open,high,low,close,volume,trade_count',...regular.map(b=>[b.timestamp,b.open,b.high,b.low,b.close,b.volume,b.tradeCount].join(','))].join('\n')+'\n';
  const strictCsv=['timestamp,open,high,low,close,volume',...audit.strict15m.map(b=>[b.timestamp,b.open,b.high,b.low,b.close,b.volume].join(','))].join('\n')+'\n';
  let sipComparison:Record<string,unknown>={status:'UNAVAILABLE_ADJUSTMENT',reason:'IEX raw y SIP split no son precios comparables sin ajuste corporativo verificado; no se comparan precios.'};
  if(options.sipCsv){
    const metadata=loadMetadata(options.sipCsv);
    if(metadata.asset!=='NVDA'||metadata.feed!=='sip'||metadata.adjustment!=='split'||metadata.bar_minutes!==15||metadata.data_class!=='real')
      throw new Error('Comparación SIP requiere NVDA SIP split real de 15 minutos.');
    const sip=parseCandlesCsv(readFileSync(options.sipCsv,'utf8'),metadata,{allowIntradayGaps:true})
      .filter(bar=>Date.parse(bar.timestamp)>=start&&Date.parse(bar.timestamp)<end);
    const comparisonStart=sip.length?Math.max(start,Date.parse(sip[0]!.timestamp)):null;
    const comparisonEnd=sip.length?Math.min(end,Date.parse(sip.at(-1)!.timestamp)+15*minuteMs):null;
    const comparable=(time:string)=>comparisonStart!==null&&comparisonEnd!==null&&Date.parse(time)>=comparisonStart&&Date.parse(time)<comparisonEnd;
    const sipStarts=new Set(sip.filter(bar=>comparable(bar.timestamp)).map(bar=>bar.timestamp));
    const iexStarts=new Set(audit.strict15m.filter(bar=>comparable(bar.timestamp)).map(bar=>bar.timestamp));
    const common=[...iexStarts].filter(time=>sipStarts.has(time)).length;
    sipComparison={...sipComparison,comparison:'UTC 15m identical intervals, coverage only',
      comparisonStartUtc:comparisonStart===null?null:stamp(comparisonStart),comparisonEndUtc:comparisonEnd===null?null:stamp(comparisonEnd),
      sip15m:sipStarts.size,iexStrict15m:iexStarts.size,common15m:common,
      iexOnly15m:iexStarts.size-common,sipOnly15m:sipStarts.size-common};
  }
  const report={schema:'phase38d-report-v1',source:settings,provenance:'Historical REST response; no historical receipt timestamp; separate from IEX Live WebSocket',
    partHashes,sha256:{minutesCsv:sha(csv),strict15mCsv:sha(strictCsv),calendar:sha(readFileSync(join(out,'calendar.json'),'utf8'))},
    summary:{...audit.summary,invalidRowsRejected:0},sessions:audit.sessions,viability:{status:audit.featureEligible15m>=1000?'RESEARCH_POSSIBLE':'INSUFFICIENT_CONTINUITY',
      note:'Cobertura IEX, selección de días y clases deben auditarse antes de entrenar. No se entrena un modelo aquí.'},
    sipComparison};
  for(const [name,value] of Object.entries({'minutes.csv':csv,'strict-15m.csv':strictCsv,'report.json':JSON.stringify(report,null,2)+'\n'})){
    const path=join(out,name);if(existsSync(path)){if(readFileSync(path,'utf8')!==value)throw new Error(`Archivo previo diferente: ${name}.`);}else writeFileSync(path,value,{flag:'wx'});
  }
  const hashes=['query.json','calendar.json','minutes.csv','strict-15m.csv','report.json'].map(name=>`${sha(readFileSync(join(out,name),'utf8'))}  ${name}`).join('\n')+'\n';
  const sums=join(out,'SHA256SUMS');if(existsSync(sums)){if(readFileSync(sums,'utf8')!==hashes)throw new Error('Hashes finales incompatibles.');}
  else writeFileSync(sums,hashes,{flag:'wx'});
  return report;
}
