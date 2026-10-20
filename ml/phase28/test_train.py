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
        for day,part in [('2024-01-02','desarrollo'),('2024-01-03','desarrollo'),('2024-01-04','desarrollo'),('2024-01-05','desarrollo'),('2025-01-02','evaluacion_exploratoria')]:
            for minute,label in [(0,'ALCISTA'),(15,'BAJISTA'),(30,'LATERAL')]:
                stamp=(datetime.fromisoformat(day+'T14:30:00+00:00')+timedelta(minutes=minute)).isoformat(timespec='milliseconds').replace('+00:00','Z')
                row={name:'0.1' for name in fields};row.update({'partition':part,'session_date_ny':day,'bar_start_utc':stamp,'observed_at_utc':stamp,'available_at_utc':stamp,'label_available_at_utc':stamp,'label':label,'label_entry_open':'10','label_exit_close':'10','label_change':'0','label_atr14_price_units':'1'})
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
        self.assertEqual(len(rows),15);self.assertTrue(train.FORBIDDEN.isdisjoint(train.FEATURES))
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

if __name__=='__main__':unittest.main()
