import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {MarketCalendar} from '../src/alpaca-calendar.ts';
import type {Candle} from '../src/domain.ts';
import {historyCoverage, importNvdaHistory, monthlyChunks, parseHistoryRange} from '../src/nvda-history.ts';
import {loadDataset} from '../src/csv.ts';

const NOW=Date.parse('2026-04-01T12:00:00Z');
const range=parseHistoryRange(['--start','2026-01-01','--end','2026-02-28'],NOW);
const dateBars=(date:string,count=26):Candle[]=>{
  const start=Date.parse(`${date}T14:30:00Z`);
  return Array.from({length:count},(_,i)=>({timestamp:new Date(start+i*900_000).toISOString(),
    open:100,high:101,low:99,close:100.5,volume:1000+i}));
};
const calendarFor=(date:string):MarketCalendar=>new Map([[date,{open:570,close:960}]]);

test('años 3 a 5 y fechas explícitas producen ventanas distintas, válidas y no solapadas',()=>{
  for(const years of [3,4,5]){
    const planned=parseHistoryRange(['--years',String(years)],NOW);
    assert.ok(planned.fileStem.includes('NVDA_ALPACA_SIP_15min_'));
    assert.ok(Date.parse(planned.end)<NOW-20*60_000);
    const chunks=monthlyChunks(planned);
    assert.ok(chunks.length>=36&&chunks.length<=61);
    assert.equal(chunks[0]!.start,planned.start);
    assert.equal(chunks.at(-1)!.end,planned.end);
    for(let i=1;i<chunks.length;i++)assert.equal(Date.parse(chunks[i]!.start)-Date.parse(chunks[i-1]!.end),900_000);
  }
  assert.equal(monthlyChunks(range).length,2);
  assert.throws(()=>parseHistoryRange(['--years','6'],NOW),/Uso/);
  assert.throws(()=>parseHistoryRange(['--start','2026-02-30','--end','2026-03-01'],NOW),/inválida/);
  assert.throws(()=>parseHistoryRange(['--start','2026-03-01','--end','2026-04-01'],NOW),/demasiado reciente/);
});

test('reanudación tras fallo conserva fragmentos y publica CSV, metadatos, calendario y procedencia separados',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'nvda-history-'));
  try{
    const original=join(directory,'NVDA_ALPACA_SIP_15min_12m.csv');
    writeFileSync(original,'original-intacto\n');
    let calendarCalls=0,barsCalls=0;
    const fetchCalendar=async({start}:{start:string})=>{
      calendarCalls++;
      return calendarFor(start.startsWith('2026-01')?'2026-01-05':'2026-02-02');
    };
    const fetchBars=async({start}:{start:string})=>{
      barsCalls++;
      if(start.startsWith('2026-02')&&barsCalls===2)throw new Error('interrupción simulada');
      return dateBars(start.startsWith('2026-01')?'2026-01-05':'2026-02-02');
    };
    const options={range,outputDirectory:directory,apiKey:'fake-key',secretKey:'fake-secret',now:NOW,
      pause:async()=>{},
      fetchCalendar:fetchCalendar as typeof import('../src/alpaca-calendar.ts').fetchAlpacaCalendar,
      fetchBars:fetchBars as typeof import('../src/alpaca.ts').fetchAlpacaBars};
    await assert.rejects(importNvdaHistory(options),/interrupción simulada/);
    assert.equal(existsSync(join(directory,`${range.fileStem}.csv`)),false);
    const result=await importNvdaHistory(options);
    assert.equal(result.resumedChunks,1);
    assert.equal(result.candles,52);
    assert.equal(calendarCalls,3);
    assert.equal(barsCalls,3);
    assert.equal(readFileSync(original,'utf8'),'original-intacto\n');
    assert.equal(loadDataset(result.filePath).candles.length,52);
    const provenance=JSON.parse(readFileSync(`${result.filePath}.provenance.json`,'utf8'));
    assert.equal(provenance.feed,'sip');
    assert.equal(provenance.adjustment,'split');
    assert.equal(provenance.credentials_recorded,false);
    assert.ok(!JSON.stringify(provenance).includes('fake-secret'));
    assert.equal(result.coverage.observedSessions,2);
    await assert.rejects(importNvdaHistory(options),/no se sobrescribe/);
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('sesión parcial se registra; velas fuera del cierre de calendario se rechazan',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'nvda-partial-'));
  const oneDay=parseHistoryRange(['--start','2026-01-05','--end','2026-01-05'],NOW);
  try{
    const options={range:oneDay,outputDirectory:directory,apiKey:'fake',secretKey:'fake',now:NOW,
      pause:async()=>{},
      fetchCalendar:async()=>calendarFor('2026-01-05'),
      fetchBars:async()=>dateBars('2026-01-05',21)};
    const result=await importNvdaHistory(options);
    assert.deepEqual(result.coverage.partialSessions,[{date:'2026-01-05',observed:21,expected:26}]);
  }finally{rmSync(directory,{recursive:true,force:true});}
  const second=mkdtempSync(join(tmpdir(),'nvda-late-'));
  try{
    await assert.rejects(importNvdaHistory({range:oneDay,outputDirectory:second,apiKey:'fake',secretKey:'fake',now:NOW,
      pause:async()=>{},
      fetchCalendar:async()=>new Map([['2026-01-05',{open:570,close:780}]]),
      fetchBars:async()=>dateBars('2026-01-05',26)}),/fuera de calendario/);
  }finally{rmSync(second,{recursive:true,force:true});}
});

test('sesión completa ausente se informa sin inventar velas y nunca se aceptan secretos vacíos',async()=>{
  const oneDay=parseHistoryRange(['--start','2026-01-05','--end','2026-01-06'],NOW);
  const calendar:MarketCalendar=new Map([
    ['2026-01-05',{open:570,close:960}],['2026-01-06',{open:570,close:960}],
  ]);
  assert.deepEqual(historyCoverage(dateBars('2026-01-05'),calendar,oneDay),{
    calendarSessions:2,observedSessions:1,missingSessions:['2026-01-06'],partialSessions:[],
  });
  const directory=mkdtempSync(join(tmpdir(),'nvda-auth-'));
  try{
    await assert.rejects(importNvdaHistory({range:oneDay,outputDirectory:directory,
      apiKey:'',secretKey:'',fetchCalendar:async()=>{throw new Error('no debe consultar red');}}),
    /Faltan secretos Alpaca/);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
