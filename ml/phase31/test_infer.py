import json,tempfile,unittest
from pathlib import Path
import numpy as np
import xgboost as xgb
from ml.phase31 import infer

class FrozenInferenceTests(unittest.TestCase):
    def model(self):
        directory=Path(tempfile.mkdtemp());path=directory/'model.json'
        rows=np.array([[float(i+j) for j in range(10)] for i in range(9)]);labels=np.array([0,1,2,0,1,2,0,1,2])
        model=xgb.XGBClassifier(objective='multi:softprob',num_class=3,n_estimators=2,random_state=7,n_jobs=1)
        model.fit(rows,labels);model.save_model(path);return directory,path
    def test_frozen_model_is_deterministic_and_has_three_probabilities(self):
        directory,path=self.model();self.addCleanup(lambda: __import__('shutil').rmtree(directory))
        request={'modelPath':str(path),'features':{name:float(i) for i,name in enumerate(infer.FEATURES)}}
        one,two=infer.predict(request),infer.predict(request)
        self.assertEqual(one,two);self.assertEqual(set(one['probabilities']),set(infer.CLASSES));self.assertAlmostEqual(sum(one['probabilities'].values()),1.0)
    def test_rejects_feature_order_or_missing_model(self):
        with self.assertRaises(ValueError):infer.predict({'modelPath':'missing/model.json','features':{}})
        directory,path=self.model();self.addCleanup(lambda: __import__('shutil').rmtree(directory))
        values={name:float(i) for i,name in enumerate(reversed(infer.FEATURES))}
        with self.assertRaises(ValueError):infer.predict({'modelPath':str(path),'features':values})

if __name__=='__main__':unittest.main()
