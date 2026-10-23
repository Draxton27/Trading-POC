"""Fase 38C: labels, training and evaluation strictly after simulated availability."""
from __future__ import annotations
import argparse, csv, hashlib, json, os, sys
from collections import Counter
from datetime import timedelta
from pathlib import Path
import numpy as np
import xgboost
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from threadpoolctl import threadpool_limits
from ml.phase28.train import (FEATURES, CLASSES, arrays, fit_variant, inner_early_stop,
    metrics, probabilities_frequency, probabilities_majority,
    refit_with_trees, iso)
from ml.phase38b.replay import folds

SCENARIOS=('ideal','delayed')
INFERENCE_FIELDS=('scenario','session_date_ny','bar_start_utc','available_at_utc',
    'reference_entry_at_utc','minutes_until_reference_entry','features','feature_sha256')
CODE_FILES=('trading_poc_001_bollinger/src/phase23-dataset.ts',
    'trading_poc_001_bollinger/src/phase31-inference.ts',
    'trading_poc_001_bollinger/src/phase38c-replay.ts',
    'ml/phase28/train.py','ml/phase38c/replay.py')

def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def load_run(directory):
    directory=Path(directory)
    manifest=json.loads((directory/'manifest.json').read_text(encoding='utf8'))
    source=manifest.get('source',{})
    if manifest.get('schema')!='phase38c-v1' or source.get('symbol')!='NVDA' or source.get('feed')!='sip' or source.get('adjustment')!='split' or source.get('timeframe')!='15m':
        raise ValueError('Manifiesto Fase 38C incompatible.')
    declared={}
    for line in (directory/'SHA256SUMS').read_text(encoding='utf8').splitlines():
        parts=line.split('  ',1)
        if len(parts)!=2 or parts[1] in declared: raise ValueError('SHA256SUMS inválido.')
        declared[parts[1]]=parts[0]
    if any(declared.get(name)!=sha(directory/name) for name in ('observations.json','manifest.json')) or sha(directory/'observations.json')!=manifest.get('observationsSha256'):
        raise ValueError('Hash del replay incompatible.')
    root=Path(__file__).resolve().parents[2]
    code=manifest.get('codeSha256')
    if not isinstance(code,dict) or set(code)!=set(CODE_FILES) or any(code[name]!=sha(root/name) for name in CODE_FILES):
        raise ValueError('Código de Fase 38C distinto del manifiesto.')
    rows=json.loads((directory/'observations.json').read_text(encoding='utf8'))
    if not isinstance(rows,list) or len(rows)!=manifest.get('rows') or len(rows)%2: raise ValueError('Observaciones incompletas.')
    previous=None
    for index,row in enumerate(rows):
        if row['mode']!='HISTORICAL_REPLAY' or row['phase']!='38C' or row['symbol']!='NVDA' or row['timeframe']!='15m' or row['historical_received_at_utc'] is not None:
            raise ValueError('Modo o procedencia de observación inválida.')
        if row['scenario']!=SCENARIOS[index%2]: raise ValueError('Orden de escenarios inválido.')
        start=iso(row['bar_start_utc']);end=iso(row['bar_end_utc']);available=iso(row['available_at_utc'])
        if end-start!=timedelta(minutes=15) or available-end!=timedelta(minutes=20 if row['scenario']=='delayed' else 0):
            raise ValueError('Reloj simulado inválido.')
        if start.minute%15 or start.second or start.microsecond: raise ValueError('Vela no alineada.')
        # US regular-session bars always retain their NY calendar date in UTC;
        # the official open/close and DST were already checked by the TS preparer.
        if row['session_date_ny']!=start.date().isoformat(): raise ValueError('Sesión NY inválida.')
        if index%2==0:
            if previous is not None and start<=previous: raise ValueError('Observaciones fuera de orden.')
            previous=start
        elif (row['bar_start_utc']!=rows[index-1]['bar_start_utc'] or
              row['features']!=rows[index-1]['features'] or
              row['feature_sha256']!=rows[index-1]['feature_sha256']):
            raise ValueError('Variables de escenarios desalineadas.')
        if set(row['features'])!=set(FEATURES) or any(not np.isfinite(float(row['features'][name])) for name in FEATURES): raise ValueError('Variables incompatibles.')
        entry_at=row['reference_entry_at_utc'];exit_at=row['label_available_at_utc'];label=row['label']
        if entry_at is not None:
            entry=iso(entry_at)
            if entry<=available or entry-available>timedelta(minutes=15) or entry.minute%15 or entry.date().isoformat()!=row['session_date_ny']:
                raise ValueError('Entrada de referencia no posterior a la decisión.')
            if row['minutes_until_reference_entry']!=(entry-available).total_seconds()/60: raise ValueError('Espera de entrada inválida.')
        elif row['minutes_until_reference_entry'] is not None: raise ValueError('Entrada ausente con espera declarada.')
        if label is not None:
            if entry_at is None or label not in CLASSES or row['exclusion'] is not None or iso(exit_at)!=iso(entry_at)+timedelta(minutes=60):
                raise ValueError('Horizonte o etiqueta inválidos.')
            price_in=row['label_entry_open'];price_out=row['label_exit_close'];atr=row['label_atr14_price_units']
            if any(not np.isfinite(float(value)) or float(value)<=0 for value in (price_in,price_out,atr)):
                raise ValueError('Precios o ATR inválidos.')
            change=price_out-price_in
            expected='ALCISTA' if change>.5*atr else 'BAJISTA' if change<-.5*atr else 'LATERAL'
            if label!=expected: raise ValueError('Etiqueta incompatible con el movimiento.')
        elif exit_at is not None or row['label_entry_open'] is not None or row['label_exit_close'] is not None or row['exclusion'] not in ('MARKET_CLOSE','FUTURE_BARS_MISSING'):
            raise ValueError('Exclusión o desenlace inválido.')
    return rows,manifest

