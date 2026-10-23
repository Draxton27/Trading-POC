"""Historical IEX experiment; all model fits use only earlier resolved sessions."""
from __future__ import annotations
import argparse, csv, hashlib, json, os, sys
from collections import defaultdict
from datetime import timedelta
from pathlib import Path
import numpy as np
import xgboost
from ml.phase28.train import FEATURES, CLASSES, metrics
from ml.phase38b.replay import folds
from ml.phase38c.replay import SCENARIOS, evaluate_scenario, iso

CODE_FILES=('trading_poc_001_bollinger/src/phase23-dataset.ts',
    'trading_poc_001_bollinger/src/phase31-inference.ts',
    'trading_poc_001_bollinger/src/phase38c-replay.ts',
    'trading_poc_001_bollinger/src/phase38e-cli.ts',
    'ml/phase28/train.py','ml/phase38c/replay.py','ml/phase38e/replay.py')

def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def load_run(directory):
    directory=Path(directory)
    manifest=json.loads((directory/'manifest.json').read_text(encoding='utf8'))
    source=manifest.get('source',{})
    if (manifest.get('schema')!='phase38e-v1' or source.get('symbol')!='NVDA' or
        source.get('feed')!='iex' or source.get('adjustment')!='raw' or
        source.get('minuteTimeframe')!='1Min' or source.get('timeframe')!='15m'):
        raise ValueError('Manifiesto IEX incompatible.')
    declared={}
    for line in (directory/'SHA256SUMS').read_text(encoding='utf8').splitlines():
        parts=line.split('  ',1)
        if len(parts)!=2 or parts[1] in declared: raise ValueError('SHA256SUMS inválido.')
        declared[parts[1]]=parts[0]
    if (declared.get('manifest.json')!=sha(directory/'manifest.json') or
        declared.get('observations.json')!=sha(directory/'observations.json') or
        manifest.get('observationsSha256')!=sha(directory/'observations.json')):
        raise ValueError('Hashes de dataset IEX incompatibles.')
    root=Path(__file__).resolve().parents[2]
    code=manifest.get('codeSha256')
    if not isinstance(code,dict) or set(code)!=set(CODE_FILES) or any(code[name]!=sha(root/name) for name in CODE_FILES):
        raise ValueError('Código del experimento distinto del manifiesto.')
    rows=json.loads((directory/'observations.json').read_text(encoding='utf8'))
    if len(rows)!=manifest.get('rows') or len(rows)%2: raise ValueError('Observaciones incompletas.')
    previous=None
    for index,row in enumerate(rows):
        if (row.get('phase')!='38E' or row.get('mode')!='HISTORICAL_REPLAY' or
            row.get('feed')!='iex' or row.get('adjustment')!='raw' or
            row.get('historical_received_at_utc') is not None or
            row.get('scenario')!=SCENARIOS[index%2]):
            raise ValueError('Modo, feed o escenarios IEX incompatibles.')
        if set(row['features'])!=set(FEATURES) or any(not np.isfinite(row['features'][key]) for key in FEATURES):
            raise ValueError('Variables IEX incompatibles.')
        start=iso(row['bar_start_utc']);end=iso(row['bar_end_utc']);available=iso(row['available_at_utc'])
        if (end-start!=timedelta(minutes=15) or
            available-end!=timedelta(minutes=20 if row['scenario']=='delayed' else 0)):
            raise ValueError('Disponibilidad IEX simulada inconsistente.')
        if start.minute%15 or start.second or start.microsecond:
            raise ValueError('Vela IEX desalineada.')
        entry=row['reference_entry_at_utc'];outcome=row['label_available_at_utc']
        if entry is not None and (iso(entry)<=available or iso(entry)-available>timedelta(minutes=15)):
            raise ValueError('Entrada IEX no posterior a la disponibilidad.')
        if row['label'] is not None:
            if (entry is None or outcome is None or iso(outcome)!=iso(entry)+timedelta(minutes=60)
                or row['exclusion'] is not None):
                raise ValueError('Horizonte IEX inválido.')
        elif outcome is not None or row['exclusion'] not in ('MARKET_CLOSE','FUTURE_BARS_MISSING'):
            raise ValueError('Exclusión IEX inválida.')
        if index%2==0:
            if previous is not None and row['bar_start_utc']<=previous: raise ValueError('Tiempo IEX desordenado.')
            previous=row['bar_start_utc']
        elif (row['bar_start_utc']!=rows[index-1]['bar_start_utc'] or
              row['feature_sha256']!=rows[index-1]['feature_sha256']):
            raise ValueError('Escenarios IEX desalineados.')
        if row['label'] is not None and row['label'] not in CLASSES: raise ValueError('Etiqueta IEX inválida.')
    return rows,manifest

