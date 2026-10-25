"""Rebuild earlier 38E observations with the frozen 41E feature functions."""
from __future__ import annotations

import gc
import json
from pathlib import Path

from ml.phase41c.target_audit import exact_original_parity
from ml.phase41c.trajectory import future_bars
from ml.phase41d.protocol import F0, F1_ADDED, F2_ADDED
from ml.phase41d.registry import digest
from ml.phase41d.targets import TARGET_IDS, target_values, source_hash
from ml.phase41e.candle_geometry import geometry
from ml.phase41e.candle_sequences import sequence_index
from ml.phase41e.feature_join import complete
from ml.phase41e.feature_schema import schema_sha256, validate_features
from ml.phase41e.report import context_bridge
from ml.phase41e.sources import verified_contexts


def external_rows(directory: Path, source):
    """Compact the immutable external rows; all three delay copies remain checksum protected."""
    payload = json.loads((directory / 'features.json').read_text(encoding='utf8'))
    if payload.get('schema') != 'phase41e-features-v1':
        raise ValueError('Matriz externa 41E incompatible.')
    rows = {}
    for row in payload['rows']:
        if row['sip_delay_minutes'] != 20:
            continue
        key = row['scenario'], row['bar_start_utc']
        if key in rows or row['feature_schema_sha256'] != schema_sha256() or row['row_sha256'] != digest({
                name: value for name, value in row.items() if name != 'row_sha256'}):
            raise ValueError('Fila externa 41E alterada o duplicada.')
        rows[key] = {name: row[name] for name in ('scenario', 'fold', 'session_date_ny',
            'bar_start_utc', 'decision_at_utc', 'features', 'feature_availability',
            'feature_availability_reasons', 'targets', 'target_availability',
            'original_feature_sha256', 'row_sha256')}
    if len(rows) != len(source['pairs']):
        raise ValueError('Cobertura externa 41E incompleta.')
    del payload
    gc.collect()
    return rows


def reconstruct_rows(source, external, sip_csv: Path, work: Path):
    """One causal 41A/41B bridge pass covers training and external parity."""
    observations = source['observations']
    predictions = {(o['scenario'], o['bar_start_utc']): p for o, p in source['pairs']}
    queries = [{'scenario': o['scenario'], 'fold': int(predictions[key]['fold']) if
                (key := (o['scenario'], o['bar_start_utc'])) in predictions else 0,
                'barStartUtc': o['bar_start_utc'], 'barEndUtc': o['bar_end_utc'],
                'decisionAtUtc': o['available_at_utc'], 'featureSha256': o['feature_sha256'],
                'features': o['features']} for o in observations]
    context_path = context_bridge(sip_csv, queries, work)
    contexts, context_meta = verified_contexts(context_path, sip_csv, queries)
    expected_sip = source['phase41e_manifest']['source_sha256']['sip']
    if context_meta['sip_input_sha256'] != expected_sip:
        raise ValueError('SIP de entrenamiento diferente del SIP externo 41E.')
    bars = {bar.timestamp: bar for bar in source['bars']}
    sequences = sequence_index(source['bars'], source['calendar'])
    result = {}
    parity = {'external_rows_checked': 0, 'external_F0_equal': 0,
              'external_F1_equal': 0, 'external_F2_equal': 0,
              'external_targets_equal': 0, 'all_observations_reconstructed': 0,
              'context_sha256': context_meta['context_sha256']}
    for observation in observations:
        key = observation['scenario'], observation['bar_start_utc']
        exact_original_parity(observation, bars, source['calendar'])
        bar = bars.get(key[1])
        if bar is None or key[1] not in sequences:
            raise ValueError('Vela o ventana IEX original no reproducible.')
        f0 = observation['features']
        f1 = {**geometry(bar), **sequences[key[1]]}
        context = contexts[(key[0], key[1], 20)]
        audit = context['audit']
        if (audit['sipBarEndUtc'] is not None and
                audit['sipBarEndUtc'] > observation['available_at_utc']):
            raise ValueError('Contexto SIP posterior a la decision.')
        values = {**f0, **f1, **context['features']}
        if list(values) != [*F0, *F1_ADDED, *F2_ADDED]:
            raise ValueError('Orden de caracteristicas 41D alterado.')
        validate_features(values)
        available = {name: complete(values, columns) for name, columns in (
            ('F0', F0), ('F1', (*F0, *F1_ADDED)),
            ('F2', (*F0, *F1_ADDED, *F2_ADDED)))}
        future, _ = future_bars(observation, bars, source['calendar'], 4)
        if (future is None) != (observation['label'] is None):
            raise ValueError('Etiquetas reconstruidas no coinciden con 38E.')
        targets = target_values(observation, future)[0] if future else dict.fromkeys(TARGET_IDS)
        earlier = external.get(key)
        if earlier:
            if earlier['original_feature_sha256'] != observation['feature_sha256']:
                raise ValueError('SHA F0 externo diferente.')
            if {name: earlier['features'][name] for name in F0} != f0:
                raise ValueError('F0 externo diferente.')
            parity['external_F0_equal'] += 1
            if {name: earlier['features'][name] for name in F1_ADDED} != f1:
                raise ValueError('F1 externo diferente.')
            parity['external_F1_equal'] += 1
            if {name: earlier['features'][name] for name in F2_ADDED} != context['features']:
                raise ValueError('F2 externo diferente.')
            parity['external_F2_equal'] += 1
            if (earlier['targets'] != targets or earlier['feature_availability'] != available or
                    earlier['decision_at_utc'] != observation['available_at_utc'] or
                    earlier['fold'] != int(predictions[key]['fold'])):
                raise ValueError('Objetivo, disponibilidad o fold externo diferente.')
            parity['external_targets_equal'] += len(TARGET_IDS)
            parity['external_rows_checked'] += 1
        result[key] = {
            'scenario': key[0], 'fold': int(predictions[key]['fold']) if earlier else None,
            'session_date_ny': observation['session_date_ny'],
            'bar_start_utc': key[1], 'decision_at_utc': observation['available_at_utc'],
            'target_known_at_utc': observation['label_available_at_utc'],
            'features': values, 'feature_availability': available, 'targets': targets,
            'feature_sha256': digest(values),
            'original_feature_sha256': observation['feature_sha256'],
            'source_hash': source_hash(observation, future, source['history_hashes']),
            'historical_received_at_utc': None,
        }
        parity['all_observations_reconstructed'] += 1
    if parity['external_rows_checked'] != len(external) or len(result) != len(observations):
        raise ValueError('Paridad o reconstruccion incompleta.')
    return result, parity
