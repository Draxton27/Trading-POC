"""Read-only Fase 31 inference. It never trains or writes the model."""
from __future__ import annotations
import hashlib,json,math,sys
from pathlib import Path
import numpy as np

FEATURES=("return_1","return_4","distance_ema9","distance_sma20","bollinger_position","relative_volume_20","candle_range","candle_body","atr14_relative","minutes_from_open")
CLASSES=("ALCISTA","BAJISTA","LATERAL")
def fail(message): raise ValueError(message)
def predict(request):
    import xgboost as xgb
    if xgb.__version__!='2.1.4': fail(f'XGBoost incompatible: se requiere 2.1.4 y se encontró {xgb.__version__}.')
    path=Path(request.get('modelPath',''))
    if path.name!='model.json' or not path.is_file(): fail('Modelo congelado no disponible.')
    raw=path.read_bytes();shape=json.loads(raw)
    if shape.get('version')!=[2,1,4] or shape.get('learner',{}).get('learner_model_param',{}).get('num_class')!='3' or shape.get('learner',{}).get('learner_model_param',{}).get('num_feature')!='10': fail('Modelo incompatible con NVDA 15m y diez variables.')
    features=request.get('features');
    if not isinstance(features,dict) or tuple(features)!=FEATURES: fail('Orden o definición de variables incompatible.')
    values=np.array([[features[name] for name in FEATURES]],dtype=np.float64)
    if not np.isfinite(values).all(): fail('Variables no finitas.')
    model=xgb.XGBClassifier();model.load_model(str(path));prob=model.predict_proba(values)[0]
    if len(prob)!=3 or not np.isfinite(prob).all() or np.any(prob<0) or abs(float(prob.sum())-1)>1e-9: fail('Probabilidades inválidas.')
    probabilities={name:float(prob[i]) for i,name in enumerate(CLASSES)}
    return {'modelSha256':hashlib.sha256(raw).hexdigest(),'probabilities':probabilities,'dominantClass':CLASSES[int(prob.argmax())]}
if __name__=='__main__':
    try: print(json.dumps(predict(json.load(sys.stdin)),separators=(',',':')))
    except Exception as error: print(json.dumps({'error':str(error)}));sys.exit(1)
