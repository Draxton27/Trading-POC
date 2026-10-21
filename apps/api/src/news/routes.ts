import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {readNews,readNewsAnalyses,verifyNewsAnalyses} from './store.ts';
import {readNewsStatus,type NewsPaths} from './service.ts';

const query=z.object({offset:z.coerce.number().int().min(0).max(100000).default(0),limit:z.coerce.number().int().min(1).max(100).default(25)}).strict();
export function registerNewsRoutes(app:FastifyInstance,paths:NewsPaths){
  app.get('/api/v1/news/status',()=>{
    try{const articles=readNews(paths.newsLog),analyses=readNewsAnalyses(paths.analysisLog),collection=readNewsStatus(paths.statusPath),analysis=readNewsStatus(paths.statusPath+'.analysis.json');verifyNewsAnalyses(articles,analyses);
      return {state:articles.length?'AVAILABLE':'NO_NEWS',articleCount:new Set(articles.map(row=>row.articleId)).size,revisionCount:articles.length,classificationCount:analyses.length,collection,analysis};}
    catch{return {state:'INVALID_LEDGER',articleCount:0,revisionCount:0,classificationCount:0,collection:null,analysis:null};}
  });
  app.get('/api/v1/news/items',(request,reply)=>{
    const parsed=query.safeParse(request.query);if(!parsed.success)return reply.code(400).send({error:'Paginación inválida.'});
    try{
      const news=readNews(paths.newsLog),latest=[...new Map(news.map(row=>[row.articleId,row])).values()].reverse();
      const analyses=readNewsAnalyses(paths.analysisLog);verifyNewsAnalyses(news,analyses);
      const items=latest.slice(parsed.data.offset,parsed.data.offset+parsed.data.limit).map(news=>{
        const analysis=[...analyses].reverse().find(row=>row.newsRecordHash===news.recordHash);
        return {id:news.articleId,revision:news.revision,source:news.source,canonicalUrl:news.canonicalUrl,title:news.title,description:news.description,publishedAtUtc:news.publishedAtUtc,publicationStatus:news.publicationStatus,firstSeenAtUtc:news.firstSeenAtUtc,receivedAtUtc:news.receivedAtUtc,updatedAtUtc:news.updatedAtUtc,contentSha256:news.contentSha256,classification:analysis?.classification??null,classificationModel:analysis?.modelVersion??null,analyzedAtUtc:analysis?.analyzedAtUtc??null};
      });
      return {state:'AVAILABLE',total:latest.length,offset:parsed.data.offset,limit:parsed.data.limit,items};
    }catch{return reply.code(422).send({state:'INVALID_LEDGER',error:'Registro de noticias inválido.'});}
  });
}
