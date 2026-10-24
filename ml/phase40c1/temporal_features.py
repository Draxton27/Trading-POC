"""Seven close-only features on Phase 23's causally continuous calendar segments."""
from __future__ import annotations

import csv
import hashlib
import json
import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from ml.phase28.train import FEATURES as BASE_FEATURES
from ml.phase40a.bear_audit import declared_hashes, sha

TEMPORAL_FEATURES = (
    'return_2', 'return_8', 'lagged_return_1', 'lagged_return_2',
    'lagged_return_3', 'consecutive_down_bars', 'consecutive_up_bars',
)
EXTENDED_FEATURES = (*BASE_FEATURES, *TEMPORAL_FEATURES)
BAR = timedelta(minutes=15)
NY = ZoneInfo('America/New_York')
RETURN_TOLERANCE = 1e-12


@dataclass(frozen=True)
class Bar:
    start: datetime
    timestamp: str
    open: float
    high: float
    low: float
    close: float
    volume: int
    day: str
    minute: int


def utc(value):
    if not isinstance(value, str):
        raise ValueError('Timestamp IEX inválido.')
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError as exc:
        raise ValueError('Timestamp IEX inválido.') from exc
    if result.tzinfo is None or result.utcoffset() != timedelta(0):
        raise ValueError('Timestamp IEX debe estar en UTC.')
    return result.astimezone(timezone.utc)


def load_history(history, source_manifest):
    """Verify the entire 38D snapshot and its exact 38E declared source identity."""
    history = Path(history)
    declared = declared_hashes(history)
    required = {'query.json', 'calendar.json', 'calendar.json.sha256',
                'strict-15m.csv', 'report.json'}
    if not required.issubset(declared) or declared != source_manifest['source']['sha256']:
        raise ValueError('Histórico 38D distinto de la fuente declarada por 38E.')
    for name, digest in declared.items():
        if not (history / name).is_file() or sha(history / name) != digest:
            raise ValueError(f'Integridad 38D inválida: {name}.')
    query = json.loads((history / 'query.json').read_text(encoding='utf8'))
    report = json.loads((history / 'report.json').read_text(encoding='utf8'))
    if (query.get('schema') != 'phase38d-v1' or query.get('symbol') != 'NVDA' or
            query.get('feed') != 'iex' or query.get('adjustment') != 'raw' or
            query.get('timeframe') != '1Min' or report.get('schema') != 'phase38d-report-v1' or
            report.get('source') != query or
            report.get('sha256', {}).get('strict15mCsv') != declared['strict-15m.csv'] or
            report.get('sha256', {}).get('calendar') != declared['calendar.json'] or
            (history / 'calendar.json.sha256').read_text(encoding='utf8').strip() != declared['calendar.json']):
        raise ValueError('Procedencia IEX raw incompatible.')
    calendar_data = json.loads((history / 'calendar.json').read_text(encoding='utf8'))
    if calendar_data.get('provider') != 'Alpaca Market Calendar':
        raise ValueError('Calendario oficial inválido.')
    calendar = {}
    for entry in calendar_data.get('sessions', []):
        day, opening, closing = entry['date'], entry['open'], entry['close']
        if (not isinstance(day, str) or day in calendar or
                datetime.strptime(day, '%Y-%m-%d').date().isoformat() != day or
                not isinstance(opening, int) or not isinstance(closing, int) or
                opening < 0 or closing > 1440 or closing <= opening or
                (closing-opening) % 15):
            raise ValueError('Sesión de calendario inválida.')
        calendar[day] = (opening, closing)
    days = list(calendar)
    if not days or days != sorted(days):
        raise ValueError('Calendario desordenado o vacío.')
    start, end = utc(query['start']), utc(query['end'])
    bars = []
    with (history / 'strict-15m.csv').open(newline='', encoding='utf8') as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != ['timestamp', 'open', 'high', 'low', 'close', 'volume']:
            raise ValueError('Columnas IEX estrictas incompatibles.')
        for row in reader:
            timestamp = row['timestamp']
            instant = utc(timestamp)
            local = instant.astimezone(NY)
            day = local.date().isoformat()
            minute = local.hour * 60 + local.minute
            session = calendar.get(day)
            try:
                values = [float(row[name]) for name in ('open', 'high', 'low', 'close')]
                volume = int(row['volume'])
            except (TypeError, ValueError) as exc:
                raise ValueError('OHLCV IEX inválido.') from exc
            if (instant < start or instant + BAR > end or instant.second or instant.microsecond or
                    session is None or minute < session[0] or minute + 15 > session[1] or
                    (minute-session[0]) % 15 or
                    not all(math.isfinite(number) and number > 0 for number in values) or
                    values[1] < max(values[0], values[2], values[3]) or
                    values[2] > min(values[0], values[1], values[3]) or volume < 0 or
                    str(volume) != row['volume'] or
                    (bars and instant <= bars[-1].start)):
                raise ValueError('Vela IEX fuera de calendario, duplicada o inválida.')
            bars.append(Bar(instant, timestamp, *values, volume, day, minute))
    if not bars or len(bars) != report['summary']['strict15m']:
        raise ValueError('Cobertura 38D incompatible con reporte original.')
    return bars, calendar, declared, query


