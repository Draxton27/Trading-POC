"""Synthetic fixtures only; private historical prices are never needed in CI."""
import copy
import csv
import hashlib
import json
import math
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, Mock

from ml.phase28.train import FEATURES, CLASSES
from ml.phase40a import bear_audit as audit


def fixture(label='BAJISTA', scenario='delayed', fold=1, timestamp='2026-10-21T14:00:00.000Z'):
    features = {name: (60 if name == 'minutes_from_open' else .01) for name in FEATURES}
    observation = {'mode': 'HISTORICAL_REPLAY', 'phase': '38E', 'symbol': 'NVDA',
                   'timeframe': '15m', 'feed': 'iex', 'adjustment': 'raw',
                   'historical_received_at_utc': None, 'scenario': scenario,
                   'bar_start_utc': timestamp, 'bar_end_utc': '2026-10-21T14:15:00.000Z',
                   'available_at_utc': '2026-10-21T14:35:00.000Z' if scenario == 'delayed' else '2026-10-21T14:15:00.000Z',
                   'session_date_ny': '2026-10-21', 'features': features,
                   'feature_sha256': 'feature-hash', 'reference_entry_at_utc': '2026-10-21T14:45:00.000Z',
                   'label': label, 'label_available_at_utc': '2026-10-21T15:45:00.000Z',
                   'label_entry_open': 100, 'label_exit_close': 99 if label == 'BAJISTA' else 101 if label == 'ALCISTA' else 100,
                   'label_atr14_price_units': 1, 'exclusion': None}
    if label is None:
        observation.update(label_available_at_utc=None, label_entry_open=None,
                           label_exit_close=None, exclusion='FUTURE_BARS_MISSING')
    prediction = {'mode': 'HISTORICAL_REPLAY', 'phase': '38E', 'feed': 'iex', 'adjustment': 'raw',
                  'historical_received_at_utc': '', 'scenario': scenario, 'fold': str(fold),
                  'bar_start_utc': timestamp, 'session_date_ny': '2026-10-21',
                  'inference_at_utc': observation['available_at_utc'],
                  'reference_entry_at_utc': observation['reference_entry_at_utc'],
                  'label_available_at_utc': observation['label_available_at_utc'] or '',
                  'label': label or '', 'exclusion': observation['exclusion'] or '',
                  'features': json.dumps(features), 'feature_sha256': 'feature-hash',
                  'label_entry_open': str(observation['label_entry_open']) if label else '',
                  'label_exit_close': str(observation['label_exit_close']) if label else '',
                  'model_sha256': 'model-hash', 'prob_xgboost': '[0.2,0.3,0.5]'}
    report = {'prediction_rows': 1, 'scenarios': {
        name: {'models': [{'fold': fold, 'file': f'model-{name}-fold-{fold}.json',
                           'sha256': 'model-hash'}],
               'folds': [{'fold': fold, 'test_rows': 1 if name == scenario else 0,
                          'resolved_rows': (1 if label else 0) if name == scenario else 0,
                          'first_test_session': '2026-10-21', 'last_test_session': '2026-10-21'}]}
        for name in audit.SCENARIOS}}
    declared = {f'model-{scenario}-fold-{fold}.json': 'model-hash'}
    return observation, prediction, report, declared


