/** Identity fields from IBKR contract details. Never infer a missing field. */
export function validateOptionIdentity(raw:unknown,requested:{symbol:string;right:'CALL'|'PUT';expiration:string;strike:number}){
  const c=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:{};
  const right=c.right==='C'||c.right==='CALL'?'CALL':c.right==='P'||c.right==='PUT'?'PUT':null;
  // ContractDetails may include the trading time after YYYYMMDD. Only that exact suffix is accepted.
  const date=typeof c.expiration==='string'&&/^\d{8}(?: (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?: [A-Za-z_\/]+)?)?$/.test(c.expiration)
    ?c.expiration.slice(0,8):null;
  const y=date?Number(date.slice(0,4)):NaN,m=date?Number(date.slice(4,6)):NaN,d=date?Number(date.slice(6,8)):NaN;
  const exact=Number.isInteger(y)&&m>=1&&m<=12&&d>=1&&d<=31&&
    new Date(Date.UTC(y,m-1,d)).toISOString().slice(0,10).replaceAll('-','')===date;
  const expiry=exact?date:null;
  const numeric=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:
    typeof value==='string'&&/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)?Number(value):null;
  const strike=numeric(c.strike),multiplier=numeric(c.multiplier);
  const mismatchFields:string[]=[];
  if(!Number.isSafeInteger(c.conId)||Number(c.conId)<=0)mismatchFields.push('conId');
  if(c.secType!=='OPT')mismatchFields.push('secType');
  if(c.symbol!==requested.symbol)mismatchFields.push('symbol');
  if(c.currency!=='USD')mismatchFields.push('currency');
  if(right!==requested.right)mismatchFields.push('right');
  if(expiry!==requested.expiration)mismatchFields.push('expiration');
  if(strike!==requested.strike)mismatchFields.push('strike');
  if(multiplier!==100)mismatchFields.push('multiplier');
  if(c.tradingClass!=='NVDA')mismatchFields.push('tradingClass');
  return {mismatchFields,contract:mismatchFields.length?null:{...c,right,expiration:expiry,strike,multiplier}};
}
