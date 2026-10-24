import csv
import hashlib
import json
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from ml.phase28.train import CLASSES
from ml.phase40a.bear_audit import declared_hashes, sha
from ml.phase40b.dataset import reconstruct
from ml.phase40b.experiment import run as run40b, source_preflight
from ml.phase40b.test_helpers import fake_source
from ml.phase40c1 import experiment
from ml.phase40c1.sources import load_baseline40b
from ml.phase40c1.temporal_features import TEMPORAL_FEATURES, extended_hash


def synthetic_sources(root, *, excluded_last=False):
    loader = fake_source(excluded_last=excluded_last)
    _, observations, _, _, _, _ = loader(None)
    for item in observations:
        end = datetime.fromisoformat(item['bar_start_utc'].replace('Z', '+00:00')) + timedelta(minutes=15)
        item['bar_end_utc'] = end.isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    source = root / 'source38e'
    source.mkdir()
    marker = source / 'immutable.txt'
    marker.write_text('historical source', encoding='utf8')
    baseline_dir = root / 'baseline40b'
    from ml.phase40b import evaluation as evaluation40b
    original = evaluation40b.paired_bootstrap
    with patch('ml.phase40b.experiment.paired_bootstrap',
               side_effect=lambda *args, **kwargs: original(*args, iterations=8, **kwargs)):
        run40b(source, baseline_dir, minimum_train_sessions=3, test_sessions=2, loader=loader)
    dataset = reconstruct(source, minimum_train_sessions=3, test_sessions=2, loader=loader)
    source_preflight(dataset)
    aligned, manifest, report, hashes, line_endings = load_baseline40b(baseline_dir, dataset)
    extended = {}
    for item in observations:
        temporal = {name: float((index + 1) / 100) for index, name in enumerate(TEMPORAL_FEATURES)}
        key = (item['scenario'], item['bar_start_utc'])
        extended[key] = {'features': {**item['features'], **temporal},
                         'feature_sha256': extended_hash(item['features'], temporal),
                         'original_feature_sha256': item['feature_sha256'],
                         'continuous_bars': 21}
    prepared = {'dataset': dataset, 'extended': extended, 'baseline': aligned,
                'baseline_manifest': manifest, 'baseline_report': report,
                'history_hashes': {'strict-15m.csv': 'synthetic-source-hash'},
                'baseline_hashes': hashes, 'baseline_code_line_ending_variation': line_endings,
                'feature_audit': {'strict_bars': 21, 'eligible_bars': 21,
                                  'matched_38e_observations': len(observations)}}
    return prepared, source, baseline_dir, marker


