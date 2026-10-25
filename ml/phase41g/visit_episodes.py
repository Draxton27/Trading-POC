"""First and later visit episodes, with no access to future outcomes."""
from __future__ import annotations
from .trend_regimes import identifier
from .coverage import age_bin

PERIODS = (20, 40, 100, 200)


class VisitMachine:
    def __init__(self, timeframe: str, source_sha: str):
        self.frame = timeframe
        self.source_sha = source_sha
        self.regime_id: str | None = None
        self.states = {p: {'status': 'AWAITING_SEPARATION', 'count': 0,
                           'separated': None, 'previous': None} for p in PERIODS}
        self.visits: list[dict] = []
        self.nonvisits: list[dict] = []

    def step(self, row: dict, regime: dict | None, regime_status: str, index: int,
             last_change: str | None, last_restart: str | None) -> None:
        if regime is None or not row['verified'] or regime_status == 'TIED':
            return
        if self.regime_id != regime['regimeId']:
            self.regime_id = regime['regimeId']
            self.states = {p: {'status': 'AWAITING_SEPARATION', 'count': 0,
                               'separated': None, 'previous': None} for p in PERIODS}
            return  # A crossover candle cannot also establish a later visit.
        age = index - regime['startIndex']
        for period in PERIODS:
            sma = (row['sma'] or {}).get(str(period))
            if sma is None:
                self.states[period] = {'status': 'AWAITING_SEPARATION', 'count': 0,
                                       'separated': None, 'previous': None}
                continue
            state = self.states[period]
            bull = regime['direction'] == 'BULLISH'
            fully_separated = row['low'] > sma if bull else row['high'] < sma
            touched = row['low'] <= sma if bull else row['high'] >= sma
            if fully_separated:
                if state['status'] not in ('SEPARATED', 'SEPARATED_AGAIN'):
                    state['separated'] = index
                state['status'] = 'SEPARATED' if state['count'] == 0 else 'SEPARATED_AGAIN'
            elif touched and state['status'] in ('SEPARATED', 'SEPARATED_AGAIN'):
                state['count'] += 1
                count = state['count']
                interactions = (row['interactions'] or {}).get(str(period), [])
                visit = {
                    'eventId': identifier(self.source_sha, self.frame, row['startUtc'],
                                          regime['regimeId'], str(period)),
                    'clusterId': identifier(self.source_sha, self.frame, row['startUtc'], regime['regimeId']),
                    'sourceSha256': self.source_sha, 'timeframe': self.frame,
                    'regimeId': regime['regimeId'], 'regimeDirection': regime['direction'],
                    'regimeStartedAtUtc': regime['startedAtUtc'], 'regimeOriginType': regime['origin'],
                    'smaPeriod': period, 'smaValue': sma, 'priceAtEventClose': row['close'],
                    'visitNumber': count, 'isFirstVisit': count == 1 and regime['origin'] != 'LEFT_CENSORED',
                    'kind': 'LEFT_CENSORED_REGIME_VISIT' if regime['origin'] == 'LEFT_CENSORED' else
                            (('FIRST_VISIT_FROM_ABOVE' if bull else 'FIRST_VISIT_FROM_BELOW')
                             if count == 1 else 'SUBSEQUENT_VISIT'),
                    'eventBarStartUtc': row['startUtc'], 'eventBarEndUtc': row['endUtc'],
                    'assumedAvailableAtUtc': row['availableAtUtc'],
                    'barsSinceRegimeStart': age,
                    'barsSincePreviousVisit': index - state['previous'] if state['previous'] is not None else None,
                    'barsSinceSeparation': index - state['separated'],
                    'timeSinceLastTrendChange': last_change,
                    'timeSinceLastTrendRestart': last_restart,
                    'geometricRejection': ('REJECTED_ABOVE' if bull else 'REJECTED_BELOW') in interactions,
                    'interactionsAtClose': interactions, 'dateNy': row['dateNy'],
                    'localSlot': row['localSlot'], 'ageBin': age_bin(age),
                    'leftCensored': regime['origin'] == 'LEFT_CENSORED',
                    'continuityStatus': 'CONTINUOUS',
                    'separationState': 'FIRST_VISIT' if count == 1 else 'SUBSEQUENT_VISIT',
                }
                self.visits.append(visit)
                state['previous'] = index
                state['status'] = 'VISIT_IN_PROGRESS'
            if not touched and regime['origin'] != 'LEFT_CENSORED':
                self.nonvisits.append({'eventId': identifier(self.source_sha, self.frame,
                    row['startUtc'],regime['regimeId'],str(period),'NONVISIT'),
                    'timeframe': self.frame, 'regimeId': regime['regimeId'],
                    'regimeDirection': regime['direction'], 'regimeOriginType': regime['origin'],
                    'smaPeriod': period, 'smaValue': sma, 'eventBarStartUtc': row['startUtc'],
                    'eventBarEndUtc': row['endUtc'], 'assumedAvailableAtUtc': row['availableAtUtc'],
                    'dateNy': row['dateNy'], 'localSlot': row['localSlot'], 'ageBin': age_bin(age),
                    'barsSinceRegimeStart': age, 'comparator': 'NONVISIT_SAME_REGIME'})
