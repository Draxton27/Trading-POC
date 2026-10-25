"""Forward-only SMA20/40 alignment state machine."""
from __future__ import annotations
import hashlib


def identifier(*parts: str) -> str:
    return hashlib.sha256('|'.join(parts).encode()).hexdigest()[:24]


class TrendMachine:
    def __init__(self, timeframe: str):
        self.frame = timeframe
        self.regime: dict | None = None
        self.previous: dict | None = None
        self.last_change: str | None = None
        self.last_restart: str | None = None
        self.regimes: list[dict] = []
        self.transitions: list[dict] = []
        self.status = 'UNAVAILABLE'
        self.index = -1

    def break_run(self) -> None:
        if self.regime:
            self.regime['endedBy'] = 'DISCONTINUOUS'
        self.regime = None
        self.previous = None
        self.last_change = None
        self.last_restart = None
        self.status = 'DISCONTINUOUS'

    def step(self, row: dict, index: int) -> tuple[dict | None, str, dict | None]:
        self.index = index
        sma = row['sma'] or {}
        short, long = sma.get('20'), sma.get('40')
        if not row['verified'] or short is None or long is None:
            self.break_run()
            self.status = 'UNAVAILABLE'
            return None, self.status, None
        if short == long:
            self.status = 'TIED'
            return self.regime, self.status, None
        direction = 'BULLISH' if short > long else 'BEARISH'
        transition = None
        if self.regime is None or direction != self.regime['direction']:
            origin = 'LEFT_CENSORED' if self.regime is None else \
                ('RESTART' if self.previous and self.previous['direction'] == direction else 'CHANGE')
            if self.regime:
                self.regime['endedAtUtc'] = row['availableAtUtc']
                self.regime['endedBy'] = origin
            prior = self.regime
            self.previous = prior
            self.regime = {
                'regimeId': identifier(self.frame, row['startUtc'], direction),
                'timeframe': self.frame, 'direction': direction, 'origin': origin,
                'startedAtUtc': row['availableAtUtc'], 'startBarUtc': row['startUtc'],
                'startIndex': index, 'previousRegimeId': prior['regimeId'] if prior else None,
                'previousRegimeDirection': prior['direction'] if prior else None,
                'durationOfIntermediateAlignment': index - prior['startIndex'] if prior else None,
                'endedAtUtc': None, 'endedBy': None,
            }
            self.regimes.append(self.regime)
            if origin != 'LEFT_CENSORED':
                self.last_change = row['availableAtUtc']
                if origin == 'RESTART':
                    self.last_restart = row['availableAtUtc']
                transition = {'eventId': identifier(self.frame, row['startUtc'], origin, direction),
                    'kind': f'TREND_CHANGE_TO_{direction}',
                    'restartKind':f'TREND_RESTART_{direction}' if origin == 'RESTART' else None,
                    'origin': origin, 'direction': direction, 'timeframe': self.frame,
                    'atUtc': row['availableAtUtc'], 'barStartUtc': row['startUtc'],
                    'regimeId': self.regime['regimeId'], 'previousRegimeId': prior['regimeId'],
                    'durationOfIntermediateAlignment': index - prior['startIndex'],
                    'sma20': short, 'sma40': long}
                self.transitions.append(transition)
            self.status = origin
        else:
            self.status = 'CONTINUING'
        return self.regime, self.status, transition

    def finish(self) -> None:
        if self.regime:
            self.regime['endedBy'] = 'RIGHT_CENSORED'
