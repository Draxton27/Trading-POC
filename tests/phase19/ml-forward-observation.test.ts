import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {appendSuccessfulCapture,readIngestion} from '../../trading_poc_001_bollinger/src/phase32-ingestion.ts';
import {appendForwardObservation,prepareForwardObservation,readForwardObservations} from '../../trading_poc_001_bollinger/src/phase34-forward-observation.ts';
import {readForwardObservation} from '../../apps/api/src/ml/forward-observation.ts';
import {createApp} from '../../apps/api/src/server.ts';

const clean:string[]=[];afterEach(()=>clean.splice(0).forEach(path=>rmSync(path,{recursive:true,force:true})));
const day='2026-01-02',calendar=new Map([[day,{open:570,close:960}]]);
const model={id:'frozen',sha256:'a'.repeat(64),createdAtUtc:'2025-10-20T13:49:17.000Z'};
function bars(count=22){return Array.from({length:count},(_,i)=>{const open=100+i*.1;return {timestamp:new Date(Date.UTC(2026,0,2,14,30+i*15)).toISOString(),open,high:open+.2,low:open-.2,close:open+.05,volume:1000+i};});}
function root(){const value=mkdtempSync(join(tmpdir(),'phase34-'));clean.push(value);return value;}
function capture(rows:ReturnType<typeof bars>,receivedAtUtc='2026-01-02T20:05:00.000Z'){return {candles:rows,queryAtUtc:receivedAtUtc,receivedAtUtc,responseSha256:'b'.repeat(64),availability:'DELAYED' as const,barAgeMs:20*60_000};}
function input(prepared:ReturnType<typeof prepareForwardObservation>){return {mode:'DELAYED_FORWARD_OBSERVATION' as const,model,bar:{startUtc:prepared.prepared.barStartUtc,endUtc:prepared.prepared.barEndUtc,sessionDateNy:prepared.prepared.sessionDateNy,sourceRecordHash:prepared.candidate.recordHash,sourceResponseSha256:prepared.candidate.responseSha256!,revision:prepared.candidate.bar!.revision,receivedAtUtc:prepared.candidate.receivedAtUtc},sourceBars:prepared.sourceBars,features:{spec:'nvda-15m-v1' as const,hash:prepared.prepared.featureHash,values:prepared.prepared.features},prediction:{ALCISTA:.2,BAJISTA:.3,LATERAL:.5,dominantClass:'LATERAL' as const},source:{provider:'Alpaca Market Data API' as const,feed:'sip' as const,adjustment:'split' as const,availability:'DELAYED' as const}};}

