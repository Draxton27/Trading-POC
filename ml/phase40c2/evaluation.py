"""Paired trend-versus-base scores without changing Phase 40B statistics."""
from __future__ import annotations

import numpy as np

from ml.phase40b.evaluation import paired_bootstrap, score
from ml.phase40c2.trend_features import EXTENDED_FEATURES, TREND_FEATURES

VARIANTS = ('xgb_base', 'lgb_base', 'xgb_trend', 'lgb_trend')
PAIRS = (('xgb_trend', 'xgb_base'), ('lgb_trend', 'lgb_base'))


def scores(rows):
    labels = [row['label'] for row in rows]
    return {name: score(labels, [row[f'prob_{name}'] for row in rows],
                        'xgboost' if name.startswith('xgb') else 'lightgbm')
            for name in VARIANTS}


def uncertainty(rows, left, right, grouping):
    result = paired_bootstrap(rows, [row['label'] for row in rows],
                              [row[f'prob_{left}'] for row in rows],
                              [row[f'prob_{right}'] for row in rows], grouping=grouping)
    result['difference'] = f'{left}_minus_{right}'
    return result


def importance_and_redundancy(xgb_model, lgb_model, train):
    gain_xgb = xgb_model.get_booster().get_score(importance_type='gain')
    gain_lgb = lgb_model.feature_importance(importance_type='gain')
    values = np.asarray([[float(row['features'][name]) for name in EXTENDED_FEATURES]
                         for row in train], dtype=float)
    # Constant columns in small folds have undefined Pearson correlation.
    with np.errstate(invalid='ignore', divide='ignore'):
        correlations = np.corrcoef(values, rowvar=False)
    closest = {}
    for name in TREND_FEATURES:
        index = EXTENDED_FEATURES.index(name)
        candidates = [(abs(float(correlations[index, other])), float(correlations[index, other]),
                       EXTENDED_FEATURES[other])
                      for other in range(len(EXTENDED_FEATURES))
                      if other != index and np.isfinite(correlations[index, other])]
        if candidates:
            magnitude, signed, other = max(candidates)
            closest[name] = {'feature': other, 'pearson': signed,
                             'abs_pearson': magnitude, 'train_rows': len(train)}
        else:
            closest[name] = {'feature': None, 'pearson': None,
                             'abs_pearson': None, 'train_rows': len(train)}
    return {'xgb_gain': {name: float(gain_xgb.get(f'f{index}', 0))
                         for index, name in enumerate(EXTENDED_FEATURES)},
            'lgb_gain': {name: float(gain_lgb[index])
                         for index, name in enumerate(EXTENDED_FEATURES)},
            'highest_absolute_training_correlation': closest,
            'interpretation': 'Descriptive gain and Pearson correlation, not causal feature value.'}
