import type Database from 'better-sqlite3';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {RealFlexFill,RealTradeExecution} from '@trading-poc/contracts';
import {sha256,type FlexFill} from './flex.ts';
import {parseOccSymbol} from '../../../../trading_poc_001_bollinger/src/phase17-occ.ts';

export type IdentityStatus='VERIFIED_CONTRACT'|'DOCUMENTED_CONTRACT'|'AMBIGUOUS_CONTRACT'|'INCOMPLETE_CONTRACT'|'CONFLICTING_CONTRACT';
export type Reconciled={id:string;versionId:string;execution:RealTradeExecution;status:IdentityStatus;evidenceIds:string[];fill:FlexFill|null;reason:string|null};
const decKey=(x:string)=>{const [i,f='']=x.split('.');const key=`${i}.${f.padEnd(8,'0')}`;return /^-0\.0+$/.test(key)?key.slice(1):key;};
const decEqual=(a:string,b:string)=>decKey(a)===decKey(b);
type ExecutionRow={id:string;latest_version_id:string;conflict:number;normalized:string};
type EvidenceRow={id:string;content_hash:string;payload:string};
export function reconcile(db:Database.Database):Reconciled[]{
  const rows=db.prepare(`SELECT e.id,e.latest_version_id,e.conflict,v.normalized FROM real_trade_executions e JOIN real_trade_versions v ON v.id=e.latest_version_id WHERE e.environment='REAL' AND e.account_alias='Primary' ORDER BY e.id LIMIT 10001`).all() as ExecutionRow[];
  if(rows.length>10000)throw Error('RECONSTRUCTION_LIMIT');
  const find=db.prepare('SELECT id,content_hash,payload FROM real_flex_records WHERE execution_id=? ORDER BY id LIMIT 101');
  const result=rows.map(row=>{
    const execution=RealTradeExecution.parse(JSON.parse(row.normalized));
    const evidence=find.all(execution.executionId) as EvidenceRow[],evidenceIds=evidence.map(e=>e.id);
    const out=(status:IdentityStatus,fill:FlexFill|null,reason:string|null):Reconciled=>({id:row.id,versionId:row.latest_version_id,execution,status,evidenceIds,fill,reason});
    if(row.conflict)return out('CONFLICTING_CONTRACT',null,'IDENTITY_CONFLICT_41V');
    if(!evidence.length)return out('INCOMPLETE_CONTRACT',null,'NO_EXACT_EXECUTION_EVIDENCE');
    if(evidence.length>100)return out('AMBIGUOUS_CONTRACT',null,'EVIDENCE_LIMIT');
    if(new Set(evidence.map(e=>e.content_hash)).size!==1)return out('AMBIGUOUS_CONTRACT',null,'MULTIPLE_EVIDENCE_VERSIONS');
    if(evidence.some(e=>sha256(e.payload)!==e.content_hash))return out('CONFLICTING_CONTRACT',null,'INVALID_EVIDENCE_HASH');
    let raw:unknown;try{raw=JSON.parse(evidence[0]!.payload);}catch{return out('CONFLICTING_CONTRACT',null,'INVALID_EVIDENCE');}
    const validated=RealFlexFill.safeParse(raw);if(!validated.success)return out('CONFLICTING_CONTRACT',null,'INVALID_EVIDENCE');
    const f=validated.data;
    if(f.side!==execution.side||!decEqual(f.quantity,execution.quantity)||f.currency!==execution.currency||f.executedAtUtc!==execution.executedAtUtc||
       (execution.unitPrice!==null&&f.price!==null&&!decEqual(execution.unitPrice,f.price))||
       (execution.commission!==null&&f.commission!==null&&f.commissionCurrency===execution.currency&&!decEqual(execution.commission,f.commission))||
       (execution.orderId!==null&&f.orderId!==null&&execution.orderId!==f.orderId)||
       (execution.conId!==null&&f.conId!==null&&execution.conId!==f.conId)||
       (execution.multiplier!==null&&f.multiplier!==null&&!decEqual(execution.multiplier,f.multiplier))||
       (f.underlyingSymbol!==null&&f.underlyingSymbol!==execution.asset))return out('CONFLICTING_CONTRACT',f,'EXECUTION_OR_CONTRACT_MISMATCH');
    if(f.assetCategory!=='OPT')return out('INCOMPLETE_CONTRACT',f,'UNSUPPORTED_INSTRUMENT');
    if(!f.conId||!f.expiry||!f.strike||!f.right||!f.multiplier||!f.underlyingSymbol)return out('INCOMPLETE_CONTRACT',f,'CONTRACT_FIELDS_MISSING');
    if(f.localSymbol?.length===21){
      try{const occ=parseOccSymbol(f.localSymbol);if(occ.underlyingSymbol!==f.underlyingSymbol||occ.expiration!==f.expiry||occ.optionType!==f.right||occ.strike!==Number(f.strike))return out('CONFLICTING_CONTRACT',f,'OCC_CONTRACT_MISMATCH');}
      catch{return out('CONFLICTING_CONTRACT',f,'OCC_SYMBOL_INVALID');}
      // Do not use phase17's default multiplier: adjusted contracts can differ.
    }
    // An operator-supplied extract remains declared evidence even when 41V also has conId.
    if(execution.conId===f.conId&&execution.unitPrice!==null&&f.price!==null)return out('DOCUMENTED_CONTRACT',f,'MATCHING_CONID_MANUAL_STATEMENT_NOT_AUTHENTICATED');
    return out('DOCUMENTED_CONTRACT',f,'MANUAL_STATEMENT_NOT_AUTHENTICATED');
  });
  const contractDefinitions=new Map<number,Set<string>>(),classes=new Map<number,Set<string>>();
  for(const item of result){const f=item.fill;if(!f?.conId||!f.underlyingSymbol||!f.expiry||!f.strike||!f.right||!f.multiplier)continue;
    const set=contractDefinitions.get(f.conId)??new Set<string>();
    set.add(JSON.stringify([f.underlyingSymbol,f.expiry,decKey(f.strike),f.right,decKey(f.multiplier),f.currency]));contractDefinitions.set(f.conId,set);
    if(f.tradingClass){const names=classes.get(f.conId)??new Set<string>();names.add(f.tradingClass);classes.set(f.conId,names);}
  }
  return result.map(item=>item.fill?.conId&&((contractDefinitions.get(item.fill.conId)?.size??0)>1||(classes.get(item.fill.conId)?.size??0)>1)?{...item,status:'CONFLICTING_CONTRACT' as const,reason:'CONID_MULTIPLE_DEFINITIONS'}:item);
}

