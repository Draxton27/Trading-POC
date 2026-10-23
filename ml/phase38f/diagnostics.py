"""Read-only probability diagnostics for the frozen Phase 38E replay."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import defaultdict
from pathlib import Path

import numpy as np
from sklearn.metrics import average_precision_score, roc_auc_score

from ml.phase28.train import CLASSES

THRESHOLDS = (0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load_predictions(run):
    run = Path(run)
    declared = {}
    for line in (run / 'SHA256SUMS').read_text(encoding='utf8').splitlines():
        pieces = line.split('  ', 1)
        if len(pieces) != 2 or pieces[1] in declared:
            raise ValueError('Manifiesto SHA256SUMS inválido.')
        declared[pieces[1]] = pieces[0]
    for name in ('report.json', 'predictions.csv'):
        if declared.get(name) != digest(run / name):
            raise ValueError(f'Integridad IEX inválida: {name}.')
    source = json.loads((run / 'report.json').read_text(encoding='utf8'))
    if source.get('schema') != 'phase38e-report-v1' or source.get('classes') != list(CLASSES):
        raise ValueError('Experimento de origen incompatible.')
    with (run / 'predictions.csv').open(encoding='utf8', newline='') as handle:
        rows = list(csv.DictReader(handle))
    if len(rows) != source['prediction_rows']:
        raise ValueError('Conteo de predicciones inconsistente.')
    for row in rows:
        if row['mode'] != 'HISTORICAL_REPLAY' or row['feed'] != 'iex' or row['adjustment'] != 'raw':
            raise ValueError('Procedencia histórica IEX incompatible.')
        if row['scenario'] not in ('ideal', 'delayed') or row['label'] not in (*CLASSES, ''):
            raise ValueError('Escenario o etiqueta inválida.')
        probability = json.loads(row['prob_xgboost'])
        if (len(probability) != 3 or any(not np.isfinite(p) or p < 0 or p > 1 for p in probability)
                or abs(sum(probability) - 1) > 1e-5):
            raise ValueError('Probabilidades incompatibles.')
        row['probability'] = probability
        features = json.loads(row['features'])
        row['atr14_relative'] = float(features['atr14_relative'])
        if not np.isfinite(row['atr14_relative']) or row['atr14_relative'] < 0:
            raise ValueError('Régimen de volatilidad inválido.')
    return [row for row in rows if row['label'] in CLASSES], source


def class_diagnostics(rows, class_index):
    truth = np.array([row['label'] == CLASSES[class_index] for row in rows], dtype=bool)
    probability = np.array([row['probability'][class_index] for row in rows], dtype=float)
    n = len(rows)
    prevalence = float(truth.mean())
    distribution = {}
    for name, mask in (('actual_class', truth), ('other_classes', ~truth)):
        values = probability[mask]
        distribution[name] = {'rows': int(len(values)), 'mean': float(values.mean()) if len(values) else None,
                              'p10_p50_p90': [float(np.quantile(values, q)) for q in (.1, .5, .9)] if len(values) else None}
    bins = []
    for low in np.arange(0, 1, .1):
        mask = (probability >= low) & (probability < low + .1 if low < .9 else probability <= 1)
        if mask.any():
            bins.append({'from': float(round(low, 1)), 'to': float(round(low + .1, 1)), 'rows': int(mask.sum()),
                         'predicted_mean': float(probability[mask].mean()), 'actual_frequency': float(truth[mask].mean())})
    thresholds = []
    for cutoff in THRESHOLDS:
        chosen = probability >= cutoff
        hit = int((chosen & truth).sum())
        thresholds.append({'threshold': cutoff, 'classified': int(chosen.sum()), 'coverage': float(chosen.mean()),
                           'precision': hit / int(chosen.sum()) if chosen.any() else None,
                           'recall': hit / int(truth.sum()) if truth.any() else None})
    return {'rows': n, 'prevalence': prevalence,
            'roc_auc_ovr': float(roc_auc_score(truth, probability)) if truth.any() and (~truth).any() else None,
            'pr_auc_average_precision': float(average_precision_score(truth, probability)) if truth.any() else None,
            'pr_baseline_prevalence': prevalence, 'brier_binary': float(np.mean((probability - truth) ** 2)),
            'probability_by_outcome': distribution, 'calibration': bins, 'thresholds': thresholds}


def abstention(rows):
    probabilities = np.array([row['probability'] for row in rows])
    actual = np.array([CLASSES.index(row['label']) for row in rows])
    dominant = np.argmax(probabilities, axis=1)
    confidence = probabilities.max(axis=1)
    return [{'minimum_max_probability': cutoff, 'classified': int((confidence >= cutoff).sum()),
             'coverage': float((confidence >= cutoff).mean()),
             'accuracy_among_classified': float((dominant[confidence >= cutoff] == actual[confidence >= cutoff]).mean())
             if (confidence >= cutoff).any() else None} for cutoff in THRESHOLDS]


def diagnose(rows):
    grouped = defaultdict(list)
    for row in rows:
        grouped[(row['scenario'], int(row['fold']))].append(row)
    result = {}
    for (scenario, fold), subset in sorted(grouped.items()):
        if len({row['model_sha256'] for row in subset}) != 1:
            raise ValueError('Modelos mezclados dentro de un fold.')
        by_month = defaultdict(list)
        for row in subset:
            by_month[row['session_date_ny'][:7]].append(row)
        dates=sorted({row['session_date_ny'] for row in subset})
        midpoint=dates[len(dates)//2]
        volatility_mid=float(np.median([row['atr14_relative'] for row in subset]))
        regimes={'primera_mitad': [row for row in subset if row['session_date_ny']<midpoint],
                 'segunda_mitad': [row for row in subset if row['session_date_ny']>=midpoint],
                 'atr_bajo': [row for row in subset if row['atr14_relative']<volatility_mid],
                 'atr_alto': [row for row in subset if row['atr14_relative']>=volatility_mid]}
        result.setdefault(scenario, {})[str(fold)] = {
            'rows': len(subset), 'model_sha256': subset[0]['model_sha256'],
            'classes': {label: class_diagnostics(subset, i) for i, label in enumerate(CLASSES)},
            'abstention': abstention(subset),
            'chronology': {month: {'rows': len(group), 'BAJISTA': class_diagnostics(group, 1)}
                           for month, group in sorted(by_month.items())},
            'descriptive_regimes': {'date_split': midpoint, 'atr14_relative_median': volatility_mid,
                'groups': {name:{'rows':len(group),'BAJISTA':class_diagnostics(group,1)} for name,group in regimes.items() if group}}}
    return result


def run(source, output):
    source, output = Path(source).resolve(), Path(output).resolve()
    if output.exists() or source == output or source in output.parents:
        raise ValueError('La salida debe ser una carpeta privada nueva e independiente.')
    rows, report = load_predictions(source)
    result = {'schema': 'phase38f-probability-v1', 'source_predictions_sha256': digest(source / 'predictions.csv'),
              'source_report_sha256': digest(source / 'report.json'), 'classes': list(CLASSES),
              'warning': 'Diagnóstico retrospectivo exploratorio; umbrales y abstención no validados para decisiones futuras.',
              'scenario_note': 'Cada escenario tiene objetivos y disponibilidad diferentes; no equiparar sus métricas.',
              'fold_policy': report['fold_policy'], 'scenarios': diagnose(rows)}
    output.mkdir(parents=True)
    payload = json.dumps(result, indent=2, ensure_ascii=False) + '\n'
    (output / 'report.json').write_text(payload, encoding='utf8')
    (output / 'SHA256SUMS').write_text(f'{digest(output / "report.json")}  report.json\n', encoding='utf8')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    summary = run(args.source, args.out)
    print(json.dumps({'scenarios': {name: len(folds) for name, folds in summary['scenarios'].items()}}))
