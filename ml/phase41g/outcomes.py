"""Future-only evaluation pass. Event detection never imports this module."""
from __future__ import annotations
from bisect import bisect_right
from .coverage import adjacent, calendar_maps, dt


def causal_atr(rows: list[dict], sessions: dict, dates: dict, frame: str) -> list[float | None]:
    result: list[float | None] = []
    window: list[float] = []
    previous = None
    for row in rows:
        if previous is not None and not adjacent(previous,row,sessions,dates,frame):
            window = []
        if not row['verified']:
            window = []
            result.append(None)
            previous = row
            continue
        prior_close = previous['close'] if previous and window else row['close']
        tr = max(row['high']-row['low'], abs(row['high']-prior_close), abs(row['low']-prior_close))
        window.append(tr)
        if len(window)>14: window.pop(0)
        result.append(sum(window)/14 if len(window)==14 else None)
        previous = row
    return result


def evaluate(events: list[dict], document: dict, horizons=(2,4,6)) -> list[dict]:
    sessions, dates = calendar_maps(document['calendar'])
    frames = {f:[r for r in document['rows'] if r['timeframe']==f] for f in ('15m','1h','1d')}
    index = {f:{r['startUtc']:i for i,r in enumerate(rows)} for f,rows in frames.items()}
    starts = {f:[r['startUtc'] for r in rows] for f,rows in frames.items()}
    atr = {f:causal_atr(rows,sessions,dates,f) for f,rows in frames.items()}
    output=[]
    for event in events:
        frame=event['timeframe']; rows=frames[frame]
        at=index[frame].get(event['eventBarStartUtc'])
        base={**event,'atr14AtDecision':atr[frame][at] if at is not None else None,
              'referenceEntryAtUtc':None,'referenceEntryPrice':None,'outcomes':{}}
        if at is None or not rows[at]['verified']:
            for h in horizons: base['outcomes'][str(h)]={'status':'OUTCOME_UNAVAILABLE','reason':'SOURCE_MISSING'}
            output.append(base);continue
        decision=event['assumedAvailableAtUtc']
        if decision < rows[at]['endUtc']:
            raise ValueError('Disponibilidad simulada antes del cierre')
        next_at=bisect_right(starts[frame],decision)
        reference=rows[next_at] if next_at<len(rows) else None
        valid_entry=reference is not None and reference['verified'] and \
            (frame=='1d' or reference['dateNy']==rows[at]['dateNy'])
        if valid_entry:
            # All scheduled intervals between the event and entry must exist.
            valid_entry=all(adjacent(rows[k-1],rows[k],sessions,dates,frame)
                            for k in range(at+1,next_at+1))
        if valid_entry:
            base['referenceEntryAtUtc']=reference['startUtc']
            base['referenceEntryPrice']=reference['open']
        for horizon in horizons:
            reason=None
            if base['atr14AtDecision'] is None: reason='ATR_INSUFFICIENT'
            elif not valid_entry: reason='RIGHT_CENSORED' if reference is None or \
                (frame!='1d' and reference['dateNy']!=rows[at]['dateNy']) else 'ENTRY_UNAVAILABLE'
            elif next_at+horizon>len(rows): reason='RIGHT_CENSORED'
            else:
                segment=rows[next_at:next_at+horizon]
                if frame!='1d' and any(r['dateNy']!=rows[at]['dateNy'] for r in segment):
                    reason='SESSION_END'
                elif any(not r['verified'] for r in segment): reason='INCOMPLETE_SOURCE'
                elif any(not adjacent(rows[k-1],rows[k],sessions,dates,frame)
                         for k in range(next_at+1,next_at+horizon)):
                    reason='GAP'
            if reason:
                base['outcomes'][str(horizon)]={'status':'OUTCOME_UNAVAILABLE','reason':reason,
                    'rightCensored':reason in ('RIGHT_CENSORED','SESSION_END')}
                continue
            entry=reference['open']; threshold=0.5*base['atr14AtDecision']
            sign=1 if event['regimeDirection']=='BULLISH' else -1
            segment=rows[next_at:next_at+horizon]
            delta=sign*(segment[-1]['close']-entry)
            status='FAVORABLE_TERMINAL_MOVE' if delta>threshold else \
                'ADVERSE_TERMINAL_MOVE' if delta<-threshold else 'NEUTRAL_TERMINAL_MOVE'
            favorable_max=max(sign*(r['high']-entry) if sign==1 else entry-r['low'] for r in segment)
            adverse_max=max(entry-r['low'] if sign==1 else r['high']-entry for r in segment)
            first_fav=first_adv=None
            for j,r in enumerate(segment):
                f=(r['high']-entry if sign==1 else entry-r['low'])>threshold
                a=(entry-r['low'] if sign==1 else r['high']-entry)>threshold
                if f and first_fav is None: first_fav=j
                if a and first_adv is None: first_adv=j
            intrabar=first_fav is not None and first_fav==first_adv
            base['outcomes'][str(horizon)]={'status':status,'reason':None,
                'rightCensored':False,'signedMoveAtr':delta/base['atr14AtDecision'],
                'favorableExcursionAtr':favorable_max/base['atr14AtDecision'],
                'adverseExcursionAtr':adverse_max/base['atr14AtDecision'],
                'firstFavorableBarrierBar':first_fav,'firstAdverseBarrierBar':first_adv,
                'ambiguousIntrabarOrder':intrabar,'outcomeKnownAtUtc':segment[-1]['endUtc'],
                'outcomeAvailability':'HISTORICAL_SIMULATED_SIP_DELAY',
                'lastBarStartUtc':segment[-1]['startUtc']}
        output.append(base)
    return output
