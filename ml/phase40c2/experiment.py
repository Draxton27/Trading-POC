"""Private, causal BASE_10 versus BASE_10_PLUS_TREND_9 replay."""
from __future__ import annotations

import argparse
import csv
import json
import platform
import sys
import tempfile
from collections import Counter
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path

import lightgbm as lgb
import numpy as np
import sklearn
import xgboost as xgb

from ml.phase28.train import CLASSES, VARIANTS as XGB_PARAMS
from ml.phase40a.bear_audit import json_numpy_scalar, probability_vector, sha
from ml.phase40b.evaluation import classify_comparison, compare_original
from ml.phase40b.lightgbm_model import LIGHTGBM_PARAMS, MAX_ITERATIONS
from ml.phase40c1.experiment import _events, _training
from ml.phase40c1.models import SEED, THREADS
from ml.phase40c2.evaluation import PAIRS, VARIANTS, importance_and_redundancy, scores, uncertainty
from ml.phase40c2.models import fit_lightgbm, fit_xgb, predict_lightgbm, predict_xgb
from ml.phase40c2.sources import prepare_sources
from ml.phase40c2.trend_features import BASE_FEATURES, EXTENDED_FEATURES, TREND_FEATURES

SCENARIOS = ('ideal', 'delayed')
FIELDS = ('scenario', 'fold', 'session_date_ny', 'bar_start_utc', 'bar_end_utc',
          'inference_at_utc', 'original_feature_sha256', 'extended_feature_sha256',
          'label', 'label_available_at_utc', 'exclusion',
          'prob_xgb_base', 'prob_lgb_base', 'prob_xgb_trend', 'prob_lgb_trend')


def _serialized_models(directory, scenario, number, xgb_model, lgb_model, events, px, pl):
    files = {}
    for name, model, extension, before in (
            ('xgb_trend', xgb_model, 'json', px),
            ('lgb_trend', lgb_model, 'txt', pl)):
        filename = f'model-{name}-{scenario}-fold-{number}.{extension}'
        path = directory / filename
        if name == 'xgb_trend':
            model.save_model(path)
            restored = xgb.XGBClassifier()
            restored.load_model(path)
            after = predict_xgb(restored, events)
        else:
            model.save_model(str(path))
            restored = lgb.Booster(model_file=str(path))
            after = predict_lightgbm(restored, events)
        if not np.allclose(before, after, atol=1e-12, rtol=0):
            raise ValueError('Modelo serializado no reproduce probabilidades.')
        files[name] = {'file': filename, 'sha256': sha(path)}
    return files


