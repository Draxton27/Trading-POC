import {randomBytes,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {config as loadDotenv} from 'dotenv';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import {z} from 'zod';
import {Mode,HumanDecision,symbol} from '@trading-poc/contracts';
import {calculateIndicators,spread,previousSessionLevels} from '@trading-poc/market-domain';
import {demoBars,offlineAvailable,offlineBars,offlineMetadata,offlineCalendar,pageBars,historicalSignals,historicalEvents,priorCalendarSession,type Timeframe,type Symbol} from '@trading-poc/research-adapter';
import {verifyLedger} from '../../../trading_poc_001_bollinger/src/phase16-ledger.ts';
import {appendPhase17Decision,PHASE17_TEMPLATE_COLUMNS} from '../../../trading_poc_001_bollinger/src/phase17-journal.ts';
import {csvCell} from '../../../trading_poc_001_bollinger/src/phase17-csv.ts';
import {readBrokerStore,importBrokerSource} from '../../../trading_poc_001_bollinger/src/phase17-broker-store.ts';
import {openDatabase} from './persistence/db.ts';
import * as tables from './persistence/schema.ts';
import {AgentHub,AgentRequestError} from './streams/agent-hub.ts';
import {registerOptionRoutes} from './options/routes.ts';
import {registerAcademyRoutes} from './academy/routes.ts';
import {registerAssistantRoutes} from './assistant/routes.ts';

type Options={mode?:'DEMO'|'OFFLINE'|'PAPER';privateDir?:string;phase17Private?:string;phase16Ledger?:string;dbPath?:string;agentSecret?:string;assistantFetch?:typeof fetch;assistantTimeoutMs?:number};
const repoRoot=fileURLToPath(new URL('../../../',import.meta.url));
// Commands can be launched from a workspace directory, so never resolve local
// configuration relative to process.cwd(). Existing process variables win.
loadDotenv({path:resolve(repoRoot,'.env.local'),override:false,quiet:true});
loadDotenv({path:resolve(repoRoot,'.env'),override:false,quiet:true});
const frame=z.enum(['15m','1h','1d']);
const browserOrigin=(origin:string|undefined)=>!origin||/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
const validToken=(supplied:string|undefined,expected:string)=>supplied===expected;
const bad=(reply:any,error:string,status=400)=>reply.code(status).send({error});
function demoOptions(){
  const spot=218.42;return ['CALL','PUT'].flatMap((right,i)=>[210,215,220,225,230].map((strike,j)=>{
    const bid=Math.max(.15,Math.round((4+Math.abs(spot-strike)*.13-j*.12+i*.2)*100)/100),ask=bid+.12+j*.02;
    return {conId:90000+i*100+j,occSymbol:`NVDA  261023${right==='CALL'?'C':'P'}${String(strike*1000).padStart(8,'0')}`,underlying:'NVDA',right,strike,expiration:'2026-10-23',multiplier:100,bid,ask,spread:spread(bid,ask),bidSize:10+j,askSize:12+j,delta:null,gamma:null,theta:null,vega:null,impliedVolatility:null,marketTimestampUtc:'2026-10-16T19:59:00.000Z',receivedAtUtc:'2026-10-16T19:59:01.000Z',feedType:'UNKNOWN',provider:'DEMO sintético'};
  }));
}
export async function createApp(options:Options={}){
  const parsedMode=Mode.safeParse(options.mode??process.env.TRADING_POC_MODE??'DEMO');if(!parsedMode.success)throw new Error('Modo inválido');
  const mode=parsedMode.data;const defaultPrivateDir=process.platform==='win32'&&process.env.LOCALAPPDATA?
    resolve(process.env.LOCALAPPDATA,'Trading-POC'):resolve(repoRoot,'private');
  const privateDir=options.privateDir??(process.env.TRADING_POC_PRIVATE_DIR?resolve(process.env.TRADING_POC_PRIVATE_DIR):defaultPrivateDir);
  const phase17Private=options.phase17Private??(process.env.TRADING_POC_PHASE17_PRIVATE_DIR?resolve(process.env.TRADING_POC_PHASE17_PRIVATE_DIR):resolve(repoRoot,'trading_poc_001_bollinger/output/phase17-private'));
  const phase16Ledger=options.phase16Ledger??(process.env.TRADING_POC_PHASE16_LEDGER?resolve(process.env.TRADING_POC_PHASE16_LEDGER):resolve(repoRoot,'shared-artifacts/phase16-forward-observation/live/ledger'));
  const db=openDatabase(options.dbPath??process.env.TRADING_POC_DB_PATH??resolve(privateDir,'trading-poc.sqlite'));
  const configuredAgentSecret=process.env.TRADING_POC_DISABLE_AGENT==='1'?'':process.env.TRADING_POC_AGENT_SECRET??'';
  const hub=new AgentHub(options.agentSecret??configuredAgentSecret,message=>{
    if(message.kind==='agent.hello')db.db.insert(tables.agentSessions).values({id:message.messageId,agentId:message.agentId,connectionId:message.connectionId,environment:'PAPER',openedAtUtc:message.issuedAtUtc}).run();
    if(message.kind==='market.quote'){
      db.db.insert(tables.marketQuotes).values({id:message.messageId,symbol:String(message.payload.symbol),receivedAtUtc:String(message.payload.receivedAtUtc),payload:JSON.stringify(message.payload)}).run();
    }
    if(message.kind==='option.quote'){
      db.db.insert(tables.optionQuotes).values({id:message.messageId,environment:'PAPER',conId:Number(message.payload.conId),receivedAtUtc:String(message.payload.receivedAtUtc),payload:JSON.stringify(message.payload)}).run();
    }
    if(message.kind==='broker.positions.snapshot'&&Array.isArray(message.payload.items)){
      for(const item of message.payload.items as Array<Record<string,unknown>>){
        const id='PAPER:'+String(item.accountAlias)+':'+String(item.conId);
        db.db.insert(tables.brokerPositions).values({id,environment:'PAPER',accountAlias:String(item.accountAlias),conId:Number(item.conId),payload:JSON.stringify(item)}).onConflictDoUpdate({target:tables.brokerPositions.id,set:{payload:JSON.stringify(item)}}).run();
      }
    }
    if(message.kind==='broker.executions.snapshot'&&Array.isArray(message.payload.items)){
      for(const item of message.payload.items as Array<Record<string,unknown>>){
        if(typeof item.executionId!=='string'||typeof item.conId!=='number')continue;
        const id='PAPER:'+String(item.accountAlias)+':'+item.executionId;
        const prior=db.sqlite.prepare('SELECT payload FROM broker_executions WHERE id = ?').get(id) as {payload:string}|undefined;
        const payload=JSON.stringify(item);
        if(prior){
          const stable=(value:Record<string,unknown>)=>{const {receivedAtUtc,...identity}=value;return JSON.stringify(identity);};
          if(stable(JSON.parse(prior.payload) as Record<string,unknown>)!==stable(item))throw new Error('Ejecución contradictoria');
        }
        if(!prior)db.db.insert(tables.brokerExecutions).values({id,environment:'PAPER',accountAlias:String(item.accountAlias),executionId:item.executionId,conId:item.conId,payload}).run();
      }
    }
  });
  const token=randomBytes(32).toString('hex');
  // Fastify does not include request bodies in its standard logs. Route-level diagnostics
  // contain only allowlisted metadata and are emitted at warn level.
  const app=Fastify({logger:{level:process.env.TRADING_POC_LOG_LEVEL??'warn'},bodyLimit:2*1024*1024});await app.register(websocket);
  app.addHook('onRequest',async(request,reply)=>{
    if(!browserOrigin(request.headers.origin))return bad(reply,'Origen no autorizado',403);
    if(request.url.startsWith('/api/v1/session')&&!request.headers.origin&&
        request.headers['sec-fetch-site']!=='same-origin')
      return bad(reply,'La sesión requiere una solicitud del mismo origen',403);
    if(request.method!=='GET'&&request.method!=='HEAD'&&!validToken(request.headers['x-local-token'] as string|undefined,token))return bad(reply,'Token local requerido',403);
  });
  const barsFor=(s:Symbol,t:Timeframe)=>mode==='DEMO'?demoBars(s,t):offlineBars(s,t);
  app.get('/api/v1/session',()=>({token,mode}));
  app.get('/api/v1/health',()=>({ok:true,mode,timeUtc:new Date().toISOString(),offlineAvailable:offlineAvailable(),broker:hub.status().connected}));
  app.get('/api/v1/broker/status',()=>({mode,...hub.status(),provider:mode==='DEMO'?'DEMO sintético':mode==='OFFLINE'?'archivo local':hub.status().simulation?'Agente simulado':'IBKR'}));
  app.get('/api/v1/market/symbols',()=>({items:['NVDA','QQQ','SMH'].map(s=>({symbol:s,available:mode==='DEMO'||offlineAvailable(),source:mode==='DEMO'?'DEMO sintético':'Alpaca SIP local'}))}));
  const barQuery=z.object({symbol,timeframe:frame.default('15m'),before:z.iso.datetime({offset:true}).optional(),limit:z.coerce.number().int().min(1).max(500).default(260)});
  app.get('/api/v1/market/bars',async(req,reply)=>{
    const parsed=barQuery.safeParse(req.query);if(!parsed.success)return bad(reply,'Consulta de velas inválida');
    const {symbol:s,timeframe:t,before,limit}=parsed.data;
    if(mode!=='DEMO'&&!offlineAvailable())return bad(reply,'Históricos autorizados no disponibles',503);
    const all=barsFor(s,t);const page=pageBars(all,before,limit);
    return {...page,source:mode==='DEMO'?'DEMO sintético':'Alpaca SIP local',timeframe:t,symbol:s};
  });
  app.get('/api/v1/market/indicators',async(req,reply)=>{
    const parsed=barQuery.safeParse(req.query);if(!parsed.success)return bad(reply,'Consulta de indicadores inválida');
    if(mode!=='DEMO'&&!offlineAvailable())return bad(reply,'Históricos autorizados no disponibles',503);
    const {symbol:s,timeframe:t,before,limit}=parsed.data;return pageBars(calculateIndicators(barsFor(s,t)) as any,before,limit);
  });
  app.get('/api/v1/market/context',async(req,reply)=>{
    const parsed=z.object({symbol,asOfUtc:z.iso.datetime({offset:true})}).safeParse(req.query);
    if(!parsed.success)return bad(reply,'Símbolo o asOfUtc inválido');
    const {symbol:s,asOfUtc}=parsed.data;
    if(mode!=='DEMO'&&!offlineAvailable())return {symbol:s,...previousSessionLevels([],asOfUtc),source:'no disponible'};
    return {symbol:s,...previousSessionLevels(barsFor(s,'1d'),asOfUtc,
      mode==='DEMO'?undefined:priorCalendarSession(s,asOfUtc)),
      source:mode==='DEMO'?'DEMO sintético':'Alpaca SIP local'};
  });
  app.get('/api/v1/market/quotes',async(req,reply)=>{
    const parsed=z.object({symbol,consumerId:z.uuid()}).safeParse(req.query);if(!parsed.success)return bad(reply,'Consulta de cotización inválida');
    if(mode!=='PAPER'||!hub.status().connected)return {item:null,dataStatus:'desconectado',source:mode==='DEMO'?'DEMO sintético':'IBKR desconectado'};
    const s=parsed.data.symbol;await hub.subscribe({symbol:s},parsed.data.consumerId);
    const item=hub.latestQuote(s) as {receivedAtUtc?:string;marketDataStatus?:string;last?:number|null;bid?:number|null;ask?:number|null}|null;
    const stale=!!item&&(!item.receivedAtUtc||Date.now()-Date.parse(item.receivedAtUtc)>30000);
    return {item,dataStatus:!item?'pendiente':stale?'obsoleto':item.marketDataStatus==='permission_denied'?'permisos_insuficientes':
      item.marketDataStatus==='partial'?'cotizacion_parcial':item.marketDataStatus==='unavailable'||item.last==null&&item.bid==null&&item.ask==null?'cotizacion_no_disponible':'recibido',stale,
      source:hub.status().simulation?'PAPER SIMULADO':'IBKR Paper'};
  });
  app.delete('/api/v1/market/subscriptions/:key',async(req,reply)=>{
    const parsed=z.object({consumerId:z.uuid()}).safeParse(req.query);
    const key=(req.params as {key:string}).key;
    if(!parsed.success||!/^([0-9]{1,12}|NVDA|QQQ|SMH)$/.test(key))return bad(reply,'Suscripción inválida');
    if(mode==='PAPER')await hub.release(key,parsed.data.consumerId);
    return {released:key};
  });
  const readDrawings=(s?:string)=>db.sqlite.prepare(`SELECT * FROM chart_drawings ${s?'WHERE symbol = ?':''} ORDER BY created_at_utc`).all(...(s?[s]:[]));
  app.get('/api/v1/market/drawings',async(req,reply)=>{const p=z.object({symbol:symbol.optional()}).safeParse(req.query);if(!p.success)return bad(reply,'Símbolo inválido');return {items:readDrawings(p.data.symbol)};});
  app.post('/api/v1/market/drawings',async(req,reply)=>{
    const p=z.object({symbol,timeframe:frame,kind:z.enum(['horizontal','segment','support','resistance','zone','text','buy','sell','signal']),price:z.number().positive(),price2:z.number().positive().optional(),author:z.string().min(1).max(80).default('operador')}).safeParse(req.body);
    if(!p.success)return bad(reply,'Dibujo inválido');const id=randomUUID(),at=new Date().toISOString();const x=p.data;
    db.sqlite.prepare('INSERT INTO chart_drawings(id,symbol,timeframe,kind,price,price2,created_at_utc,author) VALUES (?,?,?,?,?,?,?,?)').run(id,x.symbol,x.timeframe,x.kind,x.price,x.price2??null,at,x.author);
    return reply.code(201).send({id,...x,createdAtUtc:at});
  });
  registerOptionRoutes(app,hub,mode,demoOptions,db.sqlite);
  registerAcademyRoutes(app,db.sqlite);
  registerAssistantRoutes(app,{mode,hub,sqlite:db.sqlite,barsFor,offlineAvailable,offlineMetadata,calendarFor:s=>mode==='DEMO'?null:offlineCalendar(s),transport:options.assistantFetch,timeoutMs:options.assistantTimeoutMs});
  app.get('/api/v1/options/quotes',async()=>({items:mode==='DEMO'?demoOptions():[],source:mode==='DEMO'?'DEMO sintético':'Consulte /options/contracts para suscribirse a contratos visibles'}));
  app.get('/api/v1/positions',async()=>{if(mode!=='PAPER'||!hub.status().connected)return {items:[],source:'IBKR desconectado'};
    const m=await hub.request('broker.positions.request',{});return {items:m.kind==='broker.positions.snapshot'?m.payload.items:[],source:hub.status().simulation?'Agente simulado':'IBKR Paper'};});
  app.get('/api/v1/executions',async()=>{if(mode!=='PAPER'||!hub.status().connected)return {items:[],source:'IBKR desconectado'};
    const m=await hub.request('broker.executions.request',{});return {items:m.kind==='broker.executions.snapshot'?m.payload.items:[],source:hub.status().simulation?'Agente simulado':'IBKR Paper: ventana disponible por TWS; tiempos crudos sin zona verificable'};});
  app.get('/api/v1/trades',()=>{const state=readBrokerStore(phase17Private);return {items:state.positions,source:'Fase 17 privada'};});
  app.post('/api/v1/trades/import',async(req,reply)=>{
    const parsed=z.object({fileName:z.string().min(1).max(100),csv:z.string().min(1).max(1024*1024)}).safeParse(req.body);
    if(!parsed.success)return bad(reply,'Archivo de Fase 17 inválido');
    try{const imported=importBrokerSource(phase17Private,Buffer.from(parsed.data.csv,'utf8'),parsed.data.fileName);
      return {sourceSha256:imported.sourceSha256,alreadyPresent:imported.alreadyPresent,executionCount:imported.state.executionCount,positionCount:imported.state.positions.length};
    }catch(e){return bad(reply,String(e),422);}
  });
  app.get('/api/v1/trades/:id',(req,reply)=>{const id=(req.params as {id:string}).id;const state=readBrokerStore(phase17Private);const item=state.positions.find(p=>p.positionId===id);return item?{item,
    fills:state.fills.filter(f=>item.buyExecutionIds.includes(f.executionId)||item.sellExecutionIds.includes(f.executionId)),
    closedTrades:state.closedTrades.filter(t=>t.positionId===id)}:bad(reply,'Operación no encontrada',404);});
  app.get('/api/v1/signals',()=>mode==='DEMO'?{items:[],forward:[],source:'DEMO sintético; sin señales inventadas'}:{items:historicalSignals(200),forward:verifyLedger(phase16Ledger).filter(r=>r.kind==='signal'),source:'Fase 15 histórica y Fase 16 append-only'});
  app.get('/api/v1/signals/:id',(req,reply)=>{if(mode==='DEMO')return bad(reply,'DEMO sin señales históricas',404);const id=(req.params as {id:string}).id;const item=historicalSignals(100000).find(s=>s.signal_id===id);return item?{item}:bad(reply,'Señal no encontrada',404);});
  const journalDir=resolve(phase17Private,'ledger');
  const oldJournalDir=resolve(privateDir,'phase19-journal');
  app.get('/api/v1/journal',()=>({items:verifyLedger(journalDir).filter(r=>r.kind==='human_decision'),
    legacyItems:verifyLedger(oldJournalDir),source:'Fase 17 original; registros F19 anteriores solo lectura'}));
  app.post('/api/v1/journal/decisions',async(req,reply)=>{
    const raw=z.object({csv:z.string().min(1).max(64*1024)}).safeParse(req.body);
    const parsed=raw.success?null:HumanDecision.safeParse(req.body);
    if(!raw.success&&!parsed?.success)return bad(reply,'Decisión F17 inválida');
    const documentedAtUtc=new Date().toISOString();
    let csv=raw.success?raw.data.csv:'';
    if(parsed?.success){
      const x=parsed.data;
      if(x.symbol!=='NVDA')return bad(reply,'El diario F17 original admite NVDA');
      if(x.captureId||x.recordMode==='post_outcome_annotation')
        return bad(reply,'Capturas y revisiones requieren el CSV completo F17');
      if(Date.parse(x.decisionAtUtc)>Date.parse(documentedAtUtc)+5000)
        return bad(reply,'La decisión no puede estar fechada en el futuro');
      // The short web form cannot prove what market context was observed.
      const fields:Record<string,string>={symbol:x.symbol,
        direction:x.direction==='CALL'?'bullish':x.direction==='PUT'?'bearish':'no_trade',
        operationType:x.direction==='no_trade'?'no_trade':'other',timeframe:'15Min',
        decisionAtUtc:x.decisionAtUtc,selectionReason:x.reason,observedMarket:'',
        recordMode:x.recordMode,sma20:'',sma40:'',sma100:'',sma200:'',
        trendInterpretation:[x.trend,x.smaNotes&&`Notas SMA: ${x.smaNotes}`].filter(Boolean).join('\n'),
        manualLevelsDescription:x.levels??'',
        awaitedConfirmation:x.expectedConfirmation??'',invalidationCondition:x.invalidation??'',
        contractOccSymbol:x.contractOcc??'',profitObjective:x.target??''};
      csv=PHASE17_TEMPLATE_COLUMNS.join(',')+'\n'+
        PHASE17_TEMPLATE_COLUMNS.map(key=>csvCell(fields[key]??'')).join(',')+'\n';
    }
    try{return reply.code(201).send(appendPhase17Decision(journalDir,csv,documentedAtUtc,phase17Private));}
    catch(e){return bad(reply,String(e),422);}
  });
  app.get('/api/v1/events',()=>mode==='DEMO'?{items:[],source:'DEMO sintético; sin eventos inventados'}:{items:historicalEvents(),source:'Fase 14: calendario derivado'});
  app.get('/api/v1/data-quality',()=>({mode,offlineAvailable:offlineAvailable(),source:mode==='DEMO'?'Datos sintéticos':mode==='OFFLINE'?'Alpaca SIP local':'IBKR Paper',warnings:mode==='PAPER'&&!hub.status().connected?['Agente desconectado']:[]}));
  app.get('/api/v1/stream',{websocket:true},(socket,req)=>{
    if(!validToken((req.query as {token?:string}).token,token)){socket.close(1008,'Token requerido');return;}
    socket.send(JSON.stringify({kind:'status',mode,broker:hub.status(),atUtc:new Date().toISOString()}));
    const unsubscribe=hub.onEvent(event=>{if(socket.readyState===1)socket.send(JSON.stringify(event));});
    const timer=setInterval(()=>{if(socket.readyState===1)socket.send(JSON.stringify({kind:'status',mode,broker:hub.status(),atUtc:new Date().toISOString()}));},15000);
    socket.on('close',()=>{clearInterval(timer);unsubscribe();});
  });
  app.addHook('onClose',async()=>db.sqlite.close());
  return {app,hub,token,database:db.sqlite};
}
export async function start(){
  const {app,hub}=await createApp();
  const apiHost=process.env.TRADING_POC_API_HOST??'127.0.0.1',apiPort=Number(process.env.TRADING_POC_API_PORT??4300);
  if(!['127.0.0.1','localhost'].includes(apiHost))throw new Error('API HTTP debe limitarse a localhost');
  await app.listen({host:apiHost,port:apiPort});
  const secret=process.env.TRADING_POC_DISABLE_AGENT==='1'?'':process.env.TRADING_POC_AGENT_SECRET??'';
  if(secret){
    if(secret.length<32)throw new Error('TRADING_POC_AGENT_SECRET requiere al menos 32 caracteres');
    const agent=Fastify({logger:false,bodyLimit:65536});await agent.register(websocket);
    agent.get('/agent/v1/connect',{websocket:true},(socket,req)=>{
      if(req.headers.origin||!hub.authorize(req.headers.authorization)){socket.close(1008,'No autorizado');return;}
      hub.attach(socket);
    });
    const host=process.env.TRADING_POC_AGENT_HOST??'127.0.0.1';
    const octets=host.split('.').map(Number);
    const privateHost=['127.0.0.1','localhost'].includes(host)||(octets.length===4&&octets.every(x=>Number.isInteger(x)&&x>=0&&x<=255)&&
      (octets[0]===10||(octets[0]===172&&octets[1]>=16&&octets[1]<=31)||(octets[0]===192&&octets[1]===168)||(octets[0]===100&&octets[1]>=64&&octets[1]<=127)));
    if(!privateHost)throw new Error('Fije una IP privada específica para el agente');
    await agent.listen({host,port:Number(process.env.TRADING_POC_AGENT_PORT??4301)});
  }
  process.stdout.write(`Trading-POC API ${apiHost}:${apiPort}; agente ${secret?'habilitado':'deshabilitado'}\n`);
}
if(process.argv[1]&&import.meta.url===new URL(`file://${resolve(process.argv[1])}`).href)start().catch(e=>{process.stderr.write(String(e)+'\n');process.exitCode=1;});
