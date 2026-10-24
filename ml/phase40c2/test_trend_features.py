import copy
import json
import tempfile
import unittest
from dataclasses import replace
from datetime import timedelta
from pathlib import Path

from ml.phase28.train import FEATURES
from ml.phase40c1.test_helpers import bars_for_days, calendar, write_history
from ml.phase40c1.temporal_features import load_history
from ml.phase40a.bear_audit import sha
from ml.phase40c2.trend_features import (TREND_FEATURES, align_observations,
    extended_hash, long_window_audit, trend_index)


def observation_pair(bars, index, trend):
    bar = bars[index]
    end = (bar.start + timedelta(minutes=15)).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    entry = trend[bar.timestamp]
    base = {name: .1 for name in FEATURES}
    base.update(return_1=bar.close / bars[index-1].close - 1,
                return_4=bar.close / bars[index-4].close - 1,
                distance_ema9=bar.close / entry['ema9'] - 1,
                distance_sma20=bar.close / entry['sma20'] - 1)
    return [{'scenario': scenario, 'bar_start_utc': bar.timestamp, 'bar_end_utc': end,
             'available_at_utc': end, 'session_date_ny': bar.day,
             'features': base, 'feature_sha256': 'original-hash'}
            for scenario in ('ideal', 'delayed')]


