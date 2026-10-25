"""Reproducible private audit of geometric SMA rejection and later outcomes."""
from __future__ import annotations

import argparse
import json
import subprocess
from collections import Counter, defaultdict
from pathlib import Path

from ml.phase41g.event_detection import detect
from ml.phase41g.outcomes import evaluate
from ml.phase41g.sources import sha
from .rejection_classification import (
    CONFIRMED, NO_INTERSECTION, UNAVAILABLE, join, transition,
)
from .sources import ROOT, load_verified
from .statistics import F, A, N, comparison, exclusions, summarize

PERIODS = (20, 40, 100, 200)
FRAMES = ('15m', '1h', '1d')
DIRECTIONS = ('BEARISH', 'BULLISH')
HORIZONS = (2, 4, 6)


def write(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n',
                    encoding='utf-8')


def _groups(rows: list[dict], key):
    grouped: dict[tuple, list[dict]] = defaultdict(list)
    for item in rows:
        grouped[key(item)].append(item)
    return grouped


def _transition_group(item: dict) -> str:
    if item['rejectionStatus'] == CONFIRMED:
        return CONFIRMED
    if item['rejectionStatus'] == NO_INTERSECTION:
        return NO_INTERSECTION
    if item['rejectionStatus'] == UNAVAILABLE:
        return UNAVAILABLE
    return 'GEOMETRIC_CONTACT_NO_REJECTION'


def _population(rows: list[dict], frame: str, direction: str, period: int) -> list[dict]:
    return [item for item in rows if item['timeframe'] == frame and
            item['regimeDirection'] == direction and item['smaPeriod'] == period]


def _summaries(rows: list[dict]) -> tuple[list[dict], list[dict], list[dict], list[dict]]:
    by_sma, by_year, by_regime, transitions = [], [], [], []
    for frame in FRAMES:
        for direction in DIRECTIONS:
            for period in PERIODS:
                sample = _population(rows, frame, direction, period)
                observed = [item for item in sample if not item['leftCensored']]
                for visit_group, subset in (
                    ('ALL', observed),
                    ('FIRST', [item for item in observed if item['isFirstVisit']]),
                    ('LATER', [item for item in observed if not item['isFirstVisit']]),
                    ('LEFT_CENSORED', [item for item in sample if item['leftCensored']]),
                ):
                    for rejection_group, picked in (
                        ('ALL', subset),
                        (CONFIRMED, [item for item in subset if item['rejectionStatus'] == CONFIRMED]),
                        ('GEOMETRIC_CONTACT_NO_REJECTION',
                         [item for item in subset if _transition_group(item) == 'GEOMETRIC_CONTACT_NO_REJECTION']),
                        (NO_INTERSECTION, [item for item in subset if item['rejectionStatus'] == NO_INTERSECTION]),
                    ):
                        # Intervals are computed only for the full observed population and
                        # for its rejection subset; smaller cross-tabs remain descriptive.
                        interval = visit_group == 'ALL' and rejection_group in ('ALL', CONFIRMED)
                        by_sma.append({'timeframe': frame, 'direction': direction,
                                       'smaPeriod': period, 'visitGroup': visit_group,
                                       'rejectionGroup': rejection_group,
                                       **summarize(picked, uncertainty=interval),
                                       'exclusions': exclusions(picked)})
                for year in range(2021, 2027):
                    annual = [item for item in observed if item['dateNy'].startswith(str(year))]
                    for rejection_group, picked in (
                        ('ALL', annual),
                        (CONFIRMED, [item for item in annual if item['rejectionStatus'] == CONFIRMED]),
                        ('NO_REJECTION', [item for item in annual if item['rejectionStatus'] not in
                                          (CONFIRMED, UNAVAILABLE)]),
                    ):
                        by_year.append({'timeframe': frame, 'direction': direction,
                                        'smaPeriod': period, 'year': year,
                                        'rejectionGroup': rejection_group, **summarize(picked)})
                for dimension, values in (
                    ('ageBin', ('0-3', '4-11', '12-25', '26-51', '52+')),
                    ('regimeOriginType', ('CHANGE', 'RESTART', 'LEFT_CENSORED')),
                    ('historyPeriod', ('EARLIER', 'OVERLAP_38E_41F')),
                ):
                    for value in values:
                        picked = [item for item in sample if (
                            ('OVERLAP_38E_41F' if '2024-06-10' <= item['dateNy'] < '2026-10-23'
                             else 'EARLIER') if dimension == 'historyPeriod' else item[dimension]) == value]
                        for rejection_group, group in (
                            ('ALL', picked),
                            (CONFIRMED, [item for item in picked if item['rejectionStatus'] == CONFIRMED]),
                            ('NO_REJECTION', [item for item in picked if item['rejectionStatus'] not in
                                              (CONFIRMED, UNAVAILABLE)]),
                        ):
                            by_regime.append({'timeframe': frame, 'direction': direction,
                                              'smaPeriod': period, 'dimension': dimension,
                                              'value': value, 'rejectionGroup': rejection_group,
                                              **summarize(group)})
                for horizon in HORIZONS:
                    for group in (CONFIRMED, 'GEOMETRIC_CONTACT_NO_REJECTION',
                                  NO_INTERSECTION, UNAVAILABLE):
                        picked = [item for item in observed if _transition_group(item) == group]
                        transitions.append({'timeframe': frame, 'direction': direction,
                                            'smaPeriod': period, 'horizonBars': horizon,
                                            'visitStatus': group,
                                            'transitions': dict(sorted(Counter(
                                                transition(item, horizon) for item in picked).items())),
                                            **summarize(picked, horizon)})
    return by_sma, by_year, by_regime, transitions


