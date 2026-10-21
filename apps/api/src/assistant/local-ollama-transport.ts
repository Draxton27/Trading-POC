import {request as httpRequest} from 'node:http';
import {Readable} from 'node:stream';

/** Fixed loopback transport shared by the assistant and the news classifier. */
export const localOllamaFetch:typeof fetch=async(url,init)=>new Promise<Response>((resolve,reject)=>{
  const target=new URL(String(url));
  if(target.origin!=='http://127.0.0.1:11434'||!['/api/chat','/api/tags'].includes(target.pathname)||target.search||target.hash){reject(new Error('OLLAMA_ENDPOINT_INVALID'));return;}
  const method=target.pathname==='/api/tags'?'GET':'POST';
  if(init?.method&&init.method!==method){reject(new Error('OLLAMA_METHOD_INVALID'));return;}
  const req=httpRequest({hostname:'127.0.0.1',port:11434,path:target.pathname,method,headers:method==='POST'?{'content-type':'application/json'}:{},signal:init?.signal??undefined},res=>{
    const headers=new Headers();for(const [key,value] of Object.entries(res.headers))if(typeof value==='string')headers.set(key,value);
    const status=res.statusCode??500;
    resolve(new Response(status===204||status===304?null:Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>,{status,headers}));
  });
  req.on('error',reject);req.end(typeof init?.body==='string'?init.body:'');
});
