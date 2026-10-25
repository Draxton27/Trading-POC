"""Fold-local, train-only numeric scaling and non-ordinal categorical encoding."""
from __future__ import annotations

import numpy as np
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from ml.phase41e.feature_schema import CATEGORIES, feature_schema


def matrix(rows, names):
    if not rows:
        raise ValueError('Matriz de caracteristicas vacia.')
    result = []
    for row in rows:
        values = row['features']
        if any(name not in values for name in names):
            raise ValueError('Caracteristica requerida ausente.')
        current = [values[name] for name in names]
        for name, value in zip(names, current):
            if name in CATEGORIES:
                if value not in CATEGORIES[name]:
                    raise ValueError('Categoria incompatible con esquema 41E.')
            elif value is None or isinstance(value, bool) or not np.isfinite(value):
                raise ValueError('Valor numerico incompleto o no finito.')
        result.append(current)
    return np.asarray(result, dtype=object)


def fit_transformer(rows, set_name, *, linear):
    names = feature_schema()['columns'][set_name]
    numeric = [index for index, name in enumerate(names) if name not in CATEGORIES]
    categorical = [index for index, name in enumerate(names) if name in CATEGORIES]
    parts = [('numeric', StandardScaler() if linear else 'passthrough', numeric)]
    if categorical:
        parts.append(('categorical', OneHotEncoder(handle_unknown='ignore',
                                                   sparse_output=False), categorical))
    transformer = ColumnTransformer(parts, sparse_threshold=0)
    data = np.asarray(transformer.fit_transform(matrix(rows, names)), dtype=float)
    if not np.isfinite(data).all():
        raise ValueError('Transformacion de entrenamiento no finita.')
    return transformer, data


def transform(transformer, rows, set_name):
    data = np.asarray(transformer.transform(
        matrix(rows, feature_schema()['columns'][set_name])), dtype=float)
    if not np.isfinite(data).all():
        raise ValueError('Transformacion de prueba no finita.')
    return data


def metadata(transformer, set_name, *, linear, train_rows):
    categories = {}
    if 'categorical' in transformer.named_transformers_:
        names = [name for name in feature_schema()['columns'][set_name] if name in CATEGORIES]
        categories = {name: list(values) for name, values in zip(
            names, transformer.named_transformers_['categorical'].categories_)}
    return {'feature_set': set_name, 'fit_rows': len(train_rows),
            'fit_max_decision_at_utc': max(row['decision_at_utc'] for row in train_rows),
            'linear_numeric_scaling': linear, 'unseen_category': 'one-hot all zeros',
            'train_categories': categories,
            'output_columns': int(transformer.transform(matrix(train_rows[:1],
                feature_schema()['columns'][set_name])).shape[1])}
