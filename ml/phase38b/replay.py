"""Causal historical replay. Never writes to the frozen Phase 29 run."""
from __future__ import annotations
import argparse, csv, hashlib, json, os, sys
from datetime import timedelta
from pathlib import Path
import numpy as np
import xgboost
from ml.phase28.train import (FEATURES,CLASSES,arrays,fit_variant,refit_with_trees,
    inner_early_stop,metrics,paired_bootstrap,probabilities_frequency,probabilities_majority,iso)

def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def load_run(path):
    path=Path(path);manifest=json.loads((path/'manifest.json').read_text(encoding='utf8'))
    if manifest.get('schema')!='phase38b-v1' or manifest.get('source',{}).get('feed')!='sip' or manifest['source'].get('symbol')!='NVDA': raise ValueError('Manifiesto de replay incompatible.')
    if sha(path/'observations.json')!=manifest['observationsSha256']: raise ValueError('Hash de observaciones incorrecto.')
    rows=json.loads((path/'observations.json').read_text(encoding='utf8'))
    if len(rows)!=manifest['rows']: raise ValueError('Conteo de observaciones incorrecto.')
    previous=None
    for row in rows:
        if row['mode']!='HISTORICAL_REPLAY' or row['historical_received_at_utc'] is not None: raise ValueError('Modo o recepción histórica inválida.')
        bar=iso(row['bar_start_utc']);end=iso(row['bar_end_utc']);ideal=iso(row['ideal_available_at_utc']);delayed=iso(row['delayed_available_at_utc'])
        if (previous is not None and bar<=previous) or end!=ideal or end-bar!=timedelta(minutes=15) or delayed-ideal!=timedelta(minutes=20) or iso(row['next_entry_at_utc'])!=end: raise ValueError('Orden o reloj simulado inválido.')
        if bar.minute%15 or bar.second or bar.microsecond: raise ValueError('Vela sin alineación de 15 minutos.')
        if set(row['features'])!=set(FEATURES) or any(not np.isfinite(float(row['features'][feature])) for feature in FEATURES): raise ValueError('Variables incompatibles.')
        if row['label'] is not None and (row['label'] not in CLASSES or iso(row['label_available_at_utc'])!=bar+timedelta(minutes=75) or row['exclusion'] is not None): raise ValueError('Etiqueta inválida.')
        if row['label'] is None and (row['label_available_at_utc'] is not None or row['exclusion'] not in ('HORIZON_OUTSIDE_SESSION','OUTCOME_BARS_MISSING')): raise ValueError('Exclusión inválida.')
        previous=bar
    return rows,manifest

def visible(row,clock,scenario):
    """Reveal features and targets independently; target is unavailable until t+4 closes."""
    at=iso(clock);available=iso(row[f'{scenario}_available_at_utc'])
    if at<available: return None,None
    target=row['label'] if row['label_available_at_utc'] and iso(row['label_available_at_utc'])<=at else None
    return row['features'],target

def training_before(rows,cutoff,first_test_day):
    return [dict(row['features'],session_date_ny=row['session_date_ny'],bar_start_utc=row['bar_start_utc'],
        observed_at_utc=row['ideal_available_at_utc'],label=row['label'],label_available_at_utc=row['label_available_at_utc'])
        for row in rows if row['label'] is not None and row['session_date_ny']<first_test_day and iso(row['label_available_at_utc'])<iso(cutoff)]

def folds(rows,minimum_train_sessions=252,test_sessions=252):
    """Fixed observed-session cadence; never select a session using future completeness."""
    sessions=sorted({row['session_date_ny'] for row in rows})
    if len(sessions)<minimum_train_sessions+1: raise ValueError('Sesiones insuficientes para walk-forward.')
    for number,start in enumerate(range(minimum_train_sessions,len(sessions),test_sessions),1):
        days=set(sessions[start:start+test_sessions]);test=[row for row in rows if row['session_date_ny'] in days]
        yield number,test

