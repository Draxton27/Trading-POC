# Fase 28: XGBoost local

El módulo entrena únicamente con el dataset local de Fase 23. No alimenta la UI, el asistente, señales ni IBKR. 2025--2026 se informa como evaluación retrospectiva exploratoria, ya examinada en fases anteriores.

## Windows

```powershell
py -3.12 -m venv .venv\phase28
.venv\phase28\Scripts\python -m pip install --only-binary=:all: -r ml\phase28\requirements.txt
npm.cmd run dataset:phase23 -w trading-poc-001-bollinger
$env:PYTHON = (Resolve-Path .venv\phase28\Scripts\python.exe)
npm.cmd run ml:train
```

Python 3.12 AMD64 es la configuración probada. Se fijan NumPy 2.1.3, XGBoost 2.1.4 y scikit-learn 1.6.1. `--only-binary=:all:` rechaza de forma explícita una combinación sin wheel compatible en vez de intentar una compilación local. Puede indicar un dataset concreto con `TRADING_POC_PHASE23_DATASET`, o ejecutar directamente `python ml/phase28/train.py --dataset <carpeta>`. Los artefactos se crean bajo `trading_poc_001_bollinger/output/real/phase28-xgboost/` y nunca se sobrescriben: modelo, informe, predicciones exploratorias y manifiesto de reproducción.

Antes de entrenar se valida hash, `SHA256SUMS` cuando existe, contrato `nvda-15m-v1`, columnas, timestamps UTC, duplicados, orden, etiquetas y disponibilidad temporal. Las diez entradas permitidas son nueve indicadores de Fase 23 más `minutes_from_open`; los campos de etiqueta y precios futuros se rechazan como entradas. El reporte incluye tablas de calibración por clase; son descriptivas y no validan el uso operativo de probabilidades.

La búsqueda predefinida contiene dos configuraciones pequeñas. Early stopping usa el último fold cronológico de desarrollo; 2025--2026 no participa en selección, calibración ni ajuste. Cada fold purga etiquetas cuya disponibilidad no precede el comienzo de validación. No hay embargo adicional porque Fase 23 excluye horizontes que crucen una sesión; esto debe reevaluarse si cambia el horizonte.

## Fase 29: validación walk-forward

Cada uno de los tres folds externos conserva predicciones fuera de muestra alineadas por `bar_start_utc`, `session_date_ny` y etiqueta. Para cada variante, el bloque interno cronológico solo decide `n_estimators` mediante *early stopping*. Después la variante se reentrena con todas las filas de desarrollo causalmente disponibles antes del fold externo. Los baselines mayoritario y por frecuencia usan esas mismas filas.

`report.json` añade por fold `causal_cutoff_utc`, los máximos de disponibilidad de etiquetas de entrenamiento y del bloque interno, `out_of_sample_predictions` y dos conjuntos de intervalos bootstrap pareados por sesiones: `against_standard` y `against_frequency`. Cada intervalo es diferencia `left_minus_right` y cubre Macro F1, exactitud balanceada, log loss, precisión BAJISTA y recall BAJISTA. Si hay menos de dos sesiones externas, se informa `insufficient_sessions` en vez de simular incertidumbre.

La variante final se selecciona solo con los tres folds de desarrollo anteriores a 2025. Sus pesos documentados se calculan de todas las filas de desarrollo usadas en el reentrenamiento final; no proceden del subconjunto de *early stopping*. Las clases ausentes o datos insuficientes detienen el entrenamiento con un error explícito. Los resultados de 2025 y 2026 siguen siendo exclusivamente exploratorios retrospectivos.
