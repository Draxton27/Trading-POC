import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createPhase41bIndex,loadPhase41bSip,SIP_DELAYS} from './phase41b-context.ts';

const args=process.argv.slice(2);
const option=(name:string)=>{const at=args.indexOf(name);return at<0?undefined:args[at+1];};
if(args.length!==6||!['--sip-csv','--queries','--out'].every(name=>option(name)))
  throw new Error('Uso: tsx phase41b-context-cli.ts --sip-csv <CSV SIP> --queries <JSON> --out <JSON nuevo>');
const csv=resolve(option('--sip-csv')!),queriesPath=resolve(option('--queries')!),output=resolve(option('--out')!);
if(csv===output||queriesPath===output)throw new Error('La salida no puede sobrescribir entradas.');
const raw:unknown=JSON.parse(readFileSync(queriesPath,'utf8'));
if(!Array.isArray(raw)||raw.length>50_000)throw new Error('Consultas inválidas o excesivas.');
const validUtc=(value:string)=>/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&
  Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const queries=raw.map(value=>{
  if(typeof value!=='object'||value===null||Array.isArray(value))throw new Error('Consulta inválida.');
  const q=value as Record<string,unknown>;
  if(typeof q.scenario!=='string'||typeof q.barStartUtc!=='string'||
      typeof q.barEndUtc!=='string'||typeof q.decisionAtUtc!=='string'||
      (q.scenario!=='ideal'&&q.scenario!=='delayed')||!Number.isInteger(q.fold))throw new Error('Consulta incompleta.');
  if(!validUtc(q.barStartUtc)||!validUtc(q.barEndUtc)||!validUtc(q.decisionAtUtc)||
      Date.parse(q.barEndUtc)!==Date.parse(q.barStartUtc)+900_000||
      Date.parse(q.barEndUtc)>Date.parse(q.decisionAtUtc))throw new Error('Timestamps de consulta incompatibles.');
  return q as {scenario:'ideal'|'delayed';fold:number;barStartUtc:string;barEndUtc:string;decisionAtUtc:string};
});
const keys=new Set(queries.map(q=>`${q.scenario}:${q.barStartUtc}`));
if(keys.size!==queries.length)throw new Error('Consultas IEX duplicadas.');
const {candles,calendar,hashes}=loadPhase41bSip(csv);
const codeSha256=Object.fromEntries([
  'trading_poc_001_bollinger/src/phase41b-context.ts',
  'trading_poc_001_bollinger/src/phase41b-context-cli.ts',
  'trading_poc_001_bollinger/src/investep-technical-context.ts',
  'trading_poc_001_bollinger/src/multitimeframe.ts',
].map(path=>[path,createHash('sha256').update(readFileSync(resolve(path))).digest('hex')]));
const rows=[];
for(const delay of SIP_DELAYS){const at=createPhase41bIndex(candles,calendar,delay);
  for(const query of queries)rows.push({scenario:query.scenario,fold:query.fold,barStartUtc:query.barStartUtc,
    ...at(query.decisionAtUtc,query.barEndUtc)});
}
writeFileSync(output,JSON.stringify({schema:'phase41b-context-v1',source:{symbol:'NVDA',provider:'Alpaca Market Data API',
  feed:'sip',adjustment:'split',timeframe:'15m',calendar:'Alpaca Market Calendar',
  firstBarStartUtc:candles[0]!.timestamp,lastBarEndUtc:new Date(Date.parse(candles.at(-1)!.timestamp)+900_000).toISOString(),
  hashes,codeSha256},rows})+'\n',{flag:'wx'});
process.stdout.write(JSON.stringify({rows:rows.length,firstSipBar:candles[0]!.timestamp,lastSipBar:candles.at(-1)!.timestamp})+'\n');
