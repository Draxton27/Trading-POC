# Fase 35: evaluación de observaciones adelantadas

`ml:evaluate` lee exclusivamente el ledger privado Alpaca SIP, el ledger de observaciones de Fase 34, el calendario oficial acumulativo y el modelo congelado configurado. No acepta CSV manual, DEMO ni cotizaciones IBKR. Comprueba las cadenas de hashes, la procedencia y las revisiones exactas usadas al predecir. Recalcula las diez variables de Fase 23 sobre esas mismas velas causales; el ATR14 de referencia es el `atr14_relative` guardado multiplicado por el cierre de la revisión original de `t`. Si faltan datos o el modelo no coincide, no inventa un resultado.

La entrada de referencia es la **apertura de `t+1`**, la salida el **cierre de `t+4`**. La clase real usa `classifyMovement(close(t+4)-open(t+1), ATR14(t))` con los umbrales congelados de Fase 23. Las cuatro velas deben ser consecutivas dentro de la misma sesión Alpaca y estar recibidas antes de evaluar. Se exige que la predicción original estuviera registrada estrictamente antes del cierre de `t+4`. Completar un resultado después del desenlace no crea retrospectivamente una predicción.

La **primera evaluación verificada queda fija** en `private/ml-evaluation/records.jsonl`, con bloqueo exclusivo y hashes encadenados. El ledger se relee dentro del bloqueo: solo admite una fila `EVALUATED` por `predictionId`, incluso si dos procesos habían calculado resultados con revisiones distintas. La propuesta tardía se registra como `REVISION_NOTICE` que referencia el hash de aquella evaluación original; repetir el mismo aviso es idempotente. Un ledger que ya contenga dos evaluaciones originales para la misma predicción se rechaza. Se eligen las últimas revisiones que ya estaban recibidas al evaluar. Si una revisión posterior cambia una vela de resultado, el siguiente ciclo agrega `REVISION_NOTICE`; no reemplaza la evaluación original ni altera sus métricas. `PENDING` indica horizonte todavía abierto o velas aún no recibidas; `NON_EVALUABLE` identifica incompatibilidades o huecos confirmados. No se interpolan velas.

La matriz de confusión, las métricas por clase, log loss, Brier y los intervalos se calculan únicamente con evaluaciones verificadas. La calibración divide cada probabilidad en cinco intervalos descriptivos. El baseline usa la probabilidad por frecuencias **guardada en el último fold causal de desarrollo anterior a 2025** del `report.json` congelado, si está presente y es consistente; nunca aprende de las etiquetas de estas observaciones. Los intervalos percentiles remuestrean sesiones completas con los mismos índices para el modelo y el baseline; solo se muestran con al menos 30 observaciones y 10 sesiones. Son descriptivos; no demuestran superioridad estadística ni calibración operativa.

## Windows

Configure una vez en `.env.local` `TRADING_POC_ML_RUN_DIR`, `TRADING_POC_ALPACA_INGESTION_LOG`, `TRADING_POC_ALPACA_INGESTION_CALENDAR` y `TRADING_POC_ML_FORWARD_OBSERVATION_LOG` si difieren de las ubicaciones privadas predeterminadas. Opcionalmente configure `TRADING_POC_ML_EVALUATION_LOG` y `TRADING_POC_ML_EVALUATION_STATUS`. Estos archivos están excluidos de Git.

```powershell
npm.cmd run ml:evaluate -- --once
npm.cmd run ml:collect -- --once
```

`ml:collect` ejecuta la evaluación después de la ingesta cuando corresponde; si falla, la ingesta y el registro de nuevas observaciones continúan. Consulte `GET /api/v1/ml/evaluation/status`, `/metrics`, `/classes` y `/history?symbol=NVDA&timeframe=15m&offset=0&limit=25`, o la sección de evaluación del panel Predicciones. La API es de solo lectura.

**Límite observado en este entorno:** existe un ledger local de ingesta, pero no un ledger local de observaciones adelantadas. No hay métricas prospectivas reales que informar. La apertura `t+1` normalmente ya ocurrió antes de registrar una predicción con SIP retrasado; un acierto de clasificación no representa una operación ejecutable, ni ganancias de NVDA u opciones.
