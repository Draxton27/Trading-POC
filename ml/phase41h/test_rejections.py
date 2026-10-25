from __future__ import annotations

import copy
import hashlib
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from ml.phase41g.test_events import bar, doc
from ml.phase41g.event_detection import detect
from ml.phase41g.outcomes import evaluate
from ml.phase41g.visit_episodes import VisitMachine
from .rejection_classification import (
    CONFIRMED, MISMATCH, NO_INTERSECTION, ON_SMA, OPPOSITE, UNAVAILABLE,
    classify, join, transition,
)
from .sources import REQUIRED, verify_checksums
from .statistics import F, A, N, comparison, difference_interval, exclusions, summarize
from .report import build


def case(direction='BEARISH', *, low=99, high=101, close=99.5,
         interactions=None, visit_number=1, date='2026-10-21'):
    row = bar(2, short=100 if direction == 'BEARISH' else 101,
              long=101 if direction == 'BEARISH' else 100,
              low=low, high=high, close=close, day=date)
    row['sma']['20'] = 100
    row['interactions']['20'] = interactions if interactions is not None else [
        'REJECTED_BELOW' if direction == 'BEARISH' else 'REJECTED_ABOVE']
    visit = {'eventId': f'{direction}-{visit_number}', 'clusterId': 'same-candle',
             'timeframe': '15m', 'regimeId': 'regime', 'regimeDirection': direction,
             'regimeOriginType': 'CHANGE', 'smaPeriod': 20, 'smaValue': 100,
             'eventBarStartUtc': row['startUtc'], 'eventBarEndUtc': row['endUtc'],
             'assumedAvailableAtUtc': row['availableAtUtc'],
             'interactionsAtClose': row['interactions']['20'],
             'leftCensored': False, 'isFirstVisit': visit_number == 1,
             'visitNumber': visit_number, 'dateNy': date, 'ageBin': '4-11'}
    return visit, row


def with_outcome(visit, status=F, day='2026-10-21', event_id=None):
    result = {**visit, 'dateNy': day, 'eventId': event_id or visit['eventId'],
              'rejectionStatus': visit.get('rejectionStatus', CONFIRMED),
              'trueGeometricContact': visit.get('trueGeometricContact', True)}
    result['outcomes'] = {'4': {'status': status, 'rightCensored': status == 'OUTCOME_UNAVAILABLE',
                               'reason': 'SESSION_END' if status == 'OUTCOME_UNAVAILABLE' else None,
                               'signedMoveAtr': 1.0, 'favorableExcursionAtr': 1.2,
                               'adverseExcursionAtr': 0.6, 'firstFavorableBarrierBar': 1,
                               'firstAdverseBarrierBar': None, 'ambiguousIntrabarOrder': False}}
    return result


class GeometryTests(unittest.TestCase):
    def test_bearish_real_contact_rejection_and_causal_availability(self):
        visit, row = case()
        result = classify(visit, row)
        self.assertEqual(result['rejectionStatus'], CONFIRMED)
        self.assertTrue(result['trueGeometricContact'])
        self.assertEqual(result['rejectionAvailableAtUtc'], row['availableAtUtc'])
        self.assertGreater(result['rejectionAvailableAtUtc'], row['endUtc'])
        self.assertFalse(result['geometry41aDisagreement'])

    def test_bullish_rejection(self):
        visit, row = case('BULLISH', close=100.5)
        self.assertEqual(classify(visit, row)['rejectionStatus'], CONFIRMED)

    def test_phase41g_visit_without_geometric_intersection(self):
        visit, row = case(low=101, high=104, close=103, interactions=['ABOVE'])
        self.assertTrue(row['high'] >= 100)  # The original 41G bearish touch.
        result = classify(visit, row)
        self.assertEqual(result['rejectionStatus'], NO_INTERSECTION)
        self.assertFalse(result['trueGeometricContact'])

    def test_opposite_close_and_exact_sma(self):
        for close, expected in ((100.5, OPPOSITE), (100, ON_SMA)):
            visit, row = case(close=close, interactions=[])
            self.assertEqual(classify(visit, row)['rejectionStatus'], expected)

    def test_phase41a_disagreement_is_reported_but_not_repaired(self):
        visit, row = case(interactions=['TOUCHED_FROM_BELOW'])
        result = classify(visit, row)
        self.assertEqual(result['rejectionStatus'], MISMATCH)
        self.assertTrue(result['geometry41aDisagreement'])
        self.assertEqual(row['interactions']['20'], ['TOUCHED_FROM_BELOW'])
        visit, row = case(close=100.5, interactions=['REJECTED_BELOW'])
        self.assertTrue(classify(visit, row)['geometry41aDisagreement'])

    def test_missing_geometry_is_not_counted_as_no_rejection(self):
        visit, row = case()
        self.assertEqual(classify(visit, None)['rejectionStatus'], UNAVAILABLE)
        row['verified'] = False
        self.assertEqual(classify(visit, row)['rejectionStatus'], UNAVAILABLE)

    def test_reject_wrong_sma_or_premature_availability(self):
        visit, row = case()
        row['sma']['20'] = 102
        with self.assertRaisesRegex(ValueError, 'SMA 41G'):
            classify(visit, row)
        visit, row = case()
        row['availableAtUtc'] = row['endUtc']
        visit['assumedAvailableAtUtc'] = row['endUtc']
        with self.assertRaisesRegex(ValueError, 'antes o al cierre'):
            classify(visit, row)

    def test_future_rows_cannot_change_prior_classification(self):
        visit, row = case()
        source = doc([row])
        outcome = {**visit, 'atr14AtDecision': 1, 'referenceEntryAtUtc': None,
                   'referenceEntryPrice': None, 'outcomes': {'2': {}, '4': {}, '6': {}}}
        first = join([visit], [outcome], source)
        source['rows'].append(bar(3, low=80, high=120, close=110))
        self.assertEqual(join([visit], [outcome], source), first)

    def test_same_geometry_is_classified_separately_on_1h_and_1d(self):
        for frame in ('1h', '1d'):
            visit, row = case()
            row['timeframe'] = frame
            visit['timeframe'] = frame
            self.assertEqual(classify(visit, row)['rejectionStatus'], CONFIRMED)


