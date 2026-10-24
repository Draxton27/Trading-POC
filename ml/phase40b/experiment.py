"""Reproducible private comparison; never retrains the historical XGBoost."""
from __future__ import annotations

import argparse
import csv
import json
import platform
import tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import lightgbm as lgb
import numpy as np
import sklearn
import xgboost

from ml.phase28.train import CLASSES, FEATURES
from ml.phase38c.replay import inference_events
from ml.phase40a.bear_audit import json_numpy_scalar, sha
from ml.phase40b.dataset import reconstruct, original_probabilities
from ml.phase40b.evaluation import (classify_comparison, compare_original,
                                     paired_bootstrap, score)
from ml.phase40b.lightgbm_model import (LIGHTGBM_PARAMS, MAX_ITERATIONS, SEED,
                                        predict, refit, select_iterations)

SCENARIOS = ('ideal', 'delayed')
MODELS = ('xgboost', 'lightgbm', 'frequency', 'linear')
FIELDS = ('scenario', 'fold', 'session_date_ny', 'bar_start_utc', 'inference_at_utc',
          'feature_sha256', 'model_xgboost_sha256', 'model_lightgbm_sha256',
          'label', 'label_available_at_utc', 'exclusion', 'prob_xgboost',
          'prob_lightgbm', 'prob_frequency', 'prob_linear')


def source_preflight(dataset):
    """Check all XGBoost fold and pooled metrics before writing or training."""
    for scenario in SCENARIOS:
        plans = dataset['plans'][scenario]
        original = dataset['source_report']['scenarios'][scenario]
        all_labels = []
        all_probabilities = {name: [] for name in ('xgboost', 'frequency', 'linear')}
        for plan, fold_report in zip(plans, original['folds']):
            labels = [o['label'] for o, _ in plan['resolved']]
            if not labels:
                raise ValueError('Fold sin desenlaces evaluables.')
            for name in all_probabilities:
                values = [original_probabilities(p, name) for _, p in plan['resolved']]
                compare_original(labels, values, fold_report['metrics'][name], model=name)
                all_probabilities[name].extend(values)
            all_labels.extend(labels)
        if len(all_labels) != original['pooled']['rows']:
            raise ValueError('Conteo agregado XGBoost incompatible.')
        for name, values in all_probabilities.items():
            compare_original(all_labels, values, original['pooled']['metrics'][name], model=name)


def _evaluate(rows):
    labels = [r['label'] for r in rows]
    result = {name: score(labels, [r[f'prob_{name}'] for r in rows], name) for name in MODELS}
    return result


def _uncertainty(rows, grouping='session'):
    return paired_bootstrap(rows, [r['label'] for r in rows],
                            [r['prob_lightgbm'] for r in rows],
                            [r['prob_xgboost'] for r in rows], grouping=grouping)


