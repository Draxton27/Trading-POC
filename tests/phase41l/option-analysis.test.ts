import {describe,expect,it} from 'vitest';
import {OptionAnalysisInput,OptionAnalysisResult} from '../../packages/contracts/src/options-analysis.ts';
import {analyzeLongOption,daysToExpiration,expirationAnalysis} from '../../packages/market-domain/src/option-analysis.ts';
import {analyzeComparisonRow} from '../../apps/web/src/features/options/analysis.ts';

const NOW='2026-10-26T15:00:00.000Z';
const base=():OptionAnalysisInput=>({
  contract:{conId:12345,symbol:'NVDA',occSymbol:'NVDA  261030C00200000',right:'CALL',strike:200,
    expiration:'2026-10-30',multiplier:100,currency:'USD'},
  quote:{bid:2,ask:3,bidSize:5,askSize:7,receivedAtUtc:NOW,marketTimestampUtc:NOW,feedType:'LIVE',
    provider:'IBKR',marketDataStatus:null,permissionDenied:false},
  quantity:2,capitalUsd:1000,entryFeePerContractUsd:2,expirationFeePerContractUsd:1,
  hypotheticalUnderlyingAtExpirationUsd:205,academy:null,asOfUtc:NOW
});

describe('Fase 41L: contrato largo NVDA',()=>{
  it('calcula prima, spread medio, capital, pérdidas y payoff CALL sin órdenes',()=>{
    const result=analyzeLongOption(base());
    expect(OptionAnalysisResult.parse(result)).toEqual(result);
    expect(result).toMatchObject({status:'READY',contractStatus:'VALID',quantity:2,
      quote:{status:'LIVE_RECENT',bidAskStatus:'VALID',askCurrentVerified:true},
      expiration:{status:'FUTURE',daysCalendar:4},
      premium:{grossPremiumUsd:600,maximumPremiumLossUsd:600,entryFeesUsd:4,
        maximumNetLossWithEntryFeesUsd:604,breakEvenGrossUsd:203,
        breakEvenWithProvidedFeesUsd:203.03,feesCompleteForNet:true,cashOutlayWithKnownEntryFeesUsd:604},
      spread:{absolutePerShareUsd:1,percentOfMidpoint:40,immediateGrossDifferenceUsd:-200},
      capital:{status:'AVAILABLE',committedPercent:60.4,remainingUsd:396,maximumWholeContracts:3,
        feesExcludedFromBudget:false},
      payoff:{intrinsicPerShareUsd:5,totalIntrinsicUsd:1000,grossPnlUsd:400,netPnlUsd:394}});
    expect(result.spread.immediateDifferencePercentOfPremium).toBeCloseTo(-100/3);
    expect(result.payoff.returnOnGrossPremiumPercent).toBeCloseTo(200/3);
  });
  it('calcula PUT largo y pérdida bruta máxima, sin convertir payoff en fill',()=>{
    const input=base();input.contract.right='PUT';input.contract.occSymbol='NVDA  261030P00200000';
    input.hypotheticalUnderlyingAtExpirationUsd=195;
    const result=analyzeLongOption(input);
    expect(result.premium.breakEvenGrossUsd).toBe(197);
    expect(result.premium.breakEvenWithProvidedFeesUsd).toBe(196.97);
    expect(result.payoff).toMatchObject({totalIntrinsicUsd:1000,grossPnlUsd:400,netPnlUsd:394});
    input.hypotheticalUnderlyingAtExpirationUsd=210;
    expect(analyzeLongOption(input).payoff).toMatchObject({intrinsicPerShareUsd:0,grossPnlUsd:-600,netPnlUsd:-606});
  });
  it('no inventa comisiones, capital ni P&L neto cuando faltan',()=>{
    const input=base();input.capitalUsd=null;input.entryFeePerContractUsd=null;
    input.expirationFeePerContractUsd=null;
    const result=analyzeLongOption(input);
    expect(result.premium).toMatchObject({grossPremiumUsd:600,maximumNetLossWithEntryFeesUsd:null,
      breakEvenGrossUsd:203,breakEvenWithProvidedFeesUsd:null,feesCompleteForNet:false});
    expect(result.payoff).toMatchObject({grossPnlUsd:400,netPnlUsd:null});
    expect(result.capital).toMatchObject({status:'NO_CAPITAL',committedPercent:null,maximumWholeContracts:null,
      feesExcludedFromBudget:true});
  });
  it('distingue comisión conocida de salida desconocida y presupuesto excedido',()=>{
    const input=base();input.expirationFeePerContractUsd=null;input.capitalUsd=500;
    const result=analyzeLongOption(input);
    expect(result.premium).toMatchObject({breakEvenWithProvidedFeesUsd:203.02,feesCompleteForNet:false});
    expect(result.payoff.netPnlUsd).toBeNull();
    expect(result.capital).toMatchObject({status:'BUDGET_EXCEEDED',remainingUsd:-104,maximumWholeContracts:1});
    input.entryFeePerContractUsd=null;expect(analyzeLongOption(input).capital).toMatchObject({maximumWholeContracts:1,feesExcludedFromBudget:true});
  });
  it('BID cero es distinto de BID ausente; ASK cero o libro cruzado son inválidos',()=>{
    const input=base();input.quote.bid=0;
    expect(analyzeLongOption(input)).toMatchObject({quote:{bidAskStatus:'BID_ZERO'},
      spread:{absolutePerShareUsd:3,percentOfMidpoint:200,immediateGrossDifferenceUsd:-600}});
    expect(analyzeLongOption(input).quote.reason).toContain('BID cero');
    input.quote.bid=null;expect(analyzeLongOption(input)).toMatchObject({quote:{status:'PARTIAL',bidAskStatus:'BID_MISSING'},
      premium:{grossPremiumUsd:600},spread:{absolutePerShareUsd:null,immediateGrossDifferenceUsd:null}});
    input.quote.ask=null;expect(analyzeLongOption(input)).toMatchObject({quote:{status:'MISSING',bidAskStatus:'BOTH_MISSING'},
      status:'PARTIAL',premium:{grossPremiumUsd:null}});
    input.quote.bid=2;input.quote.ask=0;
    expect(analyzeLongOption(input)).toMatchObject({quote:{status:'INVALID',bidAskStatus:'ASK_NON_POSITIVE'},
      premium:{grossPremiumUsd:null}});
    input.quote.ask=1;
    expect(analyzeLongOption(input)).toMatchObject({quote:{status:'INVALID',bidAskStatus:'CROSSED'},
      premium:{grossPremiumUsd:null}});
  });
  it.each([
    ['DELAYED','DELAYED'],['FROZEN','FROZEN'],['DELAYED_FROZEN','DELAYED_FROZEN'],['UNKNOWN','UNKNOWN']
  ] as const)('no representa %s como LIVE',(_,status)=>{
    const input=base();input.quote.feedType=status;
    expect(analyzeLongOption(input).quote).toMatchObject({status,askCurrentVerified:false});
  });
  it('verifica por separado timestamps de recepción y de mercado',()=>{
    const input=base();input.quote.marketTimestampUtc=null;
    expect(analyzeLongOption(input).quote.status).toBe('LIVE_UNVERIFIED');
    input.quote.marketTimestampUtc='2026-10-26T14:59:00.000Z';
    expect(analyzeLongOption(input).quote.status).toBe('LIVE_STALE');
    input.quote.marketTimestampUtc=NOW;input.quote.receivedAtUtc='2026-10-26T14:59:00.000Z';
    expect(analyzeLongOption(input).quote.status).toBe('LIVE_STALE');
    input.quote.receivedAtUtc='2026-10-26T15:00:01.000Z';
    expect(analyzeLongOption(input).quote.status).toBe('INVALID');
  });
  it('preserva permiso insuficiente, simulación y falta de cotización como estados distintos',()=>{
    const input=base();input.quote.permissionDenied=true;
    expect(analyzeLongOption(input).quote.status).toBe('PERMISSION_DENIED');
    input.quote.permissionDenied=false;input.quote.provider='PAPER SIMULADO';
    expect(analyzeLongOption(input).quote.status).toBe('SIMULATED');
    input.quote.provider='IBKR';input.quote.bid=null;input.quote.ask=null;
    expect(analyzeLongOption(input).quote.status).toBe('MISSING');
  });
  it('rechaza identidad, moneda, fechas y OCC contradictorios sin cálculos económicos',()=>{
    const mutations:Array<(input:OptionAnalysisInput)=>void>=[
      input=>{input.contract.conId=0;},input=>{input.contract.symbol='QQQ';},
      input=>{input.contract.currency=null;},input=>{input.contract.strike=-1;},
      input=>{input.contract.multiplier=0;},input=>{input.contract.expiration='2026-02-30';},
      input=>{input.contract.occSymbol='NVDA  261030P00200000';},
      input=>{input.contract.occSymbol='NVDA  261030C00210000';},
      input=>{input.contract.occSymbol='invalid';}
    ];
    for(const mutate of mutations){const input=base();mutate(input);const result=analyzeLongOption(input);
      expect(result.contractStatus).toBe('INVALID');expect(result.status).toBe('INVALID_CONTRACT');
      expect(result.premium.grossPremiumUsd).toBeNull();}
  });
  it('rechaza valores monetarios e inputs excesivos sin NaN o infinito',()=>{
    for(const patch of [{quantity:0},{quantity:1.5},{quantity:10001},{capitalUsd:-1},
      {entryFeePerContractUsd:-1},{hypotheticalUnderlyingAtExpirationUsd:-1}]){
      const result=analyzeLongOption({...base(),...patch});
      expect(result.status).toBe('INVALID_INPUT');expect(result.premium.grossPremiumUsd).toBeNull();
    }
    expect(analyzeLongOption({...base(),quantity:Infinity}).status).toBe('INVALID_INPUT');
  });
  it('DTE usa día de Nueva York, conserva hoy cero y distingue pasado de fecha imposible',()=>{
    expect(daysToExpiration('20261026',new Date('2026-10-26T15:00:00Z'))).toBe(0);
    expect(daysToExpiration('20261026',new Date('2026-10-26T03:30:00Z'))).toBe(1);
    expect(expirationAnalysis('2026-10-25',new Date(NOW)).status).toBe('PASSED');
    const expired=base();expired.contract.occSymbol=null;expired.contract.expiration='2026-10-25';
    expect(analyzeLongOption(expired)).toMatchObject({status:'PARTIAL',expiration:{status:'PASSED'}});
    expect(expirationAnalysis('2026-02-30',new Date(NOW)).status).toBe('INVALID');
    expect(expirationAnalysis('2028-02-29',new Date(NOW)).status).toBe('FUTURE');
    expect(daysToExpiration('2026-10-26',new Date(NaN))).toBeNull();
  });
  it('reutiliza la evaluación ASK sin reinterpretar vigencia ni límites externos',()=>{
    const input=base();input.academy={status:'INSUFFICIENT_DATA',referenceStatus:'HISTORICAL_ONLY',
      reason:'No declara vigencia',minAskCents:8000,maxAskCents:17000,outerMinCents:7500,outerMaxCents:17500,
      referenceDate:'2026-02-17',validFrom:null,validTo:null,quoteReceivedAtUtc:NOW};
    const result=analyzeLongOption(input);
    expect(result.academy).toEqual(input.academy);
    expect(result.limitations.some(s=>s.includes('sin vigencia'))).toBe(true);
    input.academy.referenceStatus='CONFLICT';
    expect(analyzeLongOption(input).academy?.referenceStatus).toBe('CONFLICT');
  });
  it.each([
    ['ACTIVE','WITHIN_RANGE'],['REFERENCE_DATE','ABOVE_RANGE'],['HISTORICAL_ONLY','INSUFFICIENT_DATA'],
    ['CONFLICT','INSUFFICIENT_DATA'],['NONE','NO_REFERENCE']
  ] as const)('conserva %s / %s de Investep sin aplicar un filtro de compra',(referenceStatus,status)=>{
    const input=base();input.academy={status,referenceStatus,reason:'Fixture sintética',
      minAskCents:referenceStatus==='NONE'?null:8000,maxAskCents:referenceStatus==='NONE'?null:17000,
      outerMinCents:referenceStatus==='NONE'?null:7500,outerMaxCents:referenceStatus==='NONE'?null:17500,
      referenceDate:referenceStatus==='NONE'?null:'2026-02-17',validFrom:null,validTo:null,quoteReceivedAtUtc:NOW};
    expect(analyzeLongOption(input).academy).toEqual(input.academy);
    expect(analyzeLongOption(input).status).toBe('READY');
  });
  it('ejemplo monetario sintético conserva centavos y no consulta mercado',()=>{
    const input=base();input.contract.occSymbol=null;input.contract.strike=150;
    input.quote.ask=2;input.quote.bid=1.9;input.quantity=1;input.capitalUsd=5000;
    input.entryFeePerContractUsd=null;input.expirationFeePerContractUsd=null;
    input.hypotheticalUnderlyingAtExpirationUsd=null;
    expect(analyzeLongOption(input)).toMatchObject({premium:{grossPremiumUsd:200,
      maximumPremiumLossUsd:200,breakEvenGrossUsd:152},
      spread:{immediateGrossDifferenceUsd:-10},capital:{committedPercent:4,remainingUsd:4800}});
    input.quote.ask=2.005;input.quote.bid=1.9;
    expect(analyzeLongOption(input).premium.grossPremiumUsd).toBeCloseTo(200.5);
  });
  it('una fecha ISO imposible o antigua se trata como inválida u obsoleta, no como LIVE reciente',()=>{
    const input=base();input.quote.receivedAtUtc='2026-02-30T15:00:00.000Z';
    expect(analyzeLongOption(input).quote.status).toBe('INVALID');
    input.quote.receivedAtUtc='2026-10-26T14:59:00.000Z';
    expect(analyzeLongOption(input).quote.status).toBe('LIVE_STALE');
  });
  it('adapta respuesta del comparador sin leer cuentas ni generar suscripciones',()=>{
    const input=base();const row={...input.contract,...input.quote,
      academyEvaluation:{status:'INSUFFICIENT_DATA',referenceStatus:'HISTORICAL_ONLY',reason:'Sin vigencia',
        quoteReceivedAtUtc:NOW,reference:{minAskCents:8000,maxAskCents:17000,
          outerMinCents:7500,outerMaxCents:17500,referenceDate:'2026-02-17',validFrom:null,validTo:null}}};
    const result=analyzeComparisonRow(row,{quantity:2,capitalUsd:1000,entryFeePerContractUsd:2,
      expirationFeePerContractUsd:1,hypotheticalUnderlyingAtExpirationUsd:205,asOfUtc:NOW});
    expect(result.premium.grossPremiumUsd).toBe(600);
    expect(result.academy).toMatchObject({referenceStatus:'HISTORICAL_ONLY',outerMinCents:7500,outerMaxCents:17500});
  });
});