def _comparisons(rows: list[dict]) -> list[dict]:
    output = []
    for frame in FRAMES:
        for direction in DIRECTIONS:
            for period in PERIODS:
                observed = [item for item in _population(rows, frame, direction, period)
                            if not item['leftCensored']]
                sample = [item for item in observed if item['rejectionStatus'] != UNAVAILABLE]
                rejected = [item for item in sample if item['rejectionStatus'] == CONFIRMED]
                first = [item for item in sample if item['isFirstVisit']]
                later = [item for item in sample if not item['isFirstVisit']]
                definitions = (
                    ('A', [item for item in first if item in rejected],
                     [item for item in first if item not in rejected], False),
                    ('B', [item for item in later if item in rejected],
                     [item for item in later if item not in rejected], False),
                    ('C', [item for item in rejected if item['isFirstVisit']],
                     [item for item in rejected if not item['isFirstVisit']], False),
                    ('D', rejected,
                     [item for item in sample if item['trueGeometricContact'] and
                      item['rejectionStatus'] != CONFIRMED], False),
                    ('E', rejected, observed, True),
                )
                for code, left, right, overlap in definitions:
                    output.append({'timeframe': frame, 'direction': direction,
                                   'smaPeriod': period, **comparison(code, left, right, overlap)})
    return output


