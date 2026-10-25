"""Verify frozen inputs and reconstruct the original external fold boundaries."""
from __future__ import annotations

import json
from pathlib import Path

from ml.phase40a.bear_audit import declared_hashes, sha
from ml.phase40b.dataset import reconstruct
from ml.phase41d.registry import digest
from ml.phase41d.protocol import comparison_protocol
from ml.phase41e.feature_schema import schema_sha256
from ml.phase41e.sources import load_phase41e_sources

SCHEMA_SHA = 'f345656000b9e6970017be1bfb6cc7ca3a37b504b6e43f929cfa161e5b10bdfa'
PROTOCOL_SHA = '29d3aae08bcb834cf1b86ee2ac905755da3bbca5aeeea8d261b0cd423b1ea4e3'


def checked_directory(directory: Path, required: set[str]) -> dict[str, str]:
    hashes = declared_hashes(directory)
    if not required <= hashes.keys():
        raise ValueError(f'Artefactos incompletos en {directory.name}.')
    for name, expected in hashes.items():
        path = directory / name
        if not path.is_file() or sha(path) != expected:
            raise ValueError(f'Integridad SHA-256 incumplida: {directory.name}/{name}.')
    return hashes


def load_verified_inputs(history, run, targets, features):
    history, run, targets, features = map(Path, (history, run, targets, features))
    if schema_sha256() != SCHEMA_SHA or digest(comparison_protocol()) != PROTOCOL_SHA:
        raise ValueError('Esquema 41E o protocolo 41D distinto de la version congelada.')
    source = load_phase41e_sources(history, run, targets)
    checked_directory(history, {'calendar.json', 'strict-15m.csv', 'minutes.csv'})
    checked_directory(run, {'observations.json', 'predictions.csv', 'report.json'})
    checked_directory(targets, {'target-labels.json', 'comparison-protocol.json'})
    checksums = checked_directory(features, {'features.json', 'feature-schema.json', 'manifest.json'})
    manifest = json.loads((features / 'manifest.json').read_text(encoding='utf8'))
    if (manifest.get('schema') != 'phase41e-manifest-v1' or
            manifest.get('feature_schema_sha256') != SCHEMA_SHA or
            manifest.get('phase41d_protocol_sha256') != PROTOCOL_SHA or
            manifest.get('source_sha256', {}).get('iex_history') != source['history_hashes'] or
            manifest.get('source_sha256', {}).get('phase38e_run') != source['run_hashes'] or
            manifest.get('source_sha256', {}).get('phase41d_targets') != source['target_hashes']):
        raise ValueError('Manifiesto 41E incompatible con fuentes verificadas.')
    plan = reconstruct(run, loader=lambda _: (source['joined'], source['observations'],
                                                [pair[1] for pair in source['pairs']],
                                                source['report'], source['run_hashes'],
                                                source['code_snapshot_drift']))
    return source, plan, manifest, checksums
