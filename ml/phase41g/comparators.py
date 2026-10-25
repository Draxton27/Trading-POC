"""Pre-outcome matching: same regime, SMA, declared age bin and NY hour."""
from __future__ import annotations
from collections import defaultdict


def match(visits: list[dict], nonvisits: list[dict]) -> list[dict]:
    index=defaultdict(list)
    for n in nonvisits:
        key=(n['timeframe'],n['regimeId'],n['smaPeriod'],n['ageBin'],n['localSlot'][:2])
        index[key].append(n)
    pairs=[]
    for v in visits:
        key=(v['timeframe'],v['regimeId'],v['smaPeriod'],v['ageBin'],v['localSlot'][:2])
        earlier=[n for n in index[key] if n['eventBarStartUtc']<v['eventBarStartUtc']]
        if earlier:
            chosen=min(earlier,key=lambda n:(abs(n['barsSinceRegimeStart']-v['barsSinceRegimeStart']),
                                          n['eventBarStartUtc']))
            pairs.append({'visitId':v['eventId'],'nonvisitId':chosen['eventId'],
                          'regimeId':v['regimeId'],'timeframe':v['timeframe'],
                          'smaPeriod':v['smaPeriod'],'matchedWithoutOutcome':True})
    return pairs