def build(data: dict) -> dict:
    source = data['source']
    detected = detect(source)
    if detected['visits'] != data['visits'] or detected['regimes'] != data['regimes']:
        raise ValueError('Paridad 41G de visitas/regímenes falló')
    recalculated = evaluate(data['visits'], source)
    if recalculated != data['outcomes']:
        raise ValueError('Paridad 41G de desenlaces falló')
    rows = join(data['visits'], data['outcomes'], source)
    if len(rows) != len(data['visits']) or [r['eventId'] for r in rows] != [
        v['eventId'] for v in data['visits']]:
        raise ValueError('Paridad 41G de identificadores falló')
    by_sma, by_year, by_regime, transitions = _summaries(rows)
    comparisons = _comparisons(rows)
    geometry = {
        'schema': 'phase41h-contact-audit-v1',
        'totalVisits': len(rows),
        'statuses': dict(sorted(Counter(item['rejectionStatus'] for item in rows).items())),
        'byFrame': {frame: dict(sorted(Counter(item['rejectionStatus'] for item in rows
                  if item['timeframe'] == frame).items())) for frame in FRAMES},
        'phase41aDisagreements': [
            {'eventId': item['eventId'], 'timeframe': item['timeframe'],
             'smaPeriod': item['smaPeriod'], 'direction': item['regimeDirection'],
             'status': item['rejectionStatus'], 'interactionsAtClose': item['interactionsAtClose']}
            for item in rows if item['geometry41aDisagreement']],
        'simultaneousVisitClusters': sum(n > 1 for n in Counter(
            item['clusterId'] for item in rows).values()),
    }
    priority = [item for item in by_sma if item['timeframe'] == '15m' and
                item['direction'] == 'BEARISH' and item['smaPeriod'] in (20, 40) and
                item['visitGroup'] in ('ALL', 'FIRST', 'LATER') and item['rejectionGroup'] in
                ('ALL', CONFIRMED, 'GEOMETRIC_CONTACT_NO_REJECTION', NO_INTERSECTION)]
    report = {'schema': 'phase41h-report-v1', 'status': 'HISTORICAL_EXPLORATORY',
              'phase41gParity': {'visits': len(rows), 'regimes': len(data['regimes']),
                                 'outcomes': len(data['outcomes']), 'exact': True},
              'sourceSha256': data['manifest']['sourceFiles']['csv'],
              'phase41gProtocolSha256': data['manifest']['protocolSha256'],
              'phase41gArtifactSha256': data['checksums']['report.json'],
              'phase41hProtocolSha256': sha(Path(__file__).with_name('protocol.json')),
              'contactAudit': geometry, 'priority15mBearish': priority,
              'comparisons': comparisons,
              'limitations': [
                  'Disponibilidad SIP histórica simulada, no recepción original verificable.',
                  'Una vela OHLC no revela el orden intrabar del contacto y del cierre.',
                  'Las visitas con y sin rechazo pueden diferir en volatilidad, hora y edad del régimen.',
                  'Las sesiones y los regímenes se cruzan; los IC agrupados son sensibilidades descriptivas.',
                  'La misma vela puede generar visitas a varias SMA; los resultados no son independientes.',
                  'El histórico ya fue examinado y no constituye evaluación temporal independiente.',
                  'Una tasa favorable no es rentabilidad ni prueba de capacidad predictiva.',
              ]}
    return {'rows': rows, 'geometry': geometry, 'bySma': by_sma, 'byYear': by_year,
            'byRegime': by_regime, 'transitions': transitions,
            'comparisons': comparisons, 'report': report}


