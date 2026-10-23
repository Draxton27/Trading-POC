import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from ml.phase28.train import FEATURES
from ml.phase38c.replay import training_before, inference_events
from ml.phase38e.replay import CODE_FILES, grouping_sensitivity, load_run

ROOT=Path(__file__).resolve().parents[2]

def digest(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()

class IexReplayTests(unittest.TestCase):
    def pair(self):
        features={name:0.01 for name in FEATURES}
        base={'phase':'38E','mode':'HISTORICAL_REPLAY','feed':'iex','adjustment':'raw',
              'historical_received_at_utc':None,'bar_start_utc':'2026-10-20T13:30:00.000Z',
              'bar_end_utc':'2026-10-20T13:45:00.000Z','session_date_ny':'2026-10-20',
              'features':features,'feature_sha256':'test','label':'ALCISTA','exclusion':None}
        return [{**base,'scenario':'ideal','available_at_utc':'2026-10-20T13:45:00.000Z',
                 'reference_entry_at_utc':'2026-10-20T14:00:00.000Z',
                 'minutes_until_reference_entry':15,
                 'label_available_at_utc':'2026-10-20T15:00:00.000Z'},
                {**base,'scenario':'delayed','available_at_utc':'2026-10-20T14:05:00.000Z',
                 'reference_entry_at_utc':'2026-10-20T14:15:00.000Z',
                 'minutes_until_reference_entry':10,
                 'label_available_at_utc':'2026-10-20T15:15:00.000Z'}]

    def fixture(self,directory,rows):
        directory=Path(directory)
        payload=json.dumps(rows)+'\n'
        (directory/'observations.json').write_text(payload,encoding='utf8')
        manifest={'schema':'phase38e-v1','source':{'symbol':'NVDA','feed':'iex','adjustment':'raw',
                  'minuteTimeframe':'1Min','timeframe':'15m'},'rows':len(rows),
                  'observationsSha256':digest(directory/'observations.json'),
                  'codeSha256':{name:digest(ROOT/name) for name in CODE_FILES}}
        (directory/'manifest.json').write_text(json.dumps(manifest),encoding='utf8')
        (directory/'SHA256SUMS').write_text(''.join(f'{digest(directory/name)}  {name}\n'
            for name in ('observations.json','manifest.json')),encoding='utf8')

    def test_rejects_future_information_and_altered_dataset(self):
        with tempfile.TemporaryDirectory() as folder:
            rows=self.pair();self.fixture(folder,rows)
            loaded,_=load_run(folder);self.assertEqual(len(loaded),2)
            rows[1]['available_at_utc']='2026-10-20T13:45:00.000Z'
            self.fixture(folder,rows)
            with self.assertRaisesRegex(ValueError,'Disponibilidad'):
                load_run(folder)
            (Path(folder)/'observations.json').write_text('tampered',encoding='utf8')
            with self.assertRaisesRegex(ValueError,'Hashes'):
                load_run(folder)

    def test_purge_uses_label_availability_before_cutoff(self):
        rows=self.pair()
        event=inference_events(rows)[0]
        self.assertNotIn('label',event)
        self.assertNotIn('label_available_at_utc',event)
        self.assertEqual(training_before(rows,'2026-10-20T15:00:00.000Z','2026-10-21'),[])
        self.assertEqual(len(training_before(rows,'2026-10-20T15:10:00.000Z','2026-10-21')),1)

    def test_grouped_sensitivity_reproducible(self):
        rows=[]
        for index,day in enumerate(('2026-10-20','2026-10-21','2026-10-27','2026-11-03')):
            rows.append({'session_date_ny':day,'label':('ALCISTA','BAJISTA','LATERAL')[index%3],
                'prob_xgboost':[.7,.2,.1],'prob_frequency':[.34,.33,.33]})
        self.assertEqual(grouping_sensitivity(rows,iterations=12),grouping_sensitivity(rows,iterations=12))
        self.assertEqual(grouping_sensitivity(rows,iterations=12)['month']['groups'],2)

if __name__=='__main__': unittest.main()
