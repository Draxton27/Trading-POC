export type OptionParameter={exchange:string;tradingClass:string;multiplier:number;expirations:string[];strikes:number[]};

export function availableStrikes(parameters:OptionParameter[],expiration:string,min?:number,max?:number){
  return [...new Set(parameters.filter(p=>p.expirations.includes(expiration)).flatMap(p=>p.strikes))]
    .filter(x=>Number.isFinite(x)&&x>0&&(min===undefined||x>=min)&&(max===undefined||x<=max))
    .sort((a,b)=>a-b);
}

export function selectContractStrikes(strikes:number[],count:number,reference:number|null){
  if(reference===null||!Number.isFinite(reference)||reference<=0)return [];
  return [...strikes].sort((a,b)=>Math.abs(a-reference)-Math.abs(b-reference)||a-b)
    .slice(0,count).sort((a,b)=>a-b);
}

export function quoteReference(quote:{last?:unknown;receivedAtUtc?:unknown;marketDataStatus?:unknown}|null,now=Date.now()){
  const price=quote?.last,received=quote?.receivedAtUtc;
  return quote?.marketDataStatus!=='permission_denied'&&quote?.marketDataStatus!=='unavailable'&&
    typeof price==='number'&&Number.isFinite(price)&&price>0&&
    typeof received==='string'&&now-Date.parse(received)>=0&&now-Date.parse(received)<=30000?price:null;
}
