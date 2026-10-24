import copy
import tempfile
import unittest
from pathlib import Path

import lightgbm as lgb
import numpy as np
import xgboost as xgb

from ml.phase28.train import CLASSES
from ml.phase40c1.models import (checked_probabilities, fit_lightgbm,
    fit_xgb, matrix, predict_lightgbm, predict_xgb)
from ml.phase40c1.temporal_features import EXTENDED_FEATURES


def rows(day, count=9):
    result = []
    for index in range(count):
        features = {name: (index + int(day[-2:]) + i) / 100
                    for i, name in enumerate(EXTENDED_FEATURES)}
        result.append({'features': features, 'label': CLASSES[index % 3],
                       'session_date_ny': day,
                       'bar_start_utc': f'{day}T14:{index*5:02d}:00.000Z',
                       'observed_at_utc': f'{day}T15:00:00.000Z',
                       'label_available_at_utc': f'{day}T16:00:00.000Z'})
    return result


class ModelsTests(unittest.TestCase):
    def test_17_feature_order_and_invalid_probabilities(self):
        sample = rows('2026-10-19')
        x, y = matrix(sample)
        self.assertEqual(x.shape, (9, 17))
        self.assertEqual(x[0, 0], sample[0]['features'][EXTENDED_FEATURES[0]])
        self.assertEqual(x[0, -1], sample[0]['features'][EXTENDED_FEATURES[-1]])
        with self.assertRaisesRegex(ValueError, 'tres clases'):
            matrix(sample[:2])
        for invalid in ([float('nan'), .5, .5], [float('inf'), 0, 0], [.4, .4, .4]):
            with self.assertRaises(ValueError):
                checked_probabilities([invalid], 1)
        with self.assertRaises(ValueError):
            matrix([{'features': {name: float('nan') for name in EXTENDED_FEATURES}}], labels=False)

    def test_causal_inner_split_and_refit_all_rows_both_algorithms(self):
        core = rows('2026-10-19') + rows('2026-10-20')
        early = rows('2026-10-21')
        train = core + early
        events = [{'features': row['features']} for row in rows('2026-10-22')]
        xgb_model, xgb_trees = fit_xgb(core, early, train)
        lgb_model, lgb_trees = fit_lightgbm(core, early, train)
        self.assertTrue(1 <= xgb_trees <= 300)
        self.assertTrue(1 <= lgb_trees <= 300)
        self.assertEqual(xgb_model.get_booster().num_boosted_rounds(), xgb_trees)
        self.assertEqual(lgb_model.current_iteration(), lgb_trees)
        self.assertEqual(xgb_model.n_features_in_, 17)
        self.assertEqual(lgb_model.feature_name(), list(EXTENDED_FEATURES))
        a, b = predict_xgb(xgb_model, events), predict_lightgbm(lgb_model, events)
        self.assertEqual(a.shape, (9, 3))
        self.assertEqual(b.shape, (9, 3))
        self.assertTrue(np.allclose(a.sum(axis=1), 1))
        self.assertTrue(np.allclose(b.sum(axis=1), 1))
        with tempfile.TemporaryDirectory() as temp:
            path_x, path_l = Path(temp) / 'model.json', Path(temp) / 'model.txt'
            xgb_model.save_model(path_x)
            lgb_model.save_model(str(path_l))
            restored_x = xgb.XGBClassifier()
            restored_x.load_model(path_x)
            restored_l = lgb.Booster(model_file=str(path_l))
            np.testing.assert_allclose(a, predict_xgb(restored_x, events), atol=1e-12, rtol=0)
            np.testing.assert_allclose(b, predict_lightgbm(restored_l, events), atol=1e-12, rtol=0)
        # No external outcome is required to create the prediction matrix.
        with self.assertRaisesRegex(ValueError, 'no causal'):
            fit_xgb(early, core, train)
        future = copy.deepcopy(core)
        future[-1]['label_available_at_utc'] = '2026-10-22T14:00:00.000Z'
        with self.assertRaisesRegex(ValueError, 'no causal'):
            fit_lightgbm(future, early, future + early)

    def test_deterministic_seed(self):
        core = rows('2026-10-19') + rows('2026-10-20')
        early = rows('2026-10-21')
        train = core + early
        events = [{'features': row['features']} for row in rows('2026-10-22')]
        one, trees_one = fit_xgb(core, early, train)
        two, trees_two = fit_xgb(core, early, train)
        self.assertEqual(trees_one, trees_two)
        np.testing.assert_array_equal(predict_xgb(one, events), predict_xgb(two, events))
        a, ta = fit_lightgbm(core, early, train)
        b, tb = fit_lightgbm(core, early, train)
        self.assertEqual(ta, tb)
        np.testing.assert_array_equal(predict_lightgbm(a, events), predict_lightgbm(b, events))


if __name__ == '__main__':
    unittest.main()
