from __future__ import annotations
import copy
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from .trend_regimes import TrendMachine
from .visit_episodes import VisitMachine
from .event_detection import detect
from .outcomes import evaluate
from .comparators import match, audit as audit_pairs
from .statistics import grouped
from .sources import load

UTC=timezone.utc


def iso(value):return value.isoformat(timespec='milliseconds').replace('+00:00','Z')


def bar(n,short=101,long=100,low=102,high=104,close=103,
        day='2026-10-21',start=None,frame='15m',complete=True):
    begin=start or datetime(2026,10,21,13,30,tzinfo=UTC)+timedelta(minutes=15*n)
    end=begin+timedelta(minutes=15 if frame=='15m' else 60)
    return {'timeframe':frame,'startUtc':iso(begin),'endUtc':iso(end),
      'availableAtUtc':iso(end+timedelta(minutes=20)),'dateNy':day,
      'localSlot':f'{9+(30+15*n)//60:02d}:{(30+15*n)%60:02d}',
      'open':close,'high':high,'low':low,'close':close,'volume':100,
      'complete':complete,'expectedSourceBars':1,'observedSourceBars':1 if complete else 0,
      'scheduledAbbreviated':False,'continuousBars':n+1,
      'sma':{'20':short,'40':long,'100':99,'200':98},
      'interactions':{'20':['REJECTED_ABOVE'] if low<=short<=high and close>short else [],
                      '40':[],'100':[],'200':[]},'verified':complete}


def doc(rows,calendar=None):
    return {'source':{'hashes':{'csv':'a'*64}},'calendar':calendar or
            [{'date':'2026-10-21','open':570,'close':960}], 'rows':rows}


class TrendTests(unittest.TestCase):
    def test_both_changes_restarts_and_no_early_restart(self):
        machine=TrendMachine('15m')
        sequence=[(101,100),(99,100),(101,100),(99,100)]
        kinds=[]
        for i,(a,b) in enumerate(sequence):
            _,_,event=machine.step(bar(i,a,b),i)
            kinds.append(event['kind'] if event else None)
        self.assertEqual(kinds,[None,'TREND_CHANGE_TO_BEARISH','TREND_CHANGE_TO_BULLISH',
                                'TREND_CHANGE_TO_BEARISH'])
        self.assertEqual([x['origin'] for x in machine.transitions],['CHANGE','RESTART','RESTART'])
        self.assertIsNone(machine.transitions[0]['restartKind'])
        self.assertEqual(machine.transitions[1]['restartKind'],'TREND_RESTART_BULLISH')
        self.assertEqual(machine.transitions[2]['restartKind'],'TREND_RESTART_BEARISH')
        self.assertEqual(machine.transitions[1]['durationOfIntermediateAlignment'],1)

    def test_tie_defers_without_duplicate(self):
        machine=TrendMachine('15m')
        statuses=[]
        for i,a in enumerate([101,100,100,99,99]):
            _,status,_=machine.step(bar(i,a,100),i);statuses.append(status)
        self.assertEqual(statuses,['LEFT_CENSORED','TIED','TIED','CHANGE','CONTINUING'])
        self.assertEqual(len(machine.transitions),1)

    def test_gap_and_unavailable_reset_to_censored(self):
        rows=[bar(0),bar(1,99),bar(2,complete=False),bar(3,101)]
        output=detect(doc(rows))
        self.assertEqual(len(output['changes']),1)
        self.assertEqual(output['regimes'][-1]['origin'],'LEFT_CENSORED')
        self.assertEqual(output['regimes'][-1]['endedBy'],'RIGHT_CENSORED')

    def test_future_bars_do_not_change_prior_events(self):
        rows=[bar(0),bar(1,99),bar(2,99,low=96,high=97,close=96),
              bar(3,99,low=98,high=101,close=98)]
        early=detect(doc(rows))
        later=detect(doc(rows+[bar(4,101)]))
        self.assertEqual(early['visits'],later['visits'])
        self.assertEqual(early['changes'],later['changes'][:len(early['changes'])])


