import {mkdirSync, writeFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {loadDataset} from './csv.ts';
import {validateBollingerStrategy} from './strategy-validation.ts';
import {renderValidationReport} from './validation-report.ts';

const path = process.argv[2] ?? 'data/QQQ_ALPACA_SIP_5min.csv';
const {candles, metadata} = loadDataset(path);
if (metadata.data_class !== 'real' || metadata.asset !== 'QQQ' || metadata.bar_minutes !== 5 ||
    metadata.provider !== 'Alpaca Market Data API' || metadata.feed !== 'sip' ||
    metadata.adjustment !== 'split' || metadata.session !== 'regular') {
  throw new Error('La validación requiere QQQ real de Alpaca SIP, velas de 5 minutos, ajustado por split y de sesión regular.');
}
if (candles.length < 300) throw new Error('Se requieren al menos 300 velas.');
const study = validateBollingerStrategy(candles);
const output = join('output', 'real');
mkdirSync(output, {recursive: true});
writeFileSync(join(output, 'strategy-validation.md'), renderValidationReport(study, basename(path)));
writeFileSync(join(output, 'strategy-validation.json'), JSON.stringify({source: basename(path), metadata, study}, null, 2) + '\n');
console.log(`Validación guardada en ${join(output, 'strategy-validation.md')} y ${join(output, 'strategy-validation.json')}.`);
