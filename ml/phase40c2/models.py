"""Fixed 38E/40B learners with an explicit 19-column feature contract."""
from __future__ import annotations

import lightgbm as lgb
import numpy as np

from ml.phase28.train import CLASS_INDEX, CLASSES
from ml.phase40b.lightgbm_model import LIGHTGBM_PARAMS, MAX_ITERATIONS
from ml.phase40c1.models import THREADS, _xgb, check_inner_split, checked_probabilities
from ml.phase40c2.trend_features import EXTENDED_FEATURES


def matrix(rows, *, labels=True):
    if not rows:
        raise ValueError('Entrenamiento o predicción sin filas.')
    values = np.asarray([[float(row['features'][name]) for name in EXTENDED_FEATURES]
                         for row in rows], dtype=np.float64)
    if values.shape != (len(rows), 19) or not np.isfinite(values).all():
        raise ValueError('Matriz de 19 variables inválida.')
    if not labels:
        return values
    y = np.asarray([CLASS_INDEX[row['label']] for row in rows], dtype=np.int64)
    if set(y.tolist()) != set(range(len(CLASSES))):
        raise ValueError('Entrenamiento o validación sin las tres clases.')
    return values, y


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
    if list(model.classes_) != [0, 1, 2] or model.n_features_in_ != 19:
        raise ValueError('Contrato XGBoost incompatible.')
    return model, trees


def fit_lightgbm(core, early, train):
    check_inner_split(core, early, train)
    xc, yc = matrix(core)
    xe, ye = matrix(early)
    xt, yt = matrix(train)
    development = lgb.Dataset(xc, label=yc, feature_name=list(EXTENDED_FEATURES), free_raw_data=False)
    validation = lgb.Dataset(xe, label=ye, reference=development,
                             feature_name=list(EXTENDED_FEATURES), free_raw_data=False)
    selector = lgb.train(dict(LIGHTGBM_PARAMS), development, num_boost_round=MAX_ITERATIONS,
                         valid_sets=[validation], valid_names=['early'],
                         callbacks=[lgb.early_stopping(stopping_rounds=30,
                                                       first_metric_only=True, verbose=False)])
    trees = int(selector.best_iteration)
    if not 1 <= trees <= MAX_ITERATIONS:
        raise ValueError('Árboles LightGBM inválidos.')
    complete = lgb.Dataset(xt, label=yt, feature_name=list(EXTENDED_FEATURES), free_raw_data=False)
    model = lgb.train(dict(LIGHTGBM_PARAMS), complete, num_boost_round=trees)
    if model.current_iteration() != trees or model.feature_name() != list(EXTENDED_FEATURES):
        raise ValueError('Reentrenamiento LightGBM incompleto.')
    return model, trees


def predict_xgb(model, events):
    return checked_probabilities(model.predict_proba(matrix(events, labels=False)), len(events))


def predict_lightgbm(model, events):
    return checked_probabilities(model.predict(matrix(events, labels=False), num_threads=THREADS), len(events))
