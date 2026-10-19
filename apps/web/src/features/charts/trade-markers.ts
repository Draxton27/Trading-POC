export type Marker={timestampUtc:string;label:string};
export type ChartBar={startUtc:string;endUtc:string;close:number};

/** A fill is drawn only inside a documented underlying bar's UTC interval. */
export function alignTradeMarkers(bars:readonly ChartBar[],markers:readonly Marker[]){
  const placed:Array<Marker&{barStartUtc:string;barClose:number}>=[];
  const missing:Marker[]=[];
  for(const marker of markers){
    const at=Date.parse(marker.timestampUtc);
    const bar=Number.isFinite(at)?bars.find(row=>Date.parse(row.startUtc)<=at&&at<Date.parse(row.endUtc)):undefined;
    if(bar)placed.push({...marker,barStartUtc:bar.startUtc,barClose:bar.close});
    else missing.push(marker);
  }
  return {placed,missing};
}
