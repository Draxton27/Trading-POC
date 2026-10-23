"""Read-only report over immutable IEX Live observations and first outcomes."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path

import numpy as np

from ml.phase28.train import CLASSES, metrics


def read_ledger(path):
    path = Path(path)
    if not path.exists():
        return []
    previous = None
    rows = []
    for line in path.read_text(encoding='utf8').splitlines():
        match = re.search(r',"recordHash":"([a-f0-9]{64})"}$', line)
        if not match:
            raise ValueError('Registro IEX sin hash terminal válido.')
        expected = hashlib.sha256((line[:match.start()] + '}').encode('utf8')).hexdigest()
        row = json.loads(line)
        record_hash = row.get('recordHash')
        if row.get('schema') != 'phase38f-observation-v1' or row.get('previousHash') != previous or record_hash != expected:
            raise ValueError('Integridad del ledger prospectivo IEX inválida.')
        previous = record_hash
        rows.append(row)
    return rows


def report(rows):
    predictions = {}
    evaluations = {}
    for row in rows:
        if row['kind'] == 'PREDICTION':
            if row['id'] in predictions or row['mode'] != 'IEX_PROSPECTIVE_OBSERVATION':
                raise ValueError('Predicción duplicada o modo incompatible.')
            predictions[row['id']] = row
        elif row['kind'] == 'EVALUATION':
            key = row['predictionId']
            if key in evaluations:
                raise ValueError('Evaluación original duplicada.')
            evaluations[key] = row
        else:
            raise ValueError('Tipo de registro desconocido.')
    if any(key not in predictions for key in evaluations):
        raise ValueError('Evaluación sin predicción de origen.')
    paired = [(predictions[key], evaluation) for key, evaluation in evaluations.items() if evaluation['status'] == 'EVALUATED']
    grouped = defaultdict(list)
    for prediction, evaluation in paired:
        if evaluation['label'] not in CLASSES:
            raise ValueError('Etiqueta IEX inválida.')
        grouped[prediction['barStartUtc'][:10]].append((prediction, evaluation))

    def scores(pairs):
        y = np.array([CLASSES.index(evaluation['label']) for _, evaluation in pairs])
        result = {}
        for name in ('xgboost', 'frequency', 'linear'):
            probabilities = np.array([prediction['probabilities'][name] for prediction, _ in pairs], dtype=float)
            if (probabilities.shape != (len(pairs), 3) or not np.isfinite(probabilities).all()
                    or np.any(probabilities < 0) or np.any(probabilities > 1)
                    or not np.allclose(probabilities.sum(axis=1), 1, atol=1e-6)):
                raise ValueError('Probabilidades prospectivas inválidas.')
            result[name] = metrics(y, probabilities)
        return result

    sessions = len(grouped)
    return {'schema': 'phase38f-prospective-report-v1', 'status': 'INSUFFICIENT_EVIDENCE',
            'warning': 'Observación experimental IEX. No es recomendación ni señal operativa.',
            'predictions': len(predictions), 'evaluated': len(paired), 'sessions': sessions,
            'excluded': {status: sum(e['status'] == status for e in evaluations.values())
                         for status in ('MISSING_ENTRY', 'MISSING_OUTCOME')},
            'metrics': scores(paired) if paired else None,
            'by_session': {day: {'rows': len(group), 'metrics': scores(group)} for day, group in sorted(grouped.items())}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--ledger', required=True)
    args = parser.parse_args()
    print(json.dumps(report(read_ledger(args.ledger)), ensure_ascii=False))
