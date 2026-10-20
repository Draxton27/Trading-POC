import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {appendPhase31Record,assertPhase31FeatureEquivalence,frozenModel,preparePhase31FromFiles,type CaptureMode} from './phase31-inference.ts';
import {parseCsvRows} from './phase17-csv.ts';

function value(flag:string){const at=process.argv.indexOf(flag);return at>=0?process.argv[at+1]:undefined;}
const csv=value('--csv'),modelDirectory=value('--model-dir')??process.env.TRADING_POC_ML_RUN_DIR,mode=(value('--mode')??'REPLAY') as CaptureMode;
const receivedAtUtc=value('--received-at')??new Date().toISOString(),log=value('--log')??process.env.TRADING_POC_ML_INFERENCE_LOG,barStartUtc=value('--bar-start-utc');
if(!csv||!modelDirectory||!log||!['REPLAY','PROSPECTIVE_CAPTURE'].includes(mode))throw new Error('Uso: --csv <NVDA.csv> --model-dir <run> --log <registro.jsonl> [--mode REPLAY|PROSPECTIVE_CAPTURE] [--received-at UTC] [--bar-start-utc UTC].');
if(mode==='PROSPECTIVE_CAPTURE')throw new Error('PROSPECTIVE_CAPTURE está bloqueado hasta disponer de una ingesta con recepción automática y procedencia verificable.');
const prepared=preparePhase31FromFiles(resolve(csv),receivedAtUtc,undefined,barStartUtc),model=frozenModel(resolve(modelDirectory));
const phase23=value('--phase23-dataset');
if(phase23){const rows=parseCsvRows(readFileSync(resolve(phase23,'dataset.csv'),'utf8'));const header=rows.shift()??[];const index=header.indexOf('bar_start_utc');const match=rows.find(row=>row[index]===prepared.barStartUtc);if(!match)throw new Error('La fila Fase 23 correspondiente no existe.');assertPhase31FeatureEquivalence(prepared.features,Object.fromEntries(header.map((name,i)=>[name,match[i]??''])));}
const python=process.env.PYTHON??(process.platform==='win32'?'py':'python3');
const launcher=process.platform==='win32'&&/^(py|py\.exe)$/i.test(python.replace(/^.*[\\/]/,''));
const result=spawnSync(python,[...(launcher?['-3.12']:[]),resolve(import.meta.dirname,'../../ml/phase31/infer.py')],{input:JSON.stringify({modelPath:model.modelPath,features:prepared.features}),encoding:'utf8'});
if(result.error)throw result.error;if(result.status!==0)throw new Error('Inferencia XGBoost rechazada.');
const output=JSON.parse(result.stdout) as {modelSha256:string;probabilities:{ALCISTA:number;BAJISTA:number;LATERAL:number};dominantClass:'ALCISTA'|'BAJISTA'|'LATERAL'};
if(output.modelSha256!==model.sha256)throw new Error('Hash de modelo inconsistente.');
const stored=appendPhase31Record(resolve(log),{mode,model:{id:model.id,sha256:model.sha256,createdAtUtc:model.createdAtUtc},bar:{startUtc:prepared.barStartUtc,endUtc:prepared.barEndUtc,sessionDateNy:prepared.sessionDateNy,receivedAtUtc:prepared.source.receivedAtUtc},features:{spec:'nvda-15m-v1',hash:prepared.featureHash,values:prepared.features},prediction:{...output.probabilities,dominantClass:output.dominantClass},source:{provider:prepared.source.provider,feed:'sip',adjustment:'split',availability:'VERIFIED'}});
process.stdout.write(JSON.stringify({recordId:stored.record.recordId,alreadyPresent:stored.alreadyPresent,mode:stored.record.mode,barEndUtc:stored.record.bar.endUtc,recordedBeforeNextEntry:stored.record.recordedBeforeNextEntry,probabilities:{ALCISTA:stored.record.prediction.ALCISTA,BAJISTA:stored.record.prediction.BAJISTA,LATERAL:stored.record.prediction.LATERAL}})+'\n');
