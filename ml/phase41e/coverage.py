"""Coverage of all rows, with common-population and missing-data accounting."""
from collections import Counter, defaultdict

from ml.phase41d.targets import TARGET_IDS


def summarize(rows):
    buckets = defaultdict(list)
    missing = Counter()
    reasons = Counter()
    statuses = Counter()
    candidate_groups = defaultdict(list)
    for row in rows:
        for name in row['missing_columns']:
            missing[name] += 1
        if not row['feature_availability']['F2']:
            reasons[row['feature_availability_reasons']['F2']] += 1
        statuses[row['feature_availability_status']] += 1
        label = row['targets'][TARGET_IDS[0]] or 'TARGET_UNAVAILABLE'
        candidate_groups[('scenario_delay', f"{row['scenario']}:+{row['sip_delay_minutes']}")].append(row)
        candidate_groups[('scenario_delay_class',
                          f"{row['scenario']}:+{row['sip_delay_minutes']}:{label}")].append(row)
        groups = (('scenario', row['scenario']), ('fold', f"{row['scenario']}:{row['fold']}"),
                  ('month', f"{row['scenario']}:{row['bar_start_utc'][:7]}"),
                  ('class', f"{row['scenario']}:{label}"),
                  ('delay', f"{row['scenario']}:+{row['sip_delay_minutes']}"),
                  ('scenario_delay_fold', f"{row['scenario']}:+{row['sip_delay_minutes']}:{row['fold']}"),
                  ('scenario_delay_month', f"{row['scenario']}:+{row['sip_delay_minutes']}:{row['bar_start_utc'][:7]}"),
                  ('scenario_delay_class', f"{row['scenario']}:+{row['sip_delay_minutes']}:{label}"))
        for group, value in groups:
            buckets[(group, value)].append(row)
    def describe(group):
        return {'observations': len(group),
                'targets_available': {target: sum(row['targets'][target] is not None for row in group)
                                      for target in TARGET_IDS},
                'target_and_F2': {target: sum(row['targets'][target] is not None and
                                             row['feature_availability']['F2'] for row in group)
                                  for target in TARGET_IDS},
                'F0': sum(row['feature_availability']['F0'] for row in group),
                'F1': sum(row['feature_availability']['F1'] for row in group),
                'F2': sum(row['feature_availability']['F2'] for row in group),
                'common_F0_F1_F2': sum(all(row['feature_availability'].values()) for row in group),
                'sma200_15m': sum(row['features']['sma200_slope_15m'] != 'UNAVAILABLE' for row in group),
                'sma200_1h': sum(row['features']['alignment_1h'] != 'INSUFFICIENT_DATA' for row in group),
                'sma200_1d': sum(row['features']['alignment_1d'] != 'INSUFFICIENT_DATA' for row in group)}
    def distributions(group):
        output = {'observations': len(group)}
        for feature, field in (('candidate_ceiling_context_15m', 'ceiling'),
                               ('candidate_floor_context_15m', 'floor')):
            counts = Counter(row['features'][feature] for row in group)
            output[field] = {'counts': dict(sorted(counts.items())),
                             'fractions': {name: count/len(group) if group else None
                                           for name, count in sorted(counts.items())}}
        return output
    return {'schema': 'phase41e-coverage-v1',
            'by_group': {group: {key: describe(value) for (g, key), value in sorted(buckets.items())
                                 if g == group}
                         for group in ('scenario', 'fold', 'month', 'class', 'delay',
                                       'scenario_delay_fold', 'scenario_delay_month',
                                       'scenario_delay_class')},
            'missing_by_column': dict(sorted(missing.items())),
            'f2_incomplete_by_sip_reason': dict(sorted(reasons.items())),
            'feature_availability_status_counts': dict(sorted(statuses.items())),
            'candidate_context_distributions': {
                group: {key: distributions(value) for (g, key), value in sorted(candidate_groups.items())
                        if g == group}
                for group in ('scenario_delay', 'scenario_delay_class')},
            'primary_delay_minutes': 20,
            'interpretation': 'F0/F1/F2 are nested; same-row comparisons require common_F0_F1_F2.'}
