"""Small synthetic historical experiment with all three classes on every session."""
from __future__ import annotations

import json
from datetime import datetime, timedelta

import numpy as np

from ml.phase28.train import CLASSES, FEATURES, metrics, inner_early_stop
from ml.phase38b.replay import folds
from ml.phase38c.replay import training_before, report_scores


def fake_source(*, sessions=5, minimum_train_sessions=3, test_sessions=2,
                excluded_last=False):
    observations = []
    for day in range(1, sessions + 1):
        date = f'2026-10-{day:02d}'
        for offset, label in enumerate(CLASSES):
            minute = offset * 15
            start = f'{date}T14:{minute:02d}:00.000Z'
            features = {name: float((offset + day) / 100) for name in FEATURES}
            features['minutes_from_open'] = float(minute)
            for scenario in ('ideal', 'delayed'):
                bar_start = datetime.fromisoformat(start.replace('Z', '+00:00'))
                available = bar_start + timedelta(minutes=15 if scenario == 'ideal' else 35)
                entry = bar_start + timedelta(minutes=30 if scenario == 'ideal' else 45)
                stamp = lambda value: value.isoformat(timespec='milliseconds').replace('+00:00', 'Z')
                excluded = excluded_last and day == sessions and offset == 2
                observations.append({'scenario': scenario, 'mode': 'HISTORICAL_REPLAY',
                    'session_date_ny': date, 'bar_start_utc': start,
                    'available_at_utc': stamp(available),
                    'feature_sha256': f'{date}-{offset}', 'features': dict(features),
                    'reference_entry_at_utc': stamp(entry),
                    'minutes_until_reference_entry': 15 if scenario == 'ideal' else 10,
                    'label': None if excluded else label,
                    'label_available_at_utc': None if excluded else f'{date}T16:00:00.000Z',
                    'exclusion': 'MARKET_CLOSE' if excluded else None})
    predictions = []
    source_scenarios = {}
    for scenario in ('ideal', 'delayed'):
        selected = [r for r in observations if r['scenario'] == scenario]
        reports = []
        pooled_y, pooled_p = [], []
        for fold, test in folds(selected, minimum_train_sessions, test_sessions):
            cutoff = min(r['available_at_utc'] for r in test)
            first = min(r['session_date_ny'] for r in test)
            train = training_before(selected, cutoff, first)
            core, early = inner_early_stop(train)
            labels = [r['label'] for r in test if r['label'] is not None]
            probabilities = []
            for row in test:
                p = [0.2, 0.3, 0.5]
                probabilities.append(p)
                predictions.append({'scenario': scenario, 'fold': str(fold),
                    'bar_start_utc': row['bar_start_utc'],
                    'session_date_ny': row['session_date_ny'],
                    'inference_at_utc': row['available_at_utc'],
                    'model_sha256': 'synthetic-model-hash',
                    'prob_xgboost': json.dumps(p), 'prob_frequency': json.dumps([1 / 3] * 3),
                    'prob_linear': json.dumps([1 / 3] * 3)})
            probabilities_resolved = [p for row, p in zip(test, probabilities) if row['label'] is not None]
            y = np.array([CLASSES.index(v) for v in labels])
            pooled_y.extend(labels)
            pooled_p.extend(probabilities_resolved)
            reports.append({'fold': fold, 'cutoff_utc': cutoff,
                'first_test_session': first, 'last_test_session': max(r['session_date_ny'] for r in test),
                'test_rows': len(test), 'resolved_rows': len(labels), 'training_rows': len(train),
                'max_training_label_available_at_utc': max(r['label_available_at_utc'] for r in train),
                'selection_rows': len(core), 'early_stop_rows': len(early),
                'metrics': {'xgboost': report_scores(y, np.array(probabilities_resolved), 'xgboost'),
                            'frequency': report_scores(y, np.array([[1 / 3] * 3] * len(y)), 'frequency'),
                            'linear': report_scores(y, np.array([[1 / 3] * 3] * len(y)), 'linear')}})
        source_scenarios[scenario] = {'folds': reports,
            'pooled': {'rows': len(pooled_y), 'metrics': {
                'xgboost': report_scores(np.array([CLASSES.index(v) for v in pooled_y]),
                                         np.array(pooled_p), 'xgboost'),
                'frequency': report_scores(np.array([CLASSES.index(v) for v in pooled_y]),
                                           np.array([[1 / 3] * 3] * len(pooled_y)), 'frequency'),
                'linear': report_scores(np.array([CLASSES.index(v) for v in pooled_y]),
                                        np.array([[1 / 3] * 3] * len(pooled_y)), 'linear')}}}
    report = {'fold_policy': {'minimum_train_sessions': minimum_train_sessions,
                             'test_sessions': test_sessions},
              'features': list(FEATURES), 'classes': list(CLASSES),
              'scenarios': source_scenarios}
    drift = []
    def loader(_source):
        return [], observations, predictions, report, {'manifest.json': 'synthetic-hash'}, drift
    return loader
