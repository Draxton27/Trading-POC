"""Pure targets from verified IEX raw bars and frozen Phase 38E observations."""
from collections import Counter

from ml.phase41c.target_audit import exact_original_parity
from ml.phase41c.trajectory import BAR, future_bars, trajectory
from ml.phase41d.registry import DEFINITIONS, EXPECTED_SHA256, digest, validate_registry
from ml.phase40c1.temporal_features import utc

TARGET_IDS = tuple(item.target_id for item in DEFINITIONS)


def barrier_order(path):
    down = path['first_downward_threshold_touch']
    up = path['first_upward_threshold_touch']
    if down is None and up is None:
        return 'NEITHER_TOUCHED', 'NEITHER'
    if down is None:
        return 'UP_FIRST_OR_ONLY_UP', 'UP_ONLY'
    if up is None:
        return 'DOWN_FIRST_OR_ONLY_DOWN', 'DOWN_ONLY'
    if down == up:
        return 'BOTH_FIRST_SAME_BAR_AMBIGUOUS', 'BOTH'
    return ('DOWN_FIRST_OR_ONLY_DOWN' if down < up else 'UP_FIRST_OR_ONLY_UP'), 'BOTH'


def target_values(observation, future):
    """All outcome-only calculations reuse 41C's path and the original 38E label."""
    path = trajectory(observation, future)
    if (observation['label'] != path['terminal_class_at_0_5_atr'] or
            observation['label_entry_open'] != path['entry_open'] or
            observation['label_exit_close'] != path['exit_close'] or
            observation['label_available_at_utc'] != path['label_available_at_utc']):
        raise ValueError('Paridad del objetivo 38E incumplida.')
    persistent = (observation['label'] == 'BAJISTA' and path['closes_below_entry'] >= 3
                  and path['max_consecutive_closes_below_entry'] >= 3)
    order, reach = barrier_order(path)
    return (
        {TARGET_IDS[0]: observation['label'],
         TARGET_IDS[1]: 'DOWN_TOUCH' if path['first_downward_threshold_touch'] is not None else 'NO_DOWN_TOUCH',
         TARGET_IDS[2]: 'PERSISTENT_BEAR' if persistent else 'NOT_PERSISTENT_BEAR'},
        {'barrier_order': order, 'barrier_reach': reach,
         'first_down_bar': path['first_downward_threshold_touch'],
         'first_up_bar': path['first_upward_threshold_touch'],
         'any_same_bar_both_touched': path['any_same_bar_both_touched'],
         'first_touch_order_ambiguous': path['first_touch_order_ambiguous']},
        path,
    )


def source_hash(observation, future, history_hashes):
    """Bind the row to the verified 38D snapshot, 38E observation and four bars."""
    return digest({'history_strict_15m_sha256': history_hashes['strict-15m.csv'],
                   'history_calendar_sha256': history_hashes['calendar.json'],
                   'observation': observation,
                   'future_bars': [dict(timestamp=b.timestamp, open=b.open, high=b.high,
                                        low=b.low, close=b.close, volume=b.volume) for b in (future or [])]})


def build_targets(source):
    validate_registry()
    bar_index = {bar.timestamp: bar for bar in source['bars']}
    if len(bar_index) != len(source['bars']):
        raise ValueError('Barras IEX duplicadas.')
    for observation in source['observations']:
        exact_original_parity(observation, bar_index, source['calendar'])
    rows, auxiliary = [], []
    seen = set()
    for observation, prediction in source['pairs']:
        key = observation['scenario'], observation['bar_start_utc']
        if key in seen or prediction['scenario'] != key[0] or prediction['bar_start_utc'] != key[1]:
            raise ValueError('Predicción u observación duplicada o desalineada.')
        seen.add(key)
        future, reason = future_bars(observation, bar_index, source['calendar'], 4)
        values, detail, path = target_values(observation, future) if future else (None, None, None)
        if (future is None) != (observation['label'] is None):
            raise ValueError('Cobertura de etiqueta original incompatible.')
        if future:
            close = path['label_available_at_utc']
        elif reason == 'FUTURE_BARS_MISSING' and observation['reference_entry_at_utc']:
            close = (utc(observation['reference_entry_at_utc']) + 4 * BAR).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        else:
            close = None
        common = {'scenario': key[0], 'fold': int(prediction['fold']),
                  'session_date_ny': observation['session_date_ny'], 'bar_start_utc': key[1],
                  'decision_at_utc': observation['available_at_utc'],
                  'reference_entry_at_utc': observation['reference_entry_at_utc'],
                  'reference_entry_open': future[0].open if future else None,
                  'atr14_at_decision': observation['label_atr14_price_units'],
                  'target_horizon_end_utc': close,
                  'target_known_at_utc': close if future else None,
                  'historical_received_at_utc': None,
                  'availability_basis': 'THEORETICAL_BAR_CLOSE',
                  'availability_status': 'HISTORICAL_THEORETICAL' if future else reason,
                  'research_status': 'HISTORICAL_EXPLORED',
                  'source_hash': source_hash(observation, future, source['history_hashes'])}
        if future:
            auxiliary.append({**common, **detail})
        for definition in DEFINITIONS:
            rows.append({**common, 'target_id': definition.target_id,
                         'target_version': definition.target_version,
                         'target_definition_sha256': EXPECTED_SHA256[definition.target_id],
                         'target_value': values[definition.target_id] if values else None})
    if len(seen) != len(source['pairs']):
        raise ValueError('Cobertura de predicciones incompleta.')
    return rows, auxiliary
