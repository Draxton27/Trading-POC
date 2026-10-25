"""Keep Phase 38E fold membership and purge by the frozen target's availability."""
from __future__ import annotations

from ml.phase28.train import inner_early_stop


def eligible_rows(plan, rebuilt, target, feature_set):
    cutoff = plan['cutoff_utc']
    first_day = plan['first_test_session']
    def ready(original, training):
        row = rebuilt[(plan['scenario'], original['bar_start_utc'])]
        known = row['target_known_at_utc']
        if not row['feature_availability'][feature_set] or row['targets'][target] is None:
            return None
        if training and (row['session_date_ny'] >= first_day or known >= cutoff or
                         row['decision_at_utc'] >= cutoff):
            raise ValueError('Entrenamiento usa una etiqueta o variable posterior al fold.')
        if not training and row['fold'] != plan['fold']:
            raise ValueError('Fold externo desalineado.')
        return {**row, 'label': row['targets'][target],
                'observed_at_utc': row['decision_at_utc'],
                'label_available_at_utc': known}
    train = [value for original in plan['train'] if
             (value := ready(original, True)) is not None]
    test = [value for original, _ in plan['resolved'] if
            (value := ready(original, False)) is not None]
    if not train or not test:
        raise ValueError('Poblacion causal insuficiente para un fold.')
    if set((row['scenario'], row['bar_start_utc']) for row in train) & set(
            (row['scenario'], row['bar_start_utc']) for row in test):
        raise ValueError('Filas externas incluidas en entrenamiento.')
    return train, test


def inner_blocks(train):
    core, early = inner_early_stop(train)
    first_early = min(row['decision_at_utc'] for row in early)
    if (max(row['target_known_at_utc'] for row in core) >= first_early or
            max(row['session_date_ny'] for row in core) >= min(row['session_date_ny'] for row in early)):
        raise ValueError('Bloque interno con fuga temporal.')
    return core, early
