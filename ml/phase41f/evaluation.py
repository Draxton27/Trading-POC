"""Fixed classification and probability metrics for both frozen target types."""
from __future__ import annotations

import numpy as np
from sklearn.metrics import average_precision_score, roc_auc_score

from ml.phase41f.models import validate_probabilities


def score(y, probabilities, classes):
    y = np.asarray(y, dtype=int)
    p = validate_probabilities(probabilities, len(classes))
    if len(y) != len(p) or not len(y) or not set(np.unique(y)) <= set(range(len(classes))):
        raise ValueError('Etiquetas y probabilidades desalineadas.')
    predicted = np.argmax(p, axis=1)
    matrix = np.bincount(y * len(classes) + predicted,
                         minlength=len(classes) ** 2).reshape(len(classes), len(classes))
    per = {}
    for index, name in enumerate(classes):
        support, selected, tp = int(matrix[index].sum()), int(matrix[:, index].sum()), int(matrix[index, index])
        precision = tp / selected if selected else (0.0 if support else None)
        recall = tp / support if support else None
        f1 = (2 * precision * recall / (precision + recall)
              if precision is not None and recall is not None and precision + recall else
              0.0 if precision is not None and recall is not None else None)
        per[name] = {'precision': precision, 'recall': recall, 'f1': f1,
                     'support': support, 'predicted': selected}
    clipped = np.clip(p, 1e-15, 1 - 1e-15)
    calibration = {}
    for index, name in enumerate(classes):
        calibration[name] = [{'lower': lower / 5, 'upper': (lower + 1) / 5,
                              'rows': int(mask.sum()),
                              'mean_probability': float(p[mask, index].mean()),
                              'observed_frequency': float((y[mask] == index).mean())}
                             for lower in range(5)
                             if (mask := (p[:, index] >= lower / 5) &
                                   (p[:, index] < (lower + 1) / 5 if lower < 4 else
                                    p[:, index] <= 1)).any()]
    all_classes = all(item['support'] > 0 for item in per.values())
    base = {'rows': len(y), 'accuracy': float((predicted == y).mean()),
            'balanced_accuracy': float(np.mean([item['recall'] for item in per.values()]))
            if all_classes else None,
            'macro_f1': float(np.mean([item['f1'] for item in per.values()]))
            if all_classes and all(item['f1'] is not None for item in per.values()) else None,
            'per_class': per, 'confusion_matrix': matrix.tolist(),
            'predicted_counts': {name: int(matrix[:, i].sum()) for i, name in enumerate(classes)},
            'log_loss': float(-np.log(clipped[np.arange(len(y)), y]).mean()),
            'brier': float(np.mean((p[:, 0] - (y == 0)) ** 2)) if len(classes) == 2
            else float(np.mean(np.sum((p - np.eye(len(classes))[y]) ** 2, axis=1))),
            'calibration': calibration, 'probability_mean': p.mean(axis=0).tolist(),
            'class_coverage_status': 'COMPLETE' if all_classes else 'UNAVAILABLE_MISSING_CLASS'}
    if len(classes) == 2:
        positive = y == 0
        prevalence = float(positive.mean())
        defined = 0 < prevalence < 1
        base.update({'positive_class': classes[0], 'positive_prevalence': prevalence,
                     'pr_auc': float(average_precision_score(positive, p[:, 0])) if defined else None,
                     'roc_auc': float(roc_auc_score(positive, p[:, 0])) if defined else None,
                     'discrimination_status': 'AVAILABLE' if defined else 'UNAVAILABLE_MISSING_CLASS'})
    else:
        base['bear_errors'] = {'BAJISTA_to_BAJISTA': int(matrix[1, 1]),
                               'BAJISTA_to_LATERAL': int(matrix[1, 2]),
                               'BAJISTA_to_ALCISTA': int(matrix[1, 0])}
    return base


def primary_metrics(classes):
    return ('macro_f1', 'balanced_accuracy', 'bear_precision', 'bear_recall',
            'log_loss', 'brier') if len(classes) == 3 else (
            'pr_auc', 'positive_precision', 'positive_recall',
            'balanced_accuracy', 'log_loss', 'brier')


def metric_values(result, classes):
    values = {name: result.get(name) for name in primary_metrics(classes)}
    if len(classes) == 3:
        values['bear_precision'] = result['per_class']['BAJISTA']['precision']
        values['bear_recall'] = result['per_class']['BAJISTA']['recall']
    else:
        values['positive_precision'] = result['per_class'][classes[0]]['precision']
        values['positive_recall'] = result['per_class'][classes[0]]['recall']
    return values