export function reconciliationCodeHash(){return createHash('sha256').update(readFileSync(new URL('./reconciliation.ts',import.meta.url))).update(readFileSync(new URL('./flex.ts',import.meta.url))).update(readFileSync(new URL('../../../../packages/contracts/src/real-trades.ts',import.meta.url))).digest('hex');}
export function rebuildSnapshot(db:Database.Database,clock=()=>new Date().toISOString()){
  return db.transaction(()=>{
    const executions=reconcile(db),episodes=reconstruct(executions);
    const inputHash=sha256(JSON.stringify(executions));
    const codeHash=reconciliationCodeHash();
    const payload=JSON.stringify({algorithm:'41W-FIFO-1',codeHash,inputHash,coverage:'UNVERIFIED',executions,episodes});
    if(Buffer.byteLength(payload)>32*1024*1024)throw Error('RECONSTRUCTION_LIMIT');
    const hash=sha256(payload),createdAtUtc=clock();
    const inserted=db.prepare('INSERT OR IGNORE INTO real_reconstruction_snapshots(sha256,created_at_utc,algorithm,input_hash,payload) VALUES (?,?,?,?,?)').run(hash,createdAtUtc,'41W-FIFO-1',inputHash,payload).changes>0;
    return {sha256:hash,inputHash,inserted,executions:executions.length,episodes:episodes.length,coverage:'UNVERIFIED' as const};
  })();
}

