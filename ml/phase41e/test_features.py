"""Synthetic causal feature tests; no Alpaca credentials or private history."""
import copy
import unittest
from datetime import timedelta

from ml.phase40c1.test_helpers import bars_for_days, calendar
from ml.phase41d.protocol import F0, F1_ADDED, F2_ADDED
from ml.phase41e.candle_geometry import geometry
from ml.phase41e.candle_sequences import sequence, sequence_index
from ml.phase41e.feature_schema import FULL_ORDERS, feature_schema, schema_sha256, validate_features
from ml.phase41e.feature_join import bridge_queries, build_rows
from ml.phase41e.coverage import summarize
from ml.phase41d.targets import TARGET_IDS


class Phase41eFeaturesTests(unittest.TestCase):
    def test_frozen_columns_schema_and_nonordinal_categories(self):
        schema = feature_schema()
        self.assertEqual(schema['columns']['F0'], list(F0))
        self.assertEqual(schema['columns']['F1'], list((*F0, *F1_ADDED)))
        self.assertEqual(schema['columns']['F2'], list((*F0, *F1_ADDED, *F2_ADDED)))
        self.assertEqual((len(F0), len(F1_ADDED), len(F2_ADDED)), (10, 8, 15))
        self.assertEqual((len(FULL_ORDERS), len(set(FULL_ORDERS))), (24, 24))
        self.assertEqual(len(schema_sha256()), 64)
        self.assertIn('one-hot', schema['model_policy']['linear'])

    def test_geometry_wicks_doji_and_zero_range(self):
        bars = bars_for_days(['2026-10-21'], prices=[100, 100])
        first = bars[0]
        self.assertEqual(geometry(first), {'body_range_ratio': 0,
                                           'upper_wick_range_ratio': .5,
                                           'lower_wick_range_ratio': .5,
                                           'close_location_in_range': .5})
        flat = type(first)(first.start, first.timestamp, 100, 100, 100, 100,
                           first.volume, first.day, first.minute)
        self.assertTrue(all(value is None for value in geometry(flat).values()))
        rising = type(first)(first.start, first.timestamp, 100, 103, 99, 102,
                             first.volume, first.day, first.minute)
        self.assertEqual(geometry(rising)['upper_wick_range_ratio'], .25)
        self.assertEqual(geometry(rising)['lower_wick_range_ratio'], .25)
        self.assertEqual(geometry(rising)['close_location_in_range'], .75)

    def test_sequences_end_at_t_require_four_continuous_bars_and_ignore_future(self):
        base = bars_for_days(['2026-10-21'], prices=[100]*7)
        def changed(index, opening, high, low, close):
            bar = base[index]
            return type(bar)(bar.start, bar.timestamp, opening, high, low, close,
                             bar.volume, bar.day, bar.minute)
        bars = [changed(0, 100, 102, 99, 101), changed(1, 101, 103, 98, 102),
                changed(2, 102, 104, 97, 103), changed(3, 103, 105, 96, 104),
                changed(4, 104, 106, 95, 104)] + base[5:]
        result = sequence_index(bars, calendar(['2026-10-21']))
        self.assertIsNone(result[bars[2].timestamp]['consecutive_up_4'])
        self.assertEqual(result[bars[3].timestamp], {'consecutive_up_4': 4,
                                                     'consecutive_down_4': 0,
                                                     'higher_highs_4': 3,
                                                     'lower_lows_4': 3})
        self.assertEqual(result[bars[4].timestamp]['consecutive_up_4'], 0)
        self.assertEqual(sequence_index(bars[:4], calendar(['2026-10-21']))[bars[3].timestamp],
                         result[bars[3].timestamp])
        gapped = sequence_index(bars[:2]+bars[3:], calendar(['2026-10-21']))
        self.assertIsNone(gapped[bars[3].timestamp]['higher_highs_4'])
        self.assertEqual(result[bars[5].timestamp]['consecutive_up_4'], 0)

    def test_friday_monday_dst_and_early_close_continue_only_verified_segments(self):
        days = ['2026-03-06', '2026-03-09']
        bars = bars_for_days(days)
        result = sequence_index(bars, calendar(days))
        self.assertIsNotNone(result[bars[26].timestamp]['higher_highs_4'])
        missing = bars[:25]+bars[26:]
        self.assertIsNone(sequence_index(missing, calendar(days))[bars[26].timestamp]['higher_highs_4'])
        short = bars_for_days(['2026-11-27'], close=780)
        self.assertIsNotNone(sequence_index(short, calendar(['2026-11-27'], close=780))[
            short[-1].timestamp]['consecutive_down_4'])

    def test_missing_is_never_numeric_zero_or_bearish(self):
        values = dict.fromkeys(feature_schema()['columns']['F2'])
        for name in F0:
            values[name] = 0
        for name in F1_ADDED:
            values[name] = None
        for name, categories in feature_schema()['categories'].items():
            values[name] = categories[-1]
        self.assertTrue(validate_features(values))
        values['sma_full_order_15m'] = 'BEARISH'
        with self.assertRaisesRegex(ValueError, 'Categoría'):
            validate_features(values)

    def test_join_keeps_original_features_targets_folds_and_rejects_future_sip(self):
        bars = bars_for_days(['2026-10-21'], prices=[100]*8)
        start = bars[3].timestamp
        end = (bars[3].start + timedelta(minutes=15)).isoformat(
            timespec='milliseconds').replace('+00:00', 'Z')
        f0 = dict.fromkeys(F0, .1)
        source = {'bars': bars, 'calendar': calendar(['2026-10-21']), 'pairs': [], 'targets': {}}
        contexts = {}
        for scenario, decision in (('ideal', end), ('delayed', (bars[3].start +
                                  timedelta(minutes=35)).isoformat(
                                      timespec='milliseconds').replace('+00:00', 'Z'))):
            observation = {'scenario': scenario, 'bar_start_utc': start,
                           'bar_end_utc': end, 'available_at_utc': decision,
                           'session_date_ny': '2026-10-21', 'features': copy.deepcopy(f0),
                           'feature_sha256': 'a'*64}
            prediction = {'scenario': scenario, 'bar_start_utc': start, 'fold': 2}
            source['pairs'].append((observation, prediction))
            source['targets'][(scenario, start)] = {
                name: {'target_value': 'BAJISTA', 'availability_status': 'HISTORICAL_THEORETICAL',
                       'source_hash': 'b'*64} for name in TARGET_IDS}
            for delay in (15, 20, 30):
                features = {name: None if name.startswith('price_relative') else
                            'UNAVAILABLE' if name.startswith(('sma_full', 'sma20_slope', 'sma40_slope',
                                                               'sma100_slope', 'sma200_slope', 'candidate')) else
                            'INSUFFICIENT_DATA' for name in F2_ADDED}
                contexts[(scenario, start, delay)] = {'scenario': scenario, 'fold': 2,
                    'barStartUtc': start, 'decisionAtUtc': decision, 'features': features,
                    'audit': {'sipBarEndUtc': None, 'assumedAvailableAtUtc': None,
                              'reason': 'INSUFFICIENT_SIP_HISTORY'}}
        original = copy.deepcopy(source)
        rows, parity = build_rows(source, contexts)
        self.assertEqual(source, original)
        self.assertEqual(len(rows), 6)
        self.assertEqual(parity['f1_cross_scenario_equal'], 1)
        self.assertEqual(parity['targets_41d_equal'], 6)
        self.assertEqual(rows[0]['features']['return_1'], .1)
        self.assertEqual(rows[0]['targets'][TARGET_IDS[0]], 'BAJISTA')
        self.assertEqual(rows[0]['fold'], 2)
        self.assertEqual(rows[0]['feature_schema_sha256'], schema_sha256())
        coverage = summarize(rows)
        self.assertEqual(coverage['by_group']['scenario_delay_class']['delayed:+20:BAJISTA']['observations'], 1)
        self.assertEqual(coverage['by_group']['delay']['ideal:+20']['target_and_F2'][TARGET_IDS[0]], 0)
        changed = copy.deepcopy(contexts)
        changed[('ideal', start, 20)]['audit']['sipBarEndUtc'] = '2026-10-22T20:00:00.000Z'
        with self.assertRaisesRegex(ValueError, 'SIP posterior'):
            build_rows(source, changed)


if __name__ == '__main__':
    unittest.main()
