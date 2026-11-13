import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadMarketCalendar} from './alpaca-calendar.ts';
import {newYorkLocalToUtc} from './phase42b-queue.ts';
import {historicalBollinger15,historicalRelativeMinutes,historicalSessionMinutes,type HistoricalBar} from './phase42b-retrospective.ts';

const root=resolve(fileURLToPath(new URL('../..',import.meta.url)),'private','phase42b');
const sha=(v:Buffer)=>createHash('sha256').update(v).digest('hex');
function load(run:string,symbol:string,frame:string){
  const dir=join(root,'alpaca',run),manifestBytes=readFileSync(join(dir,'manifest.json'));
  const m=JSON.parse(manifestBytes.toString('utf8')) as {symbol:string;frame:string;feed:string;adjustment:string;pages:{sha256:string}[]};
  if(m.symbol!==symbol||m.frame!==frame||m.feed!=='sip'||m.adjustment!=='raw'||!Array.isArray(m.pages)||!m.pages.length||m.pages.length>500)throw Error('MANIFEST_INVALID');
  const result:HistoricalBar[]=[];
  for(const [i,page] of m.pages.entries()){
    const raw=readFileSync(join(dir,`page-${i+1}.json`));if(sha(raw)!==page.sha256)throw Error('PAGE_HASH_MISMATCH');
    const data=JSON.parse(raw.toString('utf8')) as {bars:Record<string,Record<string,unknown>[]>|null};
    for(const bar of data.bars?.[symbol]??[]){
      const t=typeof bar.t==='string'?Date.parse(bar.t):NaN;const vals=[bar.o,bar.h,bar.l,bar.c,bar.v];
      if(!Number.isFinite(t)||vals.some(x=>typeof x!=='number'||!Number.isFinite(x))||(bar.l as number)<=0||
        (bar.v as number)<0||(bar.h as number)<Math.max(bar.o as number,bar.c as number,bar.l as number)||
        (bar.l as number)>Math.min(bar.o as number,bar.c as number))throw Error('BAR_INVALID');
      result.push({timestamp:new Date(t).toISOString(),open:bar.o as number,high:bar.h as number,low:bar.l as number,
        close:bar.c as number,volume:bar.v as number,providerVwap:typeof bar.vw==='number'&&Number.isFinite(bar.vw)&&bar.vw>0?bar.vw:null});
    }
  }
  return {bars:result,manifestSha256:sha(manifestBytes)};
}
function main(){
  const a=process.argv.slice(2),names=['--symbol','--entry-local','--bars15-run','--bars1-run','--calendar-run','--source-run','--snapshot-id','--run-id'];
  if(![16,20].includes(a.length)||names.some((n,i)=>a[i*2]!==n)||![a[5],a[7],a[9],a[11],a[15],...(a.length===20?[a[17],a[19]]:[])].every(x=>typeof x==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(x))||
    (a.length===20&&(a[16]!=='--qqq-run'||a[18]!=='--smh-run'))||
    !/^rec[A-Za-z0-9]{14}$/.test(a[13]??'')||!/^[A-Z][A-Z0-9.]{0,9}$/.test(a[1]??''))throw Error('USAGE');
  const symbol=a[1]!,entryLocal=a[3]!,entryUtc=newYorkLocalToUtc(entryLocal),m15=load(a[5]!,symbol,'15Min'),m1=load(a[7]!,symbol,'1Min');
  const sourcePath=join(root,'sources',a[11]!),sourceManifestBytes=readFileSync(join(sourcePath,'manifest.json'));
  const sourceManifest=JSON.parse(sourceManifestBytes.toString('utf8')) as {version:string;tables:Record<string,{sha256:string;count:number}>};
  const snapshotBytes=readFileSync(join(sourcePath,'table-3.json')),sourceName='Yoel - Snapshot tecnico';
  if(sourceManifest.version!=='42B-source-v1'||sourceManifest.tables?.[sourceName]?.sha256!==sha(snapshotBytes))throw Error('SNAPSHOT_HASH_MISMATCH');
  const snapshots=JSON.parse(snapshotBytes.toString('utf8')) as {table:string;records:{id:string;fields:Record<string,unknown>}[]};
  if(snapshots.table!==sourceName||!Array.isArray(snapshots.records)||snapshots.records.length!==sourceManifest.tables[sourceName]!.count)throw Error('SNAPSHOT_SOURCE_INVALID');
  const matches=snapshots.records.filter(row=>row.id===a[13]);
  if(matches.length!==1||matches[0]!.fields.Ticker!==symbol||matches[0]!.fields['Entrada ET']!==entryLocal||
    !Array.isArray(matches[0]!.fields['Trade relacionado'])||!matches[0]!.fields['Trade relacionado'].length)throw Error('SNAPSHOT_IDENTITY_MISMATCH');
  const calendarPath=join(root,'calendars',a[9]!,'calendar.json'),calendar=loadMarketCalendar(calendarPath);
  const bb=historicalBollinger15(m15.bars,calendar,entryUtc),intraday=historicalSessionMinutes(m1.bars,calendar,entryLocal);
  const qqq=a.length===20?load(a[17]!,'QQQ','1Min'):null,smh=a.length===20?load(a[19]!,'SMH','1Min'):null;
  const relative={qqq:qqq?historicalRelativeMinutes(m1.bars,qqq.bars,calendar,entryLocal):null,
    smh:smh?historicalRelativeMinutes(m1.bars,smh.bars,calendar,entryLocal):null};
  const parent=join(root,'reconstructions');mkdirSync(parent,{recursive:true});const target=join(parent,a[15]!);mkdirSync(target);
  const report={version:'42B-retrospective-v1',symbol,entryLocal,entryUtc,status:'NO_VERIFICABLE',
    limitations:['RECEPCION_HISTORICA_NO_VERIFICADA','AJUSTES_Y_EVENTOS_CORPORATIVOS_NO_VERIFICADOS','CONTEXTO_CONDICIONAL_NO_PRUEBA_INTENCION'],
    sources:{m15:m15.manifestSha256,m1:m1.manifestSha256,calendar:sha(readFileSync(calendarPath)),
      snapshotId:matches[0]!.id,tradeIds:matches[0]!.fields['Trade relacionado'],sourceManifestSha256:sha(sourceManifestBytes),
      snapshotSha256:createHash('sha256').update(JSON.stringify(matches[0])).digest('hex'),qqq:qqq?.manifestSha256??null,smh:smh?.manifestSha256??null},
    observedConditional:{bb15:bb,intraday,relative},hypotheses:['FORTALEZA_RELATIVA','CATALIZADOR','RETESTEO','VWAP','APERTURA_ANTICIPATORIA','PROMEDIADO'],
    supportingEvidence:[],contradictingEvidence:[],laterEvolution:null};
  writeFileSync(join(target,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:report.status,bb15:bb.status,intraday:intraday.status}));
}
try{main();}catch(error){console.error(`Fase 42B: ${error instanceof Error?error.message:'ERROR'}`);process.exitCode=1;}