def inference_events(rows):
    """The predictor cannot receive outcomes, prices, exclusions or future label times."""
    return [{key:row[key] for key in INFERENCE_FIELDS} for row in rows]

def visible_features(event,clock):
    return event['features'] if iso(clock)>=iso(event['available_at_utc']) else None

def training_before(rows,cutoff,first_test_day):
    return [dict(row['features'],session_date_ny=row['session_date_ny'],
        bar_start_utc=row['bar_start_utc'],observed_at_utc=row['available_at_utc'],
        label=row['label'],label_available_at_utc=row['label_available_at_utc'])
        for row in rows if row['label'] is not None and row['session_date_ny']<first_test_day
        and iso(row['label_available_at_utc'])<iso(cutoff)]

def momentum_probabilities(events):
    """Prespecified sign of causal return_1; no fitted threshold or future prices."""
    return np.array([np.eye(3)[0 if row['features']['return_1']>0 else 1 if row['features']['return_1']<0 else 2]
                     for row in events],dtype=float)

def fast_scores(y,probabilities):
    prediction=probabilities.argmax(axis=1)
    matrix=np.bincount(y*3+prediction,minlength=9).reshape(3,3)
    support=matrix.sum(axis=1);chosen=matrix.sum(axis=0);tp=np.diag(matrix)
    recall=np.divide(tp,support,out=np.zeros(3),where=support>0)
    precision=np.divide(tp,chosen,out=np.zeros(3),where=chosen>0)
    f1=np.divide(2*precision*recall,precision+recall,out=np.zeros(3),where=precision+recall>0)
    clipped=np.clip(probabilities,1e-15,1.)
    values={'accuracy':float((prediction==y).mean()),'balanced_accuracy':float(recall.mean()),
        'macro_f1':float(f1.mean()),'log_loss':float(-np.log(clipped[np.arange(len(y)),y]).mean()),
        'brier_multiclass':float(np.mean(np.sum((clipped-np.eye(3)[y])**2,axis=1)))}
    for index,label in enumerate(CLASSES):
        values[f'{label}_precision']=float(precision[index]);values[f'{label}_recall']=float(recall[index])
    return values

def report_scores(y,probabilities,name):
    """Keep hard-class scores for every estimator; score probability quality only for estimators that estimate probabilities."""
    values=metrics(y,probabilities)
    if name in ('momentum','majority'):
        for key in ('log_loss','brier_multiclass','probability_mean','calibration'):
            values[key]=None
        values['probability_metrics_status']='not_comparable_deterministic_classifier'
    else:
        values['probability_metrics_status']='reported_for_probabilistic_estimator'
    return values

def bootstrap(rows,y,predictions,comparators,iterations=250,seed=7):
    groups={}
    for index,row in enumerate(rows):groups.setdefault(row['session_date_ny'],[]).append(index)
    days=sorted(groups)
    if len(days)<2:return {'status':'insufficient_sessions','sessions':len(days)}
    rng=np.random.default_rng(seed)
    keys=tuple(fast_scores(y,predictions).keys())
    classification_keys=tuple(key for key in keys if key not in ('log_loss','brier_multiclass'))
    absolute={key:[] for key in keys};differences={name:{key:[] for key in keys} for name in comparators}
    for _ in range(iterations):
        selected=np.concatenate([groups[day] for day in rng.choice(days,len(days),replace=True)])
        left=fast_scores(y[selected],predictions[selected])
        for key in keys:absolute[key].append(left[key])
        for name,probabilities in comparators.items():
            right=fast_scores(y[selected],probabilities[selected])
            comparable=keys if name in ('frequency','linear') else classification_keys
            for key in comparable:differences[name][key].append(left[key]-right[key])
    interval=lambda numbers:[float(np.quantile(numbers,.025)),float(np.quantile(numbers,.975))]
    return {'status':'ok','method':'bootstrap pareado por sesiones completas','sessions':len(days),
        'iterations':iterations,'seed':seed,'xgboost_interval_95pct':{key:interval(values) for key,values in absolute.items()},
        'xgboost_minus_baseline_95pct':{name:{key:(interval(values) if values else None) for key,values in comparison.items()}
            for name,comparison in differences.items()}}

