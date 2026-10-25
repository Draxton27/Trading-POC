"""Deterministic synthetic tests; no private files, credentials or model fitting."""
import copy
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from ml.phase40a.bear_audit import sha
from ml.phase40c1.temporal_features import Bar
from ml.phase41c.test_target_audit import observation, session
from ml.phase41c.trajectory import classify, future_bars
from ml.phase41d.coverage import summarize
from ml.phase41d.protocol import F0, F1_ADDED, F2_ADDED, comparison_protocol
from ml.phase41d.registry import (DEFINITIONS, EXPECTED_SHA256, definition_payload,
                                  digest, validate_registry)
from ml.phase41d.report import verify_reference, write_artifacts
from ml.phase41d.targets import TARGET_IDS, barrier_order, build_targets, target_values


def fixture(prices=None, scenarios=('ideal', 'delayed'), close=960):
    bars, calendar = session('2026-01-05', prices=prices or [100]*9, close=close)
    observations = [observation(bars, scenario=scenario) for scenario in scenarios]
    pairs = [(obs, {'scenario': obs['scenario'], 'bar_start_utc': obs['bar_start_utc'],
                    'fold': 2}) for obs in observations]
    return {'bars': bars, 'calendar': calendar, 'observations': observations,
            'pairs': pairs, 'history_hashes': {'strict-15m.csv': 'a'*64,
                                               'calendar.json': 'b'*64},
            'run_hashes': {'observations.json': 'c'*64}, 'code_snapshot_drift': []}


def values_for(source, scenario='ideal'):
    rows, auxiliary = build_targets(source)
    return ({row['target_id']: row for row in rows if row['scenario'] == scenario}, auxiliary)


def mark_excluded(source, reason):
    for obs in source['observations']:
        obs.update(label=None, label_available_at_utc=None, label_entry_open=None,
                   label_exit_close=None, exclusion=reason)
    return source


