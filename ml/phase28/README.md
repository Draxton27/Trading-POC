# Fase 28: XGBoost local

El módulo entrena únicamente con el dataset local de Fase 23. No alimenta la UI, el asistente, señales ni IBKR. 2025--2026 se informa como evaluación retrospectiva exploratoria, ya examinada en fases anteriores.

## Windows

```powershell
py -3 -m venv .venv\phase28
.venv\phase28\Scripts\python -m pip install -r ml\phase28\requirements.txt
npm.cmd run dataset:phase23 -w trading-poc-001-bollinger
$env:PYTHON = (Resolve-Path .venv\phase28\Scripts\python.exe)
npm.cmd run ml:train
```

Puede indicar un dataset concreto con `TRADING_POC_PHASE23_DATASET`, o ejecutar directamente `python ml/phase28/train.py --dataset <carpeta>`. Los artefactos se crean bajo `trading_poc_001_bollinger/output/real/phase28-xgboost/` y nunca se sobrescriben: modelo, informe, predicciones exploratorias y manifiesto de reproducción.

Antes de entrenar se valida hash, contrato `nvda-15m-v1`, columnas, timestamps UTC, duplicados, orden, etiquetas y disponibilidad temporal. Las diez entradas permitidas son nueve indicadores de Fase 23 más `minutes_from_open`; los campos de etiqueta y precios futuros se rechazan como entradas.

La búsqueda predefinida contiene dos configuraciones pequeñas. Early stopping usa el último fold cronológico de desarrollo; 2025--2026 no participa en selección, calibración ni ajuste. Cada fold purga etiquetas cuya disponibilidad no precede el comienzo de validación. No hay embargo adicional porque Fase 23 excluye horizontes que crucen una sesión; esto debe reevaluarse si cambia el horizonte.
