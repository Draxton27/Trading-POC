"""Bind the verified IEX/38E inputs to immutable Phase 41D targets."""
import json
from pathlib import Path

from ml.phase40a.bear_audit import declared_hashes, sha
from ml.phase41c.sources import load_sources
from ml.phase41d.protocol import comparison_protocol
from ml.phase41d.registry import digest, validate_registry
from ml.phase41d.targets import TARGET_IDS, build_targets


def load_phase41e_sources(history, run, target_dir):
    source = load_sources(history, run)
    target_dir = Path(target_dir)
    checksums = declared_hashes(target_dir)
    required = {'target-labels.json', 'manifest.json', 'comparison-protocol.json',
                'target-registry.json', 'report.json'}
    if not required.issubset(checksums):
        raise ValueError('Artefactos 41D incompletos.')
    for name, expected in checksums.items():
        if not (target_dir / name).is_file() or sha(target_dir / name) != expected:
            raise ValueError('SHA-256 de 41D inválido.')
    manifest = json.loads((target_dir / 'manifest.json').read_text(encoding='utf8'))
    registry = json.loads((target_dir / 'target-registry.json').read_text(encoding='utf8'))
    protocol = json.loads((target_dir / 'comparison-protocol.json').read_text(encoding='utf8'))
    target_file = json.loads((target_dir / 'target-labels.json').read_text(encoding='utf8'))
    if (manifest.get('schema') != 'phase41d-manifest-v1' or
            target_file.get('schema') != 'phase41d-target-labels-v1' or
            manifest.get('input_hashes', {}).get('history') != source['history_hashes'] or
            manifest.get('input_hashes', {}).get('run') != source['run_hashes'] or
            digest(registry) != digest(validate_registry()) or
            manifest.get('target_registry_sha256') != digest(registry) or
            protocol.get('protocol') != comparison_protocol() or
            manifest.get('comparison_protocol_sha256') != digest(protocol['protocol'])):
        raise ValueError('Definiciones o fuentes 41D incompatibles.')
    original, auxiliary = build_targets(source)
    if target_file.get('targets') != original or target_file.get('first_barrier_diagnostic') != auxiliary:
        raise ValueError('Etiquetas 41D alteradas o desalineadas.')
    grouped = {}
    for row in original:
        key = (row['scenario'], row['bar_start_utc'])
        value = grouped.setdefault(key, {})
        if row['target_id'] in value:
            raise ValueError('Objetivo 41D duplicado.')
        value[row['target_id']] = row
    if any(tuple(values) != TARGET_IDS for values in grouped.values()) or len(grouped) != len(source['pairs']):
        raise ValueError('Cobertura de objetivos 41D incompleta.')
    source['targets'] = grouped
    source['target_hashes'] = checksums
    return source


def verified_contexts(path, sip_csv, queries):
    from ml.phase41e.feature_schema import F2_ADDED
    path, sip_csv = Path(path), Path(sip_csv)
    data = json.loads(path.read_text(encoding='utf8'))
    expected_inputs = {extension or 'csv': sha(Path(str(sip_csv) + extension))
                       for extension in ('', '.meta.json', '.calendar.json', '.provenance.json')}
    root = Path(__file__).resolve().parents[2]
    expected_code = {name: sha(root / name) for name in (
        'trading_poc_001_bollinger/src/phase41b-context.ts',
        'trading_poc_001_bollinger/src/phase41e-feature-context.ts',
        'trading_poc_001_bollinger/src/phase41e-feature-context-cli.ts',
        'trading_poc_001_bollinger/src/investep-technical-context.ts',
        'trading_poc_001_bollinger/src/multitimeframe.ts')}
    if (data.get('schema') != 'phase41e-sip-context-v1' or
            data.get('source', {}).get('hashes') != expected_inputs or
            data['source'].get('codeSha256') != expected_code or
            data['source'].get('availability') != 'SIMULATED_HISTORICAL_DELAY'):
        raise ValueError('Contexto SIP o código incompatible.')
    index = {}
    for row in data['rows']:
        key = (row['scenario'], row['barStartUtc'], row['delayMinutes'])
        if key in index or row['delayMinutes'] not in (15, 20, 30) or list(row['features']) != list(F2_ADDED):
            raise ValueError('Contextos SIP duplicados o columnas alteradas.')
        if row['audit']['assumedAvailableAtUtc'] is not None and row['audit']['assumedAvailableAtUtc'] > row['decisionAtUtc']:
            raise ValueError('Vela SIP posterior a la decisión.')
        for frame in ('1h', '1d'):
            at = row['audit']['frameAvailability'][frame]
            if at is not None and at > row['decisionAtUtc']:
                raise ValueError('Agregado SIP posterior a la decisión.')
        index[key] = row
    if set(index) != {(q['scenario'], q['barStartUtc'], delay)
                     for q in queries for delay in (15, 20, 30)}:
        raise ValueError('Cobertura SIP incompleta o adicional.')
    return index, {'sip_input_sha256': expected_inputs, 'bridge_code_sha256': expected_code,
                   'context_sha256': sha(path)}