class EpisodeAndOutcomeTests(unittest.TestCase):
    def test_first_later_consecutive_and_simultaneous_visits_keep_41g_ids(self):
        machine = VisitMachine('15m', 'a' * 64)
        regime = {'regimeId': 'r', 'direction': 'BEARISH', 'origin': 'CHANGE',
                  'startIndex': 0, 'startedAtUtc': '2026-10-21T13:50:00.000Z'}
        rows = [bar(0, 99, 100, low=90, high=95, close=93),
                bar(1, 99, 100, low=90, high=95, close=93),
                bar(2, 99, 100, low=96, high=101, close=97),
                bar(3, 99, 100, low=96, high=101, close=97),
                bar(4, 99, 100, low=90, high=95, close=93),
                bar(5, 99, 100, low=96, high=101, close=97)]
        for i, row in enumerate(rows):
            machine.step(row, regime, 'CHANGE' if i == 0 else 'CONTINUING', i, None, None)
        visits = [v for v in machine.visits if v['smaPeriod'] in (20, 40)]
        self.assertEqual(len(visits), 4)
        self.assertEqual([v['visitNumber'] for v in visits if v['smaPeriod'] == 20], [1, 2])
        self.assertEqual(len({v['clusterId'] for v in visits[:2]}), 1)
        self.assertEqual([v['eventId'] for v in visits], [v['eventId'] for v in copy.deepcopy(visits)])

    def test_left_censored_kept_separate(self):
        visit, row = case()
        visit['leftCensored'] = True
        visit['isFirstVisit'] = False
        item = with_outcome(classify(visit, row))
        self.assertEqual(summarize([item])['left_censored'], 1)
        self.assertEqual(summarize([item])['confirmed_rejections'], 1)

    def test_favorable_adverse_neutral_and_unavailable_transitions(self):
        visit, row = case()
        for status, expected in (
            (F, 'REJECTION_WITH_FAVORABLE_CONTINUATION'),
            (A, 'REJECTION_WITH_ADVERSE_FOLLOW_THROUGH'),
            (N, 'REJECTION_WITH_NEUTRAL_OUTCOME'),
            ('OUTCOME_UNAVAILABLE', 'OUTCOME_UNAVAILABLE'),
        ):
            self.assertEqual(transition(with_outcome(classify(visit, row), status)), expected)

    def test_original_41g_outcome_horizon_and_parity(self):
        rows = [bar(i, low=99, high=101, close=100) for i in range(22)]
        event = {'eventId': 'x', 'timeframe': '15m',
                 'eventBarStartUtc': rows[15]['startUtc'],
                 'assumedAvailableAtUtc': rows[15]['availableAtUtc'],
                 'regimeDirection': 'BULLISH'}
        outcome = evaluate([event], doc(rows))[0]
        self.assertEqual(outcome['outcomes']['4']['outcomeKnownAtUtc'],
                         rows[21]['availableAtUtc'])
        self.assertEqual(outcome['outcomes']['4']['outcomeBarEndUtc'],
                         rows[21]['endUtc'])
        self.assertEqual(outcome['outcomes']['6']['status'], 'OUTCOME_UNAVAILABLE')

    def test_missing_four_bars_is_counted_as_market_close(self):
        visit, row = case()
        item = with_outcome(classify(visit, row), 'OUTCOME_UNAVAILABLE')
        self.assertEqual(summarize([item])['outcomes_unavailable'], 1)
        self.assertEqual(summarize([item])['right_censored'], 1)
        self.assertEqual(exclusions([item])['MARKET_CLOSE'], 1)
        item['outcomes']['4']['reason'] = 'RIGHT_CENSORED'
        self.assertEqual(exclusions([item])['OTHER'], 1)
        self.assertEqual(exclusions([item])['originalOutcomeReasons'], {'RIGHT_CENSORED': 1})


