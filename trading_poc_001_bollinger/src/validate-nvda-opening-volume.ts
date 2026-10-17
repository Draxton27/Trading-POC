import {mkdirSync, writeFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {loadDataset} from './csv.ts';
import {loadMarketCalendar} from './alpaca-calendar.ts';
import {studyNvdaOpeningVolume} from './nvda-opening-volume-study.ts';
import {renderNvdaOpeningVolumeReport} from './nvda-opening-volume-report.ts';

const path = process.argv[2] ?? 'data/NVDA_ALPACA_SIP_15min_12m.csv';
const {candles, metadata} = loadDataset(path);
if (metadata.data_class !== 'real' || metadata.asset !== 'NVDA' || metadata.bar_minutes !== 15 ||
    metadata.provider !== 'Alpaca Market Data API' || metadata.feed !== 'sip' ||
    metadata.adjustment !== 'split' || metadata.session !== 'regular') {
  throw new Error('El estudio de volumen requiere NVDA real de Alpaca SIP, velas de 15 minutos, split y sesión regular.');
}
const calendar = loadMarketCalendar(`${path}.calendar.json`);
const study = studyNvdaOpeningVolume(candles, calendar);
const output = join('output', 'real');
mkdirSync(output, {recursive: true});
writeFileSync(join(output, 'nvda-opening-volume.md'),
  renderNvdaOpeningVolumeReport(study, basename(path)));
writeFileSync(join(output, 'nvda-opening-volume.json'),
  JSON.stringify({source: basename(path), metadata,
    metodologia: {
      referencia: 'Promedio de volumen de 09:30–09:45 en las 20 sesiones observadas anteriores; sin vela, no hay RVOL.',
      rvol: 'Volumen final de la primera vela dividido entre ese promedio; disponible a las 09:45 de Nueva York.',
      regreso: 'Rango y cierre de la primera vela frente a bandas Bollinger congeladas antes de las 09:30.',
      grupos: 'Terciles retrospectivos de RVOL definidos en el primer 70%; no son umbrales de entrada.',
      alcance: 'Asociación histórica exploratoria; no permite una decisión basada en el volumen final a las 09:30.',
    }, study}, null, 2) + '\n');
console.log(`Estudio de volumen NVDA guardado en ${join(output, 'nvda-opening-volume.md')} y ${join(output, 'nvda-opening-volume.json')}.`);
