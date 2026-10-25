"""Reproducible private artifacts for Phase 41E; never trains a model."""
import argparse
import json
import platform
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from ml.phase40a.bear_audit import sha
from ml.phase41c.report import private_new_directory
from ml.phase41d.protocol import comparison_protocol
from ml.phase41d.registry import digest
from ml.phase41e.coverage import summarize
from ml.phase41e.feature_join import bridge_queries, build_rows
from ml.phase41e.feature_schema import feature_schema, schema_sha256
from ml.phase41e.sources import load_phase41e_sources, verified_contexts

ROOT = Path(__file__).resolve().parents[2]


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode('utf8')


def context_bridge(sip_csv, queries, work, node='node'):
    query_path, context_path = work / 'queries.json', work / 'sip-context.json'
    query_path.write_bytes(json_bytes(queries))
    script = ROOT / 'trading_poc_001_bollinger' / 'src' / 'phase41e-feature-context-cli.ts'
    result = subprocess.run([node, '--import', 'tsx', str(script), '--sip-csv', str(sip_csv),
                             '--queries', str(query_path), '--out', str(context_path)],
                            cwd=ROOT, capture_output=True, text=True, timeout=3600, check=False)
    if result.returncode:
        raise RuntimeError('Puente TypeScript 41A/41B falló: ' + result.stderr[-1200:])
    return context_path


def build_report(rows, coverage, parity, source, sip_meta):
    return {'schema': 'phase41e-report-v1', 'status': 'HISTORICAL_EXPLORED',
            'source': {'symbol': 'NVDA', 'iex': 'raw 15m Alpaca historical',
                       'sip': 'split 15m Alpaca historical',
                       'availability': 'theoretical close and simulated SIP +15/+20/+30; no verified historic receipt'},
            'feature_columns': {'F0': 10, 'F1': 18, 'F2': 33},
            'feature_schema_sha256': schema_sha256(),
            'coverage': coverage, 'parity': parity,
            'limitations': ['Historical SIP split may contain later corporate-action adjustments.',
                            'No authentic historical SIP receipt timestamps; delays are assumptions.',
                            'IEX raw and SIP split prices are never divided against each other.',
                            'Already explored history is not independent prospective evidence.',
                            'No model was trained or promoted.']}


def markdown(report):
    groups = report['coverage']['by_group']
    lines = ['# Fase 41E · Velas y estructura Investep', '',
             'Investigación histórica NVDA IEX raw con contexto SIP split causalmente simulado. '
             'No se entrenó ningún modelo. Los retrasos SIP son supuestos, no horas de recepción verificadas.', '',
             f"Esquema SHA-256: `{report['feature_schema_sha256']}`. Columnas F0/F1/F2: 10/18/33.", '',
             '| Escenario · SIP | Observaciones | F0 | F1 | F2 |',
             '|---|---:|---:|---:|---:|']
    for key, value in groups['delay'].items():
        lines.append(f"| {key} | {value['observations']} | {value['F0']} | {value['F1']} | {value['F2']} |")
    lines += ['', '## Folds con retraso SIP principal de 20 minutos', '',
              '| Fold | Observaciones | F1 | F2 | SMA200 15m / 1h / 1d |',
              '|---|---:|---:|---:|---|']
    for key, value in groups['scenario_delay_fold'].items():
        if ':+20:' not in key:
            continue
        lines.append(f"| {key} | {value['observations']} | {value['F1']} | {value['F2']} | "
                     f"{value['sma200_15m']} / {value['sma200_1h']} / {value['sma200_1d']} |")
    lines += ['', 'La tabla por fold usa únicamente la demora principal SIP +20. '
              'Las clases y ausencias por columna están en '
              '`feature-coverage.json`. Los techos/pisos son contextos potenciales y eventos geométricos '
              'observados, no soportes/resistencias rentables comprobados.', '',
              'SIP split puede contener ajustes retrospectivos que no estaban disponibles entonces. '
              'La comparación no acredita recepción SIP histórica real. No se mezclan niveles SIP con IEX raw.', '']
    lines += ['', '## Distribucion causal de contexto (SIP +20)', '',
              'Las categorias de techo y piso se cuentan por separado; son descripciones, no resultados predictivos.', '']
    candidate_groups = report['coverage']['candidate_context_distributions']['scenario_delay']
    for key in ('delayed:+20', 'ideal:+20'):
        group = candidate_groups[key]
        ceiling, floor = group['ceiling'], group['floor']
        states = sorted(set(ceiling['counts']) | set(floor['counts']))
        lines += [f'### {key}', '', '| Estado | Techo n (%) | Piso n (%) |',
                  '|---|---:|---:|']
        for state in states:
            ceiling_count = ceiling['counts'].get(state, 0)
            floor_count = floor['counts'].get(state, 0)
            ceiling_fraction = ceiling['fractions'].get(state, 0) * 100
            floor_fraction = floor['fractions'].get(state, 0) * 100
            lines.append(f'| {state} | {ceiling_count} ({ceiling_fraction:.2f}%) | '
                         f'{floor_count} ({floor_fraction:.2f}%) |')
        lines.append('')
    return '\n'.join(lines)