class TrendFeaturesTests(unittest.TestCase):
    def test_ema_seeds_slopes_sma_and_prior_high_low(self):
        bars = bars_for_days(['2026-10-21'], prices=list(range(100, 126)))
        trend, audit = trend_index(bars, calendar(['2026-10-21']))
        self.assertEqual(audit['excluded_count'], 20)
        self.assertEqual(trend[bars[20].timestamp]['continuous_bars'], 21)
        value = trend[bars[20].timestamp]
        # Nine-close SMA seed followed by the exact EMA9 update formula of ema9.ts.
        ema9 = sum(range(100, 109)) / 9
        states9 = {8: ema9}
        for index in range(9, 21):
            ema9 = (bars[index].close - ema9) * .2 + ema9
            states9[index] = ema9
        ema20_seed = sum(range(100, 120)) / 20
        ema20_now = (bars[20].close - ema20_seed) * (2 / 21) + ema20_seed
        self.assertAlmostEqual(value['ema9'], ema9)
        self.assertAlmostEqual(value['values']['ema9_slope_1'], ema9 / states9[19] - 1)
        self.assertAlmostEqual(value['values']['ema20_slope_1'], ema20_now / ema20_seed - 1)
        self.assertAlmostEqual(value['values']['sma20_slope_1'],
                               (sum(range(101, 121))/20) / (sum(range(100, 120))/20) - 1)
        self.assertAlmostEqual(value['values']['distance_prior_20_high'], 120 / 120 - 1)
        self.assertAlmostEqual(value['values']['distance_prior_20_low'], 120 / 99 - 1)
        self.assertEqual(value['values']['consecutive_higher_highs_4'], 4)
        self.assertEqual(value['values']['consecutive_higher_lows_4'], 4)
        self.assertEqual(value['values']['consecutive_lower_highs_4'], 0)
        self.assertEqual(len(TREND_FEATURES), 9)

    def test_lower_higher_equal_and_streak_caps(self):
        prices = [200-i for i in range(26)]
        bars = bars_for_days(['2026-10-21'], prices=prices)
        trend, _ = trend_index(bars, calendar(['2026-10-21']))
        self.assertEqual(trend[bars[25].timestamp]['values']['consecutive_lower_highs_4'], 4)
        self.assertEqual(trend[bars[25].timestamp]['values']['consecutive_lower_lows_4'], 4)
        self.assertEqual(trend[bars[25].timestamp]['values']['consecutive_higher_highs_4'], 0)
        equal = bars[:22] + [replace(bars[22], high=bars[21].high, low=bars[21].low)] + bars[23:]
        values, _ = trend_index(equal, calendar(['2026-10-21']))
        self.assertEqual(values[equal[22].timestamp]['values']['consecutive_lower_highs_4'], 0)
        self.assertEqual(values[equal[22].timestamp]['values']['consecutive_lower_lows_4'], 0)
        self.assertEqual(values[equal[23].timestamp]['values']['consecutive_lower_highs_4'], 1)
        self.assertEqual(values[equal[23].timestamp]['values']['consecutive_lower_lows_4'], 1)

    def test_prior_extreme_breaks_exclude_current_high_and_low(self):
        bars = bars_for_days(['2026-10-21'])
        up = bars[:20] + [replace(bars[20], open=130, high=131, low=129, close=130)] + bars[21:]
        down = bars[:20] + [replace(bars[20], open=70, high=71, low=69, close=70)] + bars[21:]
        up_values, _ = trend_index(up, calendar(['2026-10-21']))
        down_values, _ = trend_index(down, calendar(['2026-10-21']))
        self.assertGreater(up_values[up[20].timestamp]['values']['distance_prior_20_high'], 0)
        self.assertLess(down_values[down[20].timestamp]['values']['distance_prior_20_low'], 0)

    def test_gaps_sessions_holiday_early_close_and_dst(self):
        days = ['2026-10-30', '2026-11-02']
        bars = bars_for_days(days)
        self.assertEqual((bars[0].start.hour, bars[26].start.hour), (13, 14))
        _, audit = trend_index(bars, calendar(days))
        self.assertEqual(audit['continuous_segments'], 1)
        missing = bars_for_days(days, omit={(days[0], 600)})
        _, audit = trend_index(missing, calendar(days))
        self.assertEqual(audit['continuous_segments'], 2)
        holiday_days = ['2026-11-25', '2026-11-27', '2026-11-30']
        early = bars_for_days(holiday_days[:1]) + bars_for_days(holiday_days[1:2], close=780)
        early += bars_for_days(holiday_days[2:])
        official = calendar(holiday_days)
        official['2026-11-27'] = (570, 780)
        _, audit = trend_index(early, official)
        self.assertEqual(audit['continuous_segments'], 1)
        no_friday_end = early[:-1]  # A later bar cannot alter earlier features.
        before, _ = trend_index(no_friday_end, official)
        after, _ = trend_index(early, official)
        self.assertEqual(before[early[30].timestamp], after[early[30].timestamp])
        skipped = bars_for_days([holiday_days[0], holiday_days[2]])
        _, audit = trend_index(skipped, official)
        self.assertEqual(audit['continuous_segments'], 2)
        with self.assertRaisesRegex(ValueError, 'Calendario oficial incompleto'):
            trend_index(bars, calendar(days[:1]))

    def test_alignment_original_ema_sma_timestamp_and_future_invariance(self):
        days = ['2026-10-21', '2026-10-22']
        bars = bars_for_days(days)
        index, _ = trend_index(bars, calendar(days))
        observations = observation_pair(bars, 21, index)
        aligned = align_observations(observations, bars, index)
        self.assertEqual(len(aligned), 2)
        self.assertEqual(aligned[('ideal', bars[21].timestamp)]['features'],
                         aligned[('delayed', bars[21].timestamp)]['features'])
        self.assertEqual(len(extended_hash(observations[0]['features'],
                                           index[bars[21].timestamp]['values'])), 64)
        changed_future = bars[:22] + [replace(bar, close=bar.close + 2,
                                               high=bar.high + 2, low=bar.low + 2,
                                               open=bar.open + 2) for bar in bars[22:]]
        future_index, _ = trend_index(changed_future, calendar(days))
        self.assertEqual(aligned, align_observations(observations, changed_future, future_index))
        bad = copy.deepcopy(observations)
        bad[0]['features']['distance_ema9'] += .001
        with self.assertRaisesRegex(ValueError, 'distance_ema9'):
            align_observations(bad, bars, index)
        bad = copy.deepcopy(observations)
        bad[0]['features']['distance_sma20'] += .001
        with self.assertRaisesRegex(ValueError, 'distance_sma20'):
            align_observations(bad, bars, index)
        bad = copy.deepcopy(observations)
        bad[0]['bar_start_utc'] = '2026-10-23T13:30:00.000Z'
        with self.assertRaisesRegex(ValueError, 'Cobertura'):
            align_observations(bad, bars, index)
        bad = copy.deepcopy(observations)
        bad[0]['available_at_utc'] = bars[21].timestamp
        with self.assertRaisesRegex(ValueError, 'Disponibilidad'):
            align_observations(bad, bars, index)

    def test_coverage_long_windows_do_not_enter_features(self):
        days = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22']
        bars = bars_for_days(days)
        trend, _ = trend_index(bars, calendar(days))
        observations = observation_pair(bars, 21, trend) + observation_pair(bars, 101, trend)
        plans = {'ideal': [], 'delayed': []}
        audit = long_window_audit(observations, bars, trend, calendar(days), plans)
        result = audit['groups']['scenario:ideal']
        self.assertEqual(result['rows'], 2)
        self.assertEqual(result['continuous_40']['available'], 1)
        self.assertEqual(result['continuous_100']['available'], 1)
        self.assertEqual(result['prior_session_complete']['available'], 1)
        self.assertNotIn('distance_sma40', TREND_FEATURES)

    def test_history_hash_feed_ohlc_and_raw_contract(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp) / 'history'
            bars, source = write_history(folder, ['2026-10-19', '2026-10-20'])
            loaded, official, _, _ = load_history(folder, source)
            self.assertEqual(len(loaded), len(bars))
            self.assertEqual(official['2026-10-19'], (570, 960))
            folder2 = Path(temp) / 'sip'
            _, sip = write_history(folder2, ['2026-10-19'], feed='sip')
            with self.assertRaisesRegex(ValueError, 'Procedencia'):
                load_history(folder2, sip)
            (folder / 'strict-15m.csv').write_text('tampered', encoding='utf8')
            with self.assertRaisesRegex(ValueError, 'Integridad'):
                load_history(folder, source)

    def test_rejects_invalid_ohlc_even_with_rewritten_local_hashes(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp) / 'history'
            _, source = write_history(folder, ['2026-10-19'])
            csv_path = folder / 'strict-15m.csv'
            lines = csv_path.read_text(encoding='utf8').splitlines()
            cells = lines[1].split(',')
            cells[2] = str(float(cells[1]) - 1)  # high below open
            lines[1] = ','.join(cells)
            csv_path.write_text('\n'.join(lines) + '\n', encoding='utf8')
            report_path = folder / 'report.json'
            report = json.loads(report_path.read_text(encoding='utf8'))
            report['sha256']['strict15mCsv'] = sha(csv_path)
            report_path.write_text(json.dumps(report), encoding='utf8')
            for name in ('strict-15m.csv', 'report.json'):
                source['source']['sha256'][name] = sha(folder / name)
            (folder / 'SHA256SUMS').write_text(''.join(
                f'{digest}  {name}\n' for name, digest in source['source']['sha256'].items()),
                encoding='utf8')
            with self.assertRaisesRegex(ValueError, 'Vela IEX'):
                load_history(folder, source)


if __name__ == '__main__':
    unittest.main()
