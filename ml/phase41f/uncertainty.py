"""Paired complete-session resampling, stratified by the original 38E fold."""
from __future__ import annotations

from collections import defaultdict
from datetime import date

import numpy as np

from ml.phase41f.evaluation import metric_values, primary_metrics, score


def group_key(row, grouping):
    day = row['session_date_ny']
    if grouping == 'session':
        return day
    if grouping == 'week':
        year, week, _ = date.fromisoformat(day).isocalendar()
        return f'{year}-W{week:02d}'
    if grouping == 'month':
        return day[:7]
    raise ValueError('Agrupacion de incertidumbre no autorizada.')


def paired(rows, labels, left, right, classes, *, grouping='session', iterations=120, seed=7):
    if not rows or len(rows) != len(labels) or len(left) != len(rows) or len(right) != len(rows):
        raise ValueError('Comparacion pareada requiere las mismas filas y etiquetas.')
    keys = [(row['scenario'], row['fold'], row['bar_start_utc']) for row in rows]
    if len(keys) != len(set(keys)):
        raise ValueError('Fila externa duplicada en bootstrap.')
    groups = defaultdict(lambda: defaultdict(list))
    for index, row in enumerate(rows):
        groups[row['fold']][group_key(row, grouping)].append(index)
    if any(len(item) < 2 for item in groups.values()):
        return {'status': 'INSUFFICIENT_GROUPS', 'grouping': grouping,
                'groups_by_fold': {str(k): len(v) for k, v in groups.items()}}
    rng = np.random.default_rng(seed)
    y, lp, rp = np.asarray(labels, dtype=int), np.asarray(left), np.asarray(right)
    differences = {name: [] for name in primary_metrics(classes)}
    for _ in range(iterations):
        chosen = []
        for fold in sorted(groups):
            names = sorted(groups[fold])
            for number in rng.choice(len(names), len(names), replace=True):
                chosen.extend(groups[fold][names[number]])
        indices = np.asarray(chosen, dtype=int)
        a = metric_values(score(y[indices], lp[indices], classes), classes)
        b = metric_values(score(y[indices], rp[indices], classes), classes)
        for name in differences:
            if a[name] is not None and b[name] is not None:
                differences[name].append(a[name] - b[name])
    return {'status': 'HISTORICAL_EXPLORED', 'grouping': grouping,
            'groups_by_fold': {str(k): len(v) for k, v in groups.items()},
            'iterations': iterations, 'seed': seed,
            'difference': 'left_minus_right',
            'interval_95pct': {name: ([float(v) for v in np.quantile(values, [.025, .975])]
                                      if values else None) for name, values in differences.items()},
            'valid_replicates': {name: len(values) for name, values in differences.items()}}
