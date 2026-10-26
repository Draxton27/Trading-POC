import {OptionAnalysisInput,OptionAnalysisResult,type OptionAnalysisResult as Result} from '@trading-poc/contracts';
import {z} from 'zod';
import {parseOccSymbol} from '../../../trading_poc_001_bollinger/src/phase17-occ.ts';
import {spread} from './quote-math.ts';

const DAY_MS=86_400_000;
const LIVE_MAX_AGE_MS=30_000;
const utc=z.iso.datetime({offset:true});
const safeMoney=(n:number):number|null=>Number.isFinite(n)&&Math.abs(n)*100<=Number.MAX_SAFE_INTEGER?n:null;
const roundMoney=(n:number):number|null=>{const safe=safeMoney(n);return safe===null?null:Math.round((safe+Number.EPSILON)*100)/100;};
const nullable=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)?value:null;
const emptyPremium=()=>({grossPremiumUsd:null,maximumPremiumLossUsd:null,entryFeesUsd:null,
  maximumNetLossWithEntryFeesUsd:null,breakEvenGrossUsd:null,breakEvenWithProvidedFeesUsd:null,
  feesCompleteForNet:false,cashOutlayWithKnownEntryFeesUsd:null});
const emptySpread=(reason:string)=>({absolutePerShareUsd:null,percentOfMidpoint:null,
  immediateGrossDifferenceUsd:null,immediateDifferencePercentOfPremium:null,reason});
const emptyPayoff=(underlyingPriceUsd:number|null)=>({underlyingPriceUsd,intrinsicPerShareUsd:null,
  totalIntrinsicUsd:null,grossPnlUsd:null,netPnlUsd:null,returnOnGrossPremiumPercent:null});

export function expirationAnalysis(expiration:unknown,now:Date){
  if(!Number.isFinite(now.getTime()))return {status:'INVALID' as const,expirationDate:null,
    daysCalendar:null,asOfDateNy:'INVALID'};
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const part=(type:string)=>Number(parts.find(item=>item.type===type)?.value);
  const asOfDateNy=`${part('year')}-${String(part('month')).padStart(2,'0')}-${String(part('day')).padStart(2,'0')}`;
  const invalid={status:'INVALID' as const,expirationDate:null,daysCalendar:null,asOfDateNy};
  if(typeof expiration!=='string')return invalid;
  const match=/^(\d{4})-?(\d{2})-?(\d{2})$/.exec(expiration);
  if(!match)return invalid;
  const y=Number(match[1]),m=Number(match[2]),d=Number(match[3]);
  const expiry=Date.UTC(y,m-1,d),date=new Date(expiry);
  if(date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d)return invalid;
  const today=Date.UTC(part('year'),part('month')-1,part('day'));
  const days=(expiry-today)/DAY_MS;
  return {status:days<0?'PASSED' as const:days===0?'TODAY' as const:'FUTURE' as const,
    expirationDate:`${match[1]}-${match[2]}-${match[3]}`,daysCalendar:days>=0?days:null,asOfDateNy};
}

// Backward-compatible contract for the Phase 21 comparator.
export function daysToExpiration(expiration:unknown,now:Date):number|null{
  return expirationAnalysis(expiration,now).daysCalendar;
}

export function longBreakEven(right:unknown,strike:unknown,ask:unknown):number|null{
  return typeof strike==='number'&&Number.isFinite(strike)&&strike>0&&
    typeof ask==='number'&&Number.isFinite(ask)&&ask>0?
    right==='CALL'?strike+ask:right==='PUT'?strike-ask:null:null;
}

