import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {loadMarketCalendar} from '../../../../trading_poc_001_bollinger/src/alpaca-calendar.ts';
import {iexCoverage,readIexLedger} from '../../../../trading_poc_001_bollinger/src/phase38-iex.ts';
import {isIexProcessActive} from '../../../../trading_poc_001_bollinger/src/phase38-iex-lock.ts';
import {compareIexSip} from '../../../../trading_poc_001_bollinger/src/phase38-iex-compare.ts';
import {readIngestion} from '../../../../trading_poc_001_bollinger/src/phase32-ingestion.ts';
import {readAlpacaIngestionStatus} from './ingestion.ts';

const query=z.object({symbol:z.literal('NVDA').default('NVDA'),timeframe:z.literal('15m').default('15m')}).strict();
export function readIexFeedStatus(paths:{iexLog:string;calendar:string;sipLog:string},clock:()=>number=Date.now){
  const sip=readAlpacaIngestionStatus(paths.sipLog,clock);
  const absent={status:'NO_DATA',connection:'DISCONNECTED',feed:'iex',adjustment:'raw',symbol:'NVDA',timeframe:'15m',lastBarStartUtc:null,lastBarEndUtc:null,receivedAtUtc:null,latencyMs:null,revision:null,coverage:null,comparison:null,sip};
  if(!existsSync(paths.iexLog)||!existsSync(paths.calendar))return absent;
  try{
    const rows=readIexLedger(paths.iexLog),calendar=loadMarketCalendar(paths.calendar);
    const quarter=rows.filter(r=>r.kind==='quarter'&&r.bar).sort((a,b)=>Date.parse(a.bar!.endUtc)-Date.parse(b.bar!.endUtc)||a.revision!-b.revision!).at(-1);
    const latestStatus=rows.filter(r=>r.kind==='status').at(-1);
    const active=isIexProcessActive(paths.iexLog);
    const coverage=iexCoverage(rows,calendar);
    const comparison=existsSync(paths.sipLog)?compareIexSip(rows,readIngestion(paths.sipLog),calendar):null;
    const age=quarter?clock()-Date.parse(quarter.bar!.endUtc):null;
    return {status:quarter?(age!==null&&age<20*60_000?'READY':'STALE'):'NO_DATA',connection:active?latestStatus?.status??'CONNECTING':'DISCONNECTED',feed:'iex',adjustment:'raw',symbol:'NVDA',timeframe:'15m',lastBarStartUtc:quarter?.bar?.startUtc??null,lastBarEndUtc:quarter?.bar?.endUtc??null,receivedAtUtc:quarter?.receivedAtUtc??null,latencyMs:quarter?.latencyMs??null,revision:quarter?.revision??null,coverage,comparison,sip};
  }catch{return {...absent,status:'INVALID_DATA'};}
}
export function registerIexRoutes(app:FastifyInstance,privateDir:string,env:NodeJS.ProcessEnv=process.env){
  const paths={iexLog:env.TRADING_POC_IEX_LEDGER??resolve(privateDir,'iex','ledger.jsonl'),calendar:env.TRADING_POC_IEX_CALENDAR??resolve(privateDir,'iex','calendar.json'),sipLog:env.TRADING_POC_ALPACA_INGESTION_LOG??resolve(privateDir,'alpaca-ingestion','ledger.jsonl')};
  app.get('/api/v1/ml/feeds',(request,reply)=>{if(!query.safeParse(request.query).success)return reply.code(400).send({error:'Solo NVDA de 15 minutos.'});return readIexFeedStatus(paths);});
}