def continuous(previous, current, calendar, day_position):
    """Exactly Phase 23's intra-session and verified overnight boundary rule."""
    if previous.day == current.day:
        return current.start - previous.start == BAR
    old = calendar.get(previous.day)
    new = calendar.get(current.day)
    return (old is not None and new is not None and
            day_position.get(current.day) == day_position.get(previous.day, -2) + 1 and
            previous.minute + 15 == old[1] and current.minute == new[0])


def temporal_at(segment):
    """Compute only from a contiguous prefix ending at t; no future prices."""
    if len(segment) < 9:
        return None
    close = [bar.close for bar in segment]
    t = len(close) - 1
    down = up = 0
    for offset in range(8):
        change = close[t-offset] / close[t-offset-1] - 1
        if change < 0 and up == 0:
            down += 1
        elif change > 0 and down == 0:
            up += 1
        else:
            break
    result = {
        'return_2': close[t] / close[t-2] - 1,
        'return_8': close[t] / close[t-8] - 1,
        'lagged_return_1': close[t-1] / close[t-2] - 1,
        'lagged_return_2': close[t-2] / close[t-3] - 1,
        'lagged_return_3': close[t-3] / close[t-4] - 1,
        'consecutive_down_bars': down,
        'consecutive_up_bars': up,
    }
    if not all(math.isfinite(value) for value in result.values()):
        raise ValueError('Variable temporal no finita.')
    return result


def temporal_index(bars, calendar):
    """Index timestamp -> seven causal values, segment length and continuity audit."""
    positions = {day: index for index, day in enumerate(sorted(calendar))}
    result, reasons = {}, {}
    segment = []
    segments = 0
    for index, bar in enumerate(bars):
        if bar.day not in calendar:
            raise ValueError('Calendario oficial incompleto para vela IEX.')
        if not segment or not continuous(bars[index-1], bar, calendar, positions):
            segment = []
            segments += 1
        segment.append(bar)
        values = temporal_at(segment)
        if values is None:
            reasons[bar.timestamp] = 'CONTINUOUS_HISTORY_UNDER_9_BARS'
        else:
            result[bar.timestamp] = {'values': values, 'continuous_bars': len(segment)}
    return result, {'strict_bars': len(bars), 'continuous_segments': segments,
                    'eligible_bars': len(result), 'excluded_count': len(reasons),
                    'exclusions': reasons}


def extended_hash(base, temporal):
    if set(base) != set(BASE_FEATURES) or set(temporal) != set(TEMPORAL_FEATURES):
        raise ValueError('Orden o conjunto de variables incompatible.')
    values = [float(base[name]) for name in BASE_FEATURES] + [float(temporal[name]) for name in TEMPORAL_FEATURES]
    if not all(math.isfinite(value) for value in values):
        raise ValueError('Variable ampliada no finita.')
    text = json.dumps({'spec': 'phase40c1-temporal-v1', 'names': EXTENDED_FEATURES,
                       'values': values}, separators=(',', ':'), ensure_ascii=False)
    return hashlib.sha256(text.encode('utf8')).hexdigest()


def align_observations(observations, bars, temporal, *, tolerance=RETURN_TOLERANCE):
    """Preserve 38E base features, check its price returns, and fail on any lost row."""
    by_start = {bar.timestamp: index for index, bar in enumerate(bars)}
    result = {}
    missing = []
    for observation in observations:
        stamp = observation['bar_start_utc']
        index = by_start.get(stamp)
        if index is None or stamp not in temporal:
            missing.append({'scenario': observation['scenario'], 'bar_start_utc': stamp,
                            'reason': 'STRICT_BAR_MISSING' if index is None else 'TEMPORAL_HISTORY_INSUFFICIENT'})
            continue
        bar = bars[index]
        if (utc(observation['bar_end_utc']) != bar.start + BAR or
                utc(observation['available_at_utc']) < bar.start + BAR):
            raise ValueError('Disponibilidad o vela de observación incompatible.')
        base = observation['features']
        if set(base) != set(BASE_FEATURES):
            raise ValueError('Diez variables originales incompatibles.')
        for offset, name in ((1, 'return_1'), (4, 'return_4')):
            prior = bars[index-offset]
            expected = bar.close / prior.close - 1
            if abs(float(base[name]) - expected) > tolerance:
                raise ValueError(f'{name} original no coincide con velas 38D.')
        entry = temporal[stamp]
        new = entry['values']
        if entry['continuous_bars'] < 21:
            raise ValueError('Historial original insuficiente para Fase 23.')
        key = (observation['scenario'], stamp)
        if key in result:
            raise ValueError('Observación original duplicada.')
        result[key] = {'features': {**base, **new}, 'feature_sha256': extended_hash(base, new),
                       'original_feature_sha256': observation['feature_sha256'],
                       'continuous_bars': entry['continuous_bars']}
    if missing:
        raise ValueError(f'Cobertura temporal insuficiente: {len(missing)} observaciones originales; primer caso {missing[0]}.')
    for observation in observations[::2]:
        first = result[('ideal', observation['bar_start_utc'])]
        second = result[('delayed', observation['bar_start_utc'])]
        if first['features'] != second['features'] or first['feature_sha256'] != second['feature_sha256']:
            raise ValueError('Escenarios con características diferentes para la misma vela.')
    return result
