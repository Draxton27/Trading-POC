import json
import hashlib
import tempfile
import unittest
from pathlib import Path

from ml.phase28.train import CLASSES, FEATURES
from ml.phase38f.diagnostics import class_diagnostics, diagnose, abstention
from ml.phase38f.frozen import predict
from ml.phase38f.prospective_report import report, read_ledger
from ml.phase38c.replay import training_before


class Phase38FTests(unittest.TestCase):
    def rows(self):
        rows=[]
        for i in range(18):
            label=CLASSES[i % 3]
            rows.append({'scenario':'ideal','fold':'1','model_sha256':'a'*64,
                         'session_date_ny':f'2026-10-{i+1:02d}','label':label,
                         'atr14_relative':.002+i*.0001,
                         'probability':([.75,.15,.1] if label=='ALCISTA' else
                                        [.1,.8,.1] if label=='BAJISTA' else [.1,.2,.7])})
        return rows

    def test_diagnostics_per_fold_and_class(self):
        result=diagnose(self.rows())['ideal']['1']
        self.assertEqual(result['classes']['BAJISTA']['prevalence'],1/3)
        self.assertAlmostEqual(result['classes']['BAJISTA']['roc_auc_ovr'],1.)
        self.assertAlmostEqual(result['classes']['BAJISTA']['pr_auc_average_precision'],1.)
        self.assertEqual(len(result['classes']['BAJISTA']['thresholds']),7)
        self.assertEqual(result['abstention'][-1]['coverage'],1/3)

    def test_absent_class_has_no_auc(self):
        rows=[r for r in self.rows() if r['label']!='BAJISTA']
        self.assertIsNone(class_diagnostics(rows,1)['roc_auc_ovr'])
        self.assertIsNone(class_diagnostics(rows,1)['pr_auc_average_precision'])

    def test_training_labels_must_be_known_strictly_before_cutoff(self):
        observations=[{'session_date_ny':'2026-10-22','bar_start_utc':'2026-10-22T19:00:00.000Z',
                       'available_at_utc':'2026-10-22T19:35:00.000Z','label':'BAJISTA',
                       'label_available_at_utc':at,'features':{name:0. for name in FEATURES}}
                      for at in ('2026-10-22T20:00:00.000Z','2026-10-23T00:00:00.000Z','2026-10-23T00:01:00.000Z')]
        selected=training_before(observations,'2026-10-23T00:00:00.000Z','2026-10-23')
        self.assertEqual(len(selected),1)

    def test_incompatible_frozen_model_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)
            (path/'freeze.json').write_text(json.dumps({'schema':'phase38f-frozen-v1','features':list(FEATURES),
                'classes':list(CLASSES),'feed':'iex','adjustment':'raw','modelSha256':'invalid'}))
            (path/'model.json').write_text('{}')
            (path/'linear.json').write_text('{}')
            with self.assertRaisesRegex(ValueError,'Hash'):
                predict(path,{name:0. for name in FEATURES})

    def test_prospective_report_matches_the_same_evaluated_rows_and_rejects_duplicate_outcomes(self):
        prediction={'schema':'phase38f-observation-v1','kind':'PREDICTION','id':'one','previousHash':None,
                    'mode':'IEX_PROSPECTIVE_OBSERVATION','barStartUtc':'2026-10-22T14:00:00.000Z',
                    'probabilities':{'xgboost':[.2,.6,.2],'frequency':[.3,.3,.4],'linear':[.2,.4,.4]}}
        evaluation={'schema':'phase38f-observation-v1','kind':'EVALUATION','id':'outcome','previousHash':None,
                    'predictionId':'one','status':'EVALUATED','label':'BAJISTA'}
        result=report([prediction,evaluation])
        self.assertEqual(result['status'],'INSUFFICIENT_EVIDENCE')
        self.assertEqual(result['metrics']['xgboost']['accuracy'],1.)
        self.assertEqual(result['by_session']['2026-10-22']['rows'],1)
        with self.assertRaisesRegex(ValueError,'duplicada'):
            report([prediction,evaluation,evaluation])

    def test_ledger_hash_uses_original_js_serialization(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'observations.jsonl'
            unsigned='{"schema":"phase38f-observation-v1","previousHash":null,"probability":1e-8}'
            digest=hashlib.sha256(unsigned.encode()).hexdigest()
            path.write_text(unsigned[:-1]+',"recordHash":"'+digest+'"}\n',encoding='utf8')
            self.assertEqual(len(read_ledger(path)),1)
            path.write_text(unsigned[:-1]+',"recordHash":"'+'0'*64+'"}\n',encoding='utf8')
            with self.assertRaisesRegex(ValueError,'Integridad'):
                read_ledger(path)


if __name__=='__main__': unittest.main()
