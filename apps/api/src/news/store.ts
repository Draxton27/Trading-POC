import {createHash} from 'node:crypto';
import {closeSync,existsSync,mkdirSync,openSync,readFileSync,statSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {z} from 'zod';
import {NewsClassification} from '@trading-poc/contracts';
import {KNOWN_PROVIDERS} from './providers.ts';

export const sha256=(value:string)=>createHash('sha256').update(value).digest('hex');
const hash=z.string().regex(/^[a-f0-9]{64}$/),utc=z.iso.datetime({offset:false});
const article=z.object({providerId:z.string().min(1).max(40),source:z.string().min(1).max(100),canonicalUrl:z.url().max(1000),stableId:z.string().min(1).max(500),title:z.string().min(1).max(500),description:z.string().max(2000),publishedAtUtc:utc.nullable(),publicationStatus:z.enum(['KNOWN','MISSING','INVALID','INCONSISTENT']),updatedAtUtc:utc.nullable()}).strict();
export type NewsArticle=z.infer<typeof article>;
export const NewsRecord=article.extend({schema:z.literal('phase36-news-v1'),articleId:hash,revision:z.number().int().positive(),contentSha256:hash,firstSeenAtUtc:utc,receivedAtUtc:utc,previousHash:hash.nullable(),recordHash:hash});
export type NewsRecord=z.infer<typeof NewsRecord>;
export const NewsAnalysis=z.object({schema:z.literal('phase36-analysis-v1'),analysisId:hash,articleId:hash,newsRecordHash:hash,contentSha256:hash,model:z.string().min(1).max(100),modelVersion:z.string().min(1).max(100),promptVersion:z.literal('news-v1'),analyzedAtUtc:utc,timeoutMs:z.number().int().min(1000).max(120000),temperature:z.literal(0).optional(),keepAlive:z.union([z.literal(0),z.string().max(20)]).optional(),formatSha256:hash.optional(),classification:NewsClassification,previousHash:hash.nullable(),recordHash:hash}).strict();
export type NewsAnalysis=z.infer<typeof NewsAnalysis>;

export function contentHash(value:NewsArticle){return sha256(JSON.stringify(article.parse(value)));}
function readLines(path:string,maxBytes=64*1024*1024):unknown[]{
  if(!existsSync(path))return [];
  if(statSync(path).size>maxBytes)throw new Error('NEWS_LEDGER_TOO_LARGE');
  const lines=readFileSync(path,'utf8').split(/\r?\n/).filter(Boolean);
  if(lines.length>50000)throw new Error('NEWS_LEDGER_TOO_LARGE');
  return lines.map(line=>JSON.parse(line) as unknown);
}
function verifyHash(row:{recordHash:string;previousHash:string|null},previous:string|null){
  const {recordHash,...unsigned}=row;
  if(row.previousHash!==previous||sha256(JSON.stringify(unsigned))!==recordHash)throw new Error('NEWS_LEDGER_INVALID');
}
export function readNews(path:string):NewsRecord[]{
  let previous:string|null=null;const latest=new Map<string,NewsRecord>();
  return readLines(path).map(raw=>{
    const row=NewsRecord.parse(raw);verifyHash(row,previous);previous=row.recordHash;
    const content:NewsArticle={providerId:row.providerId,source:row.source,canonicalUrl:row.canonicalUrl,stableId:row.stableId,title:row.title,description:row.description,publishedAtUtc:row.publishedAtUtc,publicationStatus:row.publicationStatus,updatedAtUtc:row.updatedAtUtc};
    const provider=KNOWN_PROVIDERS.find(item=>item.id===row.providerId),url=new URL(row.canonicalUrl);
    if(!provider||row.source!==provider.name||url.protocol!=='https:'||!provider.articleHosts.includes(url.hostname)||url.username||url.password||row.articleId!==sha256(row.providerId+'\n'+row.stableId)||row.contentSha256!==contentHash(content))throw new Error('NEWS_LEDGER_INVALID');
    const prior=latest.get(row.articleId);
    if(row.revision!==(prior?.revision??0)+1||row.firstSeenAtUtc!==(prior?.firstSeenAtUtc??row.receivedAtUtc)||prior&&row.receivedAtUtc<prior.receivedAtUtc||prior?.contentSha256===row.contentSha256)throw new Error('NEWS_LEDGER_INVALID');
    latest.set(row.articleId,row);return row;
  });
}
export function readNewsAnalyses(path:string):NewsAnalysis[]{
  let previous:string|null=null;const ids=new Set<string>();
  return readLines(path).map(raw=>{
    const row=NewsAnalysis.parse(raw);verifyHash(row,previous);previous=row.recordHash;
    if(row.analysisId!==sha256(row.newsRecordHash+'\n'+row.modelVersion+'\n'+row.promptVersion)||ids.has(row.analysisId))throw new Error('NEWS_ANALYSIS_LEDGER_INVALID');
    ids.add(row.analysisId);return row;
  });
}
export function verifyNewsAnalyses(news:NewsRecord[],analyses:NewsAnalysis[]){
  const byHash=new Map(news.map(row=>[row.recordHash,row]));
  for(const row of analyses){const original=byHash.get(row.newsRecordHash);
    if(!original||row.articleId!==original.articleId||row.contentSha256!==original.contentSha256)throw new Error('NEWS_ANALYSIS_LEDGER_INVALID');
  }
}
export function acquireNewsLock(path:string,waitMs=5000,busyCode='NEWS_LEDGER_LOCKED'):()=>void{
  mkdirSync(dirname(path),{recursive:true});const lock=path+'.lock',until=Date.now()+waitMs;
  while(true)try{
    const fd=openSync(lock,'wx');writeFileSync(fd,String(process.pid));closeSync(fd);
    return ()=>unlinkSync(lock);
  }catch(error){
    if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
    let owner:number;try{owner=Number(readFileSync(lock,'utf8'));}catch(readError){if((readError as NodeJS.ErrnoException).code==='ENOENT')continue;throw readError;}
    if(Number.isSafeInteger(owner)&&owner>0){try{process.kill(owner,0);}catch(probe){
      if((probe as NodeJS.ErrnoException).code==='ESRCH'){try{unlinkSync(lock);}catch(removeError){if((removeError as NodeJS.ErrnoException).code!=='ENOENT')throw removeError;}continue;}
    }}
    if(Date.now()>=until)throw new Error(busyCode);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);
  }
}
export function withNewsLock<T>(path:string,run:()=>T):T{
  const release=acquireNewsLock(path);
  try{return run();}finally{release();}
}
export function appendNews(path:string,value:NewsArticle,receivedAtUtc:string):{record:NewsRecord;added:boolean}{
  return withNewsLock(path,()=>{
    const normalized=article.parse(value),provider=KNOWN_PROVIDERS.find(item=>item.id===normalized.providerId),url=new URL(normalized.canonicalUrl);
    if(!provider||normalized.source!==provider.name||url.protocol!=='https:'||!provider.articleHosts.includes(url.hostname)||url.username||url.password)throw new Error('NEWS_INVALID_CONTENT');
    const rows=readNews(path),articleId=sha256(normalized.providerId+'\n'+normalized.stableId),prior=rows.filter(row=>row.articleId===articleId).at(-1),digest=contentHash(normalized);
    if(prior?.contentSha256===digest)return {record:prior,added:false};
    const unsigned={schema:'phase36-news-v1' as const,...normalized,articleId,revision:(prior?.revision??0)+1,contentSha256:digest,firstSeenAtUtc:prior?.firstSeenAtUtc??receivedAtUtc,receivedAtUtc,previousHash:rows.at(-1)?.recordHash??null};
    const canonical=NewsRecord.parse({...unsigned,recordHash:'0'.repeat(64)});
    const {recordHash:_unused,...fields}=canonical;
    const record={...fields,recordHash:sha256(JSON.stringify(fields))};
    writeFileSync(path,JSON.stringify(record)+'\n',{flag:'a'});return {record,added:true};
  });
}
export function appendAnalysis(path:string,input:Omit<NewsAnalysis,'schema'|'analysisId'|'previousHash'|'recordHash'>):{record:NewsAnalysis;added:boolean}{
  return withNewsLock(path,()=>{
    const rows=readNewsAnalyses(path),analysisId=sha256(input.newsRecordHash+'\n'+input.modelVersion+'\n'+input.promptVersion);
    const prior=rows.find(row=>row.analysisId===analysisId);if(prior)return {record:prior,added:false};
    const unsigned={schema:'phase36-analysis-v1' as const,analysisId,...input,previousHash:rows.at(-1)?.recordHash??null};
    const canonical=NewsAnalysis.parse({...unsigned,recordHash:'0'.repeat(64)});
    const {recordHash:_unused,...fields}=canonical;
    const record={...fields,recordHash:sha256(JSON.stringify(fields))};
    writeFileSync(path,JSON.stringify(record)+'\n',{flag:'a'});return {record,added:true};
  });
}