class VisitTests(unittest.TestCase):
    def test_first_second_consecutive_and_new_regime(self):
        vm=VisitMachine('15m','a'*64)
        regime={'regimeId':'r1','direction':'BULLISH','origin':'CHANGE',
                'startIndex':0,'startedAtUtc':'t'}
        rows=[bar(0),bar(1,low=102),bar(2,low=100,high=104,close=103),
              bar(3,low=100),bar(4,low=102),bar(5,low=100)]
        for i,r in enumerate(rows):vm.step(r,regime,'CHANGE' if i==0 else 'CONTINUING',i,None,None)
        sma20=[v for v in vm.visits if v['smaPeriod']==20]
        self.assertEqual([v['visitNumber'] for v in sma20],[1,2])
        self.assertEqual([v['kind'] for v in sma20],['FIRST_VISIT_FROM_ABOVE','SUBSEQUENT_VISIT'])
        self.assertTrue(sma20[0]['geometricRejection'])
        self.assertEqual(sma20[0]['assumedAvailableAtUtc'],rows[2]['availableAtUtc'])
        new={**regime,'regimeId':'r2','startIndex':6,'origin':'RESTART'}
        vm.step(bar(6),new,'RESTART',6,None,None)
        vm.step(bar(7),new,'CONTINUING',7,None,None)
        vm.step(bar(8,low=100),new,'CONTINUING',8,None,None)
        self.assertEqual([v['visitNumber'] for v in vm.visits if v['regimeId']=='r2' and v['smaPeriod']==20],[1])

    def test_bearish_first_visit_from_below_and_multi_sma_cluster(self):
        vm=VisitMachine('15m','a'*64)
        regime={'regimeId':'b','direction':'BEARISH','origin':'CHANGE','startIndex':0,'startedAtUtc':'t'}
        vm.step(bar(0,99,100,low=90,high=95,close=93),regime,'CHANGE',0,None,None)
        vm.step(bar(1,99,100,low=90,high=95,close=93),regime,'CONTINUING',1,None,None)
        vm.step(bar(2,99,100,low=95,high=101,close=96),regime,'CONTINUING',2,None,None)
        visits=[v for v in vm.visits if v['smaPeriod'] in (20,40)]
        self.assertEqual(len(visits),2)
        self.assertEqual(len({v['clusterId'] for v in visits}),1)
        self.assertEqual(visits[0]['kind'],'FIRST_VISIT_FROM_BELOW')

    def test_left_censored_is_not_true_first(self):
        vm=VisitMachine('15m','a'*64)
        r={'regimeId':'left','direction':'BULLISH','origin':'LEFT_CENSORED','startIndex':0,'startedAtUtc':'t'}
        for i,low in enumerate((102,102,100)):
            vm.step(bar(i,low=low),r,'LEFT_CENSORED' if i==0 else 'CONTINUING',i,None,None)
        visit=[v for v in vm.visits if v['smaPeriod']==20][0]
        self.assertFalse(visit['isFirstVisit'])
        self.assertEqual(visit['kind'],'LEFT_CENSORED_REGIME_VISIT')


