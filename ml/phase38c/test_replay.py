"""Synthetic temporal and training tests; no performance claims from fixtures."""
import hashlib, json, tempfile, unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
import numpy as np
from ml.phase28.train import FEATURES
from ml.phase38c.replay import (CODE_FILES, bootstrap, inference_events, load_run,
    report_scores, run, training_before, visible_features)

def instant(value):return value.isoformat(timespec='milliseconds').replace('+00:00','Z')

def rows_fixture():
    rows=[]
    for session in range(12):
        day=datetime(2024,1,2,tzinfo=timezone.utc)+timedelta(days=session)
        for index in range(9):
            start=day+timedelta(hours=15,minutes=index*15)
            end=start+timedelta(minutes=15)
            label=('ALCISTA','BAJISTA','LATERAL')[index%3]
            for scenario,delay,entry_bars in (('ideal',0,2),('delayed',20,3)):
                available=end+timedelta(minutes=delay);entry=start+timedelta(minutes=entry_bars*15)
                rows.append({'mode':'HISTORICAL_REPLAY','phase':'38C','symbol':'NVDA','timeframe':'15m',
                    'scenario':scenario,'session_date_ny':day.date().isoformat(),
                    'bar_start_utc':instant(start),'bar_end_utc':instant(end),'available_at_utc':instant(available),
                    'historical_received_at_utc':None,
                    'features':{feature:float((session*9+index+number)%13)/10 for number,feature in enumerate(FEATURES)},
                    'feature_sha256':'a'*64,'reference_entry_at_utc':instant(entry),
                    'minutes_until_reference_entry':(entry-available).total_seconds()/60,
                    'label':label,'label_available_at_utc':instant(entry+timedelta(minutes=60)),
                    'label_entry_open':100.,'label_exit_close':101. if label=='ALCISTA' else 99. if label=='BAJISTA' else 100.,
                    'label_atr14_price_units':1.,'exclusion':None})
    return rows

def fixture_directory(directory,rows):
    directory=Path(directory);root=Path(__file__).resolve().parents[2]
    text=json.dumps(rows)+'\n';(directory/'observations.json').write_bytes(text.encode())
    code={name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in CODE_FILES}
    manifest={'schema':'phase38c-v1','source':{'symbol':'NVDA','feed':'sip','adjustment':'split','timeframe':'15m','sha256':{'csv':'a'*64}},
        'codeSha256':code,'observationsSha256':hashlib.sha256(text.encode()).hexdigest(),'rows':len(rows)}
    (directory/'manifest.json').write_text(json.dumps(manifest),encoding='utf8')
    checks=''.join(f'{hashlib.sha256((directory/name).read_bytes()).hexdigest()}  {name}\n'
                   for name in ('observations.json','manifest.json'))
    (directory/'SHA256SUMS').write_text(checks,encoding='utf8')