def write_artifacts(out, source, rows, parity, sip_meta):
    out = private_new_directory(out)
    schema = feature_schema()
    coverage = summarize(rows)
    report = build_report(rows, coverage, parity, source, sip_meta)
    generated = datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
    manifest = {'schema': 'phase41e-manifest-v1', 'created_at_utc': generated,
                'source_sha256': {'iex_history': source['history_hashes'],
                                  'phase38e_run': source['run_hashes'],
                                  'phase41d_targets': source['target_hashes'],
                                  'sip': sip_meta['sip_input_sha256']},
                'phase41d_protocol_sha256': digest(comparison_protocol()),
                'feature_schema_sha256': schema_sha256(),
                'code_sha256': {**{f'ml/phase41e/{p.name}': sha(p) for p in sorted((ROOT/'ml/phase41e').glob('*.py'))
                                    if p.name not in ('__init__.py', 'test_features.py')},
                                **sip_meta['bridge_code_sha256']},
                'context_sha256': sip_meta['context_sha256'],
                'python_version': platform.python_version(),
                'node_version': subprocess.check_output(['node', '--version'], text=True).strip(),
                'simulated_sip_delay_minutes': [15, 20, 30],
                'models_trained': False, 'original_labels_changed': False,
                'data_class': 'HISTORICAL_EXPLORED'}
    payloads = {'manifest.json': manifest, 'feature-schema.json': schema,
                'feature-coverage.json': coverage, 'feature-parity.json': parity,
                'feature-audit.json': {'missing_by_column': coverage['missing_by_column'],
                                       'incomplete_by_sip_reason': coverage['f2_incomplete_by_sip_reason'],
                                       'availability_status_counts': coverage['feature_availability_status_counts'],
                                       'row_audit_location': 'features.json/context_audit'},
                'features.json': {'schema': 'phase41e-features-v1', 'rows': rows},
                'report.json': report}
    with tempfile.TemporaryDirectory(prefix='.phase41e-stage-', dir=out.parent) as temporary:
        stage = Path(temporary)
        checksums = []
        for name, payload in payloads.items():
            (stage/name).write_bytes(json_bytes(payload))
            checksums.append(f'{sha(stage/name)}  {name}')
        (stage/'report.md').write_text(markdown(report), encoding='utf8', newline='\n')
        checksums.append(f"{sha(stage/'report.md')}  report.md")
        (stage/'SHA256SUMS').write_text('\n'.join(checksums)+'\n', encoding='utf8', newline='\n')
        stage.rename(out)
    return report


def main():
    parser = argparse.ArgumentParser(description='Características históricas 41E; sin entrenamiento.')
    for name in ('history', 'run', 'targets', 'sip-csv', 'out'):
        parser.add_argument('--'+name, required=True)
    args = parser.parse_args()
    out = private_new_directory(args.out)
    source = load_phase41e_sources(args.history, args.run, args.targets)
    queries = bridge_queries(source)
    with tempfile.TemporaryDirectory(prefix='phase41e-', dir=ROOT/'private') as temporary:
        context_path = context_bridge(args.sip_csv, queries, Path(temporary))
        contexts, sip_meta = verified_contexts(context_path, args.sip_csv, queries)
        rows, parity = build_rows(source, contexts)
        report = write_artifacts(out, source, rows, parity, sip_meta)
    print(json.dumps({'status': report['status'], 'schema_sha256': schema_sha256(),
                      'coverage': report['coverage']['by_group']['delay']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