def fit_folds(sources, directory):
    dataset, extended, baseline = sources['dataset'], sources['extended'], sources['baseline']
    records, models, scenarios = [], [], {}
    for scenario in SCENARIOS:
        folds = []
        for plan in dataset['plans'][scenario]:
            train = _training(plan['train'], scenario, extended)
            core = _training(plan['core'], scenario, extended)
            early = _training(plan['early'], scenario, extended)
            cutoff = plan['cutoff_utc']
            if (not train or not core or not early or
                    max(row['label_available_at_utc'] for row in train) >= cutoff or
                    max(row['label_available_at_utc'] for row in core) >= plan['early_cutoff_utc'] or
                    any(row['session_date_ny'] >= plan['first_test_session'] for row in train)):
                raise ValueError('Entrenamiento o early stopping contiene etiquetas futuras.')
            xgb_model, xgb_trees = fit_xgb(core, early, train)
            lgb_model, lgb_trees = fit_lightgbm(core, early, train)
            events = _events(plan, extended)
            px = predict_xgb(xgb_model, events)
            pl = predict_lightgbm(lgb_model, events)
            files = _serialized_models(directory, scenario, plan['fold'], xgb_model, lgb_model,
                                       events, px, pl)
            models.extend({'scenario': scenario, 'fold': plan['fold'], 'variant': name, **value}
                          for name, value in files.items())
            fold_rows = []
            for index, observation in enumerate(plan['test']):
                stamp = observation['bar_start_utc']
                original = plan['original_predictions'][index]
                old = baseline[(scenario, stamp)]
                row = {'scenario': scenario, 'fold': plan['fold'],
                       'session_date_ny': observation['session_date_ny'],
                       'bar_start_utc': stamp, 'bar_end_utc': observation['bar_end_utc'],
                       'inference_at_utc': observation['available_at_utc'],
                       'original_feature_sha256': observation['feature_sha256'],
                       'extended_feature_sha256': extended[(scenario, stamp)]['feature_sha256'],
                       'label': observation['label'],
                       'label_available_at_utc': observation['label_available_at_utc'],
                       'exclusion': observation['exclusion'],
                       'prob_xgb_base': probability_vector(original['prob_xgboost']),
                       'prob_lgb_base': probability_vector(old['prob_lightgbm']),
                       'prob_xgb_trend': px[index].tolist(),
                       'prob_lgb_trend': pl[index].tolist()}
                records.append(row)
                if row['label'] is not None:
                    fold_rows.append(row)
            if not fold_rows:
                raise ValueError('Fold sin desenlaces evaluables.')
            measured = scores(fold_rows)
            for name, source_metrics in (
                    ('xgb_base', plan['source_fold']['metrics']['xgboost']),
                    ('lgb_base', sources['baseline_report']['scenarios'][scenario]
                     ['folds'][plan['fold']-1]['metrics']['lightgbm'])):
                compare_original([row['label'] for row in fold_rows],
                                 [row[f'prob_{name}'] for row in fold_rows],
                                 source_metrics, model=name)
            folds.append({'fold': plan['fold'], 'cutoff_utc': cutoff,
                          'first_test_session': plan['first_test_session'],
                          'train_rows': len(train), 'core_rows': len(core),
                          'early_rows': len(early), 'early_cutoff_utc': plan['early_cutoff_utc'],
                          'max_train_label_available_at_utc': max(row['label_available_at_utc'] for row in train),
                          'max_core_label_available_at_utc': max(row['label_available_at_utc'] for row in core),
                          'selected_trees': {'xgb_trend': xgb_trees, 'lgb_trend': lgb_trees},
                          'model_files': files, 'test_rows': len(plan['test']),
                          'resolved_rows': len(fold_rows), 'metrics': measured,
                          'paired_uncertainty': {new: uncertainty(fold_rows, new, base, 'session')
                                                 for new, base in PAIRS},
                          'classification': {new: classify_comparison(measured[new], measured[base],
                                                                      len(fold_rows))
                                             for new, base in PAIRS},
                          'feature_diagnostics': importance_and_redundancy(xgb_model, lgb_model, train)})
        scenario_rows = [row for row in records if row['scenario'] == scenario]
        resolved = [row for row in scenario_rows if row['label'] is not None]
        measured = scores(resolved)
        compare_original([row['label'] for row in resolved],
                         [row['prob_xgb_base'] for row in resolved],
                         dataset['source_report']['scenarios'][scenario]['pooled']['metrics']['xgboost'])
        compare_original([row['label'] for row in resolved],
                         [row['prob_lgb_base'] for row in resolved],
                         sources['baseline_report']['scenarios'][scenario]['metrics']['lightgbm'],
                         model='lightgbm')
        scenarios[scenario] = {'observations': len(scenario_rows), 'resolved': len(resolved),
                               'sessions': len({row['session_date_ny'] for row in resolved}),
                               'exclusions': dict(Counter(row['exclusion'] or 'NONE' for row in scenario_rows)),
                               'folds': folds, 'metrics': measured,
                               'paired_uncertainty': {new: {group: uncertainty(resolved, new, base, group)
                                                            for group in ('session', 'week', 'month')}
                                                      for new, base in PAIRS},
                               'classification': {new: classify_comparison(measured[new], measured[base],
                                                                           len(resolved))
                                                  for new, base in PAIRS}}
    return records, models, scenarios


