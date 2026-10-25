"""Verify every Phase 41G input before a Phase 41H audit."""
from __future__ import annotations

import json
from pathlib import Path

from ml.phase41g.sources import load as load_bridge
from ml.phase41g.sources import sha

ROOT = Path(__file__).resolve().parents[2]
REQUIRED = (
    'manifest.json', 'protocol.json', 'source-41b.json', 'sma-visits.json',
    'visit-outcomes.json', 'trend-regimes.json', 'report.json', 'SHA256SUMS',
)


def verify_checksums(directory: Path) -> dict[str, str]:
    for name in REQUIRED:
        if not (directory / name).is_file():
            raise ValueError(f'Artefacto 41G ausente: {name}')
    entries: dict[str, str] = {}
    for line in (directory / 'SHA256SUMS').read_text(encoding='utf-8').splitlines():
        digest, separator, name = line.partition('  ')
        if not separator or len(digest) != 64 or not all(c in '0123456789abcdef' for c in digest):
            raise ValueError('SHA256SUMS 41G inválido')
        if name in entries or Path(name).name != name or name == 'SHA256SUMS':
            raise ValueError('SHA256SUMS 41G contiene nombres repetidos o inseguros')
        path = directory / name
        if not path.is_file() or sha(path) != digest:
            raise ValueError(f'Hash 41G incompatible: {name}')
        entries[name] = digest
    if any(name != 'SHA256SUMS' and name not in entries for name in REQUIRED):
        raise ValueError('SHA256SUMS 41G incompleto')
    return entries


def load_verified(directory: Path, csv: Path) -> dict:
    directory = directory.resolve()
    csv = csv.resolve()
    checksums = verify_checksums(directory)
    manifest = json.loads((directory / 'manifest.json').read_text(encoding='utf-8'))
    source_files = manifest['sourceFiles']
    if source_files['csv'] != sha(csv):
        raise ValueError('SHA-256 del CSV SIP incompatible con 41G')
    for suffix in ('.meta.json', '.calendar.json', '.provenance.json'):
        if sha(Path(str(csv) + suffix)) != source_files[suffix]:
            raise ValueError(f'Hash de procedencia SIP incompatible: {suffix}')
    if manifest['protocolSha256'] != sha(ROOT / 'ml/phase41g/protocol.json'):
        raise ValueError('Protocolo 41G incompatible')
    if json.loads((directory / 'protocol.json').read_text(encoding='utf-8')) != json.loads(
        (ROOT / 'ml/phase41g/protocol.json').read_text(encoding='utf-8')
    ):
        raise ValueError('Copia del protocolo 41G incompatible')
    for relative, digest in {**manifest['sourceBridgeCode'], **manifest['codeSha256']}.items():
        if sha(ROOT / relative.replace('\\', '/')) != digest:
            raise ValueError(f'Código de procedencia 41G incompatible: {relative}')
    source = load_bridge(directory / 'source-41b.json', source_files['csv'])
    if sha(directory / 'source-41b.json') != checksums['source-41b.json']:
        raise ValueError('Puente 41G incompatible')
    visits = json.loads((directory / 'sma-visits.json').read_text(encoding='utf-8'))
    outcomes = json.loads((directory / 'visit-outcomes.json').read_text(encoding='utf-8'))
    regimes = json.loads((directory / 'trend-regimes.json').read_text(encoding='utf-8'))
    report = json.loads((directory / 'report.json').read_text(encoding='utf-8'))
    if len(visits) != len(outcomes) or len({v['eventId'] for v in visits}) != len(visits):
        raise ValueError('Identificadores 41G ausentes o duplicados')
    outcome_index = {v['eventId']: v for v in outcomes}
    if len(outcome_index) != len(outcomes) or set(outcome_index) != {v['eventId'] for v in visits}:
        raise ValueError('Desenlaces 41G no alineados con visitas')
    for visit in visits:
        outcome = outcome_index[visit['eventId']]
        if any(outcome.get(key) != value for key, value in visit.items()):
            raise ValueError('Desenlace 41G no conserva su visita original')
        if set(outcome['outcomes']) != {'2', '4', '6'}:
            raise ValueError('Horizontes 41G incompatibles')
    if report['sourceSha256'] != source_files['csv'] or report['protocolSha256'] != manifest['protocolSha256']:
        raise ValueError('Reporte 41G incompatible con fuentes')
    return {'source': source, 'visits': visits, 'outcomes': outcomes, 'regimes': regimes,
            'manifest': manifest, 'checksums': checksums, 'report': report}
