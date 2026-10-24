"""Fixed LightGBM protocol; only inner chronological data choose tree count."""
from __future__ import annotations

import numpy as np
import lightgbm as lgb

from ml.phase28.train import CLASSES, FEATURES, arrays
from ml.phase40a.bear_audit import probability_vector

MAX_ITERATIONS = 300
SEED = 7
LIGHTGBM_PARAMS = {
    'objective': 'multiclass', 'num_class': 3, 'metric': 'multi_logloss',
    'boosting_type': 'gbdt', 'learning_rate': 0.05, 'num_leaves': 7,
    'max_depth': 3, 'min_data_in_leaf': 30, 'feature_fraction': 1.0,
    'bagging_fraction': 1.0, 'lambda_l2': 1.0, 'seed': SEED,
    'num_threads': 2, 'device_type': 'cpu', 'deterministic': True,
    'force_col_wise': True, 'verbosity': -1,
}


def matrices(rows, *, require_classes=True):
    if not rows or (require_classes and set(r['label'] for r in rows) != set(CLASSES)):
        raise ValueError('Entrenamiento insuficiente: faltan filas o clases.')
    x, y = arrays(rows)
    if x.shape != (len(rows), len(FEATURES)) or not np.isfinite(x).all():
        raise ValueError('Variables LightGBM incompatibles.')
    return x, y


def select_iterations(core, early):
    x, y = matrices(core)
    xe, ye = matrices(early)
    core_sessions = {r['session_date_ny'] for r in core}
    early_sessions = {r['session_date_ny'] for r in early}
    if (core_sessions & early_sessions or max(core_sessions) >= min(early_sessions) or
            max(r['label_available_at_utc'] for r in core) >= min(r['observed_at_utc'] for r in early)):
        raise ValueError('Early stopping no causal.')
    train = lgb.Dataset(x, label=y, feature_name=list(FEATURES), free_raw_data=False)
    validation = lgb.Dataset(xe, label=ye, reference=train, feature_name=list(FEATURES), free_raw_data=False)
    booster = lgb.train(dict(LIGHTGBM_PARAMS), train, num_boost_round=MAX_ITERATIONS,
                        valid_sets=[validation], valid_names=['early'],
                        callbacks=[lgb.early_stopping(stopping_rounds=30,
                                                      first_metric_only=True, verbose=False)])
    best = int(booster.best_iteration)
    if not 1 <= best <= MAX_ITERATIONS:
        raise ValueError('best_iteration inválida.')
    return best


def refit(train_rows, iterations):
    if not isinstance(iterations, int) or not 1 <= iterations <= MAX_ITERATIONS:
        raise ValueError('Número de árboles inválido.')
    x, y = matrices(train_rows)
    data = lgb.Dataset(x, label=y, feature_name=list(FEATURES), free_raw_data=False)
    booster = lgb.train(dict(LIGHTGBM_PARAMS), data, num_boost_round=iterations)
    if booster.current_iteration() != iterations:
        raise ValueError('Reentrenamiento incompleto.')
    return booster


def predict(booster, observations):
    if not observations:
        return np.empty((0, len(CLASSES)), dtype=float)
    x = np.asarray([[float(r['features'][name]) for name in FEATURES] for r in observations], dtype=float)
    if x.shape != (len(observations), len(FEATURES)) or not np.isfinite(x).all():
        raise ValueError('Variables de predicción incompatibles.')
    result = np.asarray(booster.predict(x, num_threads=2), dtype=float)
    if result.shape != (len(observations), len(CLASSES)):
        raise ValueError('Orden o número de clases LightGBM incompatible.')
    for row in result:
        probability_vector(row.tolist())
    return result
