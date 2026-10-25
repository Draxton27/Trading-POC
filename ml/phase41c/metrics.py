"""Descriptive summaries and session-clustered uncertainty."""
from collections import Counter, defaultdict
from datetime import date

import numpy as np

from ml.phase28.train import CLASSES
from ml.phase41c.trajectory import THRESHOLDS, classify


def describe(values):
    if not values:
        return {'n': 0, 'median': None, 'p25': None, 'p75': None}
    return {'n': len(values), 'median': float(np.median(values)),
            'p25': float(np.percentile(values, 25)),
            'p75': float(np.percentile(values, 75))}


def proportion(rows, predicate, iterations=300, seed=41):
    """Resample complete NYSE sessions, keeping overlapping observations together."""
    if not rows:
        return {'n': 0, 'sessions': 0, 'fraction': None, 'ci95': None}
    groups = defaultdict(list)
    for row in rows:
        groups[row['session']].append(row)
    value = sum(predicate(row) for row in rows) / len(rows)
    if len(groups) < 30:
        return {'n': len(rows), 'sessions': len(groups), 'fraction': value, 'ci95': None,
                'status': 'INSUFFICIENT_SESSIONS'}
    sessions = sorted(groups)
    rng = np.random.default_rng(seed)
    samples = []
    for _ in range(iterations):
        chosen = rng.integers(0, len(sessions), len(sessions))
        sample = [row for index in chosen for row in groups[sessions[index]]]
        samples.append(sum(predicate(row) for row in sample) / len(sample))
    return {'n': len(rows), 'sessions': len(groups), 'fraction': value,
            'ci95': [float(np.percentile(samples, 2.5)), float(np.percentile(samples, 97.5))],
            'status': 'EXPLORATORY'}


def path_summary(rows):
    if not rows:
        return {'observations': 0, 'sessions': 0}
    paths = [row['paths']['4'] for row in rows]
    return {
        'observations': len(rows), 'sessions': len({row['session'] for row in rows}),
        'original_labels': dict(Counter(row['label'] for row in rows)),
        'trajectory_categories': dict(Counter(path['trajectory_category'] for path in paths)),
        'downward_excursion_atr': describe([path['downward_excursion_atr'] for path in paths]),
        'upward_excursion_atr': describe([path['upward_excursion_atr'] for path in paths]),
        'net_change_atr': describe([path['net_change_atr'] for path in paths]),
        'closes_below_entry': describe([path['closes_below_entry'] for path in paths]),
        'max_consecutive_closes_below_entry': describe([path['max_consecutive_closes_below_entry'] for path in paths]),
        'bearish_candle_bodies': describe([path['bearish_candle_bodies'] for path in paths]),
        'recovery_from_low_atr': describe([path['recovery_from_low_atr'] for path in paths]),
        'original_bear_probability': describe([row['probability_vector'][1] for row in rows]),
        'downward_touch': proportion(rows, lambda r: r['paths']['4']['first_downward_threshold_touch'] is not None),
        'both_barriers_touched': proportion(rows, lambda r: r['paths']['4']['first_downward_threshold_touch'] is not None
                                             and r['paths']['4']['first_upward_threshold_touch'] is not None),
        'any_same_bar_both_touched': proportion(rows, lambda r: r['paths']['4']['any_same_bar_both_touched']),
        'first_touch_order_ambiguous': proportion(rows, lambda r: r['paths']['4']['first_touch_order_ambiguous']),
        # These descriptive properties may overlap; neither is an Investep rule.
        'sustained_terminal_bear': proportion(rows, lambda r: r['paths']['4']['terminal_class_at_0_5_atr'] == 'BAJISTA'
            and r['paths']['4']['closes_below_entry'] >= 3
            and r['paths']['4']['max_consecutive_closes_below_entry'] >= 3),
        'recovered_at_least_half_atr': proportion(rows, lambda r: r['paths']['4']['recovery_from_low_atr'] >= .5),
        'up_then_down_distinct_bars': proportion(rows, lambda r: r['paths']['4']['first_upward_threshold_touch'] is not None
            and r['paths']['4']['first_downward_threshold_touch'] is not None
            and r['paths']['4']['first_upward_threshold_touch'] < r['paths']['4']['first_downward_threshold_touch']),
    }


