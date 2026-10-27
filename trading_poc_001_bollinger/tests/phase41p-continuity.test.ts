import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {IexRecord} from '../src/phase38-iex.ts';
import type {RestContext} from '../src/phase41p-continuity.ts';
import {causalIexCandles,diagnoseOpportunityContinuity,mergeOfficialCalendar} from '../src/phase41p-continuity.ts';
import {prepareOpportunityTechnicalV2} from '../src/phase41p-live-engine.ts';
import {loadIexRestContext,registerIexRestContext} from '../src/phase41p-rest-context.ts';

const Q=900_000, hash='a'.repeat(64);
const stamp=(n:number)=>new Date(n).toISOString();
const first=Date.parse('2026-10-20T13:30:00.000Z');
const calendar=new Map([['2026-10-20',{open:570,close:960}],['2026-10-21',{open:570,close:960}]]);
const candle=(time:number,close=100)=>({timestamp:stamp(time),open:close,high:close+1,low:close-1,close,volume:1000});
const rest=(count=26,registeredAtUtc='2026-10-20T20:30:00.000Z'):RestContext=>({
  candles:Array.from({length:count},(_,i)=>candle(first+i*Q)),calendar:new Map([['2026-10-20',{open:570,close:960}]]),
  registeredAtUtc,csvSha256:hash,manifestSha256:hash,kind:'41P_REST_CONTEXT'});
const liveStart=Date.parse('2026-10-21T13:30:00.000Z');
function live(index:number,revision=1,close=101):IexRecord{
  const time=liveStart+index*Q,end=stamp(time+Q),receivedAtUtc=stamp(time+Q+5_000);
  return {schema:'phase38-iex-v1',id:`${index}-${revision}`,previousHash:null,recordHash:`${index}-${revision}`,
    kind:'quarter',feed:'iex',adjustment:'raw',symbol:'NVDA',eventAtUtc:end,receivedAtUtc,
    status:'COMPLETE',revision,sourceMessageHash:hash,latencyMs:5000,
    bar:{startUtc:stamp(time),endUtc:end,open:close,high:close+1,low:close-1,close,volume:1000,tradeCount:10}};
}
const subscribed=():IexRecord=>({...live(0),kind:'status',bar:null,status:'SUBSCRIBED',revision:null,
  receivedAtUtc:stamp(liveStart)});
const now=stamp(liveStart+3*Q+10_000);

test('41P conecta REST registrado antes de Live y conserva primera versión frente a revisión',()=>{
  const rows=[subscribed(),live(0),live(1),live(2),live(0,2,200)];
  const joined=causalIexCandles(rows,[rest()],now);
  assert.equal(joined.length,29);
  assert.equal(joined.at(-3)?.candle.close,101);
  assert.equal(joined.at(-3)?.source,'LIVE');
  const audit=diagnoseOpportunityContinuity({records:rows,calendar,rest:[rest()],nowUtc:now});
  assert.equal(audit.code,'INSUFFICIENT_DAILY_SMA_HISTORY');
  assert.equal(audit.bridge.missing15mCount,0);
  assert.equal(audit.live.revisions,1);
  assert.equal(audit.indicators.timeframes['15m'].smas[20].missingBars,0);
  assert.equal(audit.indicators.timeframes['1d'].smas[200].value,null);
  assert.equal(audit.indicators.timeframes['1d'].smas[200].missingBars,199);
  const prepared=prepareOpportunityTechnicalV2(rows,calendar,[rest()],now);
  assert.equal(prepared.status,'READY');
  assert.equal(prepared.sourceHashes.length,29);
  assert.equal(prepared.warmup,'REST_REGISTERED');
});

test('41P distingue barra intradía faltante y sesión completa ausente',()=>{
  const rows=[subscribed(),live(0),live(2)];
  const audit=diagnoseOpportunityContinuity({records:rows,calendar,rest:[rest()],nowUtc:now});
  assert.equal(audit.code,'MISSING_EXPECTED_15M_BAR');
  assert.equal(audit.bridge.missing15mCount,1);
  assert.equal(audit.bridge.firstMissing15mUtc,live(1).bar?.startUtc);
  const later=new Map([...calendar,['2026-10-22',{open:570,close:960}]]);
  const thursday=stamp(Date.parse('2026-10-22T13:30:00.000Z'));
  const moved={...live(0),bar:{...live(0).bar!,startUtc:thursday,endUtc:stamp(Date.parse(thursday)+Q)},
    receivedAtUtc:stamp(Date.parse(thursday)+Q+5_000)};
  const session=diagnoseOpportunityContinuity({records:[subscribed(),moved],calendar:later,rest:[rest()],
    nowUtc:stamp(Date.parse(thursday)+Q+10_000)});
  assert.equal(session.code,'MISSING_OFFICIAL_SESSION');
  assert.ok(session.bridge.missingSessions.includes('2026-10-21'));
});

