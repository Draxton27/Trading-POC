"""Classify candle geometry at the original 41G decision time."""
from __future__ import annotations

import math
from ml.phase41g.coverage import dt

CONFIRMED = 'GEOMETRIC_REJECTION_CONFIRMED'
OPPOSITE = 'TOUCH_CLOSED_OPPOSITE_SIDE'
ON_SMA = 'TOUCH_CLOSED_ON_SMA'
MISMATCH = 'TOUCH_CLOSED_ORIGINAL_SIDE_WITHOUT_41A_REJECTION'
NO_INTERSECTION = 'NO_RANGE_INTERSECTION'
UNAVAILABLE = 'UNAVAILABLE'


def classify(visit: dict, row: dict | None) -> dict:
    expected = 'REJECTED_BELOW' if visit['regimeDirection'] == 'BEARISH' else 'REJECTED_ABOVE'
    observed = set(visit['interactionsAtClose'])
    if 'geometricRejection' in visit and visit['geometricRejection'] != (expected in observed):
        raise ValueError('Bandera 41G de interacción geométrica incompatible')
    base = {**visit, 'eventBarEndUtc': visit['eventBarEndUtc'],
            'rejectionAvailableAtUtc': visit['assumedAvailableAtUtc'],
            'expected41aInteraction': expected,
            'phase41aRejectionObserved': expected in observed}
    if row is None or not row.get('verified') or not row.get('complete'):
        return {**base, 'contactStatus': UNAVAILABLE, 'rejectionStatus': UNAVAILABLE,
                'geometry41aDisagreement': False, 'trueGeometricContact': None}
    for field, event_field in (('startUtc', 'eventBarStartUtc'), ('endUtc', 'eventBarEndUtc'),
                               ('availableAtUtc', 'assumedAvailableAtUtc')):
        if row[field] != visit[event_field]:
            raise ValueError('La visita 41G no coincide con la vela fuente')
    value = (row.get('sma') or {}).get(str(visit['smaPeriod']))
    if value is None:
        return {**base, 'contactStatus': UNAVAILABLE, 'rejectionStatus': UNAVAILABLE,
                'geometry41aDisagreement': False, 'trueGeometricContact': None}
    if not math.isfinite(value) or not math.isclose(value, visit['smaValue'], rel_tol=0, abs_tol=1e-10):
        raise ValueError('SMA 41G distinta del puente 41A/41B')
    if row.get('interactions', {}).get(str(visit['smaPeriod']), []) != visit['interactionsAtClose']:
        raise ValueError('Interacciones 41A distintas de la visita 41G')
    if dt(row['availableAtUtc']) <= dt(row['endUtc']):
        raise ValueError('Rechazo disponible antes o al cierre físico')
    low, high, close = (row[key] for key in ('low', 'high', 'close'))
    if not all(isinstance(x, (int, float)) and math.isfinite(x) for x in (low, high, close)):
        return {**base, 'contactStatus': UNAVAILABLE, 'rejectionStatus': UNAVAILABLE,
                'geometry41aDisagreement': False, 'trueGeometricContact': None}
    contact = low <= value <= high
    original_side = close < value if visit['regimeDirection'] == 'BEARISH' else close > value
    opposite_side = close > value if visit['regimeDirection'] == 'BEARISH' else close < value
    if not contact:
        status = NO_INTERSECTION
    elif close == value:
        status = ON_SMA
    elif opposite_side:
        status = OPPOSITE
    elif original_side and expected in observed:
        status = CONFIRMED
    else:
        status = MISMATCH
    disagreement = (expected in observed) != (contact and original_side)
    return {**base, 'contactStatus': 'GEOMETRIC_CONTACT' if contact else NO_INTERSECTION,
            'rejectionStatus': status, 'trueGeometricContact': contact,
            'geometry41aDisagreement': disagreement,
            'closeOnRegimeSide': original_side}


def join(visits: list[dict], outcomes: list[dict], source: dict) -> list[dict]:
    index = {(row['timeframe'], row['startUtc']): row for row in source['rows']}
    if len(index) != len(source['rows']):
        raise ValueError('Velas fuente duplicadas por marco y timestamp')
    outcome_index = {item['eventId']: item for item in outcomes}
    result = []
    for visit in visits:
        item = classify(visit, index.get((visit['timeframe'], visit['eventBarStartUtc'])))
        outcome = outcome_index[visit['eventId']]
        result.append({**item, 'atr14AtDecision': outcome['atr14AtDecision'],
                       'referenceEntryAtUtc': outcome['referenceEntryAtUtc'],
                       'referenceEntryPrice': outcome['referenceEntryPrice'],
                       'outcomes': outcome['outcomes']})
    return result


def transition(item: dict, horizon: int = 4) -> str:
    outcome = item['outcomes'][str(horizon)]['status']
    if outcome == 'OUTCOME_UNAVAILABLE' or item['rejectionStatus'] == UNAVAILABLE:
        return 'OUTCOME_UNAVAILABLE'
    prefix = 'REJECTION' if item['rejectionStatus'] == CONFIRMED else 'NO_REJECTION'
    suffix = {'FAVORABLE_TERMINAL_MOVE': 'FAVORABLE_CONTINUATION',
              'ADVERSE_TERMINAL_MOVE': 'ADVERSE_FOLLOW_THROUGH',
              'NEUTRAL_TERMINAL_MOVE': 'NEUTRAL_OUTCOME'}[outcome]
    return f'{prefix}_WITH_{suffix}'
