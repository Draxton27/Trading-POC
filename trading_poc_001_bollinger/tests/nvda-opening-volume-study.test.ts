import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import type {Candle} from '../src/domain.ts';
import type {MarketCalendar} from '../src/alpaca-calendar.ts';
import {studyNvdaOpening} from '../src/nvda-opening-study.ts';
import {studyNvdaOpeningVolume} from '../src/nvda-opening-volume-study.ts';
import {renderNvdaOpeningVolumeReport} from '../src/nvda-opening-volume-report.ts';

function fixture(): {candles: Candle[]; calendar: MarketCalendar} {
  const candles: Candle[] = [];
  const calendar: MarketCalendar = new Map();
  const day = new Date('2026-03-02T00:00:00Z');
  while (candles.length < 35) {
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) {
      const date = day.toISOString().slice(0, 10);
      const index = candles.length;
      const openingHourUTC = date < '2026-03-09' ? 14 : 13;
      const timestamp = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(),
        day.getUTCDate(), openingHourUTC, 30)).toISOString();
      const price = index % 2 === 0 ? 99.5 : 100.5;
      const [open, high, low, close] = index < 20 ? [price, price, price, price] :
        index === 20 ? [110, 112, 100, 100] :
        index === 21 ? [90, 95, 89, 95] : [100, 101, 99, 100];
      const volume = index === 20 ? 200 : index === 21 ? 50 : index === 23 ? 150 : 100;
      candles.push({timestamp, open: open!, high: high!, low: low!, close: close!, volume});
      calendar.set(date, {open: 570, close: 960});
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return {candles, calendar};
}

test('RVOL usa las 20 aperturas previas y distingue 09:30 de disponibilidad a 09:45', () => {
  const {candles, calendar} = fixture();
  const study = studyNvdaOpeningVolume(candles, calendar);
  const day20 = study.days.find(day => day.date === candles[20]!.timestamp.slice(0, 10))!;
  const day21 = study.days.find(day => day.date === candles[21]!.timestamp.slice(0, 10))!;
  assert.equal(study.lookbackSessions, 20);
  assert.equal(study.days.length, 15);
  assert.deepEqual([day20.priorSessions, day20.matchingSessions, day20.historicalAverage,
    day20.openingVolume, day20.rvol], [20, 20, 100, 200, 2]);
  assert.equal(day20.direction, 'encima');
  assert.equal(day20.rangeReturned15, true);
  assert.equal(day20.closeConfirmed15, true);
  assert.equal(day20.volumeAvailableAt,
    new Date(Date.parse(day20.openingTimestamp) + 15 * 60_000).toISOString());
  assert.match(day20.openingTimestamp, /T13:30:00/); // EDT después del cambio horario
  assert.match(day20.volumeAvailableAt, /T13:45:00/);
  assert.deepEqual([day21.historicalAverage, day21.openingVolume, day21.direction],
    [105, 50, 'debajo']);
  assert.equal(day21.rangeReturned15, false);
  assert.equal(study.openingRows.find(row => row.segment === 'total' && row.band === 'todas')!.openingDays,
    15);
  const first15 = studyNvdaOpening(candles, calendar).events;
  assert.deepEqual(study.returnRows.find(row => row.segment === 'total' && row.band === 'todas' &&
    row.direction === 'encima')!.rangeReturns,
  first15.filter(event => event.direction === 'encima' && event.outcomes['15'].rangeReturned).length);
});

