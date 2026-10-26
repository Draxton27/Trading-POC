import {spread,daysToExpiration,longBreakEven} from '@trading-poc/market-domain';
export {daysToExpiration} from '@trading-poc/market-domain';

type Input={right:unknown;strike:unknown;expiration:unknown;multiplier:unknown;bid:unknown;ask:unknown};
const nonnegative=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const positive=(value:unknown):number|null=>{const n=nonnegative(value);return n!==null&&n>0?n:null;};

export function comparisonMetrics(row:Input,now=new Date()){
  const bid=nonnegative(row.bid),ask=nonnegative(row.ask),strike=positive(row.strike),multiplier=positive(row.multiplier);
  return {spread:spread(bid,ask),dte:daysToExpiration(row.expiration,now),
    nominalCost:ask!==null&&ask>0&&multiplier!==null?ask*multiplier:null,
    breakEven:longBreakEven(row.right,strike,ask)};
}

export function toggleComparison(ids:readonly number[],id:number):number[]{
  if(ids.includes(id))return ids.filter(value=>value!==id);
  return ids.length<4?[...ids,id]:[...ids];
}