def markdown(report):
    fmt = lambda value: 'N/D' if value is None else f'{value:.4f}'
    lines = ['# Fase 40C2: estructura de tendencia NVDA IEX', '',
             'Investigación retrospectiva. Disponibilidad simulada; no son predicciones Live.',
             'Las nueve variables y la regla argmax fueron fijadas antes de evaluar los folds externos.', '']
    for scenario in ('delayed', 'ideal'):
        result = report['scenarios'][scenario]
        lines += [f'## {scenario}', '', f'Filas evaluables: {result["resolved"]}.', '',
                  '| Variante | Macro F1 | Recall BAJISTA | Precision BAJISTA | Log loss | PR-AUC BAJISTA |',
                  '|---|---:|---:|---:|---:|---:|']
        for name in VARIANTS:
            value = result['metrics'][name]
            lines.append(f'| {name} | {value["macro_f1"]:.4f} | '
                         f'{value["per_class"]["BAJISTA"]["recall"]:.4f} | '
                         f'{value["per_class"]["BAJISTA"]["precision"]:.4f} | '
                         f'{value["log_loss"]:.4f} | {fmt(value["bear_ovr"]["pr_auc"])} |')
        lines += ['', 'Diferencias ampliado menos base:', '']
        for new, base in PAIRS:
            a, b = result['metrics'][new], result['metrics'][base]
            lines.append(f'- {new} − {base}: Macro F1 {a["macro_f1"]-b["macro_f1"]:+.4f}; '
                         f'recall BAJISTA {a["per_class"]["BAJISTA"]["recall"]-b["per_class"]["BAJISTA"]["recall"]:+.4f}; '
                         f'precision BAJISTA {a["per_class"]["BAJISTA"]["precision"]-b["per_class"]["BAJISTA"]["precision"]:+.4f}; '
                         f'log loss {a["log_loss"]-b["log_loss"]:+.4f}; '
                         f'estado `{result["classification"][new]}`.')
        lines += ['', 'Métricas por fold, matrices, bootstrap agrupado, importancia y correlación: `report.json`.', '']
    lines += ['## Límites', '',
              'Este mismo histórico ya fue examinado; no constituye evaluación independiente.',
              'El bootstrap agrupado no captura necesariamente dependencias entre jornadas o regímenes extensos.',
              'Gain y correlación no demuestran causalidad ni justifican seleccionar subconjuntos con estos folds.',
              'No se modifica ningún modelo operativo. Sin señales CALL/PUT ni órdenes.', '']
    return '\n'.join(lines)


