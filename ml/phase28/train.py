"""Phase 28: local-only, chronological XGBoost research for Phase 23 data."""
from __future__ import annotations
import argparse, csv, hashlib, json, math, os, sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import numpy as np

CLASSES=("ALCISTA","BAJISTA","LATERAL")
CLASS_INDEX={name:index for index,name in enumerate(CLASSES)}
FEATURES=("return_1","return_4","distance_ema9","distance_sma20","bollinger_position","relative_volume_20","candle_range","candle_body","atr14_relative","minutes_from_open")
FORBIDDEN={"label","label_entry_open","label_exit_close","label_change","label_available_at_utc","label_atr14_price_units"}
REQUIRED={"partition","session_date_ny","bar_start_utc","observed_at_utc","available_at_utc","label","label_available_at_utc",*FEATURES,*FORBIDDEN}

def sha(path:Path)->str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def iso(value:str)->datetime:
    try:
        result=datetime.fromisoformat(value.replace("Z","+00:00"))
    except ValueError as error: raise ValueError(f"Timestamp invalido: {value}") from error
    if result.tzinfo is None: raise ValueError(f"Timestamp sin zona: {value}")
    return result.astimezone(timezone.utc)

def load_dataset(directory:Path):
    csv_path,meta_path=directory/'dataset.csv',directory/'metadata.json'
    if not csv_path.is_file() or not meta_path.is_file(): raise ValueError('Faltan dataset.csv o metadata.json.')
    metadata=json.loads(meta_path.read_text(encoding='utf8'))
    if metadata.get('schemaVersion')!='nvda-15m-v1': raise ValueError('Especificacion Fase 23 no compatible.')
    if metadata.get('outputCsvSha256')!=sha(csv_path): raise ValueError('Hash dataset.csv no coincide con metadata.json.')
    sums=directory/'SHA256SUMS'
    if sums.exists():
        declared={line.split(maxsplit=1)[1].strip():line.split(maxsplit=1)[0] for line in sums.read_text(encoding='utf8').splitlines() if len(line.split(maxsplit=1))==2}
        if declared.get('dataset.csv')!=sha(csv_path) or declared.get('metadata.json')!=sha(meta_path): raise ValueError('SHA256SUMS no coincide con los artefactos Fase 23.')
    with csv_path.open(encoding='utf8',newline='') as source: rows=list(csv.DictReader(source))
    if not rows: raise ValueError('Dataset vacio.')
    columns=set(rows[0]); missing=REQUIRED-columns
    if missing: raise ValueError('Columnas requeridas ausentes: '+', '.join(sorted(missing)))
    declared=metadata.get('columns',{})
    for feature in FEATURES:
        if declared.get(feature,{}).get('role')!='feature': raise ValueError(f'{feature} no esta declarado como feature.')
    if any(name in FEATURES for name in FORBIDDEN): raise ValueError('Contrato de columnas inseguro.')
    previous=None; seen=set()
    for row in rows:
        key=row['bar_start_utc']
        timestamp=iso(key); observed=iso(row['observed_at_utc']); available=iso(row['available_at_utc']); label_at=iso(row['label_available_at_utc'])
        if observed < timestamp or available < observed or label_at < available: raise ValueError('Disponibilidad temporal invalida.')
        if key in seen: raise ValueError('Timestamp duplicado.')
        if previous is not None and timestamp<=previous: raise ValueError('Dataset fuera de orden cronologico.')
        previous=timestamp;seen.add(key)
        if row['label'] not in CLASS_INDEX: raise ValueError('Etiqueta invalida.')
        expected='desarrollo' if row['session_date_ny']<'2025-01-01' else 'evaluacion_exploratoria'
        if row['partition']!=expected: raise ValueError('Particion no coincide con la fecha de sesion.')
        for feature in FEATURES:
            try: value=float(row[feature])
            except ValueError as error: raise ValueError(f'Feature no numerica: {feature}') from error
            if not math.isfinite(value): raise ValueError(f'Feature infinita: {feature}')
    return rows,metadata

def arrays(rows):
    return np.array([[float(r[f]) for f in FEATURES] for r in rows],dtype=np.float64),np.array([CLASS_INDEX[r['label']] for r in rows],dtype=np.int64)

def purge_train(train_rows, validation_start):
    """The label horizon stays in-session; remove labels not known before the validation start."""
    start=iso(validation_start)
    return [row for row in train_rows if iso(row['label_available_at_utc']) < start]

