import {XMLParser,XMLValidator} from 'fast-xml-parser';
import type {NewsArticle} from './store.ts';

export type NewsProvider={id:string;name:string;feedUrl:string;articleHosts:string[]};
// These are fixed local sources; a feed URL is never accepted from an HTTP request.
export const FED_MONETARY:NewsProvider={id:'fed-monetary',name:'Federal Reserve Board · Monetary Policy',feedUrl:'https://www.federalreserve.gov/feeds/press_monetary.xml',articleHosts:['www.federalreserve.gov']};
export const NVIDIA_PRESS:NewsProvider={id:'nvidia-press',name:'NVIDIA Newsroom · Press Releases',feedUrl:'https://nvidianews.nvidia.com/cats/press_release.xml',articleHosts:['nvidianews.nvidia.com']};
export const KNOWN_PROVIDERS=[FED_MONETARY,NVIDIA_PRESS] as const;
export function enabledProviders(env:NodeJS.ProcessEnv=process.env):NewsProvider[]{return env.TRADING_POC_NEWS_NVIDIA_NONCOMMERCIAL==='1'?[FED_MONETARY,NVIDIA_PRESS]:[FED_MONETARY];}

const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',textNodeName:'#text',trimValues:true,parseTagValue:false,parseAttributeValue:false,processEntities:true});
const array=<T>(value:T|T[]|undefined):T[]=>value===undefined?[]:Array.isArray(value)?value:[value];
const plain=(value:unknown,max:number)=>String(value&&typeof value==='object'&&'#text' in value?(value as {'#text':unknown})['#text']:value??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const MONTHS:Record<string,number>={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
const leap=(year:number)=>year%4===0&&(year%100!==0||year%400===0);
const validCalendarDate=(year:number,month:number,day:number)=>year>=0&&month>=1&&month<=12&&day>=1&&day<=[31,leap(year)?29:28,31,30,31,30,31,31,30,31,30,31][month-1]!;

/**
 * Date.parse accepts some impossible ISO dates by normalising them. Verify the
 * explicit calendar portion first, while leaving RFC 822 and RFC 3339 timezone
 * conversion to the runtime parser.
 */
export function parseSourceDate(raw:unknown,receivedAtUtc:string):{value:string|null;status:'KNOWN'|'MISSING'|'INVALID'|'INCONSISTENT'}{
  const value=plain(raw,100);if(!value)return {value:null,status:'MISSING'};
  const iso=/^(\d{4})-(\d{2})-(\d{2})(?:[Tt ]|$)/.exec(value);
  const rfc=/^(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})(?:\s|$)/.exec(value);
  if(iso&&!validCalendarDate(Number(iso[1]),Number(iso[2]),Number(iso[3])))return {value:null,status:'INVALID'};
  if(rfc){const month=MONTHS[rfc[2]!.toLowerCase()];if(!month||!validCalendarDate(Number(rfc[3]),month,Number(rfc[1])))return {value:null,status:'INVALID'};}
  if(!iso&&!rfc)return {value:null,status:'INVALID'};
  const ms=Date.parse(value);if(!Number.isFinite(ms))return {value:null,status:'INVALID'};
  if(ms>Date.parse(receivedAtUtc)+60_000)return {value:new Date(ms).toISOString(),status:'INCONSISTENT'};
  return {value:new Date(ms).toISOString(),status:'KNOWN'};
}
function canonical(raw:unknown,provider:NewsProvider):string{
  const link=typeof raw==='object'&&raw!==null&&'@_href' in raw?(raw as {'@_href':unknown})['@_href']:raw;
  const value=new URL(plain(link,1000));
  if(value.protocol!=='https:'||!provider.articleHosts.includes(value.hostname)||value.username||value.password)throw new Error('NEWS_INVALID_CONTENT');
  value.hash='';for(const key of [...value.searchParams.keys()])if(/^utm_|^fbclid$|^gclid$/i.test(key))value.searchParams.delete(key);
  return value.toString();
}
export function parseFeed(xml:string,provider:NewsProvider,receivedAtUtc:string):NewsArticle[]{
  if(xml.length>1024*1024||/<\!DOCTYPE|<\!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw new Error('NEWS_INVALID_FEED');
  const root=parser.parse(xml) as Record<string,any>;
  const rss=array<Record<string,unknown>>(root.rss?.channel?.item),atom=array<Record<string,unknown>>(root.feed?.entry);
  if(!root.rss?.channel&&!root.feed)throw new Error('NEWS_INVALID_FEED');
  const entries=rss.length?rss:atom;
  if(entries.length>100)throw new Error('NEWS_INVALID_FEED');
  return entries.map(item=>{
    const isAtom=atom.includes(item),url=canonical(isAtom?array(item.link).find((link:any)=>typeof link==='object'&&(!link['@_rel']||link['@_rel']==='alternate'))??item.link:item.link,provider);
    const title=plain(item.title,500),description=plain(isAtom?item.summary??item.content:item.description,2000);
    if(!title)throw new Error('NEWS_INVALID_CONTENT');
    const stableId=plain(isAtom?item.id:item.guid,500)||url;
    const published=parseSourceDate(isAtom?item.published:item.pubDate,receivedAtUtc),updated=parseSourceDate(isAtom?item.updated:null,receivedAtUtc);
    const publicationStatus=published.value&&updated.value&&updated.value<published.value?'INCONSISTENT':published.status;
    return {providerId:provider.id,source:provider.name,canonicalUrl:url,stableId,title,description,publishedAtUtc:published.value,publicationStatus,updatedAtUtc:updated.value};
  });
}
export async function readBounded(response:Response,maxBytes:number):Promise<string>{
  const reader=response.body?.getReader();if(!reader)throw new Error('NEWS_EMPTY_RESPONSE');
  const chunks:Uint8Array[]=[];let bytes=0;
  try{while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.length;if(bytes>maxBytes)throw new Error('NEWS_RESPONSE_TOO_LARGE');chunks.push(next.value);}}
  finally{reader.releaseLock();}
  return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
}
export async function fetchFeed(provider:NewsProvider,fetcher:typeof fetch=fetch,timeoutMs=10000,clock:()=>string=()=>new Date().toISOString()){
  const requestedAtUtc=clock();let response:Response;
  try{response=await fetcher(provider.feedUrl,{method:'GET',redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{Accept:'application/rss+xml, application/atom+xml, text/xml, application/xml', 'User-Agent':'Trading-POC local research RSS reader'}});}
  catch{throw new Error('NEWS_NETWORK_ERROR');}
  if(!response.ok)throw new Error(response.status===429?'NEWS_RATE_LIMITED':'NEWS_SOURCE_UNAVAILABLE');
  let xml:string;try{xml=await readBounded(response,1024*1024);}catch(error){if(error instanceof Error&&error.message==='NEWS_RESPONSE_TOO_LARGE')throw error;throw new Error('NEWS_NETWORK_ERROR');}
  const receivedAtUtc=clock();return {requestedAtUtc,receivedAtUtc,articles:parseFeed(xml,provider,receivedAtUtc)};
}