function quoteQuality(input:OptionAnalysisInput['quote'],nowMs:number):Result['quote']{
  const {bid,ask,bidSize,askSize,receivedAtUtc,marketTimestampUtc,feedType,provider,marketDataStatus,permissionDenied}=input;
  const bidBad=bid!==null&&(bid<0||bid>1e9),askBad=ask!==null&&(ask<0||ask>1e9);
  const sizeBad=[bidSize,askSize].some(v=>v!==null&&(!Number.isSafeInteger(v)||v<0));
  const received=receivedAtUtc===null?NaN:Date.parse(receivedAtUtc);
  const market=marketTimestampUtc===null?NaN:Date.parse(marketTimestampUtc);
  const timestampBad=(receivedAtUtc!==null&&(!utc.safeParse(receivedAtUtc).success||!Number.isFinite(received)||received>nowMs))||
    (marketTimestampUtc!==null&&(!utc.safeParse(marketTimestampUtc).success||!Number.isFinite(market)||market>nowMs));
  const crossed=bid!==null&&ask!==null&&ask<bid;
  const bidAskStatus:Result['quote']['bidAskStatus']=bidBad||askBad||sizeBad?'INVALID':
    ask===0?'ASK_NON_POSITIVE':crossed?'CROSSED':bid===null&&ask===null?'BOTH_MISSING':
    bid===null?'BID_MISSING':ask===null?'ASK_MISSING':bid===0?'BID_ZERO':'VALID';
  const simulated=provider!==null&&/sint[eé]tico|simulad|\bdemo\b/i.test(provider);
  let status:Result['quote']['status'],reason:string;
  if(timestampBad||bidAskStatus==='INVALID'||bidAskStatus==='CROSSED'||bidAskStatus==='ASK_NON_POSITIVE'){
    status='INVALID';reason='Cotización inválida: precio, tamaño, libro cruzado o timestamp futuro/inválido.';
  }else if(permissionDenied||marketDataStatus==='permission_denied'){
    status='PERMISSION_DENIED';reason='Permisos de cotización insuficientes.';
  }else if(simulated){status='SIMULATED';reason='Cotización sintética, no de mercado.';}
  else if(feedType==='DELAYED'){status='DELAYED';reason='Feed retrasado; no es precio actual.';}
  else if(feedType==='FROZEN'){status='FROZEN';reason='Feed congelado; no es precio actual.';}
  else if(feedType==='DELAYED_FROZEN'){status='DELAYED_FROZEN';reason='Feed retrasado y congelado.';}
  else if(bidAskStatus==='BOTH_MISSING'||marketDataStatus==='unavailable'){
    status='MISSING';reason='Sin BID y ASK disponibles.';
  }else if(bidAskStatus==='BID_MISSING'||bidAskStatus==='ASK_MISSING'||marketDataStatus==='partial'){
    status='PARTIAL';reason='Libro parcial; no hay dos lados completos.';
  }else if(feedType==='UNKNOWN'){status='UNKNOWN';reason='No se comprobó el tipo de feed.';}
  else if(!Number.isFinite(received)||!Number.isFinite(market)){
    status='LIVE_UNVERIFIED';reason='El feed indica LIVE, pero falta recepción o timestamp de mercado verificable.';
  }else if(nowMs-received>LIVE_MAX_AGE_MS||nowMs-market>LIVE_MAX_AGE_MS){
    status='LIVE_STALE';reason='La recepción o el timestamp de mercado superan 30 segundos.';
  }else{status='LIVE_RECENT';reason=bidAskStatus==='BID_ZERO'?
    'Feed LIVE reciente, pero BID cero no verifica un comprador positivo.':
    'Feed LIVE con recepción y timestamp de mercado recientes; ejecución no garantizada.';}
  return {status,bidAskStatus,feedType,provider,receivedAtUtc,marketTimestampUtc,bid,ask,bidSize,askSize,
    askCurrentVerified:status==='LIVE_RECENT'&&ask!==null&&ask>0,reason};
}

function contractIssues(c:OptionAnalysisInput['contract'],expiration:ReturnType<typeof expirationAnalysis>):string[]{
  const issues:string[]=[];
  if(c.conId===null||!Number.isSafeInteger(c.conId)||c.conId<=0)issues.push('conId inválido.');
  if(c.symbol!=='NVDA')issues.push('Solo se admite el subyacente NVDA.');
  if(c.right!=='CALL'&&c.right!=='PUT')issues.push('Tipo CALL/PUT inválido.');
  if(c.strike===null||c.strike<=0||c.strike>1e9)issues.push('Strike inválido.');
  if(c.multiplier===null||!Number.isSafeInteger(c.multiplier)||c.multiplier<=0||c.multiplier>100_000)issues.push('Multiplicador inválido.');
  if(c.currency!=='USD')issues.push('Moneda ausente o distinta de USD.');
  if(expiration.status==='INVALID')issues.push('Vencimiento imposible o inválido.');
  if(c.occSymbol!==null){
    try{const occ=parseOccSymbol(c.occSymbol);
      if(occ.underlyingSymbol!==c.symbol||occ.optionType!==c.right||c.strike===null||
        Math.abs(occ.strike-c.strike)>1e-6||
        occ.expiration!==expiration.expirationDate||occ.multiplier!==c.multiplier){
        issues.push('Los campos del contrato contradicen el símbolo OCC.');
      }
    }catch{issues.push('Símbolo OCC inválido.');}
  }
  return issues;
}

