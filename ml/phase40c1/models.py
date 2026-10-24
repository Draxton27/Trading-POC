"""Fixed Phase 38E XGBoost and Phase 40B LightGBM settings with 17 inputs."""
from __future__ import annotations

import numpy as np
import xgboost as xgb
import lightgbm as lgb

from ml.phase28.train import CLASS_INDEX, CLASSES, VARIANTS
from ml.phase40a.bear_audit import probability_vector
from ml.phase40b.lightgbm_model import LIGHTGBM_PARAMS, MAX_ITERATIONS
from ml.phase40c1.temporal_features import EXTENDED_FEATURES

SEED = 7
THREADS = 2


def matrix(rows, *, labels=True):
    if not rows:
        raise ValueError('Entrenamiento o predicción sin filas.')
    values = np.asarray([[float(row['features'][name]) for name in EXTENDED_FEATURES]
                         for row in rows], dtype=np.float64)
    if values.shape != (len(rows), len(EXTENDED_FEATURES)) or not np.isfinite(values).all():
        raise ValueError('Matriz de 17 variables inválida.')
    if not labels:
        return values
    y = np.asarray([CLASS_INDEX[row['label']] for row in rows], dtype=np.int64)
    if set(y.tolist()) != set(range(len(CLASSES))):
        raise ValueError('Entrenamiento o validación sin las tres clases.')
    return values, y


def checked_probabilities(probabilities, count):
    result = np.asarray(probabilities, dtype=float)
    if result.shape != (count, len(CLASSES)):
        raise ValueError('Probabilidades o clases desordenadas.')
    for row in result:
        probability_vector(row.tolist())
    return result


def _xgb(trees, *, early_stopping=False):
    params = dict(VARIANTS['standard'])
    return xgb.XGBClassifier(
        objective='multi:softprob', num_class=3, n_estimators=trees,
        subsample=.8, colsample_bytree=.9, random_state=SEED,
        n_jobs=THREADS, eval_metric='mlogloss',
        **({'early_stopping_rounds': 30} if early_stopping else {}), **params)


def check_inner_split(core, early, train):
    core_days = {row['session_date_ny'] for row in core}
    early_days = {row['session_date_ny'] for row in early}
    train_ids = {(row['session_date_ny'], row['bar_start_utc']) for row in train}
    if (not core_days or not early_days or max(core_days) >= min(early_days) or
            max(row['label_available_at_utc'] for row in core) >=
            min(row['observed_at_utc'] for row in early) or
            any((row['session_date_ny'], row['bar_start_utc']) not in train_ids
                for row in (*core, *early))):
        raise ValueError('Selección interna no causal o filas fuera del entrenamiento.')


def fit_xgb(core, early, train):
    check_inner_split(core, early, train)
    xc, yc = matrix(core)
    xe, ye = matrix(early)
    xt, yt = matrix(train)
    selector = _xgb(MAX_ITERATIONS, early_stopping=True)
    selector.fit(xc, yc, eval_set=[(xe, ye)], verbose=False)
    trees = int(selector.best_iteration) + 1
    if not 1 <= trees <= MAX_ITERATIONS:
        raise ValueError('Árboles XGBoost inválidos.')
    model = _xgb(trees)
    model.fit(xt, yt, verbose=False)
    if list(model.classes_) != [0, 1, 2] or model.n_features_in_ != len(EXTENDED_FEATURES):
        raise ValueError('Contrato XGBoost incompatible.')
    return model, trees


def fit_lightgbm(core, early, train):
    check_inner_split(core, early, train)
    xc, yc = matrix(core)
    xe, ye = matrix(early)
    xt, yt = matrix(train)
    dataset = lgb.Dataset(xc, label=yc, feature_name=list(EXTENDED_FEATURES), free_raw_data=False)
    validation = lgb.Dataset(xe, label=ye, reference=dataset,
                             feature_name=list(EXTENDED_FEATURES), free_raw_data=False)
    selector = lgb.train(dict(LIGHTGBM_PARAMS), dataset, num_boost_round=MAX_ITERATIONS,
                         valid_sets=[validation], valid_names=['early'],
                         callbacks=[lgb.early_stopping(stopping_rounds=30,
                                                       first_metric_only=True, verbose=False)])
    trees = int(selector.best_iteration)
    if not 1 <= trees <= MAX_ITERATIONS:
        raise ValueError('Árboles LightGBM inválidos.')
    full = lgb.Dataset(xt, label=yt, feature_name=list(EXTENDED_FEATURES), free_raw_data=False)
    model = lgb.train(dict(LIGHTGBM_PARAMS), full, num_boost_round=trees)
    if model.current_iteration() != trees or model.feature_name() != list(EXTENDED_FEATURES):
        raise ValueError('Reentrenamiento LightGBM incompleto.')
    return model, trees


def predict_xgb(model, rows):
    return checked_probabilities(model.predict_proba(matrix(rows, labels=False)), len(rows))


def predict_lightgbm(model, rows):
    return checked_probabilities(model.predict(matrix(rows, labels=False), num_threads=THREADS), len(rows))
