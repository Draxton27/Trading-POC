import unittest

from ml.phase40b.evaluation import (classify_comparison, compare_original,
                                     paired_bootstrap, score)
from ml.phase28.train import CLASSES, metrics
import numpy as np


class EvaluationTests(unittest.TestCase):
    def test_confusion_auc_and_missing_class(self):
        labels = ['BAJISTA', 'LATERAL', 'ALCISTA']
        probabilities = [[.1, .8, .1], [.1, .2, .7], [.7, .2, .1]]
        result = score(labels, probabilities, 'lightgbm')
        self.assertEqual(result['bear_errors']['BAJISTA_to_BAJISTA'], 1)
        self.assertEqual(result['bear_errors']['LATERAL_to_BAJISTA'], 0)
        self.assertIsNotNone(result['bear_ovr']['pr_auc'])
        missing = score(['LATERAL', 'ALCISTA'], probabilities[1:], 'lightgbm')
        self.assertIsNone(missing['bear_ovr']['roc_auc_ovr'])
        self.assertEqual(missing['bear_ovr']['reason'], 'MISSING_POSITIVE')

    def test_invalid_probability_and_original_metric_mismatch(self):
        with self.assertRaisesRegex(ValueError, 'Probabilidad'):
            score(['BAJISTA'], [[.2, float('inf'), .8]], 'lightgbm')
        labels = ['BAJISTA', 'LATERAL', 'ALCISTA']
        p = [[.1, .8, .1], [.1, .2, .7], [.7, .2, .1]]
        original = metrics(np.array([1, 2, 0]), np.array(p))
        compare_original(labels, p, original)
        original['macro_f1'] += .01
        with self.assertRaisesRegex(ValueError, 'Métrica xgboost'):
            compare_original(labels, p, original)

    def test_session_week_month_bootstrap_is_paired_and_deterministic(self):
        rows = []
        labels = []
        for day in (1, 2, 8, 9):
            for label in CLASSES:
                rows.append({'fold': 1, 'session_date_ny': f'2026-10-{day:02d}'})
                labels.append(label)
        left = [[.2, .3, .5] for _ in rows]
        right = [[.4, .3, .3] for _ in rows]
        for grouping in ('session', 'week', 'month'):
            a = paired_bootstrap(rows, labels, left, right, grouping=grouping,
                                 iterations=400)
            b = paired_bootstrap(rows, labels, left, right, grouping=grouping,
                                 iterations=400)
            self.assertEqual(a, b)
            if grouping == 'month':
                self.assertEqual(a['status'], 'INSUFFICIENT_EVIDENCE')
            else:
                self.assertEqual(a['iterations'], 400)
                self.assertEqual(a['interval_95pct']['bear_pr_auc']['valid_replicates'], 400)

    def test_classification_is_descriptive(self):
        result = score(['ALCISTA', 'BAJISTA', 'LATERAL'] * 30,
                       [[.2, .3, .5]] * 90, 'xgboost')
        self.assertEqual(classify_comparison(result, result, 90), 'NO_IMPROVEMENT_OBSERVED')

    def test_bootstrap_reports_replicates_without_both_bear_classes(self):
        rows = [{'fold': 1, 'session_date_ny': '2026-10-01'},
                {'fold': 1, 'session_date_ny': '2026-10-02'}]
        probabilities = [[.1, .8, .1], [.2, .2, .6]]
        result = paired_bootstrap(rows, ['BAJISTA', 'LATERAL'], probabilities,
                                  probabilities, iterations=400)
        auc = result['interval_95pct']['bear_roc_auc']
        self.assertGreater(auc['valid_replicates'], 0)
        self.assertGreater(auc['excluded_replicates'], 0)
        self.assertEqual(auc['valid_replicates'] + auc['excluded_replicates'], 400)


if __name__ == '__main__':
    unittest.main()
