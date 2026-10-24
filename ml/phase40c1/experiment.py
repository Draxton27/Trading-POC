"""Private historical BASE_10 versus BASE_10_PLUS_TEMPORAL_7 experiment."""
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

from ml.phase28.train import CLASSES, VARIANTS
from ml.phase38c.replay import inference_events
from ml.phase40a.bear_audit import json_numpy_scalar, probability_vector, sha
from ml.phase40b.evaluation import classify_comparison, compare_original, paired_bootstrap, score
from ml.phase40b.lightgbm_model import LIGHTGBM_PARAMS, MAX_ITERATIONS
from ml.phase40c1.models import (SEED, THREADS, fit_lightgbm, fit_xgb,
                                 predict_lightgbm, predict_xgb)
from ml.phase40c1.sources import prepare_sources
from ml.phase40c1.temporal_features import (BASE_FEATURES, EXTENDED_FEATURES,
                                            TEMPORAL_FEATURES)

SCENARIOS = ('ideal', 'delayed')
VARIANTS_NAMES = ('xgb_base', 'lgb_base', 'xgb_temporal', 'lgb_temporal')
FIELDS = ('scenario', 'fold', 'session_date_ny', 'bar_start_utc', 'bar_end_utc',
          'inference_at_utc', 'original_feature_sha256', 'extended_feature_sha256',
          'label', 'label_available_at_utc', 'exclusion',
          'prob_xgb_base', 'prob_lgb_base', 'prob_xgb_temporal', 'prob_lgb_temporal')


def _training(rows, scenario, extended):
    result = []
    for row in rows:
        key = (scenario, row['bar_start_utc'])
        item = extended.get(key)
        if item is None:
            raise ValueError('Entrenamiento temporal perdió una fila original.')
        if any(float(row[name]) != float(item['features'][name]) for name in BASE_FEATURES):
            raise ValueError('Las diez variables originales cambiaron.')
        result.append({'features': item['features'], 'label': row['label'],
                       'session_date_ny': row['session_date_ny'],
                       'bar_start_utc': row['bar_start_utc'],
                       'observed_at_utc': row['observed_at_utc'],
                       'label_available_at_utc': row['label_available_at_utc']})
    return result


def _events(plan, extended):
    # inference_events intentionally omits labels, target prices and exclusions.
    visible = inference_events(plan['test'])
    return [{'features': extended[(plan['scenario'], event['bar_start_utc'])]['features'],
             'bar_start_utc': event['bar_start_utc']}
            for event in visible]


def _uncertainty(rows, left, right, name, grouping):
    result = paired_bootstrap(rows, [r['label'] for r in rows],
                              [r[f'prob_{left}'] for r in rows],
                              [r[f'prob_{right}'] for r in rows], grouping=grouping)
    result['difference'] = name
    return result


def _metrics(rows):
    labels = [row['label'] for row in rows]
    return {name: score(labels, [row[f'prob_{name}'] for row in rows],
                        'xgboost' if name.startswith('xgb') else 'lightgbm')
            for name in VARIANTS_NAMES}


def _importance(xgb_model, lgb_model):
    xgb_gain = xgb_model.get_booster().get_score(importance_type='gain')
    lgb_gain = lgb_model.feature_importance(importance_type='gain')
    return {'xgb_gain': {name: float(xgb_gain.get(f'f{index}', 0))
                         for index, name in enumerate(EXTENDED_FEATURES)},
            'lgb_gain': {name: float(lgb_gain[index])
                         for index, name in enumerate(EXTENDED_FEATURES)}}


