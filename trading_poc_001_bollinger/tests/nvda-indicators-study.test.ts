import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import type {Candle} from '../src/domain.ts';
import type {MarketCalendar} from '../src/alpaca-calendar.ts';
import {calculateBollinger} from '../src/bollinger.ts';
import {detectSignals} from '../src/signals.ts';
import {calculateEma9} from '../src/ema9.ts';
import {calculateVolumeReferences} from '../src/volume-filter.ts';
import {auditNvdaCalendar, evaluateNvdaHorizon, studyNvdaIndicators} from '../src/nvda-indicators-study.ts';
import {newYorkBarParts} from '../src/strategy-validation.ts';

function candle(timestamp: string, close = 100, volume = 100, open = 100): Candle {
  return {timestamp, open, high: Math.max(open, close), low: Math.min(open, close), close, volume};
}
function regularDay(date: string, utcHour = 13, count = 26): Candle[] {
  const start = Date.parse(`${date}T${String(utcHour).padStart(2,'0')}:30:00Z`);
  return Array.from({length: count}, (_, i) => candle(new Date(start + i * 900_000).toISOString()));
}
function calendar(entries: [string, number, number][]): MarketCalendar {
  return new Map(entries.map(([date, open, close]) => [date, {open, close}]));
}
function days(count: number, first = '2026-06-01'): {bars: Candle[]; schedule: MarketCalendar} {
  const bars: Candle[] = [], schedule: MarketCalendar = new Map();
  const current = new Date(`${first}T00:00:00Z`);
  while (schedule.size < count) {
    if (![0,6].includes(current.getUTCDay())) {
      const date = current.toISOString().slice(0,10);
      schedule.set(date,{open:570,close:960});
      bars.push(...regularDay(date));
    }
    current.setUTCDate(current.getUTCDate()+1);
  }
  return {bars,schedule};
}
const near = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a-b)<1e-9);

test('Bollinger 20/2 y ruptura original son idénticos salvo disponibilidad de 15m; vela futura no cambia la señal', () => {
  const {bars,schedule} = days(6);
  bars[120] = {...bars[120]!, close:110, high:110};
  const points = calculateBollinger(bars);
  const legacy = detectSignals(points);
  const fifteen = detectSignals(points,100,.2,1.05,12,15);
  assert.deepEqual(fifteen.map(s=>[s.index,s.direction]),legacy.map(s=>[s.index,s.direction]));
  const signal = fifteen.find(s=>s.index===120)!;
  assert.equal(signal.direction,'CALL_CONTEXT');
  assert.equal(signal.availableAt,new Date(Date.parse(signal.timestamp)+900_000).toISOString());
  assert.equal(legacy.find(s=>s.index===120)!.availableAt,new Date(Date.parse(signal.timestamp)+300_000).toISOString());
  assert.ok(points[120]!.upper! < 110);
  const altered = bars.map((bar,i)=>i>120? {...bar,close:200,high:200}:bar);
  assert.deepEqual(detectSignals(calculateBollinger(altered),100,.2,1.05,12,15).filter(s=>s.index<=120),
    fifteen.filter(s=>s.index<=120));
  assert.equal(auditNvdaCalendar(bars,schedule).partialSessions.length,0);
});

test('EMA 9 continúa entre sesiones; pendiente y precio son datos al cierre de la señal, RVOL no usa su propio volumen', () => {
  const {bars,schedule} = days(21);
  const i = 20*26+10;
  bars[i] = {...bars[i]!, close:110, high:110, volume:150};
  const study = studyNvdaIndicators(bars,schedule);
  const record = study.signals.find(r=>r.signal.index===i)!;
  assert.ok(record);
  assert.equal(record.emaPass,true);
  assert.equal(record.closeAboveEma,true);
  assert.equal(record.averageVolume20,100);
  near(record.rvol,1.5);
  assert.equal(record.volumePass,true);
  assert.equal(record.signal.availableAt,new Date(Date.parse(bars[i]!.timestamp)+900_000).toISOString());
  const ema = calculateEma9(bars);
  near(ema[8],100);
  near(ema[i],102);
  assert.equal(ema[26],100);
  const altered = bars.map((bar,index)=>index>i?{...bar,close:200,high:200,volume:99999}:bar);
  const again = studyNvdaIndicators(altered,schedule).signals.find(r=>r.signal.index===i)!;
  assert.equal(again.rvol,record.rvol);
  assert.equal(again.ema9,record.ema9);
  const base = study.rows.find(r=>r.segment==='total' && r.direction==='CALL_CONTEXT' && r.horizonMinutes===15 && r.group==='bollinger')!;
  const vol = study.rows.find(r=>r.segment==='total' && r.direction==='CALL_CONTEXT' && r.horizonMinutes===15 && r.group==='volume')!;
  assert.ok(base.original>=1);
  assert.equal(vol.coverage+vol.insufficient,vol.original);
});

