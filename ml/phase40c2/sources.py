"""Read-only verification of the original IEX, 38E and 40B artifacts."""
from __future__ import annotations

import json
from pathlib import Path

from ml.phase40a.bear_audit import load_verified
from ml.phase40b.dataset import reconstruct
from ml.phase40b.experiment import source_preflight
from ml.phase40c1.sources import load_baseline40b
from ml.phase40c1.temporal_features import load_history
from ml.phase40c2.trend_features import align_observations, long_window_audit, trend_index


def prepare_sources(history, run38e, baseline40b):
    dataset = reconstruct(run38e)
    source_preflight(dataset)
    manifest = json.loads((Path(run38e) / 'manifest.json').read_text(encoding='utf8'))
    bars, calendar, history_hashes, query = load_history(history, manifest)
    index, audit = trend_index(bars, calendar)
    _, observations, _, _, _, _ = load_verified(run38e)
    aligned = align_observations(observations, bars, index)
    baseline, baseline_manifest, baseline_report, baseline_hashes, line_endings = load_baseline40b(
        baseline40b, dataset)
    long_audit = long_window_audit(observations, bars, index, calendar, dataset['plans'])
    return {'dataset': dataset, 'extended': aligned, 'baseline': baseline,
            'baseline_manifest': baseline_manifest, 'baseline_report': baseline_report,
            'history_hashes': history_hashes, 'baseline_hashes': baseline_hashes,
            'baseline_code_line_ending_variation': line_endings,
            'history_query': query, 'feature_audit': {
                **audit, 'matched_38e_observations': len(aligned),
                'matched_38e_unique_bars': len(aligned) // 2,
                'indicator_tolerance_absolute': 1e-12,
                'long_window_coverage': long_audit}}