def target_sensitivity(rows):
    """All comparisons here retain the original entry, ATR, and frozen predictions."""
    output = {}
    for scenario in ('delayed', 'ideal'):
        sample = [row for row in rows if row['scenario'] == scenario and '4' in row['paths']]
        thresholds = {}
        for threshold in THRESHOLDS:
            labeled = [(row, classify(row['paths']['4']['net_change'], row['atr'], threshold))
                       for row in sample]
            thresholds[str(threshold)] = {
                'distribution': dict(Counter(label for _, label in labeled)),
                'changed_from_original': sum(row['label'] != label for row, label in labeled),
                'transitions': {original: dict(Counter(label for row, label in labeled
                                             if row['label'] == original)) for original in CLASSES},
                'bear_prevalence': sum(label == 'BAJISTA' for _, label in labeled)/len(labeled) if labeled else None,
                # Fixed descriptive 0.1 ATR distance from either boundary.
                'near_boundary_0_1_atr': sum(min(abs(row['paths']['4']['net_change_atr']-threshold),
                    abs(row['paths']['4']['net_change_atr']+threshold)) <= .1 for row, _ in labeled),
                'by_fold': {str(fold): dict(Counter(label for row, label in labeled if row['fold'] == fold))
                            for fold in sorted({row['fold'] for row in sample})},
                'by_month': {month: dict(Counter(label for row, label in labeled if row['session'][:7] == month))
                             for month in sorted({row['session'][:7] for row in sample})},
            }
        common = [row for row in sample if all(str(h) in row['paths'] for h in (2, 4, 6))]
        horizons = {}
        for horizon in (2, 4, 6):
            own = [row for row in rows if row['scenario'] == scenario and str(horizon) in row['paths']]
            paired = [row['paths'][str(horizon)] for row in common]
            horizons[str(horizon)] = {
                'own_coverage': len(own), 'common_coverage': len(common),
                'own_distribution_0_5_atr': dict(Counter(row['paths'][str(horizon)]['terminal_class_at_0_5_atr'] for row in own)),
                'common_distribution_0_5_atr': dict(Counter(path['terminal_class_at_0_5_atr'] for path in paired)),
                'common_net_change_atr': describe([path['net_change_atr'] for path in paired]),
                'common_downward_touch': sum(path['first_downward_threshold_touch'] is not None for path in paired),
                'label_available_at_utc_is_horizon_specific': True,
            }
        output[scenario] = {'thresholds': thresholds, 'horizons': horizons,
                            'common_sessions': len({row['session'] for row in common}),
                            'first_30_minute_downward_touch': sum(row['paths']['6']['first_downward_threshold_touch'] in (1, 2) for row in common),
                            'down_by_60_and_90_minutes': sum(row['paths']['4']['terminal_class_at_0_5_atr'] == 'BAJISTA'
                                and row['paths']['6']['terminal_class_at_0_5_atr'] == 'BAJISTA' for row in common),
                            'down_by_60_recovered_by_90_minutes': sum(row['paths']['4']['terminal_class_at_0_5_atr'] == 'BAJISTA'
                                and row['paths']['6']['terminal_class_at_0_5_atr'] != 'BAJISTA' for row in common)}
    return output


def breakdown(rows):
    output = {}
    for scenario in ('delayed', 'ideal'):
        subset = [row for row in rows if row['scenario'] == scenario and '4' in row['paths']]
        names = {
            'bear_to_lateral': ('BAJISTA', 'LATERAL'),
            'lateral_to_lateral': ('LATERAL', 'LATERAL'),
            'bear_to_bear': ('BAJISTA', 'BAJISTA'),
            'bear_to_bull': ('BAJISTA', 'ALCISTA'),
        }
        output[scenario] = {
            'overall': path_summary(subset),
            'groups': {name: path_summary([row for row in subset if
                      (row['label'], row['predicted_class']) == pair]) for name, pair in names.items()},
            'by_original_label': {label: path_summary([row for row in subset if row['label'] == label])
                                  for label in CLASSES},
            'by_fold': {str(fold): path_summary([row for row in subset if row['fold'] == fold])
                        for fold in sorted({row['fold'] for row in subset})},
            'by_month': {month: path_summary([row for row in subset if row['session'][:7] == month])
                         for month in sorted({row['session'][:7] for row in subset})},
            'by_week': {week: path_summary([row for row in subset if
                          f'{date.fromisoformat(row["session"]).isocalendar().year}-W{date.fromisoformat(row["session"]).isocalendar().week:02d}' == week])
                        for week in sorted({f'{date.fromisoformat(row["session"]).isocalendar().year}-W{date.fromisoformat(row["session"]).isocalendar().week:02d}'
                                            for row in subset})},
        }
    return output