test('RVOL requiere el mismo intervalo en 20 sesiones anteriores, también al cambiar EST a EDT', () => {
  const before = ['2026-02-09','2026-02-10','2026-02-11','2026-02-12','2026-02-13','2026-02-17','2026-02-18','2026-02-19','2026-02-20','2026-02-23',
    '2026-02-24','2026-02-25','2026-02-26','2026-02-27','2026-03-02','2026-03-03','2026-03-04','2026-03-05','2026-03-06','2026-03-09','2026-03-10'];
  const bars = before.map((date,i)=>candle(`${date}T${i<19?'14':'13'}:30:00Z`,100,i===20?150:100));
  const references = calculateVolumeReferences(bars);
  assert.equal(references[19]!.average,null);
  assert.equal(references[20]!.average,100);
  assert.equal(newYorkBarParts(bars[0]!.timestamp).slot,newYorkBarParts(bars[20]!.timestamp).slot);
  const missing = bars.filter((_,i)=>i!==5);
  assert.equal(calculateVolumeReferences(missing).at(-1)!.average,null);
  const zeros = bars.map((bar,i)=>({...bar,volume:i===20?150:0}));
  assert.equal(calculateVolumeReferences(zeros)[20]!.average,0);
});

test('horizontes exactos desde siguiente apertura, sentido bajista, cierres, huecos y otra sesión', () => {
  const bars = regularDay('2026-06-01');
  bars[1] = {...bars[1]!, open:100,close:101,high:101};
  bars[2] = {...bars[2]!,close:102,high:102};
  bars[4] = {...bars[4]!,close:104,high:104};
  const schedule = calendar([['2026-06-01',570,960]]);
  near(evaluateNvdaHorizon(bars,0,1,'CALL_CONTEXT',schedule).value,1);
  near(evaluateNvdaHorizon(bars,0,2,'CALL_CONTEXT',schedule).value,2);
  near(evaluateNvdaHorizon(bars,0,4,'CALL_CONTEXT',schedule).value,4);
  near(evaluateNvdaHorizon(bars,0,4,'PUT_CONTEXT',schedule).value,-4);
  assert.equal(evaluateNvdaHorizon(bars,25,1,'CALL_CONTEXT',schedule).reason,'session_close');
  assert.equal(evaluateNvdaHorizon(bars,22,4,'CALL_CONTEXT',schedule).reason,'session_close');
  const missing = bars.filter((_,i)=>i!==2);
  assert.equal(evaluateNvdaHorizon(missing,0,2,'CALL_CONTEXT',schedule).reason,'missing_intermediate');
  assert.equal(evaluateNvdaHorizon(missing,1,1,'CALL_CONTEXT',schedule).reason,'missing_next');
  assert.throws(()=>auditNvdaCalendar([...bars].reverse(),schedule),/desordenadas/);
});

test('calendario excluye festivo y cierre anticipado; división por sesiones y resultados vacíos son explícitos', () => {
  const schedule = calendar([['2026-11-25',570,960],['2026-11-27',570,780],['2026-11-30',570,960],['2026-12-01',570,960]]);
  const bars = [...regularDay('2026-11-25',14),...regularDay('2026-11-27',14,14),
    ...regularDay('2026-11-30',14),...regularDay('2026-12-01',14)];
  const audit = auditNvdaCalendar(bars,schedule);
  assert.deepEqual(audit.missingSessions,[]);
  assert.equal(audit.partialSessions.length,0);
  const absent = auditNvdaCalendar(bars.filter(b=>newYorkBarParts(b.timestamp).day!=='2026-11-30'),schedule);
  assert.deepEqual(absent.missingSessions,['2026-11-30']);
  assert.equal(evaluateNvdaHorizon(bars,26+10,4,'CALL_CONTEXT',schedule).reason,'session_close');
  assert.throws(()=>auditNvdaCalendar([candle('2026-11-26T14:30:00Z')],schedule),/fuera de calendario/);
  const study = studyNvdaIndicators(bars,schedule);
  assert.equal(study.splitDate,'2026-12-01');
  assert.deepEqual(study.sessionCounts,{exploracion:3,evaluacion:1});
  assert.equal(study.signalCount,0);
  const row = study.rows.find(r=>r.segment==='evaluacion' && r.group==='ema9_volume')!;
  assert.equal(row.eligible.count,0);
  assert.equal(row.eligible.meanSignedPercent,null);
  assert.equal(row.differenceInterval95Percent,null);
  assert.equal(row.smallSample,true);
});

test('señal bajista y comparabilidad del filtro combinado con RVOL insuficiente', () => {
  const {bars,schedule}=days(6);
  bars[120]={...bars[120]!,close:90,low:90};
  const study=studyNvdaIndicators(bars,schedule);
  const record=study.signals.find(r=>r.signal.index===120)!;
  assert.equal(record.signal.direction,'PUT_CONTEXT');
  assert.equal(record.emaPass,true);
  assert.equal(record.closeAboveEma,false);
  assert.equal(record.rvol,null);
  const row=study.rows.find(r=>r.segment==='total' && r.direction==='PUT_CONTEXT' && r.horizonMinutes===15 && r.group==='ema9_volume')!;
  assert.equal(row.coverage,0);
  assert.equal(row.insufficient,row.original);
  assert.equal(row.differenceMeanPercent,null);
});
