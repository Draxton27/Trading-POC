"""Descriptive tree-importance audit on already designated historical folds."""
from __future__ import annotations

from collections import defaultdict
from pathlib import Path
import re

import joblib
import lightgbm as lgb
import numpy as np
import xgboost as xgb

from ml.phase41e.feature_schema import feature_schema


def feature_name(encoded, originals):
    indexed = re.match(r'^(?:numeric|categorical)__x(\d+)(?:_|$)', encoded)
    if indexed and int(indexed.group(1)) < len(originals):
        return originals[int(indexed.group(1))]
    for name in sorted(originals, key=len, reverse=True):
        if encoded == f'numeric__{name}' or encoded.startswith(f'categorical__{name}_'):
            return name
    raise ValueError('Columna one-hot no atribuible al esquema 41E.')


def describe(out: Path, fold_reports):
    groups = defaultdict(list)
    details = []
    for fold in fold_reports:
        artifacts = fold['artifacts']
        transformer = joblib.load(out / artifacts['transform_trees']['file'])
        encoded = list(transformer.get_feature_names_out())
        originals = feature_schema()['columns'][fold['feature_set']]
        for model in ('xgboost', 'lightgbm'):
            path = out / artifacts[model]['file']
            if model == 'xgboost':
                predictor = xgb.XGBClassifier()
                predictor.load_model(path)
                importance = predictor.feature_importances_
            else:
                predictor = lgb.Booster(model_file=str(path))
                importance = predictor.feature_importance(importance_type='gain')
            if len(importance) != len(encoded):
                raise ValueError('Dimension de importancia distinta del transformador guardado.')
            scores = defaultdict(float)
            for name, value in zip(encoded, importance):
                scores[feature_name(name, originals)] += float(value)
            total = sum(scores.values())
            normalized = {name: value / total if total > 0 else 0.0 for name, value in scores.items()}
            key = (fold['scenario'], fold['target'], fold['population'], model, fold['feature_set'])
            groups[key].append(normalized)
            details.append({'scenario': fold['scenario'], 'fold': fold['fold'],
                            'target': fold['target'], 'population': fold['population'],
                            'model': model, 'feature_set': fold['feature_set'],
                            'normalized_importance': normalized})
    summaries = []
    for key, folds in sorted(groups.items()):
        names = sorted({name for fold in folds for name in fold})
        means = {name: float(np.mean([fold.get(name, 0.0) for fold in folds])) for name in names}
        top = sorted(means, key=lambda name: means[name], reverse=True)
        frequent = {name: sum(name in sorted(fold, key=fold.get, reverse=True)[:10]
                              for fold in folds) for name in names}
        summaries.append({'scenario': key[0], 'target': key[1], 'population': key[2],
                          'model': key[3], 'feature_set': key[4], 'folds': len(folds),
                          'top_mean_importance': [{'feature': name, 'mean_normalized': means[name],
                                                   'top10_folds': frequent[name]} for name in top[:15]],
                          'candidate_ceiling_floor_mean': {
                              name: means.get(name) for name in ('candidate_ceiling_context_15m',
                                                                   'candidate_floor_context_15m')},
                          'SMA200_coverage_caveat': key[4] == 'F2'})
    return {'schema': 'phase41f-feature-diagnostics-v1', 'status': 'DESCRIPTIVE_HISTORICAL',
            'importance_type': 'XGBoost gain-derived built-in and LightGBM gain; grouped one-hot categories; within-model normalized; not causal or comparable across algorithms',
            'by_fold': details, 'summaries': summaries,
            'warning': 'Correlated features and retrospective SIP split adjustments prevent causal attribution.'}
