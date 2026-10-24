import csv
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from ml.phase40a.bear_audit import sha
from ml.phase40b import evaluation as evaluation40b
from ml.phase40c1.test_experiment import synthetic_sources
from ml.phase40c2 import experiment
from ml.phase40c2.trend_features import BASE_FEATURES, TREND_FEATURES, extended_hash


def prepared_sources(root, *, excluded_last=False):
    source, run38e, baseline, marker = synthetic_sources(root, excluded_last=excluded_last)
    for item in source['extended'].values():
        base = {name: item['features'][name] for name in BASE_FEATURES}
        trend = {name: float((index+1) / 100) for index, name in enumerate(TREND_FEATURES)}
        item['features'] = {**base, **trend}
        item['feature_sha256'] = extended_hash(base, trend)
    source['feature_audit']['matched_38e_observations'] = len(source['extended'])
    source['feature_audit']['long_window_coverage'] = {'purpose': 'synthetic test only'}
    return source, run38e, baseline, marker


class ExperimentTests(unittest.TestCase):
    def test_synthetic_end_to_end_models_folds_hashes_and_source_immutability(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            prepared, run38e, baseline, marker = prepared_sources(root)
            before = (sha(marker), sha(baseline / 'predictions.csv'))
            original = evaluation40b.paired_bootstrap
            with patch.object(experiment, 'uncertainty',
                side_effect=lambda rows, a, b, group: {**original(
                    rows, [row['label'] for row in rows],
                    [row[f'prob_{a}'] for row in rows],
                    [row[f'prob_{b}'] for row in rows], grouping=group, iterations=8),
                    'difference': f'{a}_minus_{b}'}) :
                report = experiment.run(root / 'history', run38e, baseline,
                                        root / 'output', prepared=prepared)
                repeated = experiment.run(root / 'history', run38e, baseline,
                                          root / 'repeat', prepared=prepared)
            self.assertEqual(report['scenarios'], repeated['scenarios'])
            self.assertEqual((sha(marker), sha(baseline / 'predictions.csv')), before)
            self.assertEqual(report['scenarios']['ideal']['resolved'], 6)
            self.assertEqual(report['scenarios']['delayed']['resolved'], 6)
            self.assertEqual(len(report['extended_features']), 19)
            self.assertNotIn('return_8', report['extended_features'])
            self.assertEqual(len(report['scenarios']['ideal']['folds']), 1)
            fold = report['scenarios']['ideal']['folds'][0]
            self.assertLess(fold['max_train_label_available_at_utc'], fold['cutoff_utc'])
            self.assertLess(fold['max_core_label_available_at_utc'], fold['early_cutoff_utc'])
            self.assertIn('xgb_gain', fold['feature_diagnostics'])
            self.assertIn('highest_absolute_training_correlation', fold['feature_diagnostics'])
            self.assertEqual(fold['paired_uncertainty']['xgb_trend']['iterations'], 8)
            output = root / 'output'
            manifest = json.loads((output / 'manifest.json').read_text(encoding='utf8'))
            self.assertEqual(len(manifest['models']), 4)
            self.assertEqual(manifest['seed'], 7)
            with (output / 'predictions.csv').open(newline='', encoding='utf8') as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual(len(rows), 12)
            self.assertEqual(set(rows[0]), set(experiment.FIELDS))
            self.assertEqual(sha(output / 'predictions.csv'), sha(root / 'repeat' / 'predictions.csv'))
            for line in (output / 'SHA256SUMS').read_text(encoding='utf8').splitlines():
                digest, name = line.split('  ', 1)
                self.assertEqual(sha(output / name), digest)
            with self.assertRaisesRegex(ValueError, 'carpeta nueva'):
                experiment.run(root / 'history', run38e, baseline, output, prepared=prepared)

    def test_excluded_outcome_retains_original_row_and_blocks_future_labels(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            prepared, run38e, baseline, _ = prepared_sources(root, excluded_last=True)
            original = evaluation40b.paired_bootstrap
            with patch.object(experiment, 'uncertainty',
                side_effect=lambda rows, a, b, group: original(
                    rows, [row['label'] for row in rows],
                    [row[f'prob_{a}'] for row in rows],
                    [row[f'prob_{b}'] for row in rows], grouping=group, iterations=4)):
                report = experiment.run(root / 'history', run38e, baseline,
                                        root / 'excluded', prepared=prepared)
            self.assertEqual(report['scenarios']['ideal']['resolved'], 5)
            self.assertEqual(report['scenarios']['ideal']['exclusions']['MARKET_CLOSE'], 1)
            prepared['dataset']['plans']['ideal'][0]['core'][-1]['label_available_at_utc'] = \
                '2026-10-05T17:00:00.000Z'
            with self.assertRaisesRegex(ValueError, 'etiquetas futuras'):
                experiment.run(root / 'history', run38e, baseline,
                               root / 'reject', prepared=prepared)
            self.assertFalse((root / 'reject').exists())

    def test_markdown_missing_auc_and_versioned_output_rejected(self):
        from ml.phase40b.evaluation import score
        measured = score(['LATERAL', 'LATERAL'], [[.1, .1, .8], [.1, .1, .8]], 'xgboost')
        scenario = {'resolved': 2,
                    'metrics': {name: measured for name in experiment.VARIANTS},
                    'classification': {'xgb_trend': 'INSUFFICIENT_EVIDENCE',
                                       'lgb_trend': 'INSUFFICIENT_EVIDENCE'}}
        self.assertIn('N/D', experiment.markdown({'scenarios': {'ideal': scenario,
                                                                'delayed': scenario}}))
        repository = Path(experiment.__file__).resolve().parents[2]
        with self.assertRaisesRegex(ValueError, 'fuera de archivos versionados'):
            experiment.run(repository / 'private' / 'history',
                           repository / 'private' / 'source',
                           repository / 'private' / 'baseline',
                           repository / 'docs' / 'must-not-create')


if __name__ == '__main__':
    unittest.main()
