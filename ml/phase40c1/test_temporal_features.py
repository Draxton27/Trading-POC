import copy
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

from ml.phase28.train import FEATURES
from ml.phase40c1.temporal_features import (align_observations, continuous,
    extended_hash, load_history, temporal_at, temporal_index, utc)
from ml.phase40c1.test_helpers import bars_for_days, calendar, write_history


class TemporalFeaturesTests(unittest.TestCase):
    def test_returns_lags_and_streaks_zero_or_opposite_interrupt(self):
        days = ['2026-10-21']
        prices = [100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 90]
        bars = bars_for_days(days, prices=prices)
        value = temporal_at(bars[:9])
        self.assertAlmostEqual(value['return_2'], 92 / 94 - 1)
        self.assertAlmostEqual(value['return_8'], 92 / 100 - 1)
        self.assertAlmostEqual(value['lagged_return_1'], 93 / 94 - 1)
        self.assertAlmostEqual(value['lagged_return_2'], 94 / 95 - 1)
        self.assertAlmostEqual(value['lagged_return_3'], 95 / 96 - 1)
        self.assertEqual(value['consecutive_down_bars'], 8)
        self.assertEqual(value['consecutive_up_bars'], 0)
        self.assertEqual(temporal_at(bars)['consecutive_down_bars'], 8)
        self.assertEqual(temporal_at(bars[:8]), None)
        rising = bars_for_days(days, prices=list(range(100, 111)))
        self.assertEqual(temporal_at(rising)['consecutive_up_bars'], 8)
        flat = bars_for_days(days, prices=[100, 99, 98, 97, 96, 95, 94, 93, 93, 92, 91])
        self.assertEqual(temporal_at(flat[:9])['consecutive_down_bars'], 0)
        self.assertEqual(temporal_at(flat[:10])['consecutive_down_bars'], 1)
        mixed = bars_for_days(days, prices=[100, 99, 98, 97, 96, 95, 94, 93, 94])
        self.assertEqual(temporal_at(mixed)['consecutive_up_bars'], 1)

    def test_intraday_gap_missing_session_and_overnight_boundaries(self):
        days = ['2026-10-19', '2026-10-20', '2026-10-21']
        full = bars_for_days(days)
        by_day = calendar(days)
        values, audit = temporal_index(full, by_day)
        self.assertEqual(audit['continuous_segments'], 1)
        self.assertEqual(values[full[-1].timestamp]['continuous_bars'], len(full))
        with_gap = bars_for_days(days, omit={(days[0], 600)})
        _, audit_gap = temporal_index(with_gap, by_day)
        self.assertEqual(audit_gap['continuous_segments'], 2)
        missing_session = bars_for_days([days[0], days[2]])
        _, audit_missing = temporal_index(missing_session, by_day)
        self.assertEqual(audit_missing['continuous_segments'], 2)
        no_final = bars_for_days(days, omit={(days[0], 945)})
        _, audit_final = temporal_index(no_final, by_day)
        self.assertEqual(audit_final['continuous_segments'], 2)
        no_open = bars_for_days(days, omit={(days[1], 570)})
        _, audit_open = temporal_index(no_open, by_day)
        self.assertEqual(audit_open['continuous_segments'], 2)

    def test_friday_monday_dst_and_early_close(self):
        days = ['2026-10-30', '2026-11-02']
        bars = bars_for_days(days)
        self.assertEqual((bars[0].start.hour, bars[26].start.hour), (13, 14))
        _, audit = temporal_index(bars, calendar(days))
        self.assertEqual(audit['continuous_segments'], 1)
        early = bars_for_days(['2026-11-27', '2026-11-30'], close=780)
        _, early_audit = temporal_index(early, calendar(['2026-11-27', '2026-11-30'], close=780))
        self.assertEqual(early_audit['continuous_segments'], 1)
        self.assertTrue(continuous(early[13], early[14],
                                    calendar(['2026-11-27', '2026-11-30'], close=780),
                                    {'2026-11-27': 0, '2026-11-30': 1}))

    def test_verified_history_raw_hashes_calendar_and_future_rejection(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp) / 'history'
            bars, source = write_history(folder, ['2026-10-19', '2026-10-20'])
            loaded, official, hashes, _ = load_history(folder, source)
            self.assertEqual(len(loaded), len(bars))
            self.assertEqual(official['2026-10-19'], (570, 960))
            self.assertEqual(hashes, source['source']['sha256'])
            altered = copy.deepcopy(source)
            altered['source']['sha256']['strict-15m.csv'] = '0' * 64
            with self.assertRaisesRegex(ValueError, 'fuente declarada'):
                load_history(folder, altered)
            (folder / 'strict-15m.csv').write_text((folder / 'strict-15m.csv').read_text() + 'future\n')
            with self.assertRaisesRegex(ValueError, 'Integridad'):
                load_history(folder, source)

    def test_rejects_non_iex_feed_and_incomplete_calendar(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp) / 'sip'
            _, source = write_history(folder, ['2026-10-19'], feed='sip')
            with self.assertRaisesRegex(ValueError, 'Procedencia'):
                load_history(folder, source)
        missing = bars_for_days(['2026-10-19', '2026-10-20'])
        with self.assertRaisesRegex(ValueError, 'Calendario oficial incompleto'):
            temporal_index(missing, calendar(['2026-10-19']))

    def test_alignment_causality_and_original_return_cross_check(self):
        bars = bars_for_days(['2026-10-19'])
        temporal, _ = temporal_index(bars, calendar(['2026-10-19']))
        target = bars[21]
        base = {name: .1 for name in FEATURES}
        base['return_1'] = target.close / bars[20].close - 1
        base['return_4'] = target.close / bars[17].close - 1
        end = (target.start + timedelta(minutes=15)).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        observations = [{'scenario': scenario, 'bar_start_utc': target.timestamp,
                         'bar_end_utc': end, 'available_at_utc': end,
                         'features': base, 'feature_sha256': 'base-hash'}
                        for scenario in ('ideal', 'delayed')]
        result = align_observations(observations, bars, temporal)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[('ideal', target.timestamp)]['features'],
                         result[('delayed', target.timestamp)]['features'])
        before = result[('ideal', target.timestamp)]['feature_sha256']
        future = bars_for_days(['2026-10-20'])
        more, _ = temporal_index(bars + future, calendar(['2026-10-19', '2026-10-20']))
        self.assertEqual(before, align_observations(observations, bars + future, more)[
            ('ideal', target.timestamp)]['feature_sha256'])
        corrupted = copy.deepcopy(observations)
        corrupted[0]['features']['return_1'] += .001
        with self.assertRaisesRegex(ValueError, 'return_1'):
            align_observations(corrupted, bars, temporal)
        with self.assertRaisesRegex(ValueError, 'Cobertura'):
            align_observations(observations, bars[:20], temporal)
        self.assertEqual(len(extended_hash(base, temporal[target.timestamp]['values'])), 64)


if __name__ == '__main__':
    unittest.main()
