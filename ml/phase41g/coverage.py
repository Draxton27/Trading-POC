"""Official-session continuity and fixed, predeclared age bins."""
from __future__ import annotations
from datetime import datetime


def dt(value: str) -> datetime:
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def age_bin(age: int) -> str:
    if age < 4: return '0-3'
    if age < 12: return '4-11'
    if age < 26: return '12-25'
    if age < 52: return '26-51'
    return '52+'


def adjacent(a: dict, b: dict, sessions: dict, dates: dict, frame: str) -> bool:
    if not a['verified'] or not b['verified']:
        return False
    if a['dateNy'] == b['dateNy']:
        return a['endUtc'] == b['startUtc']
    if dates.get(b['dateNy']) != dates.get(a['dateNy'], -2) + 1:
        return False
    old, new = sessions[a['dateNy']], sessions[b['dateNy']]
    # NY regular-session hours do not contain a DST transition. The bridge
    # supplies the NY local start slot, derived by the existing TS formatter.
    ah,am=map(int,a['localSlot'].split(':'))
    bh,bm=map(int,b['localSlot'].split(':'))
    duration=int((dt(a['endUtc'])-dt(a['startUtc'])).total_seconds()/60)
    return ah*60+am+duration == old['close'] and bh*60+bm == new['open']


def calendar_maps(calendar: list[dict]) -> tuple[dict, dict]:
    sessions = {s['date']: s for s in calendar}
    dates = {day: i for i, day in enumerate(sorted(sessions))}
    return sessions, dates
