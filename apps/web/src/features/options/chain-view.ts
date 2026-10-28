export type Side='BOTH'|'CALL'|'PUT';
export type Moneyness='ITM'|'OTM'|'Cerca del precio'|null;

/** Solo descripción visual; no se usa para decidir contratos ni riesgo. */
export function describeMoneyness(right:'CALL'|'PUT',strike:number,referencePrice:number|null,source:string):Moneyness{
  if(source!=='IBKR_LAST_OBSERVED'&&source!=='ALPACA_IEX_LAST_COMPLETE_BAR'&&source!=='DEMO_SYNTHETIC')return null;
  if(referencePrice===null||!Number.isFinite(referencePrice)||referencePrice<=0||!Number.isFinite(strike)||strike<=0)return null;
  if(Math.abs(strike-referencePrice)<=0.01)return 'Cerca del precio';
  return right==='CALL'?(strike<referencePrice?'ITM':'OTM'):(strike>referencePrice?'ITM':'OTM');
}

export function expiryDate(value:string):Date|null{
  const compact=value.replaceAll('-','');
  if(!/^\d{8}$/.test(compact))return null;
  const year=Number(compact.slice(0,4)),month=Number(compact.slice(4,6)),day=Number(compact.slice(6,8));
  const date=new Date(Date.UTC(year,month-1,day));
  return date.toISOString().slice(0,10).replaceAll('-','')===compact?date:null;
}

export function expiryLabel(value:string){
  const date=expiryDate(value);
  return date?new Intl.DateTimeFormat('es',{timeZone:'UTC',day:'2-digit',month:'short'}).format(date).toUpperCase():value;
}
