"""Join only current/past features; frozen targets are copied afterward."""
from ml.phase40c1.temporal_features import BAR, utc
from ml.phase41d.protocol import F0, F1_ADDED, F2_ADDED
from ml.phase41d.registry import digest
from ml.phase41e.candle_geometry import geometry
from ml.phase41e.candle_sequences import sequence_index
from ml.phase41e.feature_schema import CATEGORIES, schema_sha256, validate_features


def bridge_queries(source):
    queries = []
    for observation, prediction in source['pairs']:
        if observation['bar_start_utc'] != prediction['bar_start_utc']:
            raise ValueError('Observación y fold desalineados.')
        queries.append({'scenario': observation['scenario'], 'fold': int(prediction['fold']),
                        'barStartUtc': observation['bar_start_utc'],
                        'barEndUtc': observation['bar_end_utc'],
                        'decisionAtUtc': observation['available_at_utc'],
                        'featureSha256': observation['feature_sha256'],
                        'features': observation['features']})
    return queries


def complete(values, names):
    return all(values[name] is not None and
               (name not in CATEGORIES or values[name] not in
                ('UNAVAILABLE', 'INSUFFICIENT_DATA')) for name in names)


def build_rows(source, contexts):
    bars = {bar.timestamp: bar for bar in source['bars']}
    sequences = sequence_index(source['bars'], source['calendar'])
    rows, parity = [], {'f0_original_sha256_checked_by_node': True,
                        'f0_original_values_equal': 0, 'f1_cross_scenario_equal': 0,
                        'targets_41d_equal': 0, 'no_future_sip': 0,
                        'bridge_engine': 'phase41b-context.ts + investep-technical-context.ts'}
    pair_features = {}
    schema_hash = schema_sha256()
    for observation, prediction in source['pairs']:
        key = (observation['scenario'], observation['bar_start_utc'])
        bar = bars.get(key[1])
        if bar is None or bar.start + BAR > utc(observation['available_at_utc']):
            raise ValueError('Vela IEX ausente o futura.')
        f0 = observation['features']
        if list(f0) != list(F0) or any(not isinstance(f0[name], (int, float)) for name in F0):
            raise ValueError('F0 original incompatible.')
        f1 = {**geometry(bar), **sequences[key[1]]}
        if list(f1) != list(F1_ADDED):
            raise ValueError('Orden F1 incompatible.')
        if key[1] in pair_features and pair_features[key[1]] != (f0, f1):
            raise ValueError('F0/F1 difiere entre escenarios.')
        if key[1] in pair_features:
            parity['f1_cross_scenario_equal'] += 1
        pair_features[key[1]] = (f0, f1)
        parity['f0_original_values_equal'] += 1
        original_targets = source['targets'][key]
        parity['targets_41d_equal'] += len(original_targets)
        for delay in (15, 20, 30):
            context = contexts[(key[0], key[1], delay)]
            if (context['fold'] != int(prediction['fold']) or
                    context['decisionAtUtc'] != observation['available_at_utc']):
                raise ValueError('Contexto SIP desalineado.')
            audit = context['audit']
            if audit['sipBarEndUtc'] is not None and audit['sipBarEndUtc'] > observation['available_at_utc']:
                raise ValueError('SIP posterior a la decisión.')
            parity['no_future_sip'] += 1
            values = {**f0, **f1, **context['features']}
            validate_features(values)
            if list(context['features']) != list(F2_ADDED):
                raise ValueError('F2 alterado.')
            availability = {'F0': complete(values, F0),
                            'F1': complete(values, (*F0, *F1_ADDED)),
                            'F2': complete(values, (*F0, *F1_ADDED, *F2_ADDED))}
            row = {'scenario': key[0], 'fold': int(prediction['fold']),
                   'session_date_ny': observation['session_date_ny'],
                   'bar_start_utc': key[1], 'bar_end_utc': observation['bar_end_utc'],
                   'decision_at_utc': observation['available_at_utc'],
                   'last_iex_feature_bar_end_utc': observation['bar_end_utc'],
                   'last_sip_feature_bar_end_utc': audit['sipBarEndUtc'],
                   'last_sip_assumed_available_at_utc': audit['assumedAvailableAtUtc'],
                   'sip_delay_minutes': delay, 'feature_availability_status':
                   'F2_COMPLETE' if availability['F2'] else audit['reason'] if not availability['F1']
                   else 'F2_INCOMPLETE', 'feature_schema_sha256': schema_hash,
                   'original_feature_sha256': observation['feature_sha256'],
                   'features': values, 'feature_availability': availability,
                   'missing_columns': [name for name, value in values.items()
                                       if value is None or name in CATEGORIES and value in
                                       ('UNAVAILABLE', 'INSUFFICIENT_DATA')],
                   'context_audit': audit,
                   'targets': {name: target['target_value'] for name, target in original_targets.items()},
                   'target_availability': {name: target['availability_status']
                                           for name, target in original_targets.items()},
                   'target_source_hash': original_targets[next(iter(original_targets))]['source_hash']}
            row['row_sha256'] = digest({k: v for k, v in row.items() if k != 'row_sha256'})
            rows.append(row)
    if len(rows) != len(source['pairs']) * 3:
        raise ValueError('Filas faltantes.')
    return rows, parity
