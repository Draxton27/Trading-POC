/** An immutable REST snapshot may warm indicators only after its local registration. */
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {isCalendarBar,loadMarketCalendar,type MarketCalendar} from './alpaca-calendar.ts';
import {parseCandlesCsv} from './csv.ts';
import type {Candle} from './domain.ts';

const sha=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
type Registry={schema:'phase38f-warmup-v1';sourceDir:string;registeredAtUtc:string;hashes:Record<string,string>};
export type IexWarmup={candles:Candle[];calendar:MarketCalendar;registeredAtUtc:string;csvSha256:string;manifestSha256?:string};
const NAMES=['query.json','calendar.json','strict-15m.csv','report.json','SHA256SUMS'] as const;
export function verifyIexHistoricalRun(sourceDir:string){
  const sums=readFileSync(join(sourceDir,'SHA256SUMS'),'utf8').split(/\r?\n/).filter(Boolean),declared=new Map<string,string>();
  for(const line of sums){const match=/^([a-f0-9]{64})  ([^\\/]+(?:\/[^\\/]+)*)$/.exec(line);
    if(!match||match[2]!.split('/').includes('..')||declared.has(match[2]!))throw new Error('Manifiesto IEX histórico inválido.');declared.set(match[2]!,match[1]!);}
  for(const [name,digest] of declared){if(sha(readFileSync(join(sourceDir,name)))!==digest)throw new Error('Hash del histórico IEX incompatible.');}
  for(const name of NAMES.slice(0,-1))if(!declared.has(name))throw new Error('Artefacto IEX histórico ausente.');
  const query=JSON.parse(readFileSync(join(sourceDir,'query.json'),'utf8'));
  const report=JSON.parse(readFileSync(join(sourceDir,'report.json'),'utf8'));
  if(query.schema!=='phase38d-v1'||query.symbol!=='NVDA'||query.feed!=='iex'||query.timeframe!=='1Min'||query.adjustment!=='raw'||
    report.schema!=='phase38d-report-v1'||JSON.stringify(report.source)!==JSON.stringify(query)||
    report.sha256.strict15mCsv!==declared.get('strict-15m.csv')||report.sha256.calendar!==declared.get('calendar.json'))
    throw new Error('Procedencia del histórico IEX incompatible.');
  const calendar=loadMarketCalendar(join(sourceDir,'calendar.json'));
  const candles=parseCandlesCsv(readFileSync(join(sourceDir,'strict-15m.csv'),'utf8'),{asset:'NVDA',provider:'Alpaca Market Data API',bar_minutes:15,
    data_class:'real',session:'regular',exchange_timezone:'America/New_York'},{allowIntradayGaps:true});
  if(candles.length!==report.summary.strict15m)throw new Error('Conteo de histórico IEX incompatible.');
  for(const bar of candles){const start=Date.parse(bar.timestamp);
    if(![0,5,10].every(offset=>isCalendarBar(start+offset*60_000,calendar)))throw new Error('Calentamiento IEX fuera del calendario oficial.');}
  return {calendar,candles,query,report,manifestSha256:sha(readFileSync(join(sourceDir,'SHA256SUMS'))),
    csvSha256:declared.get('strict-15m.csv')!};
}
export function registerIexWarmup(source:string,out:string,clock:()=>string=()=>new Date().toISOString()){
  const sourceDir=resolve(source),registeredAtUtc=clock(),at=Date.parse(registeredAtUtc);
  if(!Number.isFinite(at)||new Date(at).toISOString()!==registeredAtUtc)throw new Error('Hora de registro inválida.');
  const {candles}=verifyIexHistoricalRun(sourceDir);
  if(candles.some(bar=>Date.parse(bar.timestamp)+900_000>at))throw new Error('El histórico contiene velas posteriores al registro.');
  const hashes=Object.fromEntries(NAMES.map(name=>[name,sha(readFileSync(join(sourceDir,name)))]));
  const registry:Registry={schema:'phase38f-warmup-v1',sourceDir,registeredAtUtc,hashes};
  mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(registry,null,2)+'\n',{flag:'wx'});
  return {registeredAtUtc,rows:candles.length,csvSha256:hashes['strict-15m.csv']!};
}
export function loadIexWarmup(path:string):IexWarmup{
  if(!existsSync(path))throw new Error('Registro de calentamiento IEX ausente.');
  const row=JSON.parse(readFileSync(path,'utf8')) as Registry;
  if(row.schema!=='phase38f-warmup-v1'||!row.sourceDir||!row.registeredAtUtc||!row.hashes)throw new Error('Registro de calentamiento incompatible.');
  for(const name of NAMES)if(row.hashes[name]!==sha(readFileSync(join(row.sourceDir,name))))throw new Error('Snapshot IEX modificado tras registro.');
  const source=verifyIexHistoricalRun(row.sourceDir);
  return {candles:source.candles,calendar:source.calendar,registeredAtUtc:row.registeredAtUtc,
    csvSha256:row.hashes['strict-15m.csv']!,manifestSha256:source.manifestSha256};
}
