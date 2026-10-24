import copy
import unittest
from unittest.mock import Mock

from ml.phase40b.dataset import reconstruct
from ml.phase40b.test_helpers import fake_source


class DatasetTests(unittest.TestCase):
    def test_reconstructs_identical_external_rows_and_separate_scenarios(self):
        result = reconstruct('synthetic', minimum_train_sessions=3, test_sessions=2,
                             loader=fake_source())
        self.assertEqual(set(result['plans']), {'ideal', 'delayed'})
        for scenario, folds in result['plans'].items():
            self.assertEqual(len(folds), 1)
            plan = folds[0]
            self.assertEqual(len(plan['test']), len(plan['original_predictions']))
            self.assertEqual([r['bar_start_utc'] for r in plan['test']],
                             [r['bar_start_utc'] for r in plan['original_predictions']])
            self.assertTrue(all(row['session_date_ny'] < plan['first_test_session']
                                and row['label_available_at_utc'] < plan['cutoff_utc']
                                for row in plan['train']))
            self.assertTrue(all(row['label_available_at_utc'] < plan['early_cutoff_utc']
                                for row in plan['core']))

    def test_rejects_duplicate_timestamp_and_external_mismatch(self):
        loader = fake_source()
        joined, observations, predictions, report, hashes, drift = loader(None)
        predictions.append(copy.deepcopy(predictions[0]))
        with self.assertRaisesRegex(ValueError, 'duplicadas'):
            reconstruct('synthetic', minimum_train_sessions=3, test_sessions=2,
                        loader=loader)
        predictions.pop()
        predictions[0]['bar_start_utc'] = '2026-10-31T14:00:00.000Z'
        with self.assertRaisesRegex(ValueError, 'filas externas'):
            reconstruct('synthetic', minimum_train_sessions=3, test_sessions=2,
                        loader=loader)

    def test_rejects_future_label_in_training(self):
        loader = fake_source()
        _, observations, _, _, _, _ = loader(None)
        observations[0]['label_available_at_utc'] = '2026-10-31T16:00:00.000Z'
        with self.assertRaisesRegex(ValueError, 'Entrenamiento causal'):
            reconstruct('synthetic', minimum_train_sessions=3, test_sessions=2,
                        loader=loader)

    def test_rejects_changed_fold_policy_and_internal_purge(self):
        loader = fake_source()
        _, _, _, report, _, _ = loader(None)
        report['fold_policy']['test_sessions'] = 3
        with self.assertRaisesRegex(ValueError, 'Política'):
            reconstruct('synthetic', minimum_train_sessions=3, test_sessions=2,
                        loader=loader)
        loader = fake_source()
        _, observations, _, _, _, _ = loader(None)
        for row in observations:
            if row['session_date_ny'] == '2026-10-01':
                row['label_available_at_utc'] = '2026-10-03T15:00:00.000Z'
        with self.assertRaisesRegex(ValueError, 'Bloque interno|Early stopping interno'):
            reconstruct('synthetic', minimum_train_sessions=3, test_sessions=2,
                        loader=loader)

    def test_fails_when_class_missing_in_core(self):
        loader = fake_source()
        _, observations, _, _, _, _ = loader(None)
        for row in observations:
            if row['session_date_ny'] in ('2026-10-01', '2026-10-02') and row['label'] == 'BAJISTA':
                row['label'] = 'LATERAL'
        with self.assertRaisesRegex(ValueError, 'clases ausentes'):
            reconstruct('synthetic', minimum_train_sessions=3, test_sessions=2,
                        loader=loader)

    def test_excluded_outcome_keeps_external_alignment(self):
        result = reconstruct('synthetic', minimum_train_sessions=3, test_sessions=2,
                             loader=fake_source(excluded_last=True))
        for scenario in ('ideal', 'delayed'):
            plan = result['plans'][scenario][0]
            self.assertEqual(len(plan['test']), 6)
            self.assertEqual(len(plan['original_predictions']), 6)
            self.assertEqual(len(plan['resolved']), 5)
            self.assertEqual(plan['test'][-1]['exclusion'], 'MARKET_CLOSE')

    def test_source_integrity_failure_propagates_and_snapshot_drift_is_recorded(self):
        broken = Mock(side_effect=ValueError('Integridad IEX inválida'))
        with self.assertRaisesRegex(ValueError, 'Integridad IEX'):
            reconstruct('synthetic', minimum_train_sessions=3, test_sessions=2,
                        loader=broken)
        loader = fake_source()
        loader(None)[-1].append('ml/phase38e/replay.py')
        result = reconstruct('synthetic', minimum_train_sessions=3, test_sessions=2,
                             loader=loader)
        self.assertEqual(result['code_snapshot_drift'], ['ml/phase38e/replay.py'])


if __name__ == '__main__':
    unittest.main()
