"""Descriptive target availability and class distribution only."""
from collections import Counter, defaultdict

from ml.phase41d.targets import TARGET_IDS


def summarize(rows, auxiliary):
    result = {}
    for scenario in ('delayed', 'ideal'):
        result[scenario] = {}
        for target_id in TARGET_IDS:
            subset = [row for row in rows if row['scenario'] == scenario and row['target_id'] == target_id]
            available = [row for row in subset if row['target_value'] is not None]
            result[scenario][target_id] = {
                'observations': len(subset), 'available': len(available),
                'sessions_available': len({row['session_date_ny'] for row in available}),
                'classes': dict(Counter(row['target_value'] for row in available)),
                'exclusions': dict(Counter(row['availability_status'] for row in subset
                                           if row['target_value'] is None)),
                'by_fold': {str(fold): {'available': sum(row['fold'] == fold for row in available),
                                       'excluded': sum(row['fold'] == fold for row in subset) -
                                                   sum(row['fold'] == fold for row in available)}
                            for fold in sorted({row['fold'] for row in subset})},
            }
        aux = [row for row in auxiliary if row['scenario'] == scenario]
        result[scenario]['first_barrier_diagnostic'] = {
            'available': len(aux), 'classes': dict(Counter(row['barrier_order'] for row in aux)),
            'reach': dict(Counter(row['barrier_reach'] for row in aux)),
            'any_same_bar_both_touched': sum(row['any_same_bar_both_touched'] for row in aux),
            'first_touch_order_ambiguous': sum(row['first_touch_order_ambiguous'] for row in aux),
        }
    return result
