import {priceNumber,quoteNumber} from '@trading-poc/market-domain';
export type Feed='LIVE'|'DELAYED'|'FROZEN'|'DELAYED_FROZEN'|'UNKNOWN';
export const normalizeFeed=(code:number):Feed=>({1:'LIVE',2:'FROZEN',3:'DELAYED',4:'DELAYED_FROZEN'} as Record<number,Feed>)[code]??'UNKNOWN';
type QuoteState={bid:number|null;ask:number|null;last:number|null;bidSize:number|null;askSize:number|null;
  delta:number|null;gamma:number|null;theta:number|null;vega:number|null;impliedVolatility:number|null;
  greeksSource:string|null};
const empty=():QuoteState=>({bid:null,ask:null,last:null,bidSize:null,askSize:null,delta:null,
  gamma:null,theta:null,vega:null,impliedVolatility:null,greeksSource:null});
const delayed=(feed:Feed)=>feed==='DELAYED'||feed==='DELAYED_FROZEN';

/** Tick IDs: IBKR TWS API tick_types.html and market_data_type.html.
 * Live/frozen use prices 1/2/4, sizes 0/3, model Greeks 13.
 * Delayed/delayed-frozen use prices 66/67/68, sizes 69/70, model Greeks 83.
 * Each request owns one book. Feed changes clear fields to prevent mixed quotes.
 */
export class TickBook {
  feed:Feed='UNKNOWN';
  private values=empty();
  setFeed(code:number){const next=normalizeFeed(code);if(next!==this.feed){this.feed=next;this.values=empty();}}
  snapshot(){return {feedType:this.feed,...this.values};}
  private accepts(field:number,live:number,late:number){
    if(this.feed==='UNKNOWN'&&field===late)this.setFeed(3);
    return delayed(this.feed)?field===late:field===live;
  }
  price(field:number,value:number){
    const key=([['bid',1,66],['ask',2,67],['last',4,68]] as const)
      .find(([,live,late])=>field===live||field===late);
    if(!key||!this.accepts(field,key[1],key[2]))return false;
    this.values[key[0]]=priceNumber(value);return true;
  }
  size(field:number,value:number){
    const key=([['bidSize',0,69],['askSize',3,70]] as const)
      .find(([,live,late])=>field===live||field===late);
    if(!key||!this.accepts(field,key[1],key[2]))return false;
    this.values[key[0]]=quoteNumber(value);return true;
  }
  greeks(field:number,iv:number,delta:number,gamma:number,vega:number,theta:number){
    if(field!==13&&field!==83)return false;
    if(!this.accepts(field,13,83))return false;
    this.values.impliedVolatility=quoteNumber(iv);
    this.values.delta=Number.isFinite(delta)&&Math.abs(delta)<=1?delta:null;
    this.values.gamma=quoteNumber(gamma);
    this.values.vega=quoteNumber(vega);
    this.values.theta=Number.isFinite(theta)?theta:null;
    this.values.greeksSource=delayed(this.feed)?'IBKR DELAYED_MODEL_OPTION':'IBKR MODEL_OPTION';
    return true;
  }
}