def _run_in_private_directory(dataset, directory):
    records = []
    folds_report = {scenario: [] for scenario in SCENARIOS}
    model_manifest = []
    for scenario in SCENARIOS:
        for plan in dataset['plans'][scenario]:
            best = select_iterations(plan['core'], plan['early'])
            booster = refit(plan['train'], best)
            events = inference_events(plan['test'])
            probabilities = predict(booster, events)
            filename = f'model-{scenario}-fold-{plan["fold"]}.txt'
            model_path = directory / filename
            booster.save_model(str(model_path))
            reloaded = lgb.Booster(model_file=str(model_path))
            if not np.allclose(probabilities, predict(reloaded, events), atol=1e-12, rtol=0):
                raise ValueError('Modelo serializado no reproduce sus predicciones.')
            model_sha = sha(model_path)
            model_manifest.append({'scenario': scenario, 'fold': plan['fold'],
                                   'file': filename, 'sha256': model_sha})
            fold_rows = []
            for observation, original, light in zip(plan['test'], plan['original_predictions'], probabilities):
                row = {'scenario': scenario, 'fold': plan['fold'],
                       'session_date_ny': observation['session_date_ny'],
                       'bar_start_utc': observation['bar_start_utc'],
                       'inference_at_utc': observation['available_at_utc'],
                       'feature_sha256': observation['feature_sha256'],
                       'model_xgboost_sha256': original['model_sha256'],
                       'model_lightgbm_sha256': model_sha,
                       'label': observation['label'],
                       'label_available_at_utc': observation['label_available_at_utc'],
                       'exclusion': observation['exclusion'],
                       'prob_xgboost': original_probabilities(original, 'xgboost'),
                       'prob_lightgbm': light.tolist(),
                       'prob_frequency': original_probabilities(original, 'frequency'),
                       'prob_linear': original_probabilities(original, 'linear')}
                records.append(row)
                if row['label'] is not None:
                    fold_rows.append(row)
            if not fold_rows:
                raise ValueError('Fold sin objetivos evaluables.')
            fold_metrics = _evaluate(fold_rows)
            compare_original([r['label'] for r in fold_rows],
                             [r['prob_xgboost'] for r in fold_rows],
                             plan['source_fold']['metrics']['xgboost'])
            fold_uncertainty = _uncertainty(fold_rows)
            folds_report[scenario].append({
                'fold': plan['fold'], 'first_test_session': plan['first_test_session'],
                'cutoff_utc': plan['cutoff_utc'], 'train_rows': len(plan['train']),
                'max_train_label_available_at_utc': max(r['label_available_at_utc'] for r in plan['train']),
                'core_rows': len(plan['core']), 'early_rows': len(plan['early']),
                'early_cutoff_utc': plan['early_cutoff_utc'],
                'max_core_label_available_at_utc': max(r['label_available_at_utc'] for r in plan['core']),
                'best_iteration': best, 'test_rows': len(plan['test']),
                'resolved_rows': len(fold_rows), 'model_sha256': model_sha,
                'metrics': fold_metrics, 'paired_uncertainty': fold_uncertainty,
                'classification': classify_comparison(fold_metrics['lightgbm'],
                                                      fold_metrics['xgboost'], len(fold_rows))})
    scenarios_report = {}
    for scenario in SCENARIOS:
        subset = [r for r in records if r['scenario'] == scenario]
        resolved = [r for r in subset if r['label'] is not None]
        original = dataset['source_report']['scenarios'][scenario]
        metrics_by_model = _evaluate(resolved)
        compare_original([r['label'] for r in resolved],
                         [r['prob_xgboost'] for r in resolved],
                         original['pooled']['metrics']['xgboost'])
        scenarios_report[scenario] = {
            'observations': len(subset), 'resolved': len(resolved),
            'sessions': len({r['session_date_ny'] for r in resolved}),
            'exclusions': dict(Counter(r['exclusion'] or 'NONE' for r in subset)),
            'folds': folds_report[scenario], 'metrics': metrics_by_model,
            'paired_uncertainty': {kind: _uncertainty(resolved, kind)
                                   for kind in ('session', 'week', 'month')},
            'classification': classify_comparison(metrics_by_model['lightgbm'],
                                                  metrics_by_model['xgboost'], len(resolved))}
    report = {'schema': 'phase40b-lightgbm-comparison-v1', 'primary_scenario': 'delayed',
              'mode': 'HISTORICAL_REPLAY', 'classes': list(CLASSES), 'features': list(FEATURES),
              'models': list(MODELS), 'scenarios': scenarios_report,
              'warning': 'Histórico IEX previamente examinado. Comparación exploratoria; no es evidencia independiente ni señal operativa.',
              'method': 'LightGBM menos XGBoost original, sobre filas externas idénticas; argmax fijo; bootstrap pareado por grupos completos.'}
    manifest = {'schema': 'phase40b-manifest-v1', 'identity': 'NVDA-IEX-raw-15m-phase38e-folds',
                'created_at_utc': datetime.now(timezone.utc).isoformat(),
                'source_files_sha256': dict(sorted(dataset['source_hashes'].items())),
                'code_snapshot_drift': dataset['code_snapshot_drift'],
                'code_sha256': {f'ml/phase40b/{name}': sha(Path(__file__).parent / name)
                                for name in ('dataset.py', 'lightgbm_model.py', 'evaluation.py', 'experiment.py')},
                'versions': {'python': platform.python_version(), 'numpy': np.__version__,
                             'xgboost': xgboost.__version__, 'scikit_learn': sklearn.__version__,
                             'lightgbm': lgb.__version__, 'platform': platform.platform()},
                'features': list(FEATURES), 'classes': list(CLASSES), 'parameters': LIGHTGBM_PARAMS,
                'seed': SEED, 'threads': 2, 'max_iterations': MAX_ITERATIONS,
                'selection': 'Internal chronological multi_logloss early stopping (30 rounds); refit all causal train rows with best_iteration.',
                'source_observations': dataset['observation_count'],
                'source_predictions': dataset['prediction_count'],
                'records': len(records), 'resolved': sum(r['label'] is not None for r in records),
                'models': model_manifest, 'folds': {
                    scenario: [{key: fold[key] for key in ('fold', 'cutoff_utc', 'train_rows',
                       'max_train_label_available_at_utc', 'core_rows', 'early_rows',
                       'early_cutoff_utc', 'max_core_label_available_at_utc', 'best_iteration',
                       'test_rows', 'resolved_rows', 'model_sha256')}
                               for fold in folds_report[scenario]] for scenario in SCENARIOS},
                'policy': {'external_folds': dataset['source_report']['fold_policy'],
                           'historical_reception': 'SIMULATED_AVAILABILITY_ONLY',
                           'classification': 'argmax', 'no_new_features': True,
                           'no_xgboost_retraining': True, 'probability_tolerance': 1e-5}}
    return records, report, manifest


def _format_score(value):
    return 'N/D' if value is None else f'{value:.4f}'


