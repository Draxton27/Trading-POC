import {analyzeComparisonRow} from './analysis.ts';

export type EconomicFilters={minAsk:number|null;maxAsk:number|null;maxCost:number|null;
  maxSpreadPercent:number|null;minDte:number|null;maxDte:number|null};
export type EconomicConfig={quantity:number;capitalUsd:number|null;maxUnitCostUsd:number|null;
  entryFeePerContractUsd:number|null;filters:EconomicFilters;asOfUtc:string};
export type EconomicStatus='MATCH'|'EXCEEDS'|'NO_EVALUABLE';

export const emptyEconomicFilters=():EconomicFilters=>({minAsk:null,maxAsk:null,maxCost:null,
  maxSpreadPercent:null,minDte:null,maxDte:null});

export function parseEconomicNumber(raw:string,{integer=false,positive=false}:{integer?:boolean;positive?:boolean}={}){
  if(raw.trim()==='')return null;
  const n=Number(raw);
  if(!Number.isFinite(n)||(integer&&!Number.isSafeInteger(n))||(positive?n<=0:n<0))return NaN;
  return n;
}

/** Filters describe only the contracts already loaded. Missing quotes never become zero. */
export function evaluateEconomicContract(row:Record<string,unknown>,config:EconomicConfig){
  const a=analyzeComparisonRow(row,{quantity:config.quantity,capitalUsd:config.capitalUsd,
    entryFeePerContractUsd:config.entryFeePerContractUsd,expirationFeePerContractUsd:null,
    hypotheticalUnderlyingAtExpirationUsd:null,asOfUtc:config.asOfUtc});
  const failures:string[]=[],unknown:string[]=[];
  const check=(name:string,value:number|null,passes:(n:number)=>boolean)=>{
    if(value===null||!Number.isFinite(value))unknown.push(`${name}: dato no disponible`);
    else if(!passes(value))failures.push(`${name}: excede o no alcanza el límite indicado`);
  };
  const {filters}=config;
  const unusable=row.subscriptionStatus==='FAILED'||row.marketDataStatus==='unavailable'||
    row.marketDataStatus==='permission_denied'||a.quote.status==='INVALID'||a.quote.status==='PERMISSION_DENIED';
  const ask=!unusable&&typeof row.ask==='number'&&Number.isFinite(row.ask)&&row.ask>0?row.ask:null;
  if(unusable)unknown.push('Cotización no disponible o inválida: no verifica el costo actual');
  if(filters.minAsk!==null)check('ASK mínimo',ask,n=>n>=filters.minAsk!);
  if(filters.maxAsk!==null)check('ASK máximo',ask,n=>n<=filters.maxAsk!);
  if(config.maxUnitCostUsd!==null)check('Costo por contrato',unusable||a.premium.grossPremiumUsd===null?null:
    a.premium.grossPremiumUsd/config.quantity,n=>n<=config.maxUnitCostUsd!);
  if(filters.maxCost!==null)check('Costo bruto total',unusable?null:a.premium.grossPremiumUsd,n=>n<=filters.maxCost!);
  if(config.capitalUsd!==null)check('Capital hipotético',unusable?null:a.premium.cashOutlayWithKnownEntryFeesUsd,
    n=>n<=config.capitalUsd!);
  if(filters.maxSpreadPercent!==null)check('Spread %',unusable?null:a.spread.percentOfMidpoint,
    n=>n<=filters.maxSpreadPercent!);
  if(filters.minDte!==null)check('DTE mínimo',a.expiration.daysCalendar,n=>n>=filters.minDte!);
  if(filters.maxDte!==null)check('DTE máximo',a.expiration.daysCalendar,n=>n<=filters.maxDte!);
  const status:EconomicStatus=failures.length?'EXCEEDS':unknown.length?'NO_EVALUABLE':'MATCH';
  return {status,failures,unknown,analysis:a,unitCostUsd:a.premium.grossPremiumUsd===null?null:
    a.premium.grossPremiumUsd/config.quantity};
}
