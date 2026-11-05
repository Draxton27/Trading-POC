/** Comparison only; original source amounts are never rewritten. */
export type CommissionComparison={
  status:'EXACT'|'POSSIBLE_ROUNDING'|'MATERIAL_DIFFERENCE'|'MISSING'|'UNKNOWN_SOURCE_CONVENTION'|'UNKNOWN_CURRENCY';
  source:string;airtableConvention:'POSITIVE_COST'|'NOT_ESTABLISHED';
  sourceAmount:string|null;ibkrAmount:string|null;normalizedSourceCashEffect:string|null;
  difference:string|null;tolerance:string|null;assumedDecimalPlaces:number|null;
};

const scale=1_000_000_000n;
function units(value:string):bigint{
  const negative=value.startsWith('-'),[whole,fraction='']=value.replace(/^-/, '').split('.');
  const result=BigInt(whole!)*scale+BigInt(fraction.padEnd(9,'0'));
  return negative?-result:result;
}
function decimal(value:bigint):string{
  const negative=value<0n,n=negative?-value:value,whole=n/scale,fraction=(n%scale).toString().padStart(9,'0').replace(/0+$/,'');
  return `${negative?'-':''}${whole}${fraction?'.'+fraction:''}`;
}
export function compareCommission(source:string,sourceAmount:string|null,sourceCurrency:string,ibkrAmount:string|null,ibkrCurrency:string|null):CommissionComparison{
  const base={source,airtableConvention:source==='AIRTABLE'&&sourceCurrency==='USD'?'POSITIVE_COST' as const:'NOT_ESTABLISHED' as const,sourceAmount,ibkrAmount,
    normalizedSourceCashEffect:null as string|null,difference:null as string|null,tolerance:null as string|null,assumedDecimalPlaces:null as number|null};
  if(sourceAmount===null||ibkrAmount===null)return {...base,status:'MISSING'};
  if(source!=='AIRTABLE')return {...base,status:'UNKNOWN_SOURCE_CONVENTION'};
  // The established Airtable field is an amount in USD; other currency conventions
  // need separate evidence before a precision policy can be applied.
  if(sourceCurrency!=='USD'||!ibkrCurrency||ibkrCurrency!==sourceCurrency)return {...base,status:'UNKNOWN_CURRENCY'};
  // Airtable stores costs as positive; IBKR records the signed cash effect.
  // Negating preserves rebates as credits instead of turning them into costs.
  const normalized=-units(sourceAmount),broker=units(ibkrAmount),difference=normalized-broker;
  const fraction=sourceAmount.split('.')[1]?.length??0;
  // 41V persisted the JSON number as text, so trailing zeroes may have been lost.
  // A cent is the coarsest assumed representation; finer persisted digits narrow it.
  const places=Math.max(2,Math.min(8,fraction));
  const tolerance=5n*10n**BigInt(8-places),magnitude=difference<0n?-difference:difference;
  const status=difference===0n?'EXACT':magnitude<=tolerance?'POSSIBLE_ROUNDING':'MATERIAL_DIFFERENCE';
  return {...base,status,normalizedSourceCashEffect:decimal(normalized),difference:decimal(difference),tolerance:decimal(tolerance),assumedDecimalPlaces:places};
}