def markdown(report):
    lines = ['# Fase 40B: comparación histórica LightGBM y XGBoost', '',
             'NVDA IEX raw 15m. Datos retrospectivos previamente examinados; sin validación prospectiva independiente.', '',
             'La configuración LightGBM, argmax y folds se fijaron antes de mirar las métricas externas.', '']
    for scenario in ('delayed', 'ideal'):
        result = report['scenarios'][scenario]
        lines += [f'## {scenario}', '', f'Filas evaluables: {result["resolved"]}; sesiones: {result["sessions"]}.', '',
                  '| Modelo | Macro F1 | Recall BAJISTA | Precision BAJISTA | Log loss | PR-AUC BAJISTA |',
                  '|---|---:|---:|---:|---:|---:|']
        for name in ('xgboost', 'lightgbm', 'frequency', 'linear'):
            values = result['metrics'][name]
            lines.append(f'| {name} | {_format_score(values["macro_f1"])} | '
                         f'{_format_score(values["per_class"]["BAJISTA"]["recall"])} | '
                         f'{_format_score(values["per_class"]["BAJISTA"]["precision"])} | '
                         f'{_format_score(values["log_loss"])} | {_format_score(values["bear_ovr"]["pr_auc"])} |')
        a, b = result['metrics']['lightgbm'], result['metrics']['xgboost']
        lines += ['', f'LightGBM − XGBoost: Macro F1 {_format_score(a["macro_f1"]-b["macro_f1"])}; '
                  f'recall BAJISTA {_format_score(a["per_class"]["BAJISTA"]["recall"]-b["per_class"]["BAJISTA"]["recall"])}; '
                  f'precision BAJISTA {_format_score(a["per_class"]["BAJISTA"]["precision"]-b["per_class"]["BAJISTA"]["precision"])}; '
                  f'log loss {_format_score(a["log_loss"]-b["log_loss"])}.',
                  f'Clasificación descriptiva: `{result["classification"]}`. Los intervalos por sesión, semana y mes están en report.json.', '']
    lines += ['## Límites', '',
              'La hora de disponibilidad histórica es simulada, no una recepción registrada. Las aperturas OHLC no son ejecuciones.',
              'Los intervalos agrupados no capturan necesariamente dependencias entre jornadas ni cambios prolongados de régimen.',
              'Los objetivos ideal y delayed pueden diferir; no se combinan. Una mejora retrospectiva no autoriza cambiar el modelo operativo.',
              'Sin nuevas variables, LightGBM en Live, órdenes ni recomendaciones CALL/PUT.', '']
    return '\n'.join(lines)


def run(source, output, *, minimum_train_sessions=252, test_sessions=126, loader=None):
    source, output = Path(source).resolve(), Path(output).resolve()
    if output.exists() or output == source or source in output.parents or output in source.parents:
        raise ValueError('La salida debe ser una carpeta nueva e independiente.')
    if platform.python_version_tuple()[:2] != ('3', '12') or lgb.__version__ != '4.7.0':
        raise ValueError('Se requieren Python 3.12 y LightGBM 4.7.0.')
    kwargs = {'minimum_train_sessions': minimum_train_sessions,
              'test_sessions': test_sessions}
    if loader is not None:
        kwargs['loader'] = loader
    dataset = reconstruct(source, **kwargs)
    source_preflight(dataset)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='phase40b-pending-', dir=output.parent) as temporary:
        temporary = Path(temporary)
        records, report, manifest = _run_in_private_directory(dataset, temporary)
        with (temporary / 'predictions.csv').open('x', newline='', encoding='utf8') as handle:
            writer = csv.DictWriter(handle, fieldnames=FIELDS)
            writer.writeheader()
            for row in records:
                writer.writerow({name: json.dumps(row[name], separators=(',', ':'))
                                 if isinstance(row[name], list) else row[name] for name in FIELDS})
        (temporary / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False,
                                                 allow_nan=False, default=json_numpy_scalar) + '\n', encoding='utf8')
        (temporary / 'report.md').write_text(markdown(report), encoding='utf8')
        (temporary / 'manifest.json').write_text(json.dumps(manifest, indent=2,
                                                 ensure_ascii=False, allow_nan=False,
                                                 default=json_numpy_scalar) + '\n', encoding='utf8')
        names = ['manifest.json', 'report.json', 'report.md', 'predictions.csv',
                 *(model['file'] for model in manifest['models'])]
        (temporary / 'SHA256SUMS').write_text(''.join(f'{sha(temporary / name)}  {name}\n'
                                                  for name in names), encoding='utf8')
        if output.exists():
            raise ValueError('La salida fue creada por otro proceso.')
        temporary.rename(output)
    return report


def main():
    parser = argparse.ArgumentParser(description='Comparación IEX retrospectiva Fase 40B')
    parser.add_argument('--run', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    report = run(args.run, args.out)
    print(json.dumps({'status': 'OK', 'scenarios': {name: {'resolved': item['resolved'],
                         'classification': item['classification']}
                         for name, item in report['scenarios'].items()}}, ensure_ascii=False))


if __name__ == '__main__':
    main()
