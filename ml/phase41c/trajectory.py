"""Post-entry price paths. None of these quantities are model features."""
from datetime import timedelta

from ml.phase40c1.temporal_features import BAR, utc, NY

HORIZONS = (2, 4, 6)
THRESHOLDS = (.25, .5, .75, 1.0)


def classify(change, atr, threshold=.5):
    if change > threshold * atr:
        return 'ALCISTA'
    if change < -threshold * atr:
        return 'BAJISTA'
    return 'LATERAL'


def future_bars(observation, bar_index, calendar, horizon):
    """Use the original scheduled entry; never select a later observed bar."""
    entry_text = observation['reference_entry_at_utc']
    if entry_text is None:
        return None, 'NO_SCHEDULED_ENTRY'
    entry = utc(entry_text)
    if entry <= utc(observation['available_at_utc']):
        raise ValueError('Entrada no posterior a la decisión.')
    local = entry.astimezone(NY)
    day = local.date().isoformat()
    session = calendar.get(day)
    if day != observation['session_date_ny'] or session is None:
        raise ValueError('Entrada fuera de la sesión original.')
    minute = local.hour * 60 + local.minute
    if minute < session[0] or (minute-session[0]) % 15:
        raise ValueError('Entrada fuera de la cuadrícula oficial.')
    if minute + horizon * 15 > session[1]:
        return None, 'MARKET_CLOSE'
    future = [bar_index.get((entry + offset * BAR).isoformat().replace('+00:00', '.000Z'))
              for offset in range(horizon)]
    if any(bar is None for bar in future):
        return None, 'FUTURE_BARS_MISSING'
    if any(bar.day != day or bar.start != entry + offset * BAR
           for offset, bar in enumerate(future)):
        raise ValueError('Horizonte IEX discontinuo.')
    return future, None


def trajectory(observation, bars):
    entry = bars[0].open
    atr = observation['label_atr14_price_units']
    if atr <= 0:
        raise ValueError('ATR original inválido.')
    closes = [bar.close for bar in bars]
    lower, upper = entry - .5 * atr, entry + .5 * atr
    down = next((i + 1 for i, bar in enumerate(bars) if bar.low <= lower), None)
    up = next((i + 1 for i, bar in enumerate(bars) if bar.high >= upper), None)
    both_same_bar = any(bar.low <= lower and bar.high >= upper for bar in bars)
    maximum_streak = streak = 0
    for close in closes:
        streak = streak + 1 if close < entry else 0
        maximum_streak = max(maximum_streak, streak)
    net = closes[-1] - entry
    low, high = min(bar.low for bar in bars), max(bar.high for bar in bars)
    terminal = classify(net, atr)
    if both_same_bar:
        category = 'AMBIGUOUS_INTRABAR_ORDER'
    elif down is not None and up is not None:
        category = 'BOTH_DIRECTIONS_TOUCHED'
    elif terminal == 'BAJISTA':
        category = 'BEARISH_TERMINAL_MOVE'
    elif terminal == 'ALCISTA':
        category = 'BULLISH_TERMINAL_MOVE'
    elif down is not None:
        category = 'DOWNWARD_EXCURSION_RECOVERED'
    elif up is not None:
        category = 'UPWARD_EXCURSION_RECOVERED'
    else:
        category = 'NO_SIGNIFICANT_EXCURSION'
    return {
        'horizon_bars': len(bars), 'entry_open': entry, 'original_atr14': atr,
        'exit_close': closes[-1], 'net_change': net, 'net_change_atr': net/atr,
        'net_change_percent': 100*net/entry, 'lowest_low': low, 'highest_high': high,
        'maximum_downward_excursion': entry-low,
        'maximum_upward_excursion': high-entry,
        'downward_excursion_atr': (entry-low)/atr,
        'upward_excursion_atr': (high-entry)/atr,
        'first_downward_threshold_touch': down, 'first_upward_threshold_touch': up,
        'both_barriers_same_bar': both_same_bar, 'barrier_order_ambiguous': both_same_bar or down == up and down is not None,
        'final_close_relative_to_entry': 'BELOW' if net < 0 else 'ABOVE' if net > 0 else 'EQUAL',
        'terminal_class_at_0_5_atr': terminal, 'trajectory_category': category,
        'closes_below_entry': sum(close < entry for close in closes),
        'max_consecutive_closes_below_entry': maximum_streak,
        'bearish_candle_bodies': sum(bar.close < bar.open for bar in bars),
        'recovery_from_low_atr': (closes[-1]-low)/atr,
        'successive_close_changes': [b-a for a, b in zip(closes, closes[1:])],
        'close_atr_path': [(close-entry)/atr for close in closes],
        'label_available_at_utc': (bars[-1].start + BAR).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
    }
