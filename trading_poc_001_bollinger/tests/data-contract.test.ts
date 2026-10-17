import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {fileURLToPath} from 'node:url';
import {parseBarStart, barEndTimestamp, validateBarTime, validateMetadata} from '../src/data-contract.ts';
import {loadDataset, parseCandlesCsv} from '../src/csv.ts';
import {calculateBollinger} from '../src/bollinger.ts';
import {detectSignals} from '../src/signals.ts';

const regular = validateMetadata({
  asset: 'QQQ', provider: 'test fixture', bar_minutes: 5, data_class: 'synthetic',
  session: 'regular', exchange_timezone: 'America/New_York',
});
const extended = validateMetadata({...regular, session: 'extended'});
const header = 'timestamp,open,high,low,close,volume\n';
const row = (timestamp: string, values = '100,101,99,100,10') => `${timestamp},${values}\n`;

test('timestamp exige zona, fecha real y alineación UTC de cinco minutos', () => {
  assert.equal(new Date(parseBarStart('2026-06-01T09:30:00-04:00')).toISOString(), '2026-06-01T13:30:00.000Z');
  for (const value of [
    '2026-06-01T13:30:00', '2026-02-30T13:30:00Z', '2026-06-01T13:32:00Z',
    '2026-06-01T13:30:01Z', '2026-06-01T13:30:00+15:00',
  ]) assert.throws(() => parseBarStart(value));
  assert.equal(barEndTimestamp('2026-06-01T13:30:00.000Z'), '2026-06-01T13:35:00.000Z');
});

test('CSV normaliza offsets y rechaza duplicados, desorden, huecos y valores inválidos', () => {
  const valid = parseCandlesCsv(header + row('2026-06-01T09:30:00-04:00') + row('2026-06-01T13:35:00Z'), regular);
  assert.equal(valid[0]!.timestamp, '2026-06-01T13:30:00.000Z');
  assert.equal(valid.length, 2);
  for (const body of [
    row('2026-06-01T13:30:00Z') + row('2026-06-01T09:30:00-04:00'),
    row('2026-06-01T13:35:00Z') + row('2026-06-01T13:30:00Z'),
    row('2026-06-01T13:30:00Z') + row('2026-06-01T13:40:00Z'),
    row('2026-06-01T13:30:00Z', '100,101,99,100,'),
    row('2026-06-01T13:30:00Z', '100,101,99,100,-1'),
    row('2026-06-01T13:30:00Z', '100,101,99,100,1.5'),
    row('2026-06-01T13:30:00Z', '100,101,99,100,0x10'),
    row('2026-06-01T13:30:00Z', '100,101,99,Infinity,10'),
    row('2026-06-01T13:30:00Z', '100,99,98,100,10'),
    row('2026-06-01T13:30:00Z', '0,101,99,100,10'),
  ]) assert.throws(() => parseCandlesCsv(header + body, regular));
  assert.throws(() => parseCandlesCsv('timestamp,open,high,low,close,close\n' + row('2026-06-01T13:30:00Z'), regular));
});

test('sesión regular respeta horario de verano y cierre normal', () => {
  const fridayClose = parseBarStart('2026-03-06T20:55:00Z'); // 15:55 EST
  const mondayOpen = parseBarStart('2026-03-09T13:30:00Z'); // 09:30 EDT
  validateBarTime(fridayClose, null, regular);
  validateBarTime(mondayOpen, fridayClose, regular);
  assert.throws(() => validateBarTime(parseBarStart('2026-03-09T13:25:00Z'), null, regular)); // 09:25 EDT
  validateBarTime(parseBarStart('2026-11-02T14:30:00Z'), null, regular); // 09:30 EST
  assert.throws(() => validateBarTime(parseBarStart('2026-11-02T13:30:00Z'), null, regular)); // 08:30 EST
});

test('regular y extendido tienen límites distintos; no se inventa calendario festivo', () => {
  const premarket = parseBarStart('2026-06-01T08:00:00Z'); // 04:00 EDT
  validateBarTime(premarket, null, extended);
  assert.throws(() => validateBarTime(premarket, null, regular));
  assert.throws(() => validateBarTime(parseBarStart('2026-06-01T20:00:00Z'), null, regular)); // 16:00 EDT
  assert.throws(() => validateBarTime(parseBarStart('2026-06-06T13:30:00Z'), null, regular));
  const beforeHoliday = parseBarStart('2026-07-02T19:55:00Z');
  const afterHoliday = parseBarStart('2026-07-06T13:30:00Z');
  validateBarTime(afterHoliday, beforeHoliday, regular);
});

test('metadatos explícitos rechazan campos ausentes o clasificaciones inválidas', () => {
  assert.equal(regular.data_class, 'synthetic');
  for (const value of [{...regular, provider: ''}, {...regular, bar_minutes: 7},
    {...regular, data_class: 'unknown'}, {...regular, exchange_timezone: 'UTC'}]) {
    assert.throws(() => validateMetadata(value));
  }
});

test('el conjunto de demostración carga su clasificación desde el archivo de metadatos', () => {
  const path = fileURLToPath(new URL('../data/QQQ_FICTICIO_5min.csv', import.meta.url));
  const {candles, metadata} = loadDataset(path);
  assert.equal(candles.length, 7800);
  assert.equal(metadata.data_class, 'synthetic');
  assert.equal(metadata.provider, 'generador deterministico del POC');
});

test('una señal se publica al final de su vela, sin cambiar la condición de ruptura', () => {
  const candles = Array.from({length: 130}, (_, i) => {
    const close = i === 120 ? 110 : 100;
    return {timestamp: new Date(Date.UTC(2026, 5, 1, 13, 30 + i * 5)).toISOString(), open: close, high: close, low: close, close, volume: 1};
  });
  const signal = detectSignals(calculateBollinger(candles)).find(s => s.index === 120);
  assert.equal(signal?.direction, 'CALL_CONTEXT');
  assert.equal(signal?.availableAt, signal?.candleEndTimestamp);
  assert.equal(signal?.availableAt, new Date(Date.parse(signal!.timestamp) + 300_000).toISOString());
});
