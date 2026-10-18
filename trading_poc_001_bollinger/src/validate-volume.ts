import {mkdirSync, writeFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {loadDataset} from './csv.ts';
import {studyVolumeFilter} from './volume-study.ts';
import {renderVolumeReport} from './volume-report.ts';

const path = process.argv[2] ?? 'data/QQQ_ALPACA_SIP_5min_12m.csv';
const {candles, metadata} = loadDataset(path);
if (metadata.data_class !== 'real' || metadata.asset !== 'QQQ' || metadata.bar_minutes !== 5 ||
    metadata.provider !== 'Alpaca Market Data API' || metadata.feed !== 'sip' ||
    metadata.adjustment !== 'split' || metadata.session !== 'regular') {
  throw new Error('La investigación de volumen requiere QQQ real de Alpaca SIP, velas de 5 minutos, ajustado por split y de sesión regular.');
}
const study = studyVolumeFilter(candles);
const output = join('output', 'real');
mkdirSync(output, {recursive: true});
writeFileSync(join(output, 'volume-filter-validation.md'), renderVolumeReport(study, basename(path)));
writeFileSync(join(output, 'volume-filter-validation.json'), JSON.stringify({source: basename(path), metadata, study}, null, 2) + '\n');
console.log(`Investigación de volumen guardada en ${join(output, 'volume-filter-validation.md')} y ${join(output, 'volume-filter-validation.json')}.`);