def session_folds(rows,folds=3):
    sessions=sorted({r['session_date_ny'] for r in rows if r['partition']=='desarrollo'})
    if len(sessions)<folds+2: raise ValueError('Desarrollo insuficiente para walk-forward.')
    chunks=np.array_split(np.array(sessions,dtype=object),folds+1)[1:]
    result=[]
    for chunk in chunks:
        valid=set(chunk.tolist()); first=min(valid)
        train=[r for r in rows if r['partition']=='desarrollo' and r['session_date_ny']<first]
        validation=[r for r in rows if r['partition']=='desarrollo' and r['session_date_ny'] in valid]
        train=purge_train(train,validation[0]['observed_at_utc'])
        if train and validation: result.append((train,validation))
    return result

def probabilities_majority(y,n):
    counts=np.bincount(y,minlength=3); return np.tile(np.eye(3)[int(np.argmax(counts))],(n,1))
def probabilities_frequency(y,n):
    counts=np.bincount(y,minlength=3).astype(float); return np.tile(counts/counts.sum(),(n,1))
def metrics(y,probabilities):
    predicted=probabilities.argmax(axis=1); accuracy=float((predicted==y).mean())
    recalls=[]; per={}; matrix=np.zeros((3,3),dtype=int)
    for actual,pred in zip(y,predicted): matrix[actual,pred]+=1
    for index,label in enumerate(CLASSES):
        tp=matrix[index,index]; fp=matrix[:,index].sum()-tp; fn=matrix[index,:].sum()-tp
        precision=tp/(tp+fp) if tp+fp else 0.; recall=tp/(tp+fn) if tp+fn else 0.; f1=2*precision*recall/(precision+recall) if precision+recall else 0.
        recalls.append(recall);per[label]={'precision':precision,'recall':recall,'f1':f1,'support':int(matrix[index,:].sum())}
    clipped=np.clip(probabilities,1e-15,1); log_loss=float(-np.log(clipped[np.arange(len(y)),y]).mean()); one=np.eye(3)[y]
    calibration={}
    for index,label in enumerate(CLASSES):
        bins=[]
        for low in np.linspace(0,0.8,5):
            mask=(clipped[:,index]>=low)&(clipped[:,index]<(low+.2 if low<.8 else 1.000001))
            if mask.any(): bins.append({'range':[float(low),float(min(low+.2,1))],'rows':int(mask.sum()),'predicted_mean':float(clipped[mask,index].mean()),'observed_frequency':float((y[mask]==index).mean())})
        calibration[label]=bins
    return {'accuracy':accuracy,'balanced_accuracy':float(np.mean(recalls)),'macro_f1':float(np.mean([v['f1'] for v in per.values()])), 'per_class':per,'confusion_matrix':matrix.tolist(),'log_loss':log_loss,'brier_multiclass':float(np.mean(np.sum((clipped-one)**2,axis=1))),'probability_mean':clipped.mean(axis=0).tolist(),'calibration':calibration,'calibration_warning':'Descriptiva; no usar probabilidades para decisiones operativas sin validacion independiente.'}

def bootstrap_by_session(rows,y,probabilities,iterations=200,seed=7):
    rng=np.random.default_rng(seed); groups={}
    for i,row in enumerate(rows): groups.setdefault(row['session_date_ny'],[]).append(i)
    sessions=list(groups)
    values=[]
    for _ in range(iterations):
        choices=rng.choice(sessions,len(sessions),replace=True); idx=np.concatenate([groups[s] for s in choices])
        values.append(metrics(y[idx],probabilities[idx])['macro_f1'])
    return {'method':'bootstrap por sesiones (no velas independientes)','iterations':iterations,'macro_f1_95pct':[float(np.quantile(values,.025)),float(np.quantile(values,.975))]}

