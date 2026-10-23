"""Synthetic checks; these fixtures do not imply predictive performance."""
import hashlib, json, tempfile, unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from ml.phase28.train import FEATURES
from ml.phase38b.replay import load_run, run, training_before, visible


def instant(value): return value.isoformat(timespec='milliseconds').replace('+00:00','Z')


def fixtures():
    rows=[]
    for session in range(12):
        day=datetime(2024,1,2,tzinfo=timezone.utc)+timedelta(days=session)
        for index in range(9):
            start=day+timedelta(hours=15,minutes=15*index)
            end=start+timedelta(minutes=15)
            row={'mode':'HISTORICAL_REPLAY','symbol':'NVDA','timeframe':'15m','session_date_ny':day.date().isoformat(),
                'bar_start_utc':instant(start),'bar_end_utc':instant(end),
                'features':{key:float((session*9+index)%11)/10 for key in FEATURES},'feature_sha256':'a'*64,
                'ideal_available_at_utc':instant(end),'delayed_available_at_utc':instant(end+timedelta(minutes=20)),
                'historical_received_at_utc':None,'next_entry_at_utc':instant(end),
                'label':['ALCISTA','BAJISTA','LATERAL'][index%3],
                'label_available_at_utc':instant(start+timedelta(minutes=75)),'exclusion':None}
            rows.append(row)
    return rows


class ReplayTests(unittest.TestCase):
    def test_clock_hides_features_and_outcome(self):
        row=fixtures()[0]
        self.assertEqual(visible(row,row['bar_start_utc'],'ideal'),(None,None))
        self.assertEqual(visible(row,row['ideal_available_at_utc'],'ideal')[1],None)
        self.assertEqual(visible(row,row['delayed_available_at_utc'],'delayed')[1],None)
        self.assertEqual(visible(row,row['label_available_at_utc'],'delayed')[1],row['label'])

    def test_train_purges_late_labels_and_entire_test_session(self):
        rows=fixtures();cutoff=rows[27]['ideal_available_at_utc'];first_day=rows[27]['session_date_ny']
        train=training_before(rows,cutoff,first_day)
        self.assertTrue(train)
        self.assertTrue(all(row['session_date_ny']<first_day and row['label_available_at_utc']<cutoff for row in train))
        rows[0]['label_available_at_utc']=rows[27]['label_available_at_utc']
        self.assertNotIn(rows[0]['bar_start_utc'],[row['bar_start_utc'] for row in training_before(rows,cutoff,first_day)])

    def test_three_folds_same_test_rows_and_no_overwrite(self):
        rows=fixtures()
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder);data=json.dumps(rows)+'\n';(path/'observations.json').write_bytes(data.encode('utf8'))
            (path/'manifest.json').write_text(json.dumps({'schema':'phase38b-v1','source':{'symbol':'NVDA','feed':'sip','sha256':{'csv':'a'*64}},'observationsSha256':hashlib.sha256(data.encode()).hexdigest(),'rows':len(rows)}),encoding='utf8')
            load_run(path)
            result=run(path,3,3)
            self.assertEqual(len(result['folds']),3)
            for fold in result['folds']:
                self.assertLess(fold['max_train_label_available_at_utc'],fold['cutoff_utc'])
                self.assertEqual(fold['metrics']['xgboost']['per_class']['BAJISTA']['support'],fold['metrics']['frequency']['per_class']['BAJISTA']['support'])
            self.assertEqual(result['pooled']['rows'],81)
            with tempfile.TemporaryDirectory() as second:
                copy=Path(second)
                (copy/'observations.json').write_bytes((path/'observations.json').read_bytes())
                (copy/'manifest.json').write_bytes((path/'manifest.json').read_bytes())
                repeated=run(copy,3,3)
                self.assertEqual(repeated['model_hashes'],result['model_hashes'])
                self.assertEqual(repeated['pooled'],result['pooled'])
            with self.assertRaisesRegex(ValueError,'directorio nuevo'):run(path)


if __name__=='__main__': unittest.main()