class AuditTests(unittest.TestCase):
    def joined(self, observation=None, prediction=None, report=None, declared=None):
        original = fixture()
        return audit.join_rows([observation or original[0]], [prediction or original[1]],
                               report or original[2], declared or original[3])

    def test_join_and_scenario_separation(self):
        observation, prediction, report, declared = fixture()
        joined = audit.join_rows([observation], [prediction], report, declared)
        self.assertEqual(joined[0]['scenario'], 'delayed')
        self.assertEqual(joined[0]['fold'], 1)
        self.assertEqual(joined[0]['features'], observation['features'])
        wrong = copy.deepcopy(prediction)
        wrong['scenario'] = 'ideal'
        with self.assertRaisesRegex(ValueError, 'Modelo|observación'):
            audit.join_rows([observation], [wrong], report, declared)

    def test_duplicates_and_contradictory_identity(self):
        observation, prediction, report, declared = fixture()
        with self.assertRaisesRegex(ValueError, 'duplicadas'):
            audit.join_rows([observation, observation], [prediction], report, declared)
        report['prediction_rows'] = 2
        with self.assertRaisesRegex(ValueError, 'duplicadas'):
            audit.join_rows([observation], [prediction, prediction], report, declared)
        changed = copy.deepcopy(prediction)
        changed['label'] = 'ALCISTA'
        report['prediction_rows'] = 1
        with self.assertRaisesRegex(ValueError, 'incompatibles'):
            audit.join_rows([observation], [changed], report, declared)

    def test_missing_label_excluded_and_invalid_exclusion(self):
        o, p, r, d = fixture(None)
        self.assertEqual(audit.join_rows([o], [p], r, d), [])
        o['exclusion'] = None
        p['exclusion'] = ''
        with self.assertRaisesRegex(ValueError, 'exclusión'):
            audit.join_rows([o], [p], r, d)

    def test_nan_infinite_features_and_probabilities(self):
        for invalid in (math.nan, math.inf):
            o, p, r, d = fixture()
            o['features']['return_1'] = invalid
            p['features'] = json.dumps(o['features'])
            with self.assertRaisesRegex(ValueError, 'return_1'):
                audit.join_rows([o], [p], r, d)
        for vector in ('[0.2,0.2,0.2]', '[0.2,NaN,0.8]', '[1.2,-0.2,0.0]'):
            o, p, r, d = fixture()
            p['prob_xgboost'] = vector
            with self.assertRaisesRegex(ValueError, 'Probabilidad'):
                audit.join_rows([o], [p], r, d)

    def test_normalized_movement_and_original_boundaries(self):
        o, *_ = fixture()
        self.assertAlmostEqual(audit.normalized_movement(o), -1)
        o['label_exit_close'] = 99.5
        o['label'] = 'LATERAL'
        self.assertEqual(audit.normalized_movement(o), -.5)
        o['label'] = 'BAJISTA'
        with self.assertRaisesRegex(ValueError, 'classifyMovement'):
            audit.normalized_movement(o)

    def test_confusion_missing_bear_and_small_fold(self):
        row = self.joined()[0]
        second = copy.deepcopy(row)
        second['label'] = 'LATERAL'
        second['probability'] = [.1, .8, .1]
        result = audit.error_audit([row, second])
        self.assertEqual(result['confusion']['BAJISTA']['LATERAL'], 1)
        self.assertEqual(result['confusion']['LATERAL']['BAJISTA'], 1)
        self.assertEqual(result['status'], 'INSUFFICIENT_EVIDENCE')
        self.assertIsNone(audit.error_audit([second])['bear_recall'])
        self.assertEqual(audit.bootstrap_sessions([row])['status'], 'INSUFFICIENT_EVIDENCE')

    def test_feature_distributions_and_deterministic_bootstrap(self):
        rows = []
        for day in range(1, 32):
            row = copy.deepcopy(self.joined()[0])
            row['session'] = f'2026-10-{day:02d}'
            row['bar_start_utc'] = f'2026-10-{day:02d}T14:00:00.000Z'
            rows.append(row)
        stats = audit.feature_diagnostics(rows)
        self.assertEqual(stats['1']['by_true_class']['BAJISTA']['return_1']['n'], 31)
        self.assertEqual(audit.bootstrap_sessions(rows, iterations=10), audit.bootstrap_sessions(rows, iterations=10))

    def test_sha256_manifest_rejects_duplicate_and_traversal(self):
        with tempfile.TemporaryDirectory() as path:
            p = Path(path) / 'SHA256SUMS'
            p.write_text('a' * 64 + '  report.json\n' + 'b' * 64 + '  report.json\n')
            with self.assertRaisesRegex(ValueError, 'SHA256SUMS'):
                audit.declared_hashes(path)
            p.write_text('a' * 64 + '  ../private.json\n')
            with self.assertRaisesRegex(ValueError, 'SHA256SUMS'):
                audit.declared_hashes(path)

    def test_missing_model_importance_is_explicit(self):
        with tempfile.TemporaryDirectory() as path:
            report = {'scenarios': {name: {'models': [{'file': f'model-{name}.json',
                       'sha256': audit.sha(__file__), 'fold': 1}]} for name in audit.SCENARIOS}}
            with self.assertRaisesRegex(ValueError, 'Hash del modelo'):
                audit.model_importance(path, report, {})

    def test_model_without_gain_scores_is_not_invented(self):
        with tempfile.TemporaryDirectory() as path:
            declared = {}
            scenarios = {}
            for name in audit.SCENARIOS:
                filename = f'model-{name}.json'
                (Path(path) / filename).write_text('{}')
                declared[filename] = audit.sha(Path(path) / filename)
                scenarios[name] = {'models': [{'file': filename, 'sha256': declared[filename], 'fold': 1}]}
            booster = Mock()
            booster.get_score.return_value = {}
            with patch.object(audit.xgboost, 'Booster', return_value=booster):
                result = audit.model_importance(path, {'scenarios': scenarios}, declared)
            self.assertEqual(result['delayed']['1']['status'], 'UNAVAILABLE')

    def test_full_audit_with_no_bear_cases(self):
        rows = []
        for scenario in audit.SCENARIOS:
            row = self.joined()[0]
            row = copy.deepcopy(row)
            row['scenario'] = scenario
            row['label'] = 'LATERAL'
            row['movement_atr'] = 0
            rows.append(row)
        result = audit.audit(rows)
        self.assertIsNone(result['scenarios']['delayed']['aggregate']['bear_recall'])
        self.assertIsNone(audit.interpretations(result)['4_probability_signal']['measured']['mean_p_bear_true_bear'])
        report = {'analysis': result, 'interpretations': audit.interpretations(result)}
        self.assertIn('N/D', audit.markdown(report))

    def test_tampered_sha256sum_is_rejected(self):
        with tempfile.TemporaryDirectory() as path:
            root = Path(path)
            for filename in ('manifest.json', 'observations.json', 'report.json',
                             'predictions.csv', 'corporate-actions-audit.json'):
                (root / filename).write_text('{}')
            report = {'schema': 'phase38e-report-v1', 'classes': list(CLASSES),
                      'features': list(FEATURES), 'scenarios': {'ideal': {}, 'delayed': {}},
                      'code_sha256': {'source.ts': 'abc'}, 'source_sha256': {'data.csv': 'abc'}}
            (root / 'report.json').write_text(json.dumps(report))
            declared = {name: audit.sha(root / name) for name in
                        ('manifest.json', 'observations.json', 'report.json',
                         'predictions.csv', 'corporate-actions-audit.json')}
            declared['predictions.csv'] = '0' * 64
            (root / 'SHA256SUMS').write_text(''.join(f'{digest}  {name}\n' for name, digest in declared.items()))
            manifest = {'codeSha256': {'source.ts': 'abc'}, 'source': {'sha256': {'data.csv': 'abc'}}}
            with patch.object(audit, 'load_historical_observations', return_value=([], manifest, [])):
                with self.assertRaisesRegex(ValueError, 'Integridad IEX inválida'):
                    audit.load_verified(root)

    def test_existing_destination_rejected_without_reading_private_data(self):
        with tempfile.TemporaryDirectory() as path:
            with self.assertRaisesRegex(ValueError, 'carpeta nueva'):
                audit.write_report(Path(path) / 'source', path)


if __name__ == '__main__':
    unittest.main()
