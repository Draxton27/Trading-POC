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

export function quoteReference(quote:{last?:unknown;receivedAtUtc?:unknown;marketDataStatus?:unknown;feedType?:unknown;provider?:unknown}|null,now=Date.now()){
  const price=quote?.last,received=quote?.receivedAtUtc;
  return quote?.marketDataStatus!=='permission_denied'&&quote?.marketDataStatus!=='unavailable'&&
    quote?.provider==='IBKR'&&quote.feedType==='LIVE'&&
    typeof price==='number'&&Number.isFinite(price)&&price>0&&
    typeof received==='string'&&now-Date.parse(received)>=0&&now-Date.parse(received)<=30000?price:null;
}

export function iexBarReference(snapshot:unknown,now=Date.now()){
  const s=snapshot&&typeof snapshot==='object'?snapshot as Record<string,unknown>:{};
  const received=typeof s.receivedAtUtc==='string'?Date.parse(s.receivedAtUtc):NaN;
  const end=typeof s.barEndUtc==='string'?Date.parse(s.barEndUtc):NaN;
  return (s.state==='CURRENT'||s.state==='PARTIAL')&&s.source==='Alpaca IEX Live'&&s.feed==='iex'&&
    s.collectorProcessStatus==='ACTIVE'&&s.collectorStatus==='SUBSCRIBED'&&
    typeof s.close==='number'&&Number.isFinite(s.close)&&s.close>0&&
    Number.isFinite(received)&&now-received>=0&&now-received<=15*60000&&
    Number.isFinite(end)&&received>=end&&now-end<=30*60000?s.close:null;
}