class OutcomeTests(unittest.TestCase):
    def event(self,rows,direction='BULLISH'):
        return {'eventId':'x','timeframe':'15m','eventBarStartUtc':rows[15]['startUtc'],
                'assumedAvailableAtUtc':rows[15]['availableAtUtc'],
                'regimeDirection':direction,'dateNy':rows[15]['dateNy']}

    def test_entry_after_delay_and_terminal_cases(self):
        rows=[bar(i,low=99,high=101,close=100) for i in range(26)]
        # event n=15 ends 17:30 UTC; available 17:50. n=17 starts 17:45, n=18 starts 18:00.
        for i in range(18,22):rows[i]['close']=102;rows[i]['high']=103;rows[i]['low']=99
        result=evaluate([self.event(rows)],doc(rows))[0]
        self.assertEqual(result['referenceEntryAtUtc'],rows[18]['startUtc'])
        self.assertEqual(result['outcomes']['4']['status'],'FAVORABLE_TERMINAL_MOVE')
        self.assertEqual(result['outcomes']['4']['outcomeKnownAtUtc'],rows[21]['availableAtUtc'])
        self.assertEqual(result['outcomes']['4']['outcomeBarEndUtc'],rows[21]['endUtc'])
        self.assertGreater(datetime.fromisoformat(result['outcomes']['4']['outcomeKnownAtUtc'].replace('Z','+00:00')),
                           datetime.fromisoformat(result['outcomes']['4']['outcomeBarEndUtc'].replace('Z','+00:00')))
        bear=evaluate([self.event(rows,'BEARISH')],doc(rows))[0]
        self.assertEqual(bear['outcomes']['4']['status'],'ADVERSE_TERMINAL_MOVE')
        rows[21]['close']=100
        neutral=evaluate([self.event(rows)],doc(rows))[0]
        self.assertEqual(neutral['outcomes']['4']['status'],'NEUTRAL_TERMINAL_MOVE')

    def test_incomplete_horizon_and_ambiguous_first_touch(self):
        rows=[bar(i,low=99,high=101,close=100) for i in range(22)]
        rows[18]['high']=105;rows[18]['low']=95
        result=evaluate([self.event(rows)],doc(rows))[0]
        self.assertTrue(result['outcomes']['4']['ambiguousIntrabarOrder'])
        rows[20]['verified']=False
        self.assertEqual(evaluate([self.event(rows)],doc(rows))[0]['outcomes']['4']['status'],'OUTCOME_UNAVAILABLE')

    def test_dst_weekend_and_missing_session(self):
        friday=bar(0,start=datetime(2026,3,6,20,45,tzinfo=UTC),day='2026-03-06')
        friday['localSlot']='15:45'
        monday=bar(1,start=datetime(2026,3,9,13,30,tzinfo=UTC),day='2026-03-09')
        monday['localSlot']='09:30'
        from .coverage import adjacent,calendar_maps
        cal=[{'date':'2026-03-06','open':570,'close':960},
             {'date':'2026-03-09','open':570,'close':960}]
        sessions,dates=calendar_maps(cal)
        self.assertTrue(adjacent(friday,monday,sessions,dates,'15m'))
        cal.insert(1,{'date':'2026-03-08','open':570,'close':960})
        sessions,dates=calendar_maps(cal)
        self.assertFalse(adjacent(friday,monday,sessions,dates,'15m'))

    def test_early_close_and_last_bar_not_shifted_to_next_session(self):
        rows=[bar(i,low=99,high=101,close=100) for i in range(20)]
        short=doc(rows,[{'date':'2026-10-21','open':570,'close':870}])
        event={'eventId':'late','timeframe':'15m','eventBarStartUtc':rows[18]['startUtc'],
               'assumedAvailableAtUtc':rows[18]['availableAtUtc'],
               'regimeDirection':'BEARISH','dateNy':'2026-10-21'}
        outcome=evaluate([event],short)[0]['outcomes']['4']
        self.assertEqual(outcome['status'],'OUTCOME_UNAVAILABLE')
        self.assertTrue(outcome['rightCensored'])

    def test_wrong_source_is_rejected_before_detection(self):
        source=doc([bar(0)])
        source['schema']='phase41g-sip-source-v1'
        source['source'].update(symbol='NVDA',feed='iex',adjustment='raw',timeframe='15m',
                                delayMinutes=20,availability='SIMULATED_HISTORICAL_DELAY')
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'source.json'
            path.write_text(json.dumps(source),encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'Procedencia'):
                load(path,'a'*64)

    def test_verified_source_must_use_the_frozen_twenty_minute_delay(self):
        row=bar(0);row.update(timeframe='15m',continuousBars=21,
                              availableAtUtc=iso(datetime.fromisoformat(row['endUtc'].replace('Z','+00:00'))+
                                                 timedelta(minutes=21)))
        source={'schema':'phase41g-sip-source-v1','source':{'symbol':'NVDA','feed':'sip',
          'adjustment':'split','timeframe':'15m','delayMinutes':20,
          'availability':'SIMULATED_HISTORICAL_DELAY','hashes':{'csv':'a'*64}},
          'calendar':[{'date':row['dateNy'],'open':570,'close':960}], 'rows':[row]}
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'source.json';path.write_text(json.dumps(source),encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'Vela verificada'):
                load(path,'a'*64)

    def test_reproducible_stats_and_matching_without_outcome(self):
        rows=[bar(i,low=99,high=101,close=100) for i in range(22)]
        ev={**self.event(rows),'smaPeriod':20,'regimeId':'r','ageBin':'12-25',
            'localSlot':'14:00','barsSinceRegimeStart':20}
        non={**ev,'eventId':'n','eventBarStartUtc':rows[14]['startUtc'],
             'assumedAvailableAtUtc':rows[14]['availableAtUtc'],'barsSinceRegimeStart':19}
        self.assertEqual(match([ev],[non])[0]['nonvisitId'],'n')
        self.assertEqual(evaluate([ev],doc(rows)),evaluate([copy.deepcopy(ev)],doc(rows)))

    def test_control_reuse_cross_session_and_pair_audit(self):
        control={**self.event([bar(i) for i in range(22)]),'eventId':'control','regimeId':'r',
            'smaPeriod':20,'ageBin':'12-25','localSlot':'14:00','barsSinceRegimeStart':20,
            'dateNy':'2026-10-20','eventBarStartUtc':'2026-10-20T18:00:00.000Z'}
        visits=[]
        for i,day in enumerate(('2026-10-21','2026-10-22')):
            visits.append({**control,'eventId':f'v{i}','dateNy':day,
                           'eventBarStartUtc':f'{day}T18:00:00.000Z'})
        pairs=match(visits,[control])
        summary=audit_pairs(pairs)
        self.assertEqual(summary['pairs'],2)
        self.assertEqual(summary['crossSessionPairs'],2)
        self.assertEqual(summary['uniqueControls'],1)
        self.assertEqual(summary['reusedControls'],1)
        self.assertEqual(summary['maxControlReuse'],2)
        self.assertEqual(summary['pairsByRegime'],{'r':2})
        self.assertEqual([p['controlReuseCount'] for p in pairs],[2,2])
        self.assertEqual([p['separationMinutes'] for p in pairs],[1440,2880])

    def test_outcome_known_timestamp_includes_delay_for_1h_and_1d(self):
        def frame_row(start,end,day,slot,frame):
            return {'timeframe':frame,'startUtc':iso(start),'endUtc':iso(end),
                'availableAtUtc':iso(end+timedelta(minutes=20)),'dateNy':day,'localSlot':slot,
                'open':100,'high':101,'low':99,'close':100,'verified':True}
        # Four official sessions with six 60-minute bars and one 30-minute close bar.
        dates=['2026-10-19','2026-10-20','2026-10-21','2026-10-22']
        calendar=[{'date':d,'open':570,'close':960} for d in dates]
        hourly=[]
        for day_i,day in enumerate(dates):
            base=datetime(2026,10,int(day[-2:]),13,30,tzinfo=UTC)
            for slot in range(7):
                start=base+timedelta(hours=slot);duration=30 if slot==6 else 60
                hour=9+(30+60*slot)//60;minute=(30+60*slot)%60
                local=f'{hour:02d}:{minute:02d}'
                hourly.append(frame_row(start,start+timedelta(minutes=duration),day,local,'1h'))
        for target,expected in ((hourly[14],hourly[19]),):
            event={'eventId':'hour','timeframe':'1h','eventBarStartUtc':target['startUtc'],
                   'assumedAvailableAtUtc':target['availableAtUtc'],'regimeDirection':'BULLISH'}
            outcome=evaluate([event],doc(hourly,calendar))[0]['outcomes']['4']
            self.assertEqual(outcome['outcomeBarEndUtc'],expected['endUtc'])
            self.assertEqual(outcome['outcomeKnownAtUtc'],expected['availableAtUtc'])
        # Daily bars are released after each official close; use a 20-session run for ATR14.
        daily=[];days=[];cursor=datetime(2026,9,1)
        while len(days)<20:
            if cursor.weekday()<5:days.append(cursor.strftime('%Y-%m-%d'))
            cursor+=timedelta(days=1)
        for day in days:
            date=datetime.fromisoformat(day)
            start=datetime(date.year,date.month,date.day,13,30,tzinfo=UTC)
            daily.append(frame_row(start,start+timedelta(minutes=390),day,'09:30','1d'))
        daily_calendar=[{'date':d,'open':570,'close':960} for d in days]
        target=daily[14];last=daily[18]
        event={'eventId':'daily','timeframe':'1d','eventBarStartUtc':target['startUtc'],
               'assumedAvailableAtUtc':target['availableAtUtc'],'regimeDirection':'BEARISH'}
        outcome=evaluate([event],doc(daily,daily_calendar))[0]['outcomes']['4']
        self.assertEqual(outcome['outcomeBarEndUtc'],last['endUtc'])
        self.assertEqual(outcome['outcomeKnownAtUtc'],last['availableAtUtc'])
        self.assertGreater(datetime.fromisoformat(outcome['outcomeKnownAtUtc'].replace('Z','+00:00')),
                           datetime.fromisoformat(outcome['outcomeBarEndUtc'].replace('Z','+00:00')))


if __name__=='__main__':unittest.main()