def markdown(result: dict) -> str:
    report = result['report']
    audit = report['contactAudit']
    percent = lambda x: 'N/D' if x is None else f'{x:.1%}'
    lines = ['# Fase 41H: rechazo geométrico y continuación posterior',
             '', 'NVDA Alpaca SIP split; investigación histórica exploratoria.',
             'La visita y el desenlace proceden de 41G v2; la geometría se comprueba en la vela de visita.',
             'La disponibilidad histórica es cierre +20 minutos **simulado**, no recepción original.',
             '', '## Paridad e integridad', '',
             f"Visitas {report['phase41gParity']['visits']}; regímenes {report['phase41gParity']['regimes']}; " +
             f"desenlaces {report['phase41gParity']['outcomes']}. Paridad exacta de eventos y desenlaces: sí.",
             f"Protocolo 41H SHA-256: `{report['phase41hProtocolSha256']}`.",
             '', '## Contacto geométrico', '',
             f"Visitas totales: {audit['totalVisits']}; categorías: " +
             ', '.join(f'{key} {value}' for key, value in audit['statuses'].items()) + '.',
             f"Discrepancias con 41A: {len(audit['phase41aDisagreements'])}. " +
             f"Clústeres con varias SMA: {audit['simultaneousVisitClusters']}.",
             '', '## Prioridad: 15m bajista', '',
             '|SMA|Visita|Estado|Eventos|Contacto|Rechazos|Evaluables|Favorable|Adverso|Neutral|Evidencia|',
             '|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---|']
    for row in report['priority15mBearish']:
        lines.append(f"|{row['smaPeriod']}|{row['visitGroup']}|{row['rejectionGroup']}|" +
                     f"{row['events_total']}|{row['true_geometric_contacts']}|" +
                     f"{row['confirmed_rejections']}|{row['outcomes_evaluable']}|" +
                     f"{percent(row['favorableRate'])}|{percent(row['adverseRate'])}|" +
                     f"{percent(row['neutralRate'])}|{row['evidence']}|")
    lines += ['', '## Comparaciones A–E: 15m bajista', '',
              '|SMA|Comparación|Izquierda/Derecha evaluables|Diferencia favorable|IC sesión|IC régimen|Estado|',
              '|---:|---|---:|---:|---|---|---|']
    for item in report['comparisons']:
        if item['timeframe'] != '15m' or item['direction'] != 'BEARISH' or item['smaPeriod'] not in (20, 40):
            continue
        def ci(value):
            return 'N/D' if value is None else f'{value[0]:+.1%} a {value[1]:+.1%}'
        diff = item['difference']
        lines.append(f"|{item['smaPeriod']}|{item['comparison']}|" +
                     f"{item['leftEvaluable']}/{item['rightEvaluable']}|" +
                     f"{f'{diff:+.1%}' if diff is not None else 'N/D'}|" +
                     f"{ci(item['sessionSensitivity95'])}|{ci(item['regimeSensitivity95'])}|" +
                     f"{item['uncertaintyStatus']}|")
    lines += ['', '## Interpretación', '',
              'Un rechazo confirmado es un hecho geométrico y de cierre conocido solo cuando la vela y su demora están disponibles.',
              'La continuación favorable, adversa o neutral ocurre después de esa decisión y usa el horizonte original de 41G.',
              'Las comparaciones son asociaciones descriptivas; no demuestran capacidad predictiva ni una ejecución al tocar la SMA.',
              'Los intervalos por sesión y régimen son sensibilidades: la dependencia simultánea entre ambos tipos de clúster no queda completamente representada.',
              'Años, orígenes, edades de régimen, marcos secundarios, razones de exclusión y horizontes 2/6 figuran en JSON.',
              'CHANGE y RESTART casi se superponen en la máquina binaria y no ofrecen grupos independientes.',
              'Todo el histórico ya fue investigado; no se entrenaron modelos ni se generaron señales de opciones.', '']
    return '\n'.join(lines)


