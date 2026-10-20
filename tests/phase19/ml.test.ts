import {afterEach,describe,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../../apps/api/src/server.ts';
import {MlPredictionsPage,MlSummary} from '../../packages/contracts/src/ml.ts';

const dispose:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const clean of dispose.splice(0))await clean();});
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const metric={accuracy:1,balanced_accuracy:1,macro_f1:1,log_loss:-(Math.log(.7)+Math.log(.7)+Math.log(.6))/3,per_class:Object.fromEntries(['ALCISTA','BAJISTA','LATERAL'].map(name=>[name,{precision:1,recall:1,f1:1,support:1}]))};
function artifacts(){
  const root=mkdtempSync(join(tmpdir(),'ml-artifacts-'));
  const datasetSha='a'.repeat(64),run=join(root,`20261020T134917Z-${datasetSha.slice(0,12)}`);mkdirSync(run);
  const report={experimental:true,dataset_sha256:datasetSha,class_index:{ALCISTA:0,BAJISTA:1,LATERAL:2},selection:{selected:'standard'},model:{variant:'standard',n_estimators:2},baselines:{frecuencia:metric},xgboost:metric,walk_forward_folds:[{fold:1,external_sessions:['2024-01-02'],models:Object.fromEntries(['standard','class_weighted','regularized','frequency'].map(name=>[name,{metrics:metric}]))}],exploratory_by_year:{'2025':metric}};
  const model={version:[2,1,4],learner:{learner_model_param:{num_class:'3',num_feature:'10'},gradient_booster:{model:{gbtree_model_param:{num_trees:'6'}}}}};
  const reproduction={dataset_metadata:{schemaVersion:'nvda-15m-v1',outputCsvSha256:datasetSha,source:{metadata:{asset:'NVDA',bar_minutes:15,data_class:'real'}}},class_index:{ALCISTA:0,BAJISTA:1,LATERAL:2},dataset_dir:'C:/private/secret-dataset'};
  const csv='bar_start_utc,session_date_ny,label,prob_ALCISTA,prob_BAJISTA,prob_LATERAL\n2025-01-02T14:30:00.000Z,2025-01-02,ALCISTA,0.7,0.2,0.1\n2025-01-02T14:45:00.000Z,2025-01-02,BAJISTA,0.2,0.7,0.1\n2025-01-02T15:00:00.000Z,2025-01-02,LATERAL,0.2,0.2,0.6\n';
  writeFileSync(join(run,'report.json'),JSON.stringify(report));writeFileSync(join(run,'model.json'),JSON.stringify(model));writeFileSync(join(run,'reproduction.json'),JSON.stringify(reproduction));writeFileSync(join(run,'exploratory_predictions.csv'),csv);
  return {root,run};
}
async function appFor(run:string|null){const temp=mkdtempSync(join(tmpdir(),'ml-api-'));const {app}=await createApp({mode:'DEMO',privateDir:temp,dbPath:join(temp,'test.sqlite'),mlRunDir:run});dispose.push(async()=>{await app.close();rmSync(temp,{recursive:true,force:true});});return app;}
describe('API experimental XGBoost de solo lectura',()=>{
  it('expone resumen, métricas filtradas y páginas históricas sin rutas privadas',async()=>{
    const {root,run}=artifacts();dispose.push(async()=>rmSync(root,{recursive:true,force:true}));const app=await appFor(run);
    expect((await app.inject('/api/v1/ml/status')).json().status).toBe('READY');
    const response=await app.inject('/api/v1/ml/summary');const summary=MlSummary.parse(response.json());expect(summary.trees).toBe(2);expect(summary.symbol).toBe('NVDA');
    const metrics=(await app.inject('/api/v1/ml/metrics')).json();expect(metrics.model.macroF1).toBe(1);expect(metrics.walkForward).toHaveLength(1);
    const page=MlPredictionsPage.parse((await app.inject('/api/v1/ml/predictions?offset=1&limit=1')).json());expect(page.items).toHaveLength(1);expect(page.items[0]?.dominantClass).toBe('BAJISTA');expect(page.nextOffset).toBe(2);
    expect((await app.inject('/api/v1/ml/predictions?offset=2&limit=1')).json().nextOffset).toBeNull();
    for(const body of [response.body,JSON.stringify(metrics),JSON.stringify(page)]){expect(body).not.toContain('C:/private');expect(body).not.toContain('dataset_dir');expect(body).not.toContain('report.json');}
    expect(app.printRoutes()).not.toMatch(/\/api\/v1\/ml\/train|\/api\/v1\/ml\/infer/);
  });
  it('expone NO_MODEL cuando falta configuración o directorio',async()=>{
    expect((await (await appFor(null)).inject('/api/v1/ml/status')).json().status).toBe('NO_MODEL');
    expect((await (await appFor(join(tmpdir(),'missing-ml-run'))).inject('/api/v1/ml/summary')).json().status).toBe('NO_MODEL');
  });
  it('rechaza hash, modelo y probabilidades inconsistentes sin exponer artefactos',async()=>{
    for(const mutate of [
      (run:string)=>{const p=join(run,'reproduction.json'),x=JSON.parse(readFileSync(p,'utf8'));x.dataset_metadata.outputCsvSha256=sha('otro');writeFileSync(p,JSON.stringify(x));},
      (run:string)=>{const p=join(run,'model.json'),x=JSON.parse(readFileSync(p,'utf8'));x.learner.learner_model_param.num_class='2';writeFileSync(p,JSON.stringify(x));},
      (run:string)=>{const p=join(run,'exploratory_predictions.csv');writeFileSync(p,readFileSync(p,'utf8').replace('0.7,0.2,0.1','0.9,0.9,0.9'));},
      (run:string)=>{const p=join(run,'report.json'),x=JSON.parse(readFileSync(p,'utf8'));x.walk_forward_folds[0].out_of_sample_predictions=[{bar_start_utc:'2024-01-02T14:30:00.000Z',session_date_ny:'2024-01-02',label:'ALCISTA',prob_standard:[.9,.9,.9],prob_class_weighted:[1,0,0],prob_regularized:[1,0,0],prob_majority:[1,0,0],prob_frequency:[1,0,0]}];writeFileSync(p,JSON.stringify(x));},
    ]){const {root,run}=artifacts();dispose.push(async()=>rmSync(root,{recursive:true,force:true}));mutate(run);const app=await appFor(run);const body=(await app.inject('/api/v1/ml/predictions')).body;expect(JSON.parse(body).status).toBe('INVALID_ARTIFACT');expect(body).not.toContain(root);}
  });
  it('recalcula las métricas y rechaza una métrica o probabilidad alterada',async()=>{
    for(const mutate of [
      (run:string)=>{const p=join(run,'report.json'),x=JSON.parse(readFileSync(p,'utf8'));x.xgboost.macro_f1=.99;writeFileSync(p,JSON.stringify(x));},
      (run:string)=>{const p=join(run,'exploratory_predictions.csv');writeFileSync(p,readFileSync(p,'utf8').replace('0.7,0.2,0.1','0.2,0.7,0.1'));},
    ]){
      const {root,run}=artifacts();dispose.push(async()=>rmSync(root,{recursive:true,force:true}));mutate(run);const app=await appFor(run);
      expect((await app.inject('/api/v1/ml/status')).json()).toMatchObject({status:'INVALID_ARTIFACT'});
    }
  });
  it('limita activo, temporalidad, cantidad y rutas solicitadas',async()=>{
    const {root,run}=artifacts();dispose.push(async()=>rmSync(root,{recursive:true,force:true}));const app=await appFor(run);
    for(const path of ['/api/v1/ml/summary?symbol=QQQ','/api/v1/ml/metrics?timeframe=5m','/api/v1/ml/predictions?symbol=NVDA&timeframe=1h','/api/v1/ml/predictions?limit=101','/api/v1/ml/predictions?file=../../secret'])expect((await app.inject(path)).statusCode).toBe(400);
    expect((await app.inject('/api/v1/ml/reproduction.json')).statusCode).toBe(404);
  });
  it('rechaza timestamps futuros y no convierte DEMO en predicciones sintéticas',async()=>{
    const {root,run}=artifacts();dispose.push(async()=>rmSync(root,{recursive:true,force:true}));
    const path=join(run,'exploratory_predictions.csv');writeFileSync(path,readFileSync(path,'utf8').replace('2025-01-02T14:30:00.000Z','2099-01-02T14:30:00.000Z'));
    const app=await appFor(run);expect((await app.inject('/api/v1/ml/status')).json().status).toBe('INVALID_ARTIFACT');
    const demo=await appFor(null);expect((await demo.inject('/api/v1/ml/predictions')).json()).toMatchObject({status:'NO_MODEL'});
  });
  it('expone seguimiento solo como lectura y no inventa captura prospectiva',async()=>{
    const {root,run}=artifacts();dispose.push(async()=>rmSync(root,{recursive:true,force:true}));const app=await appFor(run);
    expect((await app.inject('/api/v1/ml/prospective?symbol=NVDA&timeframe=15m')).json()).toMatchObject({status:'SOURCE_ABSENT'});
    expect((await app.inject('/api/v1/ml/prospective?symbol=QQQ')).statusCode).toBe(400);
    expect(app.printRoutes()).not.toMatch(/\/api\/v1\/ml\/(capture|infer|order)/);
  });
});
