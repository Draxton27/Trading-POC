# Fase 31: inferencia causal local

La inferencia usa el `model.json` congelado de Fase 29 con Python 3.12 y XGBoost 2.1.4. No entrena, no modifica el modelo, no se conecta a IBKR ni crea órdenes. TypeScript prepara las diez variables con `calculatePhase23Features` de Fase 23 y Python recibe únicamente el vector en el orden congelado: `return_1`, `return_4`, `distance_ema9`, `distance_sma20`, `bollinger_position`, `relative_volume_20`, `candle_range`, `candle_body`, `atr14_relative`, `minutes_from_open`.

## Windows

```powershell
$env:PYTHON = (Resolve-Path .venv\phase28\Scripts\python.exe)
$env:TRADING_POC_ML_RUN_DIR = (Resolve-Path .\trading_poc_001_bollinger\output\real\phase28-xgboost\20261020T134917Z-d22ccbc44e1e).Path
$env:TRADING_POC_ML_INFERENCE_LOG = (Join-Path $env:LOCALAPPDATA 'Trading-POC\ml-inference\records.jsonl')
npm.cmd run ml:infer -- --csv .\trading_poc_001_bollinger\data\NVDA_ALPACA_SIP_15min_20211017_20261017.csv --model-dir $env:TRADING_POC_ML_RUN_DIR --log $env:TRADING_POC_ML_INFERENCE_LOG --mode REPLAY
```

Cuando el dataset privado de Fase 23 esté disponible, agregue `--phase23-dataset <carpeta-del-dataset>` para exigir equivalencia numérica de las diez variables en la fila del mismo `bar_start_utc` antes de cargar el modelo.

La entrada exige CSV y metadatos de NVDA, 15 minutos, Alpaca SIP, `adjustment=split`, sesión regular y calendario Alpaca. Rechaza velas sintéticas, incompletas, desordenadas, fuera de calendario, con gaps que impidan indicadores y velas aún abiertas. Los históricos disponibles terminan en octubre de 2026, por lo que solo pueden generar `REPLAY`; la interfaz los marca como históricos y no como predicción actual.

`PROSPECTIVE_CAPTURE` está bloqueado explícitamente. Un CSV local y sus timestamps declarados solo pueden crear `REPLAY`; no constituyen evidencia de recepción automática ni de procedencia verificable. Se habilitará únicamente junto con una ingesta que registre por sí misma la recepción y pueda probar que la captura ocurrió antes del desenlace de cuatro velas. El registro JSONL privado usa un bloqueo exclusivo, es append-only, encadenado por hash e idempotente por modelo, vela, modo y hash de variables. La apertura hipotética de Fase 23 sucede al abrir la vela siguiente; si el registro ocurre después, se muestra expresamente que no representa una oportunidad ejecutable a esa apertura.

Para comparar con filas locales de Fase 23, ejecute el comando con el mismo CSV y calendario que produjeron el dataset y contraste las diez variables y su hash. Esta verificación solo puede realizarse cuando el dataset privado existe; CI usa fixtures sintéticas y no afirma equivalencia sobre históricos privados.
