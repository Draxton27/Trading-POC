import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

import lightgbm as lgb
import numpy as np

from ml.phase28.train import FEATURES
from ml.phase40b.dataset import reconstruct
from ml.phase40b.lightgbm_model import (LIGHTGBM_PARAMS, matrices, predict,
                                        refit, select_iterations)
from ml.phase40b.test_helpers import fake_source


class ModelTests(unittest.TestCase):
    def setUp(self):
        self.plan = reconstruct('synthetic', minimum_train_sessions=3, test_sessions=2,
                                loader=fake_source())['plans']['delayed'][0]

    def test_early_stopping_refit_and_serialization(self):
        best = select_iterations(self.plan['core'], self.plan['early'])
        self.assertGreaterEqual(best, 1)
        self.assertLessEqual(best, 300)
        booster = refit(self.plan['train'], best)
        self.assertEqual(booster.current_iteration(), best)
        predictions = predict(booster, self.plan['test'])
        self.assertEqual(predictions.shape, (len(self.plan['test']), 3))
        self.assertTrue(np.allclose(predictions.sum(axis=1), 1))
        with tempfile.TemporaryDirectory() as directory:
            model = Path(directory) / 'model.txt'
            booster.save_model(str(model))
            reloaded = lgb.Booster(model_file=str(model))
            self.assertTrue(np.allclose(predictions, predict(reloaded, self.plan['test']), atol=1e-12))

    def test_feature_order_missing_class_and_invalid_probabilities(self):
        self.assertEqual(list(FEATURES), ['return_1', 'return_4', 'distance_ema9',
            'distance_sma20', 'bollinger_position', 'relative_volume_20',
            'candle_range', 'candle_body', 'atr14_relative', 'minutes_from_open'])
        x, _ = matrices(self.plan['train'])
        self.assertEqual(x[0, 0], self.plan['train'][0]['return_1'])
        with self.assertRaisesRegex(ValueError, 'clases'):
            matrices([r for r in self.plan['train'] if r['label'] != 'BAJISTA'])
        fake = Mock()
        fake.predict.return_value = [[float('nan'), .2, .8]] * len(self.plan['test'])
        with self.assertRaisesRegex(ValueError, 'Probabilidad'):
            predict(fake, self.plan['test'])

    def test_external_labels_cannot_enter_early_stopping(self):
        contaminated = [dict(row) for row in self.plan['core']]
        contaminated[-1]['label_available_at_utc'] = self.plan['early_cutoff_utc']
        with self.assertRaisesRegex(ValueError, 'no causal'):
            select_iterations(contaminated, self.plan['early'])
        self.assertEqual(LIGHTGBM_PARAMS['seed'], 7)
        self.assertEqual(LIGHTGBM_PARAMS['num_threads'], 2)


if __name__ == '__main__':
    unittest.main()