def _fit_folds(sources, directory):
    dataset, extended, baseline = sources['dataset'], sources['extended'], sources['baseline']
    records, models, report_scenarios = [], [], {}
    for scenario in SCENARIOS:
        folds = []
        for plan in dataset['plans'][scenario]:
            cutoff = plan['cutoff_utc']
            train = _training(plan['train'], scenario, extended)
            core = _training(plan['core'], scenario, extended)
            early = _training(plan['early'], scenario, extended)
            if (not train or not core or not early or
                    max(r['label_available_at_utc'] for r in train) >= cutoff or
                    max(r['label_available_at_utc'] for r in core) >= plan['early_cutoff_utc'] or
                    any(r['session_date_ny'] >= plan['first_test_session'] for r in train)):
                raise ValueError('Entrenamiento o early stopping contiene etiquetas futuras.')
            xgb_model, xgb_trees = fit_xgb(core, early, train)
            lgb_model, lgb_trees = fit_lightgbm(core, early, train)
            events = _events(plan, extended)
            px = predict_xgb(xgb_model, events)
            pl = predict_lightgbm(lgb_model, events)
            files = {}
            for name, model, extension in (('xgb_temporal', xgb_model, 'json'),
                                           ('lgb_temporal', lgb_model, 'txt')):
                filename = f'model-{name}-{scenario}-fold-{plan["fold"]}.{extension}'
                path = directory / filename
                if name == 'xgb_temporal':
                    model.save_model(path)
                    restored = xgb.XGBClassifier()
                    restored.load_model(path)
                    after = predict_xgb(restored, events)
                else:
                    model.save_model(str(path))
                    restored = lgb.Booster(model_file=str(path))
                    after = predict_lightgbm(restored, events)
                original = px if name == 'xgb_temporal' else pl
                if not np.allclose(original, after, atol=1e-12, rtol=0):
                    raise ValueError('Modelo serializado no reproduce sus predicciones.')
                files[name] = {'file': filename, 'sha256': sha(path)}
                models.append({'scenario': scenario, 'fold': plan['fold'], 'variant': name,
                               **files[name]})
            fold_rows = []
            for index, observation in enumerate(plan['test']):
                key = (scenario, observation['bar_start_utc'])
                old = baseline[key]
                item = extended[key]
                row = {'scenario': scenario, 'fold': plan['fold'],
                       'session_date_ny': observation['session_date_ny'],
                       'bar_start_utc': observation['bar_start_utc'],
                       'bar_end_utc': observation['bar_end_utc'],
                       'inference_at_utc': observation['available_at_utc'],
                       'original_feature_sha256': observation['feature_sha256'],
                       'extended_feature_sha256': item['feature_sha256'],
                       'label': observation['label'],
                       'label_available_at_utc': observation['label_available_at_utc'],
                       'exclusion': observation['exclusion'],
                       'prob_xgb_base': probability_vector(plan['original_predictions'][index]['prob_xgboost']),
                       'prob_lgb_base': probability_vector(old['prob_lightgbm']),
                       'prob_xgb_temporal': px[index].tolist(),
                       'prob_lgb_temporal': pl[index].tolist()}
                records.append(row)
                if row['label'] is not None:
                    fold_rows.append(row)
            if not fold_rows:
                raise ValueError('Fold sin desenlaces evaluables.')
            measured = _metrics(fold_rows)
            for name, source_metrics in (
                    ('xgb_base', plan['source_fold']['metrics']['xgboost']),
                    ('lgb_base', sources['baseline_report']['scenarios'][scenario]['folds'][plan['fold']-1]['metrics']['lightgbm'])):
                compare_original([r['label'] for r in fold_rows],
                                 [r[f'prob_{name}'] for r in fold_rows], source_metrics, model=name)
            uncertainty = {
                name: _uncertainty(fold_rows, name, base, f'{name}_minus_{base}', 'session')
                for name, base in (('xgb_temporal', 'xgb_base'), ('lgb_temporal', 'lgb_base'))}
            folds.append({'fold': plan['fold'], 'cutoff_utc': cutoff,
                          'first_test_session': plan['first_test_session'],
                          'train_rows': len(train), 'core_rows': len(core),
                          'early_rows': len(early), 'early_cutoff_utc': plan['early_cutoff_utc'],
                          'max_train_label_available_at_utc': max(r['label_available_at_utc'] for r in train),
                          'max_core_label_available_at_utc': max(r['label_available_at_utc'] for r in core),
                          'selected_trees': {'xgb_temporal': xgb_trees, 'lgb_temporal': lgb_trees},
                          'model_files': files, 'test_rows': len(plan['test']),
                          'resolved_rows': len(fold_rows), 'metrics': measured,
                          'paired_uncertainty': uncertainty,
                          'classification': {
                              name: classify_comparison(measured[name], measured[base], len(fold_rows))
                              for name, base in (('xgb_temporal', 'xgb_base'),
                                                 ('lgb_temporal', 'lgb_base'))},
                          'feature_importance': _importance(xgb_model, lgb_model)})
        scenario_rows = [r for r in records if r['scenario'] == scenario]
        resolved = [r for r in scenario_rows if r['label'] is not None]
        measured = _metrics(resolved)
        compare_original([r['label'] for r in resolved],
                         [r['prob_xgb_base'] for r in resolved],
                         dataset['source_report']['scenarios'][scenario]['pooled']['metrics']['xgboost'])
        compare_original([r['label'] for r in resolved],
                         [r['prob_lgb_base'] for r in resolved],
                         sources['baseline_report']['scenarios'][scenario]['metrics']['lightgbm'],
                         model='lightgbm')
        uncertainty = {name: {group: _uncertainty(
            resolved, name, base, f'{name}_minus_{base}', group)
            for group in ('session', 'week', 'month')}
            for name, base in (('xgb_temporal', 'xgb_base'),
                               ('lgb_temporal', 'lgb_base'))}
        report_scenarios[scenario] = {
            'observations': len(scenario_rows), 'resolved': len(resolved),
            'sessions': len({r['session_date_ny'] for r in resolved}),
            'exclusions': dict(Counter(r['exclusion'] or 'NONE' for r in scenario_rows)),
            'folds': folds, 'metrics': measured, 'paired_uncertainty': uncertainty,
            'classification': {name: classify_comparison(measured[name], measured[base], len(resolved))
                               for name, base in (('xgb_temporal', 'xgb_base'),
                                                  ('lgb_temporal', 'lgb_base'))}}
    return records, models, report_scenarios