test('41P no atribuye un snapshot posterior a una recepción Live anterior',()=>{
  const late=rest(26,stamp(liveStart+3*Q+6_000));
  const rows=[subscribed(),live(0),live(1),live(2)];
  assert.equal(causalIexCandles(rows,[late],stamp(liveStart+2*Q)).length,1);
  const audit=diagnoseOpportunityContinuity({records:rows,calendar,rest:[late],nowUtc:now});
  assert.equal(audit.code,'WARMUP_REGISTERED_TOO_LATE');
  assert.equal(prepareOpportunityTechnicalV2(rows,calendar,[late],now).status,'INSUFFICIENT_DATA');
});

test('41P rechaza calendarios oficiales incompatibles sin inventar horarios',()=>{
  const conflicting={...rest(),calendar:new Map([['2026-10-20',{open:570,close:780}]])};
  assert.throws(()=>mergeOfficialCalendar(calendar,[conflicting]),/CALENDAR_INCOMPATIBLE/);
  assert.equal(diagnoseOpportunityContinuity({records:[subscribed(),live(0)],calendar,rest:[conflicting],
    nowUtc:stamp(liveStart+Q+10_000)}).code,'CALENDAR_INCOMPATIBLE');
});

test('41P registra snapshot REST privado una sola vez y detecta cambios de hash',()=>{
  const directory=mkdtempSync(join(tmpdir(),'phase41p-context-'));
  const source=join(directory,'source'),registry=join(directory,'registry.json');
  const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
  try{
    mkdirSync(source);
    const query={schema:'phase38d-v1',symbol:'NVDA',feed:'iex',timeframe:'1Min',adjustment:'raw',
      start:'2026-10-20T13:30:00.000Z',end:'2026-10-20T13:45:00.000Z'};
    const csv='timestamp,open,high,low,close,volume\n2026-10-20T13:30:00.000Z,100,101,99,100.5,1000\n';
    const calendarFile=JSON.stringify({provider:'Alpaca Market Calendar',sessions:[
      {date:'2026-10-20',open:570,close:960}]});
    const report={schema:'phase38d-report-v1',source:query,sha256:{strict15mCsv:sha(csv),
      calendar:sha(calendarFile)},summary:{strict15m:1,sessionsComplete:0,sessionsPartial:1}};
    for(const [name,content] of [['query.json',JSON.stringify(query)],['calendar.json',calendarFile],
      ['strict-15m.csv',csv],['report.json',JSON.stringify(report)]] as const)
      writeFileSync(join(source,name),content);
    writeFileSync(join(source,'SHA256SUMS'),['query.json','calendar.json','strict-15m.csv','report.json']
      .map(name=>`${sha(readFileSync(join(source,name),'utf8'))}  ${name}\n`).join(''));
    const registered=registerIexRestContext(source,registry,()=> '2026-10-20T14:00:00.000Z');
    assert.equal(loadIexRestContext(registry).snapshotId,registered.snapshotId);
    assert.throws(()=>registerIexRestContext(source,registry,()=> '2026-10-20T14:01:00.000Z'));
    assert.equal(loadIexRestContext(registry).snapshotId,registered.snapshotId);
    writeFileSync(join(source,'strict-15m.csv'),csv+'2026-10-20T13:45:00.000Z,100,101,99,100.5,1000\n');
    assert.throws(()=>loadIexRestContext(registry),/Hash|incompatible/);
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('41P respeta cambio EDT, fin de semana y cierre anticipado del calendario oficial',()=>{
  const cases=[
    {day:'2026-03-06',next:'2026-03-09',restOpen:'2026-03-06T14:30:00.000Z',
      liveOpen:'2026-03-09T13:30:00.000Z',close:960,count:26},
    {day:'2026-11-27',next:'2026-11-30',restOpen:'2026-11-27T14:30:00.000Z',
      liveOpen:'2026-11-30T14:30:00.000Z',close:780,count:14},
  ];
  for(const item of cases){
    const from=Date.parse(item.restOpen),start=Date.parse(item.liveOpen);
    const official=new Map([[item.day,{open:570,close:item.close}],
      [item.next,{open:570,close:960}]]);
    const historical:RestContext={...rest(),candles:Array.from({length:item.count},(_,i)=>candle(from+i*Q)),
      calendar:new Map([[item.day,{open:570,close:item.close}]]),
      registeredAtUtc:stamp(from+item.count*Q+60_000)};
    const bar={...live(0),bar:{...live(0).bar!,startUtc:stamp(start),endUtc:stamp(start+Q)},
      receivedAtUtc:stamp(start+Q+5_000)};
    const status={...subscribed(),receivedAtUtc:stamp(start)};
    const audit=diagnoseOpportunityContinuity({records:[status,bar],calendar:official,
      rest:[historical],nowUtc:stamp(start+Q+10_000)});
    assert.equal(audit.bridge.missing15mCount,0,item.day);
    assert.equal(audit.bridge.firstExpectedAfterRestUtc,item.liveOpen,item.day);
    assert.equal(audit.bridge.continuousSuffixBars,item.count+1,item.day);
  }
});
