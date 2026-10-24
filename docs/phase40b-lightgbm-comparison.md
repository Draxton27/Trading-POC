# Fase 40B: comparación histórica XGBoost y LightGBM

La comparación utiliza el experimento privado NVDA IEX `raw` de Fase 38E. Los modelos XGBoost y sus predicciones se leen sin reentrenarlos. LightGBM 4.7.0 se entrena por separado en cada fold con las mismas diez variables, etiquetas, disponibilidad simulada, sesiones externas y purga temporal. `delayed` es el escenario principal; `ideal` se presenta aparte.

## Instalación y reproducción local en Windows

Desde la raíz del repositorio, con Python 3.12 x64 y el entorno `.venv\phase28-py312`:

```powershell
.\.venv\phase28-py312\Scripts\python.exe -m pip install --only-binary=:all: -r ml\phase40b\requirements.txt
.\.venv\phase28-py312\Scripts\python.exe -m unittest discover -s ml\phase40b -p "test_*.py"
.\.venv\phase28-py312\Scripts\python.exe -m ml.phase40b.experiment --run private\ml-iex\phase38e-20261023-v1 --out private\ml-iex\phase40b-lightgbm-v2
```

La salida debe ser una carpeta privada **nueva**. Incluye `manifest.json`, `report.json`, `report.md`, `predictions.csv`, seis modelos por fold y `SHA256SUMS`. Si `v2` ya existe, use otro nombre; el CLI rechaza sobrescrituras. Nunca se usan filas o precios futuros como variables. Los desenlaces se incorporan solo después de predecir para calcular métricas. Los registros históricos REST no se presentan como recepciones prospectivas.

La dependencia fija es [LightGBM 4.7.0](https://pypi.org/project/lightgbm/4.7.0/), instalada únicamente desde wheel. Se reutilizan NumPy 2.1.3, XGBoost 2.1.4 y scikit-learn 1.6.1 de Fase 28. La [API oficial de LightGBM](https://lightgbm.readthedocs.io/en/stable/Python-Intro.html) documenta `best_iteration` y el early stopping con conjunto de validación. El protocolo fija semilla 7, dos hilos CPU, máximo 300 iteraciones y `multi_logloss` interno. Una vez elegido `best_iteration` con el bloque interno anterior, un modelo nuevo se ajusta con **todas** las filas causales previas al fold externo. No se ajustaron pesos de clase ni umbrales BAJISTA.

## Controles metodológicos

- El lector de Fase 40A verifica hashes y el contrato histórico completo; se reconstruyen los folds de 38E con 252 sesiones previas y bloques externos de 126 sesiones. Se compara cada timestamp, corte, fila, etiqueta y conteo con el reporte original. La etiqueta de entrenamiento debe estar disponible estrictamente antes del corte externo; el bloque interno repite la purga antes de early stopping.
- Antes de entrenar o crear la salida, las métricas XGBoost recalculadas por fold y agregadas deben coincidir con el reporte 38E dentro de `1e-9`. Una discrepancia detiene el experimento.
- Los cuatro comparadores probabilísticos (`xgboost`, `lightgbm`, `frequency`, `linear`) comparten exactamente las mismas filas evaluables. Se usa `argmax` fijo. El reporte incluye métricas por fold y escenario, clases, confusiones, calibración descriptiva y AUC/average precision BAJISTA cuando existen ambas clases.
- El bootstrap remuestrea grupos completos con los mismos índices para ambos modelos: 400 réplicas por sesión, semana y mes. En el agregado se conserva el número de fold en la clave de agrupación. Si falta una clase en una réplica, AUC se omite para esa réplica y se informa el número válido.
- El manifiesto deja constancia de dos archivos actuales cuyo hash difiere del snapshot de código original (`phase38e-cli.ts` y `ml/phase38e/replay.py`). No atribuye la generación del run 38E al código actual. Los hashes de los archivos originales se conservaron.

## Resultado del run privado local

El run produjo 6.536 filas evaluables `ideal` y 6.219 `delayed`, distribuidas en tres folds por escenario. Las métricas XGBoost recalculadas coincidieron con 38E.

| Escenario | Modelo | Macro F1 | Recall BAJISTA | Precision BAJISTA | Log loss | PR-AUC BAJISTA |
|---|---|---:|---:|---:|---:|---:|
| delayed | XGBoost original | 0,2877 | 0,0358 | 0,3315 | 1,0554 | 0,3104 |
| delayed | LightGBM | 0,2752 | 0,0364 | 0,3425 | 1,0555 | 0,3147 |
| delayed | Frecuencia | 0,2086 | 0 | 0 | 1,0670 | 0,2766 |
| delayed | Regresión logística | 0,2350 | 0,0059 | 0,4000 | 1,0622 | 0,2902 |
| ideal | XGBoost original | 0,3072 | 0,0598 | 0,3964 | 1,0609 | 0,3307 |
| ideal | LightGBM | 0,3048 | 0,0620 | 0,3662 | 1,0637 | 0,3194 |

En `delayed`, **LightGBM − XGBoost** fue aproximadamente −0,0125 en Macro F1, +0,0006 en recall BAJISTA, +0,0110 en precision BAJISTA, +0,0001 en log loss (más alto es peor) y +0,0043 en PR-AUC. El intervalo descriptivo del 95 % por sesiones fue [−0,0215, −0,0032] para Macro F1, [−0,0070, +0,0090] para recall BAJISTA y [−0,0030, +0,0123] para PR-AUC. El primer fold mostró mejoras según la regla descriptiva fijada; los folds segundo y tercero no. El agregado se clasifica `MIXED_RESULTS`, sin evidencia de una mejora BAJISTA estable.

En `ideal`, LightGBM − XGBoost fue aproximadamente −0,0024 en Macro F1, +0,0022 en recall BAJISTA, −0,0302 en precision BAJISTA y +0,0028 en log loss. Los objetivos de `ideal` y `delayed` pueden diferir y no se fusionan.

Las cifras completas, intervalos por fold, semana y mes, matrices y exclusiones están en el [reporte privado local](../private/ml-iex/phase40b-lightgbm-v2/report.md) cuando se ejecuta el comando. Los intervalos por grupos no garantizan independencia entre jornadas ni capturan cambios prolongados de régimen. La comparación reutiliza un histórico que el proyecto ya examinó; no es una validación prospectiva independiente y no justifica sustituir el modelo congelado.

## Siguiente experimento posible

Fase 40C puede estudiar **una familia de variables por vez** —memoria temporal, estructura de tendencia o volumen y volatilidad— y después evaluar contexto QQQ/SMH solo si existe utilidad incremental verificable. Debe mantener folds, objetivos, disponibilidad y purga definidos antes de mirar resultados. Esta fase no implementa esas variables, inferencia Live, señales CALL/PUT ni órdenes.
