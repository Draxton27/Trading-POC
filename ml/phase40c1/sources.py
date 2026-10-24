"""Cross-check the immutable 38E and 40B experiments before fitting new models."""
from __future__ import annotations

import csv
import json
from pathlib import Path

from ml.phase28.train import CLASSES
from ml.phase40a.bear_audit import declared_hashes, probability_vector, sha
from ml.phase40b.dataset import reconstruct
from ml.phase40b.evaluation import compare_original
from ml.phase40b.experiment import source_preflight
from ml.phase40c1.temporal_features import (BASE_FEATURES, align_observations,
                                            load_history, temporal_index)


def load_baseline40b(directory, dataset):
    directory = Path(directory)
    declared = declared_hashes(directory)
    required = {'manifest.json', 'report.json', 'predictions.csv', 'report.md'}
    if not required.issubset(declared):
        raise ValueError('Baseline 40B incompleto.')
    for name, digest in declared.items():
        if not (directory / name).is_file() or sha(directory / name) != digest:
            raise ValueError(f'Integridad 40B inválida: {name}.')
    manifest = json.loads((directory / 'manifest.json').read_text(encoding='utf8'))
    report = json.loads((directory / 'report.json').read_text(encoding='utf8'))
    if (manifest.get('schema') != 'phase40b-manifest-v1' or
            report.get('schema') != 'phase40b-lightgbm-comparison-v1' or
            manifest.get('source_files_sha256') != dataset['source_hashes'] or
            manifest.get('features') != list(BASE_FEATURES) or
            manifest.get('classes') != list(CLASSES) or
            report.get('features') != list(BASE_FEATURES) or
            report.get('classes') != list(CLASSES) or
            manifest.get('seed') != 7 or manifest.get('threads') != 2):
        raise ValueError('Baseline 40B incompatible con 38E.')
    root = Path(__file__).resolve().parents[2]
    line_ending_variation = []
    for name, digest in manifest.get('code_sha256', {}).items():
        if name.startswith('/') or '..' in Path(name).parts or not (root / name).is_file():
            raise ValueError('Snapshot de código 40B ausente.')
        raw = (root / name).read_bytes()
        if sha(root / name) != digest:
            # Git on Windows checked LF sources out as CRLF after the private
            # run. Accept only byte-identical content after CRLF -> LF.
            import hashlib
            normalized = hashlib.sha256(raw.replace(bytes([13, 10]), bytes([10]))).hexdigest()
            if normalized != digest:
                raise ValueError('Snapshot de código 40B diferente; no atribuible al experimento.')
            line_ending_variation.append(name)
    models = {(item['scenario'], int(item['fold'])): item for item in manifest['models']}
    if len(models) != sum(len(dataset['plans'][scenario]) for scenario in ('ideal', 'delayed')):
        raise ValueError('Modelos 40B incompletos.')
    for item in models.values():
        if declared.get(item['file']) != item['sha256']:
            raise ValueError('Hash de modelo 40B incompatible.')
    with (directory / 'predictions.csv').open(newline='', encoding='utf8') as handle:
        predictions = list(csv.DictReader(handle))
    if len(predictions) != manifest['records']:
        raise ValueError('Conteo de predicciones 40B incompatible.')
    aligned = {}
    for row in predictions:
        key = (row['scenario'], row['bar_start_utc'])
        if key in aligned:
            raise ValueError('Predicciones 40B duplicadas.')
        aligned[key] = row
    for scenario in ('ideal', 'delayed'):
        all_labels, all_xgb, all_light = [], [], []
        folds = dataset['plans'][scenario]
        baseline = report['scenarios'][scenario]
        if len(folds) != len(baseline['folds']):
            raise ValueError('Folds 40B distintos de 38E.')
        for plan, original in zip(folds, baseline['folds']):
            number = plan['fold']
            model = models[(scenario, number)]
            expected = plan['test']
            rows = [row for row in predictions if row['scenario'] == scenario and int(row['fold']) == number]
            if (len(rows) != len(expected) or original['fold'] != number or
                    original['cutoff_utc'] != plan['cutoff_utc'] or
                    original['train_rows'] != len(plan['train']) or
                    original['test_rows'] != len(expected)):
                raise ValueError('Folds o entrenamiento 40B desalineados.')
            labels, xgb, light = [], [], []
            for observation, source_prediction, row in zip(expected, plan['original_predictions'], rows):
                if (row['bar_start_utc'] != observation['bar_start_utc'] or
                        row['session_date_ny'] != observation['session_date_ny'] or
                        row['feature_sha256'] != observation['feature_sha256'] or
                        row['inference_at_utc'] != observation['available_at_utc'] or
                        row['model_xgboost_sha256'] != source_prediction['model_sha256'] or
                        row['model_lightgbm_sha256'] != model['sha256'] or
                        row['label'] != (observation['label'] or '') or
                        row['label_available_at_utc'] != (observation['label_available_at_utc'] or '') or
                        row['exclusion'] != (observation['exclusion'] or '')):
                    raise ValueError('Fila 40B diferente de observación 38E.')
                p_xgb = probability_vector(row['prob_xgboost'])
                p_light = probability_vector(row['prob_lightgbm'])
                if p_xgb != probability_vector(source_prediction['prob_xgboost']):
                    raise ValueError('Probabilidad XGBoost 40B diferente de 38E.')
                if observation['label'] is not None:
                    labels.append(observation['label'])
                    xgb.append(p_xgb)
                    light.append(p_light)
            if len(labels) != original['resolved_rows']:
                raise ValueError('Desenlaces 40B desalineados.')
            compare_original(labels, xgb, original['metrics']['xgboost'])
            compare_original(labels, light, original['metrics']['lightgbm'], model='lightgbm')
            all_labels.extend(labels)
            all_xgb.extend(xgb)
            all_light.extend(light)
        if (baseline['observations'] != sum(len(plan['test']) for plan in folds) or
                baseline['resolved'] != len(all_labels)):
            raise ValueError('Conteo agregado 40B incompatible.')
        compare_original(all_labels, all_xgb, baseline['metrics']['xgboost'])
        compare_original(all_labels, all_light, baseline['metrics']['lightgbm'], model='lightgbm')
    if len(aligned) != sum(len(plan['test']) for scenario in ('ideal', 'delayed')
                           for plan in dataset['plans'][scenario]):
        raise ValueError('Predicciones 40B ajenas a los folds originales.')
    return aligned, manifest, report, declared, line_ending_variation


def prepare_sources(history, run, baseline40b):
    dataset = reconstruct(run)
    source_preflight(dataset)
    source_manifest = json.loads((Path(run) / 'manifest.json').read_text(encoding='utf8'))
    bars, calendar, history_hashes, query = load_history(history, source_manifest)
    temporal, audit = temporal_index(bars, calendar)
    # Only the two verified 38E observations per timestamp may receive new data.
    from ml.phase40a.bear_audit import load_verified
    _, observations, _, _, _, _ = load_verified(run)
    extended = align_observations(observations, bars, temporal)
    baseline, baseline_manifest, baseline_report, baseline_hashes, line_endings = load_baseline40b(baseline40b, dataset)
    return {'dataset': dataset, 'extended': extended, 'baseline': baseline,
            'baseline_manifest': baseline_manifest, 'baseline_report': baseline_report,
            'history_hashes': history_hashes, 'baseline_hashes': baseline_hashes,
            'baseline_code_line_ending_variation': line_endings,
            'history_query': query, 'feature_audit': {
                **audit, 'matched_38e_observations': len(extended),
                'matched_38e_unique_bars': len(extended) // 2,
                'return_tolerance_absolute': 1e-12}}
