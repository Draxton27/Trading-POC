"""Verified Phase 38E observations and their Phase 38D IEX raw bars."""
from pathlib import Path

from ml.phase40a.bear_audit import load_verified
from ml.phase40c1.temporal_features import load_history


def load_sources(history, run):
    joined, observations, predictions, report, run_hashes, drift = load_verified(run)
    bars, calendar, history_hashes, query = load_history(history, report_to_manifest(run))
    index = {(row['scenario'], row['bar_start_utc']): row for row in observations}
    if len(index) != len(observations):
        raise ValueError('Observaciones originales duplicadas.')
    pairs = []
    for prediction in predictions:
        key = (prediction['scenario'], prediction['bar_start_utc'])
        observation = index.get(key)
        if observation is None:
            raise ValueError('Predicción sin observación original.')
        pairs.append((observation, prediction))
    if len(pairs) != len(predictions):
        raise ValueError('Cobertura de predicciones incompleta.')
    return {'pairs': pairs, 'observations': observations, 'bars': bars, 'calendar': calendar,
            'joined': joined, 'report': report, 'query': query,
            'run_hashes': run_hashes, 'history_hashes': history_hashes,
            'code_snapshot_drift': drift}


def report_to_manifest(run):
    import json
    return json.loads((Path(run) / 'manifest.json').read_text(encoding='utf8'))
