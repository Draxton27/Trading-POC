import {mkdirSync, writeFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {loadDataset} from './csv.ts';
import {studyEma9Filter} from './ema9-study.ts';
import {renderEma9Report} from './ema9-report.ts';

const path = process.argv[2] ?? 'data/QQQ_ALPACA_SIP_5min_12m.csv';
const {candles, metadata} = loadDataset(path);
if (metadata.data_class !== 'real' || metadata.asset !== 'QQQ' ||
    metadata.provider !== 'Alpaca Market Data API' || metadata.feed !== 'sip' ||
    metadata.adjustment !== 'split' || metadata.session !== 'regular') {
  throw new Error('La investigación EMA 9 requiere QQQ real de Alpaca SIP, ajustado por split y de sesión regular.');
}
const study = studyEma9Filter(candles);
const output = join('output', 'real');
mkdirSync(output, {recursive: true});
writeFileSync(join(output, 'ema9-filter-validation.md'), renderEma9Report(study, basename(path)));
writeFileSync(join(output, 'ema9-filter-validation.json'), JSON.stringify({source: basename(path), metadata, study}, null, 2) + '\n');
console.log(`Investigación EMA 9 guardada en ${join(output, 'ema9-filter-validation.md')} y ${join(output, 'ema9-filter-validation.json')}.`);