class PostDecisionReplayTests(unittest.TestCase):
    def test_inference_does_not_receive_targets_or_future_prices(self):
        row=rows_fixture()[1];event=inference_events([row])[0]
        for forbidden in ('label','label_available_at_utc','label_entry_open','label_exit_close','exclusion'):
            self.assertNotIn(forbidden,event)
        self.assertIsNone(visible_features(event,row['bar_end_utc']))
        self.assertEqual(visible_features(event,row['available_at_utc']),row['features'])

    def test_scenario_training_purges_unavailable_labels(self):
        rows=[row for row in rows_fixture() if row['scenario']=='delayed']
        cutoff=rows[27]['available_at_utc'];first_day=rows[27]['session_date_ny']
        train=training_before(rows,cutoff,first_day)
        self.assertTrue(train)
        self.assertTrue(all(row['session_date_ny']<first_day and row['label_available_at_utc']<cutoff for row in train))
        rows[0]['label_available_at_utc']=rows[27]['label_available_at_utc']
        self.assertNotIn(rows[0]['bar_start_utc'],[row['bar_start_utc'] for row in training_before(rows,cutoff,first_day)])

    def test_bootstrap_reuses_session_indexes_and_seed(self):
        rows=[{'session_date_ny':day} for day in ('2024-01-02','2024-01-02','2024-01-03','2024-01-03')]
        y=np.array([0,1,1,2]);left=np.array([[.8,.1,.1],[.1,.8,.1],[.1,.8,.1],[.1,.1,.8]])
        right=np.tile([1/3,1/3,1/3],(4,1))
        first=bootstrap(rows,y,left,{'frequency':right,'momentum':left},iterations=30)
        self.assertEqual(first,bootstrap(rows,y,left,{'frequency':right,'momentum':left},iterations=30))
        self.assertIn('brier_multiclass',first['xgboost_minus_baseline_95pct']['frequency'])
        self.assertIsNone(first['xgboost_minus_baseline_95pct']['momentum']['log_loss'])

    def test_deterministic_baselines_keep_classification_but_hide_probability_scores(self):
        y=np.array([0,1,2,1])
        deterministic=np.eye(3)[np.array([0,0,2,1])]
        reported=report_scores(y,deterministic,'momentum')
        self.assertEqual(reported['accuracy'],.75)
        self.assertEqual(reported['per_class']['BAJISTA']['recall'],.5)
        self.assertEqual(reported['probability_metrics_status'],'not_comparable_deterministic_classifier')
        for key in ('log_loss','brier_multiclass','probability_mean','calibration'):
            self.assertIsNone(reported[key])
        probabilistic=report_scores(y,np.tile([.2,.5,.3],(4,1)),'frequency')
        self.assertIsNotNone(probabilistic['log_loss'])
        self.assertEqual(probabilistic['probability_metrics_status'],'reported_for_probabilistic_estimator')

    def test_scenario_models_three_folds_same_rows_and_reproducible(self):
        with tempfile.TemporaryDirectory() as folder:
            directory=Path(folder);fixture_directory(directory,rows_fixture())
            load_run(directory)
            result=run(directory,3,3)
            report_json=json.loads((directory/'report.json').read_text(encoding='utf8'))
            self.assertEqual(result['prediction_rows'],162)
            for scenario in ('ideal','delayed'):
                report=result['scenarios'][scenario]
                persisted=report_json['scenarios'][scenario]
                self.assertEqual(len(report['folds']),3)
                self.assertEqual(report['pooled']['rows'],81)
                self.assertEqual(persisted['pooled']['metrics']['xgboost']['macro_f1'],report['pooled']['metrics']['xgboost']['macro_f1'])
                for fold_index,fold in enumerate(report['folds']):
                    persisted_fold=persisted['folds'][fold_index]
                    self.assertLess(fold['max_training_label_available_at_utc'],fold['cutoff_utc'])
                    for name in ('majority','frequency','momentum','linear'):
                        self.assertEqual(fold['metrics'][name]['per_class']['BAJISTA']['support'],
                            fold['metrics']['xgboost']['per_class']['BAJISTA']['support'])
                    for level in (persisted['pooled']['metrics'],persisted_fold['metrics'],
                                  next(iter(persisted_fold['by_session'].values()))):
                        for name in ('momentum','majority'):
                            self.assertEqual(level[name]['probability_metrics_status'],
                                'not_comparable_deterministic_classifier')
                            for metric in ('log_loss','brier_multiclass','calibration','probability_mean'):
                                self.assertIsNone(level[name][metric],(scenario,fold_index,name,metric))
                        for name in ('xgboost','frequency','linear'):
                            self.assertEqual(level[name]['probability_metrics_status'],
                                'reported_for_probabilistic_estimator')
                            for metric in ('log_loss','brier_multiclass','calibration','probability_mean'):
                                self.assertIsNotNone(level[name][metric],(scenario,fold_index,name,metric))
            with tempfile.TemporaryDirectory() as another:
                second=Path(another);fixture_directory(second,rows_fixture())
                repeated=run(second,3,3)
                self.assertEqual(repeated['scenarios'],result['scenarios'])
            with self.assertRaisesRegex(ValueError,'directorio privado nuevo'):run(directory,3,3)

    def test_corrupt_hash_or_early_entry_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            directory=Path(folder);fixture_directory(directory,rows_fixture())
            rows=json.loads((directory/'observations.json').read_text(encoding='utf8'))
            rows[1]['reference_entry_at_utc']=rows[1]['available_at_utc']
            fixture_directory(directory,rows)
            with self.assertRaisesRegex(ValueError,'no posterior'):load_run(directory)
            (directory/'observations.json').write_text('[]',encoding='utf8')
            with self.assertRaisesRegex(ValueError,'Hash'):load_run(directory)

if __name__=='__main__':unittest.main()
