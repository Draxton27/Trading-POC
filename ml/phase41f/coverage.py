"""Explicit training and external exclusions before comparing feature sets."""
from collections import Counter


def audit(plan, observations, rebuilt, targets):
    output = []
    for scenario, folds in plan['plans'].items():
        selected = [row for row in observations if row['scenario'] == scenario]
        for fold in folds:
            for target in targets:
                for side in ('training', 'external'):
                    candidates = ([row for row in selected if
                                   row['session_date_ny'] < fold['first_test_session'] and
                                   row['available_at_utc'] < fold['cutoff_utc']]
                                  if side == 'training' else fold['test'])
                    reasons = Counter()
                    counts = Counter()
                    class_counts = {feature: Counter() for feature in ('F0', 'F1', 'F2')}
                    for original in candidates:
                        row = rebuilt[scenario, original['bar_start_utc']]
                        label = row['targets'][target]
                        known = row['target_known_at_utc']
                        if label is None:
                            reasons['TARGET_UNAVAILABLE'] += 1
                            continue
                        if side == 'training' and (known is None or known >= fold['cutoff_utc']):
                            reasons['TARGET_NOT_KNOWN_BEFORE_CUTOFF'] += 1
                            continue
                        counts['target_available'] += 1
                        for feature in ('F0', 'F1', 'F2'):
                            if row['feature_availability'][feature]:
                                counts[feature] += 1
                                class_counts[feature][label] += 1
                            else:
                                reasons[f'{feature}_INCOMPLETE'] += 1
                    output.append({'scenario': scenario, 'fold': fold['fold'],
                                   'target': target, 'side': side,
                                   'candidates': len(candidates),
                                   'target_available': counts['target_available'],
                                   'eligible': {name: counts[name] for name in ('F0', 'F1', 'F2')},
                                   'classes_by_feature_set': {
                                       name: dict(sorted(values.items())) for name, values in class_counts.items()},
                                   'exclusion_reasons': dict(sorted(reasons.items()))})
    return {'schema': 'phase41f-training-feature-coverage-v1',
            'groups': output,
            'policy': 'Each feature set requires a complete target; training additionally requires label availability strictly before the external cutoff.'}