def grouping_sensitivity(records,iterations=200,seed=7):
    """Paired resampling of the same predictions at wider calendar group sizes."""
    resolved=[r for r in records if r['label'] is not None]
    y=np.array([CLASSES.index(r['label']) for r in resolved])
    xgb=np.array([r['prob_xgboost'] for r in resolved])
    frequency=np.array([r['prob_frequency'] for r in resolved])
    result={}
    for period in ('week','month'):
        groups=defaultdict(list)
        for index,row in enumerate(resolved):
            date=row['session_date_ny']
            if period=='week':
                from datetime import date as calendar_date
                year,week,_=calendar_date.fromisoformat(date).isocalendar()
                key=f'{year}-W{week:02d}'
            else:key=date[:7]
            groups[key].append(index)
        keys=sorted(groups)
        if len(keys)<2:
            result[period]={'status':'insufficient_groups','groups':len(keys)};continue
        rng=np.random.default_rng(seed);samples=[]
        for _ in range(iterations):
            index=np.concatenate([groups[key] for key in rng.choice(keys,len(keys),replace=True)])
            samples.append(metrics(y[index],xgb[index])['macro_f1']-metrics(y[index],frequency[index])['macro_f1'])
        result[period]={'status':'ok','groups':len(keys),'iterations':iterations,'seed':seed,
            'xgboost_minus_frequency_macro_f1_95pct':[float(np.quantile(samples,.025)),float(np.quantile(samples,.975))]}
    return result

def run(directory,minimum_train_sessions=252,test_sessions=126):
    if sys.version_info[:2]!=(3,12) or xgboost.__version__!='2.1.4':
        raise ValueError('Se requieren Python 3.12 y XGBoost 2.1.4.')
    os.environ['TRADING_POC_ML_THREADS']='2';directory=Path(directory)
    rows,manifest=load_run(directory)
    if any((directory/name).exists() for name in ('report.json','predictions.csv')) or list(directory.glob('model-*.json')):
        raise ValueError('Experimento IEX ya evaluado; preparar una carpeta privada nueva.')
    for scenario in SCENARIOS:
        if not list(folds([row for row in rows if row['scenario']==scenario],minimum_train_sessions,test_sessions)):
            raise ValueError('Sesiones insuficientes para los folds predefinidos.')
    predictions=[];scenarios={}
    for scenario in SCENARIOS:
        output,report=evaluate_scenario(rows,scenario,directory,minimum_train_sessions,test_sessions)
        for record in output:record['phase']='38E';record['feed']='iex';record['adjustment']='raw'
        report['weekly_monthly_sensitivity']=grouping_sensitivity(output)
        predictions.extend(output);scenarios[scenario]=report
    result={'schema':'phase38e-report-v1','warning':'IEX REST histórico. Disponibilidad simulada; no hay recepción histórica ni evidencia prospectiva independiente.',
        'source_sha256':manifest['source']['sha256'],'code_sha256':manifest['codeSha256'],
        'runtime':{'python':sys.version.split()[0],'numpy':np.__version__,'xgboost':xgboost.__version__},
        'seed':7,'cpu_threads':2,'fold_policy':{'minimum_train_sessions':minimum_train_sessions,'test_sessions':test_sessions,
            'hyperparameters':'Fijos de Fase 38C; early stopping solo en bloque interno anterior al fold externo.',
            'purge':'Toda etiqueta de entrenamiento se conoce antes del primer instante del fold externo.'},
        'features':list(FEATURES),'classes':list(CLASSES),
        'probability_comparators':['xgboost','frequency','linear'],
        'deterministic_classifiers':['majority','momentum'],
        'limitations':['Bootstrap por sesión, semana o mes no captura necesariamente cambios de régimen prolongados.',
                       'IEX raw no se compara directamente con SIP split.',
                       'Las probabilidades no están validadas para decisiones operativas.'],
        'scenarios':scenarios,'prediction_rows':len(predictions)}
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
    parser=argparse.ArgumentParser();parser.add_argument('--run',required=True);args=parser.parse_args()
    report=run(args.run)
    print(json.dumps({'rows':report['prediction_rows'],
        'folds':{name:len(item['folds']) for name,item in report['scenarios'].items()}}))
