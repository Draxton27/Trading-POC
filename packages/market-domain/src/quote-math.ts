export function spread(bid:number|null,ask:number|null){
  if(bid===null||ask===null||ask<bid)return {absolute:null,percent:null};
  const absolute=ask-bid,mid=(bid+ask)/2;
  return {absolute,percent:mid>0?100*absolute/mid:null};
}
