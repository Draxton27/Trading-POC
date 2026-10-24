"""Reconstruct Phase 38E's external folds without fitting or changing XGBoost."""
from __future__ import annotations

import csv
import json
from pathlib import Path

from ml.phase28.train import CLASSES, FEATURES, arrays, inner_early_stop
from ml.phase38b.replay import folds
from ml.phase38c.replay import training_before
from ml.phase40a.bear_audit import load_verified, probability_vector


def _same_rows(actual, expected, name):
    if actual != expected:
        raise ValueError(f'{name}: las filas externas no coinciden con Fase 38E.')


def reconstruct(source, *, minimum_train_sessions=252, test_sessions=126, loader=load_verified):
    """Return validated fold plans. No future label is exposed to model input.

    The source loader verifies every declared file, label, feature, model SHA and
    the historical code-snapshot drift. All training labels are strictly before
    the external cutoff and from earlier sessions; the inner block is purged too.
    """
    joined, observations, predictions, report, declared, drift = loader(source)
    policy = report['fold_policy']
    if (policy['minimum_train_sessions'] != minimum_train_sessions or
            policy['test_sessions'] != test_sessions or report['features'] != list(FEATURES) or
            report['classes'] != list(CLASSES)):
        raise ValueError('Política de folds o contrato de variables incompatible.')
    prediction_index = {(r['scenario'], r['bar_start_utc']): r for r in predictions}
    if len(prediction_index) != len(predictions):
        raise ValueError('Predicciones externas duplicadas.')
    plans = {}
    for scenario in ('ideal', 'delayed'):
        selected = [r for r in observations if r['scenario'] == scenario]
        expected_folds = report['scenarios'][scenario]['folds']
        generated = list(folds(selected, minimum_train_sessions, test_sessions))
        if len(generated) != len(expected_folds) or not generated:
            raise ValueError('Cantidad de folds externos incompatible.')
        plans[scenario] = []
        for (number, test), original in zip(generated, expected_folds):
            cutoff = min(r['available_at_utc'] for r in test)
            first_day = min(r['session_date_ny'] for r in test)
            original_predictions = [r for r in predictions if r['scenario'] == scenario and int(r['fold']) == number]
            _same_rows([r['bar_start_utc'] for r in test],
                       [r['bar_start_utc'] for r in original_predictions], 'Orden de velas')
            if (int(original['fold']) != number or original['cutoff_utc'] != cutoff or
                    original['first_test_session'] != first_day or
                    original['last_test_session'] != max(r['session_date_ny'] for r in test) or
                    original['test_rows'] != len(test)):
                raise ValueError('Corte externo distinto de Fase 38E.')
            train = training_before(selected, cutoff, first_day)
            if (len(train) != original['training_rows'] or not train or
                    max(r['label_available_at_utc'] for r in train) != original['max_training_label_available_at_utc'] or
                    any(r['session_date_ny'] >= first_day or r['label_available_at_utc'] >= cutoff for r in train)):
                raise ValueError('Entrenamiento causal distinto del fold original.')
            core, early = inner_early_stop(train)
            early_cutoff = early[0]['observed_at_utc']
            if (len(core) != original['selection_rows'] or len(early) != original['early_stop_rows'] or
                    any(r['label_available_at_utc'] >= early_cutoff for r in core) or
                    set(r['label'] for r in train) != set(CLASSES) or
                    set(r['label'] for r in core) != set(CLASSES) or
                    set(r['label'] for r in early) != set(CLASSES)):
                raise ValueError('Bloque interno incompatible o con clases ausentes.')
            resolved = []
            for observation, prediction in zip(test, original_predictions):
                if prediction['inference_at_utc'] != observation['available_at_utc']:
                    raise ValueError('Predicción posterior o anterior a la disponibilidad.')
                if observation['label'] is None:
                    continue
                if observation['label_available_at_utc'] <= cutoff:
                    raise ValueError('Etiqueta de prueba disponible antes del corte.')
                resolved.append((observation, prediction))
            if len(resolved) != original['resolved_rows']:
                raise ValueError('Objetivos evaluables distintos de Fase 38E.')
            plans[scenario].append({'scenario': scenario, 'fold': number, 'cutoff_utc': cutoff,
                                    'first_test_session': first_day, 'train': train, 'core': core,
                                    'early': early, 'early_cutoff_utc': early_cutoff,
                                    'test': test, 'original_predictions': original_predictions,
                                    'resolved': resolved, 'source_fold': original})
    return {'plans': plans, 'source_report': report, 'source_hashes': declared,
            'code_snapshot_drift': drift, 'observation_count': len(observations),
            'prediction_count': len(predictions), 'joined_count': len(joined)}


def original_probabilities(prediction, name):
    if name not in ('xgboost', 'frequency', 'linear'):
        raise ValueError('Comparador no autorizado.')
    return probability_vector(prediction[f'prob_{name}'])
