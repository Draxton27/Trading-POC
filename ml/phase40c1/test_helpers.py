"""Synthetic NYSE candles and private artifact fixtures, never market results."""
from __future__ import annotations

import csv
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from ml.phase40a.bear_audit import sha
from ml.phase40c1.temporal_features import Bar

NY = ZoneInfo('America/New_York')


def bars_for_days(days, *, close=960, omit=None, prices=None):
    omit = set(omit or ())
    result = []
    for day in days:
        local = date.fromisoformat(day)
        for minute in range(570, close, 15):
            if prices is not None and len(result) >= len(prices):
                return result
            if (day, minute) in omit:
                continue
            instant = datetime(local.year, local.month, local.day, minute // 60,
                               minute % 60, tzinfo=NY).astimezone(timezone.utc)
            stamp = instant.isoformat(timespec='milliseconds').replace('+00:00', 'Z')
            value = float(prices[len(result)] if prices is not None else 100 + len(result) * .1)
            result.append(Bar(instant, stamp, value, value + 1, value - 1,
                              value, 1000, day, minute))
    return result


def calendar(days, close=960):
    return {day: (570, close) for day in days}


def write_history(folder, days, *, close=960, omit=None, feed='iex'):
    folder = Path(folder)
    folder.mkdir()
    bars = bars_for_days(days, close=close, omit=omit)
    first = datetime.fromisoformat(days[0]).replace(tzinfo=timezone.utc)
    last = datetime.fromisoformat(days[-1]).replace(tzinfo=timezone.utc) + timedelta(days=1)
    stamp = lambda value: value.isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    query = {'schema': 'phase38d-v1', 'symbol': 'NVDA', 'feed': feed,
             'timeframe': '1Min', 'adjustment': 'raw', 'start': stamp(first),
             'end': stamp(last)}
    (folder / 'query.json').write_text(json.dumps(query), encoding='utf8')
    (folder / 'calendar.json').write_text(json.dumps({'provider': 'Alpaca Market Calendar',
        'sessions': [{'date': day, 'open': 570, 'close': close} for day in days]}), encoding='utf8')
    with (folder / 'strict-15m.csv').open('w', newline='', encoding='utf8') as target:
        writer = csv.writer(target)
        writer.writerow(['timestamp', 'open', 'high', 'low', 'close', 'volume'])
        for item in bars:
            writer.writerow([item.timestamp, item.open, item.high, item.low, item.close, item.volume])
    report = {'schema': 'phase38d-report-v1', 'source': query,
              'sha256': {'strict15mCsv': sha(folder / 'strict-15m.csv'),
                         'calendar': sha(folder / 'calendar.json')},
              'summary': {'strict15m': len(bars)}}
    (folder / 'report.json').write_text(json.dumps(report), encoding='utf8')
    (folder / 'calendar.json.sha256').write_text(sha(folder / 'calendar.json'), encoding='utf8')
    names = ('query.json', 'calendar.json', 'calendar.json.sha256',
             'strict-15m.csv', 'report.json')
    declared = {name: sha(folder / name) for name in names}
    (folder / 'SHA256SUMS').write_text(''.join(f'{digest}  {name}\n'
                                            for name, digest in declared.items()), encoding='utf8')
    return bars, {'source': {'sha256': declared}}