function invalidResult(raw:unknown):Result{
  const asOfUtc=new Date().toISOString(),expiration=expirationAnalysis(null,new Date(asOfUtc));
  const identity={conId:null,symbol:null,occSymbol:null,right:null,strike:null,expiration:null,multiplier:null,currency:null};
  const quote:Result['quote']={status:'MISSING',bidAskStatus:'BOTH_MISSING',feedType:'UNKNOWN',provider:null,
    receivedAtUtc:null,marketTimestampUtc:null,bid:null,ask:null,bidSize:null,askSize:null,askCurrentVerified:false,
    reason:'Entrada no válida.'};
  const issues=OptionAnalysisInput.safeParse(raw);
  return {status:'INVALID_INPUT',contractStatus:'INVALID',contractIssues:[],inputIssues:issues.success?[]:
    issues.error.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`).slice(0,12),identity,
    quantity:null,asOfUtc,expiration,quote,premium:emptyPremium(),spread:emptySpread('Entrada no válida.'),
    capital:{status:'NO_VALID_COST',capitalUsd:null,quantity:null,grossPremiumUsd:null,
      cashOutlayWithKnownEntryFeesUsd:null,committedPercent:null,remainingUsd:null,maximumWholeContracts:null,
      feesExcludedFromBudget:true},payoff:emptyPayoff(null),academy:null,limitations:['Entrada inválida; no se calculó una operación.']};
}

/** Cálculos descriptivos para una única opción larga. No recibe cuentas ni envía órdenes. */
export function analyzeLongOption(raw:unknown):Result{
  const parsed=OptionAnalysisInput.safeParse(raw);
  if(!parsed.success)return OptionAnalysisResult.parse(invalidResult(raw));
  const input=parsed.data,{contract:c,quote:q}=input;
  const nowMs=Date.parse(input.asOfUtc),expiration=expirationAnalysis(c.expiration,new Date(nowMs));
  const issues=contractIssues(c,expiration),quality=quoteQuality(q,nowMs);
  const inputIssues:string[]=[];
  if(!Number.isSafeInteger(input.quantity)||input.quantity<1||input.quantity>10_000)inputIssues.push('Cantidad de contratos fuera del rango 1–10000.');
  if(input.capitalUsd!==null&&(input.capitalUsd<0||input.capitalUsd>1e12))inputIssues.push('Capital hipotético inválido.');
  if(input.entryFeePerContractUsd!==null&&(input.entryFeePerContractUsd<0||input.entryFeePerContractUsd>1e6))inputIssues.push('Comisión de entrada inválida.');
  if(input.expirationFeePerContractUsd!==null&&(input.expirationFeePerContractUsd<0||input.expirationFeePerContractUsd>1e6))inputIssues.push('Costo de salida/ejercicio inválido.');
  if(input.hypotheticalUnderlyingAtExpirationUsd!==null&&
    (input.hypotheticalUnderlyingAtExpirationUsd<0||input.hypotheticalUnderlyingAtExpirationUsd>1e9))inputIssues.push('Precio hipotético del subyacente inválido.');
  const valid=issues.length===0&&inputIssues.length===0;
  const ask=q.ask!==null&&q.ask>0&&q.ask<=1e9&&quality.bidAskStatus!=='CROSSED'&&quality.status!=='INVALID'?q.ask:null;
  const bid=q.bid!==null&&q.bid>=0&&q.bid<=1e9&&quality.status!=='INVALID'?q.bid:null;
  const quantity=valid?input.quantity:null;
  const gross=valid&&ask!==null?safeMoney(ask*c.multiplier!*input.quantity):null;
  if(valid&&ask!==null&&gross===null)inputIssues.push('Importe calculado fuera del rango monetario seguro.');
  const entryFees=valid&&input.entryFeePerContractUsd!==null?roundMoney(input.entryFeePerContractUsd*input.quantity):null;
  const exitFees=valid&&input.expirationFeePerContractUsd!==null?roundMoney(input.expirationFeePerContractUsd*input.quantity):null;
  const cash=gross===null?null:roundMoney(gross+(entryFees??0));
  const beGross=valid&&ask!==null?longBreakEven(c.right,c.strike,ask):null;
  const providedFees=entryFees===null&&exitFees===null?null:(entryFees??0)+(exitFees??0);
  const feeAdjustment=providedFees===null||quantity===null?null:providedFees/(c.multiplier!*quantity);
  const breakEvenWithProvidedFees=beGross===null||feeAdjustment===null?null:
    c.right==='CALL'?beGross+feeAdjustment:beGross-feeAdjustment;
  const feesCompleteForNet=entryFees!==null&&exitFees!==null;
  const premium:Result['premium']={grossPremiumUsd:gross,maximumPremiumLossUsd:gross,entryFeesUsd:entryFees,
    maximumNetLossWithEntryFeesUsd:gross===null||entryFees===null?null:roundMoney(gross+entryFees),
    breakEvenGrossUsd:beGross,breakEvenWithProvidedFeesUsd:breakEvenWithProvidedFees,
    feesCompleteForNet,cashOutlayWithKnownEntryFeesUsd:cash};
  const pair=valid&&bid!==null&&ask!==null?spread(bid,ask):{absolute:null,percent:null};
  const immediate=gross!==null&&bid!==null?roundMoney((bid-ask!)*c.multiplier!*input.quantity):null;
  const spreadResult:Result['spread']={absolutePerShareUsd:pair.absolute,percentOfMidpoint:pair.percent,
    immediateGrossDifferenceUsd:immediate,
    immediateDifferencePercentOfPremium:immediate!==null&&gross!==null&&gross>0?100*immediate/gross:null,
    reason:!valid?'Contrato o entrada inválidos.':ask===null?'ASK no disponible.':bid===null?'BID no disponible.':
      bid===0?'BID cero: no hay salida a precio positivo verificada.':'Diferencia hipotética ASK de compra / BID de venta; no garantiza ejecución.'};
  const capital=input.capitalUsd,unitCost=ask!==null&&valid?ask*c.multiplier!+(input.entryFeePerContractUsd??0):null;
  const maxContracts=capital!==null&&unitCost!==null&&unitCost>0?Math.floor(capital/unitCost):null;
  const remaining=capital!==null&&cash!==null?roundMoney(capital-cash):null;
  const capitalResult:Result['capital']={status:!valid||gross===null?'NO_VALID_COST':capital===null?'NO_CAPITAL':
    remaining!==null&&remaining<0?'BUDGET_EXCEEDED':'AVAILABLE',capitalUsd:capital,quantity,
    grossPremiumUsd:gross,cashOutlayWithKnownEntryFeesUsd:cash,
    committedPercent:capital!==null&&capital>0&&cash!==null?100*cash/capital:null,
    remainingUsd:remaining,maximumWholeContracts:maxContracts,
    feesExcludedFromBudget:input.entryFeePerContractUsd===null};
  const underlying=nullable(input.hypotheticalUnderlyingAtExpirationUsd);
  let payoff:Result['payoff']=emptyPayoff(underlying);
  if(valid&&gross!==null&&underlying!==null){
    const intrinsic=c.right==='CALL'?Math.max(underlying-c.strike!,0):Math.max(c.strike!-underlying,0);
    const total=roundMoney(intrinsic*c.multiplier!*input.quantity),grossPnl=total===null?null:roundMoney(total-gross);
    payoff={underlyingPriceUsd:underlying,intrinsicPerShareUsd:intrinsic,totalIntrinsicUsd:total,
      grossPnlUsd:grossPnl,netPnlUsd:grossPnl!==null&&feesCompleteForNet?roundMoney(grossPnl-entryFees!-exitFees!):null,
      returnOnGrossPremiumPercent:grossPnl!==null&&gross>0?100*grossPnl/gross:null};
  }
  const limitations=['Compra a ASK y venta a BID son hipótesis; no hay garantía de ejecución ni de liquidez.',
    'El cálculo de vencimiento usa un precio hipotético introducido por el operador, no una predicción.'];
  if(quality.status!=='LIVE_RECENT')limitations.push(quality.reason);
  if(expiration.status==='PASSED')limitations.push('Contrato vencido; el cálculo no representa una compra posible hoy.');
  if(expiration.daysCalendar!==null&&expiration.daysCalendar<=2)limitations.push('Vencimiento próximo: verifique las reglas y horarios específicos de la serie; no se aplicó un veto.');
  if(input.entryFeePerContractUsd===null)limitations.push('Comisión de entrada desconocida: presupuesto y pérdida máxima neta no incluyen comisiones.');
  if(!feesCompleteForNet)limitations.push('P&L neto no disponible hasta declarar costos de entrada y salida/ejercicio, incluso si son cero.');
  if(input.academy?.referenceStatus==='HISTORICAL_ONLY')limitations.push('Referencia documental histórica sin vigencia actual declarada.');
  if(input.academy?.referenceStatus==='CONFLICT')limitations.push('Referencias documentales contradictorias; ASK no evaluable.');
  const status:Result['status']=issues.length?'INVALID_CONTRACT':inputIssues.length?'INVALID_INPUT':
    gross===null||expiration.status==='PASSED'?'PARTIAL':'READY';
  return OptionAnalysisResult.parse({status,contractStatus:issues.length?'INVALID':'VALID',contractIssues:issues,inputIssues,
    identity:c,quantity,asOfUtc:input.asOfUtc,expiration,quote:quality,premium,spread:spreadResult,
    capital:capitalResult,payoff,academy:input.academy,limitations});
}