type Rational={n:bigint;d:bigint};
const gcd=(a:bigint,b:bigint):bigint=>b===0n?(a<0n?-a:a):gcd(b,a%b);
const rat=(n:bigint,d:bigint=1n):Rational=>{if(d===0n)throw Error('ZERO_DIVISOR');const g=gcd(n,d);return {n:n/g,d:d/g};};
const from=(s:string):Rational=>{const neg=s.startsWith('-'),[i,f='']=s.replace('-','').split('.');const n=BigInt(i!+f)*(neg?-1n:1n);return rat(n,10n**BigInt(f.length));};
const add=(a:Rational,b:Rational)=>rat(a.n*b.d+b.n*a.d,a.d*b.d);
const sub=(a:Rational,b:Rational)=>add(a,rat(-b.n,b.d));
const mul=(a:Rational,b:Rational)=>rat(a.n*b.n,a.d*b.d);
const div=(a:Rational,b:Rational)=>rat(a.n*b.d,a.d*b.n);
const format=(r:Rational)=>r.d===1n?r.n.toString():`${r.n}/${r.d}`;
const zero=()=>rat(0n);
export type Episode={id:string;contractKey:string;status:'RECONSTRUCTED'|'PARTIALLY_OPEN'|'INCOMPLETE_HISTORY'|'UNRESOLVED_CONTRACT'|'AMBIGUOUS_MATCH'|'FINANCIAL_DATA_MISSING'|'RECONCILIATION_CONFLICT'|'UNSUPPORTED_OPERATION';economicStatus:'COMPLETE'|'GROSS_ONLY'|'UNKNOWN';buyQuantity:string|null;sellQuantity:string|null;remainingQuantity:string|null;entryDebit:string|null;exitProceeds:string|null;grossPnl:string|null;commissions:string|null;netPnl:string|null;reportedPnl:string|null;reportedComparison:'NOT_COMPARABLE';matches:Array<{buyId:string;sellId:string;quantity:string}>;executionIds:string[];evidenceIds:string[];limitations:string[]};
type Lot={id:string;remaining:bigint;price:Rational;commissionPerUnit:Rational|null};
/** Exact FIFO requires an explicit zero-inventory evidence decision made by the caller. */
export function reconstruct(items:Reconciled[],hasVerifiedFlatStart:(contractKey:string,first:Reconciled)=>boolean=()=>false,hasVerifiedCompleteCosts:(contractKey:string,first:Reconciled)=>boolean=()=>false):Episode[]{
  const groups=new Map<string,Reconciled[]>(),result:Episode[]=[],coverageSafe=items.every(item=>item.status==='VERIFIED_CONTRACT'||item.status==='DOCUMENTED_CONTRACT');
  for(const item of items){const f=item.fill;if(!f?.conId||!f.expiry||!f.strike||!f.right||!f.multiplier||!f.underlyingSymbol||!['VERIFIED_CONTRACT','DOCUMENTED_CONTRACT'].includes(item.status))continue;const key=[f.conId,f.underlyingSymbol,f.expiry,decKey(f.strike),f.right,decKey(f.multiplier),f.currency,f.tradingClass??''].join('|');const a=groups.get(key)??[];a.push(item);groups.set(key,a);}
  for(const [key,group] of groups){
    group.sort((a,b)=>a.execution.executedAtUtc.localeCompare(b.execution.executedAtUtc)||a.id.localeCompare(b.id));
    const duplicateTime=group.some((x,i)=>i>0&&x.execution.executedAtUtc===group[i-1]!.execution.executedAtUtc);
    let lots:Lot[]=[],episode:Episode|null=null,entry=zero(),proceeds=zero(),gross=zero(),cost=zero(),costKnown=hasVerifiedCompleteCosts(key,group[0]!),reported=zero(),reportedKnown=true,tainted=false,inventoryTrusted=coverageSafe&&hasVerifiedFlatStart(key,group[0]!);
    const finish=()=>{if(!episode)return;if(!tainted&&episode.status!=='INCOMPLETE_HISTORY'){episode.entryDebit=format(entry);episode.exitProceeds=format(proceeds);episode.grossPnl=episode.sellQuantity==='0'?null:format(gross);episode.commissions=episode.sellQuantity==='0'?null:costKnown?format(cost):null;episode.netPnl=episode.sellQuantity==='0'?null:costKnown?format(add(gross,cost)):null;episode.reportedPnl=episode.sellQuantity==='0'?null:reportedKnown?format(reported):null;episode.economicStatus=episode.sellQuantity==='0'?'UNKNOWN':costKnown?'COMPLETE':'GROSS_ONLY';}else{episode.buyQuantity=null;episode.sellQuantity=null;episode.remainingQuantity=null;episode.matches=[];}result.push(episode);episode=null;};
    for(const item of group){const f=item.fill;const reason=item.status==='CONFLICTING_CONTRACT'?'RECONCILIATION_CONFLICT':item.status==='AMBIGUOUS_CONTRACT'?'AMBIGUOUS_MATCH':f&&(f.assetCategory!=='OPT'||(f.transactionType!==null&&f.transactionType!=='ExchTrade')||(f.side==='SELL'&&f.openClose==='O')||(f.side==='BUY'&&f.openClose==='C'))?'UNSUPPORTED_OPERATION':!f||item.status==='INCOMPLETE_CONTRACT'?'UNRESOLVED_CONTRACT':duplicateTime?'AMBIGUOUS_MATCH':!f.price||!f.multiplier||!f.openClose||!f.transactionType?'FINANCIAL_DATA_MISSING':null;
      if(reason){inventoryTrusted=false;if(episode){episode.status='INCOMPLETE_HISTORY';tainted=true;}finish();lots=[];result.push({id:sha256(item.id+reason),contractKey:key,status:reason,economicStatus:'UNKNOWN',buyQuantity:null,sellQuantity:null,remainingQuantity:null,entryDebit:null,exitProceeds:null,grossPnl:null,commissions:null,netPnl:null,reportedPnl:null,reportedComparison:'NOT_COMPARABLE',matches:[],executionIds:[item.id],evidenceIds:item.evidenceIds,limitations:[item.reason??reason]});continue;}
      if(!episode){episode={id:sha256(`${key}\0${item.id}`),contractKey:key,status:'INCOMPLETE_HISTORY',economicStatus:'UNKNOWN',buyQuantity:'0',sellQuantity:'0',remainingQuantity:'0',entryDebit:null,exitProceeds:null,grossPnl:null,commissions:null,netPnl:null,reportedPnl:null,reportedComparison:'NOT_COMPARABLE',matches:[],executionIds:[],evidenceIds:[],limitations:[]};entry=zero();proceeds=zero();gross=zero();cost=zero();costKnown=hasVerifiedCompleteCosts(key,group[0]!);reported=zero();reportedKnown=true;tainted=false;}
      episode.executionIds.push(item.id);episode.evidenceIds.push(...item.evidenceIds);
      if(tainted||!inventoryTrusted){episode.status='INCOMPLETE_HISTORY';tainted=true;episode.limitations.push('Inventario inicial y cobertura no verificados');continue;}
      const q=BigInt(f!.quantity),price=from(f!.price!),mult=from(f!.multiplier!);const comm=f!.commission!==null&&f!.taxes!==null&&f!.commissionCurrency===f!.currency?add(from(f!.commission),from(f!.taxes)):null;
      if(f!.side==='BUY'){lots.push({id:item.id,remaining:q,price,commissionPerUnit:comm?div(comm,rat(q)):null});entry=add(entry,mul(mul(price,mult),rat(q)));episode.buyQuantity=(BigInt(episode.buyQuantity??'0')+q).toString();}
      else {let rem=q;if(lots.reduce((n,l)=>n+l.remaining,0n)<q){episode.status='INCOMPLETE_HISTORY';tainted=true;inventoryTrusted=false;episode.limitations.push('Venta sin inventario anterior suficiente');continue;}while(rem>0n){const lot=lots[0]!,take=lot.remaining<rem?lot.remaining:rem;gross=add(gross,mul(mul(sub(price,lot.price),mult),rat(take)));if(lot.commissionPerUnit&&comm)cost=add(cost,add(mul(lot.commissionPerUnit,rat(take)),mul(div(comm,rat(q)),rat(take))));else costKnown=false;episode.matches.push({buyId:lot.id,sellId:item.id,quantity:take.toString()});lot.remaining-=take;rem-=take;if(lot.remaining===0n)lots.shift();}proceeds=add(proceeds,mul(mul(price,mult),rat(q)));episode.sellQuantity=(BigInt(episode.sellQuantity??'0')+q).toString();if(f!.reportedPnl===null)reportedKnown=false;else reported=add(reported,from(f!.reportedPnl));}
      episode.remainingQuantity=lots.reduce((n,l)=>n+l.remaining,0n).toString();episode.status=episode.remainingQuantity==='0'?'RECONSTRUCTED':'PARTIALLY_OPEN';if(episode.status==='RECONSTRUCTED')finish();
    }
    finish();
  }return result;
}
