"""Descriptive Phase 41H summaries and cluster-preserving sensitivity intervals."""
from __future__ import annotations

from collections import Counter, defaultdict
from random import Random
from statistics import median

from .rejection_classification import CONFIRMED, NO_INTERSECTION, UNAVAILABLE

F = 'FAVORABLE_TERMINAL_MOVE'
A = 'ADVERSE_TERMINAL_MOVE'
N = 'NEUTRAL_TERMINAL_MOVE'
SEED = 4118
REPETITIONS = 1000


def _percentile(values: list[float]) -> list[float] | None:
    if not values:
        return None
    values.sort()
    return [values[int(.025 * len(values))], values[max(0, int(.975 * len(values)) - 1)]]


def _valid(items: list[dict], horizon: int = 4) -> list[dict]:
    return [item for item in items if item['outcomes'][str(horizon)]['status'] != 'OUTCOME_UNAVAILABLE']


def _adequate(items: list[dict]) -> bool:
    return len(items) >= 30 and len({item['dateNy'] for item in items}) >= 30


def rate_interval(items: list[dict], predicate, cluster: str, seed: int = SEED,
                  repetitions: int = REPETITIONS) -> list[float] | None:
    if not _adequate(items):
        return None
    groups: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for item in items:
        values = groups[item[cluster]]
        values[0] += int(predicate(item))
        values[1] += 1
    if len(groups) < 30:
        return None
    keys = sorted(groups)
    rng = Random(seed)
    draws = []
    for _ in range(repetitions):
        sample = [groups[rng.choice(keys)] for _ in keys]
        draws.append(sum(group[0] for group in sample) / sum(group[1] for group in sample))
    return _percentile(draws)


def difference_interval(left: list[dict], right: list[dict], cluster: str,
                        seed: int = SEED, repetitions: int = REPETITIONS) -> list[float] | None:
    # Draw the same complete cluster for both groups. A visit ID is used once
    # within each group; the caller must exclude overlapping reference groups.
    if not _adequate(left) or not _adequate(right):
        return None
    if {item['eventId'] for item in left} & {item['eventId'] for item in right}:
        return None
    groups: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0, 0])
    for position, items in ((0, left), (2, right)):
        for item in items:
            values = groups[item[cluster]]
            values[position] += int(item['outcomes']['4']['status'] == F)
            values[position + 1] += 1
    if len(groups) < 30:
        return None
    keys = sorted(groups)
    rng = Random(seed)
    draws = []
    for _ in range(repetitions):
        chosen = [groups[rng.choice(keys)] for _ in keys]
        a, na, b, nb = (sum(group[i] for group in chosen) for i in range(4))
        if na and nb:
            draws.append(a / na - b / nb)
    return _percentile(draws) if len(draws) >= int(.95 * repetitions) else None


def exclusions(items: list[dict]) -> dict[str, int]:
    reasons: Counter[str] = Counter()
    for item in items:
        if item['rejectionStatus'] == UNAVAILABLE:
            reasons['SMA_UNAVAILABLE'] += 1
        if item['rejectionStatus'] == NO_INTERSECTION:
            reasons['NO_RANGE_INTERSECTION'] += 1
        if item['leftCensored']:
            reasons['LEFT_CENSORED'] += 1
        outcome = item['outcomes']['4']
        if outcome['status'] != 'OUTCOME_UNAVAILABLE':
            continue
        reason = outcome.get('reason')
        mapped = {'SOURCE_MISSING': 'SOURCE_UNAVAILABLE',
                  'SESSION_END': 'MARKET_CLOSE', 'RIGHT_CENSORED': 'MARKET_CLOSE',
                  'GAP': 'FUTURE_BARS_MISSING', 'INCOMPLETE_SOURCE': 'FUTURE_BARS_MISSING',
                  'ENTRY_UNAVAILABLE': 'FUTURE_BARS_MISSING',
                  'ATR_INSUFFICIENT': 'ATR_INSUFFICIENT'}.get(reason, 'OTHER')
        reasons[mapped] += 1
    return {key: reasons[key] for key in ('SOURCE_UNAVAILABLE', 'SMA_UNAVAILABLE',
        'NO_RANGE_INTERSECTION', 'LEFT_CENSORED', 'MARKET_CLOSE',
        'FUTURE_BARS_MISSING', 'ATR_INSUFFICIENT', 'OTHER')}


