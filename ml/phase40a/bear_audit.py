"""Phase 40A: causal-data audit of already recorded, out-of-sample IEX predictions.

Outcomes are inspected only after predictions have been joined and validated. This
module neither trains nor changes the historical classifier or its decision rule.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import platform
from collections import Counter, defaultdict
from datetime import timedelta
from pathlib import Path

import numpy as np
import xgboost

from ml.phase28.train import CLASSES, FEATURES
from ml.phase38e.replay import load_run as load_observations
from ml.phase38c.replay import iso

SCENARIOS = ('ideal', 'delayed')
MIN_GROUP = 30
BOOTSTRAP_SAMPLES = 300
SEED = 7
BOUNDARY_DISTANCE = 0.1  # Descriptive ATR units around the pre-existing +/-0.5 labels.
PROBABILITY_MARGIN = 0.05  # Descriptive only; never a decision threshold.
HIGH_CONFIDENCE = 0.70  # Descriptive only.


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def json_numpy_scalar(value):
    if isinstance(value, np.generic):
        return value.item()
    raise TypeError(f'Non-serializable report value: {type(value).__name__}')


def declared_hashes(directory):
    result = {}
    for line in (Path(directory) / 'SHA256SUMS').read_text(encoding='utf8').splitlines():
        pieces = line.split('  ', 1)
        if (len(pieces) != 2 or len(pieces[0]) != 64 or
                any(c not in '0123456789abcdef' for c in pieces[0]) or
                pieces[1] in result or Path(pieces[1]).is_absolute() or
                '..' in Path(pieces[1]).parts):
            raise ValueError('SHA256SUMS inválido.')
        result[pieces[1]] = pieces[0]
    return result


def load_historical_observations(run):
    """Use 38E's validator unless its source-code snapshot predates current code.

    The historical manifest records the original code hashes. A later edit of the
    two source files must not mutate an immutable run or prevent read-only audit.
    In that case validate the frozen data contract directly, and disclose drift.
    """
    run = Path(run)
    manifest = json.loads((run / 'manifest.json').read_text(encoding='utf8'))
    source = manifest.get('source', {})
    if (manifest.get('schema') != 'phase38e-v1' or source.get('symbol') != 'NVDA' or
            source.get('feed') != 'iex' or source.get('adjustment') != 'raw' or
            source.get('minuteTimeframe') != '1Min' or source.get('timeframe') != '15m'):
        raise ValueError('Manifiesto IEX incompatible.')
    root = Path(__file__).resolve().parents[2]
    code_hashes = manifest.get('codeSha256')
    if not isinstance(code_hashes, dict):
        raise ValueError('Hashes de código ausentes.')
    drift = [name for name, digest in code_hashes.items()
             if not (root / name).is_file() or sha(root / name) != digest]
    if not drift:
        rows, verified = load_observations(run)
        return rows, verified, drift
    rows = json.loads((run / 'observations.json').read_text(encoding='utf8'))
    if not isinstance(rows, list) or len(rows) != manifest.get('rows') or len(rows) % 2:
        raise ValueError('Observaciones incompletas.')
    previous = None
    for index, row in enumerate(rows):
        scenario = SCENARIOS[index % 2]
        if (row.get('mode') != 'HISTORICAL_REPLAY' or row.get('phase') != '38E' or
                row.get('symbol') != 'NVDA' or row.get('timeframe') != '15m' or
                row.get('feed') != 'iex' or row.get('adjustment') != 'raw' or
                row.get('historical_received_at_utc') is not None or row.get('scenario') != scenario):
            raise ValueError('Procedencia IEX incompatible.')
        features = row.get('features')
        if not isinstance(features, dict) or set(features) != set(FEATURES):
            raise ValueError('Variables IEX incompatibles.')
        for name in FEATURES:
            finite_number(features[name], name)
        start, end, available = (iso(row[name]) for name in
                                 ('bar_start_utc', 'bar_end_utc', 'available_at_utc'))
        if (end - start != timedelta(minutes=15) or
                available - end != timedelta(minutes=20 if scenario == 'delayed' else 0) or
                start.minute % 15 or start.second or start.microsecond or
                row['session_date_ny'] != start.date().isoformat()):
            raise ValueError('Tiempo IEX incompatible.')
        entry, outcome = row['reference_entry_at_utc'], row['label_available_at_utc']
        if entry is not None:
            if iso(entry) <= available or iso(entry) - available > timedelta(minutes=15):
                raise ValueError('Entrada de referencia incompatible.')
            if row['minutes_until_reference_entry'] != (iso(entry) - available).total_seconds() / 60:
                raise ValueError('Espera de entrada incompatible.')
        elif row['minutes_until_reference_entry'] is not None:
            raise ValueError('Entrada de referencia ausente.')
        if row['label'] is not None:
            if (entry is None or outcome is None or iso(outcome) != iso(entry) + timedelta(minutes=60)
                    or row['exclusion'] is not None or row['label'] not in CLASSES):
                raise ValueError('Horizonte IEX incompatible.')
            normalized_movement(row)
        elif (outcome is not None or row['label_entry_open'] is not None or
              row['label_exit_close'] is not None or row['exclusion'] not in ('MARKET_CLOSE', 'FUTURE_BARS_MISSING')):
            raise ValueError('Exclusión IEX incompatible.')
        if index % 2 == 0:
            if previous is not None and row['bar_start_utc'] <= previous:
                raise ValueError('Observaciones desordenadas.')
            previous = row['bar_start_utc']
        elif (row['bar_start_utc'] != rows[index - 1]['bar_start_utc'] or
              row['features'] != rows[index - 1]['features'] or
              row['feature_sha256'] != rows[index - 1]['feature_sha256']):
            raise ValueError('Escenarios desalineados.')
    return rows, manifest, drift


def finite_number(value, name, positive=False):
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f'{name} inválido.') from exc
    if not math.isfinite(number) or (positive and number <= 0):
        raise ValueError(f'{name} inválido.')
    return number


def probability_vector(value):
    try:
        values = json.loads(value) if isinstance(value, str) else value
    except (ValueError, TypeError) as exc:
        raise ValueError('Probabilidades inválidas.') from exc
    if not isinstance(values, list) or len(values) != len(CLASSES):
        raise ValueError('Probabilidades inválidas.')
    numbers = [finite_number(item, 'Probabilidad') for item in values]
    if any(item < 0 or item > 1 for item in numbers) or abs(sum(numbers) - 1) > 1e-5:
        raise ValueError('Probabilidades inválidas.')
    return numbers


def normalized_movement(observation):
    entry = finite_number(observation['label_entry_open'], 'Apertura de etiqueta', True)
    close = finite_number(observation['label_exit_close'], 'Cierre de etiqueta', True)
    atr = finite_number(observation['label_atr14_price_units'], 'ATR de etiqueta', True)
    movement = (close - entry) / atr
    expected = 'ALCISTA' if movement > .5 else 'BAJISTA' if movement < -.5 else 'LATERAL'
    # Compare the price-unit rule as well to avoid roundoff at +/-0.5 ATR.
    raw = close - entry
    expected = 'ALCISTA' if raw > .5 * atr else 'BAJISTA' if raw < -.5 * atr else 'LATERAL'
    if observation['label'] != expected:
        raise ValueError('Etiqueta incompatible con classifyMovement().')
    return movement


def join_rows(observations, predictions, report, declared):
    """Join by scenario/bar identity, then verify fold, timestamps and immutable fields."""
    index = {}
    for item in observations:
        key = (item['scenario'], item['bar_start_utc'])
        if key in index:
            raise ValueError('Observaciones duplicadas o ambiguas.')
        index[key] = item
    model_index = {}
    for scenario in SCENARIOS:
        for model in report['scenarios'][scenario]['models']:
            key = (scenario, int(model['fold']))
            if key in model_index:
                raise ValueError('Modelos ambiguos.')
            model_index[key] = model
    seen = set()
    joined = []
    for row in predictions:
        if (row.get('mode') != 'HISTORICAL_REPLAY' or row.get('phase') != '38E' or
                row.get('feed') != 'iex' or row.get('adjustment') != 'raw' or
                row.get('scenario') not in SCENARIOS or row.get('historical_received_at_utc') not in ('', None)):
            raise ValueError('Predicción IEX incompatible.')
        scenario = row['scenario']
        try:
            fold = int(row['fold'])
        except (TypeError, ValueError) as exc:
            raise ValueError('Fold inválido.') from exc
        key = (scenario, row['bar_start_utc'])
        if key in seen:
            raise ValueError('Predicciones duplicadas.')
        seen.add(key)
        item = index.get(key)
        if item is None:
            raise ValueError('Predicción sin observación inequívoca.')
        model = model_index.get((scenario, fold))
        if model is None or row['model_sha256'] != model['sha256'] or declared.get(model['file']) != model['sha256']:
            raise ValueError('Modelo o hash de fold incompatible.')
        features = item['features']
        if set(features) != set(FEATURES):
            raise ValueError('Variables incompatibles.')
        for name in FEATURES:
            finite_number(features[name], name)
        if (row['session_date_ny'] != item['session_date_ny'] or
                row['feature_sha256'] != item['feature_sha256'] or
                json.loads(row['features']) != item['features'] or
                row['inference_at_utc'] != item['available_at_utc'] or
                row['reference_entry_at_utc'] != (item['reference_entry_at_utc'] or '') or
                row['label_available_at_utc'] != (item['label_available_at_utc'] or '') or
                row['label'] != (item['label'] or '') or
                row['exclusion'] != (item['exclusion'] or '')):
            raise ValueError('Identidad, variables, etiqueta o tiempo incompatibles.')
        for csv_name, obs_name in (('label_entry_open', 'label_entry_open'),
                                   ('label_exit_close', 'label_exit_close')):
            a = row[csv_name]
            b = item[obs_name]
            if (a == '') != (b is None) or (a != '' and finite_number(a, csv_name) != finite_number(b, obs_name)):
                raise ValueError('Precio de etiqueta incompatible.')
        probability = probability_vector(row['prob_xgboost'])
        if item['label'] is None:
            if item['exclusion'] not in ('MARKET_CLOSE', 'FUTURE_BARS_MISSING'):
                raise ValueError('Etiqueta ausente sin exclusión conocida.')
            continue
        movement = normalized_movement(item)
        if item['label_available_at_utc'] <= item['available_at_utc']:
            raise ValueError('Desenlace anterior a la decisión.')
        joined.append({'scenario': scenario, 'fold': fold, 'session': item['session_date_ny'],
                       'bar_start_utc': item['bar_start_utc'], 'label': item['label'],
                       'probability': probability, 'features': features, 'movement_atr': movement})
    if len(predictions) != report['prediction_rows']:
        raise ValueError('Conteo de predicciones inconsistente.')
    for scenario in SCENARIOS:
        for fold_report in report['scenarios'][scenario]['folds']:
            fold = int(fold_report['fold'])
            subset = [r for r in predictions if r['scenario'] == scenario and int(r['fold']) == fold]
            if len(subset) != fold_report['test_rows'] or sum(r['label'] in CLASSES for r in subset) != fold_report['resolved_rows']:
                raise ValueError('Conteos de fold incompatibles.')
            if any(not fold_report['first_test_session'] <= r['session_date_ny'] <= fold_report['last_test_session'] for r in subset):
                raise ValueError('Predicción fuera de la ventana de su fold.')
    return joined


def load_verified(run):
    run = Path(run)
    declared = declared_hashes(run)
    required = {'manifest.json', 'observations.json', 'predictions.csv', 'report.json',
                'corporate-actions-audit.json'}
    if not required.issubset(declared):
        raise ValueError('Artefactos declarados incompletos.')
    # The Phase 38E validator also verifies original code hashes and the complete
    # causal observation contract; do not modify its frozen source files.
    observations, manifest, drift = load_historical_observations(run)
    report = json.loads((run / 'report.json').read_text(encoding='utf8'))
    if (report.get('schema') != 'phase38e-report-v1' or report.get('classes') != list(CLASSES) or
            report.get('features') != list(FEATURES) or set(report.get('scenarios', {})) != set(SCENARIOS)):
        raise ValueError('Reporte 38E incompatible.')
    if report.get('code_sha256') != manifest.get('codeSha256') or report.get('source_sha256') != manifest['source']['sha256']:
        raise ValueError('Procedencia del reporte incompatible.')
    for name, digest in declared.items():
        path = run / name
        if not path.is_file() or sha(path) != digest:
            raise ValueError(f'Integridad IEX inválida: {name}.')
    with (run / 'predictions.csv').open(encoding='utf8', newline='') as handle:
        predictions = list(csv.DictReader(handle))
    joined = join_rows(observations, predictions, report, declared)
    return joined, observations, predictions, report, declared, drift


def describe(values):
    arr = np.asarray(values, dtype=float)
    valid = arr[np.isfinite(arr)]
    if not len(valid):
        return {'n': len(arr), 'invalid_pct': 100.0 if len(arr) else None, 'mean': None,
                'median': None, 'std': None, 'p10': None, 'p25': None, 'p75': None,
                'p90': None, 'min': None, 'max': None}
    result = {'n': len(arr), 'invalid_pct': 100 * (len(arr) - len(valid)) / len(arr),
              'mean': float(np.mean(valid)), 'median': float(np.median(valid)),
              'std': float(np.std(valid)), 'min': float(np.min(valid)), 'max': float(np.max(valid))}
    for p in (10, 25, 75, 90):
        result[f'p{p}'] = float(np.percentile(valid, p))
    return result


def feature_diagnostics(rows):
    result = {}
    for fold in sorted({r['fold'] for r in rows}):
        subset = [r for r in rows if r['fold'] == fold]
        by_class = {label: {name: describe([r['features'][name] for r in subset if r['label'] == label])
                            for name in FEATURES} for label in CLASSES}
        comparison = {}
        for name in FEATURES:
            bear = describe([r['features'][name] for r in subset if r['label'] == 'BAJISTA'])
            other = describe([r['features'][name] for r in subset if r['label'] != 'BAJISTA'])
            pooled = np.std([r['features'][name] for r in subset]) if subset else 0
            comparison[name] = {'bear_minus_other_mean': bear['mean'] - other['mean'] if bear['mean'] is not None and other['mean'] is not None else None,
                                'standardized_mean_difference': (bear['mean'] - other['mean']) / pooled if pooled and bear['mean'] is not None and other['mean'] is not None else None}
        matrix = np.array([[r['features'][name] for name in FEATURES] for r in subset], dtype=float)
        with np.errstate(invalid='ignore', divide='ignore'):
            corr = np.corrcoef(matrix, rowvar=False) if len(matrix) > 1 else np.full((len(FEATURES), len(FEATURES)), np.nan)
        correlation = {a: {b: float(corr[i, j]) if math.isfinite(corr[i, j]) else None
                           for j, b in enumerate(FEATURES)} for i, a in enumerate(FEATURES)}
        result[str(fold)] = {'rows': len(subset), 'by_true_class': by_class,
                             'bear_vs_non_bear': comparison, 'correlations': correlation}
    return result


def error_audit(rows):
    groups = defaultdict(list)
    confusion = {actual: {predicted: 0 for predicted in CLASSES} for actual in CLASSES}
    for row in rows:
        p = row['probability']
        predicted = CLASSES[int(np.argmax(p))]
        confusion[row['label']][predicted] += 1
        groups[f'{row["label"]}_to_{predicted}'].append(row)
    summaries = {}
    for name, subset in sorted(groups.items()):
        summaries[name] = {'rows': len(subset),
                           'probabilities': {label: describe([r['probability'][i] for r in subset]) for i, label in enumerate(CLASSES)},
                           'bear_second': int(sum(np.argsort(r['probability'])[-2] == 1 for r in subset)),
                           'bear_near_lateral': sum(abs(r['probability'][1] - r['probability'][2]) <= PROBABILITY_MARGIN for r in subset),
                           'wrong_high_confidence': int(sum(np.argmax(r['probability']) != CLASSES.index(r['label']) and max(r['probability']) >= HIGH_CONFIDENCE for r in subset)),
                           'bear_minus_lateral_margin': describe([r['probability'][1] - r['probability'][2] for r in subset])}
    true_bear = sum(confusion['BAJISTA'].values())
    correct_bear = confusion['BAJISTA']['BAJISTA']
    return {'rows': len(rows), 'true_distribution': dict(Counter(r['label'] for r in rows)),
            'confusion': confusion, 'groups': summaries,
            'probability_bear_by_truth': {label: describe([r['probability'][1] for r in rows if r['label'] == label]) for label in CLASSES},
            'bear_recall': correct_bear / true_bear if true_bear else None,
            'status': 'INSUFFICIENT_EVIDENCE' if true_bear < MIN_GROUP or len({r['session'] for r in rows}) < MIN_GROUP else 'DESCRIPTIVE'}


def label_diagnostics(rows):
    result = {}
    for label in CLASSES:
        subset = [r for r in rows if r['label'] == label]
        result[label] = {'movement_atr': describe([r['movement_atr'] for r in subset]),
                         'near_label_boundary_0_1_atr': sum(min(abs(r['movement_atr'] - .5), abs(r['movement_atr'] + .5)) <= BOUNDARY_DISTANCE for r in subset)}
    bears = [r for r in rows if r['label'] == 'BAJISTA']
    wrong = [r for r in bears if int(np.argmax(r['probability'])) != CLASSES.index('BAJISTA')]
    result['bear_errors'] = {'n': len(wrong), 'movement_atr': describe([r['movement_atr'] for r in wrong]),
                             'strong_declines_below_minus_1_atr': sum(r['movement_atr'] < -1 for r in wrong)}
    return result


def group_summary(rows):
    audit = error_audit(rows)
    return {'n': len(rows), 'sessions': len({r['session'] for r in rows}),
            'bear_n': audit['true_distribution'].get('BAJISTA', 0),
            'bear_prevalence': audit['true_distribution'].get('BAJISTA', 0) / len(rows) if rows else None,
            'bear_recall': audit['bear_recall'], 'status': audit['status']}


def regime_diagnostics(rows):
    atr_median = float(np.median([r['features']['atr14_relative'] for r in rows])) if rows else None
    groups = defaultdict(list)
    for row in rows:
        minute = row['features']['minutes_from_open']
        if minute < 60:
            segment = 'first_hour'
        elif minute >= 330:
            segment = 'last_hour'
        else:
            segment = 'middle_session'
        groups[f'segment:{segment}'].append(row)
        groups[f'ny_hour:{9 + (30 + minute) // 60:02d}'].append(row)
        groups[f'month:{row["session"][:7]}'].append(row)
        groups[f'fold:{row["fold"]}'].append(row)
        groups[f'atr:{"high" if row["features"]["atr14_relative"] >= atr_median else "low"}'].append(row)
        movement = abs(row['movement_atr'])
        groups[f'future_magnitude:{"small" if movement <= .6 else "medium" if movement <= 1 else "large"}'].append(row)
    for fixed in ('segment:first_hour', 'segment:middle_session', 'segment:last_hour',
                  'atr:high', 'atr:low', 'future_magnitude:small',
                  'future_magnitude:medium', 'future_magnitude:large'):
        groups[fixed]
    return {'atr_median_within_scenario': atr_median,
            'future_magnitude_is_diagnostic_only': True,
            'groups': {name: group_summary(group) for name, group in sorted(groups.items())}}


def bootstrap_sessions(rows, iterations=BOOTSTRAP_SAMPLES, seed=SEED):
    sessions = defaultdict(list)
    for row in rows:
        sessions[row['session']].append(row)
    keys = sorted(sessions)
    if len(keys) < MIN_GROUP or sum(r['label'] == 'BAJISTA' for r in rows) < MIN_GROUP:
        return {'status': 'INSUFFICIENT_EVIDENCE', 'sessions': len(keys)}
    rng = np.random.default_rng(seed)
    recalls = []
    confusion_differences = []
    # Aggregate sufficient counts once per session. Resampling those whole-session
    # counts is equivalent to copying every row and avoids repeated quantiles.
    session_counts = {}
    for key in keys:
        counts = np.zeros(3, dtype=int)
        for row in sessions[key]:
            if row['label'] == 'BAJISTA':
                counts[int(np.argmax(row['probability']))] += 1
        session_counts[key] = counts
    for _ in range(iterations):
        counts = sum((session_counts[key] for key in rng.choice(keys, len(keys), replace=True)),
                     np.zeros(3, dtype=int))
        total = int(sum(counts))
        if total:
            recalls.append(counts[1] / total)
            confusion_differences.append((counts[2] - counts[0]) / total)
    return {'status': 'DESCRIPTIVE', 'sessions': len(keys), 'iterations': iterations, 'seed': seed,
            'bear_recall_95pct': [float(x) for x in np.quantile(recalls, [.025, .975])],
            'bear_lateral_minus_bull_confusion_rate_95pct': [float(x) for x in np.quantile(confusion_differences, [.025, .975])]}


def model_importance(run, report, declared):
    output = {}
    for scenario in SCENARIOS:
        output[scenario] = {}
        for model in report['scenarios'][scenario]['models']:
            name = model['file']
            if declared.get(name) != model['sha256'] or sha(Path(run) / name) != model['sha256']:
                raise ValueError('Hash del modelo incompatible.')
            try:
                booster = xgboost.Booster()
                booster.load_model(str(Path(run) / name))
                score = booster.get_score(importance_type='gain')
                if not score:
                    output[scenario][str(model['fold'])] = {'status': 'UNAVAILABLE', 'reason': 'NO_GAIN_SCORES'}
                    continue
                gain = {feature: float(score.get(feature, score.get(f'f{i}', 0.0)))
                        for i, feature in enumerate(FEATURES)}
                output[scenario][str(model['fold'])] = {'status': 'AVAILABLE', 'gain': gain}
            except (xgboost.XGBoostError, OSError) as exc:
                output[scenario][str(model['fold'])] = {'status': 'UNAVAILABLE', 'reason': type(exc).__name__}
    return output


def audit(joined, importance=None):
    scenarios = {}
    for scenario in SCENARIOS:
        rows = [r for r in joined if r['scenario'] == scenario]
        if not rows:
            raise ValueError(f'Escenario {scenario} sin predicciones evaluables.')
        folds = {str(fold): error_audit([r for r in rows if r['fold'] == fold])
                 for fold in sorted({r['fold'] for r in rows})}
        scenarios[scenario] = {'rows': len(rows), 'folds': folds, 'aggregate': error_audit(rows),
                               'features': feature_diagnostics(rows), 'labels': label_diagnostics(rows),
                               'regimes': regime_diagnostics(rows), 'session_bootstrap': bootstrap_sessions(rows)}
    return {'scenarios': scenarios, 'model_importance': importance or {}}


def interpretations(result):
    """Fixed, conservative questions; explanations remain hypotheses."""
    delayed = result['scenarios']['delayed']
    confusion = delayed['aggregate']['confusion']['BAJISTA']
    bear = sum(confusion.values())
    other_counts = delayed['aggregate']['true_distribution']
    lateral = confusion['LATERAL']
    bull = confusion['ALCISTA']
    fold_recall = [v['bear_recall'] for v in delayed['folds'].values() if v['bear_recall'] is not None]
    near = delayed['labels']['BAJISTA']['near_label_boundary_0_1_atr']
    weak_features = {}
    for fold, fold_data in delayed['features'].items():
        differences = {name: abs(value['standardized_mean_difference'])
                       for name, value in fold_data['bear_vs_non_bear'].items()
                       if value['standardized_mean_difference'] is not None}
        weak_features[fold] = sorted(differences, key=differences.get)[:3]
    by_truth = delayed['aggregate']['probability_bear_by_truth']
    p_bear = by_truth['BAJISTA']['mean']
    non_groups = [by_truth[label] for label in ('ALCISTA', 'LATERAL') if by_truth[label]['n']]
    p_non = (float(np.average([group['mean'] for group in non_groups],
                              weights=[group['n'] for group in non_groups])) if non_groups else None)
    regime = delayed['regimes']['groups']
    atr = {key: regime[f'atr:{key}']['bear_recall'] for key in ('high', 'low')}
    boundary_share = near / bear if bear else None
    return {
        '1_class_imbalance': {'measured': other_counts, 'assessment': 'PARTIALLY_SUPPORTED' if bear < max(other_counts.values()) else 'NOT_SUPPORTED',
                              'note': 'Comparación de prevalencia; no establece la causa del bajo recall.'},
        '2_feature_separation': {'assessment': 'PARTIALLY_SUPPORTED', 'measured': {'smallest_absolute_standardized_differences_by_fold': weak_features},
                                 'note': 'Varias diferencias univariadas son pequeñas; esto no descarta información multivariante.'},
        '3_lateral_confusion': {'measured': {'bear_to_lateral': lateral, 'bear_to_bull': bull},
                                'assessment': 'SUPPORTED' if lateral > bull else 'NOT_SUPPORTED'},
        '4_probability_signal': {'assessment': 'PARTIALLY_SUPPORTED',
                                  'measured': {'mean_p_bear_true_bear': p_bear, 'mean_p_bear_other_classes_weighted': p_non},
                                  'note': 'Asociación débil; consultar ROC/PR/calibración de Fase 38F. No valida un umbral.'},
        '5_time_regime': {'assessment': 'PARTIALLY_SUPPORTED', 'measured': {'bear_recall_by_atr_half': atr},
                          'note': 'Diferencias exploratorias de ATR y horario; no inferir mecanismo causal.'},
        '6_boundary_labels': {'measured': {'near_boundary_bear': near, 'bear_total': bear, 'share': boundary_share},
                               'assessment': 'PARTIALLY_SUPPORTED' if boundary_share and boundary_share >= .2 else 'NOT_SUPPORTED',
                               'note': 'Cercanía a la frontera puede afectar algunos casos; su proporción no explica por sí sola el recall bajo.'},
        '7_fold_consistency': {'measured': {'bear_recall_by_fold': fold_recall}, 'assessment': 'SUPPORTED' if fold_recall and max(fold_recall) < .1 else 'PARTIALLY_SUPPORTED',
                                'note': 'Bajo recall en todos los folds no implica estabilidad de su magnitud.'},
        '8_missing_information': {'assessment': 'NOT_SUPPORTED', 'note': 'No se probaron variables nuevas; IEX tiene cobertura parcial y recepción histórica simulada.'},
        '9_first_hypothesis': {'assessment': 'NOT_SUPPORTED', 'note': 'Fase 40B debe probar XGBoost frente a LightGBM con mismo dataset, folds, etiquetas y purga; ninguna mejora está demostrada.'},
    }


def markdown(report):
    delayed = report['analysis']['scenarios']['delayed']
    ideal = report['analysis']['scenarios']['ideal']
    lines = ['# Fase 40A: auditoría retrospectiva BAJISTA', '',
             'Histórico IEX de NVDA; no hay recepción prospectiva verificada ni recomendación operativa.',
             'El escenario delayed es principal. Ideal y delayed tienen objetivos y disponibilidad distintos.', '',
             '| Escenario | Filas evaluadas | BAJISTA real | Recall BAJISTA | BAJISTA→LATERAL | BAJISTA→ALCISTA |',
             '|---|---:|---:|---:|---:|---:|']
    for name, part in (('delayed', delayed), ('ideal', ideal)):
        summary = part['aggregate']
        bear = summary['confusion']['BAJISTA']
        recall = f'{summary["bear_recall"]:.4f}' if summary['bear_recall'] is not None else 'N/D'
        lines.append(f'| {name} | {part["rows"]} | {sum(bear.values())} | {recall} | {bear["LATERAL"]} | {bear["ALCISTA"]} |')
    lines += ['', '## Nueve preguntas', '']
    for key, value in report['interpretations'].items():
        lines.append(f'- **{key}**: {value["assessment"]}. {value.get("note", "")} Datos: {value.get("measured", "ver report.json")}.')
    lines += ['', '## Límites', '',
              'Hechos medidos y asociaciones retrospectivas no identifican causas ni validan umbrales.',
              'Los movimientos futuros se emplearon solo para auditar etiquetas, jamás como variables.',
              'Los cortes por horario, mes y volatilidad son descriptivos; muestras <30 o <30 sesiones se marcan insuficientes.',
              'El bootstrap remuestrea sesiones completas, pero puede omitir dependencia entre jornadas y regímenes largos.',
              'La importancia gain de XGBoost no es causal. Consultar Fase 38F para ROC-AUC, PR-AUC y calibración existentes.',
              'Histórico previamente examinado: no existe evaluación independiente del proyecto.', '']
    return '\n'.join(lines)


def write_report(run, out):
    run, out = Path(run).resolve(), Path(out).resolve()
    if out.exists() or out == run or out in run.parents or run in out.parents:
        raise ValueError('La salida debe ser una carpeta nueva e independiente.')
    joined, observations, predictions, source, declared, drift = load_verified(run)
    analysis = audit(joined, model_importance(run, source, declared))
    report = {'schema': 'phase40a-bear-audit-v1', 'experiment': 'phase38e-iex-historical-replay',
              'primary_scenario': 'delayed', 'classes': list(CLASSES), 'features': list(FEATURES),
              'metadata': {'python': platform.python_version(), 'numpy': np.__version__,
                           'xgboost': xgboost.__version__, 'audit_code_sha256': sha(__file__),
                           'input_sha256': dict(sorted(declared.items())),
                           'code_snapshot_drift': drift,
                           'last_observation_utc': observations[-1]['bar_end_utc'],
                           'parameters': {'min_group': MIN_GROUP, 'bootstrap_samples': BOOTSTRAP_SAMPLES,
                                          'seed': SEED, 'boundary_distance_atr': BOUNDARY_DISTANCE,
                                          'probability_margin': PROBABILITY_MARGIN,
                                          'high_confidence': HIGH_CONFIDENCE},
                           'policy': 'Solo predicciones OOS, variables al decidir; etiquetas futuras para auditoría posterior.'},
              'input_counts': {'observations': len(observations), 'predictions': len(predictions), 'evaluable_joined': len(joined)},
              'analysis': analysis, 'interpretations': interpretations(analysis),
              'warning': 'Investigación retrospectiva exploratoria; ningún resultado es una señal ni una probabilidad operativa validada.'}
    payload = json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False,
                         default=json_numpy_scalar) + '\n'
    narrative = markdown(report)
    out.mkdir(parents=True, exist_ok=False)
    (out / 'report.json').write_text(payload, encoding='utf8')
    (out / 'report.md').write_text(narrative, encoding='utf8')
    with (out / 'SHA256SUMS').open('x', encoding='utf8') as handle:
        for name in ('report.json', 'report.md'):
            handle.write(f'{sha(out / name)}  {name}\n')
    return report


def main():
    parser = argparse.ArgumentParser(description='Auditoría BAJISTA IEX retrospectiva de Fase 40A')
    parser.add_argument('--run', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    report = write_report(args.run, args.out)
    print(json.dumps({'status': 'OK', 'observations': report['input_counts']['observations'],
                      'evaluable': report['input_counts']['evaluable_joined']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
