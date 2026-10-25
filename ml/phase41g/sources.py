"""Validate the immutable 41A/41B bridge; no independent SMA implementation."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
from datetime import datetime, timedelta

FRAMES = ('15m', '1h', '1d')
PERIODS = (20, 40, 100, 200)


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path: Path, expected_sha: str) -> dict:
    document = json.loads(path.read_text(encoding='utf-8'))
    source = document['source']
    if document['schema'] != 'phase41g-sip-source-v1' or source['symbol'] != 'NVDA' or \
       source['feed'] != 'sip' or source['adjustment'] != 'split' or \
       source['timeframe'] != '15m' or source['delayMinutes'] != 20 or \
       source['availability'] != 'SIMULATED_HISTORICAL_DELAY' or \
       source['hashes']['csv'] != expected_sha:
        raise ValueError('Procedencia 41G incompatible')
    sessions = {s['date']: s for s in document['calendar']}
    if len(sessions) != len(document['calendar']):
        raise ValueError('Calendario duplicado')
    prior = {frame: '' for frame in FRAMES}
    for row in document['rows']:
        frame = row['timeframe']
        if frame not in FRAMES or row['startUtc'] <= prior[frame] or row['dateNy'] not in sessions:
            raise ValueError('Orden, marco o calendario inválido')
        prior[frame] = row['startUtc']
        if row['verified']:
            if not row['complete'] or row['continuousBars'] < 1 or row['sma'] is None or \
               datetime.fromisoformat(row['availableAtUtc'].replace('Z','+00:00')) != \
               datetime.fromisoformat(row['endUtc'].replace('Z','+00:00'))+timedelta(minutes=20):
                raise ValueError('Vela verificada inválida')
        if any(row[k] is None for k in ('open','high','low','close')) and row['verified']:
            raise ValueError('OHLC verificado incompleto')
    return document
