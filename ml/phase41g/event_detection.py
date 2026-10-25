"""Causal pass over rows; only present and prior bars are visible here."""
from __future__ import annotations
from .coverage import adjacent, calendar_maps
from .trend_regimes import TrendMachine
from .visit_episodes import VisitMachine


def detect(document: dict) -> dict:
    sessions, dates = calendar_maps(document['calendar'])
    changes, restarts, regimes, visits, nonvisits = [], [], [], [], []
    coverage = {}
    for frame in ('15m','1h','1d'):
        rows = [r for r in document['rows'] if r['timeframe'] == frame]
        trend = TrendMachine(frame)
        episode = VisitMachine(frame, document['source']['hashes']['csv'])
        prior = None
        counts = {'sourceBars':len(rows),'verifiedBars':0,'gaps':0,'smaUnavailable':0,
                  'leftCensoredBars':0,'tiedBars':0,'incompleteBars':0}
        for index, row in enumerate(rows):
            if prior and not adjacent(prior,row,sessions,dates,frame):
                trend.break_run()
                counts['gaps'] += 1
            prior = row
            if not row['complete']: counts['incompleteBars'] += 1
            if row['verified']: counts['verifiedBars'] += 1
            if not row['verified'] or (row['sma'] or {}).get('20') is None or \
               (row['sma'] or {}).get('40') is None: counts['smaUnavailable'] += 1
            regime,status,transition = trend.step(row,index)
            if status == 'TIED': counts['tiedBars'] += 1
            if regime and regime['origin'] == 'LEFT_CENSORED': counts['leftCensoredBars'] += 1
            if transition:
                changes.append(transition)
                if transition['origin']=='RESTART':
                    restarts.append({**transition,'eventId':transition['eventId']+'-restart',
                                     'kind':transition['restartKind']})
            episode.step(row,regime,status,index,trend.last_change,trend.last_restart)
        trend.finish()
        regimes.extend(trend.regimes)
        visits.extend(episode.visits)
        nonvisits.extend(episode.nonvisits)
        coverage[frame] = counts
    return {'regimes':regimes,'changes':changes,'restarts':restarts,
            'visits':visits,'nonvisits':nonvisits,'coverage':coverage}