def run(csv: Path, phase41g: Path, out: Path) -> dict:
    protocol = Path(__file__).with_name('protocol.json')
    frozen_sha = '6c6324f9f29b66a231b6796c27d094fd1a5813c49ed023e54a57fa94a301969b'
    if sha(protocol) != frozen_sha:
        raise ValueError('El protocolo 41H congelado cambió')
    if out.exists() and any(out.iterdir()):
        raise ValueError('La salida privada ya existe; use un directorio nuevo')
    data = load_verified(phase41g, csv)
    result = build(data)
    out.mkdir(parents=True, exist_ok=True)
    write(out / 'protocol.json', json.loads(protocol.read_text(encoding='utf-8')))
    rows = result['rows']
    write(out / 'rejection-events.json', [{key: value for key, value in item.items()
          if key not in ('outcomes', 'atr14AtDecision', 'referenceEntryAtUtc', 'referenceEntryPrice')}
          for item in rows])
    write(out / 'geometric-contact-audit.json', result['geometry'])
    coverage = [{'timeframe': frame, 'direction': direction, 'smaPeriod': period,
                 **summarize(_population(rows, frame, direction, period)),
                 'exclusions': exclusions(_population(rows, frame, direction, period))}
                for frame in FRAMES for direction in DIRECTIONS for period in PERIODS]
    write(out / 'rejection-coverage.json', coverage)
    write(out / 'rejection-outcomes.json', [
        {'eventId': item['eventId'], 'clusterId': item['clusterId'],
         'rejectionStatus': item['rejectionStatus'], 'leftCensored': item['leftCensored'],
         'referenceEntryAtUtc': item['referenceEntryAtUtc'],
         'atr14AtDecision': item['atr14AtDecision'],
         'outcomes': item['outcomes'],
         'transition': {str(h): transition(item, h) for h in HORIZONS}}
        for item in rows])
    write(out / 'transition-matrix.json', result['transitions'])
    write(out / 'comparisons.json', result['comparisons'])
    write(out / 'statistics-by-sma.json', result['bySma'])
    write(out / 'statistics-by-year.json', result['byYear'])
    write(out / 'statistics-by-regime.json', result['byRegime'])
    write(out / 'uncertainty.json', {
        'mainRates': [{key: value for key, value in item.items() if
                       key in ('timeframe', 'direction', 'smaPeriod', 'visitGroup', 'rejectionGroup',
                               'rejectionRateSessionSensitivity95', 'rejectionRateRegimeSensitivity95',
                               'favorableRateSessionSensitivity95', 'favorableRateRegimeSensitivity95',
                               'uncertaintyInterpretation')}
                      for item in result['bySma'] if item['visitGroup'] == 'ALL' and
                      item['rejectionGroup'] in ('ALL', CONFIRMED)],
        'comparisons': result['comparisons'],
        'interpretation': 'SESSION_AND_REGIME_CLUSTER_SENSITIVITIES_NOT_INDEPENDENT_VALIDATION'})
    write(out / 'report.json', result['report'])
    (out / 'report.md').write_text(markdown(result), encoding='utf-8')
    code_files = sorted((ROOT / 'ml/phase41h').glob('*.py'))
    reused = [ROOT / 'ml/phase41g' / name for name in (
        'sources.py', 'event_detection.py', 'visit_episodes.py', 'trend_regimes.py',
        'outcomes.py', 'coverage.py')]
    code_files += reused
    git_commit = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, capture_output=True,
                                text=True, check=True).stdout.strip()
    status = subprocess.run(['git', 'status', '--porcelain', '--', 'ml/phase41h'],
                            cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    write(out / 'manifest.json', {
        'schema': 'phase41h-manifest-v1', 'privateArtifacts': True,
        'sourceFiles': data['manifest']['sourceFiles'],
        'phase41gArtifactSha256': data['checksums'],
        'phase41gProtocolSha256': data['manifest']['protocolSha256'],
        'phase41hProtocolSha256': frozen_sha,
        'pythonCodeSha256': {str(path.relative_to(ROOT)).replace('\\', '/'): sha(path)
                             for path in code_files},
        'typescriptCodeSha256': data['manifest']['sourceBridgeCode'],
        'gitCommitSha256': git_commit if not status else None,
        'gitCommitNote': 'Commit only when Phase 41H code/protocol are committed; file hashes identify exact code.',
        'sourceMode': 'HISTORICAL_SIMULATED_SIP_DELAY',
    })
    files = sorted(path for path in out.iterdir() if path.is_file() and path.name != 'SHA256SUMS')
    (out / 'SHA256SUMS').write_text(''.join(f'{sha(path)}  {path.name}\n' for path in files),
                                      encoding='utf-8')
    return result['report']


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--sip-csv', type=Path, required=True)
    parser.add_argument('--phase41g', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    report = run(args.sip_csv.resolve(), args.phase41g.resolve(), args.out.resolve())
    print(json.dumps({'phase41gParity': report['phase41gParity'],
                      'contactAudit': {key: report['contactAudit'][key]
                                       for key in ('totalVisits', 'statuses')}},
                     ensure_ascii=False))


if __name__ == '__main__':
    main()
