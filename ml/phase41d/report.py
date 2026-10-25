"""Versioned private artifacts for three predeclared Phase 41D targets."""
import argparse
import hashlib
import json
import platform
from datetime import datetime, timezone
from pathlib import Path

from ml.phase40a.bear_audit import declared_hashes, sha
from ml.phase41c.report import private_new_directory
from ml.phase41c.sources import load_sources
from ml.phase41d.coverage import summarize
from ml.phase41d.protocol import comparison_protocol
from ml.phase41d.registry import digest, validate_registry
from ml.phase41d.targets import TARGET_IDS, build_targets

ROOT = Path(__file__).resolve().parents[2]


def verify_reference(reference, source, rows, auxiliary):
    """41C is an independent parity check, never the source of new labels."""
    if reference is None:
        return {'status': 'NOT_CHECKED', 'observations': 0}
    reference = Path(reference)
    checksums = declared_hashes(reference)
    if not {'trajectory-audit.json', 'report.json', 'manifest.json'}.issubset(checksums):
        raise ValueError('Referencia 41C incompleta.')
    for name, expected in checksums.items():
        if not (reference / name).is_file() or sha(reference / name) != expected:
            raise ValueError('SHA-256 de referencia 41C inválido.')
    if (reference / 'trajectory-audit.json').stat().st_size > 200_000_000:
        raise ValueError('Referencia 41C demasiado grande.')
    report = json.loads((reference / 'report.json').read_text(encoding='utf8'))
    integrity = report.get('source_integrity', {})
    if (report.get('schema') != 'phase41c-v1' or
            integrity.get('history_sha256') != source['history_hashes'] or
            integrity.get('run_sha256') != source['run_hashes']):
        raise ValueError('Referencia 41C corresponde a otra fuente.')
    previous = json.loads((reference / 'trajectory-audit.json').read_text(encoding='utf8'))
    index = {(r['scenario'], r['bar_start_utc']): r for r in previous}
    targets = {(r['scenario'], r['bar_start_utc'], r['target_id']): r for r in rows}
    diagnostic = {(r['scenario'], r['bar_start_utc']): r for r in auxiliary}
    if len(index) != len(previous) or len(previous) * len(TARGET_IDS) != len(rows):
        raise ValueError('Cobertura 41C incompatible.')
    for key, old in index.items():
        a, b, c = (targets.get((*key, target_id)) for target_id in TARGET_IDS)
        if None in (a, b, c) or (a['fold'], a['session_date_ny'], a['decision_at_utc'],
                                    a['reference_entry_at_utc']) != (
                                        old['fold'], old['session'], old['available_at_utc'],
                                        old['reference_entry_at_utc']):
            raise ValueError('Identidad de trayectoria 41C incompatible.')
        path = old['paths'].get('4')
        if path is None:
            if (any(row['target_value'] is not None for row in (a, b, c)) or
                    a['availability_status'] != old['horizon_exclusions'].get('4') or key in diagnostic):
                raise ValueError('Exclusión 41C incompatible.')
            continue
        expected_persistent = (old['label'] == 'BAJISTA' and path['closes_below_entry'] >= 3
                               and path['max_consecutive_closes_below_entry'] >= 3)
        expected_values = (old['label'],
                           'DOWN_TOUCH' if path['first_downward_threshold_touch'] is not None else 'NO_DOWN_TOUCH',
                           'PERSISTENT_BEAR' if expected_persistent else 'NOT_PERSISTENT_BEAR')
        detail = diagnostic.get(key)
        if (tuple(row['target_value'] for row in (a, b, c)) != expected_values or
                a['target_known_at_utc'] != path['label_available_at_utc'] or
                a['reference_entry_open'] != path['entry_open'] or
                a['atr14_at_decision'] != path['original_atr14'] or detail is None or
                detail['first_down_bar'] != path['first_downward_threshold_touch'] or
                detail['first_up_bar'] != path['first_upward_threshold_touch'] or
                detail['any_same_bar_both_touched'] != path['any_same_bar_both_touched'] or
                detail['first_touch_order_ambiguous'] != path['first_touch_order_ambiguous']):
            raise ValueError('Objetivo o barrera no coincide con 41C.')
    if len(index) != len({(r['scenario'], r['bar_start_utc']) for r in rows}):
        raise ValueError('Filas 41D adicionales a 41C.')
    return {'status': 'EXACT', 'observations': len(index),
            'reference_trajectory_sha256': checksums['trajectory-audit.json'],
            'reference_report_sha256': checksums['report.json']}


def build_report(source, rows, auxiliary, parity):
    return {'schema': 'phase41d-report-v1', 'status': 'HISTORICAL_EXPLORED',
            'source': {'symbol': 'NVDA', 'feed': 'iex', 'adjustment': 'raw',
                       'timeframe': '15m', 'historical_received_at_utc': None,
                       'history_sha256': source['history_hashes'],
                       'run_sha256': source['run_hashes'],
                       'code_snapshot_drift': source['code_snapshot_drift']},
            'reference_parity': parity,
            'coverage': summarize(rows, auxiliary),
            'interpretation': ['Objetivos retrospectivos; ningún modelo entrenado en Fase 41D.',
                               'El toque intrahorizonte no implica fill, prima de opción ni beneficio.',
                               'La hora histórica conocida es teórica, sin recepción REST verificable.',
                               'Macro F1 entre objetivos de distinta clase no es comparable.']}


