import {existsSync,mkdirSync,readFileSync,renameSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolvePrivateDir} from '../../../api/src/news/paths.ts';
import type {TwsHandshakeDiagnostic} from './tws.ts';

const root=fileURLToPath(new URL('../../../../',import.meta.url));
export type PaperDiagnosticCode='TWS_PROCESS_NOT_AVAILABLE'|'TWS_PORT_NOT_REACHABLE'|
  'TWS_API_HANDSHAKE_TIMEOUT'|'TWS_API_AUTHORIZATION_UNCONFIRMED'|'TWS_ACCOUNT_MISMATCH'|
  'TWS_ACCOUNT_VERIFIED'|'AGENT_BACKEND_DISCONNECTED'|'AGENT_READY'|'UNKNOWN_CAUSE';
export type PaperDiagnostic={schema:'phase41p-paper-diagnostic-v1';atUtc:string;code:PaperDiagnosticCode;
  socketConnected:boolean;nextValidId:boolean;managedAccounts:boolean;paperAccountVerified:boolean;
  backendConnected:boolean;ibkrCode:number|null};
export const paperDiagnosticPath=(env:NodeJS.ProcessEnv=process.env)=>
  env.TRADING_POC_IBKR_DIAGNOSTIC??resolve(resolvePrivateDir({repoRoot:root,env}),'ibkr','paper-diagnostic.json');
export const paperDiagnosticPathFor=(privateDir:string,env:NodeJS.ProcessEnv=process.env)=>
  env.TRADING_POC_IBKR_DIAGNOSTIC??resolve(privateDir,'ibkr','paper-diagnostic.json');
export function paperDiagnostic(code:PaperDiagnosticCode,handshake?:TwsHandshakeDiagnostic,
  backendConnected=false,clock:()=>string=()=>new Date().toISOString()):PaperDiagnostic{
  return {schema:'phase41p-paper-diagnostic-v1',atUtc:clock(),code,
    socketConnected:handshake?.socketConnected??false,nextValidId:handshake?.nextValidId??false,
    managedAccounts:handshake?.managedAccounts??false,paperAccountVerified:handshake?.paperAccountVerified??false,
    backendConnected,ibkrCode:handshake?.ibkrCode??null};
}
export function writePaperDiagnostic(path:string,value:PaperDiagnostic){
  mkdirSync(dirname(path),{recursive:true});const temporary=`${path}.${randomUUID()}.tmp`;
  try{writeFileSync(temporary,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});renameSync(temporary,path);}
  catch(error){rmSync(temporary,{force:true});throw error;}
}
export function readPaperDiagnostic(path:string):PaperDiagnostic|null{
  if(!existsSync(path))return null;
  if(statSync(path).size>8192)throw new Error('PAPER_DIAGNOSTIC_INVALID');
  const row=JSON.parse(readFileSync(path,'utf8')) as PaperDiagnostic;
  const codes=new Set<PaperDiagnosticCode>(['TWS_PROCESS_NOT_AVAILABLE','TWS_PORT_NOT_REACHABLE',
    'TWS_API_HANDSHAKE_TIMEOUT','TWS_API_AUTHORIZATION_UNCONFIRMED','TWS_ACCOUNT_MISMATCH',
    'TWS_ACCOUNT_VERIFIED','AGENT_BACKEND_DISCONNECTED','AGENT_READY','UNKNOWN_CAUSE']);
  if(row.schema!=='phase41p-paper-diagnostic-v1'||!codes.has(row.code)||
    !Number.isFinite(Date.parse(row.atUtc))||new Date(row.atUtc).toISOString()!==row.atUtc||
    ['socketConnected','nextValidId','managedAccounts','paperAccountVerified','backendConnected'].some(key=>
      typeof row[key as keyof PaperDiagnostic]!=='boolean')||
    row.ibkrCode!==null&&!Number.isInteger(row.ibkrCode))throw new Error('PAPER_DIAGNOSTIC_INVALID');
  return row;
}
export function classifyPaperConnectivity(input:{mode:'DEMO'|'OFFLINE'|'PAPER';configured:boolean;
  portReachable:boolean|null;processPresent:boolean|null;backendConnected:boolean;backendSimulation:boolean;
  last:PaperDiagnostic|null;now:number}){
  const {mode,last}=input;
  if(mode!=='PAPER')return {code:'UNKNOWN_CAUSE' as const,reason:'TWS no requerido en este modo.'};
  if(!input.configured)return {code:'UNKNOWN_CAUSE' as const,reason:'Falta configuración Paper válida.'};
  if(input.backendConnected&&!input.backendSimulation)return {code:'AGENT_READY' as const,reason:'Backend recibió agente Paper verificado.'};
  if(input.processPresent===false&&input.portReachable===false)
    return {code:'TWS_PROCESS_NOT_AVAILABLE' as const,reason:'No se detectó el proceso TWS y el puerto no responde.'};
  if(input.portReachable===false)return {code:'TWS_PORT_NOT_REACHABLE' as const,reason:'El puerto TWS configurado no responde en loopback.'};
  if(last&&input.now-Date.parse(last.atUtc)<=120_000){
    if(last.code==='TWS_ACCOUNT_MISMATCH')return {code:last.code,reason:'La cuenta recibida no coincide con la cuenta Paper configurada.'};
    if(last.code==='TWS_API_HANDSHAKE_TIMEOUT'||last.code==='TWS_API_AUTHORIZATION_UNCONFIRMED')
      return {code:last.code,reason:'El handshake de API no completó nextValidId y managedAccounts; verificar autorización en TWS.'};
    if(last.code==='AGENT_BACKEND_DISCONNECTED'||last.code==='TWS_ACCOUNT_VERIFIED')
      return {code:'AGENT_BACKEND_DISCONNECTED' as const,reason:'La cuenta Paper fue verificada, pero el backend no tiene un agente conectado.'};
  }
  return {code:'UNKNOWN_CAUSE' as const,reason:'No hay evidencia suficiente para atribuir la causa a TWS, autorización o backend.'};
}
