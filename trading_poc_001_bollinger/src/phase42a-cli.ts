import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,renameSync,statSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadMetadata} from './data-contract.ts';
import {parseCandlesCsv} from './csv.ts';
import {loadMarketCalendar} from './alpaca-calendar.ts';
import {newYorkBarParts} from './strategy-validation.ts';
import {PROTOCOL,CATALOG,CATALOG_VERSION,auditDataset,buildMatrix,pilotRows,type AuditState} from './phase42a-matrix.ts';

const root=fileURLToPath(new URL('../../',import.meta.url)),args=process.argv.slice(2);
const option=(name:string)=>{const i=args.indexOf(name);return i<0?null:args[i+1]??null;};
const allowed=['--run-id','--nvda','--amd','--amzn','--as-of'];
for(let i=0;i<args.length;i+=2)if(!allowed.includes(args[i]!)||!args[i+1]||args[i+1]!.startsWith('--')||args.indexOf(args[i]!)!==i)throw Error('ARGUMENTOS_INVALIDOS');
const runId=option('--run-id');if(!runId||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(runId))throw Error('RUN_ID_INVALIDO');
const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const hashFile=(path:string)=>sha(readFileSync(path));
const output=resolve(root,'private','phase42a',runId),parent=dirname(output),temp=resolve(parent,`.${runId}-${randomUUID()}.tmp`);
if(existsSync(output))throw Error('EJECUCION_YA_EXISTE');
const protocolHash=sha(JSON.stringify(PROTOCOL)),catalogHash=sha(JSON.stringify(CATALOG)),auditAtUtc=option('--as-of')??new Date().toISOString();
const cutoff=Date.parse(auditAtUtc);if(!Number.isFinite(cutoff)||new Date(cutoff).toISOString()!==auditAtUtc||cutoff>Date.now())throw Error('CORTE_INVALIDO');
const paths={NVDA:option('--nvda')??resolve(root,'trading_poc_001_bollinger/data/NVDA_ALPACA_SIP_15min_20211017_20261017.csv'),
  AMD:option('--amd')??resolve(root,'trading_poc_001_bollinger/data/AMD_ALPACA_SIP_15min.csv'),AMZN:option('--amzn')??resolve(root,'trading_poc_001_bollinger/data/AMZN_ALPACA_SIP_15min.csv')};
const audits={} as Record<keyof typeof paths,AuditState>,reports:Record<string,unknown>={},inputs:Record<string,unknown>={},rows:string[]=[];
for(const [asset,path] of Object.entries(paths) as [keyof typeof paths,string][]){
  const file=resolve(path),meta=`${file}.meta.json`,calendarPath=`${file}.calendar.json`,provenancePath=`${file}.provenance.json`;
  if(!existsSync(file)){audits[asset]='SIN_DATOS';reports[asset]={status:'SIN_DATOS',missing:['CSV 15m',...(!existsSync(meta)?['metadatos']:[]),...(!existsSync(calendarPath)?['calendario']:[]),...(!existsSync(provenancePath)?['procedencia']:[])]};continue;}
  if(!existsSync(meta)||!existsSync(calendarPath)||!existsSync(provenancePath)){audits[asset]='NO_VERIFICABLE';reports[asset]={status:'NO_VERIFICABLE',missing:[...(!existsSync(meta)?['metadatos']:[]),...(!existsSync(calendarPath)?['calendario']:[]),...(!existsSync(provenancePath)?['procedencia']:[])]};continue;}
  try{
    if(statSync(file).size>50*1024*1024||statSync(meta).size>1024*1024||statSync(calendarPath).size>5*1024*1024||statSync(provenancePath).size>1024*1024)throw Error('LIMITE_ARCHIVO');
    const metadata=loadMetadata(file),provenance=JSON.parse(readFileSync(provenancePath,'utf8')) as Record<string,unknown>;
    if(metadata.asset!==asset||metadata.data_class!=='real'||metadata.bar_minutes!==15||metadata.session!=='regular'||metadata.feed!=='sip'||metadata.adjustment!=='split'||!/^Alpaca Market Data API$/i.test(metadata.provider)||provenance.provider!==metadata.provider||provenance.feed!=='sip'||provenance.adjustment!=='split'||provenance.timeframe!=='15Min'||provenance.session!=='regular')throw Error('PROCEDENCIA_INCOMPATIBLE');
    const candles=parseCandlesCsv(readFileSync(file,'utf8'),metadata,{allowIntradayGaps:true}),calendar=loadMarketCalendar(calendarPath);
    if(Date.parse(candles.at(-1)!.timestamp)+900000>Date.parse(auditAtUtc))throw Error('VELA_NO_CERRADA');
    const audit=auditDataset(candles,calendar),sessions=[...new Set(candles.map(c=>newYorkBarParts(c.timestamp).day))],split=Math.floor(sessions.length*.7);
    audits[asset]='DISPONIBLE';inputs[asset]={csvSha256:hashFile(file),metadataSha256:hashFile(meta),calendarSha256:hashFile(calendarPath),provenanceSha256:hashFile(provenancePath)};
    reports[asset]={status:'DISPONIBLE',provider:metadata.provider,feed:'sip',adjustment:'split',session:'regular',barMinutes:15,
      license:'NO_VERIFICADA: consultar condiciones de la cuenta y redistribución',receipt:'NO_VERIFICADA',pointInTimeAdjustment:'NO_VERIFICADO',split:{explorationSessions:split,evaluationSessions:sessions.length-split,evaluationStart:sessions[split]??null,classification:'AMBOS_EXPLORATORIOS'},audit};
    for(const row of pilotRows(candles,asset,auditAtUtc))rows.push(JSON.stringify(row));
  }catch(error){audits[asset]='NO_VERIFICABLE';const code=error instanceof Error?error.message:'';reports[asset]={status:'NO_VERIFICABLE',reason:['PROCEDENCIA_INCOMPATIBLE','VELA_NO_CERRADA','LIMITE_ARCHIVO'].includes(code)?code:'DATOS_O_CALENDARIO_INVALIDOS'};}
}
const matrix=buildMatrix(audits),frozenPaths=['private/abb-v19-20261022-20261112/abb_v19_report.json','private/abb-v19-20261022-20261112/abb_v19_trades.csv','private/abb-v19-20261022-20261112/abb_v19_audit_sessions.csv','private/abb-v17-iex-resumen.json','private/abb-v17-iex-sesiones.csv','private/abb-v18-base-report.json','private/abb-v18-base-trades.csv','private/abb-v18-slip3_limit1-report.json','private/abb-v18-slip3_limit1-trades.csv','private/abb-v18-slip3_limit1_fee005-report.json','private/abb-v18-slip3_limit1_fee005-trades.csv','private/investep-e2-5y-resumen.json','private/investep-e3e4-resumen.json'];
const frozen=frozenPaths.map(path=>({artifact:path,sha256:existsSync(resolve(root,path))?hashFile(resolve(root,path)):null}));
const report={schema:'phase42a-report-v1',auditAtUtc,protocolHash,catalogHash,assets:reports,matrix,pilot:{status:'NO_VERIFICABLE',universe:'Cada vela examinada; no representa una señal.',examinedRows:rows.length,signals:null,discarded:null,confirmed:null,invalidated:null,metrics:null},frozen,
  frozenStudies:{ABB:'CONGELADA; los archivos presentes se identifican por hash, sin copiarlos ni modificarlos.',E5_E6:'CONGELADAS por instrucción; resultados y parámetros anteriores no localizados, no se inventan.'},
  limitations:['No existe evidencia point-in-time de ajustes ni de recepción histórica.','El trazado E1/E2 y los parámetros Worden E7/E8 no están objetivados en el cuaderno.','Estudios previos y datos vistos no son una evaluación independiente.','Sin precios ejecutables de opciones no se calculan PnL, profit factor ni drawdown.']};