def markdown(report):
    def fmt(value):
        return 'N/D' if value is None else f'{value:.4f}'
    lines = ['# Fase 40C1: memoria temporal IEX', '',
             'Investigación retrospectiva sobre NVDA IEX raw 15m. Disponibilidad simulada; sin recepción histórica verificada.', '',
             'Las siete variables, modelos y política argmax se fijaron antes de evaluar los folds externos.', '']
    for scenario in ('delayed', 'ideal'):
        result = report['scenarios'][scenario]
        lines += [f'## {scenario}', '', f'Filas evaluables: {result["resolved"]}.', '',
                  '| Variante | Macro F1 | Recall BAJISTA | Precision BAJISTA | Log loss | PR-AUC BAJISTA |',
                  '|---|---:|---:|---:|---:|---:|']
        for name in VARIANTS_NAMES:
            value = result['metrics'][name]
            lines.append(f'| {name} | {value["macro_f1"]:.4f} | '
                         f'{value["per_class"]["BAJISTA"]["recall"]:.4f} | '
                         f'{value["per_class"]["BAJISTA"]["precision"]:.4f} | '
                         f'{value["log_loss"]:.4f} | '
                         f'{fmt(value["bear_ovr"]["pr_auc"])} |')
        lines += ['', 'Comparaciones de características dentro de cada algoritmo:', '']
        for name, base in (('xgb_temporal', 'xgb_base'), ('lgb_temporal', 'lgb_base')):
            a, b = result['metrics'][name], result['metrics'][base]
            lines.append(f'- {name} − {base}: Macro F1 {a["macro_f1"]-b["macro_f1"]:+.4f}; '
                         f'recall BAJISTA {a["per_class"]["BAJISTA"]["recall"]-b["per_class"]["BAJISTA"]["recall"]:+.4f}; '
                         f'precision BAJISTA {a["per_class"]["BAJISTA"]["precision"]-b["per_class"]["BAJISTA"]["precision"]:+.4f}; '
                         f'log loss {a["log_loss"]-b["log_loss"]:+.4f}; '
                         f'estado `{result["classification"][name]}`.')
        lines += ['', 'Intervalos pareados por sesión, semana y mes, matrices, falsos positivos, falsos negativos '
                  'e importancia descriptiva por fold: `report.json`.', '']
    lines += ['## Límites', '',
              'Las observaciones originales no son una evaluación independiente; los resultados ya fueron vistos en fases anteriores.',
              'El bootstrap agrupado no prueba independencia entre jornadas ni captura necesariamente regímenes prolongados.',
              'La importancia de variables no demuestra efecto incremental causal ni justifica una selección posterior sobre estos folds.',
              'Ningún modelo o umbral de producción se modifica. Sin señales CALL/PUT ni órdenes.', '']
    return '\n'.join(lines)


