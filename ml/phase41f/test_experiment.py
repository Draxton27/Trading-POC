"""Synthetic contract checks. No private artifacts or historical training in CI."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

from ml.phase41d.registry import DEFINITIONS
from ml.phase41e.feature_schema import CATEGORIES, feature_schema, schema_sha256
from ml.phase41f.evaluation import score
from ml.phase41f.diagnostics import feature_name
from ml.phase41f.coverage import audit
from ml.phase41f.experiment import frozen_config, TARGETS
from ml.phase41f.folds import eligible_rows, inner_blocks
from ml.phase41f.models import frequency, logistic, validate_probabilities, xgboost, lightgbm
from ml.phase41f.preprocessing import fit_transformer, transform
from ml.phase41f.sources import checked_directory
from ml.phase41f.training_features import reconstruct_rows
from ml.phase41d.protocol import F0, F1_ADDED, F2_ADDED
from ml.phase41d.targets import TARGET_IDS
from ml.phase41f.uncertainty import paired


def row(day, index, scenario='delayed', available=True, label='BAJISTA'):
    names = feature_schema()['columns']['F2']
    values = {name: (CATEGORIES[name][0] if name in CATEGORIES else float(index + 1))
              for name in names}
    return {'scenario': scenario, 'fold': 1, 'session_date_ny': day,
            'bar_start_utc': f'{day}T13:{index:02d}:00.000Z',
            'decision_at_utc': f'{day}T13:{index:02d}:00.000Z',
            'available_at_utc': f'{day}T13:{index:02d}:00.000Z',
            'observed_at_utc': f'{day}T13:{index:02d}:00.000Z',
            'label_available_at_utc': f'{day}T14:{index:02d}:00.000Z',
            'target_known_at_utc': f'{day}T14:{index:02d}:00.000Z',
            'features': values, 'feature_availability': {'F0': True, 'F1': True, 'F2': available},
            'targets': {definition.target_id: label for definition in DEFINITIONS},
            'label': label}


class ExperimentTests(unittest.TestCase):
    def test_config_frozen_and_no_production(self):
        config = frozen_config()
        self.assertEqual([len(config['feature_sets'][name]) for name in ('F0', 'F1', 'F2')],
                         [10, 18, 33])
        self.assertEqual(config['status'], 'HISTORICAL_EXPLORED')
        self.assertFalse(config['promotion_to_production'])
        self.assertFalse(config['orders_or_options_signals'])
        self.assertEqual(schema_sha256(),
                         'f345656000b9e6970017be1bfb6cc7ca3a37b504b6e43f929cfa161e5b10bdfa')

    def test_train_only_scaling_and_unknown_category(self):
        train = [row('2025-01-02', 0), row('2025-01-02', 15)]
        model, original = fit_transformer(train, 'F2', linear=True)
        test = row('2025-01-03', 0)
        test['features']['return_1'] = 10000.0
        test['features']['sma_full_order_15m'] = CATEGORIES['sma_full_order_15m'][1]
        changed = transform(model, [test], 'F2')
        np.testing.assert_array_equal(original, transform(model, train, 'F2'))
        self.assertTrue(np.isfinite(changed).all())
        self.assertGreater(abs(changed[0, 0]), 100)
        self.assertEqual(len(changed[0]), len(original[0]))
        self.assertEqual(feature_name('categorical__x29_UNAVAILABLE',
                                      feature_schema()['columns']['F2']),
                         'candidate_ceiling_context_15m')

    def test_fold_purge_and_no_external_training(self):
        target = next(iter(TARGETS))
        training = [row('2025-01-02', 0), row('2025-01-03', 0),
                    row('2025-01-06', 0)]
        external = row('2025-01-07', 0)
        original = lambda r: {'scenario': r['scenario'], 'bar_start_utc': r['bar_start_utc']}
        plan = {'scenario': 'delayed', 'cutoff_utc': '2025-01-07T13:00:00.000Z', 'first_test_session': '2025-01-07',
                'fold': 1, 'train': [original(r) for r in training],
                'resolved': [(original(external), {})]}
        all_rows = { (r['scenario'], r['bar_start_utc']): r for r in (*training, external)}
        selected, test = eligible_rows(plan, all_rows, target, 'F2')
        self.assertEqual(len(selected), 3)
        self.assertEqual(len(test), 1)
        self.assertNotIn(external, selected)
        all_rows[training[-1]['scenario'], training[-1]['bar_start_utc']]['target_known_at_utc'] = plan['cutoff_utc']
        with self.assertRaisesRegex(ValueError, 'posterior'):
            eligible_rows(plan, all_rows, target, 'F2')

    def test_exclusion_audit_preserves_missing_targets_and_F2(self):
        target = next(iter(TARGETS))
        train = row('2025-01-02', 0)
        external = row('2025-01-03', 0, available=False)
        missing = row('2025-01-03', 15)
        missing['targets'][target] = None
        plan = {'plans': {'delayed': [{'fold': 1, 'cutoff_utc': external['decision_at_utc'],
                                      'first_test_session': '2025-01-03',
                                      'test': [external, missing]}]}}
        rebuilt = {(r['scenario'], r['bar_start_utc']): r for r in (train, external, missing)}
        groups = audit(plan, [train, external, missing], rebuilt, (target,))['groups']
        self.assertEqual(groups[0]['eligible']['F2'], 1)
        self.assertEqual(groups[1]['eligible']['F1'], 1)
        self.assertEqual(groups[1]['eligible']['F2'], 0)
        self.assertEqual(groups[1]['exclusion_reasons'],
                         {'F2_INCOMPLETE': 1, 'TARGET_UNAVAILABLE': 1})

    def test_inner_purge(self):
        rows = [row(f'2025-01-{day:02d}', 0) for day in (2, 3, 6, 7, 8)]
        rows[3]['target_known_at_utc'] = rows[4]['decision_at_utc']
        rows[3]['label_available_at_utc'] = rows[4]['decision_at_utc']
        core, early = inner_blocks(rows)
        self.assertNotIn(rows[3]['bar_start_utc'], [r['bar_start_utc'] for r in core])
        self.assertEqual(early[0]['bar_start_utc'], rows[4]['bar_start_utc'])

    def test_probabilities_and_prevalence(self):
        y = np.array([0, 1, 0, 1, 1, 0])
        p = frequency(y, 2, 2)
        np.testing.assert_allclose(p[0], [.5, .5])
        with self.assertRaises(ValueError):
            validate_probabilities([[.9, .9]], 2)
        x = np.array([[i] for i in range(6)], dtype=float)
        _, predicted, _ = logistic(x, y, x, 2)
        np.testing.assert_allclose(predicted.sum(axis=1), 1)

    def test_binary_tree_models_use_inner_block_and_reproduce(self):
        rng = np.random.default_rng(7)
        core = rng.normal(size=(30, 2))
        early = rng.normal(size=(12, 2))
        train = np.vstack((core, early))
        yc = np.asarray([0, 1] * 15)
        ye = np.asarray([0, 1] * 6)
        y = np.concatenate((yc, ye))
        for fit in (xgboost, lightgbm):
            _, first, selected = fit(core, yc, early, ye, train, y, early, 2)
            _, second, repeated = fit(core, yc, early, ye, train, y, early, 2)
            self.assertEqual(selected, repeated)
            np.testing.assert_allclose(first, second)
            np.testing.assert_allclose(first.sum(axis=1), 1)

    def test_multiclass_tree_probability_order(self):
        rng = np.random.default_rng(7)
        core = rng.normal(size=(36, 2))
        early = rng.normal(size=(12, 2))
        yc = np.asarray([0, 1, 2] * 12)
        ye = np.asarray([0, 1, 2] * 4)
        train = np.vstack((core, early))
        y = np.concatenate((yc, ye))
        for fit in (xgboost, lightgbm):
            _, probabilities, _ = fit(core, yc, early, ye, train, y, early, 3)
            self.assertEqual(probabilities.shape, (12, 3))
            np.testing.assert_allclose(probabilities.sum(axis=1), 1)

    def test_binary_and_multiclass_metrics(self):
        binary = ('DOWN_TOUCH', 'NO_DOWN_TOUCH')
        result = score([0, 1, 0, 1], [[.9, .1], [.2, .8], [.8, .2], [.1, .9]], binary)
        self.assertEqual(result['per_class']['DOWN_TOUCH']['recall'], 1)
        self.assertEqual(result['pr_auc'], 1)
        self.assertLess(result['brier'], .1)
        missing = score([1, 1], [[.2, .8], [.1, .9]], binary)
        self.assertIsNone(missing['pr_auc'])
        self.assertIsNone(missing['balanced_accuracy'])
        triple = score([0, 1, 2], [[.8, .1, .1], [.1, .8, .1], [.1, .1, .8]],
                       ('ALCISTA', 'BAJISTA', 'LATERAL'))
        self.assertEqual(triple['macro_f1'], 1)
        self.assertEqual(triple['bear_errors']['BAJISTA_to_BAJISTA'], 1)

    def test_paired_bootstrap_preserves_fold_and_rows(self):
        rows = [row(f'2025-01-{day:02d}', 0) for day in (2, 3, 6, 7)]
        for i, item in enumerate(rows):
            item['fold'] = 1 if i < 2 else 2
        labels = [0, 1, 0, 1]
        p = [[.8, .2], [.2, .8], [.7, .3], [.3, .7]]
        result = paired(rows, labels, p, p, ('DOWN_TOUCH', 'NO_DOWN_TOUCH'), iterations=10)
        self.assertEqual(result['groups_by_fold'], {'1': 2, '2': 2})
        self.assertEqual(result['interval_95pct']['brier'], [0, 0])
        with self.assertRaises(ValueError):
            paired(rows, labels, p[:-1], p, ('DOWN_TOUCH', 'NO_DOWN_TOUCH'))

    def test_source_hash_rejected(self):
        with tempfile.TemporaryDirectory() as name:
            directory = Path(name)
            (directory / 'artifact.json').write_text('{}', encoding='utf8')
            (directory / 'SHA256SUMS').write_text('0' * 64 + '  artifact.json\n', encoding='utf8')
            with self.assertRaisesRegex(ValueError, 'SHA-256'):
                checked_directory(directory, {'artifact.json'})

    def test_historical_reconstruction_rejects_external_drift_and_future_sip(self):
        stamp = '2025-01-02T13:30:00.000Z'
        f0 = {name: 1.0 for name in F0}
        f1 = {name: 1.0 for name in F1_ADDED}
        f2 = {name: next((value for value in CATEGORIES[name]
                          if value not in ('UNAVAILABLE', 'INSUFFICIENT_DATA')), None)
              if name in CATEGORIES else 1.0 for name in F2_ADDED}
        observation = {'scenario': 'delayed', 'bar_start_utc': stamp,
                       'bar_end_utc': '2025-01-02T13:45:00.000Z',
                       'available_at_utc': '2025-01-02T14:05:00.000Z',
                       'session_date_ny': '2025-01-02', 'features': f0,
                       'feature_sha256': 'synthetic-sha', 'label': None,
                       'label_available_at_utc': None}
        prediction = {'fold': 1, 'bar_start_utc': stamp}
        bar = type('Bar', (), {'timestamp': stamp})()
        source = {'observations': [observation], 'pairs': [(observation, prediction)],
                  'bars': [bar], 'calendar': {}, 'history_hashes': {},
                  'phase41e_manifest': {'source_sha256': {'sip': {'csv': 'synthetic'}}}}
        earlier = {'original_feature_sha256': 'synthetic-sha',
                   'features': {**f0, **f1, **f2}, 'targets': dict.fromkeys(TARGET_IDS),
                   'feature_availability': {'F0': True, 'F1': True, 'F2': True},
                   'decision_at_utc': observation['available_at_utc'], 'fold': 1}
        context = {'audit': {'sipBarEndUtc': observation['bar_end_utc']}, 'features': f2}
        context_meta = {'sip_input_sha256': {'csv': 'synthetic'}, 'context_sha256': 'abc'}
        with (patch('ml.phase41f.training_features.context_bridge', return_value=Path('unused')),
              patch('ml.phase41f.training_features.verified_contexts',
                    return_value=({('delayed', stamp, 20): context}, context_meta)),
              patch('ml.phase41f.training_features.sequence_index', return_value={stamp: f1}),
              patch('ml.phase41f.training_features.geometry', return_value={}),
              patch('ml.phase41f.training_features.exact_original_parity'),
              patch('ml.phase41f.training_features.future_bars', return_value=(None, 'MARKET_CLOSE')),
              patch('ml.phase41f.training_features.source_hash', return_value='source')):
            with tempfile.TemporaryDirectory() as work:
                rebuilt, parity = reconstruct_rows(source, {('delayed', stamp): earlier},
                                                   Path('synthetic.csv'), Path(work))
                self.assertEqual(parity['external_rows_checked'], 1)
                self.assertIsNone(rebuilt['delayed', stamp]['targets'][TARGET_IDS[0]])
                altered = {**earlier, 'features': {**earlier['features'],
                                                   'price_relative_sma20_15m': 999.0}}
                with self.assertRaisesRegex(ValueError, 'F2 externo'):
                    reconstruct_rows(source, {('delayed', stamp): altered},
                                     Path('synthetic.csv'), Path(work))
                context['audit']['sipBarEndUtc'] = '2025-01-02T14:15:00.000Z'
                with self.assertRaisesRegex(ValueError, 'posterior'):
                    reconstruct_rows(source, {('delayed', stamp): earlier},
                                     Path('synthetic.csv'), Path(work))


if __name__ == '__main__':
    unittest.main()
