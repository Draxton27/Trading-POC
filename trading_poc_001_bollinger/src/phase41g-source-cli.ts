/** Read-only export of the unchanged Phase 41A/41B SIP calculations. */
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createPhase41bIndex, loadPhase41bSip} from './phase41b-context.ts';
import {buildDailyCandles, buildHourlyCandles} from './multitimeframe.ts';
import {newYorkBarParts} from './strategy-validation.ts';

const args=process.argv.slice(2);
const value=(flag:string)=>args[args.indexOf(flag)+1];
if(args.length!==6||!['--sip-csv','--out','--expected-sha256'].every(x=>args.includes(x)&&value(x)))
  throw new Error('Uso: tsx phase41g-source-cli.ts --sip-csv <CSV> --out <JSON nuevo> --expected-sha256 <SHA>');
const csv=resolve(value('--sip-csv')),out=resolve(value('--out'));
if(out===csv||!/^[a-f0-9]{64}$/.test(value('--expected-sha256')))
  throw new Error('Ruta o SHA-256 inválidos.');
const {candles,calendar,hashes}=loadPhase41bSip(csv);
if(hashes.csv!==value('--expected-sha256'))throw new Error('SHA-256 SIP no coincide con el fijado para esta ejecución.');
const index=createPhase41bIndex(candles,calendar,20);
const base15=candles.map(c=>({ ...c,endTimestamp:new Date(Date.parse(c.timestamp)+900_000).toISOString(),
  dateNy:newYorkBarParts(c.timestamp).day,complete:true,expectedSourceBars:1,observedSourceBars:1,
  scheduledAbbreviated:false}));
const frames={'15m':base15,'1h':buildHourlyCandles(candles,calendar),
  '1d':buildDailyCandles(candles,calendar)} as const;
const rows=Object.entries(frames).flatMap(([timeframe,bars])=>bars.map(bar=>{
  const available=new Date(Date.parse(bar.endTimestamp)+1_200_000).toISOString();
  const context=index(available,bar.endTimestamp).frames[timeframe as '15m'|'1h'|'1d'];
  const verified=bar.complete&&context.barStartUtc===bar.timestamp&&context.barEndUtc===bar.endTimestamp&&
    context.assumedAvailableAtUtc===available;
  return {timeframe,startUtc:bar.timestamp,endUtc:bar.endTimestamp,availableAtUtc:available,
    dateNy:bar.dateNy,localSlot:newYorkBarParts(bar.timestamp).slot,
    open:Number.isFinite(bar.open)?bar.open:null,high:Number.isFinite(bar.high)?bar.high:null,
    low:Number.isFinite(bar.low)?bar.low:null,close:Number.isFinite(bar.close)?bar.close:null,
    volume:bar.volume,complete:bar.complete,expectedSourceBars:bar.expectedSourceBars,
    observedSourceBars:bar.observedSourceBars,scheduledAbbreviated:bar.scheduledAbbreviated,
    continuousBars:verified?context.continuousBars:0,
    sma:verified?Object.fromEntries([20,40,100,200].map(p=>[p,context.sma[p as 20|40|100|200].value])):null,
    interactions:verified?Object.fromEntries([20,40,100,200].map(p=>[p,context.sma[p as 20|40|100|200].interactions])):null,
    verified};
}));
const code=Object.fromEntries([
  'trading_poc_001_bollinger/src/phase41g-source-cli.ts',
  'trading_poc_001_bollinger/src/phase41b-context.ts',
  'trading_poc_001_bollinger/src/investep-technical-context.ts',
  'trading_poc_001_bollinger/src/multitimeframe.ts',
].map(path=>[path,createHash('sha256').update(readFileSync(resolve(path))).digest('hex')]));
writeFileSync(out,JSON.stringify({schema:'phase41g-sip-source-v1',source:{symbol:'NVDA',feed:'sip',
  adjustment:'split',timeframe:'15m',availability:'SIMULATED_HISTORICAL_DELAY',delayMinutes:20,
  hashes,code},calendar:[...calendar].map(([date,hours])=>({date,...hours})),rows})+'\n',{flag:'wx'});
process.stdout.write(JSON.stringify({rows:rows.length,sourceSha256:hashes.csv})+'\n');
