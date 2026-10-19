import type {MarketBar,MarketQuote,OptionQuote} from '@trading-poc/contracts';
export type ResolvedContract={conId:number;symbol:string;secType:'STK'|'OPT';localSymbol:string|null;currency:string;exchange:string;right:'CALL'|'PUT'|null;strike:number|null;expiration:string|null;multiplier:number|null};
export type OptionParameters={exchange:string;tradingClass:string;multiplier:number;expirations:string[];strikes:number[]};
export type SubscriptionHandle={cancel:()=>Promise<void>};
/** Única superficie que el transporte puede invocar. Sin métodos para órdenes. */
export interface ReadOnlyBrokerAdapter {
  connect():Promise<void>;disconnect():Promise<void>;
  getStatus():Promise<{connected:boolean;environment:'PAPER'|'UNKNOWN';accountVerified:boolean;feedType:'LIVE'|'DELAYED'|'FROZEN'|'DELAYED_FROZEN'|'UNKNOWN';asOfUtc:string;detail:string|null}>;
  resolveStock(symbol:string):Promise<ResolvedContract>;
  getHistoricalBars(query:{contract:ResolvedContract;endUtc:string;duration:string;barSize:'15 mins'|'1 hour'|'1 day'}):Promise<MarketBar[]>;
  resolveOption(query:{symbol:string;expiration:string;right:'CALL'|'PUT';strike:number}):Promise<ResolvedContract>;
  getOptionParameters(underlyingConId:number):Promise<OptionParameters[]>;
  subscribeQuotes(contracts:ResolvedContract[],callback:(quote:MarketQuote|OptionQuote)=>void):Promise<SubscriptionHandle>;
  getPositions():Promise<Array<Record<string,unknown>>>;
  getExecutions(query:{sinceUtc?:string}):Promise<Array<Record<string,unknown>>>;
}
