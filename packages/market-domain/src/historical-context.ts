import type {MarketBar} from '@trading-poc/contracts';

const dateNy=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
export type PreviousSessionLevels={previousHigh:number|null;previousLow:number|null;
  sourceSessionNy:string|null;availableAtUtc:string|null;asOfUtc:string};

/** Uses only completed daily aggregates from sessions strictly before the selected NY date. */
export function previousSessionLevels(bars:readonly MarketBar[],asOfUtc:string,
  expectedSessionNy?:string|null):PreviousSessionLevels{
  const asOf=Date.parse(asOfUtc);
  if(!Number.isFinite(asOf))throw new Error('asOfUtc inválido');
  const session=dateNy.format(new Date(asOf));
  const eligible=bars.filter(bar=>bar.timeframe==='1d'&&bar.isComplete&&
    dateNy.format(new Date(bar.startUtc))<session&&Date.parse(bar.endUtc)<=asOf&&
    (expectedSessionNy===undefined||dateNy.format(new Date(bar.startUtc))===expectedSessionNy));
  const prior=eligible.at(-1);
  return {previousHigh:prior?.high??null,previousLow:prior?.low??null,
    sourceSessionNy:prior?dateNy.format(new Date(prior.startUtc)):null,
    availableAtUtc:prior?.endUtc??null,asOfUtc};
}
