"""Descriptive rates and complete-cluster uncertainty; no causal claims."""
from __future__ import annotations
from collections import defaultdict
from random import Random
from statistics import median

F='FAVORABLE_TERMINAL_MOVE'
A='ADVERSE_TERMINAL_MOVE'
N='NEUTRAL_TERMINAL_MOVE'


def bucket(event: dict) -> str:
    count=event['visitNumber']
    return str(count) if count<4 else '4+'


def interval(events: list[dict], cluster: str, seed: int=4107, repetitions: int=1000) -> list[float] | None:
    grouped=defaultdict(list)
    for e in events: grouped[e[cluster]].append(e)
    if len(grouped)<2: return None
    keys=sorted(grouped);rng=Random(seed)
    estimates=[]
    for _ in range(repetitions):
        sample=[e for k in (rng.choice(keys) for _ in keys) for e in grouped[k]]
        estimates.append(sum(e['outcomes']['4']['status']==F for e in sample)/len(sample))
    estimates.sort()
    return [estimates[int(.025*repetitions)],estimates[int(.975*repetitions)-1]]


def paired_interval(pairs: list[tuple[dict,dict]], cluster: str, seed: int=4107,
                    repetitions: int=1000) -> list[float] | None:
    groups=defaultdict(list)
    for visit,control in pairs:groups[visit[cluster]].append((visit,control))
    if len(groups)<2:return None
    keys=sorted(groups);rng=Random(seed);draws=[]
    for _ in range(repetitions):
        selected=[pair for k in (rng.choice(keys) for _ in keys) for pair in groups[k]]
        draws.append(sum((v['outcomes']['4']['status']==F)-(n['outcomes']['4']['status']==F)
                         for v,n in selected)/len(selected))
    draws.sort()
    return [draws[int(.025*repetitions)],draws[int(.975*repetitions)-1]]


def summarize(events: list[dict]) -> dict:
    eligible=[e for e in events if e['outcomes']['4']['status']!= 'OUTCOME_UNAVAILABLE']
    counts={status:sum(e['outcomes']['4']['status']==status for e in eligible) for status in (F,A,N)}
    sessions=len({e['dateNy'] for e in eligible})
    regimes=len({e['regimeId'] for e in eligible})
    moves=[e['outcomes']['4']['signedMoveAtr'] for e in eligible]
    return {'events':len(events),'evaluable':len(eligible),'sessions':sessions,'regimes':regimes,
            'favorable':counts[F],'adverse':counts[A],'neutral':counts[N],
            'favorableRate':counts[F]/len(eligible) if eligible else None,
            'adverseRate':counts[A]/len(eligible) if eligible else None,
            'neutralRate':counts[N]/len(eligible) if eligible else None,
            'medianSignedMoveAtr':median(moves) if moves else None,
            'medianFavorableExcursionAtr':median(e['outcomes']['4']['favorableExcursionAtr'] for e in eligible) if eligible else None,
            'medianAdverseExcursionAtr':median(e['outcomes']['4']['adverseExcursionAtr'] for e in eligible) if eligible else None,
            'medianRegimeAgeBars':median(e['barsSinceRegimeStart'] for e in events) if events else None,
            'sessionBootstrap95':interval(eligible,'dateNy'),
            'regimeBootstrap95':interval(eligible,'regimeId'),
            'evidence':'INSUFFICIENT_EVIDENCE' if len(eligible)<30 or sessions<30 else 'DESCRIPTIVE_ONLY'}


def grouped(events: list[dict]) -> list[dict]:
    result=[]
    dimensions=[('main',lambda e:(e['timeframe'],e['regimeDirection'],e['smaPeriod'],
                                  'FIRST' if e['isFirstVisit'] else 'LATER')),
                ('visit_number',lambda e:(e['timeframe'],e['regimeDirection'],e['smaPeriod'],bucket(e))),
                ('origin',lambda e:(e['timeframe'],e['regimeDirection'],e['smaPeriod'],e['regimeOriginType'])),
                ('year',lambda e:(e['timeframe'],e['regimeDirection'],e['smaPeriod'],e['dateNy'][:4])),
                ('overlap_38e',lambda e:(e['timeframe'],e['regimeDirection'],e['smaPeriod'],
                                    'OVERLAP' if '2024-06-10'<=e['dateNy']<'2026-10-23' else 'EARLIER')),
                ('hour',lambda e:(e['timeframe'],e['regimeDirection'],e['smaPeriod'],e['localSlot'][:2])),
                ('age',lambda e:(e['timeframe'],e['regimeDirection'],e['smaPeriod'],e['ageBin']))]
    for name,key in dimensions:
        groups=defaultdict(list)
        for e in events:groups[key(e)].append(e)
        for keys,sample in sorted(groups.items()):
            stats=summarize(sample) if name in ('main','origin','overlap_38e') else \
                summarize_no_bootstrap(sample)
            result.append({'dimension':name,'keys':keys,**stats})
    return result


def summarize_no_bootstrap(events: list[dict]) -> dict:
    eligible=[e for e in events if e['outcomes']['4']['status']!='OUTCOME_UNAVAILABLE']
    counts={s:sum(e['outcomes']['4']['status']==s for e in eligible) for s in (F,A,N)}
    return {'events':len(events),'evaluable':len(eligible),
            'sessions':len({e['dateNy'] for e in eligible}),
            'regimes':len({e['regimeId'] for e in eligible}),
            'favorable':counts[F],'adverse':counts[A],'neutral':counts[N],
            'favorableRate':counts[F]/len(eligible) if eligible else None,
            'adverseRate':counts[A]/len(eligible) if eligible else None,
            'medianSignedMoveAtr':median(e['outcomes']['4']['signedMoveAtr'] for e in eligible) if eligible else None,
            'evidence':'INSUFFICIENT_EVIDENCE' if len(eligible)<30 or len({e['dateNy'] for e in eligible})<30 else 'DESCRIPTIVE_ONLY'}
