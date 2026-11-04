import {createHash} from 'node:crypto';
import {readFileSync,realpathSync,statSync} from 'node:fs';
import {isAbsolute,relative,resolve} from 'node:path';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import type Database from 'better-sqlite3';

export const sha256=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
export type FlexFill={executionId:string;tradeId:string|null;orderId:string|null;transactionType:string|null;assetCategory:string;symbol:string;underlyingSymbol:string|null;conId:number|null;expiry:string|null;strike:string|null;right:'CALL'|'PUT'|null;multiplier:string|null;currency:string;side:'BUY'|'SELL';openClose:'O'|'C'|null;quantity:string;price:string|null;commission:string|null;taxes:string|null;commissionCurrency:string|null;reportedPnl:string|null;executedAtUtc:string;localSymbol:string|null;tradingClass:string|null};
const array=(x:unknown):any[]=>x===undefined?[]:Array.isArray(x)?x:[x];
const text=(x:unknown,max=120):string|null=>typeof x==='string'&&x.trim()&&x.length<=max?x.trim():null;
const dec=(x:unknown):string|null=>{const s=text(x,40);if(s===null)return null;if(!/^-?(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(s))throw Error('FLEX_INVALID_DECIMAL');return s;};
function day(x:unknown):string|null{const s=text(x);if(!s)return null;const m=/^(\d{4})(\d{2})(\d{2})$/.exec(s);if(!m)throw Error('FLEX_INVALID_DATE');const d=`${m[1]}-${m[2]}-${m[3]}`;const t=Date.parse(d+'T00:00:00Z');if(!Number.isFinite(t)||new Date(t).toISOString().slice(0,10)!==d)throw Error('FLEX_INVALID_DATE');return d;}
const ny=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function dateTime(x:unknown):string{
  const s=text(x);if(!s)throw Error('FLEX_MISSING_DATETIME');
  const m=/^(\d{8});(\d{2})(\d{2})(\d{2})$/.exec(s);if(!m)throw Error('FLEX_DATETIME_FORMAT');
  const d=day(m[1])!,h=+m[2]!,min=+m[3]!,sec=+m[4]!;if(h>23||min>59||sec>59)throw Error('FLEX_INVALID_DATETIME');
  const local=`${d}T${m[2]}:${m[3]}:${m[4]}`;const base=Date.parse(local+'Z');
  const candidates=[4,5].map(offset=>new Date(base+offset*3600000)).filter(v=>{const p=Object.fromEntries(ny.formatToParts(v).map(a=>[a.type,a.value]));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`===local;});
  if(candidates.length!==1)throw Error('FLEX_AMBIGUOUS_DATETIME');return candidates[0]!.toISOString();
}
function fill(a:Record<string,unknown>):FlexFill{
  const executionId=text(a.ibExecID),assetCategory=text(a.assetCategory),symbol=text(a.symbol),currency=text(a.currency),side=text(a.buySell),quantity=dec(a.quantity),detail=text(a.levelOfDetail);
  if(!executionId||!assetCategory||!symbol||!currency||!quantity||!['BUY','SELL'].includes(side??'')||detail!=='EXECUTION')throw Error('FLEX_REQUIRED_FIELD');
  if(!/^[A-Z]{3}$/.test(currency)||!/^[-]?[1-9]\d*$/.test(quantity)||quantity.length>13)throw Error('FLEX_INVALID_QUANTITY');
  if((side==='BUY'&&quantity.startsWith('-'))||(side==='SELL'&&!quantity.startsWith('-')))throw Error('FLEX_QUANTITY_SIDE_MISMATCH');
  const con=text(a.conid);if(con&&!/^[1-9]\d{0,14}$/.test(con))throw Error('FLEX_INVALID_CONID');
  const conId=con?Number(con):null;if(conId!==null&&!Number.isSafeInteger(conId))throw Error('FLEX_INVALID_CONID');
  const pc=text(a.putCall);if(pc&&!['P','C'].includes(pc))throw Error('FLEX_INVALID_RIGHT');
  const oc=text(a.openCloseIndicator);if(oc&&!['O','C'].includes(oc))throw Error('FLEX_INVALID_OPEN_CLOSE');
  const multiplier=dec(a.multiplier),price=dec(a.tradePrice),strike=dec(a.strike);
  if((multiplier!==null&&Number(multiplier)<=0)||(price!==null&&Number(price)<0)||(strike!==null&&Number(strike)<0))throw Error('FLEX_INVALID_PRICE');
  return {executionId,tradeId:text(a.tradeID),orderId:text(a.ibOrderID),transactionType:text(a.transactionType),assetCategory,symbol,underlyingSymbol:text(a.underlyingSymbol),conId,expiry:day(a.expiry),strike,right:pc==='P'?'PUT':pc==='C'?'CALL':null,multiplier,currency,side:side as 'BUY'|'SELL',openClose:oc as 'O'|'C'|null,quantity:quantity.replace(/^-/,''),price,commission:dec(a.ibCommission),taxes:dec(a.taxes),commissionCurrency:text(a.ibCommissionCurrency),reportedPnl:dec(a.fifoPnlRealized),executedAtUtc:dateTime(a.dateTime),localSymbol:text(a.localSymbol),tradingClass:text(a.tradingClass)};
}
export function parseFlexXml(xml:string,expectedAccount:string,timeZone:string):FlexFill[]{
  if(!/^U[0-9]{4,20}$/.test(expectedAccount))throw Error('REAL_ACCOUNT_REQUIRED');
  if(timeZone!=='America/New_York')throw Error('FLEX_TIMEZONE_REQUIRED');
  if(Buffer.byteLength(xml)>5*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw Error('FLEX_INVALID_XML');
  const root=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'',parseAttributeValue:false,parseTagValue:false,processEntities:false}).parse(xml);
  const response=root?.FlexQueryResponse;if(!response||response.type!=='AF')throw Error('FLEX_UNSUPPORTED_FORMAT');
  const statements=array(response.FlexStatements?.FlexStatement);if(statements.length!==1)throw Error('FLEX_ACCOUNT_COUNT');
  const statement=statements[0];if(statement.accountId!==expectedAccount||/^DU/i.test(statement.accountId))throw Error('FLEX_ACCOUNT_MISMATCH');
  // Non-trade events require their own audited interpretation before FIFO can use them.
  if(Object.entries(statement as Record<string,unknown>).some(([key,value])=>/option.?eae|exercis|assign|expirat|transfer|corporate.?actions/i.test(key)&&value!==''&&value!==null&&value!==undefined))throw Error('FLEX_UNSUPPORTED_EVENTS');
  const rows=array(statement.Trades?.Trade);if(rows.length>10000)throw Error('FLEX_RECORD_LIMIT');
  const seen=new Set<string>();return rows.map((row:any)=>{if(row.accountId!==expectedAccount)throw Error('FLEX_ACCOUNT_MISMATCH');const f=fill(row);if(seen.has(f.executionId))throw Error('FLEX_DUPLICATE_EXECUTION');seen.add(f.executionId);return f;});
}
export function importFlexFile(db:Database.Database,path:string,privateDir:string,account:string,timeZone:string,clock=()=>new Date().toISOString()){
  const root=realpathSync(resolve(privateDir,'real-trades','imports')),file=realpathSync(resolve(path)),rel=relative(root,file);
  if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('FILE_OUTSIDE_PRIVATE_IMPORTS');
  if(statSync(file).size>5*1024*1024)throw Error('FILE_TOO_LARGE');
  const bytes=readFileSync(file),hash=sha256(bytes),fills=parseFlexXml(bytes.toString('utf8'),account,timeZone),now=clock();
  const nowMs=Date.parse(now);if(!Number.isFinite(nowMs)||fills.some(f=>Date.parse(f.executedAtUtc)>nowMs))throw Error('FLEX_FUTURE_EXECUTION');
  return db.transaction(()=>{if(db.prepare('SELECT 1 FROM real_flex_documents WHERE sha256=?').get(hash))return {sha256:hash,records:fills.length,alreadyImported:true};
    db.prepare('INSERT INTO real_flex_documents(sha256,imported_at_utc,account_hash,record_count,provenance) VALUES (?,?,?,?,?)').run(hash,now,sha256(account),fills.length,'DECLARED_MANUAL_UNAUTHENTICATED');
    const insert=db.prepare('INSERT INTO real_flex_records(id,document_sha256,execution_id,content_hash,payload) VALUES (?,?,?,?,?)');
    for(const f of fills){const json=JSON.stringify(f),content=sha256(json);insert.run(sha256(`${hash}\0${f.executionId}\0${content}`),hash,f.executionId,content,json);}
    return {sha256:hash,records:fills.length,alreadyImported:false};})();
}
