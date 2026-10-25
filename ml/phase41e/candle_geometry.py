"""Four ratios from the last verified complete IEX raw bar."""
import math

NAMES = ('body_range_ratio', 'upper_wick_range_ratio',
         'lower_wick_range_ratio', 'close_location_in_range')


def geometry(bar):
    values = (bar.open, bar.high, bar.low, bar.close)
    if (not all(math.isfinite(value) and value > 0 for value in values) or
            bar.high < max(bar.open, bar.close, bar.low) or
            bar.low > min(bar.open, bar.close)):
        raise ValueError('OHLC IEX inválido.')
    width = bar.high - bar.low
    if width == 0:
        return dict.fromkeys(NAMES)
    ratios = (abs(bar.close-bar.open)/width,
              (bar.high-max(bar.open, bar.close))/width,
              (min(bar.open, bar.close)-bar.low)/width,
              (bar.close-bar.low)/width)
    if any(not math.isfinite(value) or value < -1e-12 or value > 1+1e-12 for value in ratios):
        raise ValueError('Geometría fuera de rango.')
    return dict(zip(NAMES, ratios))
