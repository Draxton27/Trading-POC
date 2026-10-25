"""Synthetic, deterministic tests: no Alpaca credentials or private inputs."""
import copy
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from ml.phase40c1.temporal_features import Bar, NY
from ml.phase41c.trajectory import classify, future_bars, trajectory
from ml.phase41c.target_audit import audit_sources, exact_original_parity
from ml.phase41c.metrics import proportion, target_sensitivity
from ml.phase41c.report import private_new_directory

BAR = timedelta(minutes=15)


def stamp(value):
    return value.isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def session(day, *, close=960, prices=None):
    prices = prices or [100, 99.6, 99.8, 100, 100.1, 100.2]
    opening = datetime.fromisoformat(day+'T09:30:00').replace(tzinfo=NY).astimezone(timezone.utc)
    bars = []
    for offset, price in enumerate(prices):
        start = opening + BAR*offset
        bars.append(Bar(start, stamp(start), price, price+.6, price-.6, price,
                        100, day, 570+15*offset))
    return bars, {day: (570, close)}


def observation(bars, *, scenario='ideal', entry_index=1, atr=1.0):
    start = bars[0].start
    decision = start+BAR+(timedelta(minutes=20) if scenario == 'delayed' else timedelta())
    entry = bars[entry_index].start
    while entry <= decision:
        entry_index += 1
        entry = bars[entry_index].start
    exit_bar = bars[entry_index+3]
    label = classify(exit_bar.close-bars[entry_index].open, atr)
    return {'scenario': scenario, 'fold': 1, 'session_date_ny': bars[0].day,
            'bar_start_utc': bars[0].timestamp, 'available_at_utc': stamp(decision),
            'reference_entry_at_utc': stamp(entry), 'label': label,
            'label_available_at_utc': stamp(exit_bar.start+BAR),
            'label_entry_open': bars[entry_index].open,
            'label_exit_close': exit_bar.close, 'label_atr14_price_units': atr,
            'exclusion': None}


