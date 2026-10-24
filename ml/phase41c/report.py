"""Versioned private artifacts for the Phase 41C read-only audit."""
import argparse
import hashlib
import json
import platform
from pathlib import Path

import numpy as np

from ml.phase40a.bear_audit import sha
from ml.phase41c.target_audit import run_audit

ROOT = Path(__file__).resolve().parents[2]


def private_new_directory(path):
    target = Path(path).resolve()
    root = (ROOT / 'private').resolve()
    if target == root or not target.is_relative_to(root) or target.exists():
        raise ValueError('La salida debe ser un directorio privado nuevo.')
    return target


def markdown(report):
    delayed = report['bear_confusion_audit']['delayed']
    groups = delayed['groups']
    lateral = groups['lateral_to_lateral']
    bears = groups['bear_to_lateral']
    correct = groups['bear_to_bear']
    bull = groups['bear_to_bull']
    actual_lateral = delayed['by_original_label']['LATERAL']
    actual_bear = delayed['by_original_label']['BAJISTA']
    sensitivity = report['target_sensitivity']['delayed']
    horizon = sensitivity['horizons']
    threshold = sensitivity['thresholds']
    fmt = lambda metric: f"{100*metric['fraction']:.2f} %" if metric.get('fraction') is not None else 'N/D'
    lines = [
        '# Fase 41C · Auditoría del objetivo BAJISTA y trayectorias IEX',
        '',
        'Investigación retrospectiva del subyacente NVDA. La etiqueta 38E es el cambio neto entre '
        'la apertura de entrada y el cierre de la cuarta vela, con límites estrictos ±0,5 ATR14(t). '
        'No equivale por sí sola a tendencia, ruptura técnica, continuación, oportunidad PUT o rentabilidad.',
        'La decisión delayed supone cierre +20 minutos; REST histórico no acredita recepción real en aquel instante.',
        '',
        '## Población delayed y trayectorias de cuatro velas',
        '',
        f"- Predicciones evaluables: {delayed['overall']['observations']}; sesiones: {delayed['overall']['sessions']}.",
        f"- BAJISTA→LATERAL: {bears['observations']}; BAJISTA→BAJISTA: {correct['observations']}; "
        f"BAJISTA→ALCISTA: {bull['observations']}.",
        f"- LATERAL originales: {actual_lateral['observations']}; caída intrahorizonte de al menos 0,5 ATR: "
        f"{round(actual_lateral['downward_touch']['fraction']*actual_lateral['observations']) if actual_lateral['observations'] else 0} "
        f"({fmt(actual_lateral['downward_touch'])}). Entre LATERAL→LATERAL: "
        f"{round(lateral['downward_touch']['fraction']*lateral['observations']) if lateral['observations'] else 0}"
        f"/{lateral['observations']}.",
        f"- BAJISTA reales con caída terminal sostenida (al menos tres cierres bajo entrada, "
        f"racha de al menos tres): {round(actual_bear['sustained_terminal_bear']['fraction']*actual_bear['observations'])}. "
        f"Con recuperación desde el mínimo de al menos 0,5 ATR: "
        f"{round(actual_bear['recovered_at_least_half_atr']['fraction']*actual_bear['observations'])}; "
        'ambas propiedades pueden coexistir.',
        f"- BAJISTA→LATERAL con toque bajista: {round(bears['downward_touch']['fraction']*bears['observations']) if bears['observations'] else 0}; "
        f"mediana de cierres bajo entrada: {bears['closes_below_entry']['median']}.",
        f"- BAJISTA→BAJISTA: mediana de cierres bajo entrada {correct['closes_below_entry']['median']}; "
        f"mediana de recuperación desde mínimo {correct['recovery_from_low_atr']['median']} ATR.",
        f"- BAJISTA→ALCISTA: {bull['observations']}; toque de ambas barreras "
        f"{round(bull['both_barriers_touched']['fraction']*bull['observations']) if bull['observations'] else 0}; "
        f"toque alcista en vela anterior al bajista: "
        f"{round(bull['up_then_down_distinct_bars']['fraction']*bull['observations']) if bull['observations'] else 0}.",
        f"- Ambas barreras tocadas en la población delayed: "
        f"{round(delayed['overall']['both_barriers_touched']['fraction']*delayed['overall']['observations']) if delayed['overall']['observations'] else 0} "
        f"({fmt(delayed['overall']['both_barriers_touched'])}); el orden dentro de una vela se declara ambiguo.",
        '',
        '## Sensibilidad contrafactual',
        '',
        '| Umbral ATR | ALCISTA | BAJISTA | LATERAL | Etiquetas distintas de 0,5 ATR |',
        '|---:|---:|---:|---:|---:|',
    ]
    for limit, values in threshold.items():
        distribution = values['distribution']
        lines.append(f"| {limit} | {distribution.get('ALCISTA', 0)} | {distribution.get('BAJISTA', 0)} | "
                     f"{distribution.get('LATERAL', 0)} | {values['changed_from_original']} |")
    lines += ['', '| Horizonte | Cobertura propia | Población común | BAJISTA en población común |',
              '|---:|---:|---:|---:|']
    for size, values in horizon.items():
        lines.append(f"| {size} velas | {values['own_coverage']} | {values['common_coverage']} | "
                     f"{values['common_distribution_0_5_atr'].get('BAJISTA', 0)} |")
    lines += ['', f"En la población común, {sensitivity['down_by_60_and_90_minutes']} permanecen BAJISTA "
              f"a 60 y 90 minutos y {sensitivity['down_by_60_recovered_by_90_minutes']} dejan de serlo a 90 minutos.",
              'Las diferencias de cobertura cerca del cierre no son evidencia de un cambio de comportamiento del precio.',
              '',
              'Los folds y semanas/meses están separados en report.json. El bootstrap remuestrea sesiones completas; '
              'no captura necesariamente dependencia entre jornadas o cambios de régimen. Las observaciones comparten '
              'velas futuras y el histórico fue examinado previamente. Las diferencias entre grupos son exploratorias.',
              'Los objetivos alternativos no evaluaron un modelo entrenado para ellos. Harían falta una definición '
              'preespecificada ligada a la metodología Investep, datos nuevos, recepción verificable y una evaluación '
              'temporal independiente. No hay datos históricos de primas, spreads ni fills de opciones.', '']
    return '\n'.join(lines)


