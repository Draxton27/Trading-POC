import csv, hashlib, json, sys, tempfile, unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0,str(Path(__file__).parent))
import train

class Phase28Tests(unittest.TestCase):
    def make_dataset(self, mutate=None):
        directory=Path(tempfile.mkdtemp())
        fields=list(train.REQUIRED)
        rows=[]
        days=[(datetime(2024,1,2)+timedelta(days=index)).date().isoformat() for index in range(16)]
        days.append('2025-01-02')
        for day in days:
            part='desarrollo' if day<'2025-01-01' else 'evaluacion_exploratoria'
            for minute,label in [(0,'ALCISTA'),(15,'BAJISTA'),(30,'LATERAL')]:
                stamp=(datetime.fromisoformat(day+'T14:30:00+00:00')+timedelta(minutes=minute)).isoformat(timespec='milliseconds').replace('+00:00','Z')
                label_at=(datetime.fromisoformat(stamp.replace('Z','+00:00'))+timedelta(minutes=60)).isoformat(timespec='milliseconds').replace('+00:00','Z')
                row={name:'0.1' for name in fields};row.update({'partition':part,'session_date_ny':day,'bar_start_utc':stamp,'observed_at_utc':stamp,'available_at_utc':stamp,'label_available_at_utc':label_at,'label':label,'label_entry_open':'10','label_exit_close':'10','label_change':'0','label_atr14_price_units':'1'})
                row['minutes_from_open']=str(minute);rows.append(row)
        if mutate: mutate(rows)
        with (directory/'dataset.csv').open('w',newline='',encoding='utf8') as out:
            writer=csv.DictWriter(out,fieldnames=fields);writer.writeheader();writer.writerows(rows)
        digest=hashlib.sha256((directory/'dataset.csv').read_bytes()).hexdigest()
        columns={name:{'role':'feature'} for name in train.FEATURES}
        (directory/'metadata.json').write_text(json.dumps({'schemaVersion':'nvda-15m-v1','outputCsvSha256':digest,'columns':columns}),encoding='utf8')
        return directory

    def test_loads_and_prohibits_future_columns(self):
        path=self.make_dataset();rows,_=train.load_dataset(path)
        self.assertEqual(len(rows),51);self.assertTrue(train.FORBIDDEN.isdisjoint(train.FEATURES))
        self.assertEqual(train.CLASS_INDEX,{'ALCISTA':0,'BAJISTA':1,'LATERAL':2})
    def test_rejects_duplicate_timestamp(self):
        path=self.make_dataset(lambda rows:rows.__setitem__(1,{**rows[1],'bar_start_utc':rows[0]['bar_start_utc']}))
        with self.assertRaisesRegex(ValueError,'duplicado'): train.load_dataset(path)
    def test_rejects_future_feature_and_invalid_hash(self):
        path=self.make_dataset();data=json.loads((path/'metadata.json').read_text());data['columns']['return_1']['role']='target';(path/'metadata.json').write_text(json.dumps(data))
        with self.assertRaises(ValueError):train.load_dataset(path)
    def test_purge_and_metrics_are_deterministic(self):
        rows,_=train.load_dataset(self.make_dataset());folds=train.session_folds(rows,2);self.assertTrue(folds)
        a,b=folds[-1];self.assertTrue(all(train.iso(r['label_available_at_utc'])<train.iso(b[0]['observed_at_utc']) for r in a))
        y=train.arrays(rows[-3:])[1];p=train.probabilities_frequency(train.arrays(rows[:6])[1],3);self.assertEqual(train.metrics(y,p),train.metrics(y,p))
    def test_small_xgboost_model_round_trip_has_three_valid_probabilities(self):
        rows,_=train.load_dataset(self.make_dataset());fold=train.session_folds(rows,3)[-1];evaluation=[r for r in rows if r['partition']=='evaluacion_exploratoria']
        model,probabilities,_=train.train_xgb(*fold,evaluation)
        self.assertEqual(probabilities.shape,(len(evaluation),3));self.assertTrue(((probabilities>=0)&(probabilities<=1)).all());self.assertTrue(((probabilities.sum(axis=1)-1)<1e-6).all())
        path=Path(tempfile.mkdtemp())/'model.json';model.save_model(path)
        import xgboost as xgb
        reloaded=xgb.XGBClassifier();reloaded.load_model(path);self.assertEqual(reloaded.predict_proba(train.arrays(evaluation)[0]).shape[1],3)
    def test_walk_forward_evaluates_three_external_folds_causally(self):
        rows,_=train.load_dataset(self.make_dataset());folds=train.walk_forward(rows,3)
        self.assertEqual(len(folds),3)
        for fold in folds:
            self.assertEqual(set(fold['models']),{'standard','class_weighted','regularized','majority','frequency'})
            self.assertIsNotNone(fold['models']['class_weighted']['training']['weights'])
            self.assertLess(train.iso(fold['max_training_label_available_at_utc']),train.iso(fold['causal_cutoff_utc']))
            self.assertLess(train.iso(fold['max_early_stop_label_available_at_utc']),train.iso(fold['causal_cutoff_utc']))
            self.assertEqual(len(fold['out_of_sample_predictions']),sum(1 for row in rows if row['session_date_ny'] in fold['external_sessions']))
            self.assertIn('regularized',fold['paired_bootstrap']['against_standard'])
            self.assertIn('standard',fold['paired_bootstrap']['against_frequency'])

    def test_paired_bootstrap_is_reproducible_and_aligned_by_session(self):
        rows,_=train.load_dataset(self.make_dataset()); external=[row for row in rows if row['partition']=='desarrollo'][:12]
        _,y=train.arrays(external); left=train.probabilities_frequency(y,len(external)); right=train.probabilities_majority(y,len(external))
        self.assertEqual(train.paired_bootstrap(external,y,left,right,iterations=20),train.paired_bootstrap(external,y,left,right,iterations=20))
        with self.assertRaisesRegex(ValueError,'alineadas'): train.paired_bootstrap(external,y,left[:-1],right)

    def test_refit_final_records_weights_from_all_development_rows(self):
        rows,_=train.load_dataset(self.make_dataset()); development=[row for row in rows if row['partition']=='desarrollo']
        _,info=train.refit_final(development,'class_weighted')
        self.assertEqual(info['weights'],train.class_weights(train.arrays(development)[1]).tolist())

    def test_missing_class_is_explicitly_rejected(self):
        with self.assertRaisesRegex(ValueError,'faltan clases'): train.class_weights(__import__('numpy').array([0,0,1]))

if __name__=='__main__':unittest.main()