def run(history, run38e, baseline40b, output, *, prepared=None):
    history, run38e, baseline40b, output = map(lambda path: Path(path).resolve(),
                                               (history, run38e, baseline40b, output))
    repository = Path(__file__).resolve().parents[2]
    allowed_private = (repository / 'private', repository / 'trading_poc_001_bollinger' / 'output' / 'real')
    if output.is_relative_to(repository) and not any(output.is_relative_to(root) for root in allowed_private):
        raise ValueError('Los artefactos deben guardarse fuera de archivos versionados.')
    if (output.exists() or any(output == source or source in output.parents or output in source.parents
                               for source in (history, run38e, baseline40b))):
        raise ValueError('La salida debe ser una carpeta nueva e independiente.')
    if sys.version_info[:2] != (3, 12) or xgb.__version__ != '2.1.4' or lgb.__version__ != '4.7.0':
        raise ValueError('Se requieren Python 3.12, XGBoost 2.1.4 y LightGBM 4.7.0.')
    sources = prepared if prepared is not None else prepare_sources(history, run38e, baseline40b)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='phase40c1-pending-', dir=output.parent) as temp:
        directory = Path(temp)
        records, models, scenarios = _fit_folds(sources, directory)
        report = {'schema': 'phase40c1-report-v1', 'mode': 'HISTORICAL_REPLAY',
                  'primary_scenario': 'delayed', 'classes': list(CLASSES),
                  'base_features': list(BASE_FEATURES), 'temporal_features': list(TEMPORAL_FEATURES),
                  'extended_features': list(EXTENDED_FEATURES),
                  'variants': list(VARIANTS_NAMES), 'scenarios': scenarios,
                  'warning': 'Histórico examinado previamente. Disponibilidad simulada, sin evidencia prospectiva independiente ni uso operativo.'}
        manifest = {'schema': 'phase40c1-manifest-v1', 'created_at_utc': datetime.now(timezone.utc).isoformat(),
                    'identity': 'NVDA-IEX-raw-15m-temporal-memory',
                    'source_hashes': {'history38d': sources['history_hashes'],
                                      'run38e': sources['dataset']['source_hashes'],
                                      'baseline40b': sources['baseline_hashes']},
                    'code_snapshot_drift38e': sources['dataset']['code_snapshot_drift'],
                    'baseline40b_code_crlf_only': sources['baseline_code_line_ending_variation'],
                    'code_sha256': {f'ml/phase40c1/{name}': sha(Path(__file__).parent / name)
                                    for name in ('temporal_features.py', 'sources.py', 'models.py', 'experiment.py')},
                    'runtime': {'python': platform.python_version(), 'platform': platform.platform(),
                                'numpy': np.__version__, 'xgboost': xgb.__version__,
                                'lightgbm': lgb.__version__, 'sklearn': sklearn.__version__,
                                'tzdata': version('tzdata')},
                    'features': list(EXTENDED_FEATURES), 'classes': list(CLASSES),
                    'definitions': {'return_2': 'close[t]/close[t-2]-1',
                                    'return_8': 'close[t]/close[t-8]-1',
                                    'lagged_return_1': 'close[t-1]/close[t-2]-1',
                                    'lagged_return_2': 'close[t-2]/close[t-3]-1',
                                    'lagged_return_3': 'close[t-3]/close[t-4]-1',
                                    'consecutive_down_bars': 'negative close returns ending at t, cap 8; zero interrupts',
                                    'consecutive_up_bars': 'positive close returns ending at t, cap 8; zero interrupts'},
                    'continuity': 'Phase 23: 15m intraday; only adjacent official sessions with complete old last/new first bar',
                    'label_and_horizon': 'Unchanged Phase 38E; outcome unavailable to predictor',
                    'models': models, 'seed': SEED, 'cpu_threads': THREADS,
                    'xgb_parameters': {'variant': 'standard', **VARIANTS['standard'],
                                       'n_estimators_max': MAX_ITERATIONS, 'early_stopping_rounds': 30,
                                       'subsample': .8, 'colsample_bytree': .9},
                    'lgb_parameters': LIGHTGBM_PARAMS,
                    'fold_policy': {'minimum_train_sessions': 252, 'test_sessions': 126,
                                    'early_stopping': 'chronological inner block, 30 rounds; refit all causal training rows'},
                    'folds': {scenario: [{key: item[key] for key in (
                        'fold', 'cutoff_utc', 'first_test_session', 'train_rows', 'core_rows',
                        'early_rows', 'early_cutoff_utc', 'max_train_label_available_at_utc',
                        'max_core_label_available_at_utc', 'selected_trees', 'test_rows',
                        'resolved_rows', 'model_files')}
                        for item in scenarios[scenario]['folds']] for scenario in SCENARIOS},
                    'records': len(records), 'resolved': sum(r['label'] is not None for r in records),
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
    parser = argparse.ArgumentParser(description='Fase 40C1: memoria temporal IEX, solo investigación histórica')
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
