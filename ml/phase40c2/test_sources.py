import csv
import tempfile
import unittest
from pathlib import Path

from ml.phase40a.bear_audit import sha
from ml.phase40c1.sources import load_baseline40b
from ml.phase40c1.test_experiment import synthetic_sources


class SourceTests(unittest.TestCase):
    def test_40b_hash_and_exact_fold_rows_are_verified(self):
        with tempfile.TemporaryDirectory() as temp:
            prepared, _, baseline, _ = synthetic_sources(Path(temp))
            dataset = prepared['dataset']
            aligned, manifest, report, hashes, _ = load_baseline40b(baseline, dataset)
            self.assertEqual(len(aligned), manifest['records'])
            self.assertEqual(hashes['predictions.csv'], sha(baseline / 'predictions.csv'))
            self.assertEqual(report['scenarios']['ideal']['resolved'], 6)
            predictions = baseline / 'predictions.csv'
            with predictions.open(newline='', encoding='utf8') as handle:
                rows = list(csv.DictReader(handle))
                fields = list(rows[0])
            rows[0]['bar_start_utc'] = '2026-10-24T00:00:00.000Z'
            with predictions.open('w', newline='', encoding='utf8') as handle:
                writer = csv.DictWriter(handle, fieldnames=fields)
                writer.writeheader()
                writer.writerows(rows)
            sums = baseline / 'SHA256SUMS'
            lines = [f'{sha(predictions)}  predictions.csv' if line.endswith('  predictions.csv') else line
                     for line in sums.read_text(encoding='utf8').splitlines()]
            sums.write_text('\n'.join(lines) + '\n', encoding='utf8')
            with self.assertRaisesRegex(ValueError, 'diferente de observación'):
                load_baseline40b(baseline, dataset)


if __name__ == '__main__':
    unittest.main()
