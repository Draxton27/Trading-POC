"""Nine causal trend features, with Phase 23 continuity and EMA9 parity."""
from __future__ import annotations

import hashlib
import json
import math
from collections import Counter, defaultdict

from ml.phase28.train import FEATURES as BASE_FEATURES
from ml.phase40c1.temporal_features import BAR, RETURN_TOLERANCE, continuous, utc

TREND_FEATURES = (
    'ema9_slope_1', 'ema20_slope_1', 'sma20_slope_1',
    'distance_prior_20_high', 'distance_prior_20_low',
    'consecutive_lower_highs_4', 'consecutive_lower_lows_4',
    'consecutive_higher_highs_4', 'consecutive_higher_lows_4',
)
EXTENDED_FEATURES = (*BASE_FEATURES, *TREND_FEATURES)
MIN_BARS = 21
EMA9_ALPHA = 2 / 10
EMA20_ALPHA = 2 / 21


def _streak(segment, attribute, rising):
    count = 0
    for offset in range(1, 5):
        current = getattr(segment[-offset], attribute)
        prior = getattr(segment[-offset-1], attribute)
        if (current > prior) if rising else (current < prior):
            count += 1
        else:
            break
    return count


def trend_at(segment, ema9, ema9_prior, ema20, ema20_prior):
    """The final bar and only its continuous predecessors are visible."""
    if len(segment) < MIN_BARS or any(value is None or value <= 0 for value in
                                      (ema9, ema9_prior, ema20, ema20_prior)):
        return None
    current = segment[-1]
    closes = [bar.close for bar in segment[-21:]]
    sma20 = sum(closes[1:]) / 20
    sma20_prior = sum(closes[:-1]) / 20
    prior = segment[-21:-1]
    result = {
        'ema9_slope_1': ema9 / ema9_prior - 1,
        'ema20_slope_1': ema20 / ema20_prior - 1,
        'sma20_slope_1': sma20 / sma20_prior - 1,
        'distance_prior_20_high': current.close / max(bar.high for bar in prior) - 1,
        'distance_prior_20_low': current.close / min(bar.low for bar in prior) - 1,
        'consecutive_lower_highs_4': _streak(segment, 'high', False),
        'consecutive_lower_lows_4': _streak(segment, 'low', False),
        'consecutive_higher_highs_4': _streak(segment, 'high', True),
        'consecutive_higher_lows_4': _streak(segment, 'low', True),
    }
    if not all(math.isfinite(value) for value in result.values()):
        raise ValueError('Variable de tendencia no finita.')
    return {'values': result, 'ema9': ema9, 'sma20': sma20,
            'continuous_bars': len(segment)}


def trend_index(bars, calendar):
    """Build EMA state once per verified continuous segment, never truncate it."""
    positions = {day: index for index, day in enumerate(sorted(calendar))}
    entries, reasons, segment = {}, {}, []
    ema9 = ema20 = ema9_prior = ema20_prior = None
    segments = 0
    for index, bar in enumerate(bars):
        if bar.day not in calendar:
            raise ValueError('Calendario oficial incompleto para vela IEX.')
        if not segment or not continuous(bars[index-1], bar, calendar, positions):
            segment = []
            ema9 = ema20 = ema9_prior = ema20_prior = None
            segments += 1
        segment.append(bar)
        count = len(segment)
        ema9_prior, ema20_prior = ema9, ema20
        if count == 9:
            ema9 = sum(item.close for item in segment) / 9
        elif count > 9:
            ema9 = (bar.close - ema9) * EMA9_ALPHA + ema9
        if count == 20:
            ema20 = sum(item.close for item in segment) / 20
        elif count > 20:
            ema20 = (bar.close - ema20) * EMA20_ALPHA + ema20
        entry = trend_at(segment, ema9, ema9_prior, ema20, ema20_prior)
        if entry is None:
            reasons[bar.timestamp] = 'CONTINUOUS_HISTORY_UNDER_21_BARS'
        else:
            entries[bar.timestamp] = entry
    return entries, {'strict_bars': len(bars), 'continuous_segments': segments,
                     'eligible_bars': len(entries), 'excluded_count': len(reasons),
                     'exclusions': reasons}


def extended_hash(base, trend):
    if set(base) != set(BASE_FEATURES) or set(trend) != set(TREND_FEATURES):
        raise ValueError('Conjunto de variables incompatible.')
    values = [float(base[name]) for name in BASE_FEATURES] + [float(trend[name]) for name in TREND_FEATURES]
    if not all(math.isfinite(value) for value in values):
        raise ValueError('Variable ampliada no finita.')
    payload = json.dumps({'spec': 'phase40c2-trend-v1', 'names': EXTENDED_FEATURES,
                          'values': values}, separators=(',', ':'), ensure_ascii=False)
    return hashlib.sha256(payload.encode('utf8')).hexdigest()


