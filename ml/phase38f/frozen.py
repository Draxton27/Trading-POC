"""Freeze a separate IEX experiment; read-only inference never fits a model."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import xgboost
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from threadpoolctl import threadpool_limits

from ml.phase28.train import CLASSES, FEATURES, arrays, fit_variant, inner_early_stop, refit_with_trees
from ml.phase38e.replay import load_run
from ml.phase38c.replay import training_before


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def freeze(source, output, cutoff):
    from ml.phase28.train import iso
    if sys.version_info[:2] != (3, 12) or xgboost.__version__ != '2.1.4':
        raise ValueError('Se requieren Python 3.12 y XGBoost 2.1.4.')
    os.environ['TRADING_POC_ML_THREADS'] = '2'
    cutoff_at = iso(cutoff)
    source, output = Path(source).resolve(), Path(output).resolve()
    if output.exists() or output == source or source in output.parents:
        raise ValueError('La salida debe ser una carpeta nueva y separada.')
    observations, manifest = load_run(source)
    delayed = [row for row in observations if row['scenario'] == 'delayed']
    train = training_before(delayed, cutoff, cutoff_at.date().isoformat())
    if len({r['session_date_ny'] for r in train}) < 252 or set(r['label'] for r in train) != set(CLASSES):
        raise ValueError('Historial causal o clases insuficientes antes del corte.')
    core, validation = inner_early_stop(train)
    if set(r['label'] for r in core) != set(CLASSES):
        raise ValueError('Clases ausentes antes de la validación interna.')
    _, selection = fit_variant(core, validation, 'standard')
    model, refit = refit_with_trees(train, 'standard', selection['n_estimators'])
    x, y = arrays(train)
    scaler = StandardScaler()
    with threadpool_limits(limits=2):
        scaled = scaler.fit_transform(x)
        linear = LogisticRegression(C=1.0, max_iter=500, random_state=7)
        linear.fit(scaled, y)
    output.mkdir(parents=True)
    model.save_model(output / 'model.json')
    frequency = np.bincount(y, minlength=3).astype(float)
    frequency /= frequency.sum()
    linear_data = {'mean': scaler.mean_.tolist(), 'scale': scaler.scale_.tolist(),
                   'coefficient': linear.coef_.tolist(), 'intercept': linear.intercept_.tolist(),
                   'classes': linear.classes_.tolist()}
    (output / 'linear.json').write_text(json.dumps(linear_data, indent=2) + '\n', encoding='utf8')
    specification = {'schema': 'phase38f-frozen-v1', 'mode': 'IEX_PROSPECTIVE_EXPERIMENT',
                     'symbol': 'NVDA', 'feed': 'iex', 'adjustment': 'raw', 'timeframe': '15m',
                     'cutoffUtc': cutoff_at.isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
                     'frozenAtUtc': datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
                     'trainingScenario': 'delayed', 'trainingRows': len(train),
                     'latestTrainingLabelAtUtc': max(r['label_available_at_utc'] for r in train),
                     'features': list(FEATURES), 'classes': list(CLASSES),
                     'policy': {'classification': 'argmax', 'abstention': None,
                                'reason': 'No se validó ningún umbral retrospectivo para operación futura.'},
                     'selectedTrees': selection['n_estimators'], 'variant': 'standard', 'seed': 7,
                     'cpuThreads': 2, 'refit': refit,
                     'sourceManifestSha256': sha(source / 'manifest.json'),
                     'sourceObservationsSha256': sha(source / 'observations.json'),
                     'modelSha256': sha(output / 'model.json'), 'linearSha256': sha(output / 'linear.json'),
                     'frequency': frequency.tolist(),
                     'warning': 'Experimental. Las probabilidades no están calibradas ni son recomendaciones.'}
    if iso(specification['latestTrainingLabelAtUtc']) >= cutoff_at:
        raise ValueError('Etiqueta posterior al corte en entrenamiento.')
    (output / 'freeze.json').write_text(json.dumps(specification, indent=2, ensure_ascii=False) + '\n', encoding='utf8')
    (output / 'SHA256SUMS').write_text(''.join(f'{sha(output / name)}  {name}\n'
                                           for name in ('model.json', 'linear.json', 'freeze.json')), encoding='utf8')
    return specification


def predict(directory, features):
    if sys.version_info[:2] != (3, 12) or xgboost.__version__ != '2.1.4':
        raise ValueError('Se requieren Python 3.12 y XGBoost 2.1.4.')
    directory = Path(directory)
    freeze = json.loads((directory / 'freeze.json').read_text(encoding='utf8'))
    if (freeze.get('schema') != 'phase38f-frozen-v1' or freeze.get('features') != list(FEATURES)
            or freeze.get('classes') != list(CLASSES) or freeze.get('feed') != 'iex'
            or freeze.get('adjustment') != 'raw'):
        raise ValueError('Modelo IEX incompatible.')
    for name in ('model.json', 'linear.json'):
        if freeze.get(name.split('.')[0] + 'Sha256') != sha(directory / name):
            raise ValueError('Hash del modelo o baseline alterado.')
    if tuple(features) != FEATURES:
        raise ValueError('Orden de variables incompatible.')
    x = np.array([[features[name] for name in FEATURES]], dtype=float)
    if not np.isfinite(x).all():
        raise ValueError('Variables no finitas.')
    model = xgboost.XGBClassifier()
    model.load_model(directory / 'model.json')
    linear = json.loads((directory / 'linear.json').read_text(encoding='utf8'))
    if linear.get('classes') != [0, 1, 2]:
        raise ValueError('Orden de clases del baseline incompatible.')
    scaled = (x[0] - np.array(linear['mean'])) / np.array(linear['scale'])
    logits = np.array(linear['coefficient']) @ scaled + np.array(linear['intercept'])
    logits -= logits.max()
    linear_prob = np.exp(logits) / np.exp(logits).sum()
    probabilities = {'xgboost': model.predict_proba(x)[0].tolist(),
                     'frequency': freeze['frequency'], 'linear': linear_prob.tolist()}
    for value in probabilities.values():
        if len(value) != 3 or any(not np.isfinite(p) or p < 0 or p > 1 for p in value) or abs(sum(value) - 1) > 1e-6:
            raise ValueError('Probabilidades inválidas.')
    return {'modelSha256': freeze['modelSha256'], 'probabilities': probabilities,
            'dominantClass': CLASSES[int(np.argmax(probabilities['xgboost']))]}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=('freeze', 'predict'))
    parser.add_argument('--source')
    parser.add_argument('--out')
    parser.add_argument('--cutoff')
    parser.add_argument('--model-dir')
    args = parser.parse_args()
    try:
        if args.command == 'freeze':
            result = freeze(args.source, args.out, args.cutoff)
            print(json.dumps({'cutoffUtc': result['cutoffUtc'], 'trainingRows': result['trainingRows'], 'modelSha256': result['modelSha256']}))
        else:
            print(json.dumps(predict(args.model_dir, json.load(sys.stdin)), separators=(',', ':')))
    except Exception as error:
        print(json.dumps({'error': str(error)[:200]}))
        sys.exit(1)
