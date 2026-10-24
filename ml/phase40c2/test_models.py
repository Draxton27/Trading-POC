import tempfile
import unittest
from pathlib import Path

import lightgbm as lgb
import numpy as np
import xgboost as xgb

from ml.phase28.train import CLASSES
from ml.phase40c1.models import checked_probabilities
from ml.phase40c2.models import (fit_lightgbm, fit_xgb, matrix,
                                  predict_lightgbm, predict_xgb)
from ml.phase40c2.trend_features import EXTENDED_FEATURES


def rows(day, count=9):
    return [{'features': {name: (index + int(day[-2:]) + column) / 100
                          for column, name in enumerate(EXTENDED_FEATURES)},
             'label': CLASSES[index % 3], 'session_date_ny': day,
             'bar_start_utc': f'{day}T14:{index*5:02d}:00.000Z',
             'observed_at_utc': f'{day}T15:00:00.000Z',
             'label_available_at_utc': f'{day}T16:00:00.000Z'}
            for index in range(count)]


class ModelTests(unittest.TestCase):
    def test_explicit_nineteen_columns_and_invalid_probabilities(self):
        sample = rows('2026-10-19')
        x, y = matrix(sample)
        self.assertEqual(x.shape, (9, 19))
        self.assertEqual(list(y), [0, 1, 2] * 3)
        self.assertEqual(x[0, -1], sample[0]['features'][EXTENDED_FEATURES[-1]])
        with self.assertRaisesRegex(ValueError, 'tres clases'):
            matrix(sample[:2])
        with self.assertRaisesRegex(ValueError, '19 variables'):
            matrix([{'features': {name: float('nan') for name in EXTENDED_FEATURES}}], labels=False)
        for invalid in ([float('nan'), .5, .5], [.4, .4, .4]):
            with self.assertRaises(ValueError):
                checked_probabilities([invalid], 1)

    def test_causal_selection_refit_serialization_and_determinism(self):
        core = rows('2026-10-19') + rows('2026-10-20')
        early = rows('2026-10-21')
        train = core + early
        events = [{'features': row['features']} for row in rows('2026-10-22')]
        xmodel, xtrees = fit_xgb(core, early, train)
        lmodel, ltrees = fit_lightgbm(core, early, train)
        self.assertEqual(xmodel.n_features_in_, 19)
        self.assertEqual(lmodel.feature_name(), list(EXTENDED_FEATURES))
        self.assertEqual(xmodel.get_booster().num_boosted_rounds(), xtrees)
        self.assertEqual(lmodel.current_iteration(), ltrees)
        self.assertTrue(1 <= xtrees <= 300 and 1 <= ltrees <= 300)
        xp, lp = predict_xgb(xmodel, events), predict_lightgbm(lmodel, events)
        self.assertEqual(xp.shape, (9, 3))
        self.assertEqual(lp.shape, (9, 3))
        self.assertTrue(np.allclose(xp.sum(axis=1), 1))
        self.assertTrue(np.allclose(lp.sum(axis=1), 1))
        with tempfile.TemporaryDirectory() as temp:
            xp_file, lp_file = Path(temp) / 'xgb.json', Path(temp) / 'lgb.txt'
            xmodel.save_model(xp_file)
            lmodel.save_model(str(lp_file))
            xloaded = xgb.XGBClassifier()
            xloaded.load_model(xp_file)
            lloaded = lgb.Booster(model_file=str(lp_file))
            np.testing.assert_allclose(xp, predict_xgb(xloaded, events), atol=1e-12, rtol=0)
            np.testing.assert_allclose(lp, predict_lightgbm(lloaded, events), atol=1e-12, rtol=0)
        again_x, again_trees = fit_xgb(core, early, train)
        self.assertEqual(xtrees, again_trees)
        np.testing.assert_array_equal(xp, predict_xgb(again_x, events))
        with self.assertRaisesRegex(ValueError, 'no causal'):
            fit_xgb(early, core, train)
        future_core = [dict(row) for row in core]
        future_core[-1]['label_available_at_utc'] = '2026-10-22T14:00:00.000Z'
        with self.assertRaisesRegex(ValueError, 'no causal'):
            fit_lightgbm(future_core, early, future_core + early)


if __name__ == '__main__':
    unittest.main()
