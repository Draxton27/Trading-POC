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
  assert.equal(rows.length, 35);
  assert.equal(new Set(rows.map(row => row[0])).size, rows.length);
  assert.deepEqual([...new Set(rows.map(row => row[1]))].sort(),
    ['Bollinger','Estructura','No operar','Opciones','Preparación',
      'Revisión posterior','Riesgo y salida','Tendencia'].sort());
  assert.ok(rows.every(row => row.length === header!.length && row.every(Boolean) &&
    row[3] === 'resumen_conversacional_de_audio_pendiente_de_cotejo' &&
    row[4] === 'declaracion_atribuida_pendiente_de_cotejo_con_audio'));
  assert.match(rows.find(row => row[0] === 'PRE07')![7]!, /Nombre/);
  assert.match(rows.find(row => row[0] === 'TRE06')![8]!, /No es probabilidad/);
});