def align_observations(observations, bars, trend, *, tolerance=RETURN_TOLERANCE):
    """Preserve the ten source numbers; independently verify three implicit indicators."""
    by_start = {bar.timestamp: index for index, bar in enumerate(bars)}
    aligned, missing = {}, []
    for observation in observations:
        stamp = observation['bar_start_utc']
        index = by_start.get(stamp)
        if index is None or stamp not in trend:
            missing.append({'scenario': observation['scenario'], 'bar_start_utc': stamp,
                            'reason': 'STRICT_BAR_MISSING' if index is None else 'TREND_HISTORY_INSUFFICIENT'})
            continue
        bar, entry = bars[index], trend[stamp]
        if (utc(observation['bar_end_utc']) != bar.start + BAR or
                utc(observation['available_at_utc']) < bar.start + BAR):
            raise ValueError('Disponibilidad o vela de observación incompatible.')
        base = observation['features']
        if set(base) != set(BASE_FEATURES) or entry['continuous_bars'] < MIN_BARS:
            raise ValueError('Diez variables originales o continuidad incompatibles.')
        checks = {
            'return_1': bar.close / bars[index-1].close - 1,
            'return_4': bar.close / bars[index-4].close - 1,
            'distance_ema9': bar.close / entry['ema9'] - 1,
            'distance_sma20': bar.close / entry['sma20'] - 1,
        }
        for name, expected in checks.items():
            if abs(float(base[name]) - expected) > tolerance:
                raise ValueError(f'{name} original no coincide con velas 38D: {stamp}.')
        key = (observation['scenario'], stamp)
        if key in aligned:
            raise ValueError('Observación original duplicada.')
        added = entry['values']
        aligned[key] = {'features': {**base, **added},
                        'feature_sha256': extended_hash(base, added),
                        'original_feature_sha256': observation['feature_sha256'],
                        'continuous_bars': entry['continuous_bars']}
    if missing:
        raise ValueError(f'Cobertura de tendencia insuficiente: {len(missing)} observaciones; primer caso {missing[0]}.')
    pairs = defaultdict(dict)
    for (scenario, stamp), item in aligned.items():
        pairs[stamp][scenario] = item
    for stamp, pair in pairs.items():
        if set(pair) != {'ideal', 'delayed'} or pair['ideal']['features'] != pair['delayed']['features']:
            raise ValueError(f'Escenarios con variables diferentes para {stamp}.')
    return aligned


def long_window_audit(observations, bars, trend, calendar, plans):
    """Coverage only; 40/100-bar and prior-session values never reach training."""
    by_day = defaultdict(list)
    for bar in bars:
        by_day[bar.day].append(bar)
    days = sorted(calendar)
    previous = {day: days[index-1] for index, day in enumerate(days) if index}
    complete = {}
    for day, session in calendar.items():
        members = by_day[day]
        complete[day] = (len(members) == (session[1]-session[0]) // 15 and
                         bool(members) and members[0].minute == session[0] and
                         members[-1].minute + 15 == session[1] and
                         all(b.start - a.start == BAR for a, b in zip(members, members[1:])))
    fold_ids = {(scenario, row['bar_start_utc']): plan['fold']
                for scenario, groups in plans.items() for plan in groups for row in plan['test']}
    groups = defaultdict(lambda: Counter())
    for row in observations:
        scenario, day, stamp = row['scenario'], row['session_date_ny'], row['bar_start_utc']
        entry = trend.get(stamp)
        flags = {'continuous_40': bool(entry and entry['continuous_bars'] >= 40),
                 'continuous_100': bool(entry and entry['continuous_bars'] >= 100),
                 'prior_session_complete': bool(complete.get(previous.get(day)))}
        fold = fold_ids.get((scenario, stamp), 'development')
        for group in (f'scenario:{scenario}', f'fold:{scenario}:{fold}',
                      f'date:{scenario}:{day}'):
            groups[group]['rows'] += 1
            for name, available in flags.items():
                groups[group][name] += int(available)
    result = {}
    for key, counts in sorted(groups.items()):
        total = counts['rows']
        result[key] = {'rows': total, **{name: {'available': counts[name],
                    'coverage': counts[name] / total, 'lost_if_required': total-counts[name]}
                    for name in ('continuous_40', 'continuous_100', 'prior_session_complete')}}
    return {'purpose': 'coverage only; not model features', 'groups': result}
