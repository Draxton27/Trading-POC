import type {MarketBar,MarketQuote,OptionQuote} from '@trading-poc/contracts';
import type {ReadOnlyBrokerAdapter,ResolvedContract,SubscriptionHandle,OptionParameters} from './adapter.ts';
export class MockReadOnlyAdapter implements ReadOnlyBrokerAdapter {
  private connected=false;
  async connect(){this.connected=true;}async disconnect(){this.connected=false;}
  async getStatus(){return {connected:this.connected,environment:'PAPER' as const,accountVerified:this.connected,feedType:'UNKNOWN' as const,asOfUtc:new Date().toISOString(),detail:'MOCK: datos sintéticos, sin TWS'};}
  async resolveStock(symbol:string):Promise<ResolvedContract>{if(!['NVDA','QQQ','SMH'].includes(symbol))throw new Error('Símbolo no permitido');return {conId:({'NVDA':1,'QQQ':2,'SMH':3} as Record<string,number>)[symbol]!,symbol,secType:'STK',localSymbol:null,currency:'USD',exchange:'SMART',right:null,strike:null,expiration:null,multiplier:null};}
  async getHistoricalBars():Promise<MarketBar[]>{return [];}
  async resolveOption(q:{symbol:string;expiration:string;right:'CALL'|'PUT';strike:number}):Promise<ResolvedContract>{if(q.symbol!=='NVDA')throw new Error('Solo NVDA');return {conId:90001,symbol:q.symbol,secType:'OPT',localSymbol:'NVDA '+q.expiration+' '+q.right+' '+q.strike,currency:'USD',exchange:'SMART',right:q.right,strike:q.strike,expiration:q.expiration,multiplier:100};}
  async getOptionParameters():Promise<OptionParameters[]>{return [{exchange:'SMART',tradingClass:'NVDA',multiplier:100,expirations:['20261023'],strikes:[210,215,220,225,230]}];}
  async subscribeQuotes(contracts:ResolvedContract[],callback:(quote:MarketQuote|OptionQuote)=>void):Promise<SubscriptionHandle>{
    for(const contract of contracts){const now=new Date().toISOString();if(contract.secType==='STK')callback({symbol:contract.symbol as 'NVDA'|'QQQ'|'SMH',bid:218.40,ask:218.43,last:218.42,marketTimestampUtc:now,receivedAtUtc:now,feedType:'UNKNOWN',provider:'DEMO sintético'});}
    return {cancel:async()=>{}};
  }
  async getPositions(){return [];}async getExecutions(){return [];}
}
