"""Fixed Phase 41F estimators; only iteration count uses an earlier inner block."""
from __future__ import annotations

import numpy as np
import lightgbm as lgb
import xgboost as xgb
from sklearn.linear_model import LogisticRegression
from threadpoolctl import threadpool_limits

from ml.phase40b.lightgbm_model import LIGHTGBM_PARAMS

SEED = 7
TREES = 300
THREADS = 2
MODELS = ('frequency', 'linear', 'xgboost', 'lightgbm')


def require_classes(y, count):
    if len(y) == 0 or set(np.unique(y)) != set(range(count)):
        raise ValueError('Clases insuficientes para entrenamiento causal.')


def validate_probabilities(p, count):
    p = np.asarray(p, dtype=float)
    if (p.ndim != 2 or p.shape[1] != count or not np.isfinite(p).all() or
            (p < 0).any() or (p > 1).any() or not np.allclose(p.sum(axis=1), 1, atol=1e-6)):
        raise ValueError('Probabilidades u orden de clases incompatibles.')
    return p


def frequency(y, count, rows):
    require_classes(y, count)
    return np.tile(np.bincount(y, minlength=count) / len(y), (rows, 1))


def logistic(x, y, test, count):
    require_classes(y, count)
    model = LogisticRegression(C=1.0, max_iter=600, random_state=SEED)
    with threadpool_limits(limits=THREADS):
        model.fit(x, y)
        probabilities = model.predict_proba(test)
    if list(model.classes_) != list(range(count)):
        raise ValueError('Orden de clases lineal incompatible.')
    return model, validate_probabilities(probabilities, count), {'selected_trees': None}


def _xgb_params(count, trees, *, early=False):
    return {'objective': 'binary:logistic' if count == 2 else 'multi:softprob',
            **({} if count == 2 else {'num_class': count}),
            'n_estimators': trees, 'max_depth': 3, 'learning_rate': .05,
            'subsample': .8, 'colsample_bytree': .9, 'reg_lambda': 1.0,
            'random_state': SEED, 'n_jobs': THREADS,
            'eval_metric': 'logloss' if count == 2 else 'mlogloss',
            **({'early_stopping_rounds': 30} if early else {})}


def xgboost(core, yc, early, ye, train, y, test, count):
    require_classes(yc, count)
    require_classes(y, count)
    selector = xgb.XGBClassifier(**_xgb_params(count, TREES, early=True))
    selector.fit(core, yc, eval_set=[(early, ye)], verbose=False)
    trees = int(selector.best_iteration) + 1
    if not 1 <= trees <= TREES:
        raise ValueError('Numero de arboles XGBoost invalido.')
    model = xgb.XGBClassifier(**_xgb_params(count, trees))
    model.fit(train, y, verbose=False)
    if list(model.classes_) != list(range(count)):
        raise ValueError('Orden de clases XGBoost incompatible.')
    return model, validate_probabilities(model.predict_proba(test), count), {'selected_trees': trees}


def _light_params(count):
    result = dict(LIGHTGBM_PARAMS)
    result.update(objective='binary' if count == 2 else 'multiclass',
                  metric='binary_logloss' if count == 2 else 'multi_logloss',
                  num_threads=THREADS, seed=SEED)
    if count == 2:
        result.pop('num_class', None)
    else:
        result['num_class'] = count
    return result


def lightgbm(core, yc, early, ye, train, y, test, count):
    require_classes(yc, count)
    require_classes(y, count)
    params = _light_params(count)
    training = lgb.Dataset(core, label=yc, free_raw_data=False)
    validation = lgb.Dataset(early, label=ye, reference=training, free_raw_data=False)
    selector = lgb.train(params, training, num_boost_round=TREES,
                         valid_sets=[validation],
                         callbacks=[lgb.early_stopping(30, first_metric_only=True, verbose=False)])
    trees = int(selector.best_iteration)
    if not 1 <= trees <= TREES:
        raise ValueError('Numero de arboles LightGBM invalido.')
    model = lgb.train(params, lgb.Dataset(train, label=y), num_boost_round=trees)
    raw = np.asarray(model.predict(test, num_threads=THREADS), dtype=float)
    probabilities = np.column_stack((1 - raw, raw)) if count == 2 else raw
    return model, validate_probabilities(probabilities, count), {'selected_trees': trees}