def evaluate_scenario(rows,scenario,directory,minimum_train_sessions,test_sessions):
    selected=[row for row in rows if row['scenario']==scenario]
    predictions=[];fold_reports=[];models=[]
    for number,test in folds(selected,minimum_train_sessions,test_sessions):
        cutoff=min(row['available_at_utc'] for row in test);first_day=min(row['session_date_ny'] for row in test)
        train=training_before(selected,cutoff,first_day)
        if len({row['session_date_ny'] for row in train})<3 or set(row['label'] for row in train)!=set(CLASSES):
            raise ValueError(f'Entrenamiento causal insuficiente en {scenario}, fold {number}.')
        core,early=inner_early_stop(train)
        if set(row['label'] for row in core)!=set(CLASSES): raise ValueError('Clases ausentes en el bloque interno.')
        _,selection=fit_variant(core,early,'standard')
        model,training=refit_with_trees(train,'standard',selection['n_estimators'])
        model_name=f'model-{scenario}-fold-{number}.json';model.save_model(directory/model_name)
        model_hash=sha(directory/model_name);models.append({'file':model_name,'sha256':model_hash,'fold':number})
        linear=make_pipeline(StandardScaler(),LogisticRegression(C=1.0,max_iter=500,random_state=7))
        xtrain,ytrain=arrays(train)
        with threadpool_limits(limits=2):linear.fit(xtrain,ytrain)
        majority=probabilities_majority(ytrain,1)[0].tolist()
        frequency=probabilities_frequency(ytrain,1)[0].tolist()
        events=inference_events(test);fold_predictions=[]
        for event in events:
            features=visible_features(event,event['available_at_utc'])
            if features is None: raise AssertionError('Variables aún no liberadas.')
            x=np.array([[float(features[name]) for name in FEATURES]],dtype=np.float64)
            linear_prob=linear.predict_proba(x)[0].tolist()
            probabilities={'xgboost':model.predict_proba(x)[0].tolist(),'majority':majority,
                'frequency':frequency,'momentum':momentum_probabilities([event])[0].tolist(),'linear':linear_prob}
            if any(len(p)!=3 or any(not np.isfinite(v) or v<0 or v>1 for v in p) or abs(sum(p)-1)>1e-6 for p in probabilities.values()):
                raise ValueError('Probabilidades inválidas.')
            fold_predictions.append({'mode':'HISTORICAL_REPLAY','phase':'38C','scenario':scenario,'fold':number,
                'model_sha256':model_hash,'bar_start_utc':event['bar_start_utc'],
                'session_date_ny':event['session_date_ny'],'inference_at_utc':event['available_at_utc'],
                'reference_entry_at_utc':event['reference_entry_at_utc'],
                'minutes_until_reference_entry':event['minutes_until_reference_entry'],
                'features':features,'feature_sha256':event['feature_sha256'],'historical_received_at_utc':None,
                **{f'prob_{name}':p for name,p in probabilities.items()}})
        outcomes={row['bar_start_utc']:row for row in test}
        for record in fold_predictions:
            target=outcomes[record['bar_start_utc']]
            record.update(label=target['label'],label_available_at_utc=target['label_available_at_utc'],
                label_entry_open=target['label_entry_open'],label_exit_close=target['label_exit_close'],
                exclusion=target['exclusion'])
        predictions.extend(fold_predictions)
        resolved=[record for record in fold_predictions if record['label'] is not None]
        if not resolved:fold_reports.append({'fold':number,'status':'NO_EVALUABLE_OUTCOMES'});continue
        y=np.array([CLASSES.index(record['label']) for record in resolved])
        variants={name:np.array([record[f'prob_{name}'] for record in resolved])
                  for name in ('xgboost','majority','frequency','momentum','linear')}
        by_session={day:{name:metrics(y[[i for i,row in enumerate(resolved) if row['session_date_ny']==day]],
            values[[i for i,row in enumerate(resolved) if row['session_date_ny']==day]])
            for name,values in variants.items()} for day in sorted({row['session_date_ny'] for row in resolved})}
        fold_reports.append({'fold':number,'test_sessions':len({row['session_date_ny'] for row in test}),
            'first_test_session':first_day,'last_test_session':max(row['session_date_ny'] for row in test),
            'cutoff_utc':cutoff,'training_rows':len(train),'max_training_label_available_at_utc':max(row['label_available_at_utc'] for row in train),
            'early_stop_rows':len(early),'selection_rows':len(core),'selected_trees':selection['n_estimators'],
            'model':training,'model_sha256':model_hash,'test_rows':len(test),'resolved_rows':len(resolved),
            'metrics':{name:report_scores(y,values,name) for name,values in variants.items()},
            'uncertainty':bootstrap(resolved,y,variants['xgboost'],
                {name:values for name,values in variants.items() if name!='xgboost'},iterations=150),
            'by_session':by_session})
    resolved=[row for row in predictions if row['label'] is not None]
    if not resolved:raise ValueError(f'Sin desenlaces evaluables en {scenario}.')
    y=np.array([CLASSES.index(row['label']) for row in resolved]);names=('xgboost','majority','frequency','momentum','linear')
    variants={name:np.array([row[f'prob_{name}'] for row in resolved]) for name in names}
    pooled={name:report_scores(y,p,name) for name,p in variants.items()}
    pooled['uncertainty']=bootstrap(resolved,y,variants['xgboost'],{name:p for name,p in variants.items() if name!='xgboost'})
    exclusions=dict(Counter(row['exclusion'] or 'NONE' for row in predictions))
    entries=[row['minutes_until_reference_entry'] for row in predictions if row['reference_entry_at_utc'] is not None]
    return predictions,{'scenario':scenario,'folds':fold_reports,'pooled':{'rows':len(resolved),'metrics':pooled},
        'observations':len(predictions),'exclusions':exclusions,
        'reference_entry_future_pct':100*len(entries)/len(predictions),
        'minutes_until_reference_entry':{'min':min(entries) if entries else None,
            'max':max(entries) if entries else None,'mean':float(np.mean(entries)) if entries else None},
        'class_distribution':dict(Counter(row['label'] for row in resolved)),'models':models}