def summarize(items: list[dict], horizon: int = 4, uncertainty: bool = False) -> dict:
    valid = _valid(items, horizon)
    statuses = Counter(item['outcomes'][str(horizon)]['status'] for item in valid)
    contacts = [item for item in items if item['trueGeometricContact'] is True]
    rejections = [item for item in contacts if item['rejectionStatus'] == CONFIRMED]
    known = [item for item in items if item['rejectionStatus'] != UNAVAILABLE]
    def med(key: str) -> float | None:
        values = [item['outcomes'][str(horizon)][key] for item in valid]
        return median(values) if values else None
    ratio = [item['outcomes'][str(horizon)]['favorableExcursionAtr'] /
             item['outcomes'][str(horizon)]['adverseExcursionAtr']
             for item in valid if item['outcomes'][str(horizon)]['adverseExcursionAtr'] > 0]
    def rate(n: int, denominator: int) -> float | None:
        return n / denominator if denominator else None
    evidence = 'INSUFFICIENT_EVIDENCE' if not _adequate(valid) else 'DESCRIPTIVE_ONLY'
    output = {
        'events_total': len(items), 'eligibleGeometry': len(known),
        'true_geometric_contacts': len(contacts),
        'nonintersecting_visits': sum(item['rejectionStatus'] == NO_INTERSECTION for item in items),
        'confirmed_rejections': len(rejections),
        'no_rejections': len(contacts) - len(rejections),
        'rejectionRateAmongVisits': rate(len(rejections), len(known)),
        'rejectionRateAmongContacts': rate(len(rejections), len(contacts)),
        'contactRateAmongVisits': rate(len(contacts), len(known)),
        'outcomes_evaluable': len(valid),
        'outcomes_unavailable': len(items) - len(valid),
        'left_censored': sum(item['leftCensored'] for item in items),
        'right_censored': sum(item['outcomes'][str(horizon)].get('rightCensored', False) for item in items),
        'sessions': len({item['dateNy'] for item in items}),
        'evaluableSessions': len({item['dateNy'] for item in valid}),
        'regimes': len({item['regimeId'] for item in items}),
        'clusters': len({item['clusterId'] for item in items}),
        'favorable': statuses[F], 'adverse': statuses[A], 'neutral': statuses[N],
        'favorableRate': rate(statuses[F], len(valid)),
        'adverseRate': rate(statuses[A], len(valid)),
        'neutralRate': rate(statuses[N], len(valid)),
        'medianSignedMoveAtr': med('signedMoveAtr'),
        'medianFavorableExcursionAtr': med('favorableExcursionAtr'),
        'medianAdverseExcursionAtr': med('adverseExcursionAtr'),
        'medianFavorableToAdverseExcursionRatio': median(ratio) if ratio else None,
        'firstFavorableBarrier': dict(sorted(Counter(str(item['outcomes'][str(horizon)]['firstFavorableBarrierBar'])
                                           for item in valid).items())),
        'firstAdverseBarrier': dict(sorted(Counter(str(item['outcomes'][str(horizon)]['firstAdverseBarrierBar'])
                                         for item in valid).items())),
        'ambiguousIntrabar': sum(item['outcomes'][str(horizon)]['ambiguousIntrabarOrder'] for item in valid),
        'evidence': evidence,
    }
    if uncertainty:
        output['rejectionRateSessionSensitivity95'] = rate_interval(
            known, lambda item: item['rejectionStatus'] == CONFIRMED, 'dateNy')
        output['rejectionRateRegimeSensitivity95'] = rate_interval(
            known, lambda item: item['rejectionStatus'] == CONFIRMED, 'regimeId')
        output['favorableRateSessionSensitivity95'] = rate_interval(
            valid, lambda item: item['outcomes'][str(horizon)]['status'] == F, 'dateNy')
        output['favorableRateRegimeSensitivity95'] = rate_interval(
            valid, lambda item: item['outcomes'][str(horizon)]['status'] == F, 'regimeId')
        output['uncertaintyInterpretation'] = 'CLUSTER_SENSITIVITY_NOT_INDEPENDENT_VALIDATION'
    return output


def comparison(code: str, left: list[dict], right: list[dict], overlap: bool = False) -> dict:
    first, second = _valid(left), _valid(right)
    lrate = sum(item['outcomes']['4']['status'] == F for item in first) / len(first) if first else None
    rrate = sum(item['outcomes']['4']['status'] == F for item in second) / len(second) if second else None
    adequate = _adequate(first) and _adequate(second)
    return {'comparison': code, 'leftEvents': len(left), 'rightEvents': len(right),
            'leftEvaluable': len(first), 'rightEvaluable': len(second),
            'leftSessions': len({item['dateNy'] for item in first}),
            'rightSessions': len({item['dateNy'] for item in second}),
            'leftFavorableRate': lrate, 'rightFavorableRate': rrate,
            'difference': lrate - rrate if lrate is not None and rrate is not None else None,
            'sessionSensitivity95': None if overlap else difference_interval(first, second, 'dateNy'),
            'regimeSensitivity95': None if overlap else difference_interval(first, second, 'regimeId'),
            'uncertaintyStatus': 'OVERLAPPING_REFERENCE_NO_INTERVAL' if overlap else
                ('INSUFFICIENT_EVIDENCE' if not adequate else 'CROSSED_CLUSTERS_SENSITIVITY_ONLY'),
            'interpretation': 'EXPLORATORY_ASSOCIATION_NOT_CAUSAL'}
