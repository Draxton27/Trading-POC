"""Scores and paired uncertainty on identical Phase 38E external observations."""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date

import numpy as np
from sklearn.metrics import average_precision_score, roc_auc_score

from ml.phase28.train import CLASSES, metrics
from ml.phase38c.replay import report_scores, fast_scores
from ml.phase40a.bear_audit import probability_vector

SEED = 7
ITERATIONS = 400
DIFFERENCE_KEYS = ('macro_f1', 'balanced_accuracy', 'bear_recall',
                   'bear_precision', 'bear_f1', 'log_loss', 'brier_multiclass',
                   'bear_pr_auc', 'bear_roc_auc')


def _arrays(labels, probabilities):
    if not labels or len(labels) != len(probabilities):
        raise ValueError('Etiquetas y probabilidades desalineadas.')
    if any(label not in CLASSES for label in labels):
        raise ValueError('Etiqueta desconocida.')
    p = np.asarray([probability_vector(list(row)) for row in probabilities], dtype=float)
    return np.array([CLASSES.index(label) for label in labels], dtype=int), p


def _bear_auc(y, probabilities):
    truth = y == CLASSES.index('BAJISTA')
    positives, negatives = int(truth.sum()), int((~truth).sum())
    if not positives or not negatives:
        return {'roc_auc_ovr': None, 'pr_auc': None,
                'reason': 'MISSING_POSITIVE' if not positives else 'MISSING_NEGATIVE',
                'prevalence': positives / len(y)}
    bear = probabilities[:, 1]
    return {'roc_auc_ovr': float(roc_auc_score(truth, bear)),
            'pr_auc': float(average_precision_score(truth, bear)),
            'reason': None, 'prevalence': positives / len(y)}


def score(labels, probabilities, model):
    if model not in ('xgboost', 'lightgbm', 'frequency', 'linear'):
        raise ValueError('Modelo probabilístico no autorizado.')
    y, p = _arrays(labels, probabilities)
    result = report_scores(y, p, model)
    result['bear_ovr'] = _bear_auc(y, p)
    counts = Counter(CLASSES[int(index)] for index in np.argmax(p, axis=1))
    result['predicted_counts'] = {name: counts.get(name, 0) for name in CLASSES}
    matrix = result['confusion_matrix']
    result['bear_errors'] = {'BAJISTA_to_BAJISTA': matrix[1][1],
                             'BAJISTA_to_LATERAL': matrix[1][2],
                             'BAJISTA_to_ALCISTA': matrix[1][0],
                             'LATERAL_to_BAJISTA': matrix[2][1],
                             'ALCISTA_to_BAJISTA': matrix[0][1]}
    if result['per_class']['BAJISTA']['support'] == 0:
        result['bear_classification_status'] = 'MISSING_TRUE_CLASS'
    else:
        result['bear_classification_status'] = 'REPORTED'
    return result


def compare_original(labels, probabilities, original, tolerance=1e-9, model='xgboost'):
    """Fail closed if source probabilities no longer reproduce Phase 38E."""
    y, p = _arrays(labels, probabilities)
    calculated = metrics(y, p)
    keys = ('accuracy', 'balanced_accuracy', 'macro_f1', 'log_loss', 'brier_multiclass')
    for name in keys:
        if name not in original or abs(calculated[name] - original[name]) > tolerance:
            raise ValueError(f'Métrica {model} original incompatible: {name}.')
    if calculated['confusion_matrix'] != original.get('confusion_matrix'):
        raise ValueError(f'Matriz {model} original incompatible.')
    for name in CLASSES:
        for metric in ('precision', 'recall', 'f1', 'support'):
            if abs(calculated['per_class'][name][metric] - original['per_class'][name][metric]) > tolerance:
                raise ValueError(f'Métrica {model} original incompatible: {name}/{metric}.')
    return calculated


def _quick(y, p):
    values = fast_scores(y, p)
    matrix = np.bincount(y * 3 + np.argmax(p, axis=1), minlength=9).reshape(3, 3)
    tp, selected, actual = matrix[1, 1], matrix[:, 1].sum(), matrix[1, :].sum()
    precision = float(tp / selected) if selected else 0.0
    recall = float(tp / actual) if actual else 0.0
    values.update(bear_recall=recall, bear_precision=precision,
                  bear_f1=2 * precision * recall / (precision + recall) if precision + recall else 0.0)
    auc = _bear_auc(y, p)
    values['bear_pr_auc'] = auc['pr_auc']
    values['bear_roc_auc'] = auc['roc_auc_ovr']
    return values


def _group_key(row, grouping):
    day = row['session_date_ny']
    fold = row['fold']
    if grouping == 'session':
        return (fold, day)
    if grouping == 'week':
        year, week, _ = date.fromisoformat(day).isocalendar()
        return (fold, f'{year}-W{week:02d}')
    if grouping == 'month':
        return (fold, day[:7])
    raise ValueError('Agrupación no autorizada.')


def paired_bootstrap(rows, labels, lightgbm, xgboost, *, grouping='session',
                     iterations=ITERATIONS, seed=SEED):
    """Paired complete-group resampling; preserve fold identity in pooled data."""
    if not rows or len(rows) != len(labels):
        raise ValueError('Bootstrap sin filas alineadas.')
    y, left = _arrays(labels, lightgbm)
    _, right = _arrays(labels, xgboost)
    groups = defaultdict(list)
    for index, row in enumerate(rows):
        groups[_group_key(row, grouping)].append(index)
    keys = sorted(groups)
    if len(keys) < 2:
        return {'status': 'INSUFFICIENT_EVIDENCE', 'grouping': grouping,
                'groups': len(keys), 'iterations': 0}
    rng = np.random.default_rng(seed)
    differences = {key: [] for key in DIFFERENCE_KEYS}
    for _ in range(iterations):
        indices = np.concatenate([groups[keys[index]]
                                  for index in rng.choice(len(keys), len(keys), replace=True)])
        a, b = _quick(y[indices], left[indices]), _quick(y[indices], right[indices])
        for metric in DIFFERENCE_KEYS:
            if a[metric] is not None and b[metric] is not None:
                differences[metric].append(a[metric] - b[metric])
    return {'status': 'DESCRIPTIVE', 'grouping': grouping, 'groups': len(keys),
            'iterations': iterations, 'seed': seed, 'difference': 'lightgbm_minus_xgboost',
            'interval_95pct': {metric: {'interval': [float(v) for v in np.quantile(samples, [.025, .975])]
                                            if samples else None,
                                        'valid_replicates': len(samples),
                                        'excluded_replicates': iterations - len(samples)}
                               for metric, samples in differences.items()}}


def classify_comparison(light, xgb, rows):
    if rows < 30 or light['per_class']['BAJISTA']['support'] < 30:
        return 'INSUFFICIENT_EVIDENCE'
    changes = [light['macro_f1'] - xgb['macro_f1'],
               light['per_class']['BAJISTA']['recall'] - xgb['per_class']['BAJISTA']['recall'],
               light['per_class']['BAJISTA']['precision'] - xgb['per_class']['BAJISTA']['precision'],
               xgb['log_loss'] - light['log_loss']]
    if all(change > 0 for change in changes):
        return 'IMPROVEMENT_OBSERVED'
    if all(change <= 0 for change in changes):
        return 'NO_IMPROVEMENT_OBSERVED'
    return 'MIXED_RESULTS'
