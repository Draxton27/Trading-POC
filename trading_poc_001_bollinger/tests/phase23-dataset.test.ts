import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import type {Candle} from '../src/domain.ts';
import type {MarketCalendar} from '../src/alpaca-calendar.ts';
import {parseCandlesCsv,serializeCandles} from '../src/csv.ts';
import {calculateBollinger} from '../src/bollinger.ts';
import {calculateEma9} from '../src/ema9.ts';
import {buildPhase23Dataset,calculatePhase23Features,classifyMovement} from '../src/phase23-dataset.ts';

const BAR_MS=900_000;
const days=['2024-12-30','2024-12-31','2025-01-02','2025-01-03','2025-03-07','2025-03-10','2026-11-27'];
function fixture(){
  const calendar:MarketCalendar=new Map(),candles:Candle[]=[];
  for(const [d,day] of days.entries()){
    const slots=day==='2026-11-27'?14:26;calendar.set(day,{open:570,close:570+slots*15});
    const hour=day==='2025-03-10'?13:14;
    const start=Date.parse(`${day}T${hour}:30:00Z`);
    for(let j=0;j<slots;j++){const close=100+(d*26+j)*0.1; candles.push({timestamp:new Date(start+j*BAR_MS).toISOString(),open:close-0.05,high:close+1,low:close-1,close,volume:100+d*26+j});}
  }
  return {calendar,candles};
}
const metadata={asset:'NVDA',provider:'fixture',bar_minutes:15 as const,data_class:'synthetic' as const,session:'regular' as const,exchange_timezone:'America/New_York' as const};

