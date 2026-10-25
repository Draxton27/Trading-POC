"""Pre-outcome matching: same regime, SMA, declared age bin and NY hour."""
from __future__ import annotations
from collections import defaultdict
from collections import Counter
from statistics import median
from .coverage import dt


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
                          'smaPeriod':v['smaPeriod'],'matchedWithoutOutcome':True,
                          'visitDateNy':v['dateNy'],'controlDateNy':chosen['dateNy'],
                          'crossSession':v['dateNy']!=chosen['dateNy'],
                          'separationMinutes':(dt(v['eventBarStartUtc'])-
                                               dt(chosen['eventBarStartUtc'])).total_seconds()/60})
    reuse=Counter(p['nonvisitId'] for p in pairs)
    for pair in pairs:pair['controlReuseCount']=reuse[pair['nonvisitId']]
    return pairs


def audit(pairs: list[dict]) -> dict:
    reuse=Counter(p['nonvisitId'] for p in pairs)
    by_regime=Counter(p['regimeId'] for p in pairs)
    separation=[p['separationMinutes'] for p in pairs]
    return {'pairs':len(pairs),'crossSessionPairs':sum(p['crossSession'] for p in pairs),
        'crossSessionShare':sum(p['crossSession'] for p in pairs)/len(pairs) if pairs else None,
        'uniqueControls':len(reuse),'reusedControls':sum(n>1 for n in reuse.values()),
        'pairsUsingReusedControls':sum(n for n in reuse.values() if n>1),
        'maxControlReuse':max(reuse.values(),default=0),
        'pairsByRegime':dict(sorted(by_regime.items())),
        'medianSeparationMinutes':median(separation) if separation else None,
        'maxSeparationMinutes':max(separation,default=None),
        'control reuse and cross-session dependence audited':True}