class TargetAuditTests(unittest.TestCase):
    def test_exact_parity_uses_original_entry_and_four_bars(self):
        bars, calendar = session('2026-01-05', prices=[100, 98, 97, 96, 95, 94, 93, 92])
        obs = observation(bars, scenario='delayed')
        self.assertEqual(obs['reference_entry_at_utc'], bars[3].timestamp)
        index = {bar.timestamp: bar for bar in bars}
        exact_original_parity(obs, index, calendar)
        future, reason = future_bars(obs, index, calendar, 4)
        self.assertIsNone(reason)
        self.assertEqual([bar.timestamp for bar in future], [bar.timestamp for bar in bars[3:7]])
        changed = copy.deepcopy(obs)
        changed['label_exit_close'] += .01
        with self.assertRaises(ValueError):
            exact_original_parity(changed, index, calendar)
        changed = copy.deepcopy(obs)
        changed['label_atr14_price_units'] = 100
        with self.assertRaises(ValueError):
            exact_original_parity(changed, index, calendar)
        changed = copy.deepcopy(obs)
        changed['available_at_utc'] = changed['reference_entry_at_utc']
        with self.assertRaises(ValueError):
            exact_original_parity(changed, index, calendar)

    def test_strict_boundary_and_counterfactual_labels(self):
        self.assertEqual(classify(-.5, 1), 'LATERAL')
        self.assertEqual(classify(.5, 1), 'LATERAL')
        self.assertEqual(classify(-.50001, 1), 'BAJISTA')
        self.assertEqual(classify(.50001, 1), 'ALCISTA')
        self.assertEqual(classify(-.5, 1, .25), 'BAJISTA')

    def test_transient_drop_recovery_and_persistence(self):
        bars, calendar = session('2026-01-05', prices=[100, 100, 100, 100, 100, 100, 100])
        obs = observation(bars)
        future = [Bar(bar.start, bar.timestamp, bar.open, 100.2, 99.4, bar.close,
                      bar.volume, bar.day, bar.minute) for bar in bars[1:5]]
        path = trajectory(obs, future)
        self.assertEqual(path['terminal_class_at_0_5_atr'], 'LATERAL')
        self.assertEqual(path['trajectory_category'], 'DOWNWARD_EXCURSION_RECOVERED')
        self.assertEqual(path['first_downward_threshold_touch'], 1)
        self.assertEqual(path['closes_below_entry'], 0)
        self.assertEqual(path['max_consecutive_closes_below_entry'], 0)
        self.assertAlmostEqual(path['recovery_from_low_atr'], .6)
        falling = [copy.copy(bar) for bar in future]
        falling[-1] = Bar(falling[-1].start, falling[-1].timestamp, 99, 99.2, 98.7,
                          99, 100, falling[-1].day, falling[-1].minute)
        self.assertEqual(trajectory(obs, falling)['terminal_class_at_0_5_atr'], 'BAJISTA')
        self.assertEqual(trajectory(obs, falling)['closes_below_entry'], 1)

    def test_barrier_first_touch_order_is_distinct_from_any_same_bar_touch(self):
        bars, _ = session('2026-01-05', prices=[100]*8)
        obs = observation(bars)

        def candle(index, high, low):
            bar = bars[index]
            return Bar(bar.start, bar.timestamp, 100, high, low, 100,
                       bar.volume, bar.day, bar.minute)

        # Upward first, followed by a candle that touches both barriers.
        up_then_both = [candle(1, 100.6, 99.8), candle(2, 100.7, 99.2),
                        candle(3, 100.1, 99.9), candle(4, 100.1, 99.9)]
        path = trajectory(obs, up_then_both)
        self.assertEqual(path['first_touch_order'], 'UP_FIRST')
        self.assertEqual(path['first_upward_threshold_touch'], 1)
        self.assertEqual(path['first_downward_threshold_touch'], 2)
        self.assertTrue(path['any_same_bar_both_touched'])
        self.assertFalse(path['first_touch_order_ambiguous'])
        self.assertFalse(path['barrier_order_ambiguous'])
        self.assertEqual(path['trajectory_category'], 'BOTH_DIRECTIONS_TOUCHED')

        # Downward first, then a later candle touches both.
        down_then_both = [candle(1, 100.2, 99.4), candle(2, 100.7, 99.2),
                          candle(3, 100.1, 99.9), candle(4, 100.1, 99.9)]
        path = trajectory(obs, down_then_both)
        self.assertEqual(path['first_touch_order'], 'DOWN_FIRST')
        self.assertEqual(path['first_downward_threshold_touch'], 1)
        self.assertEqual(path['first_upward_threshold_touch'], 2)
        self.assertTrue(path['any_same_bar_both_touched'])
        self.assertFalse(path['first_touch_order_ambiguous'])
        self.assertEqual(path['trajectory_category'], 'BOTH_DIRECTIONS_TOUCHED')

        # Both first touches occur within the same candle.
        both_first = [candle(1, 100.6, 99.4), candle(2, 100.1, 99.9),
                      candle(3, 100.1, 99.9), candle(4, 100.1, 99.9)]
        path = trajectory(obs, both_first)
        self.assertEqual(path['first_touch_order'], 'SAME_BAR')
        self.assertEqual(path['first_upward_threshold_touch'], 1)
        self.assertEqual(path['first_downward_threshold_touch'], 1)
        self.assertTrue(path['any_same_bar_both_touched'])
        self.assertTrue(path['first_touch_order_ambiguous'])
        self.assertTrue(path['barrier_order_ambiguous'])
        self.assertEqual(path['trajectory_category'], 'AMBIGUOUS_INTRABAR_ORDER')

    def test_horizons_market_close_early_close_gaps_and_dst(self):
        for day in ('2026-01-05', '2026-03-09', '2026-11-02'):
            bars, calendar = session(day, prices=[100]*8)
            obs = observation(bars)
            index = {bar.timestamp: bar for bar in bars}
            for horizon in (2, 4, 6):
                future, reason = future_bars(obs, index, calendar, horizon)
                self.assertIsNone(reason)
                self.assertEqual(len(future), horizon)
            self.assertEqual(bars[1].start-bars[0].start, BAR)
            gap = dict(index)
            del gap[bars[3].timestamp]
            self.assertEqual(future_bars(obs, gap, calendar, 4)[1], 'FUTURE_BARS_MISSING')
            self.assertEqual(future_bars(obs, index, {day: (570, 630)}, 4)[1], 'MARKET_CLOSE')
        friday, cal = session('2026-01-02', prices=[100]*8)
        monday, next_cal = session('2026-01-05', prices=[100]*8)
        obs = observation(friday)
        self.assertEqual(future_bars(obs, {b.timestamp: b for b in friday+monday},
                                     {**cal, **next_cal, '2026-01-02': (570, 660)}, 6)[1], 'MARKET_CLOSE')

    def test_originals_are_immutable_and_alternatives_separate(self):
        bars, calendar = session('2026-01-05', prices=[100, 100, 100, 100, 100, 100, 100, 100])
        obs = observation(bars)
        prediction = {'scenario': 'ideal', 'fold': '1', 'bar_start_utc': obs['bar_start_utc'],
                      'prob_xgboost': '[0.2, 0.3, 0.5]'}
        source = {'bars': bars, 'calendar': calendar, 'observations': [obs],
                  'pairs': [(obs, prediction)]}
        before = copy.deepcopy(source)
        rows, coverage = audit_sources(source)
        self.assertEqual(source, before)
        self.assertEqual(rows[0]['probability_vector'], [.2, .3, .5])
        self.assertEqual(rows[0]['predicted_class'], 'LATERAL')
        self.assertEqual(rows[0]['fold'], 1)
        self.assertEqual(coverage['ideal']['4']['AVAILABLE'], 1)
        sensitivity = target_sensitivity(rows)
        self.assertEqual(sensitivity['ideal']['horizons']['6']['common_coverage'], 1)
        self.assertEqual(sensitivity['ideal']['thresholds']['0.5']['changed_from_original'], 0)

    def test_session_bootstrap_reproducible_and_private_destination(self):
        rows = [{'session': f'2026-01-{i+1:02d}', 'hit': i % 2 == 0} for i in range(30)]
        first = proportion(rows, lambda row: row['hit'], iterations=30, seed=7)
        self.assertEqual(first, proportion(rows, lambda row: row['hit'], iterations=30, seed=7))
        self.assertEqual(first['fraction'], .5)
        self.assertEqual(first['sessions'], 30)
        self.assertIsNotNone(first['ci95'])
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaises(ValueError):
                private_new_directory(Path(temporary)/'audit')


if __name__ == '__main__':
    unittest.main()
