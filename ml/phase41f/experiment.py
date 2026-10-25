"""Frozen Phase 41F historical experiment. Never writes into operational ledgers."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import platform
import tempfile
from collections import Counter, defaultdict
from pathlib import Path

import joblib
import lightgbm
import numpy as np
import sklearn
import xgboost

from ml.phase40a.bear_audit import sha
from ml.phase40b.dataset import original_probabilities
from ml.phase41d.registry import DEFINITIONS, digest
from ml.phase41e.feature_schema import feature_schema
from ml.phase41f.evaluation import metric_values, score
from ml.phase41f.folds import eligible_rows, inner_blocks
from ml.phase41f.models import MODELS, SEED, THREADS, TREES, frequency, logistic, xgboost as fit_xgb, lightgbm as fit_lgb
from ml.phase41f.preprocessing import fit_transformer, transform, metadata
from ml.phase41f.sources import load_verified_inputs
from ml.phase41f.training_features import external_rows, reconstruct_rows
from ml.phase41f.uncertainty import paired

ROOT = Path(__file__).resolve().parents[2]
FEATURE_PAIRS = (('F1', 'F0'), ('F2', 'F0'), ('F2', 'F1'))
SCENARIOS = ('delayed', 'ideal')
TARGETS = {item.target_id: item.classes for item in DEFINITIONS}


def frozen_config():
    return {
        'schema': 'phase41f-experiment-config-v1', 'status': 'HISTORICAL_EXPLORED',
        'targets': list(TARGETS), 'feature_sets': feature_schema()['columns'],
        'models': list(MODELS), 'scenarios': list(SCENARIOS), 'primary_sip_delay_minutes': 20,
        'fold_source': 'phase38e-original-252-minimum-126-test-observed-sessions',
        'training': 'label_known_before_external_cutoff; earlier complete sessions only',
        'inner_validation': 'last 20 percent observed train sessions; purge earlier labels',
        'primary_population': 'target_available_and_F2_complete_for_train_and_test',
        'secondary_population': 'target_available_and_F1_complete_for_F0_F1',
        'threshold': {'binary_positive_probability': .5, 'multiclass': 'argmax'},
        'preprocessing': {'linear': 'train-only StandardScaler numeric + OneHotEncoder categorical',
                          'trees': 'raw numeric + train-only OneHotEncoder categorical',
                          'unseen_category': 'one-hot all zeros; no external fit',
                          'missing': 'exclude incomplete rows; no imputation'},
        'logistic': {'C': 1.0, 'max_iter': 600},
        'xgboost': {'max_trees': TREES, 'max_depth': 3, 'learning_rate': .05,
                    'subsample': .8, 'colsample_bytree': .9, 'reg_lambda': 1.0,
                    'early_stopping_rounds': 30},
        'lightgbm': {'max_trees': TREES, 'learning_rate': .05, 'num_leaves': 7,
                     'max_depth': 3, 'min_data_in_leaf': 30, 'lambda_l2': 1.0,
                     'early_stopping_rounds': 30},
        'seed': SEED, 'max_threads_per_model': THREADS,
        'uncertainty': {'bootstrap_iterations': 120, 'seed': SEED,
                        'paired_groupings': ['session', 'week', 'month'],
                        'stratify_by_original_fold': True},
        'comparison_pairs': [list(pair) for pair in FEATURE_PAIRS],
        'exclusions': ['missing_target', 'incomplete_feature_set',
                       'label_not_known_at_cutoff', 'missing_class_in_causal_train'],
        'promotion_to_production': False, 'orders_or_options_signals': False,
    }


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n',
                    encoding='utf8', newline='\n')


def _labels(rows, classes):
    return np.asarray([classes.index(row['label']) for row in rows], dtype=int)


def _model_file(out, prefix, name, model):
    path = out / f'{prefix}-{name}'
    if name == 'xgboost':
        path = path.with_suffix('.json')
        model.save_model(path)
    elif name == 'lightgbm':
        path = path.with_suffix('.txt')
        model.save_model(str(path))
    else:
        path = path.with_suffix('.joblib')
        joblib.dump(model, path)
    return {'file': path.name, 'sha256': sha(path)}


def fit_fold(train, test, target, set_name, out, prefix):
    classes = TARGETS[target]
    y = _labels(train, classes)
    if set(y) != set(range(len(classes))):
        raise ValueError(f'Clases insuficientes: {prefix}.')
    core, early = inner_blocks(train)
    yc, ye = _labels(core, classes), _labels(early, classes)
    if set(yc) != set(range(len(classes))):
        raise ValueError(f'Clases ausentes en bloque interno: {prefix}.')
    probabilities = {'frequency': frequency(y, len(classes), len(test))}
    saved = {}
    selections = {}
    for linear in (True, False):
        kind = 'linear' if linear else 'trees'
        transformer, x = fit_transformer(train, set_name, linear=linear)
        xt = transform(transformer, test, set_name)
        path = out / f'{prefix}-transform-{kind}.joblib'
        joblib.dump(transformer, path)
        saved[f'transform_{kind}'] = {'file': path.name, 'sha256': sha(path)}
        saved[f'transform_{kind}_metadata'] = metadata(transformer, set_name,
                                                         linear=linear, train_rows=train)
        if linear:
            model, p, info = logistic(x, y, xt, len(classes))
            probabilities['linear'] = p
            saved['linear'] = _model_file(out, prefix, 'linear', model)
            selections['linear'] = info
        else:
            inner_transformer, xc = fit_transformer(core, set_name, linear=False)
            xe = transform(inner_transformer, early, set_name)
            if set(ye) != set(range(len(classes))):
                raise ValueError(f'Clases ausentes en validacion interna: {prefix}.')
            for name, fitter in (('xgboost', fit_xgb), ('lightgbm', fit_lgb)):
                model, p, info = fitter(xc, yc, xe, ye, x, y, xt, len(classes))
                probabilities[name] = p
                saved[name] = _model_file(out, prefix, name, model)
                selections[name] = info
    result = {'train_rows': len(train), 'core_rows': len(core), 'early_rows': len(early),
              'train_sessions': len({r['session_date_ny'] for r in train}),
              'max_train_target_known_at_utc': max(r['target_known_at_utc'] for r in train),
              'max_core_target_known_at_utc': max(r['target_known_at_utc'] for r in core),
              'first_early_decision_at_utc': min(r['decision_at_utc'] for r in early),
              'class_counts_train': dict(Counter(r['label'] for r in train)),
              'selected_iterations': selections, 'artifacts': saved}
    return probabilities, result


def _collect_scores(records):
    grouped = defaultdict(list)
    for row in records:
        grouped[(row['scenario'], row['population'], row['target'],
                 row['fold'], row['model'], row['feature_set'])].append(row)
    result = []
    for key, rows in sorted(grouped.items()):
        scenario, population, target, fold, model, feature_set = key
        classes = TARGETS[target]
        result.append({'scenario': scenario, 'population': population,
                       'target': target, 'fold': fold, 'model': model,
                       'feature_set': feature_set, 'metrics': score(
                           _labels(rows, classes), [r['probabilities'] for r in rows], classes)})
    return result


def comparisons(records):
    by = defaultdict(dict)
    for row in records:
        if row['population'] != 'common':
            continue
        key = (row['scenario'], row['target'], row['model'], row['fold'], row['bar_start_utc'])
        if row['feature_set'] in by[key]:
            raise ValueError('Prediccion duplicada en comparacion.')
        by[key][row['feature_set']] = row
    result = []
    for scenario in SCENARIOS:
        for target, classes in TARGETS.items():
            for model in MODELS:
                group = {key: value for key, value in by.items() if key[:3] == (scenario, target, model)}
                if not group or any(set(value) != {'F0', 'F1', 'F2'} for value in group.values()):
                    raise ValueError('Comparacion F0/F1/F2 con poblaciones diferentes.')
                for left, right in FEATURE_PAIRS:
                    rows = [value[left] for _, value in sorted(group.items())]
                    other = [value[right] for _, value in sorted(group.items())]
                    if any(a['label'] != b['label'] or a['session_date_ny'] != b['session_date_ny']
                           for a, b in zip(rows, other)):
                        raise ValueError('Etiquetas o sesiones pareadas diferentes.')
                    labels = _labels(rows, classes)
                    lp, rp = [r['probabilities'] for r in rows], [r['probabilities'] for r in other]
                    a, b = metric_values(score(labels, lp, classes), classes), metric_values(score(labels, rp, classes), classes)
                    result.append({'scenario': scenario, 'target': target, 'model': model,
                                   'comparison': f'{left}_minus_{right}', 'rows': len(rows),
                                   'difference': {name: a[name] - b[name] if a[name] is not None
                                                  and b[name] is not None else None for name in a},
                                   'uncertainty': {grouping: paired(rows, labels, lp, rp, classes,
                                                           grouping=grouping) for grouping in
                                                   ('session', 'week', 'month')}})
    return result


def run(history, original_run, targets, features, sip_csv, out):
    out = Path(out)
    if out.exists():
        raise FileExistsError('Directorio 41F ya existe; no se sobrescriben experimentos.')
    config = frozen_config()
    out.mkdir(parents=True)
    write_json(out / 'experiment-config.json', config)
    source, plan, manifest41e, feature_hashes = load_verified_inputs(history, original_run, targets, features)
    source['phase41e_manifest'] = manifest41e
    if any(sha(Path(str(sip_csv) + extension)) != manifest41e['source_sha256']['sip'][extension or 'csv']
           for extension in ('', '.meta.json', '.calendar.json', '.provenance.json')):
        raise ValueError('SIP original 41E ausente o alterado.')
    external = external_rows(Path(features), source)
    with tempfile.TemporaryDirectory(prefix='phase41f-', dir=out) as temporary:
        rebuilt, parity = reconstruct_rows(source, external, Path(sip_csv), Path(temporary))
    write_json(out / 'feature-parity.json', parity)
    write_json(out / 'training-features.json', {'schema': 'phase41f-all-observations-v1',
               'rows': [rebuilt[(o['scenario'], o['bar_start_utc'])] for o in source['observations']]})
    del external
    records, fold_reports, coverage = [], [], []
    original = {(p['scenario'], p['bar_start_utc']): p for _, p in source['pairs']}
    for scenario in SCENARIOS:
        for fold in plan['plans'][scenario]:
            for target in TARGETS:
                for population, sets, required in (
                    ('common', ('F0', 'F1', 'F2'), 'F2'),
                    ('wide_F0_F1', ('F0', 'F1'), 'F1')):
                    train, test = eligible_rows(fold, rebuilt, target, required)
                    if population == 'wide_F0_F1' and len(test) == len(
                            eligible_rows(fold, rebuilt, target, 'F2')[1]):
                        continue
                    coverage.append({'scenario': scenario, 'fold': fold['fold'],
                                     'target': target, 'population': population,
                                     'train_rows': len(train), 'test_rows': len(test),
                                     'test_positive_or_bear': sum(r['label'] == TARGETS[target][0]
                                                                  if len(TARGETS[target]) == 2 else
                                                                  r['label'] == 'BAJISTA' for r in test)})
                    for set_name in sets:
                        prefix = f'{scenario}-fold{fold["fold"]}-{target}-{population}-{set_name}'
                        probabilities, detail = fit_fold(train, test, target, set_name, out, prefix)
                        fold_reports.append({'scenario': scenario, 'fold': fold['fold'],
                                             'target': target, 'population': population,
                                             'feature_set': set_name, 'cutoff_utc': fold['cutoff_utc'],
                                             'test_rows': len(test), **detail})
                        for model, values in probabilities.items():
                            for row, p in zip(test, values):
                                records.append({'scenario': scenario, 'population': population,
                                                'target': target, 'fold': fold['fold'],
                                                'feature_set': set_name, 'model': model,
                                                'session_date_ny': row['session_date_ny'],
                                                'bar_start_utc': row['bar_start_utc'],
                                                'decision_at_utc': row['decision_at_utc'],
                                                'target_known_at_utc': row['target_known_at_utc'],
                                                'label': row['label'], 'probabilities': p.tolist(),
                                                'mode': 'HISTORICAL_EXPLORED'})
                if target == 'NET_MOVE_4B_ATR05_V1':
                    _, test = eligible_rows(fold, rebuilt, target, 'F2')
                    for row in test:
                        p = original_probabilities(original[(scenario, row['bar_start_utc'])], 'xgboost')
                        records.append({'scenario': scenario, 'population': 'frozen_38e_common',
                                        'target': target, 'fold': fold['fold'], 'feature_set': 'F0',
                                        'model': 'xgboost_38e_frozen',
                                        'session_date_ny': row['session_date_ny'],
                                        'bar_start_utc': row['bar_start_utc'],
                                        'decision_at_utc': row['decision_at_utc'],
                                        'target_known_at_utc': row['target_known_at_utc'],
                                        'label': row['label'], 'probabilities': list(p),
                                        'mode': 'HISTORICAL_EXPLORED'})
    by_fold = _collect_scores(records)
    pooled = []
    groups = defaultdict(list)
    for row in records:
        groups[(row['scenario'], row['population'], row['target'], row['model'],
                row['feature_set'])].append(row)
    for key, rows in sorted(groups.items()):
        scenario, population, target, model, feature_set = key
        pooled.append({'scenario': scenario, 'population': population, 'target': target,
                       'model': model, 'feature_set': feature_set,
                       'metrics': score(_labels(rows, TARGETS[target]),
                                        [r['probabilities'] for r in rows], TARGETS[target])})
    paired_result = comparisons(records)
    from ml.phase41f.coverage import audit
    coverage_audit = audit(plan, source['observations'], rebuilt, TARGETS)
    coverage_audit['fitted_groups'] = coverage
    write_json(out / 'training-feature-coverage.json', coverage_audit)
    write_json(out / 'folds.json', fold_reports)
    write_json(out / 'metrics-by-fold.json', by_fold)
    write_json(out / 'metrics-pooled.json', pooled)
    write_json(out / 'paired-comparisons.json', paired_result)
    write_json(out / 'uncertainty.json', {'method': 'paired bootstrap by full sessions, weeks and months',
               'comparisons': paired_result, 'caveat': 'Dependence between sessions and long regimes remains.'})
    from ml.phase41f.diagnostics import describe
    write_json(out / 'feature-diagnostics.json', describe(out, fold_reports))
    columns = list(records[0])
    with (out / 'predictions.csv').open('x', encoding='utf8', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=columns)
        writer.writeheader()
        for row in records:
            writer.writerow({name: json.dumps(value, ensure_ascii=False, separators=(',', ':'))
                             if isinstance(value, list) else value for name, value in row.items()})
    report = {'schema': 'phase41f-report-v1', 'status': 'HISTORICAL_EXPLORED',
              'configuration_sha256': sha(out / 'experiment-config.json'),
              'source_integrity': 'SHA256SUMS, manifests and code contracts verified',
              'reconstructed_observations': parity['all_observations_reconstructed'],
              'external_parity': parity, 'coverage': coverage,
              'exclusion_audit': coverage_audit['groups'],
              'metrics_by_fold': by_fold, 'metrics_pooled': pooled,
              'paired_comparisons': paired_result,
              'limitations': ['Already explored history; no independent prospective validation.',
                              'SIP split may include subsequent corporate-action adjustments.',
                              'SIP +20 is simulated availability, not verified historical receipt.',
                              'OHLC references are not guaranteed executions.',
                              'Session bootstrap may miss dependence across sessions and long regimes.']}
    write_json(out / 'report.json', report)
    from ml.phase41f.report import markdown
    (out / 'report.md').write_text(markdown(report), encoding='utf8', newline='\n')
    provenance = {'schema': 'phase41f-manifest-v1', 'status': 'HISTORICAL_EXPLORED',
                  'config_sha256': report['configuration_sha256'],
                  'sources': {'history': source['history_hashes'], 'phase38e': source['run_hashes'],
                              'phase41d': source['target_hashes'], 'phase41e': feature_hashes,
                              'sip': manifest41e['source_sha256']['sip']},
                  'versions': {'python': platform.python_version(), 'numpy': np.__version__,
                               'xgboost': xgboost.__version__, 'lightgbm': lightgbm.__version__,
                               'scikit_learn': sklearn.__version__},
                  'models_trained_for_research_only': True, 'production_modified': False}
    write_json(out / 'manifest.json', provenance)
    paths = sorted(p for p in out.iterdir() if p.is_file() and p.name != 'SHA256SUMS')
    (out / 'SHA256SUMS').write_text(''.join(f'{sha(path)}  {path.name}\n' for path in paths),
                                    encoding='utf8', newline='\n')
    return report


def main():
    parser = argparse.ArgumentParser(description='Comparacion historica 41F; no promueve modelos.')
    for name in ('history', 'run', 'targets', 'features', 'sip-csv', 'out'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    report = run(args.history, args.run, args.targets, args.features, args.sip_csv, args.out)
    print(json.dumps({'status': report['status'],
                      'reconstructed_observations': report['reconstructed_observations'],
                      'config_sha256': report['configuration_sha256']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
