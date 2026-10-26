"""Synthetic-only tests: no broker, private run or trained model is required."""
import hashlib
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from ml.phase41i import report as subject


def sha(value):
    return hashlib.sha256(value.encode('utf8')).hexdigest()


def quarter(start, end, record_hash, open_price=100, close_price=100):
    return {'schema':'phase38-iex-v1', 'kind':'quarter', 'feed':'iex', 'adjustment':'raw', 'symbol':'NVDA',
            'status':'COMPLETE', 'revision':1, 'recordHash':record_hash, 'receivedAtUtc':end,
            'bar':{'startUtc':start,'endUtc':end,'open':open_price,'close':close_price}}


class ProspectiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.activation = {'activatedAtUtc':'2026-10-25T19:30:00.000Z', 'protocolSha256':sha('protocol'),
                           'modelSha256':subject.EXPECTED_MODEL,
                           'priorObservationLedger':{'state':'ABSENT','recordCount':0,'tipHash':None}}
        self.protocol = {'evaluation_policy':{'label_id':'NET_MOVE_4B_ATR05_V1'},
                         'feature_schema':{'id':'nvda-15m-v1','columns':['return_1','return_4','distance_ema9','distance_sma20',
                           'bollinger_position','relative_volume_20','candle_range','candle_body','atr14_relative','minutes_from_open']},
                         'minimum_reporting_requirements':{'review_sessions':60,'minimum_actual_per_class':20,
                                                           'bootstrap_minimum_sessions':20,'minimum_complete_bar_coverage':.8}}
        self.bars = {}
        dates = ['2026-10-26T13:30:00.000Z','2026-10-26T14:00:00.000Z','2026-10-26T14:15:00.000Z',
                 '2026-10-26T14:30:00.000Z','2026-10-26T14:45:00.000Z']
        for i, start in enumerate(dates):
            end = (subject.utc(start)+subject.timedelta(minutes=15)).isoformat(timespec='milliseconds').replace('+00:00','Z')
            self.bars[start] = quarter(start,end,sha(start),close_price=101 if i==4 else 100)
        values={name:0. for name in self.protocol['feature_schema']['columns']}
        feature_hash=subject.digest(subject.canonical({'spec':'nvda-15m-v1','names':self.protocol['feature_schema']['columns'],'values':values}))
        self.prediction = {'kind':'PREDICTION','id':'p1','recordHash':sha('prediction'),'modelSha256':subject.EXPECTED_MODEL,
                           'modelCutoffUtc':'2026-10-20T00:00:00.000Z','modelFrozenAtUtc':'2026-10-23T12:00:00.000Z',
                           'barStartUtc':dates[0], 'registeredAtUtc':'2026-10-26T13:47:00.000Z',
                           'entryAtUtc':dates[1], 'outcomeAtUtc':'2026-10-26T15:00:00.000Z',
                           'atr14PriceUnits':1.,'source':{'symbol':'NVDA','feed':'iex','adjustment':'raw','timeframe':'15m'},
                           'sourceBars':[{'startUtc':dates[0],'receivedAtUtc':'2026-10-26T13:45:00.000Z',
                                          'recordHash':self.bars[dates[0]]['recordHash'],'origin':'LIVE'}],
                           'features':{'spec':'nvda-15m-v1','hash':feature_hash,'values':values},
                           'dominantClass':'ALCISTA',
                           'policy':{'classification':'argmax','abstention':None},
                           'probabilities':{'xgboost':[.6,.2,.2],'linear':[.3,.3,.4],'frequency':[.3,.3,.4]}}
        self.evaluation = {'kind':'EVALUATION','predictionId':'p1','status':'EVALUATED','entrySourceHash':sha(dates[1]),
                           'outcomeSourceHash':sha(dates[4]),'entryOpen':100,'outcomeClose':101,'label':'ALCISTA',
                           'evaluatedAtUtc':'2026-10-26T16:00:00.000Z'}
        self.decisions = [{'payload':{'eligibility_status':'RECORDED','prediction_id_if_recorded':'p1',
                                      'decision_at_utc':'2026-10-26T13:47:00.000Z',
                                      'candidate_bar_start_utc':dates[0],
                                      'candidate_bar_end_utc':self.bars[dates[0]]['bar']['endUtc'],
                                      'first_received_at_utc':self.bars[dates[0]]['receivedAtUtc'],
                                      'source_bar_sha256':sha(dates[0]),'prediction_record_hash':sha('prediction')}}]
        self.calendar = self.root/'calendar.json'
        self.calendar.write_text(json.dumps({'provider':'Alpaca Market Calendar',
                                             'sessions':[{'date':'2026-10-26','open':570,'close':960}]}),encoding='utf8')

    def test_no_retroactive_cohort_and_pending_states(self):
        cohort, paired, states = subject.eligible_pairs(self.protocol,self.activation,[self.prediction],self.decisions,
                                                          self.bars,subject.utc('2026-10-26T14:00:00.000Z'))
        self.assertEqual(set(cohort),{'p1'})
        self.assertFalse(paired)
        self.assertEqual(states['PENDING'],1)
        _,_,states = subject.eligible_pairs(self.protocol,self.activation,[self.prediction],self.decisions,self.bars,
                                            subject.utc('2026-10-26T16:00:00.000Z'))
        self.assertEqual(states['OVERDUE_UNEVALUATED'],1)
        old = dict(self.prediction,registeredAtUtc='2026-10-23T13:47:00.000Z')
        with self.assertRaisesRegex(ValueError,'incompatible'):
            subject.eligible_pairs(self.protocol,self.activation,[old],self.decisions,self.bars,
                                   subject.utc('2026-10-26T16:00:00.000Z'))

    def test_original_atr_label_and_first_versions(self):
        cohort, paired, states = subject.eligible_pairs(self.protocol,self.activation,[self.prediction,self.evaluation],
                                                          self.decisions,self.bars,subject.utc('2026-10-26T16:00:00.000Z'))
        self.assertEqual(len(cohort),1)
        self.assertEqual(len(paired),1)
        self.assertEqual(states['EVALUATED'],1)
        wrong = dict(self.evaluation,label='BAJISTA')
        with self.assertRaisesRegex(ValueError,'Etiqueta'):
            subject.eligible_pairs(self.protocol,self.activation,[self.prediction,wrong],self.decisions,self.bars,
                                   subject.utc('2026-10-26T16:00:00.000Z'))
        revised = dict(self.bars)
        revised[self.prediction['entryAtUtc']] = dict(revised[self.prediction['entryAtUtc']],recordHash=sha('revision'))
        with self.assertRaisesRegex(ValueError,'primeras versiones'):
            subject.eligible_pairs(self.protocol,self.activation,[self.prediction,self.evaluation],self.decisions,revised,
                                   subject.utc('2026-10-26T16:00:00.000Z'))

    def test_missing_entry_and_outcome_are_not_correct_predictions(self):
        for status in ('MISSING_ENTRY','MISSING_OUTCOME'):
            event = dict(self.evaluation,status=status,label=None)
            _,paired,counts=subject.eligible_pairs(self.protocol,self.activation,[self.prediction,event],self.decisions,
                                                     self.bars,subject.utc('2026-10-26T16:00:00.000Z'))
            self.assertFalse(paired)
            self.assertEqual(counts[status],1)

    def test_probabilistic_metrics_use_identical_rows_and_bearish_class(self):
        pairs = [(self.prediction,self.evaluation)]
        scores=subject.score_pairs(pairs)
        self.assertEqual(set(scores),{'xgboost','linear','frequency'})
        self.assertEqual(scores['xgboost']['confusion_matrix'][0][0],1)
        self.assertEqual(scores['xgboost']['per_class']['BAJISTA']['support'],0)
        self.assertIsNone(scores['xgboost']['bearish_roc_auc'])
        self.assertAlmostEqual(scores['xgboost']['log_loss'],-subject.math.log(.6))
        self.assertAlmostEqual(scores['xgboost']['brier_multiclass'],(.4**2+.2**2+.2**2))
        self.assertEqual(subject.bootstrap_paired(pairs)['status'],'INSUFFICIENT_SESSIONS')
        with self.assertRaisesRegex(ValueError,'Probabilidades'):
            bad=dict(self.prediction,probabilities={**self.prediction['probabilities'],'linear':[.5,.5,.5]})
            subject.eligible_pairs(self.protocol,self.activation,[bad,self.evaluation],self.decisions,self.bars,
                                   subject.utc('2026-10-26T16:00:00.000Z'))

    def test_bootstrap_resamples_whole_sessions_with_same_indices(self):
        pairs=[]
        for day in range(20):
            pred=dict(self.prediction,barStartUtc=f'2026-10-{day+1:02d}T13:30:00.000Z',
                      probabilities={'xgboost':[.6,.2,.2],'linear':[.6,.2,.2],'frequency':[.6,.2,.2]})
            label=('ALCISTA','BAJISTA','LATERAL')[day%3]
            pairs.append((pred,dict(self.evaluation,label=label)))
        bootstrap=subject.bootstrap_paired(pairs,iterations=40)
        self.assertEqual(bootstrap['status'],'DESCRIPTIVE_INTERVAL')
        self.assertEqual(bootstrap['sessions'],20)
        self.assertEqual(bootstrap['intervals']['linear']['macro_f1'],[0.,0.])

    def test_complete_report_without_prediction_has_no_fabricated_metrics(self):
        with patch.object(subject,'read_observations',return_value=[]),\
             patch.object(subject,'load_activation',return_value=(self.protocol,self.activation,{'model_sha256':subject.EXPECTED_MODEL})),\
             patch.object(subject,'read_eligibility',return_value=[]),\
             patch.object(subject,'read_json_records',return_value=[]):
            report,sessions,months=subject.build_report(self.root,self.root,self.root/'missing.jsonl',
                                                        self.root/'missing-live.jsonl',self.calendar,
                                                        '2026-10-26T12:00:00.000Z')
        self.assertEqual(report['status'],'NO_PROSPECTIVE_DATA')
        self.assertIsNone(report['metrics'])
        self.assertEqual(report['market_coverage']['scheduled_sessions'],0)
        out=self.root/'report'
        subject.publish(report,sessions,months,out)
        self.assertTrue((out/'SHA256SUMS').exists())
        self.assertIn('report.json',subject.files_manifest(out))
        with self.assertRaisesRegex(ValueError,'ya existe'):
            subject.publish(report,sessions,months,out)

    def test_report_with_one_new_evaluation_is_descriptive_and_same_rows(self):
        with patch.object(subject,'read_observations',return_value=[self.prediction,self.evaluation]),\
             patch.object(subject,'load_activation',return_value=(self.protocol,self.activation,{'model_sha256':subject.EXPECTED_MODEL})),\
             patch.object(subject,'read_eligibility',return_value=self.decisions),\
             patch.object(subject,'read_json_records',return_value=list(self.bars.values())):
            report,sessions,months=subject.build_report(self.root,self.root,self.root/'missing.jsonl',
                                                        self.root/'missing-live.jsonl',self.calendar,
                                                        '2026-10-26T16:00:00.000Z')
        self.assertEqual(report['status'],'INSUFFICIENT_EVIDENCE')
        self.assertEqual(report['predictions_coverage']['cohort_count'],1)
        self.assertEqual(report['evaluation_coverage']['evaluated'],1)
        self.assertEqual(set(report['metrics']),{'xgboost','frequency','linear'})
        self.assertEqual(sessions['2026-10-26']['rows'],1)
        self.assertEqual(months['2026-10']['rows'],1)
        self.assertEqual(report['review_gate']['actual_class_counts'],{'ALCISTA':1})
        self.assertFalse(report['review_gate']['reached'])

    def test_recorded_is_terminal_even_for_old_ledger_with_later_stale_decision(self):
        failure = {'payload':{**self.decisions[0]['payload'], 'eligibility_status':'INDICATORS_INSUFFICIENT',
                              'prediction_id_if_recorded':None, 'prediction_record_hash':None,
                              'decision_at_utc':'2026-10-26T13:46:00.000Z'}}
        stale = {'payload':{**failure['payload'], 'eligibility_status':'STALE_LIVE_DATA',
                            'decision_at_utc':'2026-10-26T14:02:00.000Z'}}
        original_hash = self.prediction['recordHash']
        decisions = [failure, self.decisions[0], stale]
        with patch.object(subject,'read_observations',return_value=[self.prediction]),\
             patch.object(subject,'load_activation',return_value=(self.protocol,self.activation,{'model_sha256':subject.EXPECTED_MODEL})),\
             patch.object(subject,'read_eligibility',return_value=decisions),\
             patch.object(subject,'read_json_records',return_value=[next(iter(self.bars.values()))]):
            report,_,_ = subject.build_report(self.root,self.root,self.root/'missing.jsonl',
                                               self.root/'missing-live.jsonl',self.calendar,
                                               '2026-10-26T14:03:00.000Z')
        coverage = report['eligibility_coverage']
        self.assertEqual(coverage['decision_records'],3)
        self.assertEqual(coverage['candidate_bars_examined'],1)
        self.assertEqual(coverage['admitted_bars'],report['predictions_coverage']['cohort_count'])
        self.assertEqual(coverage['finally_not_admitted_bars'],0)
        self.assertEqual(coverage['failed_attempts_before_recovery'],1)
        self.assertEqual(coverage['abstentions_by_reason'],{})
        self.assertEqual(report['evaluation_coverage']['states']['PENDING'],1)
        self.assertEqual(self.prediction['recordHash'],original_hash)

    def test_reconciliation_rejects_orphan_or_duplicate_success(self):
        first = self.decisions[0]
        with self.assertRaisesRegex(ValueError,'uno a uno'):
            subject.reconcile_eligibility([first],self.bars,{})
        with self.assertRaisesRegex(ValueError,'Más de un éxito'):
            subject.reconcile_eligibility([first,first],self.bars,{'p1':self.prediction})
        wrong = {'payload':{**first['payload'],'source_bar_sha256':sha('wrong')}}
        with self.assertRaisesRegex(ValueError,'primera vela'):
            subject.reconcile_eligibility([wrong],self.bars,{'p1':self.prediction})

    def test_hash_chains_reject_tampering(self):
        path=self.root/'iex.jsonl'
        unsigned={'schema':'phase38-iex-v1','kind':'status','previousHash':None,'receivedAtUtc':'2026-10-26T13:00:00.000Z'}
        record={**unsigned,'recordHash':subject.digest(subject.canonical(unsigned))}
        path.write_text(subject.canonical(record)+'\n',encoding='utf8')
        self.assertEqual(len(subject.read_json_records(path,'phase38-iex-v1','recordHash')),1)
        path.write_text(path.read_text(encoding='utf8').replace('13:00','13:01'),encoding='utf8')
        with self.assertRaisesRegex(ValueError,'alterada'):
            subject.read_json_records(path,'phase38-iex-v1','recordHash')


if __name__ == '__main__':
    unittest.main()