def markdown(report, registry_hash, protocol_hash):
    coverage = report['coverage']
    lines = [
        '# Fase 41D · Protocolo de objetivos IEX', '',
        'Investigación retrospectiva de NVDA IEX raw. Se reconstruyeron etiquetas desde las velas '
        'verificadas, sin entrenamiento ni inferencia nueva. El cierre es disponibilidad **teórica** '
        'del resultado; REST histórico no registra la recepción original.', '',
        f'Registro SHA-256: `{registry_hash}`. Protocolo SHA-256: `{protocol_hash}`.',
        f"Paridad 41C: {report['reference_parity']['status']} "
        f"({report['reference_parity']['observations']} observaciones).", '',
        '| Escenario | Objetivo | Disponibles | Sesiones | Distribución | Exclusiones |',
        '|---|---|---:|---:|---|---|',
    ]
    for scenario in ('delayed', 'ideal'):
        for target_id in TARGET_IDS:
            data = coverage[scenario][target_id]
            classes = ', '.join(f'{name}: {count}' for name, count in data['classes'].items())
            exclusions = ', '.join(f'{name}: {count}' for name, count in data['exclusions'].items())
            lines.append(f"| {scenario} | {target_id} | {data['available']} | "
                         f"{data['sessions_available']} | {classes} | {exclusions} |")
        barrier = coverage[scenario]['first_barrier_diagnostic']
        lines += ['', f"{scenario}: barreras por orden de primer toque: "
                  + ', '.join(f'{key}={value}' for key, value in barrier['classes'].items())
                  + f". Alguna vela bilateral={barrier['any_same_bar_both_touched']}; "
                  + f"primeros toques simultáneos={barrier['first_touch_order_ambiguous']}.", '']
    lines += ['El comparador NET conserva tres clases y el umbral terminal estricto; DOWN_TOUCH y '
              'PERSISTENT_BEAR son binarios. No se comparan sus Macro F1 directamente. '
              'Los resultados permanecen `HISTORICAL_EXPLORED` porque el período ya fue examinado.',
              'El plan de modelos, características F0/F1/F2, purga temporal y puerta prospectiva '
              'está en `comparison-protocol.json` y `docs/phase41d-target-protocol.md`.', '']
    return '\n'.join(lines)


def write_artifacts(source, rows, auxiliary, parity, out, *, now=None):
    out = private_new_directory(out)
    generated = (now or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
    registry = validate_registry()
    protocol = comparison_protocol()
    registry_hash, protocol_hash = digest(registry), digest(protocol)
    report = build_report(source, rows, auxiliary, parity)
    manifest = {'schema': 'phase41d-manifest-v1', 'created_at_utc': generated,
                'protocol_frozen_at_utc': generated, 'python_version': platform.python_version(),
                'input_hashes': {'history': source['history_hashes'], 'run': source['run_hashes'],
                                 'reference': parity.get('reference_trajectory_sha256')},
                'target_registry_sha256': registry_hash, 'comparison_protocol_sha256': protocol_hash,
                'code_sha256': {f'ml/phase41d/{p.name}': sha(p) for p in sorted((ROOT / 'ml/phase41d').glob('*.py'))
                                if p.name != '__init__.py'},
                'models_trained': False, 'original_labels_changed': False,
                'prospective_status': 'NOT_EVALUATED'}
    artifacts = {
        'manifest.json': manifest,
        'target-registry.json': registry,
        'target-labels.json': {'schema': 'phase41d-target-labels-v1',
                               'targets': rows, 'first_barrier_diagnostic': auxiliary},
        'coverage.json': report['coverage'],
        'comparison-protocol.json': {'protocol': protocol, 'protocol_sha256': protocol_hash,
                                     'frozen_at_utc': generated},
        'report.json': report,
    }
    out.mkdir(parents=True, exist_ok=False)
    checksums = []
    for name, payload in artifacts.items():
        data = json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
        (out / name).write_text(data, encoding='utf8', newline='\n')
        checksums.append(f'{sha(out / name)}  {name}')
    (out / 'report.md').write_text(markdown(report, registry_hash, protocol_hash), encoding='utf8', newline='\n')
    checksums.append(f"{sha(out / 'report.md')}  report.md")
    (out / 'SHA256SUMS').write_text('\n'.join(checksums) + '\n', encoding='utf8', newline='\n')
    return report


def main():
    parser = argparse.ArgumentParser(description='Objetivos experimentales 41D desde IEX raw verificado; sin entrenamiento.')
    parser.add_argument('--history', required=True)
    parser.add_argument('--run', required=True)
    parser.add_argument('--reference', help='Salida privada 41C v6 para paridad adicional')
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    out = private_new_directory(args.out)
    source = load_sources(args.history, args.run)
    rows, auxiliary = build_targets(source)
    parity = verify_reference(args.reference, source, rows, auxiliary)
    report = write_artifacts(source, rows, auxiliary, parity, out)
    print(json.dumps({'status': report['status'],
                      'delayed': {target: report['coverage']['delayed'][target]['available'] for target in TARGET_IDS},
                      'parity': parity['status']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
