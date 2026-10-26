"""Read-only prospective cohort report; never runs inference or a collector."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
from sklearn.metrics import average_precision_score, roc_auc_score

from ml.phase28.train import CLASSES, metrics
from ml.phase38f.prospective_report import read_ledger as read_observations

EXPECTED_MODEL = 'b9bbece648544b39e1e4c4946933e4f4de2d65ec5094997938b25791cb1bb684'
NY = ZoneInfo('America/New_York')


def digest(data):
    return hashlib.sha256(data if isinstance(data, bytes) else data.encode('utf8')).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def utc(value):
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None or parsed.utcoffset() != timedelta(0):
        raise ValueError('Timestamp UTC inválido.')
    return parsed


def files_manifest(directory):
    lines = (directory / 'SHA256SUMS').read_text(encoding='utf8').splitlines()
    found = {}
    for line in lines:
        try:
            hash_value, name = line.split('  ', 1)
        except ValueError as error:
            raise ValueError('Manifiesto SHA inválido.') from error
        if '/' in name or '\\' in name or name in found or len(hash_value) != 64:
            raise ValueError('Manifiesto SHA inválido.')
        if digest((directory / name).read_bytes()) != hash_value:
            raise ValueError('Artefacto privado alterado.')
        found[name] = hash_value
    return found


def load_activation(directory, model_dir, observation_rows):
    directory, model_dir = Path(directory), Path(model_dir)
    manifest = files_manifest(directory)
    if not {'protocol.json', 'activation.json', 'source-integrity.json'} <= manifest.keys():
        raise ValueError('Ancla 41I incompleta.')
    protocol_bytes = (directory / 'protocol.json').read_bytes()
    protocol, activation = json.loads(protocol_bytes), json.loads((directory / 'activation.json').read_bytes())
    source = json.loads((directory / 'source-integrity.json').read_bytes())
    hashed = dict(activation)
    if activation.get('activationHash') != digest(canonical({k: v for k, v in hashed.items() if k != 'activationHash'})):
        raise ValueError('Ancla 41I alterada.')
    if (protocol.get('schema') != 'phase41i-prospective-protocol-v1' or
            activation.get('protocolSha256') != digest(protocol_bytes) or
            activation.get('modelSha256') != EXPECTED_MODEL or
            protocol.get('source_model_sha256') != EXPECTED_MODEL or
            protocol.get('prospective_start_at_utc') != activation.get('activatedAtUtc') or
            protocol.get('prediction_policy', {}).get('classification') != 'argmax' or
            protocol.get('classes') != list(CLASSES) or
            protocol.get('source_policy', {}).get('feed') != 'iex'):
        raise ValueError('Protocolo 41I incompatible.')
    if utc(protocol['model_frozen_at_utc']) >= utc(activation['activatedAtUtc']):
        raise ValueError('Modelo no congelado antes de activación.')
    if not isinstance(protocol.get('git_commit'), str) or len(protocol['git_commit']) != 40 or utc(protocol['created_at_utc']) > utc(activation['activatedAtUtc']):
        raise ValueError('Commit u hora de congelamiento del protocolo inválidos.')
    original = activation['priorObservationLedger']
    count = original['recordCount']
    if count < 0 or count > len(observation_rows) or (count == 0) != (original['state'] == 'ABSENT'):
        raise ValueError('Prefijo anterior a activación incompatible.')
    if (observation_rows[count-1]['recordHash'] if count else None) != original['tipHash']:
        raise ValueError('Prefijo anterior a activación alterado.')
    actual = {name: digest((model_dir / name).read_bytes()) for name in ('model.json', 'linear.json', 'freeze.json', 'SHA256SUMS')}
    frozen = json.loads((model_dir / 'freeze.json').read_bytes())
    expected = {'model.json': EXPECTED_MODEL, 'linear.json': frozen.get('linearSha256')}
    for name, hash_value in expected.items():
        if actual[name] != hash_value:
            raise ValueError('Modelo o regresión logística alterados.')
    lines = (model_dir / 'SHA256SUMS').read_text(encoding='utf8').splitlines()
    if {name: value for value, name in (line.split('  ', 1) for line in lines)} != {name: actual[name] for name in ('model.json', 'linear.json', 'freeze.json')}:
        raise ValueError('SHA256SUMS del modelo alterado.')
    if (frozen.get('modelSha256') != EXPECTED_MODEL or frozen.get('features') != protocol['feature_schema']['columns'] or
            frozen.get('classes') != list(CLASSES) or frozen.get('feed') != 'iex' or frozen.get('adjustment') != 'raw' or
            source.get('modelSha256') != EXPECTED_MODEL or source.get('linearSha256') != actual['linear.json'] or
            source.get('freezeSha256') != actual['freeze.json'] or source.get('manifestSha256') != actual['SHA256SUMS'] or
            protocol['model_frozen_at_utc'] != frozen.get('frozenAtUtc')):
        raise ValueError('Identidad de modelo 41I incompatible.')
    return protocol, activation, {'model_sha256': actual['model.json'], 'linear_sha256': actual['linear.json'],
                                  'freeze_sha256': actual['freeze.json'], 'protocol_sha256': digest(protocol_bytes),
                                  'activation_sha256': manifest['activation.json']}


def read_json_records(path, schema, hash_key):
    path = Path(path)
    if not path.exists():
        return []
    rows, previous = [], None
    for line in path.read_text(encoding='utf8').splitlines():
        row = json.loads(line)
        unsigned = {key: value for key, value in row.items() if key != hash_key}
        if row.get('schema') != schema or row.get('previousHash') != previous or digest(canonical(unsigned)) != row.get(hash_key):
            raise ValueError('Cadena IEX alterada.')
        previous = row[hash_key]
        rows.append(row)
    return rows


def read_eligibility(directory, activation):
    path = Path(directory) / 'eligibility-ledger'
    rows, previous, seen_ids = [], None, set()
    if not path.exists():
        return rows
    names = sorted(path.glob('[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9].json'))
    for index, name in enumerate(names, 1):
        if name.name != f'{index:08d}.json':
            raise ValueError('Secuencia de elegibilidad incompleta.')
        row = json.loads(name.read_bytes())
        unsigned = {key: value for key, value in row.items() if key != 'hash'}
        payload = row.get('payload', {})
        status = payload.get('eligibility_status')
        allowed = {'RECORDED','ALREADY_PRESENT','NO_LIVE_DATA','PREEXISTING_LIVE_DATA','STALE_LIVE_DATA',
                   'INDICATORS_INSUFFICIENT','HORIZON_INELIGIBLE','MODEL_TOO_RECENT','FEED_DISCONNECTED',
                   'CALENDAR_UNAVAILABLE','SOURCE_INVALID','INFERENCE_FAILED'}
        source_hash = payload.get('source_bar_sha256')
        expected_id = 'iex41i:' + digest(canonical({'protocol':activation['protocolSha256'], 'source':source_hash, 'status':status}))
        if (row.get('kind') != 'iex_eligibility' or row.get('sequence') != index or row.get('previousHash') != previous or
                digest(canonical(unsigned)) != row.get('hash') or row.get('id') != expected_id or row['id'] in seen_ids or
                status not in allowed or payload.get('eligibility_reason') != status or
                not isinstance(source_hash,str) or len(source_hash) != 64 or
                payload.get('protocol_sha256') != activation['protocolSha256'] or
                payload.get('model_sha256') != activation['modelSha256'] or
                utc(payload['candidate_bar_start_utc']) <= utc(activation['activatedAtUtc']) or
                utc(payload['first_received_at_utc']) <= utc(activation['activatedAtUtc']) or
                utc(payload['decision_at_utc']) < utc(payload['first_received_at_utc']) or
                (status == 'RECORDED' and not payload.get('prediction_id_if_recorded'))):
            raise ValueError('Auditoría de elegibilidad incompatible.')
        previous = row['hash']
        seen_ids.add(row['id'])
        rows.append(row)
    return rows


def first_quarters(live_rows):
    first = {}
    for row in live_rows:
        if row.get('kind') != 'quarter':
            continue
        bar = row.get('bar')
        if (not bar or row.get('status') != 'COMPLETE' or row.get('feed') != 'iex' or row.get('adjustment') != 'raw' or
                row.get('symbol') != 'NVDA' or row.get('revision') is None):
            raise ValueError('Vela IEX Live incompatible.')
        if utc(bar['endUtc'])-utc(bar['startUtc']) != timedelta(minutes=15) or utc(row['receivedAtUtc']) < utc(bar['endUtc']):
            raise ValueError('Duración o recepción de vela IEX inválida.')
        if bar['startUtc'] not in first and row['revision'] != 1:
            raise ValueError('Falta primera versión Live de una vela IEX.')
        first.setdefault(bar['startUtc'], row)
    return first


def eligible_pairs(protocol, activation, observation_rows, decisions, first, now):
    predictions = {row['id']: row for row in observation_rows if row['kind'] == 'PREDICTION'}
    evaluations = {row['predictionId']: row for row in observation_rows if row['kind'] == 'EVALUATION'}
    if len(predictions) != sum(row['kind'] == 'PREDICTION' for row in observation_rows) or len(evaluations) != sum(row['kind'] == 'EVALUATION' for row in observation_rows):
        raise ValueError('Predicción o evaluación duplicada.')
    if any(key not in predictions for key in evaluations):
        raise ValueError('Evaluación sin predicción.')
    cohort = {}
    for record in decisions:
        link = record['payload']
        if link['eligibility_status'] != 'RECORDED':
            continue
        prediction = predictions.get(link['prediction_id_if_recorded'])
        if not prediction or prediction['id'] in cohort:
            raise ValueError('Enlace de predicción 41I inválido.')
        bar = first.get(prediction['barStartUtc'])
        if (not bar or bar['recordHash'] != link['source_bar_sha256'] or
                prediction['recordHash'] != link['prediction_record_hash'] or
                prediction['modelSha256'] != activation['modelSha256'] or
                prediction['sourceBars'][-1]['recordHash'] != bar['recordHash'] or
                prediction['source'] != {'symbol':'NVDA','feed':'iex','adjustment':'raw','timeframe':'15m'} or
                utc(prediction['barStartUtc']) <= utc(activation['activatedAtUtc']) or
                utc(prediction['registeredAtUtc']) <= utc(activation['activatedAtUtc']) or
                utc(prediction['registeredAtUtc']) >= utc(prediction['outcomeAtUtc']) or
                utc(prediction['modelFrozenAtUtc']) >= utc(prediction['barStartUtc']) or
                utc(prediction['modelCutoffUtc']) >= utc(prediction['barStartUtc']) or
                utc(prediction['entryAtUtc']) <= utc(prediction['registeredAtUtc']) or
                utc(prediction['outcomeAtUtc'])-utc(prediction['entryAtUtc']) != timedelta(minutes=60) or
                prediction['policy'] != {'classification': 'argmax', 'abstention': None}):
            raise ValueError('Predicción 41I incompatible con primera versión Live.')
        features = prediction['features']
        if (features.get('spec') != protocol['feature_schema']['id'] or
                list(features['values']) != protocol['feature_schema']['columns'] or
                not all(isinstance(value,(int,float)) and math.isfinite(value) for value in features['values'].values()) or
                features['hash'] != digest(canonical({'spec':features['spec'], 'names':protocol['feature_schema']['columns'],
                                                      'values':features['values']}))):
            raise ValueError('Diez variables F0 o hash incompatibles.')
        for source in prediction['sourceBars']:
            if utc(source['receivedAtUtc']) > utc(prediction['registeredAtUtc']):
                raise ValueError('Variable de origen recibida después de la predicción.')
            if source['origin'] == 'LIVE' and (source['startUtc'] not in first or
                                                first[source['startUtc']]['recordHash'] != source['recordHash']):
                raise ValueError('Variable Live no usa primera versión verificada.')
            if source['origin'] not in ('LIVE','REST_WARMUP'):
                raise ValueError('Origen de variable IEX desconocido.')
        for name in ('xgboost', 'linear', 'frequency'):
            probabilities = prediction['probabilities'][name]
            if len(probabilities) != 3 or not all(math.isfinite(p) and 0 <= p <= 1 for p in probabilities) or abs(sum(probabilities)-1) > 1e-6:
                raise ValueError('Probabilidades IEX inválidas.')
        if prediction['dominantClass'] != CLASSES[int(np.argmax(prediction['probabilities']['xgboost']))]:
            raise ValueError('Clase dominante IEX incompatible con argmax.')
        cohort[prediction['id']] = prediction
    counts = Counter()
    paired = []
    for key, prediction in cohort.items():
        evaluation = evaluations.get(key)
        if evaluation is None:
            counts['PENDING' if now < utc(prediction['outcomeAtUtc']) + timedelta(minutes=30) else 'OVERDUE_UNEVALUATED'] += 1
            continue
        status = evaluation['status']
        counts[status] += 1
        if status != 'EVALUATED':
            if status not in ('MISSING_ENTRY', 'MISSING_OUTCOME'):
                raise ValueError('Estado de evaluación desconocido.')
            continue
        entry = first.get(prediction['entryAtUtc'])
        outcome_start = (utc(prediction['outcomeAtUtc'])-timedelta(minutes=15)).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        outcome = first.get(outcome_start)
        intermediate = [first.get((utc(prediction['entryAtUtc'])+timedelta(minutes=15*i)).isoformat(timespec='milliseconds').replace('+00:00', 'Z')) for i in range(4)]
        if (not entry or not outcome or any(x is None for x in intermediate) or
                evaluation['entrySourceHash'] != entry['recordHash'] or evaluation['outcomeSourceHash'] != outcome['recordHash'] or
                evaluation['entryOpen'] != entry['bar']['open'] or evaluation['outcomeClose'] != outcome['bar']['close'] or
                utc(evaluation['evaluatedAtUtc']) < utc(prediction['outcomeAtUtc'])+timedelta(minutes=30) or
                any(utc(x['receivedAtUtc']) > utc(evaluation['evaluatedAtUtc']) for x in intermediate) or
                not math.isfinite(prediction['atr14PriceUnits']) or prediction['atr14PriceUnits'] < 0):
            raise ValueError('Evaluación IEX no coincide con primeras versiones y ATR original.')
        change = evaluation['outcomeClose']-evaluation['entryOpen']
        threshold = .5*prediction['atr14PriceUnits']
        label = 'ALCISTA' if change > threshold else 'BAJISTA' if change < -threshold else 'LATERAL'
        if evaluation['label'] != label:
            raise ValueError('Etiqueta IEX no equivale al objetivo NET_MOVE original.')
        paired.append((prediction, evaluation))
    return cohort, paired, counts


def score_pairs(pairs):
    if not pairs:
        return None
    y = np.array([CLASSES.index(evaluation['label']) for _, evaluation in pairs], dtype=int)
    result = {}
    for name in ('xgboost', 'linear', 'frequency'):
        probabilities = np.array([prediction['probabilities'][name] for prediction, _ in pairs], dtype=float)
        score = metrics(y, probabilities)
        bear = (y == CLASSES.index('BAJISTA')).astype(int)
        score['bearish_prevalence'] = float(bear.mean())
        score['bearish_roc_auc'] = float(roc_auc_score(bear, probabilities[:, 1])) if 0 < bear.sum() < len(bear) else None
        score['bearish_average_precision'] = float(average_precision_score(bear, probabilities[:, 1])) if bear.sum() else None
        score['predicted_classes'] = dict(Counter(CLASSES[index] for index in probabilities.argmax(axis=1)))
        result[name] = score
    return result


def bootstrap_paired(pairs, minimum_sessions=20, iterations=400, seed=41):
    sessions = defaultdict(list)
    for index, (prediction, _) in enumerate(pairs):
        sessions[utc(prediction['barStartUtc']).astimezone(NY).date().isoformat()].append(index)
    if len(sessions) < minimum_sessions:
        return {'status': 'INSUFFICIENT_SESSIONS', 'sessions': len(sessions), 'intervals': None}
    groups = list(sessions.values())
    rng = np.random.default_rng(seed)
    values = {name: defaultdict(list) for name in ('linear', 'frequency')}
    for _ in range(iterations):
        indexes = np.concatenate([groups[int(i)] for i in rng.integers(0, len(groups), len(groups))])
        sampled = [pairs[int(i)] for i in indexes]
        scores = score_pairs(sampled)
        for name in values:
            for key in ('macro_f1', 'balanced_accuracy', 'log_loss', 'brier_multiclass'):
                values[name][key].append(scores['xgboost'][key]-scores[name][key])
            for key in ('precision', 'recall', 'f1'):
                values[name]['bearish_'+key].append(scores['xgboost']['per_class']['BAJISTA'][key]-scores[name]['per_class']['BAJISTA'][key])
    return {'status': 'DESCRIPTIVE_INTERVAL', 'sessions': len(sessions), 'iterations': iterations, 'seed': seed,
            'warning': 'Session bootstrap may miss between-day dependence and long regime changes.',
            'intervals': {name: {key: [float(np.quantile(samples,.025)), float(np.quantile(samples,.975))]
                                 for key, samples in values[name].items()} for name in values}}


def official_coverage(calendar, first, activation, now):
    since = utc(activation['activatedAtUtc'])
    expected, received, sessions, captured = 0, 0, 0, 0
    for session in calendar['sessions']:
        day = date.fromisoformat(session['date'])
        base = datetime(day.year, day.month, day.day, tzinfo=NY)
        starts = [base+timedelta(minutes=minute) for minute in range(session['open'],session['close'],15)]
        eligible = [bar for bar in starts if since < bar.astimezone(timezone.utc) and bar.astimezone(timezone.utc)+timedelta(minutes=15) <= now]
        if not eligible:
            continue
        sessions += 1
        present = 0
        for bar in eligible:
            expected += 1
            stamp = bar.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
            row = first.get(stamp)
            if row and utc(row['receivedAtUtc']) >= since:
                received += 1
                present += 1
        if present:
            captured += 1
    return {'scheduled_sessions': sessions, 'sessions_with_live_capture': captured, 'expected_complete_bars': expected,
            'received_complete_bars': received, 'complete_bar_coverage': received/expected if expected else None,
            'scope': 'official sessions and closed intervals after activation; missing capture is not zero trades'}


def reconcile_eligibility(decisions, first, cohort):
    """RECORDED is terminal for a verified first Live bar, even in older ledgers with later errors."""
    by_bar = defaultdict(list)
    for record in decisions:
        payload = record['payload']
        bar = first.get(payload['candidate_bar_start_utc'])
        if (bar is None or bar['recordHash'] != payload['source_bar_sha256'] or
                bar['bar']['endUtc'] != payload['candidate_bar_end_utc'] or
                bar['receivedAtUtc'] != payload['first_received_at_utc']):
            raise ValueError('Decisión de elegibilidad sin primera vela IEX verificable.')
        by_bar[(payload['candidate_bar_start_utc'], payload['source_bar_sha256'])].append(payload)
    admitted, recovered_attempts, abstentions = 0, 0, Counter()
    linked_ids = set()
    for attempts in by_bar.values():
        successes = [index for index, payload in enumerate(attempts) if payload['eligibility_status'] == 'RECORDED']
        if successes:
            if len(successes) != 1:
                raise ValueError('Más de un éxito RECORDED para la misma vela.')
            success = attempts[successes[0]]
            prediction_id = success['prediction_id_if_recorded']
            if prediction_id not in cohort or prediction_id in linked_ids:
                raise ValueError('Admisión sin predicción enlazada uno a uno.')
            linked_ids.add(prediction_id)
            admitted += 1
            recovered_attempts += sum(payload['eligibility_status'] != 'RECORDED' for payload in attempts[:successes[0]])
        else:
            abstentions[attempts[-1]['eligibility_status']] += 1
    if admitted != len(cohort) or linked_ids != set(cohort):
        raise ValueError('Cobertura admitida y cohorte de predicciones no concuerdan.')
    return {'decision_records': len(decisions), 'candidate_bars_examined': len(by_bar),
            'admitted_bars': admitted, 'finally_not_admitted_bars': len(by_bar)-admitted,
            'failed_attempts_before_recovery': recovered_attempts,
            'abstentions_by_reason': dict(abstentions),
            'warning': 'Polling repetido no crea candidatas; fallos previos a RECORDED siguen en el ledger, sin degradar el éxito.'}


def build_report(protocol_dir, model_dir, observation_path, live_path, calendar_path, now=None):
    now = utc(now) if isinstance(now, str) else now or datetime.now(timezone.utc)
    observations = read_observations(observation_path)
    protocol, activation, integrity = load_activation(protocol_dir, model_dir, observations)
    decisions = read_eligibility(protocol_dir, activation)
    live = read_json_records(live_path, 'phase38-iex-v1', 'recordHash')
    if (utc(activation['activatedAtUtc']) > now or
            any(utc(row['receivedAtUtc']) > now for row in live) or
            any(utc(row['registeredAtUtc'] if row['kind']=='PREDICTION' else row['evaluatedAtUtc']) > now for row in observations) or
            any(utc(row['payload']['decision_at_utc']) > now for row in decisions)):
        raise ValueError('El reporte no puede utilizar registros posteriores a su reloj efectivo.')
    first = first_quarters(live)
    calendar = json.loads(Path(calendar_path).read_bytes())
    if calendar.get('provider') != 'Alpaca Market Calendar' or not isinstance(calendar.get('sessions'), list):
        raise ValueError('Calendario oficial IEX inválido.')
    cohort, paired, states = eligible_pairs(protocol, activation, observations, decisions, first, now)
    coverage = official_coverage(calendar, first, activation, now)
    eligibility = reconcile_eligibility(decisions, first, cohort)
    predictions = {'cohort_count': len(cohort), 'preexisting_count': sum(row['kind']=='PREDICTION' for row in observations)-len(cohort),
                   'linked_prediction_ids': sorted(cohort), 'same_rows_for_models': True}
    evaluation = {'cohort_predictions': len(cohort), 'evaluated': len(paired), 'states': dict(states),
                  'label_id': protocol['evaluation_policy']['label_id'],
                  'label_equivalence': 'verified_against_original_stored_ATR_and_first_IEX_versions_for_evaluated_rows'}
    grouped_session, grouped_month = defaultdict(list), defaultdict(list)
    for pair in paired:
        session = utc(pair[0]['barStartUtc']).astimezone(NY).date().isoformat()
        grouped_session[session].append(pair)
        grouped_month[session[:7]].append(pair)
    scores = score_pairs(paired)
    by_session = {key: {'rows': len(value), 'metrics': score_pairs(value)} for key,value in sorted(grouped_session.items())}
    by_month = {key: {'rows': len(value), 'metrics': score_pairs(value)} for key,value in sorted(grouped_month.items())}
    actual = Counter(e['label'] for _,e in paired)
    gate = (len(grouped_session) >= protocol['minimum_reporting_requirements']['review_sessions'] and
            all(actual[label] >= protocol['minimum_reporting_requirements']['minimum_actual_per_class'] for label in CLASSES) and
            coverage['complete_bar_coverage'] is not None and
            coverage['complete_bar_coverage'] >= protocol['minimum_reporting_requirements']['minimum_complete_bar_coverage'])
    status = ('NO_PROSPECTIVE_DATA' if not cohort and not decisions else
              'COLLECTING' if not paired else
              'PROSPECTIVE_REVIEW_GATE_REACHED' if gate else
              'DESCRIPTIVE_PROSPECTIVE_RESULTS' if len(grouped_session) >= 5 else 'INSUFFICIENT_EVIDENCE')
    bootstrap = bootstrap_paired(paired, protocol['minimum_reporting_requirements']['bootstrap_minimum_sessions'])
    report = {'schema': 'phase41i-prospective-report-v1', 'generated_at_utc': now.isoformat(timespec='milliseconds').replace('+00:00','Z'),
              'status': status, 'activation_at_utc': activation['activatedAtUtc'], 'protocol_sha256': activation['protocolSha256'],
              'model_sha256': EXPECTED_MODEL, 'prior_ledger_tip_hash': activation['priorObservationLedger']['tipHash'],
              'original_ledger_record_count_at_activation': activation['priorObservationLedger']['recordCount'],
              'source_integrity': integrity, 'market_coverage': coverage, 'eligibility_coverage': eligibility,
              'predictions_coverage': predictions, 'evaluation_coverage': evaluation,
              'metrics': scores, 'uncertainty': bootstrap,
              'bearish_analysis': {'actual_bajista': actual['BAJISTA'],
                                   'reference_prevalence': scores['xgboost']['bearish_prevalence'] if scores else None,
                                   'xgboost': {key:scores['xgboost'][key] for key in ('bearish_roc_auc','bearish_average_precision')} if scores else None},
              'review_gate': {'reached': gate, 'actual_class_counts': dict(actual), 'minimums': protocol['minimum_reporting_requirements']},
              'warning': 'Investigación prospectiva experimental. Sin órdenes, señales CALL/PUT ni evidencia de rentabilidad.'}
    return report, by_session, by_month


def publish(report, by_session, by_month, out_dir):
    out_dir = Path(out_dir)
    if out_dir.exists():
        raise ValueError('El directorio de reporte ya existe; no se sobrescribe.')
    staged = out_dir.with_name(out_dir.name + f'.tmp-{os.getpid()}')
    staged.mkdir(parents=True, exist_ok=False)
    try:
        documents = {
            'source-integrity.json': report['source_integrity'], 'eligibility-coverage.json': report['eligibility_coverage'],
            'predictions-coverage.json': report['predictions_coverage'], 'evaluation-coverage.json': report['evaluation_coverage'],
            'metrics.json': {'metrics':report['metrics'], 'uncertainty':report['uncertainty']},
            'metrics-by-session.json': by_session, 'metrics-by-month.json': by_month,
            'bearish-analysis.json': report['bearish_analysis'], 'report.json': report,
        }
        for name, value in documents.items():
            (staged / name).write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)+'\n',encoding='utf8')
        lines = ['# Fase 41I: evaluación prospectiva IEX', '', f"Estado: **{report['status']}**",
                 f"Activación: {report['activation_at_utc']}", f"SHA protocolo: `{report['protocol_sha256']}`", '',
                 '| Medida | Valor |', '|---|---:|',
                 f"| Sesiones programadas | {report['market_coverage']['scheduled_sessions']} |",
                 f"| Sesiones con captura Live | {report['market_coverage']['sessions_with_live_capture']} |",
                 f"| Velas completas recibidas / esperadas | {report['market_coverage']['received_complete_bars']} / {report['market_coverage']['expected_complete_bars']} |",
                 f"| Candidatas examinadas | {report['eligibility_coverage']['candidate_bars_examined']} |",
                 f"| Decisiones registradas | {report['eligibility_coverage']['decision_records']} |",
                 f"| Velas admitidas | {report['eligibility_coverage']['admitted_bars']} |",
                 f"| Velas finalmente no admitidas | {report['eligibility_coverage']['finally_not_admitted_bars']} |",
                 f"| Fallos anteriores a recuperaciones | {report['eligibility_coverage']['failed_attempts_before_recovery']} |",
                 f"| Predicciones nuevas enlazadas | {report['predictions_coverage']['cohort_count']} |",
                 f"| Evaluaciones completas | {report['evaluation_coverage']['evaluated']} |", '',
                 'Las probabilidades originales de XGBoost, logística y frecuencia se comparan solo en las mismas observaciones evaluadas.',
                 'El umbral de revisión no prueba potencia estadística, calibración ni utilidad operativa.',
                 'No hay predicciones ni métricas inventadas. Ninguna salida representa una recomendación CALL o PUT.', '']
        (staged/'report.md').write_text('\n'.join(lines),encoding='utf8')
        hashes = {path.name: digest(path.read_bytes()) for path in staged.iterdir() if path.is_file()}
        (staged/'manifest.json').write_text(json.dumps({'schema':'phase41i-report-manifest-v1','files':hashes},indent=2)+'\n',encoding='utf8')
        hashes['manifest.json'] = digest((staged/'manifest.json').read_bytes())
        (staged/'SHA256SUMS').write_text(''.join(f'{value}  {name}\n' for name,value in sorted(hashes.items())),encoding='utf8')
        staged.rename(out_dir)
    except BaseException:
        import shutil
        shutil.rmtree(staged, ignore_errors=True)
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--protocol-dir', required=True)
    parser.add_argument('--model-dir', required=True)
    parser.add_argument('--observations', required=True)
    parser.add_argument('--iex-ledger', required=True)
    parser.add_argument('--calendar', required=True)
    parser.add_argument('--out-dir')
    args = parser.parse_args()
    report, sessions, months = build_report(args.protocol_dir,args.model_dir,args.observations,args.iex_ledger,args.calendar)
    if args.out_dir:
        publish(report,sessions,months,args.out_dir)
    print(json.dumps({'status':report['status'],'predictions':report['predictions_coverage']['cohort_count'],
                      'evaluated':report['evaluation_coverage']['evaluated'], 'protocolSha256':report['protocol_sha256']}))


if __name__ == '__main__':
    main()
