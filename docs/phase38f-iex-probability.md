# Fase 38F: probabilidades IEX y observación prospectiva

Esta fase conserva los artefactos de 38E, SIP y los ledgers previos. Las predicciones de 38E son **replay histórico**, con disponibilidad simulada. Ningún resultado de este documento valida una decisión bursátil.

## Diagnóstico retrospectivo

El comando lee `predictions.csv` y `report.json` de 38E y comprueba sus SHA-256 de `SHA256SUMS`. Escribe un reporte nuevo, fuera de Git. Agrupa por escenario y fold, sin mezclar los objetivos `ideal` y `delayed`. Para cada clase registra ROC-AUC uno contra resto, average precision (PR-AUC no interpolada), prevalencia de referencia, distribuciones de probabilidad según la etiqueta real, Brier binario, calibración en intervalos, precisión y recall a umbrales de 0,2 a 0,8. También informa cobertura y accuracy entre observaciones no abstentas, desglose mensual y grupos descriptivos de primera/segunda mitad y ATR bajo/alto respecto de la mediana del fold. Estas divisiones descriptivas no se usan para seleccionar el modelo. Si falta una clase en un grupo, AUC figura como `null`.

```powershell
.\.venv\phase28-py312\Scripts\python.exe -m ml.phase38f.diagnostics --source private\ml-iex\phase38e-20261023-v1 --out private\ml-iex\phase38f-probability-20261023-v2
```

En el run local verificado, la clase BAJISTA del escenario retrasado tuvo ROC-AUC 0,540/0,555/0,580 y PR-AUC 0,289/0,307/0,354 en los folds 1/2/3; sus prevalencias fueron 0,263/0,277/0,286. Son asociaciones retrospectivas débiles. Los umbrales explorados **no** forman una política validada y no se aplican a las predicciones nuevas.

## Modelo separado y corte

Se entrena una única versión experimental IEX con las observaciones 38E del escenario `delayed` cuyas etiquetas se conocían estrictamente antes del corte. La selección del número de árboles usa solo un bloque interno anterior al corte; luego se reentrena con todas las filas causales. Los baselines `frequency` y `linear` usan las mismas filas. La política congelada es `argmax`, sin umbral de abstención. No se modifican los modelos por fold de 38E.

```powershell
.\.venv\phase28-py312\Scripts\python.exe -m ml.phase38f.frozen freeze --source private\ml-iex\phase38e-20261023-v1 --out private\ml-iex\phase38f-frozen-20261023-v3 --cutoff 2026-10-23T00:00:00.000Z
```

El manifiesto privado registra corte, hora real de congelación, filas, última etiqueta conocida, orden de diez variables, clases, versión, semillas, número de árboles, hashes de origen, modelo y baseline. Ninguna vela iniciada antes de congelar el modelo puede recibir una predicción prospectiva. La carpeta de salida debe ser nueva. El run local produjo 10.566 filas causales; el SHA-256 de `model.json` fue `b9bbece648544b39e1e4c4946933e4f4de2d65ec5094997938b25791cb1bb684`. Dos ejecuciones independientes con la misma semilla produjeron el mismo hash. Esto verifica reproducibilidad local del entrenamiento, no capacidad predictiva.

## Observación Live y evaluación posterior

El observador lee **solo** el ledger IEX Live con cadena de hashes y el calendario oficial acumulado. Selecciona la primera versión completa de cada vela de 15 minutos recibida antes de decidir. Una corrección posterior no cambia la primera versión ni una predicción ya registrada. Exige 21 velas continuas como mínimo y usa todo el segmento continuo para preservar el estado EMA 9. Calcula las diez variables mediante `calculatePhase23Features`, sin fórmulas nuevas. Si faltan sesiones, velas, calendario o historial, no emite.

La primera apertura programada estrictamente posterior al registro efectivo define la entrada de referencia. Cuatro velas posteriores deben caber en la sesión. La apertura OHLC es una referencia observada, **no** un fill. El registro append-only contiene modelo, hashes de las velas, recepciones, versión, variables, probabilidades de XGBoost, frecuencia y lineal, clase argmax, hora de decisión y horizonte. Otro registro inmutable incorpora luego desenlace o exclusión por barras ausentes. La evaluación original no cambia por correcciones tardías. No se consulta REST histórico para calentamiento ni se atribuyen sus revisiones a un instante anterior.

En `.env.local`, configurar `TRADING_POC_IEX_FROZEN_DIR` con la ruta absoluta del run congelado. Opcionalmente, `TRADING_POC_IEX_LEDGER`, `TRADING_POC_IEX_CALENDAR` y `TRADING_POC_IEX_OBSERVATION_LEDGER`. Por defecto, estas rutas privadas se resuelven bajo `%LOCALAPPDATA%\Trading-POC` en Windows, o bajo `private/` cuando se fija `TRADING_POC_PRIVATE_DIR` a esa carpeta. El proceso IEX Live se inicia por separado según Fase 38A; este observador no lo inicia ni agrega descargas.

```powershell
npm.cmd run ml:iex:observe -- --once
.\.venv\phase28-py312\Scripts\python.exe -m ml.phase38f.prospective_report --ledger private\ml-iex\phase38f-observations.jsonl
```

El informe prospectivo compara XGBoost, frecuencia y lineal sobre las mismas observaciones evaluadas, de forma agregada y por sesión. Mantiene `INSUFFICIENT_EVIDENCE` incluso si hay filas: no se define aquí un tamaño que convierta automáticamente una muestra en validación independiente. No hay órdenes, señales CALL/PUT, conexión IBKR ni inferencia SIP.

## Estado y límites

La ejecución local con el modelo final devolvió `MODEL_TOO_RECENT` y cero evaluaciones: la última vela Live registrada precedía la hora real de congelación. Una ejecución preliminar sin ese campo indicó `INDICATORS_INSUFFICIENT`; ese artefacto no se usa para nuevas observaciones. Por tanto, todavía no hay prueba prospectiva de precisión ni de calibración. El histórico IEX `raw` y SIP `split` no son intercambiables. Las desconexiones del feed pueden impedir formar velas completas. Los resultados agrupados por fecha no eliminan dependencia temporal ni cambios de régimen.
