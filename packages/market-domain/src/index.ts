import type {MarketBar} from '@trading-poc/contracts';
export {previousSessionLevels} from './historical-context.ts';

export type IndicatorPoint={startUtc:string;sma20:number|null;sma40:number|null;sma100:number|null;sma200:number|null;bbUpper:number|null;bbLower:number|null;bbMiddle:number|null};
/** Indicadores de presentación causales. Solo se calculan sobre velas completas, en orden. */
export function calculateIndicators(bars:readonly MarketBar[]):IndicatorPoint[]{
  const closes:number[]=[]; let last=-Infinity;
  return bars.map(bar=>{
    const time=Date.parse(bar.startUtc);if(time<=last)throw new Error('Velas desordenadas');last=time;
    if(!bar.isComplete) return {startUtc:bar.startUtc,sma20:null,sma40:null,sma100:null,sma200:null,bbUpper:null,bbLower:null,bbMiddle:null};
    closes.push(bar.close);
    const sma=(n:number)=>closes.length<n?null:closes.slice(-n).reduce((a,b)=>a+b,0)/n;
    const s20=sma(20),window=closes.slice(-20);
    const std=s20===null?null:Math.sqrt(window.reduce((sum,v)=>sum+(v-s20)**2,0)/20);
    return {startUtc:bar.startUtc,sma20:s20,sma40:sma(40),sma100:sma(100),sma200:sma(200),bbUpper:std===null?null:s20!+2*std,bbLower:std===null?null:s20!-2*std,bbMiddle:s20};
  });
}
export function quoteNumber(value:unknown):number|null {
  const n=typeof value==='number'?value:NaN;
  return Number.isFinite(n)&&n>=0&&n<1e100?n:null;
}
export function priceNumber(value:unknown):number|null{
  const n=quoteNumber(value);return n!==null&&n>0?n:null;
}
export function spread(bid:number|null,ask:number|null){
  if(bid===null||ask===null||ask<bid)return {absolute:null,percent:null};
  const absolute=ask-bid,mid=(bid+ask)/2;
  return {absolute,percent:mid>0?100*absolute/mid:null};
}
