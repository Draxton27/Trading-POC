import {createHash} from 'node:crypto';

export type HistoryFrame='1Min'|'5Min'|'15Min'|'1Hour'|'1Day';
export type AlpacaHistoryPage={body:string;sha256:string;receivedAtUtc:string};
export type HistoryOptions={symbol:string;frame:HistoryFrame;startUtc:string;endUtc:string;apiKey:string;secretKey:string;
  now?:()=>number;get?:typeof fetch;pause?:(ms:number)=>Promise<void>};

/** A bounded retrospective SIP request. Bar timestamps are not historic receipt timestamps. */
export async function fetchYoelAlpacaHistory(o:HistoryOptions){
  if(!/^[A-Z][A-Z0-9.]{0,9}$/.test(o.symbol)||!['1Min','5Min','15Min','1Hour','1Day'].includes(o.frame))throw Error('HISTORY_CONFIG_INVALID');
  const start=Date.parse(o.startUtc),end=Date.parse(o.endUtc),clock=o.now??Date.now;
  if(!o.apiKey||!o.secretKey)throw Error('ALPACA_AUTH_MISSING');
  if(!Number.isFinite(start)||!Number.isFinite(end)||new Date(start).toISOString()!==o.startUtc||new Date(end).toISOString()!==o.endUtc||
    start>=end||end-start>31*86400_000||end>clock()-20*60_000)throw Error('HISTORY_RANGE_INVALID');
  const pause=o.pause??(ms=>new Promise<void>(r=>setTimeout(r,ms))),get=o.get??fetch;
  const pages:AlpacaHistoryPage[]=[],bars:Record<string,unknown>[]=[];const tokens=new Set<string>();
  let token:string|undefined,previous=-Infinity;
  do {
    if(pages.length>=500)throw Error('PAGINATION_LIMIT');
    const url=new URL('https://data.alpaca.markets/v2/stocks/bars');
    for(const [key,value] of Object.entries({symbols:o.symbol,timeframe:o.frame,start:o.startUtc,end:o.endUtc,
      limit:'10000',feed:'sip',adjustment:'raw',asof:'-',sort:'asc'}))url.searchParams.set(key,value);
    if(token)url.searchParams.set('page_token',token);
    let response:Response|undefined;
    for(let attempt=0;attempt<4;attempt++){
      try{response=await get(url,{headers:{'APCA-API-KEY-ID':o.apiKey,'APCA-API-SECRET-KEY':o.secretKey},signal:AbortSignal.timeout(30000)});}
      catch{if(attempt===3)throw Error('ALPACA_NETWORK_ERROR');await pause(1000*2**attempt);continue;}
      if(response.status===401){await response.body?.cancel();throw Error('ALPACA_AUTH_INVALID');}
      if(response.status===403){await response.body?.cancel();throw Error('ALPACA_SIP_PERMISSION_DENIED');}
      if(response.status===429||response.status>=500){
        if(attempt===3){await response.body?.cancel();throw Error(response.status===429?'ALPACA_RATE_LIMIT':'ALPACA_SERVER_ERROR');}
        const retry=Number(response.headers.get('retry-after'));await response.body?.cancel();
        await pause(Number.isFinite(retry)&&retry>0?Math.min(retry*1000,30000):1000*2**attempt);continue;
      }
      break;
    }
    if(!response?.ok)throw Error('ALPACA_HTTP_ERROR');
    if(Number(response.headers.get('content-length')??0)>10*1024*1024)throw Error('ALPACA_RESPONSE_TOO_LARGE');
    if(!response.body)throw Error('ALPACA_INVALID_RESPONSE');
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
    try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;
      if(size>10*1024*1024){await reader.cancel();throw Error('ALPACA_RESPONSE_TOO_LARGE');}chunks.push(part.value);}}
    finally{reader.releaseLock();}
    const body=Buffer.concat(chunks.map(c=>Buffer.from(c))).toString('utf8'),receivedAtUtc=new Date(clock()).toISOString();
    let parsed:unknown;try{parsed=JSON.parse(body);}catch{throw Error('ALPACA_INVALID_JSON');}
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('ALPACA_INVALID_RESPONSE');
    const data=parsed as {bars?:Record<string,unknown>;next_page_token?:unknown};
    if(data.bars!==null&&(!data.bars||typeof data.bars!=='object'||Array.isArray(data.bars)))throw Error('ALPACA_INVALID_RESPONSE');
    if(data.bars && Object.keys(data.bars).some(key=>key!==o.symbol))throw Error('ALPACA_SYMBOL_MISMATCH');
    const batch=data.bars?.[o.symbol]??[];if(!Array.isArray(batch))throw Error('ALPACA_INVALID_RESPONSE');
    for(const raw of batch){
      if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('ALPACA_INVALID_BAR');
      const b=raw as Record<string,unknown>,time=typeof b.t==='string'?Date.parse(b.t):NaN;
      if(!Number.isFinite(time)||time<start||time>end||time<=previous)throw Error('ALPACA_TIME_OR_DUPLICATE_INVALID');
      const vals=[b.o,b.h,b.l,b.c,b.v];if(vals.some(v=>typeof v!=='number'||!Number.isFinite(v))||
        (b.l as number)<=0||(b.v as number)<0||!Number.isSafeInteger(b.v)||
        (b.h as number)<Math.max(b.o as number,b.c as number,b.l as number)||(b.l as number)>Math.min(b.o as number,b.c as number))throw Error('ALPACA_INVALID_OHLCV');
      if(b.vw!==undefined&&(typeof b.vw!=='number'||!Number.isFinite(b.vw)||b.vw<=0))throw Error('ALPACA_INVALID_VWAP');
      previous=time;bars.push(b);
    }
    pages.push({body,sha256:createHash('sha256').update(body).digest('hex'),receivedAtUtc});
    if(data.next_page_token!==null&&data.next_page_token!==undefined&&typeof data.next_page_token!=='string')throw Error('ALPACA_INVALID_TOKEN');
    token=data.next_page_token as string|null|undefined ?? undefined;
    if(token){if(tokens.has(token))throw Error('ALPACA_PAGINATION_LOOP');tokens.add(token);await pause(500);}
  } while(token);
  return {symbol:o.symbol,frame:o.frame,startUtc:o.startUtc,endUtc:o.endUtc,feed:'sip' as const,adjustment:'raw' as const,
    provider:'Alpaca',usage:'PERSONAL',availability:'RETROSPECTIVE_RECEIPT_UNKNOWN',pages,bars};
}
