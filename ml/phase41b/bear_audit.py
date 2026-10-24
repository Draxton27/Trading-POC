"""Phase 41B: join frozen IEX predictions to causally simulated SIP context.

No model is fitted. SIP prices are only compared with SIP references. The delay
assumptions do not stand for verified historical reception timestamps.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import platform
import shutil
import subprocess
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

from ml.phase28.train import CLASSES
from ml.phase40a.bear_audit import load_verified, probability_vector, sha
from ml.phase40c1.temporal_features import load_history

ROOT = Path(__file__).resolve().parents[2]
DELAYS = (15, 20, 30)
MIN_BEAR = 30
MIN_SESSIONS = 30
BOOTSTRAP = 300
SEED = 41
STATUSES = ('SOURCE_OUT_OF_RANGE', 'INSUFFICIENT_SIP_HISTORY',
            'INCOMPLETE_SESSION', 'SIMULATED_DELAY_NOT_MET',
            'TECHNICAL_CONTEXT_AVAILABLE')
KEY_GROUPS = ('alignment:ALIGNED_BEARISH', 'alignment:SHORT_TERM_PULLBACK',
              'regime:bear_continuation', 'regime:bull_trend_pullback',
              'regime:bull_daily_bear_hour',
              '15m:shortPair:BEARISH_ALIGNMENT', '1h:shortPair:BEARISH_ALIGNMENT',
              '1d:shortPair:BEARISH_ALIGNMENT',
              '15m:shortPairSlope:BEARISH_ALIGNMENT:FALLING',
              '15m:shortPairSlope:BEARISH_ALIGNMENT:RISING',
              'prior20:breakBelowLow:True')


def safe_output(path):
    target = Path(path).resolve()
    roots = (ROOT / 'private', ROOT / 'trading_poc_001_bollinger' / 'output' / 'real')
    if not any(target.is_relative_to(base) and target != base for base in roots):
        raise ValueError('La salida debe ser un directorio nuevo en private/ u output/real/.')
    if target.exists():
        raise FileExistsError('La salida ya existe; no se sobrescriben resultados.')
    return target


def verified_inputs(history, run):
    joined, observations, predictions, report, declared, drift = load_verified(run)
    manifest = json.loads((Path(run) / 'manifest.json').read_text(encoding='utf8'))
    _, _, history_hashes, history_query = load_history(history, manifest)
    if set(report['scenarios']) != {'ideal', 'delayed'}:
        raise ValueError('Escenarios originales incompatibles.')
    if len({(p['scenario'], p['bar_start_utc']) for p in predictions}) != len(predictions):
        raise ValueError('Predicciones originales duplicadas.')
    index = {(r['scenario'], r['bar_start_utc']): r for r in observations}
    queries = []
    for row in predictions:
        observation = index.get((row['scenario'], row['bar_start_utc']))
        if observation is None:
            raise ValueError('Predicción sin observación original.')
        queries.append({'scenario': row['scenario'], 'fold': int(row['fold']),
                        'barStartUtc': row['bar_start_utc'],
                        'barEndUtc': observation['bar_end_utc'],
                        'decisionAtUtc': row['inference_at_utc']})
    return {'joined': joined, 'observations': observations, 'predictions': predictions,
            'report': report, 'run_hashes': declared, 'history_hashes': history_hashes,
            'history_query': history_query, 'code_drift': drift, 'queries': queries}


def run_bridge(sip_csv, queries_path, context_path, *, node='node'):
    script = ROOT / 'trading_poc_001_bollinger' / 'src' / 'phase41b-context-cli.ts'
    result = subprocess.run([node, '--import', 'tsx', str(script), '--sip-csv',
                             str(sip_csv), '--queries', str(queries_path), '--out', str(context_path)],
                            cwd=ROOT, capture_output=True, text=True, timeout=1800, check=False)
    if result.returncode:
        raise RuntimeError('Falló el índice SIP validado: ' + result.stderr[-1500:])
    data = json.loads(context_path.read_text(encoding='utf8'))
    if data.get('schema') != 'phase41b-context-v1':
        raise ValueError('Salida del motor 41A incompatible.')
    return data


def verify_context_source(contexts, sip_csv):
    source = contexts.get('source', {})
    expected_inputs = {ext or 'csv': sha(Path(str(sip_csv) + ext))
                       for ext in ('', '.meta.json', '.calendar.json', '.provenance.json')}
    expected_code = {name: sha(ROOT / name) for name in (
        'trading_poc_001_bollinger/src/phase41b-context.ts',
        'trading_poc_001_bollinger/src/phase41b-context-cli.ts',
        'trading_poc_001_bollinger/src/investep-technical-context.ts',
        'trading_poc_001_bollinger/src/multitimeframe.ts')}
    if source.get('hashes') != expected_inputs or source.get('codeSha256') != expected_code:
        raise ValueError('Contextos SIP generados con fuente o código diferente.')


def joined_contexts(source, contexts):
    index = {}
    for row in contexts['rows']:
        key = (row['scenario'], row['barStartUtc'], row['delayMinutes'])
        if key in index or row['delayMinutes'] not in DELAYS or row['reason'] not in STATUSES:
            raise ValueError('Contextos SIP duplicados o inválidos.')
        if row['sipAssumedAvailableAtUtc'] is not None and row['sipAssumedAvailableAtUtc'] > row['iexDecisionAtUtc']:
            raise ValueError('Contexto SIP posterior a decisión IEX.')
        index[key] = row
    if len(index) != len(source['queries']) * len(DELAYS):
        raise ValueError('Faltan contextos SIP; ninguna fila se descarta silenciosamente.')
    query_index = {(q['scenario'], q['barStartUtc']): q for q in source['queries']}
    if len(query_index) != len(source['queries']):
        raise ValueError('Consultas duplicadas.')
    joined = []
    original = {(r['scenario'], r['bar_start_utc']): r for r in source['joined']}
    for query in source['queries']:
        key = (query['scenario'], query['barStartUtc'])
        for delay in DELAYS:
            context = index[(key[0], key[1], delay)]
            if context['iexDecisionAtUtc'] != query['decisionAtUtc'] or context['fold'] != query['fold']:
                raise ValueError('Instante de decisión o fold desalineado.')
            prior = original.get(key)
            joined.append({'scenario': key[0], 'fold': query['fold'], 'session': query['barStartUtc'][:10],
                           'bar_start_utc': key[1], 'delay': delay, 'context': context,
                           'label': prior['label'] if prior else None,
                           'probability': prior['probability'] if prior else None,
                           'predicted_label': CLASSES[int(np.argmax(prior['probability']))] if prior else None,
                           'evaluable': prior is not None})
    return joined


def predicted_label(row):
    return row.get('predicted_label') or CLASSES[int(np.argmax(row['probability']))]


def condition_groups(row):
    """Fixed descriptive strata, defined before reading labels or probabilities."""
    c = row['context']
    if c['reason'] == 'SOURCE_OUT_OF_RANGE':
        return ()
    frames = c['frames']
    groups = []
    if c['alignment'] != 'INSUFFICIENT_DATA':
        groups.append(f'alignment:{c["alignment"]}')
    for frame in ('15m', '1h', '1d'):
        value = frames[frame]
        for pair in ('shortPair', 'longPair'):
            if value[pair] != 'INSUFFICIENT_DATA':
                groups.append(f'{frame}:{pair}:{value[pair]}')
        for period in ('20', '40', '100', '200'):
            sma = value['sma'][period]
            if sma['value'] is None:
                continue
            if sma['slope'] != 'UNAVAILABLE':
                groups.append(f'{frame}:sma{period}:slope:{sma["slope"]}')
            if sma['priceAbove'] is not None and sma['priceBelow'] is not None:
                groups.append(f'{frame}:sma{period}:price:{"ABOVE" if sma["priceAbove"] else "BELOW" if sma["priceBelow"] else "EQUAL"}')
        if value['shortPair'] != 'INSUFFICIENT_DATA' and value['sma']['20']['slope'] != 'UNAVAILABLE':
            groups.append(f'{frame}:shortPairSlope:{value["shortPair"]}:{value["sma"]["20"]["slope"]}')
    day, hour, short = (frames[frame]['state'] for frame in ('1d', '1h', '15m'))
    if day == hour == short == 'BEARISH_ALIGNMENT':
        groups.append('regime:bear_continuation')
    if day == 'BULLISH_ALIGNMENT' and short == 'BEARISH_ALIGNMENT':
        if hour in ('BULLISH_ALIGNMENT', 'MIXED'):
            groups.append('regime:bull_trend_pullback')
        if hour == 'BEARISH_ALIGNMENT':
            groups.append('regime:bull_daily_bear_hour')
    for frame in ('15m', '1h', '1d'):
        for event in frames[frame]['events']:
            if event['period'] in (20, 40):
                groups.append(f'{frame}:event:{event["kind"]}:{event["direction"]}:{event["status"]}')
    for window in ('5', '20', '60'):
        if c['ranges'][window]['breakBelowLow'] is not None:
            groups.append(f'prior{window}:breakBelowLow:{c["ranges"][window]["breakBelowLow"]}')
    if c['previousSession']['breakBelowLow'] is not None:
        groups.append(f'previousSession:breakBelowLow:{c["previousSession"]["breakBelowLow"]}')
    return tuple(sorted(set(groups)))


def group_metrics(rows):
    rows = [r for r in rows if r['evaluable']]
    sessions = {r['session'] for r in rows}
    truth = Counter(r['label'] for r in rows)
    predictions = Counter(predicted_label(r) for r in rows)
    bears = [r for r in rows if r['label'] == 'BAJISTA']
    true_positive = sum(predicted_label(r) == 'BAJISTA' for r in bears)
    predicted_bear = predictions['BAJISTA']
    confusion = {label: sum(predicted_label(r) == label for r in bears)
                 for label in CLASSES}
    f1 = []
    for label in CLASSES:
        correct = sum(r['label'] == label and predicted_label(r) == label for r in rows)
        precision_denom = predictions[label]
        recall_denom = truth[label]
        precision = correct / precision_denom if precision_denom else 0.0
        recall = correct / recall_denom if recall_denom else 0.0
        f1.append(2 * precision * recall / (precision + recall) if precision + recall else 0.0)
    return {'observations': len(rows), 'sessions': len(sessions), 'true_classes': dict(truth),
            'predicted_classes': dict(predictions), 'true_bear': len(bears),
            'predicted_bear': predicted_bear, 'bear_recall': true_positive / len(bears) if bears else None,
            'bear_precision': true_positive / predicted_bear if predicted_bear else None,
            'bear_to_lateral': confusion['LATERAL'], 'bear_to_bull': confusion['ALCISTA'],
            'bear_to_bear': confusion['BAJISTA'],
            'mean_bear_probability': float(np.mean([r['probability'][1] for r in rows])) if rows else None,
            'macro_f1': float(np.mean(f1)) if rows else None,
            'status': 'INSUFFICIENT_EVIDENCE' if len(bears) < MIN_BEAR or len(sessions) < MIN_SESSIONS else 'EXPLORATORY_ASSOCIATION'}


def bootstrap_bear(rows, iterations=BOOTSTRAP, seed=SEED):
    metrics = group_metrics(rows)
    if metrics['status'] == 'INSUFFICIENT_EVIDENCE':
        return {'status': 'INSUFFICIENT_EVIDENCE'}
    by_session = defaultdict(lambda: [0, 0, 0])
    for row in rows:
        if not row['evaluable']:
            continue
        counts = by_session[row['session']]
        counts[0] += 1
        counts[1] += row['label'] == 'BAJISTA'
        counts[2] += row['label'] == 'BAJISTA' and predicted_label(row) == 'BAJISTA'
    sessions = sorted(by_session)
    counts = np.asarray([by_session[day] for day in sessions], dtype=np.int64)
    rng = np.random.default_rng(seed)
    recall, prevalence = [], []
    for _ in range(iterations):
        observations, bears, correct = counts[rng.integers(0, len(sessions), len(sessions))].sum(axis=0)
        if bears:
            recall.append(correct / bears)
        prevalence.append(bears / observations)
    return {'status': 'EXPLORATORY_ASSOCIATION', 'sessions': len(sessions),
            'iterations': iterations, 'seed': seed,
            'bear_recall_95pct': [float(x) for x in np.quantile(recall, [.025, .975])],
            'bear_prevalence_95pct': [float(x) for x in np.quantile(prevalence, [.025, .975])]}


def coverage(rows):
    output = {}
    for scenario in ('delayed', 'ideal'):
        output[scenario] = {}
        for delay in DELAYS:
            subset = [r for r in rows if r['scenario'] == scenario and r['delay'] == delay]
            reasons = Counter(r['context']['reason'] for r in subset)
            folds = {}
            for fold in sorted({r['fold'] for r in subset}):
                group = [r for r in subset if r['fold'] == fold]
                folds[str(fold)] = {'rows': len(group), 'reasons': dict(Counter(r['context']['reason'] for r in group)),
                                    'evaluable': sum(r['evaluable'] for r in group),
                                    'bear_evaluable': sum(r['label'] == 'BAJISTA' for r in group)}
            by_class = {}
            for label in CLASSES:
                group = [r for r in subset if r['label'] == label]
                by_class[label] = {'rows': len(group), 'reasons': dict(Counter(r['context']['reason'] for r in group))}
            retained = [r for r in subset if r['evaluable'] and r['context']['reason'] == 'TECHNICAL_CONTEXT_AVAILABLE']
            excluded = [r for r in subset if r['evaluable'] and r['context']['reason'] != 'TECHNICAL_CONTEXT_AVAILABLE']
            output[scenario][str(delay)] = {'rows': len(subset), 'evaluable': sum(r['evaluable'] for r in subset),
                'reasons': dict(reasons), 'by_fold': folds, 'by_true_class': by_class,
                'retained_true_classes': dict(Counter(r['label'] for r in retained)),
                'excluded_true_classes': dict(Counter(r['label'] for r in excluded)),
                'sma_available': {frame: {str(period): sum(r['context']['reason'] != 'SOURCE_OUT_OF_RANGE' and
                                          r['context']['frames'][frame]['sma'][str(period)]['value'] is not None for r in subset)
                                          for period in (20, 40, 100, 200)} for frame in ('15m', '1h', '1d')},
                'ranges_available': {window: sum(r['context']['reason'] != 'SOURCE_OUT_OF_RANGE' and
                                                r['context']['ranges'][str(window)]['status'] == 'AVAILABLE' for r in subset)
                                     for window in (5, 20, 60)},
                'three_frames_available': sum(r['context']['reason'] != 'SOURCE_OUT_OF_RANGE' and
                                              all(r['context']['frames'][frame]['state'] != 'INSUFFICIENT_DATA'
                                                  for frame in ('15m', '1h', '1d')) for r in subset),
                'events_observed': {frame: dict(Counter(
                    f'{event["kind"]}:{event["status"]}'
                    for r in subset if r['context']['reason'] != 'SOURCE_OUT_OF_RANGE'
                    for event in r['context']['frames'][frame]['events']))
                    for frame in ('15m', '1h', '1d')},
                'current_bar_delay_not_met': sum(r['context']['currentBarDelayNotMet'] for r in subset)}
    return output


def audit(rows):
    result = {}
    for scenario in ('delayed', 'ideal'):
        result[scenario] = {}
        for delay in DELAYS:
            sample = [r for r in rows if r['scenario'] == scenario and r['delay'] == delay and r['evaluable']]
            available = [r for r in sample if r['context']['reason'] == 'TECHNICAL_CONTEXT_AVAILABLE']
            groups = defaultdict(list)
            for row in sample:
                for name in condition_groups(row):
                    groups[name].append(row)
            fold_reports = {}
            for fold in sorted({r['fold'] for r in sample}):
                group = [r for r in available if r['fold'] == fold]
                fold_reports[str(fold)] = {'overall': group_metrics(group),
                    'groups': {name: group_metrics([r for r in sample if r['fold'] == fold and name in condition_groups(r)])
                               for name in KEY_GROUPS}}
            ranked = {}
            for name, group in sorted(groups.items()):
                metrics = group_metrics(group)
                ranked[name] = metrics
            group_bootstrap = {name: bootstrap_bear(groups.get(name, [])) for name in KEY_GROUPS}
            distances = {}
            for period in (20, 40, 100, 200):
                for frame in ('15m', '1h', '1d'):
                    name = f'{frame}:sma{period}'
                    distances[name] = {}
                    for predicted in CLASSES:
                        values = [r['context']['frames'][frame]['sma'][str(period)]['distancePercent']
                                  for r in sample if r['context']['reason'] != 'SOURCE_OUT_OF_RANGE' and
                                  r['label'] == 'BAJISTA' and
                                  r['context']['frames'][frame]['sma'][str(period)]['value'] is not None and
                                  predicted_label(r) == predicted]
                        distances[name][predicted] = {'n': len(values),
                            'median_percent': float(np.median(values)) if values else None,
                            'p25_percent': float(np.quantile(values, .25)) if values else None,
                            'p75_percent': float(np.quantile(values, .75)) if values else None}
            support_distances = {}
            for window in ('5', '20', '60', 'previousSession'):
                def distance(row):
                    source = row['context']['previousSession'] if window == 'previousSession' else row['context']['ranges'][window]
                    return source['distanceToLowPercent']
                support_distances[window] = {}
                for predicted in CLASSES:
                    values = [distance(r) for r in sample if r['context']['reason'] != 'SOURCE_OUT_OF_RANGE' and
                              r['label'] == 'BAJISTA' and
                              predicted_label(r) == predicted and distance(r) is not None]
                    support_distances[window][predicted] = {'n': len(values),
                        'median_percent': float(np.median(values)) if values else None,
                        'p25_percent': float(np.quantile(values, .25)) if values else None,
                        'p75_percent': float(np.quantile(values, .75)) if values else None}
            result[scenario][str(delay)] = {'original_evaluable': group_metrics(sample),
                'comparable': group_metrics(available), 'comparable_bootstrap': bootstrap_bear(available),
                'groups': ranked, 'key_group_bootstrap': group_bootstrap,
                'by_fold': fold_reports, 'bear_distance_to_sma_by_original_prediction': distances,
                'bear_distance_to_prior_low_by_original_prediction': support_distances}
    return result


def markdown(report):
    lines = ['# Fase 41B · Errores BAJISTA y contexto técnico SIP', '',
             'Investigación retrospectiva descriptiva. Las predicciones y etiquetas IEX 38E se leen sin modificarlas. '
             'SIP split aporta contexto técnico calculado únicamente dentro de SIP; no se restan precios IEX raw y SMA SIP.', '',
             'Los retrasos SIP 15/20/30 minutos son hipótesis simuladas de disponibilidad histórica, no recepciones verificadas. '
             'El ajuste split es retrospectivo y no acredita qué información corporativa era conocida entonces.', '',
             '## Cobertura y confusión', '',
             '| Escenario | SIP + minutos | IEX evaluables | Contexto completo | BAJISTA analizable | BAJISTA→LATERAL | Recall BAJISTA |',
             '|---|---:|---:|---:|---:|---:|---:|']
    for scenario in ('delayed', 'ideal'):
        for delay in DELAYS:
            cover = report['coverage'][scenario][str(delay)]
            stats = report['audit'][scenario][str(delay)]['comparable']
            pct = f'{100*stats["bear_recall"]:.2f} %' if stats['bear_recall'] is not None else 'N/D'
            lines.append(f'| {scenario} | {delay} | {cover["evaluable"]} | {stats["observations"]} | '
                         f'{stats["true_bear"]} | {stats["bear_to_lateral"]} | {pct} |')
    lines += ['', '## Condiciones previas, escenario delayed y SIP +15 minutos', '',
              '| Condición | Observaciones | BAJISTA reales | BAJISTA→LATERAL | Recall | Estado |',
              '|---|---:|---:|---:|---:|---|']
    groups = report['audit']['delayed']['15']['groups']
    for name in KEY_GROUPS:
        item = groups.get(name)
        if item is None:
            lines.append(f'| {name} | 0 | 0 | 0 | N/D | INSUFFICIENT_EVIDENCE |')
            continue
        pct = f'{100*item["bear_recall"]:.2f} %' if item['bear_recall'] is not None else 'N/D'
        lines.append(f'| {name} | {item["observations"]} | {item["true_bear"]} | {item["bear_to_lateral"]} | {pct} | {item["status"]} |')
    lines += ['', 'Los intervalos del JSON remuestrean sesiones NYSE completas. No capturan necesariamente dependencia entre jornadas '
              'ni cambios de régimen prolongados. Se inspeccionan numerosos grupos: cualquier asociación puede ser fruto de comparaciones múltiples.',
              'Una mayor prevalencia BAJISTA en un grupo no demuestra capacidad predictiva ni mejora de XGBoost.', '',
              '## Integridad y límites', '',
              f'- Período SIP: {report["source"]["firstBarStartUtc"]} a {report["source"]["lastBarEndUtc"]}.',
              f'- Deriva de hashes de código original 38E: {len(report["source_integrity"]["code_snapshot_drift"])} archivos; los artefactos originales se validaron por SHA-256.',
              '- Reporte completo: `report.json`; auditoría de cobertura: `coverage-audit.json`; grupos y folds: `bear-regime-audit.json`.',
              '- No se entrenó ningún modelo ni se modificaron predicciones, etiquetas, ledgers o estrategias.', '']
    return '\n'.join(lines)


def write_report(sip_csv, history, run, out, *, node='node', contexts_from=None):
    out = safe_output(out)
    sip_csv, history, run = (Path(p).resolve() for p in (sip_csv, history, run))
    source = verified_inputs(history, run)
    out.mkdir(parents=True, exist_ok=False)
    queries_path = out / 'queries.json'
    queries_path.write_text(json.dumps(source['queries'], separators=(',', ':')) + '\n', encoding='utf8')
    if contexts_from is None:
        contexts = run_bridge(sip_csv, queries_path, out / 'contexts.json', node=node)
    else:
        prior_contexts = Path(contexts_from).resolve()
        if prior_contexts == out / 'contexts.json':
            raise ValueError('El origen de contextos debe ser distinto de la salida nueva.')
        shutil.copyfile(prior_contexts, out / 'contexts.json')
        contexts = json.loads((out / 'contexts.json').read_text(encoding='utf8'))
        if contexts.get('schema') != 'phase41b-context-v1':
            raise ValueError('Contextos SIP incompatibles.')
    verify_context_source(contexts, sip_csv)
    joined = joined_contexts(source, contexts)
    covered = coverage(joined)
    analyzed = audit(joined)
    shared_period = {}
    for scenario in ('delayed', 'ideal'):
        shared = [r for r in joined if r['scenario'] == scenario and r['delay'] == 15 and
                  r['context']['reason'] != 'SOURCE_OUT_OF_RANGE']
        shared_period[scenario] = {
            'rows': len(shared),
            'first_bar_start_utc': min((r['bar_start_utc'] for r in shared), default=None),
            'last_bar_start_utc': max((r['bar_start_utc'] for r in shared), default=None),
            'first_iex_decision_utc': min((r['context']['iexDecisionAtUtc'] for r in shared), default=None),
            'last_iex_decision_utc': max((r['context']['iexDecisionAtUtc'] for r in shared), default=None)}
    integrity = {'run_sha256': source['run_hashes'], 'history_sha256': source['history_hashes'],
                 'code_snapshot_drift': source['code_drift'],
                 'sip_sha256': contexts['source']['hashes'],
                 'original_predictions_sha256': sha(run / 'predictions.csv'),
                 'original_observations_sha256': sha(run / 'observations.json')}
    report = {'schema': 'phase41b-v1', 'status': 'VERIFIED', 'source': contexts['source'],
              'source_integrity': integrity, 'coverage': covered, 'audit': analyzed,
              'shared_period': shared_period,
              'method': {'iex': '38E IEX raw frozen predictions and labels',
                         'sip': '41A SIP split within-feed technical features',
                         'availability': 'simulated, not historical reception',
                         'delays_minutes': list(DELAYS), 'min_bear': MIN_BEAR,
                         'min_sessions': MIN_SESSIONS, 'bootstrap_samples': BOOTSTRAP,
                         'bootstrap_seed': SEED, 'no_model_training': True,
                         'multiple_comparisons': 'Exploratory; no threshold or feature combination selected.'}}
    files = {'coverage-audit.json': covered, 'bear-regime-audit.json': analyzed,
             'report.json': report, 'report.md': markdown(report)}
    for name, value in files.items():
        text = value if isinstance(value, str) else json.dumps(value, indent=2, ensure_ascii=False)
        (out / name).write_text(text + '\n', encoding='utf8')
    manifest = {'schema': 'phase41b-manifest-v1', 'source': contexts['source'],
                'input_sha256': {'phase38e_manifest': sha(run / 'manifest.json'),
                                 'phase38e_predictions': sha(run / 'predictions.csv'),
                                 'phase38d_query': sha(history / 'query.json')},
                'code_sha256': {name: sha(ROOT / name) for name in (
                    'trading_poc_001_bollinger/src/phase41b-context.ts',
                    'trading_poc_001_bollinger/src/phase41b-context-cli.ts',
                    'trading_poc_001_bollinger/src/investep-technical-context.ts',
                    'trading_poc_001_bollinger/src/multitimeframe.ts',
                    'ml/phase41b/bear_audit.py')},
                'environment': {'python': platform.python_version(), 'numpy': np.__version__,
                                'node': subprocess.run([node, '--version'], capture_output=True, text=True, check=True).stdout.strip()},
                'artifacts': {name: sha(out / name) for name in ('queries.json', 'contexts.json', *files)}}
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n', encoding='utf8')
    (out / 'SHA256SUMS').write_text(''.join(f'{sha(out / name)}  {name}\n' for name in (*manifest['artifacts'], 'manifest.json')), encoding='utf8')
    return report


def main():
    parser = argparse.ArgumentParser(description='Auditoría BAJISTA retrospectiva con contexto SIP 41A')
    for name in ('sip-csv', 'history', 'run', 'out'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--node', default='node')
    parser.add_argument('--contexts-from', default=None,
                        help='Reutilizar un índice causal verificado de una ejecución privada anterior.')
    args = parser.parse_args()
    report = write_report(args.sip_csv, args.history, args.run, args.out,
                          node=args.node, contexts_from=args.contexts_from)
    print(json.dumps({'status': report['status'], 'output': str(args.out),
                      'delayed_15': report['coverage']['delayed']['15']['reasons']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
