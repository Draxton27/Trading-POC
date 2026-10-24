import csv
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from ml.phase40b import experiment, evaluation
from ml.phase40b.test_helpers import fake_source


class ExperimentTests(unittest.TestCase):
    def test_complete_synthetic_cycle_private_and_reproducible(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source'
            source.mkdir()
            marker = source / 'do-not-change.txt'
            marker.write_text('original')
            original_sha = hashlib.sha256(marker.read_bytes()).hexdigest()
            loader = fake_source()
            real = evaluation.paired_bootstrap
            def reduced(*args, **kwargs):
                return real(*args, iterations=12, **kwargs)
            with patch.object(experiment, 'paired_bootstrap', side_effect=reduced):
                first = experiment.run(source, root / 'first',
                    minimum_train_sessions=3, test_sessions=2, loader=loader)
                second = experiment.run(source, root / 'second',
                    minimum_train_sessions=3, test_sessions=2, loader=fake_source())
            self.assertEqual(first['scenarios']['delayed']['resolved'], 6)
            self.assertEqual(first['scenarios']['ideal']['resolved'], 6)
            self.assertEqual(first['scenarios']['delayed']['metrics']['xgboost'],
                             second['scenarios']['delayed']['metrics']['xgboost'])
            self.assertEqual(hashlib.sha256(marker.read_bytes()).hexdigest(), original_sha)
            with (root / 'first' / 'predictions.csv').open(newline='', encoding='utf8') as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual(len(rows), 12)
            self.assertEqual({r['scenario'] for r in rows}, {'ideal', 'delayed'})
            self.assertEqual(json.loads(rows[0]['prob_lightgbm']).__len__(), 3)
            for folder in ('first', 'second'):
                target = root / folder
                manifest = json.loads((target / 'manifest.json').read_text())
                self.assertEqual(manifest['classes'], ['ALCISTA', 'BAJISTA', 'LATERAL'])
                for line in (target / 'SHA256SUMS').read_text().splitlines():
                    digest, filename = line.split('  ', 1)
                    self.assertEqual(hashlib.sha256((target / filename).read_bytes()).hexdigest(), digest)
            models_a = json.loads((root / 'first' / 'manifest.json').read_text())['models']
            models_b = json.loads((root / 'second' / 'manifest.json').read_text())['models']
            self.assertEqual([(m['scenario'], m['sha256']) for m in models_a],
                             [(m['scenario'], m['sha256']) for m in models_b])
            with self.assertRaisesRegex(ValueError, 'carpeta nueva'):
                experiment.run(source, root / 'first', minimum_train_sessions=3,
                               test_sessions=2, loader=loader)

    def test_source_metric_mismatch_stops_before_output(self):
        loader = fake_source()
        _, _, _, report, _, _ = loader(None)
        report['scenarios']['delayed']['pooled']['metrics']['xgboost']['macro_f1'] += .1
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'never-created'
            with self.assertRaisesRegex(ValueError, 'Métrica xgboost'):
                experiment.run(Path(directory) / 'source', target,
                    minimum_train_sessions=3, test_sessions=2, loader=loader)
            self.assertFalse(target.exists())

    def test_frequency_mismatch_and_zero_evaluable_fold_fail_closed(self):
        loader = fake_source()
        _, _, predictions, _, _, _ = loader(None)
        predictions[0]['prob_frequency'] = '[0.8,0.1,0.1]'
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'no-frequency-mismatch'
            with self.assertRaisesRegex(ValueError, 'frequency'):
                experiment.run(Path(directory) / 'source', target,
                    minimum_train_sessions=3, test_sessions=2, loader=loader)
            self.assertFalse(target.exists())
        loader = fake_source()
        _, observations, _, report, _, _ = loader(None)
        for item in observations:
            if item['scenario'] == 'delayed' and item['session_date_ny'] >= '2026-10-04':
                item['label'] = None
                item['label_available_at_utc'] = None
                item['exclusion'] = 'MARKET_CLOSE'
        report['scenarios']['delayed']['folds'][0]['resolved_rows'] = 0
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'zero-label-fold'
            with self.assertRaisesRegex(ValueError, 'sin desenlaces'):
                experiment.run(Path(directory) / 'source', target,
                    minimum_train_sessions=3, test_sessions=2, loader=loader)
            self.assertFalse(target.exists())


if __name__ == '__main__':
    unittest.main()