test('umbrales estrictos conservan igualdad en lateral y exigen datos finitos',()=>{
  assert.equal(classifyMovement(1,2),'LATERAL');assert.equal(classifyMovement(-1,2),'LATERAL');
  assert.equal(classifyMovement(1.001,2),'ALCISTA');assert.equal(classifyMovement(-1.001,2),'BAJISTA');
  assert.throws(()=>classifyMovement(NaN,2));assert.throws(()=>classifyMovement(1,-1));
});
test('variables y ATR de 15 minutos usan solo ventanas conocidas y fórmulas exactas',()=>{
  const {candles,calendar}=fixture(),f=calculatePhase23Features(candles,calendar)[20]!,bar=candles[20]!;
  const bands=calculateBollinger(candles),ema=calculateEma9(candles);
  assert.ok(Math.abs(f.atr14PriceUnits-2)<1e-12);assert.ok(Math.abs(f.atr14_relative-2/bar.close)<1e-12);assert.equal(f.return_1,bar.close/candles[19]!.close-1);
  assert.equal(f.return_4,bar.close/candles[16]!.close-1);assert.equal(f.distance_ema9,bar.close/ema[20]!-1);
  assert.equal(f.distance_sma20,bar.close/bands[20]!.middle!-1);
  assert.equal(f.bollinger_position,(bar.close-bands[20]!.lower!)/(bands[20]!.upper!-bands[20]!.lower!));
  assert.equal(f.relative_volume_20,bar.volume/(candles.slice(0,20).reduce((s,c)=>s+c.volume,0)/20));
  assert.equal(f.candle_range,(bar.high-bar.low)/bar.open);assert.equal(f.candle_body,(bar.close-bar.open)/bar.open);
  assert.equal(calculatePhase23Features(candles,calendar)[19],null);
  const changed=candles.map(c=>({...c}));for(const c of changed.slice(21)){c.close*=2;c.high=c.close+5;c.low=c.open-1;c.volume*=10;}
  assert.deepEqual(calculatePhase23Features(changed,calendar)[20],f);
});
test('ATR incluye salto nocturno con el cierre previo y no usa la vela futura',()=>{
  const {candles,calendar}=fixture();const changed=candles.map(c=>({...c}));
  changed[26]={...changed[26]!,open:120,high:121,low:119,close:120};
  const features=calculatePhase23Features(changed,calendar),base=calculatePhase23Features(candles,calendar);
  const prior=changed[25]!.close;const tr=Math.max(2,Math.abs(121-prior),Math.abs(119-prior));
  assert.ok(Math.abs(features[26]!.atr14PriceUnits-(13*2+tr)/14)<1e-10);
  assert.deepEqual(features[25],base[25]);
});
test('variables y etiquetas son invariantes frente a un ajuste uniforme posterior por split',()=>{
  const {candles,calendar}=fixture();const scaled=candles.map(c=>({...c,open:c.open/10,high:c.high/10,low:c.low/10,close:c.close/10,volume:c.volume*10}));
  const original=buildPhase23Dataset(candles,calendar),adjusted=buildPhase23Dataset(scaled,calendar);
  assert.equal(original.rows.length,adjusted.rows.length);
  for(let i=0;i<original.rows.length;i++){
    const a=original.rows[i]!,b=adjusted.rows[i]!;
    for(const key of ['return_1','return_4','distance_ema9','distance_sma20','bollinger_position','relative_volume_20','candle_range','candle_body','atr14_relative'] as const)assert.ok(Math.abs(a[key]-b[key])<1e-10,key);
    assert.equal(a.label,b.label);
  }
});
test('horizonte, instante de disponibilidad, cortes por sesión y cierre anticipado',()=>{
  const {candles,calendar}=fixture(),result=buildPhase23Dataset(candles,calendar);
  const row=result.rows.find(r=>r.bar_start_utc===candles[20]!.timestamp)!;
  assert.equal(row.partition,'desarrollo');assert.equal(row.observed_at_utc,new Date(Date.parse(candles[20]!.timestamp)+BAR_MS).toISOString());
  assert.equal(row.available_at_utc,row.observed_at_utc);assert.equal(row.label_entry_open,candles[21]!.open);
  assert.equal(row.label_exit_close,candles[24]!.close);assert.equal(row.label_change,candles[24]!.close-candles[21]!.open);
  assert.equal(row.label_available_at_utc,new Date(Date.parse(candles[24]!.timestamp)+BAR_MS).toISOString());
  assert.ok(result.rows.some(r=>r.session_date_ny==='2025-01-02'&&r.partition==='evaluacion_exploratoria'));
  assert.ok(result.rows.some(r=>r.session_date_ny==='2026-11-27'));
  assert.ok(result.rows.filter(r=>r.session_date_ny==='2026-11-27').every(r=>r.bar_start_ny<='11:45'));
  assert.equal(result.exclusions.purga_particion,0);
  assert.equal(result.rows.length+Object.values(result.exclusions).reduce((a,b)=>a+b,0),candles.length);
});
test('huecos intradía excluyen ventanas y sesiones incompletas, reinician indicadores y no se rellenan',()=>{
  const {candles,calendar}=fixture(),missing=candles.filter((_,i)=>i!==29);
  const result=buildPhase23Dataset(missing,calendar);
  assert.ok(result.exclusions.falta_siguiente+result.exclusions.falta_intermedia>0);
  assert.ok(result.exclusions.sesion_incompleta>0);
  assert.ok(!result.rows.some(r=>r.session_date_ny==='2024-12-31'));
  assert.equal(calculatePhase23Features(missing,calendar)[29],null);
  assert.equal(result.audit.partialSessions.length,1);
});
test('respeta DST y evita cruzar una sesión ausente en el calendario',()=>{
  const {candles,calendar}=fixture();const result=buildPhase23Dataset(candles,calendar);
  assert.ok(result.rows.some(r=>r.session_date_ny==='2025-03-07'&&r.bar_start_ny==='09:30'&&r.bar_start_utc.endsWith('14:30:00.000Z')));
  assert.ok(result.rows.some(r=>r.session_date_ny==='2025-03-10'&&r.bar_start_ny==='09:30'&&r.bar_start_utc.endsWith('13:30:00.000Z')));
  calendar.set('2025-03-09',{open:570,close:960});
  const index=candles.findIndex(c=>c.timestamp==='2025-03-10T13:30:00.000Z');
  assert.equal(calculatePhase23Features(candles,calendar)[index],null);
});
test('validador existente rechaza duplicados y OHLCV corrupto aunque permita huecos',()=>{
  const {candles}=fixture();const duplicate=[...candles.slice(0,2),candles[1]!];
  assert.throws(()=>parseCandlesCsv(serializeCandles(duplicate),metadata,{allowIntradayGaps:true}));
  const bad=candles.map(c=>({...c}));bad[0]!.high=1;
  assert.throws(()=>parseCandlesCsv(serializeCandles(bad),metadata,{allowIntradayGaps:true}));
});
test('CLI rechaza datos sintéticos en vez de tratarlos como reales',()=>{
  const dir=mkdtempSync(join(tmpdir(),'phase23-'));
  try{const data=join(dir,'data');mkdirSync(data);const source=join(data,'NVDA_ALPACA_SIP_15min_20211017_20261017.csv');
    writeFileSync(source,serializeCandles(fixture().candles));writeFileSync(source+'.meta.json',JSON.stringify(metadata));
    writeFileSync(source+'.calendar.json','{}');writeFileSync(source+'.provenance.json','{}');
    assert.throws(()=>execFileSync(process.execPath,['--experimental-strip-types',resolve('src/phase23-cli.ts')],{cwd:dir,stdio:'pipe'}));
  }finally{rmSync(dir,{recursive:true,force:true});}
});