def write_artifacts(result, out):
    out = private_new_directory(out)
    source = result['source']
    source_info = {'history_sha256': source['history_hashes'], 'run_sha256': source['run_hashes'],
                   'code_snapshot_drift': source['code_snapshot_drift'],
                   'history_query': source['query']}
    report = {'schema': 'phase41c-v1', 'status': 'EXPLORATORY',
              'source_integrity': source_info, 'coverage': result['coverage'],
              'bear_confusion_audit': result['trajectories'],
              'target_sensitivity': result['sensitivity'],
              'limitations': ['IEX raw histórico sin timestamps de recepción verificables',
                              'etiquetas alternativas no son objetivos validados',
                              'trayectorias y etiquetas dependen de velas futuras',
                              'bootstrap por sesión no captura dependencia entre jornadas',
                              'sin precios de opciones ni fills']}
    manifest = {'schema': 'phase41c-manifest-v1', 'python_version': platform.python_version(),
                'numpy_version': np.__version__, 'input_sha256': source_info,
                'definitions': {'entry': 'original reference_entry_at_utc strictly after simulated decision',
                                'original_label': 'net change > 0.5 ATR: ALCISTA; < -0.5 ATR: BAJISTA; else LATERAL',
                                'downward_excursion_atr': '(entry_open - minimum_future_low) / original_ATR14',
                                'upward_excursion_atr': '(maximum_future_high - entry_open) / original_ATR14',
                                'flat_or_recovery': 'derived only after the outcome; never a predictor feature',
                                'barrier_touch': 'inclusive; terminal labels are strict',
                                'ambiguous_intrabar': 'opposing barriers touched in the same 15m candle; order unknown',
                                'horizons_bars': [2, 4, 6], 'thresholds_atr': [.25, .5, .75, 1.0],
                                'near_boundary_atr': .1},
                'prediction_model_changed': False, 'original_sources_modified': False}
    out.mkdir(parents=True, exist_ok=False)
    payloads = {
        'manifest.json': manifest, 'coverage.json': result['coverage'],
        'trajectory-audit.json': result['rows'],
        'target-sensitivity.json': result['sensitivity'],
        'bear-confusion-audit.json': result['trajectories'],
        'report.json': report,
    }
    checksums = []
    for name, data in payloads.items():
        text = json.dumps(data, ensure_ascii=False, indent=2) + '\n'
        (out / name).write_text(text, encoding='utf8', newline='\n')
        checksums.append(f"{hashlib.sha256(text.encode('utf8')).hexdigest()}  {name}")
    md = markdown(report)
    (out / 'report.md').write_text(md, encoding='utf8', newline='\n')
    checksums.append(f"{sha(out / 'report.md')}  report.md")
    (out / 'SHA256SUMS').write_text('\n'.join(checksums) + '\n', encoding='utf8', newline='\n')
    return report


def main():
    parser = argparse.ArgumentParser(description='Auditoría histórica IEX de objetivo BAJISTA, sin entrenamiento.')
    parser.add_argument('--history', required=True)
    parser.add_argument('--run', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    report = write_artifacts(run_audit(args.history, args.run), args.out)
    print(json.dumps({'status': report['status'], 'coverage': report['coverage']['delayed']['4']},
                     ensure_ascii=False))


if __name__ == '__main__':
    main()
