/** Explicit activation and read-only reporting; never starts Alpaca, inference or Scheduler. */
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {isAbsolute,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {config as loadEnv} from 'dotenv';
import {resolvePrivateDir} from '../apps/api/src/news/paths.ts';
import {iexLedgerPath,iexObservationPath} from './iex-daily.ts';
import {diagnoseIex} from './iex-diagnostics.ts';
import {activatePhase41i,loadPhase41iActivation,phase41iPrivateRoot,phase41iProtocolDir,
  readPhase41iDecisions,verifyPhase41iModel} from '../trading_poc_001_bollinger/src/phase41i-prospective.ts';

const root=fileURLToPath(new URL('../',import.meta.url));
loadEnv({path:resolve(root,'.env.local'),override:false,quiet:true});
loadEnv({path:resolve(root,'.env'),override:false,quiet:true});
const base=resolvePrivateDir({repoRoot:root}),args=process.argv.slice(2),command=args[0];
const protocolDir=phase41iProtocolDir(process.env),phase41iBase=phase41iPrivateRoot(process.env);
const observationPath=iexObservationPath(process.env),modelDir=process.env.TRADING_POC_IEX_FROZEN_DIR;
if(!['diagnose','activate','report','verify'].includes(command??''))throw new Error('Uso: npm.cmd run ml:iex:41i -- diagnose|activate|report|verify [--out-dir carpeta_privada_nueva]');
if(command==='diagnose'){
  const report=diagnoseIex();
  process.stdout.write(JSON.stringify({overall:report.overall,checks:report.checks,counts:report.counts})+'\n');
}else{
  if(!modelDir)throw new Error('Falta TRADING_POC_IEX_FROZEN_DIR; no se selecciona otro modelo.');
  if(command==='activate'){
    if(args.length!==1)throw new Error('La activación no admite timestamps ni parámetros manuales.');
    const active=activatePhase41i(protocolDir,modelDir,observationPath);
    process.stdout.write(JSON.stringify({status:'ACTIVATED',activatedAtUtc:active.activation.activatedAtUtc,
      protocolSha256:active.activation.protocolSha256,modelSha256:active.activation.modelSha256,
      priorLedger:active.activation.priorObservationLedger.state})+'\n');
  }else{
    const model=verifyPhase41iModel(modelDir);
    const active=loadPhase41iActivation(protocolDir,observationPath);
    if(!active)throw new Error('El protocolo 41I no está activado.');
    const decisions=readPhase41iDecisions(protocolDir);
    if(command==='verify'){
      if(args.length!==1)throw new Error('verify no admite argumentos.');
      process.stdout.write(JSON.stringify({status:'VERIFIED',modelSha256:model.modelSha256,
        protocolSha256:active.activation.protocolSha256,eligibilityDecisions:decisions.length})+'\n');
    }else{
      if(args.length!==1&&!(args.length===3&&args[1]==='--out-dir'))throw new Error('Uso: report [--out-dir carpeta_privada_nueva]');
      const out=resolve(args[2]??resolve(phase41iBase,'ml-iex','phase41i-prospective-report-v1'));
      const inside=relative(phase41iBase,out);
      if(!inside||inside.startsWith('..')||isAbsolute(inside)||existsSync(out))throw new Error('Destino privado nuevo requerido para el reporte.');
      const python=process.env.PYTHON??(process.platform==='win32'?'py':'python3');
      const launcher=process.platform==='win32'&&/^(?:py|py\.exe)$/i.test(python)?['-3.12']:[];
      const result=spawnSync(python,[...launcher,'-m','ml.phase41i.report','--protocol-dir',protocolDir,'--model-dir',modelDir,
        '--observations',observationPath,'--iex-ledger',iexLedgerPath(process.env),
        '--calendar',process.env.TRADING_POC_IEX_CALENDAR??resolve(base,'iex','calendar.json'),'--out-dir',out],
      {cwd:root,encoding:'utf8',timeout:60_000,maxBuffer:16_000,windowsHide:true});
      if(result.error||result.status!==0)throw new Error(`Reporte 41I falló (${result.status??'sin código'}); revisar la integridad privada y ejecutar el módulo Python localmente para diagnóstico.`);
      process.stdout.write(result.stdout);
    }
  }
}
