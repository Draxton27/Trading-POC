/** Read-only bridge: original 41A geometry, indexed 41B SIP, compact 41E rows. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createPhase41bIndex,loadPhase41bSip,SIP_DELAYS} from './phase41b-context.ts';
import {projectPhase41e} from './phase41e-feature-context.ts';

const argv=process.argv.slice(2);
const argument=(name:string)=>argv[argv.indexOf(name)+1];
if(argv.length!==6||!['--sip-csv','--queries','--out'].every(name=>argv.includes(name)&&argument(name)))
  throw new Error('Uso: tsx phase41e-feature-context-cli.ts --sip-csv <CSV> --queries <JSON> --out <JSON nuevo>');
const csv=resolve(argument('--sip-csv')),queriesPath=resolve(argument('--queries')),out=resolve(argument('--out'));
if([csv,queriesPath].includes(out))throw new Error('Salida y entrada deben diferir.');
const queries:unknown=JSON.parse(readFileSync(queriesPath,'utf8'));
if(!Array.isArray(queries)||queries.length>50_000)throw new Error('Número de consultas inválido.');
const names=['return_1','return_4','distance_ema9','distance_sma20','bollinger_position',
  'relative_volume_20','candle_range','candle_body','atr14_relative','minutes_from_open'];
const validUtc=(value:unknown):value is string=>typeof value==='string'&&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&
  Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const verified=queries.map(value=>{
  if(typeof value!=='object'||value===null||Array.isArray(value))throw new Error('Consulta inválida.');
  const q=value as Record<string,unknown>;
  if((q.scenario!=='ideal'&&q.scenario!=='delayed')||!Number.isInteger(q.fold)||
      !validUtc(q.barStartUtc)||!validUtc(q.barEndUtc)||!validUtc(q.decisionAtUtc)||
      Date.parse(q.barEndUtc)!==Date.parse(q.barStartUtc)+900_000||
      Date.parse(q.barEndUtc)>Date.parse(q.decisionAtUtc)||
      typeof q.featureSha256!=='string'||!q.features||typeof q.features!=='object'||
      Array.isArray(q.features))throw new Error('Consulta temporal o F0 inválida.');
  const features=q.features as Record<string,unknown>;
  if(Object.keys(features).join(',')!==names.join(',')||
      names.some(name=>typeof features[name]!=='number'||!Number.isFinite(features[name])))
    throw new Error('Orden o valores de F0 originales incompatibles.');
  const digest=createHash('sha256').update(JSON.stringify({spec:'nvda-15m-v1',names,values:features})).digest('hex');
  if(digest!==q.featureSha256)throw new Error('SHA-256 de F0 original inválido.');
  return q as {scenario:'ideal'|'delayed';fold:number;barStartUtc:string;barEndUtc:string;
    decisionAtUtc:string;featureSha256:string;features:Record<string,number>};
});
const keys=new Set(verified.map(q=>`${q.scenario}:${q.barStartUtc}`));
if(keys.size!==verified.length)throw new Error('Consulta duplicada.');
const {candles,calendar,hashes}=loadPhase41bSip(csv);
const codeSha256=Object.fromEntries([
  'trading_poc_001_bollinger/src/phase41b-context.ts',
  'trading_poc_001_bollinger/src/phase41e-feature-context.ts',
  'trading_poc_001_bollinger/src/phase41e-feature-context-cli.ts',
  'trading_poc_001_bollinger/src/investep-technical-context.ts',
  'trading_poc_001_bollinger/src/multitimeframe.ts',
].map(path=>[path,createHash('sha256').update(readFileSync(resolve(path))).digest('hex')]));
const rows=[];
for(const delay of SIP_DELAYS){
  const at=createPhase41bIndex(candles,calendar,delay);
  for(const q of verified)rows.push({scenario:q.scenario,fold:q.fold,barStartUtc:q.barStartUtc,
    decisionAtUtc:q.decisionAtUtc,delayMinutes:delay,
    ...projectPhase41e(at(q.decisionAtUtc,q.barEndUtc))});
}
writeFileSync(out,JSON.stringify({schema:'phase41e-sip-context-v1',source:{symbol:'NVDA',feed:'sip',
  adjustment:'split',timeframe:'15m',availability:'SIMULATED_HISTORICAL_DELAY',hashes,codeSha256},rows})+'\n',{flag:'wx'});
process.stdout.write(JSON.stringify({queries:verified.length,rows:rows.length})+'\n');
