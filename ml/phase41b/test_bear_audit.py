"""Synthetic contract tests; no private histories or credentials in CI."""
import copy
import tempfile
import unittest
from pathlib import Path

from ml.phase40a.bear_audit import declared_hashes, sha
from ml.phase41b.bear_audit import (
    audit, bootstrap_bear, condition_groups, coverage, group_metrics, pair_slope_state,
    joined_contexts, safe_output, verify_context_source, ROOT,
)


def context(reason='TECHNICAL_CONTEXT_AVAILABLE', delay=15):
    frame = {'shortPair': 'BEARISH_ALIGNMENT', 'longPair': 'BULLISH_ALIGNMENT',
             'state': 'MIXED', 'events': [],
             'sma': {str(p): {'value': 100, 'slope': 'FALLING', 'priceAbove': False,
                              'priceBelow': True, 'distancePercent': -1.0}
                     for p in (20, 40, 100, 200)}}
    return {'scenario': 'delayed', 'fold': 1, 'barStartUtc': '2026-01-05T14:30:00.000Z',
            'delayMinutes': delay, 'reason': reason,
            'iexDecisionAtUtc': '2026-01-05T15:05:00.000Z',
            'sipBarEndUtc': '2026-01-05T14:45:00.000Z',
            'sipAssumedAvailableAtUtc': '2026-01-05T15:00:00.000Z',
            'alignment': 'SHORT_TERM_PULLBACK',
            'frames': {'15m': copy.deepcopy(frame), '1h': copy.deepcopy(frame),
                       '1d': copy.deepcopy(frame)},
            'ranges': {str(n): {'status': 'AVAILABLE', 'breakBelowLow': True,
                                 'distanceToLowPercent': -1.0}
                       for n in (5, 20, 60)},
            'previousSession': {'status': 'AVAILABLE', 'breakBelowLow': True,
                                'distanceToLowPercent': -1.0},
            'currentBarDelayNotMet': False}


def row(label, probability, session, reason='TECHNICAL_CONTEXT_AVAILABLE'):
    return {'scenario': 'delayed', 'fold': 1, 'session': session, 'delay': 15,
            'bar_start_utc': session + 'T14:30:00.000Z', 'evaluable': True,
            'label': label, 'probability': probability, 'context': context(reason)}