test('cambios de volumen actual y futuro no alteran referencia, apertura ni regreso ya observados', () => {
  const {candles, calendar} = fixture();
  const before = studyNvdaOpeningVolume(candles, calendar);
  const changed = structuredClone(candles);
  changed[20]!.volume = 500;
  for (let i = 21; i < changed.length; i++) changed[i]!.volume = 9999;
  const after = studyNvdaOpeningVolume(changed, calendar);
  const currentBefore = before.days.find(day => day.openingTimestamp === candles[20]!.timestamp)!;
  const currentAfter = after.days.find(day => day.openingTimestamp === candles[20]!.timestamp)!;
  assert.equal(currentAfter.historicalAverage, currentBefore.historicalAverage);
  assert.equal(currentAfter.rvol, 5);
  assert.deepEqual([currentAfter.direction, currentAfter.rangeReturned15, currentAfter.closeConfirmed15],
    [currentBefore.direction, currentBefore.rangeReturned15, currentBefore.closeConfirmed15]);
  assert.deepEqual(after.exploratoryRvolCutpoints.sample, before.exploratoryRvolCutpoints.sample);
  const evaluationOnly = structuredClone(candles);
  for (let i = 24; i < evaluationOnly.length; i++) evaluationOnly[i]!.volume = 9999;
  assert.deepEqual(studyNvdaOpeningVolume(evaluationOnly, calendar).exploratoryRvolCutpoints,
    before.exploratoryRvolCutpoints);
});

test('apertura faltante entre las 20 sesiones observadas deja RVOL sin dato y no se reemplaza', () => {
  const {candles, calendar} = fixture();
  candles[5]!.timestamp = new Date(Date.parse(candles[5]!.timestamp) + 15 * 60_000).toISOString();
  const study = studyNvdaOpeningVolume(candles, calendar);
  const day20 = study.days.find(day => day.openingTimestamp === candles[20]!.timestamp)!;
  assert.deepEqual([day20.priorSessions, day20.matchingSessions, day20.historicalAverage,
    day20.rvol, day20.volumeAvailability],
  [20, 19, null, null, 'falta_apertura_previa']);
  assert.equal(day20.direction, 'encima');
  assert.equal(day20.rangeReturned15, true);
  const day26 = study.days.find(day => day.openingTimestamp === candles[26]!.timestamp)!;
  assert.equal(day26.volumeAvailability, 'disponible');
});

test('20 velas previas no bastan si pertenecen a menos de 20 sesiones', () => {
  const {candles, calendar} = fixture();
  const extra = structuredClone(candles[0]!);
  extra.timestamp = new Date(Date.parse(extra.timestamp) + 15 * 60_000).toISOString();
  candles.splice(1, 0, extra);
  const study = studyNvdaOpeningVolume(candles, calendar);
  const day19 = study.days.find(day => day.openingTimestamp === candles[20]!.timestamp)!;
  assert.deepEqual([day19.priorSessions, day19.matchingSessions, day19.rvol,
    day19.volumeAvailability], [19, 19, null, 'menos_de_20_sesiones']);
});

test('promedio histórico cero no produce RVOL infinito', () => {
  const {candles, calendar} = fixture();
  for (const candle of candles.slice(0, 20)) candle.volume = 0;
  const day20 = studyNvdaOpeningVolume(candles, calendar).days.find(day =>
    day.openingTimestamp === candles[20]!.timestamp)!;
  assert.deepEqual([day20.historicalAverage, day20.rvol,
    day20.volumeAvailability], [0, null, 'promedio_cero']);
});

test('el reporte separa estudio retrospectivo y horario disponible; muestra volumen y tamaños', () => {
  const {candles, calendar} = fixture();
  const report = renderNvdaOpeningVolumeReport(studyNvdaOpeningVolume(candles, calendar), 'controlado.csv');
  assert.match(report, /retrospectiva/);
  assert.match(report, /09:30/);
  assert.match(report, /09:45/);
  assert.match(report, /Volumen primera vela medio/);
  assert.match(report, /Promedio histórico medio/);
  assert.match(report, /RVOL medio/);
  assert.match(report, /Último 30% cronológico/);
  assert.match(report, /Muestra pequeña/);
  assert.match(report, /No son umbrales mínimos/);
});

test('el comando de volumen NVDA rechaza datos ficticios sin crear el estudio real', () => {
  const project = fileURLToPath(new URL('../', import.meta.url));
  const result = spawnSync(process.execPath,
    ['--experimental-strip-types', 'src/validate-nvda-opening-volume.ts', 'data/QQQ_FICTICIO_5min.csv'],
    {cwd: project, encoding: 'utf8'});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requiere NVDA real de Alpaca SIP/);
});