class ExperimentTests(unittest.TestCase):
    def test_end_to_end_synthetic_models_folds_hashes_and_no_source_writes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            prepared, source, baseline, marker = synthetic_sources(root)
            source_hash = sha(marker)
            baseline_hash = sha(baseline / 'predictions.csv')
            from ml.phase40b import evaluation as evaluation40b
            original = evaluation40b.paired_bootstrap
            with patch.object(experiment, 'paired_bootstrap',
                side_effect=lambda *args, **kwargs: original(*args, iterations=8, **kwargs)):
                report = experiment.run(root / 'history', source, baseline, root / 'new', prepared=prepared)
                repeated = experiment.run(root / 'history', source, baseline, root / 'repeat', prepared=prepared)
            self.assertEqual(report['scenarios']['ideal']['resolved'], 6)
            self.assertEqual(report['scenarios']['delayed']['resolved'], 6)
            self.assertEqual(report['extended_features'][-7:], list(TEMPORAL_FEATURES))
            self.assertEqual(sha(marker), source_hash)
            self.assertEqual(sha(baseline / 'predictions.csv'), baseline_hash)
            self.assertEqual(report['scenarios'], repeated['scenarios'])
            self.assertEqual(sha(root / 'new' / 'predictions.csv'),
                             sha(root / 'repeat' / 'predictions.csv'))
            output = root / 'new'
            manifest = json.loads((output / 'manifest.json').read_text(encoding='utf8'))
            self.assertEqual(len(manifest['models']), 4)
            self.assertEqual(len(manifest['features']), 17)
            self.assertEqual(manifest['seed'], 7)
            with (output / 'predictions.csv').open(newline='', encoding='utf8') as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual(len(rows), 12)
            self.assertEqual(set(rows[0]), set(experiment.FIELDS))
            self.assertEqual({row['scenario'] for row in rows}, {'ideal', 'delayed'})
            for scenario in ('ideal', 'delayed'):
                fold = report['scenarios'][scenario]['folds'][0]
                self.assertEqual(fold['train_rows'], 9)
                self.assertLess(fold['max_train_label_available_at_utc'], fold['cutoff_utc'])
                self.assertEqual(fold['test_rows'], 6)
                self.assertIn('xgb_temporal', fold['metrics'])
                self.assertIn('lgb_temporal', fold['metrics'])
                self.assertIn('bear_ovr', fold['metrics']['xgb_temporal'])
                self.assertEqual(fold['paired_uncertainty']['xgb_temporal']['iterations'], 8)
            for line in (output / 'SHA256SUMS').read_text(encoding='utf8').splitlines():
                digest, name = line.split('  ', 1)
                self.assertEqual(sha(output / name), digest)
            with self.assertRaisesRegex(ValueError, 'carpeta nueva'):
                experiment.run(root / 'history', source, baseline, output, prepared=prepared)

    def test_baseline40b_hash_and_exact_row_alignment_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            prepared, _, baseline, _ = synthetic_sources(root)
            dataset = prepared['dataset']
            predictions = baseline / 'predictions.csv'
            predictions.write_text(predictions.read_text(encoding='utf8') + '\n', encoding='utf8')
            with self.assertRaisesRegex(ValueError, 'Integridad 40B'):
                load_baseline40b(baseline, dataset)

    def test_baseline40b_rejects_semantic_change_even_with_updated_file_hash(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            prepared, _, baseline, _ = synthetic_sources(root)
            predictions = baseline / 'predictions.csv'
            with predictions.open(newline='', encoding='utf8') as handle:
                rows = list(csv.DictReader(handle))
                columns = list(rows[0])
            rows[0]['prob_lightgbm'] = '[0.8,0.1,0.1]'
            with predictions.open('w', newline='', encoding='utf8') as handle:
                writer = csv.DictWriter(handle, fieldnames=columns)
                writer.writeheader()
                writer.writerows(rows)
            sums = baseline / 'SHA256SUMS'
            updated = [f'{sha(predictions)}  predictions.csv' if line.endswith('  predictions.csv') else line
                       for line in sums.read_text(encoding='utf8').splitlines()]
            sums.write_text('\n'.join(updated) + '\n', encoding='utf8')
            with self.assertRaisesRegex(ValueError, 'Métrica lightgbm'):
                load_baseline40b(baseline, prepared['dataset'])

    def test_different_test_timestamp_stops_before_training(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            prepared, _, baseline, _ = synthetic_sources(root)
            predictions = baseline / 'predictions.csv'
            with predictions.open(newline='', encoding='utf8') as handle:
                rows = list(csv.DictReader(handle))
                columns = list(rows[0])
            rows[0]['bar_start_utc'] = '2026-10-24T00:00:00.000Z'
            with predictions.open('w', newline='', encoding='utf8') as handle:
                writer = csv.DictWriter(handle, fieldnames=columns)
                writer.writeheader()
                writer.writerows(rows)
            sums = baseline / 'SHA256SUMS'
            updated = [f'{sha(predictions)}  predictions.csv' if line.endswith('  predictions.csv') else line
                       for line in sums.read_text(encoding='utf8').splitlines()]
            sums.write_text('\n'.join(updated) + '\n', encoding='utf8')
            with self.assertRaisesRegex(ValueError, 'diferente de observación'):
                load_baseline40b(baseline, prepared['dataset'])

    def test_external_labels_never_enter_predictor_and_early_purge(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            prepared, source, baseline, _ = synthetic_sources(root)
            plan = prepared['dataset']['plans']['ideal'][0]
            events = experiment._events(plan, prepared['extended'])
            self.assertTrue(all(set(item) == {'features', 'bar_start_utc'} for item in events))
            self.assertTrue(all('label' not in item for item in events))
            plan['core'][-1]['label_available_at_utc'] = '2026-10-05T17:00:00.000Z'
            from ml.phase40b import evaluation as evaluation40b
            original = evaluation40b.paired_bootstrap
            with patch.object(experiment, 'paired_bootstrap',
                side_effect=lambda *args, **kwargs: original(*args, iterations=4, **kwargs)):
                with self.assertRaisesRegex(ValueError, 'etiquetas futuras'):
                    experiment.run(root / 'history', source, baseline, root / 'reject', prepared=prepared)
            self.assertFalse((root / 'reject').exists())

    def test_rejects_versioned_output_location(self):
        repository = Path(experiment.__file__).resolve().parents[2]
        with self.assertRaisesRegex(ValueError, 'fuera de archivos versionados'):
            experiment.run(repository / 'private' / 'history',
                           repository / 'private' / 'source',
                           repository / 'private' / 'baseline',
                           repository / 'docs' / 'must-not-create')
        self.assertFalse((repository / 'docs' / 'must-not-create').exists())

    def test_markdown_does_not_invent_auc_without_bear_examples(self):
        from ml.phase40b.evaluation import score
        measured = score(['LATERAL', 'LATERAL'], [[.1, .1, .8], [.1, .1, .8]], 'xgboost')
        self.assertIsNone(measured['bear_ovr']['pr_auc'])
        scenario = {'resolved': 2,
                    'metrics': {name: measured for name in experiment.VARIANTS_NAMES},
                    'classification': {'xgb_temporal': 'INSUFFICIENT_EVIDENCE',
                                       'lgb_temporal': 'INSUFFICIENT_EVIDENCE'}}
        text = experiment.markdown({'scenarios': {'ideal': scenario, 'delayed': scenario}})
        self.assertIn('N/D', text)

    def test_market_close_exclusion_is_retained_without_a_label(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            prepared, source, baseline, _ = synthetic_sources(root, excluded_last=True)
            from ml.phase40b import evaluation as evaluation40b
            original = evaluation40b.paired_bootstrap
            with patch.object(experiment, 'paired_bootstrap',
                side_effect=lambda *args, **kwargs: original(*args, iterations=4, **kwargs)):
                report = experiment.run(root / 'history', source, baseline,
                                        root / 'excluded', prepared=prepared)
            self.assertEqual(report['scenarios']['ideal']['resolved'], 5)
            self.assertEqual(report['scenarios']['delayed']['resolved'], 5)
            self.assertEqual(report['scenarios']['ideal']['exclusions']['MARKET_CLOSE'], 1)
            with (root / 'excluded' / 'predictions.csv').open(newline='', encoding='utf8') as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual(len(rows), 12)
            self.assertEqual(sum(row['exclusion'] == 'MARKET_CLOSE' for row in rows), 2)
            self.assertTrue(all(row['label'] == '' for row in rows if row['exclusion'] == 'MARKET_CLOSE'))


if __name__ == '__main__':
    unittest.main()