def run(directory,minimum_train_sessions=252,test_sessions=252):
    if sys.version_info[:2]!=(3,12) or xgboost.__version__!='2.1.4':
        raise ValueError('Se requieren Python 3.12 y XGBoost 2.1.4.')
    os.environ['TRADING_POC_ML_THREADS']='2';directory=Path(directory)
    rows,manifest=load_run(directory)
    if any((directory/name).exists() for name in ('report.json','predictions.csv')) or list(directory.glob('model-*-fold-*.json')):
        raise ValueError('Fase 38C ya evaluada; prepare un directorio privado nuevo.')
    predictions=[];scenarios={}
    for scenario in SCENARIOS:
        output,report=evaluate_scenario(rows,scenario,directory,minimum_train_sessions,test_sessions)
        predictions.extend(output);scenarios[scenario]=report
    result={'schema':'phase38c-report-v1','warning':'Replay retrospectivo; disponibilidad simulada, no recepción ni ejecución verificadas.',
        'source_sha256':manifest['source']['sha256'],'code_sha256':manifest['codeSha256'],
        'runtime':{'python':sys.version.split()[0],'numpy':np.__version__,'xgboost':xgboost.__version__},
        'fold_policy':{'minimum_train_sessions':minimum_train_sessions,'test_sessions':test_sessions},
        'features':list(FEATURES),'classes':list(CLASSES),'baseline_rules':{
            'majority':'Clase más frecuente en las mismas filas causales de entrenamiento.',
            'frequency':'Frecuencias de clases en las mismas filas causales de entrenamiento.',
            'momentum':'Signo de return_1 en t, sin ajuste de umbral.',
            'linear':'Regresión logística multinomial C=1 con escalado ajustado solo al entrenamiento.'},
        'phase38b_reference':manifest.get('phase38bReference'),'scenarios':scenarios,'prediction_rows':len(predictions)}
    with (directory/'predictions.csv').open('x',newline='',encoding='utf8') as target:
        writer=csv.DictWriter(target,fieldnames=list(predictions[0]));writer.writeheader()
        for record in predictions:
            writer.writerow({key:json.dumps(value,separators=(',',':')) if isinstance(value,(dict,list)) else value
                for key,value in record.items()})
    (directory/'report.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf8')
    with (directory/'SHA256SUMS').open('a',encoding='utf8') as target:
        for name in [*(entry['file'] for scenario in SCENARIOS for entry in scenarios[scenario]['models']),
                     'predictions.csv','report.json']:
            target.write(f'{sha(directory/name)}  {name}\n')
    return result

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--run',required=True);arguments=parser.parse_args()
    result=run(arguments.run)
    print(json.dumps({'prediction_rows':result['prediction_rows'],
        'scenarios':{name:{'folds':len(item['folds']),'resolved':item['pooled']['rows']}
            for name,item in result['scenarios'].items()}}))
