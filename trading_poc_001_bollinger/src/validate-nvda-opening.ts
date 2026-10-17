import {mkdirSync, writeFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {loadDataset} from './csv.ts';
import {loadMarketCalendar} from './alpaca-calendar.ts';
import {studyNvdaOpening} from './nvda-opening-study.ts';
import {renderNvdaOpeningReport} from './nvda-opening-report.ts';

const path = process.argv[2] ?? 'data/NVDA_ALPACA_SIP_15min_12m.csv';
const {candles, metadata} = loadDataset(path);
if (metadata.data_class !== 'real' || metadata.asset !== 'NVDA' || metadata.bar_minutes !== 15 ||
    metadata.provider !== 'Alpaca Market Data API' || metadata.feed !== 'sip' ||
    metadata.adjustment !== 'split' || metadata.session !== 'regular') {
  throw new Error('El estudio requiere NVDA real de Alpaca SIP, velas de 15 minutos, split y sesión regular.');
}
const calendar = loadMarketCalendar(`${path}.calendar.json`);
const study = studyNvdaOpening(candles, calendar);
const output = join('output', 'real');
mkdirSync(output, {recursive: true});
writeFileSync(join(output, 'nvda-opening-reversion.md'), renderNvdaOpeningReport(study, basename(path)));
writeFileSync(join(output, 'nvda-opening-reversion.json'),
  JSON.stringify({source: basename(path), metadata, study}, null, 2) + '\n');
console.log(`Estudio NVDA guardado en ${join(output, 'nvda-opening-reversion.md')} y ${join(output, 'nvda-opening-reversion.json')}.`);
