"""Four-bar causal sequence counts on the official IEX trading calendar."""
from ml.phase40c1.temporal_features import continuous

NAMES = ('consecutive_up_4', 'consecutive_down_4', 'higher_highs_4', 'lower_lows_4')


def sequence(window):
    if len(window) != 4:
        return dict.fromkeys(NAMES)
    up = down = 0
    for bar in reversed(window):
        if bar.close > bar.open and down == 0:
            up += 1
        else:
            break
    for bar in reversed(window):
        if bar.close < bar.open and up == 0:
            down += 1
        else:
            break
    return dict(zip(NAMES, (up, down,
                            sum(window[i].high > window[i-1].high for i in range(1, 4)),
                            sum(window[i].low < window[i-1].low for i in range(1, 4)))))


def sequence_index(bars, calendar):
    positions = {day: i for i, day in enumerate(sorted(calendar))}
    result = {}
    window = []
    for bar in bars:
        if bar.day not in calendar:
            raise ValueError('Calendario IEX incompleto.')
        if window and not continuous(window[-1], bar, calendar, positions):
            window = []
        window = [*window[-3:], bar]
        result[bar.timestamp] = sequence(window)
    return result