def evaluate(rows,predictions):
    usable=[index for index,row in enumerate(rows) if row['label'] is not None]
    if not usable:return {'status':'NO_RESOLVED_OUTCOMES','rows':0}
    y=np.array([CLASSES.index(rows[index]['label']) for index in usable]);p=np.asarray(predictions)[usable]
    scored=[rows[index] for index in usable];result=metrics(y,p);result['rows']=len(usable)
    result['uncertainty']=paired_bootstrap(scored,y,p,probabilities_frequency(y,len(y)),iterations=200) if len({row['session_date_ny'] for row in scored})>=2 else {'status':'insufficient_sessions'}
    return result

def run(directory,minimum_train_sessions=252,test_sessions=252):
    if sys.version_info[:2]!=(3,12) or xgboost.__version__!='2.1.4': raise ValueError('Se requiere Python 3.12 y XGBoost 2.1.4 para reproducir el experimento.')
    os.environ['TRADING_POC_ML_THREADS']='2'
    rows,manifest=load_run(directory);directory=Path(directory)
    if not rows: raise ValueError('No hay observaciones para replay.')
    if any((directory/name).exists() for name in ('report.json','predictions.csv')) or list(directory.glob('model-fold-*.json')): raise ValueError('El replay ya fue evaluado; cree un directorio nuevo para conservar los artefactos.')
    records=[];fold_reports=[];model_hashes=[]
    for number,test in folds(rows,minimum_train_sessions,test_sessions):
        cutoff=min(row['ideal_available_at_utc'] for row in test);first_day=min(row['session_date_ny'] for row in test);train=training_before(rows,cutoff,first_day)
        if len({row['session_date_ny'] for row in train})<3: raise ValueError('Entrenamiento causal insuficiente.')
        core,early=inner_early_stop(train)
        if set(row['label'] for row in train)!=set(CLASSES) or set(row['label'] for row in core)!=set(CLASSES): raise ValueError('Clases insuficientes para XGBoost en el entrenamiento causal.')
        _,selection=fit_variant(core,early,'standard');model,info=refit_with_trees(train,'standard',selection['n_estimators'])
        model_path=directory/f'model-fold-{number}.json';model.save_model(model_path);model_sha=sha(model_path);model_hashes.append(model_sha)
        counts=arrays(train)[1]
        majority=probabilities_majority(counts,1)[0].tolist()
        frequency=probabilities_frequency(counts,1)[0].tolist()
        variants={}
        for scenario in ('ideal','delayed'):
            released=[]
            for index,row in enumerate(test):
                features,_=visible(row,row[f'{scenario}_available_at_utc'],scenario)
                if features is None: raise AssertionError('Feature aún no disponible.')
                # Only this observation's released features are passed to the model.
                x=np.array([[float(features[f]) for f in FEATURES]],dtype=np.float64)
                probabilities={'xgboost':model.predict_proba(x)[0].tolist(),'majority':majority,'frequency':frequency}
                if any(len(value)!=3 or any(not np.isfinite(p) or p<0 or p>1 for p in value) or abs(sum(value)-1)>1e-6 for value in probabilities.values()): raise ValueError('Probabilidades inválidas en replay.')
                released.append(probabilities)
                # Outcomes are attached for later scoring; they never enter inference.
                records.append({'mode':'HISTORICAL_REPLAY','scenario':scenario,'fold':number,'model_sha256':model_sha,'bar_start_utc':row['bar_start_utc'],'session_date_ny':row['session_date_ny'],'inference_at_utc':row[f'{scenario}_available_at_utc'],'features':features,'feature_sha256':row['feature_sha256'],'historical_received_at_utc':None,'next_entry_at_utc':row['next_entry_at_utc'],'before_next_entry':iso(row[f'{scenario}_available_at_utc'])<=iso(row['next_entry_at_utc']),'label':row['label'],'label_available_at_utc':row['label_available_at_utc'],'exclusion':row['exclusion'],**{f'prob_{name}':value for name,value in probabilities.items()}})
            variants[scenario]={name:np.array([item[name] for item in released]) for name in ('xgboost','majority','frequency')}
        variant=variants['ideal']
        resolved=[i for i,row in enumerate(test) if row['label'] is not None]
        if not resolved: continue
        y=np.array([CLASSES.index(test[i]['label']) for i in resolved]);scored=[test[i] for i in resolved]
        scores={name:metrics(y,p[resolved]) for name,p in variant.items()}
        scores['paired_vs_frequency']=paired_bootstrap(scored,y,variant['xgboost'][resolved],variant['frequency'][resolved],iterations=200)
        by_session={day:{name:metrics(np.array([CLASSES.index(test[i]['label']) for i in resolved if test[i]['session_date_ny']==day]),p[[i for i in resolved if test[i]['session_date_ny']==day]]) for name,p in variant.items()} for day in sorted({row['session_date_ny'] for row in scored})}
        fold_reports.append({'fold':number,'train_rows':len(train),'train_sessions':len({row['session_date_ny'] for row in train}),'max_train_label_available_at_utc':max(row['label_available_at_utc'] for row in train),'cutoff_utc':cutoff,'test_rows':len(test),'resolved_rows':len(resolved),'selection_rows':len(core),'early_stop_rows':len(early),'selected_trees':selection['n_estimators'],'model':info,'model_sha256':model_sha,'metrics':scores,'by_session':by_session})
    # Both timing scenarios use the same observations and frozen fold model, with distinct availability clocks.
    pooled=[record for record in records if record['scenario']=='ideal' and record['label'] is not None]
    if not pooled: raise ValueError('No existen desenlaces evaluables.')
    pooled_y=np.array([CLASSES.index(record['label']) for record in pooled])
    pooled_prob={name:np.array([record[f'prob_{name}'] for record in pooled]) for name in ('xgboost','majority','frequency')}
    pooled_metrics={name:metrics(pooled_y,prob) for name,prob in pooled_prob.items()}
    pooled_metrics['paired_xgboost_vs_frequency']=paired_bootstrap(pooled,pooled_y,pooled_prob['xgboost'],pooled_prob['frequency'],iterations=400)
    pooled_metrics['paired_xgboost_vs_majority']=paired_bootstrap(pooled,pooled_y,pooled_prob['xgboost'],pooled_prob['majority'],iterations=400)
    report={'schema':'phase38b-report-v1','warning':'Replay retrospectivo previamente examinado; no evidencia prospectiva ni precio ejecutable.','source_sha256':manifest['source']['sha256'],'code_sha256':manifest.get('codeSha256'),'runtime':{'python':sys.version.split()[0],'numpy':np.__version__,'xgboost':xgboost.__version__},'fold_policy':{'minimum_train_sessions':minimum_train_sessions,'test_sessions':test_sessions,'basis':'observed sessions; independent of later completeness'},'features':list(FEATURES),'classes':list(CLASSES),'scenarios':{'ideal':'cierre de t','delayed':'cierre de t + 20 minutos; no es recepción verificada'},'folds':fold_reports,'pooled':{'rows':len(pooled),'metrics':pooled_metrics},'predictions':len(records),'excluded_outcomes':sum(record['label'] is None for record in records)//2,'model_hashes':model_hashes}
    pred=directory/'predictions.csv'
    with pred.open('x',newline='',encoding='utf8') as target:
        writer=csv.DictWriter(target,fieldnames=list(records[0]));writer.writeheader()
        for record in records:writer.writerow({key:json.dumps(value,separators=(',',':')) if isinstance(value,(list,dict)) else value for key,value in record.items()})
    (directory/'report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
    with (directory/'SHA256SUMS').open('a',encoding='utf8') as sums:
        for name in [*(f'model-fold-{number}.json' for number in range(1,len(model_hashes)+1)),'predictions.csv','report.json']:sums.write(f'{sha(directory/name)}  {name}\n')
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--run',required=True);args=parser.parse_args()
    report=run(args.run);print(json.dumps({'folds':len(report['folds']),'predictions':report['predictions'],'excluded_outcomes':report['excluded_outcomes']}))
