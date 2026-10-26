import {OptionAcademyContext,type OptionAnalysisInput} from '@trading-poc/contracts';
import {analyzeLongOption} from '@trading-poc/market-domain';

export const optionQualityLabel:Record<string,string>={LIVE_RECENT:'LIVE reciente',LIVE_STALE:'LIVE obsoleto',
  LIVE_UNVERIFIED:'LIVE sin hora de mercado verificable',DELAYED:'Retrasado',FROZEN:'Congelado',
  DELAYED_FROZEN:'Retrasado y congelado',UNKNOWN:'Feed desconocido',PARTIAL:'Cotización parcial',
  MISSING:'Sin cotización',PERMISSION_DENIED:'Sin permisos',SIMULATED:'Sintético',INVALID:'Cotización inválida'};

const value=(raw:unknown):number|null=>typeof raw==='number'?raw:null;
const string=(raw:unknown):string|null=>typeof raw==='string'?raw:null;
const object=(raw:unknown):Record<string,unknown>=>raw!==null&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:{};

/** Adapta exclusivamente la respuesta existente de /options/comparison; no crea suscripciones. */
export function analyzeComparisonRow(raw:unknown,options:{quantity:number;capitalUsd:number|null;
  entryFeePerContractUsd:number|null;expirationFeePerContractUsd:number|null;
  hypotheticalUnderlyingAtExpirationUsd:number|null;asOfUtc:string}){
  const row=object(raw),evaluation=object(row.academyEvaluation),reference=object(evaluation.reference);
  const academyRaw={status:evaluation.status,referenceStatus:evaluation.referenceStatus,
    reason:evaluation.reason,minAskCents:value(reference.minAskCents),maxAskCents:value(reference.maxAskCents),
    outerMinCents:value(reference.outerMinCents),outerMaxCents:value(reference.outerMaxCents),
    referenceDate:string(reference.referenceDate),validFrom:string(reference.validFrom),validTo:string(reference.validTo),
    quoteReceivedAtUtc:string(evaluation.quoteReceivedAtUtc)};
  const academy=OptionAcademyContext.safeParse(academyRaw);
  const input:OptionAnalysisInput={contract:{conId:value(row.conId),symbol:string(row.symbol)??string(row.underlying),
      occSymbol:string(row.occSymbol)??string(row.localSymbol),
      right:row.right==='CALL'||row.right==='PUT'?row.right:null,strike:value(row.strike),
      expiration:string(row.expiration),multiplier:value(row.multiplier),currency:string(row.currency)},
    quote:{bid:value(row.bid),ask:value(row.ask),bidSize:value(row.bidSize),askSize:value(row.askSize),
      receivedAtUtc:string(row.receivedAtUtc),marketTimestampUtc:string(row.marketTimestampUtc),
      feedType:row.feedType==='LIVE'||row.feedType==='DELAYED'||row.feedType==='FROZEN'||
        row.feedType==='DELAYED_FROZEN'?row.feedType:'UNKNOWN',provider:string(row.provider),
      marketDataStatus:row.marketDataStatus==='permission_denied'||row.marketDataStatus==='unavailable'||
        row.marketDataStatus==='partial'?row.marketDataStatus:null,
      permissionDenied:row.permissions==='Insuficientes'||row.dataStatus==='permisos_insuficientes'},
    quantity:options.quantity,capitalUsd:options.capitalUsd,entryFeePerContractUsd:options.entryFeePerContractUsd,
    expirationFeePerContractUsd:options.expirationFeePerContractUsd,
    hypotheticalUnderlyingAtExpirationUsd:options.hypotheticalUnderlyingAtExpirationUsd,
    academy:academy.success?academy.data:null,asOfUtc:options.asOfUtc};
  return analyzeLongOption(input);
}

export function optionalNumberInput(value:string):number|null{
  if(!value.trim())return null;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:NaN;
}
