"""Reconstruct frozen labels and audit post-entry paths without fitting models."""
from collections import Counter

from ml.phase28.train import CLASSES
from ml.phase40a.bear_audit import probability_vector
from ml.phase41c.sources import load_sources
from ml.phase41c.trajectory import HORIZONS, classify, future_bars, trajectory
from ml.phase41c.metrics import breakdown, target_sensitivity


def exact_original_parity(observation, bar_index, calendar):
    future, reason = future_bars(observation, bar_index, calendar, 4)
    if observation['label'] is None:
        if observation['exclusion'] == 'MARKET_CLOSE' and reason not in ('MARKET_CLOSE', 'NO_SCHEDULED_ENTRY'):
            raise ValueError('Exclusión original de cierre incompatible.')
        if observation['exclusion'] == 'FUTURE_BARS_MISSING' and reason != 'FUTURE_BARS_MISSING':
            raise ValueError('Exclusión original de hueco incompatible.')
        return
    if reason or not future:
        raise ValueError('Etiqueta original sin cuatro velas completas.')
    path = trajectory(observation, future)
    if (path['entry_open'] != observation['label_entry_open'] or
            path['exit_close'] != observation['label_exit_close'] or
            path['label_available_at_utc'] != observation['label_available_at_utc'] or
            classify(path['net_change'], observation['label_atr14_price_units']) != observation['label']):
        raise ValueError('Paridad exacta de etiqueta, entrada, ATR o salida 38E falló.')


def audit_sources(source):
    bars = {(bar.timestamp): bar for bar in source['bars']}
    calendar = source['calendar']
    for observation in source['observations']:
        exact_original_parity(observation, bars, calendar)
    index = {(obs['scenario'], obs['bar_start_utc']): obs for obs in source['observations']}
    rows = []
    reasons = {scenario: {str(h): Counter() for h in HORIZONS} for scenario in ('delayed', 'ideal')}
    for observation, prediction in source['pairs']:
        if index[(observation['scenario'], observation['bar_start_utc'])] is not observation:
            raise ValueError('Unión de observaciones inestable.')
        probabilities = probability_vector(prediction['prob_xgboost'])
        row = {'scenario': observation['scenario'], 'fold': int(prediction['fold']),
               'session': observation['session_date_ny'], 'bar_start_utc': observation['bar_start_utc'],
               'available_at_utc': observation['available_at_utc'],
               'reference_entry_at_utc': observation['reference_entry_at_utc'],
               'original_label_available_at_utc': observation['label_available_at_utc'],
               'original_entry_open': observation['label_entry_open'],
               'original_exit_close': observation['label_exit_close'],
               'atr': observation['label_atr14_price_units'],
               'label': observation['label'], 'original_exclusion': observation['exclusion'],
               'probability_vector': probabilities,
               'predicted_class': CLASSES[max(range(3), key=lambda i: probabilities[i])],
               'paths': {}, 'horizon_exclusions': {}}
        for horizon in HORIZONS:
            future, reason = future_bars(observation, bars, calendar, horizon)
            if reason:
                row['horizon_exclusions'][str(horizon)] = reason
                reasons[observation['scenario']][str(horizon)][reason] += 1
            else:
                row['paths'][str(horizon)] = trajectory(observation, future)
                reasons[observation['scenario']][str(horizon)]['AVAILABLE'] += 1
        if observation['label'] is not None and '4' not in row['paths']:
            raise ValueError('Predicción evaluable sin horizonte original.')
        rows.append(row)
    coverage = {scenario: {h: dict(counts) for h, counts in horizons.items()}
                for scenario, horizons in reasons.items()}
    return rows, coverage


def run_audit(history, run):
    source = load_sources(history, run)
    rows, coverage = audit_sources(source)
    return {'source': source, 'rows': rows, 'coverage': coverage,
            'trajectories': breakdown(rows), 'sensitivity': target_sensitivity(rows)}
