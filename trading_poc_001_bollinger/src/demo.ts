import {saveCandles} from './csv.ts';
import type {Candle} from './domain.ts';

// Serie enteramente FICTICIA. No representa precios, operaciones ni probabilidades reales de QQQ.
// Generador deterministico para reproducir las pruebas y el informe.
function pseudoRandom(seed = 73619) {
  let state = seed;
  return () => {state = (1664525 * state + 1013904223) >>> 0;return state/2**32;};
}
const u = pseudoRandom();
const candles: Candle[] = [];
let price = 500;
let completed = 0;
let day = new Date('2026-06-01T00:00:00.000Z');
while (completed < 100) {
  const weekday = day.getUTCDay();
  if (weekday !== 0 && weekday !== 6) {
    for (let m = 0; m < 78; m++) {
      const phase = (completed % 20);
      const volatility = phase < 5 ? 0.00035 : phase < 10 ? 0.00012 : phase < 14 ? 0.00095 : 0.00055;
      const drift = phase < 10 ? 0 : phase < 12 ? 0.00024 : phase < 14 ? -0.00030 : (phase % 2 ? -0.00008 : 0.00008);
      const shock = (u()+u()+u()+u()-2)*volatility*1.9;
      const open = price;
      price = Math.max(50,price*(1 + drift + shock));
      const high = Math.max(open,price)*(1+u()*volatility*0.5);
      const low = Math.min(open,price)*(1-u()*volatility*0.5);
      const t = new Date(Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate(),13,30+m*5));
      candles.push({timestamp:t.toISOString(),open,high,low,close:price,volume:Math.round(20000+(u()+u())*12000)});
    }
    completed++;
  }
  day = new Date(day.getTime()+86400_000);
}
saveCandles('data/QQQ_FICTICIO_5min.csv',candles);
console.log(`Generado data/QQQ_FICTICIO_5min.csv con ${candles.length} velas FICTICIAS.`);
