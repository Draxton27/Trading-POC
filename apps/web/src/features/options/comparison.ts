import {spread} from '@trading-poc/market-domain';

type Input={right:unknown;strike:unknown;expiration:unknown;multiplier:unknown;bid:unknown;ask:unknown};
const nonnegative=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const positive=(value:unknown):number|null=>{const n=nonnegative(value);return n!==null&&n>0?n:null;};

// Calendar days between the New York date and expiration; invalid/past dates are not available.
export function daysToExpiration(expiration:unknown,now:Date):number|null{
  if(typeof expiration!=='string'||!Number.isFinite(now.getTime()))return null;
  const match=/^(\d{4})-?(\d{2})-?(\d{2})$/.exec(expiration);
  if(!match)return null;
  const y=Number(match[1]),m=Number(match[2]),d=Number(match[3]);
  const expiry=Date.UTC(y,m-1,d),date=new Date(expiry);
  if(date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d)return null;
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const part=(type:string)=>Number(parts.find(item=>item.type===type)?.value);
  const today=Date.UTC(part('year'),part('month')-1,part('day'));
  const days=(expiry-today)/86400000;
  return days>=0?days:null;
}

export function comparisonMetrics(row:Input,now=new Date()){
  const bid=nonnegative(row.bid),ask=nonnegative(row.ask),strike=positive(row.strike),multiplier=positive(row.multiplier);
  return {spread:spread(bid,ask),dte:daysToExpiration(row.expiration,now),
    nominalCost:ask!==null&&multiplier!==null?ask*multiplier:null,
    breakEven:ask!==null&&strike!==null?(row.right==='CALL'?strike+ask:row.right==='PUT'?strike-ask:null):null};
}

export function toggleComparison(ids:readonly number[],id:number):number[]{
  if(ids.includes(id))return ids.filter(value=>value!==id);
  return ids.length<4?[...ids,id]:[...ids];
}