class TargetProtocolTests(unittest.TestCase):
    def test_registry_is_frozen_and_silent_redefinition_fails(self):
        registry = validate_registry()
        self.assertEqual(len(registry['definitions']), 3)
        for definition in DEFINITIONS:
            self.assertEqual(digest(definition_payload(definition)), EXPECTED_SHA256[definition.target_id])
        altered = list(DEFINITIONS)
        altered[1] = type(altered[1])(**{**definition_payload(altered[1]),
                                       'formula': 'changed touch threshold'})
        with self.assertRaisesRegex(ValueError, 'Definición alterada'):
            validate_registry(tuple(altered))
        with self.assertRaises(ValueError):
            validate_registry((DEFINITIONS[0], DEFINITIONS[0], DEFINITIONS[2]))

    def test_original_label_parity_strict_boundary_and_two_binary_targets(self):
        self.assertEqual(classify(-.5, 1), 'LATERAL')
        self.assertEqual(classify(.5, 1), 'LATERAL')
        self.assertEqual(classify(-.50001, 1), 'BAJISTA')
        source = fixture(prices=[100,100,100,100,100,99.5,100,100,100])
        original = copy.deepcopy(source)
        rows, auxiliary = build_targets(source)
        self.assertEqual(source, original)
        self.assertEqual(len(rows), 6)
        self.assertEqual(len(auxiliary), 2)
        ideal = {row['target_id']: row for row in rows if row['scenario'] == 'ideal'}
        self.assertEqual(ideal[TARGET_IDS[0]]['target_value'], source['observations'][0]['label'])
        self.assertEqual(ideal[TARGET_IDS[0]]['target_value'], 'LATERAL')
        self.assertEqual(ideal[TARGET_IDS[2]]['target_value'], 'NOT_PERSISTENT_BEAR')
        self.assertEqual(ideal[TARGET_IDS[0]]['fold'], 2)

    def test_transient_touch_then_recovery_and_inclusive_threshold(self):
        source = fixture(scenarios=('ideal',))
        obs = source['observations'][0]
        bars = source['bars'][2:6]
        future = [Bar(b.start, b.timestamp, 100, 100.4, 99.5, 100,
                      b.volume, b.day, b.minute) for b in bars]
        targets, _, _ = target_values(obs, future)
        self.assertEqual(targets[TARGET_IDS[0]], 'LATERAL')
        self.assertEqual(targets[TARGET_IDS[1]], 'DOWN_TOUCH')
        self.assertEqual(targets[TARGET_IDS[2]], 'NOT_PERSISTENT_BEAR')

    def test_terminal_bear_with_and_without_persistence(self):
        persistent = fixture(prices=[100,100,100,99.9,99.8,99.4,99.3,99.1,99],
                             scenarios=('ideal',))
        nonpersistent = fixture(prices=[100,100,100,99.2,100.1,99.4,99.2,99.1,99],
                                scenarios=('ideal',))
        a, _ = values_for(persistent)
        b, _ = values_for(nonpersistent)
        self.assertEqual(a[TARGET_IDS[0]]['target_value'], 'BAJISTA')
        self.assertEqual(b[TARGET_IDS[0]]['target_value'], 'BAJISTA')
        self.assertEqual(a[TARGET_IDS[2]]['target_value'], 'PERSISTENT_BEAR')
        self.assertEqual(b[TARGET_IDS[2]]['target_value'], 'NOT_PERSISTENT_BEAR')

    def test_only_one_barrier_distinct_first_touches_and_same_bar_ambiguity(self):
        cases = [
            ({'first_downward_threshold_touch': 1, 'first_upward_threshold_touch': None},
             ('DOWN_FIRST_OR_ONLY_DOWN', 'DOWN_ONLY')),
            ({'first_downward_threshold_touch': None, 'first_upward_threshold_touch': 2},
             ('UP_FIRST_OR_ONLY_UP', 'UP_ONLY')),
            ({'first_downward_threshold_touch': 2, 'first_upward_threshold_touch': 1},
             ('UP_FIRST_OR_ONLY_UP', 'BOTH')),
            ({'first_downward_threshold_touch': 1, 'first_upward_threshold_touch': 2},
             ('DOWN_FIRST_OR_ONLY_DOWN', 'BOTH')),
            ({'first_downward_threshold_touch': 2, 'first_upward_threshold_touch': 2},
             ('BOTH_FIRST_SAME_BAR_AMBIGUOUS', 'BOTH')),
            ({'first_downward_threshold_touch': None, 'first_upward_threshold_touch': None},
             ('NEITHER_TOUCHED', 'NEITHER')),
        ]
        for path, expected in cases:
            with self.subTest(path=path):
                self.assertEqual(barrier_order(path), expected)

    def test_41c_later_bilateral_bar_does_not_erase_known_order(self):
        source = fixture(scenarios=('ideal',))
        obs = source['observations'][0]
        bars = source['bars'][2:6]
        future = [Bar(b.start, b.timestamp, 100, high, low, 100,
                      b.volume, b.day, b.minute)
                  for b, high, low in zip(bars, (100.6,100.7,100.1,100.1),
                                          (99.8,99.2,99.9,99.9))]
        _, diagnostic, _ = target_values(obs, future)
        self.assertTrue(diagnostic['any_same_bar_both_touched'])
        self.assertFalse(diagnostic['first_touch_order_ambiguous'])
        self.assertEqual(diagnostic['barrier_order'], 'UP_FIRST_OR_ONLY_UP')
        self.assertEqual(diagnostic['barrier_reach'], 'BOTH')

    def test_market_close_gap_and_entry_after_decision(self):
        source = mark_excluded(fixture(scenarios=('ideal',), close=630), 'MARKET_CLOSE')
        source['bars'] = source['bars'][:4]
        rows, aux = build_targets(source)
        self.assertEqual(rows[0]['availability_status'], 'MARKET_CLOSE')
        self.assertTrue(all(row['target_value'] is None for row in rows))
        self.assertEqual(aux, [])
        source = mark_excluded(fixture(scenarios=('ideal',)), 'FUTURE_BARS_MISSING')
        source['bars'] = [b for b in source['bars'] if b.timestamp != source['bars'][3].timestamp]
        rows, _ = build_targets(source)
        self.assertEqual(rows[0]['availability_status'], 'FUTURE_BARS_MISSING')
        self.assertIsNone(rows[0]['target_known_at_utc'])
        source = fixture(scenarios=('ideal',))
        source['observations'][0]['reference_entry_at_utc'] = source['observations'][0]['available_at_utc']
        with self.assertRaises(ValueError):
            build_targets(source)

    def test_short_session_keeps_no_horizon_and_preserves_fold(self):
        source = mark_excluded(fixture(scenarios=('ideal',), close=630), 'MARKET_CLOSE')
        source['bars'] = source['bars'][:4]
        rows, _ = build_targets(source)
        summary = summarize(rows, [])
        for target_id in TARGET_IDS:
            self.assertEqual(summary['ideal'][target_id]['available'], 0)
            self.assertEqual(summary['ideal'][target_id]['exclusions'], {'MARKET_CLOSE': 1})
            self.assertEqual(summary['ideal'][target_id]['by_fold']['2']['excluded'], 1)

    def test_theoretical_known_time_is_distinct_from_historical_receipt(self):
        source = fixture()
        rows, _ = build_targets(source)
        for row in rows:
            self.assertLess(row['decision_at_utc'], row['reference_entry_at_utc'])
            self.assertEqual(row['target_horizon_end_utc'], row['target_known_at_utc'])
            self.assertIsNone(row['historical_received_at_utc'])
            self.assertEqual(row['availability_basis'], 'THEORETICAL_BAR_CLOSE')
            self.assertEqual(row['research_status'], 'HISTORICAL_EXPLORED')
        self.assertNotEqual(rows[0]['decision_at_utc'], rows[3]['decision_at_utc'])
        self.assertEqual(rows[0]['bar_start_utc'], rows[3]['bar_start_utc'])

    def test_exact_41c_reference_parity_and_hash_guard(self):
        source = fixture(scenarios=('ideal',))
        rows, aux = build_targets(source)
        obs = source['observations'][0]
        _, _, path = target_values(obs, source['bars'][2:6])
        refrow = {'scenario': 'ideal', 'bar_start_utc': obs['bar_start_utc'],
                  'fold': 2, 'session': obs['session_date_ny'],
                  'available_at_utc': obs['available_at_utc'],
                  'reference_entry_at_utc': obs['reference_entry_at_utc'],
                  'label': obs['label'], 'paths': {'4': path}, 'horizon_exclusions': {}}
        refreport = {'schema': 'phase41c-v1', 'source_integrity': {
            'history_sha256': source['history_hashes'], 'run_sha256': source['run_hashes']}}
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            for name, payload in [('trajectory-audit.json', [refrow]), ('report.json', refreport),
                                  ('manifest.json', {'schema': 'test'})]:
                (folder / name).write_text(json.dumps(payload), encoding='utf8')
            def checksums():
                (folder / 'SHA256SUMS').write_text(''.join(f'{sha(folder/name)}  {name}\n' for name in
                    ('trajectory-audit.json','report.json','manifest.json')), encoding='utf8')
            checksums()
            self.assertEqual(verify_reference(folder, source, rows, aux)['status'], 'EXACT')
            refrow['paths']['4']['first_downward_threshold_touch'] = None
            (folder / 'trajectory-audit.json').write_text(json.dumps([refrow]), encoding='utf8')
            with self.assertRaisesRegex(ValueError, 'SHA-256'):
                verify_reference(folder, source, rows, aux)
            checksums()
            with self.assertRaisesRegex(ValueError, 'no coincide'):
                verify_reference(folder, source, rows, aux)

    def test_deterministic_outputs_and_no_models_or_future_features(self):
        source = fixture()
        first, auxiliary = build_targets(source)
        second, again = build_targets(copy.deepcopy(source))
        self.assertEqual(first, second)
        self.assertEqual(auxiliary, again)
        protocol = comparison_protocol()
        self.assertEqual(protocol['features']['F0'], list(F0))
        self.assertEqual(len(protocol['features']['F1']), len(F0)+len(F1_ADDED))
        self.assertEqual(len(protocol['features']['F2']), len(F0)+len(F1_ADDED)+len(F2_ADDED))
        self.assertEqual(protocol['features']['implementation_status'], 'SPECIFICATION_ONLY')
        self.assertTrue(protocol['split_policy']['no_future_features'])
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary)/'new-output'
            with patch('ml.phase41d.report.private_new_directory', side_effect=lambda x: Path(x)):
                report = write_artifacts(source, first, auxiliary,
                                         {'status': 'NOT_CHECKED', 'observations': 0}, destination,
                                         now=datetime(2026, 10, 24, tzinfo=timezone.utc))
                self.assertEqual(report['status'], 'HISTORICAL_EXPLORED')
                manifest = json.loads((destination/'manifest.json').read_text())
                self.assertFalse(manifest['models_trained'])
                self.assertFalse(manifest['original_labels_changed'])
                self.assertEqual(manifest['prospective_status'], 'NOT_EVALUATED')
                self.assertFalse(any(p.suffix in ('.pkl','.model') for p in destination.iterdir()))
                with self.assertRaises(FileExistsError):
                    write_artifacts(source, first, auxiliary,
                                    {'status': 'NOT_CHECKED', 'observations': 0}, destination)


if __name__ == '__main__':
    unittest.main()