class BearAuditTests(unittest.TestCase):
    def test_exact_join_and_original_values_preserved(self):
        query = {'scenario': 'delayed', 'fold': 1,
                 'barStartUtc': '2026-01-05T14:30:00.000Z',
                 'barEndUtc': '2026-01-05T14:45:00.000Z',
                 'decisionAtUtc': '2026-01-05T15:05:00.000Z'}
        original = {'scenario': 'delayed', 'bar_start_utc': query['barStartUtc'],
                    'label': 'BAJISTA', 'probability': [0.2, 0.35, 0.45]}
        source = {'queries': [query], 'joined': [original]}
        contexts = {'rows': [context(delay=d) for d in (15, 20, 30)]}
        for item in contexts['rows']:
            item['sipAssumedAvailableAtUtc'] = '2026-01-05T15:00:00.000Z'
        result = joined_contexts(source, contexts)
        self.assertEqual(len(result), 3)
        self.assertEqual(result[0]['label'], original['label'])
        self.assertIs(result[0]['probability'], original['probability'])
        altered = copy.deepcopy(contexts)
        altered['rows'][1]['iexDecisionAtUtc'] = '2026-01-05T15:06:00.000Z'
        with self.assertRaises(ValueError):
            joined_contexts(source, altered)
        altered = copy.deepcopy(contexts)
        altered['rows'][0]['sipAssumedAvailableAtUtc'] = '2026-01-05T15:06:00.000Z'
        with self.assertRaises(ValueError):
            joined_contexts(source, altered)
        with self.assertRaises(ValueError):
            joined_contexts(source, {'rows': contexts['rows'][:-1]})

    def test_confusion_and_insufficient_evidence(self):
        rows = [row('BAJISTA', [0.2, 0.3, 0.5], '2026-01-05'),
                row('BAJISTA', [0.6, 0.3, 0.1], '2026-01-06'),
                row('BAJISTA', [0.1, 0.8, 0.1], '2026-01-07'),
                row('LATERAL', [0.1, 0.7, 0.2], '2026-01-08')]
        stats = group_metrics(rows)
        self.assertEqual((stats['true_bear'], stats['bear_to_lateral'],
                          stats['bear_to_bull'], stats['bear_to_bear']), (3, 1, 1, 1))
        self.assertAlmostEqual(stats['bear_recall'], 1/3)
        self.assertAlmostEqual(stats['bear_precision'], .5)
        self.assertEqual(stats['status'], 'INSUFFICIENT_EVIDENCE')
        self.assertEqual(bootstrap_bear(rows)['status'], 'INSUFFICIENT_EVIDENCE')

    def test_session_bootstrap_reproducible(self):
        rows = [row('BAJISTA', [0.1, 0.8 if i % 2 else 0.3, 0.1 if i % 2 else 0.6],
                    f'2026-02-{i+1:02d}') for i in range(30)]
        a = bootstrap_bear(rows, iterations=30, seed=7)
        self.assertEqual(a, bootstrap_bear(rows, iterations=30, seed=7))
        self.assertEqual(a['sessions'], 30)
        self.assertTrue(0 <= a['bear_recall_95pct'][0] <= a['bear_recall_95pct'][1] <= 1)

    def test_coverage_is_explicit_by_fold_and_class(self):
        rows = [row('BAJISTA', [0, 0, 1], '2026-01-05'),
                row('ALCISTA', [1, 0, 0], '2026-01-06', 'SOURCE_OUT_OF_RANGE')]
        rows += [{**r, 'scenario': 'ideal', 'delay': d} for r in rows for d in (15, 20, 30)]
        rows += [{**r, 'delay': d} for r in rows[:2] for d in (20, 30)]
        result = coverage(rows)
        self.assertEqual(result['delayed']['15']['reasons']['SOURCE_OUT_OF_RANGE'], 1)
        self.assertEqual(result['delayed']['15']['by_true_class']['BAJISTA']['rows'], 1)
        self.assertEqual(result['delayed']['15']['excluded_true_classes']['ALCISTA'], 1)
        self.assertEqual(result['delayed']['15']['sma_available']['15m']['20'], 1)

    def test_fixed_groups_separate_order_slope_and_events(self):
        sample = row('BAJISTA', [0, 0, 1], '2026-01-05')
        groups = condition_groups(sample)
        self.assertIn('alignment:SHORT_TERM_PULLBACK', groups)
        self.assertIn('15m:shortPair:BEARISH_ALIGNMENT', groups)
        self.assertIn('15m:sma20:slope:FALLING', groups)
        self.assertIn('15m:sma20_40_slope_pair:BOTH_FALLING', groups)
        self.assertIn('15m:sma100_200_slope_pair:BOTH_FALLING', groups)
        self.assertNotIn('15m:shortPairSlope:BEARISH_ALIGNMENT:FALLING', groups)
        self.assertIn('prior20:breakBelowLow:True', groups)
        frame = sample['context']['frames']['15m']
        frame['sma']['40']['slope'] = 'RISING'
        frame['sma']['100']['slope'] = 'FLAT'
        frame['sma']['200']['slope'] = 'FALLING'
        groups = condition_groups(sample)
        self.assertIn('15m:sma20_40_slope_pair:OPPOSING', groups)
        self.assertIn('15m:sma100_200_slope_pair:FLAT', groups)
        frame['sma']['200']['slope'] = 'UNAVAILABLE'
        self.assertIn('15m:sma100_200_slope_pair:UNAVAILABLE', condition_groups(sample))
        sample['context']['frames']['15m']['events'] = [
            {'kind': 'RETEST', 'period': 20, 'direction': 'BELOW', 'status': 'PENDING'}]
        self.assertIn('15m:event:RETEST:BELOW:PENDING', condition_groups(sample))
        sample['context']['reason'] = 'INSUFFICIENT_SIP_HISTORY'
        self.assertIn('15m:sma20:slope:FALLING', condition_groups(sample))
        sample['context']['frames']['1d']['sma']['20']['value'] = None
        self.assertNotIn('1d:sma20:slope:FALLING', condition_groups(sample))
        sample['context']['reason'] = 'SOURCE_OUT_OF_RANGE'
        self.assertFalse(condition_groups(sample))

    def test_pair_slope_states_are_exhaustive_and_use_phase41a_labels(self):
        cases = [
            ('RISING', 'RISING', 'BOTH_RISING'),
            ('FALLING', 'FALLING', 'BOTH_FALLING'),
            ('RISING', 'FALLING', 'OPPOSING'),
            ('FALLING', 'RISING', 'OPPOSING'),
            ('FLAT', 'FLAT', 'FLAT'),
            ('FLAT', 'RISING', 'FLAT'),
            ('FALLING', 'FLAT', 'FLAT'),
            ('UNAVAILABLE', 'RISING', 'UNAVAILABLE'),
            ('FLAT', 'UNAVAILABLE', 'UNAVAILABLE'),
        ]
        for first, second, expected in cases:
            with self.subTest(first=first, second=second):
                self.assertEqual(pair_slope_state(first, second), expected)

    def test_full_audit_preserves_univariate_and_joint_strata(self):
        rows = [row('BAJISTA', [0.2, 0.3, 0.5], f'2026-01-{i+1:02d}') for i in range(30)]
        result = audit(rows)['delayed']['15']
        self.assertEqual(result['original_evaluable']['observations'], 30)
        self.assertEqual(result['comparable']['observations'], 30)
        self.assertEqual(result['bear_distance_to_prior_low_by_original_prediction']['20']['LATERAL']['n'], 30)
        self.assertIn('15m:sma20_40_slope_pair:BOTH_FALLING', result['groups'])
        self.assertIn('15m:sma100_200_slope_pair:BOTH_FALLING', result['groups'])
        self.assertIn('15m:sma20_40_slope_pair:UNAVAILABLE', result['key_group_bootstrap'])
        self.assertIn('15m:sma100_200_slope_pair:UNAVAILABLE', result['by_fold']['1']['groups'])
        outside = row('BAJISTA', [0.2, 0.3, 0.5], '2026-02-02', 'SOURCE_OUT_OF_RANGE')
        result = audit([outside])['delayed']['15']
        self.assertEqual(result['original_evaluable']['observations'], 1)
        self.assertEqual(result['comparable']['observations'], 0)
        self.assertEqual(result['bear_distance_to_prior_low_by_original_prediction']['20']['LATERAL']['n'], 0)

    def test_hashes_detect_manipulation_and_output_cannot_overwrite_sources(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / 'predictions.csv').write_text('original\n', encoding='utf8')
            digest = sha(directory / 'predictions.csv')
            (directory / 'SHA256SUMS').write_text(digest + '  predictions.csv\n', encoding='utf8')
            self.assertEqual(declared_hashes(directory)['predictions.csv'], digest)
            (directory / 'predictions.csv').write_text('modified\n', encoding='utf8')
            self.assertNotEqual(sha(directory / 'predictions.csv'), digest)
            with self.assertRaises(ValueError):
                safe_output(directory / 'report')

    def test_cached_context_requires_same_sip_and_engine_code(self):
        with tempfile.TemporaryDirectory() as temporary:
            csv = Path(temporary) / 'sip.csv'
            for ext in ('', '.meta.json', '.calendar.json', '.provenance.json'):
                Path(str(csv) + ext).write_text(ext or 'bars', encoding='utf8')
            code = ('trading_poc_001_bollinger/src/phase41b-context.ts',
                    'trading_poc_001_bollinger/src/phase41b-context-cli.ts',
                    'trading_poc_001_bollinger/src/investep-technical-context.ts',
                    'trading_poc_001_bollinger/src/multitimeframe.ts')
            source = {'hashes': {ext or 'csv': sha(Path(str(csv) + ext)) for ext in
                                 ('', '.meta.json', '.calendar.json', '.provenance.json')},
                      'codeSha256': {name: sha(ROOT / name) for name in code}}
            verify_context_source({'source': source}, csv)
            source['codeSha256'][code[0]] = '0' * 64
            with self.assertRaises(ValueError):
                verify_context_source({'source': source}, csv)


if __name__ == '__main__':
    unittest.main()