class StatisticsTests(unittest.TestCase):
    def test_complete_session_resampling_keeps_simultaneous_sma_rows(self):
        visit, row = case()
        a, b = [], []
        for n in range(35):
            day = (datetime(2026, 9, 1, tzinfo=timezone.utc) +
                   timedelta(days=n)).date().isoformat()
            # Identical session labels across groups use the same resample draw.
            a.append(with_outcome(classify(visit, row), F if n % 2 else A,
                                  day, f'a-{n}'))
            b.append(with_outcome(classify(visit, row), A if n % 2 else F,
                                  day, f'b-{n}'))
        first = difference_interval(a, b, 'dateNy', seed=7, repetitions=100)
        self.assertEqual(first, difference_interval(a, b, 'dateNy', seed=7, repetitions=100))
        self.assertIsNotNone(first)
        self.assertEqual(comparison('A', a, b)['uncertaintyStatus'],
                         'CROSSED_CLUSTERS_SENSITIVITY_ONLY')
        self.assertIsNone(comparison('E', a, a, overlap=True)['sessionSensitivity95'])

    def test_shared_session_draw_preserves_both_sides_and_simultaneous_events(self):
        visit, row = case()
        left, right = [], []
        for n in range(35):
            day = (datetime(2026, 9, 1, tzinfo=timezone.utc) +
                   timedelta(days=n)).date().isoformat()
            status = F if n % 2 else A
            for period in (20, 40):
                l = with_outcome(classify(visit, row), status, day, f'l-{n}-{period}')
                r = with_outcome(classify(visit, row), status, day, f'r-{n}-{period}')
                l['smaPeriod'] = r['smaPeriod'] = period
                l['clusterId'] = r['clusterId'] = f'c-{n}'
                left.append(l)
                right.append(r)
        self.assertEqual(difference_interval(left, right, 'dateNy', repetitions=100),
                         [0.0, 0.0])

    def test_full_report_parity_and_tampered_outcome(self):
        rows = [bar(i, short=101 if i == 0 else 99, long=100,
                    low=90, high=95, close=93) for i in range(26)]
        rows[4] = bar(4, short=99, long=100, low=96, high=101, close=97)
        source = doc(rows)
        original = detect(source)
        outcomes = evaluate(original['visits'], source)
        data = {'source': source, 'visits': original['visits'], 'regimes': original['regimes'],
                'outcomes': outcomes,
                'manifest': {'sourceFiles': {'csv': 'a' * 64},
                             'protocolSha256': 'b' * 64},
                'checksums': {'report.json': 'c' * 64}}
        report = build(data)
        self.assertEqual(report['report']['phase41gParity']['visits'],
                         len(original['visits']))
        self.assertTrue(report['report']['phase41gParity']['exact'])
        changed = copy.deepcopy(data)
        changed['outcomes'][0]['outcomes']['4']['status'] = 'TAMPERED'
        with self.assertRaisesRegex(ValueError, 'desenlaces'):
            build(changed)

    def test_small_group_has_no_interval(self):
        visit, row = case()
        a = [with_outcome(classify(visit, row), F, '2026-10-21', 'one')]
        b = [with_outcome(classify(visit, row), A, '2026-10-22', 'two')]
        result = comparison('A', a, b)
        self.assertEqual(result['uncertaintyStatus'], 'INSUFFICIENT_EVIDENCE')
        self.assertIsNone(result['sessionSensitivity95'])

    def test_changed_hash_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            names = [name for name in REQUIRED if name != 'SHA256SUMS']
            for name in names:
                (root / name).write_text('{}', encoding='utf-8')
            (root / 'SHA256SUMS').write_text(''.join(
                f'{hashlib.sha256((root / name).read_bytes()).hexdigest()}  {name}\n'
                for name in names), encoding='utf-8')
            self.assertEqual(len(verify_checksums(root)), len(names))
            (root / 'sma-visits.json').write_text('[]', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'Hash 41G'):
                verify_checksums(root)


if __name__ == '__main__':
    unittest.main()
