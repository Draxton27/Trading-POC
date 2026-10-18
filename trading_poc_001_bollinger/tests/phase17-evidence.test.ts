import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {parseCsvRows} from '../src/phase17-csv.ts';

test('registro de evidencia conserva ocho temas y procedencia pendiente de cotejo', () => {
  const path = new URL('../../shared-artifacts/phase17-human-method/phase17-operator-evidence-register.csv',
    import.meta.url);
  const [header, ...rows] = parseCsvRows(readFileSync(path, 'utf8'));
  assert.deepEqual(header, ['claim_id','tema','resumen_fiel','procedencia',
    'estado_verificacion','temporalidad','variable_observable_propuesta',
    'ambiguedad_pendiente','interpretacion_tecnica_separada','prueba_futura',
    'regla_potencial_no_implementada','referencia']);
  assert.equal(rows.length, 36);
  assert.equal(new Set(rows.map(row => row[0])).size, rows.length);
  assert.deepEqual([...new Set(rows.map(row => row[1]))].sort(),
    ['Bollinger','Estructura','No operar','Opciones','Preparación',
      'Revisión posterior','Riesgo y salida','Tendencia'].sort());
  assert.ok(rows.every(row => row.length === header!.length && row.every(Boolean)));
  assert.ok(rows.filter(row => row[0] !== 'PRE07_V2').every(row =>
    row[3] === 'resumen_conversacional_de_audio_pendiente_de_cotejo' &&
    row[4] === 'declaracion_atribuida_pendiente_de_cotejo_con_audio'));
  assert.match(rows.find(row => row[0] === 'PRE07')![7]!, /Nombre/);
  const update = rows.find(row => row[0] === 'PRE07_V2')!;
  assert.match(update[2]!, /estrictamente menor que 2,5/);
  assert.match(update[2]!, /1,21/);
  assert.match(update[4]!, /indicador_identificado_y_umbral_declarado/);
  assert.match(update[7]!, /CALL; PUT/);
  assert.match(update[8]!, /no es volatilidad ni predictor intradía/);
  assert.match(update[11]!, /captura adjunta al mensaje del usuario documentado 2026-10-18 UTC/);
  assert.match(update[11]!, /https:\/\/finviz\.com\/help\/screener/);
  assert.match(update[11]!, /fecha de mercado no verificable/);
  assert.match(rows.find(row => row[0] === 'TRE06')![8]!, /No es probabilidad/);
});
