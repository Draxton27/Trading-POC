"""Short Spanish research report; all detailed scores stay in private JSON."""

from ml.phase41d.registry import DEFINITIONS


def _number(value):
    return 'N/D' if value is None else f'{value:.4f}'


def markdown(report):
    lines = ['# Fase 41F: comparación F0/F1/F2', '',
             '**Estado: HISTORICAL_EXPLORED.** El histórico ya fue examinado y no ofrece '
             'validación prospectiva independiente. Ningún modelo se promovió a producción.', '',
             f"Observaciones reconstruidas: {report['reconstructed_observations']}. "
             f"Filas externas cotejadas con 41E: {report['external_parity']['external_rows_checked']}.", '',
             '## Resultados del escenario principal (delayed, SIP +20 simulado)', '']
    for definition in DEFINITIONS:
        target = definition.target_id
        lines.extend([f'### {target}', '',
                      '| Modelo | Variables | N | Macro F1 / PR-AUC | Balanced accuracy | '
                      'Recall BAJISTA / positivo | Precision BAJISTA / positivo | Brier |',
                      '|---|---|---:|---:|---:|---:|---:|---:|'])
        rows = [row for row in report['metrics_pooled'] if
                row['scenario'] == 'delayed' and row['population'] in ('common', 'frozen_38e_common')
                and row['target'] == target]
        for row in rows:
            m = row['metrics']
            klass = 'BAJISTA' if len(definition.classes) == 3 else definition.classes[0]
            lines.append(f"| {row['model']} | {row['feature_set']} | {m['rows']} | "
                         f"{_number(m['macro_f1'] if len(definition.classes) == 3 else m['pr_auc'])} | "
                         f"{_number(m['balanced_accuracy'])} | "
                         f"{_number(m['per_class'][klass]['recall'])} | "
                         f"{_number(m['per_class'][klass]['precision'])} | "
                         f"{_number(m['brier'])} |")
        lines.append('')
    lines.extend(['## Lectura metodológica', '',
                  'Las comparaciones F1-F0, F2-F0 y F2-F1 usan las mismas filas y etiquetas '
                  'dentro de cada objetivo, algoritmo y escenario. Los intervalos pareados por '
                  'sesión, semana y mes figuran en `paired-comparisons.json`. La población amplia '
                  'F0/F1 aparece por separado en `metrics-pooled.json` y no demuestra por sí misma '
                  'una mejora frente a F2.', '',
                  'Las etiquetas DOWN_TOUCH y PERSISTENT_BEAR tienen prevalencias diferentes. '
                  'No se combinan sus métricas para declarar un ganador. Las probabilidades y '
                  'los rangos históricos no son señales de opciones ni precios de ejecución.', '',
                  '## Limitaciones', ''])
    lines.extend(f'- {item}' for item in report['limitations'])
    lines.extend(['', 'Los folds externos conservaron los cortes de 38E. El número de árboles '
                  'se fijó con validación interna anterior a cada fold; el preprocesamiento y '
                  'la prevalencia se ajustaron únicamente con entrenamiento causal. Las '
                  'métricas de estos folds son retrospectivas y exploratorias.', ''])
    return '\n'.join(lines)