mkdirSync(parent,{recursive:true});mkdirSync(temp);
try{
  const files={'protocol.json':JSON.stringify(PROTOCOL,null,2)+'\n','catalog.json':JSON.stringify({version:CATALOG_VERSION,strategies:CATALOG},null,2)+'\n',
    'report.json':JSON.stringify(report,null,2)+'\n','pilot.jsonl':rows.join('\n')+(rows.length?'\n':''),
    'report.md':`# Fase 42A: investigación exploratoria\n\nProtocolo SHA-256: ${protocolHash}\n\nE1/E2: NO_VERIFICABLE. Las ${rows.length} filas son velas examinadas, no señales.\n\n| Activo | Estado de datos |\n|---|---|\n${Object.entries(audits).map(([a,s])=>`| ${a} | ${s} |`).join('\n')}\n\n## Matriz de estrategias\n\n| Activo | Estrategia | Estado | Motivo |\n|---|---|---|---|\n${matrix.map(x=>`| ${x.asset} | ${x.strategy} | ${x.status} | ${x.reason} |`).join('\n')}\n\nLa recepción histórica y los ajustes point-in-time no están verificados. No se calculan métricas de rendimiento ni PnL de opciones.\n`};
  for(const [name,content] of Object.entries(files))writeFileSync(resolve(temp,name),content,{flag:'wx'});
  const sources=['phase42a-matrix.ts','phase42a-cli.ts','csv.ts','data-contract.ts','alpaca-calendar.ts','nvda-indicators-study.ts','multitimeframe.ts','strategy-validation.ts'];
  const manual=resolve(root,'Investep_Estrategias_1_a_8_Imagenes_1_a_14.pdf');
  const manifest={schema:'phase42a-manifest-v1',protocolHash,catalogHash,inputs,manualSha256:existsSync(manual)?hashFile(manual):null,outputs:Object.fromEntries(Object.entries(files).map(([name,content])=>[name,sha(content)])),codeSha256:Object.fromEntries(sources.map(name=>[name,hashFile(fileURLToPath(new URL(`./${name}`,import.meta.url)))]))};
  writeFileSync(resolve(temp,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});renameSync(temp,output);
}catch(error){throw error;}
console.log(JSON.stringify({runId,assets:audits,examinedRows:rows.length,pilot:'NO_VERIFICABLE',protocolHash,catalogHash}));
