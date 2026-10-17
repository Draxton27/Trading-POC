import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateMetadata} from '../src/data-contract.ts';
import {reportDirectory, saveReportArtifacts} from '../src/report-output.ts';

test('el destino depende de la clasificación validada, no del nombre del CSV', () => {
  const metadata = validateMetadata({
    asset: 'QQQ', provider: 'proveedor de prueba', bar_minutes: 5,
    data_class: 'synthetic', session: 'regular', exchange_timezone: 'America/New_York',
  });
  assert.equal(reportDirectory(metadata), 'output');
  assert.equal(reportDirectory(validateMetadata({...metadata, data_class: 'real'})), join('output', 'real'));
});

test('guardar un informe real crea solo output/real y conserva el informe ficticio', () => {
  const root = mkdtempSync(join(tmpdir(), 'trading-report-test-'));
  try {
    const fixture = validateMetadata({asset: 'QQQ', provider: 'fixture controlado', bar_minutes: 5,
      data_class: 'real', session: 'regular', exchange_timezone: 'America/New_York'});
    const existing = join(root, 'report.md');
    writeFileSync(existing, 'informe ficticio existente');
    const destination = saveReportArtifacts(fixture,
      {reportMarkdown: 'informe de prueba', reportJson: '{}', signalsCsv: 'cabecera\n'}, root);
    assert.equal(destination, join(root, 'real'));
    assert.equal(readFileSync(existing, 'utf8'), 'informe ficticio existente');
    assert.equal(readFileSync(join(destination, 'report.md'), 'utf8'), 'informe de prueba');
    assert.equal(readFileSync(join(destination, 'report.json'), 'utf8'), '{}');
    assert.ok(existsSync(join(destination, 'signals.csv')));
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