describe('Fase 34: observación adelantada desde ledger SIP retrasado',()=>{
  it('registra la última vela admisible antes de t+4, preserva revisión y es idempotente',()=>{
    const folder=root(),ledger=join(folder,'ledger.jsonl'),log=join(folder,'forward.jsonl');appendSuccessfulCapture(ledger,capture(bars()));
    const prepared=prepareForwardObservation(ledger,calendar,model,'2026-01-02T20:05:00.000Z');
    expect(prepared.prepared.barStartUtc).toBe('2026-01-02T19:45:00.000Z');expect(prepared.sourceBars).toHaveLength(22);
    const first=appendForwardObservation(log,input(prepared),'2026-01-02T20:05:01.000Z');expect(first.record).toMatchObject({mode:'DELAYED_FORWARD_OBSERVATION',recordedBeforeOutcome:true,recordedBeforeNextEntry:false,hypotheticalNextEntryOpen:null,outcomeT4Close:null});
    // A later provider correction to an older candle cannot mutate the first record.
    appendSuccessfulCapture(ledger,capture([{...bars(1)[0]!,close:101}], '2026-01-02T20:06:00.000Z'));
    const repeated=appendForwardObservation(log,input(prepared),'2026-01-02T20:06:01.000Z');expect(repeated.alreadyPresent).toBe(true);expect(readForwardObservations(log)).toHaveLength(1);
    expect(readIngestion(ledger).filter(row=>row.kind==='bar')).toHaveLength(23);
  });
  it('no hace backfill, rechaza historial insuficiente, gaps y modelo posterior a la vela',()=>{
    const folder=root(),ledger=join(folder,'ledger.jsonl');appendSuccessfulCapture(ledger,capture(bars()));
    expect(()=>prepareForwardObservation(ledger,calendar,model,'2026-01-02T21:00:00.000Z')).toThrow(/desenlace|backfill/);
    const short=join(folder,'short.jsonl');appendSuccessfulCapture(short,capture(bars(20)));expect(()=>prepareForwardObservation(short,calendar,model,'2026-01-02T20:05:00.000Z')).toThrow(/Indicadores insuficientes/);
    const gap=join(folder,'gap.jsonl');appendSuccessfulCapture(gap,capture(bars().filter((_,i)=>i!==10)));expect(()=>prepareForwardObservation(gap,calendar,model,'2026-01-02T20:05:00.000Z')).toThrow(/Indicadores insuficientes|continuidad/);
    expect(()=>prepareForwardObservation(ledger,calendar,{...model,createdAtUtc:'2026-01-02T19:45:00.000Z'},'2026-01-02T20:05:00.000Z')).toThrow(/posterior|simultáneo/);
  });
  it('verifica cadena, no permite probabilidades inválidas y expone solo lectura obsoleta',()=>{
    const folder=root(),ledger=join(folder,'ledger.jsonl'),log=join(folder,'forward.jsonl');appendSuccessfulCapture(ledger,capture(bars()));const prepared=prepareForwardObservation(ledger,calendar,model,'2026-01-02T20:05:00.000Z');
    expect(()=>appendForwardObservation(log,{...input(prepared),prediction:{ALCISTA:.6,BAJISTA:.3,LATERAL:.1,dominantClass:'LATERAL'}},'2026-01-02T20:05:01.000Z')).toThrow(/dominante/);
    appendForwardObservation(log,input(prepared),'2026-01-02T20:05:01.000Z');expect(readForwardObservation(log,model.sha256,()=>Date.parse('2026-01-02T21:00:00.000Z'))).toMatchObject({status:'STALE_DATA',mode:'DELAYED_FORWARD_OBSERVATION',recordedBeforeOutcome:true});
    writeFileSync(ledger,'{}\n');expect(()=>prepareForwardObservation(ledger,calendar,model,'2026-01-02T20:05:00.000Z')).toThrow(/alterado|secuencial/);
  });
  it('respeta el último instante elegible de un cierre anticipado y no expone rutas de escritura',async()=>{
    const earlyDay='2026-07-03',priorDay='2026-07-02',earlyCalendar=new Map([[priorDay,{open:570,close:960}],[earlyDay,{open:570,close:780}]]);
    const sequence=(date:string,startHour:number,count:number)=>Array.from({length:count},(_,i)=>{const open=100+i*.1;return {timestamp:new Date(Date.UTC(Number(date.slice(0,4)),Number(date.slice(5,7))-1,Number(date.slice(8,10)),startHour,30+i*15)).toISOString(),open,high:open+.2,low:open-.2,close:open+.05,volume:1000+i};});
    const folder=root(),ledger=join(folder,'early.jsonl');appendSuccessfulCapture(ledger,capture([...sequence(priorDay,13,26),...sequence(earlyDay,13,10)],'2026-07-03T16:05:00.000Z'));
    expect(prepareForwardObservation(ledger,earlyCalendar,model,'2026-07-03T16:05:00.000Z').prepared.barStartUtc).toBe('2026-07-03T15:45:00.000Z');
    const {app}=await createApp({mode:'DEMO',privateDir:folder,dbPath:join(folder,'test.sqlite')});try{expect((await app.inject('/api/v1/ml/forward-observation?symbol=NVDA&timeframe=15m')).json()).toMatchObject({status:'NO_MODEL'});expect(app.printRoutes()).not.toMatch(/\/api\/v1\/ml\/.*(observe|order|capture)/);}finally{await app.close();}
  });
});