def train_xgb(train,valid,evaluation):
    try: import xgboost as xgb
    except ImportError as error: raise RuntimeError('Falta XGBoost. Cree el entorno virtual e instale ml/phase28/requirements.txt.') from error
    xtr,ytr=arrays(train); xva,yva=arrays(valid); xev,yev=arrays(evaluation)
    grid=({'max_depth':2,'learning_rate':.05,'min_child_weight':8},{'max_depth':3,'learning_rate':.05,'min_child_weight':12})
    candidates=[]
    for params in grid:
        model=xgb.XGBClassifier(objective='multi:softprob',num_class=3,n_estimators=300,subsample=.8,colsample_bytree=.9,reg_lambda=1.,random_state=7,n_jobs=int(os.getenv('TRADING_POC_ML_THREADS','2')),eval_metric='mlogloss',early_stopping_rounds=30,**params)
        model.fit(xtr,ytr,eval_set=[(xva,yva)],verbose=False); candidates.append((metrics(yva,model.predict_proba(xva))['log_loss'],params,model.best_iteration+1))
    _,params,rounds=min(candidates,key=lambda x:x[0]); combined=train+valid; xc,yc=arrays(combined)
    final=xgb.XGBClassifier(objective='multi:softprob',num_class=3,n_estimators=rounds,subsample=.8,colsample_bytree=.9,reg_lambda=1.,random_state=7,n_jobs=int(os.getenv('TRADING_POC_ML_THREADS','2')),eval_metric='mlogloss',**params)
    final.fit(xc,yc,verbose=False); return final,final.predict_proba(xev),{'selected':params,'n_estimators':rounds,'xgboost_version':xgb.__version__}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--dataset',required=True);parser.add_argument('--output');args=parser.parse_args()
    rows,metadata=load_dataset(Path(args.dataset)); development=[r for r in rows if r['partition']=='desarrollo']; evaluation=[r for r in rows if r['partition']=='evaluacion_exploratoria']
    if not development or not evaluation: raise ValueError('Se requieren desarrollo y evaluacion exploratoria.')
    folds=session_folds(rows); train,valid=folds[-1]; _,ye=arrays(evaluation); report={'experimental':True,'warning':'Evaluacion 2025-2026 es retrospectiva exploratoria; no es evidencia independiente ni una estrategia u orden.','features':list(FEATURES),'class_index':CLASS_INDEX,'dataset_sha256':sha(Path(args.dataset)/'dataset.csv'),'rows':len(rows),'sessions':len({r['session_date_ny'] for r in rows}),'class_distribution':dict(Counter(r['label'] for r in rows)),'walk_forward_folds':[{'train_rows':len(a),'validation_rows':len(b),'train_sessions':len({r['session_date_ny'] for r in a}),'validation_sessions':len({r['session_date_ny'] for r in b})} for a,b in folds],'purge':'Se purgan filas de entrenamiento cuya etiqueta no estaba disponible antes del inicio del fold. No se requiere embargo extra: Fase 23 no permite horizontes que crucen sesiones.','baselines':{}}
    # XGBoost is refit with the same development rows (train + validation).
    # Baseline frequencies must use exactly that information as well.
    final_development=train+valid
    for name,fn in [('mayoritaria',probabilities_majority),('frecuencia',probabilities_frequency)]:
        _,yt=arrays(final_development); p=fn(yt,len(evaluation)); report['baselines'][name]=metrics(ye,p);report['baselines'][name]['uncertainty']=bootstrap_by_session(evaluation,ye,p)
    model,probabilities,model_info=train_xgb(train,valid,evaluation); report['xgboost']=metrics(ye,probabilities);report['xgboost']['uncertainty']=bootstrap_by_session(evaluation,ye,probabilities);report['model']=model_info
    root=Path(args.output) if args.output else Path('trading_poc_001_bollinger/output/real/phase28-xgboost')/(datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+report['dataset_sha256'][:12]);root.mkdir(parents=True,exist_ok=False)
    model.save_model(root/'model.json');(root/'report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
    with (root/'exploratory_predictions.csv').open('w',newline='',encoding='utf8') as target:
        out=csv.writer(target);out.writerow(['bar_start_utc','session_date_ny','label','prob_ALCISTA','prob_BAJISTA','prob_LATERAL'])
        for row,p in zip(evaluation,probabilities):out.writerow([row['bar_start_utc'],row['session_date_ny'],row['label'],*p])
    (root/'reproduction.json').write_text(json.dumps({'dataset_metadata':metadata,'dataset_dir':str(Path(args.dataset).resolve()),'python':sys.version,'features':FEATURES,'class_index':CLASS_INDEX},indent=2,default=str)+'\n',encoding='utf8')
    print(json.dumps({'output':str(root),'rows':report['rows'],'exploratory_rows':len(evaluation),'model':model_info},indent=2))
if __name__=='__main__':
    try: main()
    except Exception as error: print(f'Fase 28 fallo controlado: {error}',file=sys.stderr);sys.exit(1)