def run(history, run38e, baseline40b, output, *, prepared=None):
    history, run38e, baseline40b, output = map(lambda value: Path(value).resolve(),
                                               (history, run38e, baseline40b, output))
    repository = Path(__file__).resolve().parents[2]
    allowed = (repository / 'private', repository / 'trading_poc_001_bollinger' / 'output' / 'real')
    if output.is_relative_to(repository) and not any(output.is_relative_to(root) for root in allowed):
        raise ValueError('Los artefactos deben guardarse fuera de archivos versionados.')
    if output.exists() or any(output == source or source in output.parents or output in source.parents
                              for source in (history, run38e, baseline40b)):
        raise ValueError('La salida debe ser una carpeta nueva e independiente.')
    if sys.version_info[:2] != (3, 12) or xgb.__version__ != '2.1.4' or lgb.__version__ != '4.7.0':
        raise ValueError('Se requieren Python 3.12, XGBoost 2.1.4 y LightGBM 4.7.0.')
    sources = prepared if prepared is not None else prepare_sources(history, run38e, baseline40b)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='phase40c2-pending-', dir=output.parent) as temp:
        directory = Path(temp)
        records, models, scenarios = fit_folds(sources, directory)
        report = {'schema': 'phase40c2-report-v1', 'mode': 'HISTORICAL_REPLAY',
                  'primary_scenario': 'delayed', 'classes': list(CLASSES),
                  'base_features': list(BASE_FEATURES), 'trend_features': list(TREND_FEATURES),
                  'extended_features': list(EXTENDED_FEATURES),
                  'variants': list(VARIANTS), 'scenarios': scenarios,
                  'warning': 'Histórico examinado previamente. Disponibilidad simulada, sin evidencia prospectiva independiente ni uso operativo.'}
        manifest = {'schema': 'phase40c2-manifest-v1',
                    'created_at_utc': datetime.now(timezone.utc).isoformat(),
                    'identity': 'NVDA-IEX-raw-15m-trend-structure',
                    'source_hashes': {'history38d': sources['history_hashes'],
                                      'run38e': sources['dataset']['source_hashes'],
                                      'baseline40b': sources['baseline_hashes']},
                    'code_snapshot_drift38e': sources['dataset']['code_snapshot_drift'],
                    'baseline40b_code_crlf_only': sources['baseline_code_line_ending_variation'],
                    'code_sha256': {f'ml/phase40c2/{name}': sha(Path(__file__).parent / name)
                                    for name in ('trend_features.py', 'sources.py', 'models.py',
                                                 'evaluation.py', 'experiment.py')},
                    'runtime': {'python': platform.python_version(), 'platform': platform.platform(),
                                'numpy': np.__version__, 'xgboost': xgb.__version__,
                                'lightgbm': lgb.__version__, 'sklearn': sklearn.__version__,
                                'tzdata': version('tzdata')},
                    'features': list(EXTENDED_FEATURES), 'classes': list(CLASSES),
                    'definitions': {
                        'ema9_slope_1': 'EMA9[t]/EMA9[t-1]-1; seed SMA9, alpha 2/10',
                        'ema20_slope_1': 'EMA20[t]/EMA20[t-1]-1; seed SMA20, alpha 2/21',
                        'sma20_slope_1': 'SMA20[t]/SMA20[t-1]-1',
                        'distance_prior_20_high': 'close[t]/max(high[t-20:t])-1',
                        'distance_prior_20_low': 'close[t]/min(low[t-20:t])-1',
                        'consecutive_lower_highs_4': 'strict high[i]<high[i-1], max 4',
                        'consecutive_lower_lows_4': 'strict low[i]<low[i-1], max 4',
                        'consecutive_higher_highs_4': 'strict high[i]>high[i-1], max 4',
                        'consecutive_higher_lows_4': 'strict low[i]>low[i-1], max 4'},
                    'continuity': 'Phase 23: 15m within session; overnight only adjacent official sessions with complete old last/new first bar',
                    'coverage_audit': '40/100 continuous bars and complete prior session; never model features',
                    'label_and_horizon': 'Unchanged Phase 38E; outcome unavailable to predictor',
                    'models': models, 'seed': SEED, 'cpu_threads': THREADS,
                    'xgb_parameters': {'variant': 'standard', **XGB_PARAMS['standard'],
                                       'n_estimators_max': MAX_ITERATIONS,
                                       'early_stopping_rounds': 30,
                                       'subsample': .8, 'colsample_bytree': .9},
                    'lgb_parameters': LIGHTGBM_PARAMS,
                    'fold_policy': {'minimum_train_sessions': 252, 'test_sessions': 126,
                                    'early_stopping': 'chronological inner block, 30 rounds; refit all causal training rows'},
                    'folds': {scenario: [{key: fold[key] for key in (
                        'fold', 'cutoff_utc', 'first_test_session', 'train_rows', 'core_rows',
                        'early_rows', 'early_cutoff_utc', 'max_train_label_available_at_utc',
                        'max_core_label_available_at_utc', 'selected_trees', 'test_rows',
                        'resolved_rows', 'model_files')}
                        for fold in scenarios[scenario]['folds']] for scenario in SCENARIOS},
                    'records': len(records), 'resolved': sum(row['label'] is not None for row in records),
                    'evaluation': 'argmax fixed; same 38E test rows; paired 400 resamples by fold/session/week/month',
                    'historical_reception': None}
        with (directory / 'predictions.csv').open('x', newline='', encoding='utf8') as handle:
            writer = csv.DictWriter(handle, fieldnames=FIELDS)
            writer.writeheader()
            for row in records:
                writer.writerow({name: json.dumps(row[name], separators=(',', ':'))
                                 if isinstance(row[name], list) else row[name] for name in FIELDS})
        for name, content in (('report.json', report), ('manifest.json', manifest),
                              ('feature-audit.json', sources['feature_audit'])):
            (directory / name).write_text(json.dumps(content, indent=2, ensure_ascii=False,
                                                     allow_nan=False, default=json_numpy_scalar) + '\n',
                                          encoding='utf8')
        (directory / 'report.md').write_text(markdown(report), encoding='utf8')
        names = ['manifest.json', 'report.json', 'report.md', 'predictions.csv',
                 'feature-audit.json', *(item['file'] for item in models)]
        (directory / 'SHA256SUMS').write_text(
            ''.join(f'{sha(directory / name)}  {name}\n' for name in names), encoding='utf8')
        if output.exists():
            raise ValueError('Otra ejecución creó la carpeta de salida.')
        directory.rename(output)
    return report


def main():
    parser = argparse.ArgumentParser(description='Fase 40C2: estructura de tendencia IEX, solo investigación histórica')
    parser.add_argument('--history', required=True)
    parser.add_argument('--run', required=True)
    parser.add_argument('--baseline40b', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    report = run(args.history, args.run, args.baseline40b, args.out)
    print(json.dumps({'status': 'OK', 'scenarios': {name: {
        'resolved': item['resolved'], 'classification': item['classification']}
        for name, item in report['scenarios'].items()}}, ensure_ascii=False))


if __name__ == '__main__':
    main()
