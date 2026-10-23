# Fase 38B: replay histórico causal de NVDA

Esta investigación reproduce cronológicamente el histórico local **NVDA Alpaca SIP, 15 minutos, sesión regular, adjustment=split**. La preparación verifica los metadatos, la procedencia, el calendario oficial y la cobertura declarada. Guarda los SHA-256 de los cuatro archivos de entrada. No modifica los ledgers operativos ni el modelo congelado de Fase 29.

## Ejecución local en Windows

Desde la raíz del repositorio, con el histórico y sus tres archivos auxiliares existentes:

```powershell
npm.cmd run ml:replay:prepare -- --csv trading_poc_001_bollinger/data/NVDA_ALPACA_SIP_15min_20211017_20261017.csv --out trading_poc_001_bollinger/output/real/phase38b/mi-ejecucion
$env:PYTHON = (Resolve-Path .venv/phase28-py312/Scripts/python.exe).Path
npm.cmd run ml:replay:evaluate -- --run trading_poc_001_bollinger/output/real/phase38b/mi-ejecucion
```

`--out` debe ser un directorio nuevo dentro de `private/` u `output/real/`. Se rechaza la repetición sobre artefactos ya evaluados para conservar los resultados previos. Los artefactos generados son `observations.json`, `manifest.json`, `SHA256SUMS`, tres modelos experimentales por fold, `predictions.csv` y `report.json`. Estos directorios están excluidos de Git.

## Relojes y separación temporal

La predicción de la vela `t` se forma con `calculatePhase23Features` y exactamente las diez variables y el orden de Fases 28/31. El replay no elimina una observación por saber de antemano que su sesión quedará incompleta. Si después falta alguna vela del horizonte, conserva la observación y marca el desenlace como no evaluable. Nunca rellena huecos. La EMA 9 mantiene el estado de la serie causal continua de Fase 23.

El escenario `ideal` libera las variables al cierre de `t`. El escenario `delayed` las libera al cierre de `t` más **20 minutos como supuesto mínimo de investigación**. Ambos usan las mismas velas y las mismas probabilidades; lo que cambia es la oportunidad temporal. Estos instantes **no son timestamps de recepción histórica verificada**. Por eso cada fila registra `historical_received_at_utc: null`. La apertura hipotética de `t+1` ocurre al cierre de `t`; el escenario retrasado llega después y no representa una entrada ejecutable a esa apertura. Ningún escenario simula cotizaciones, órdenes, costes o rendimiento de opciones.

El desenlace reproduce la etiqueta de Fase 23: apertura de `t+1` a cierre de `t+4`, clasificada con el ATR 14 de `t`. Solo se conoce tras el cierre de `t+4` y dentro de la misma sesión, incluidos cierres anticipados. El protocolo fija **252 sesiones observadas iniciales y bloques sucesivos de 252 sesiones observadas**; los cortes se determinan por el orden de llegada, sin seleccionar jornadas según su integridad futura. En cada fold, el entrenamiento usa exclusivamente sesiones anteriores y etiquetas con `label_available_at_utc` anterior al primer instante de prueba. El bloque interno de early stopping también aplica la purga temporal. El XGBoost se reentrena con todas las filas de entrenamiento admisibles después de fijar los árboles; los baselines mayoritario y por frecuencia se calculan con esas mismas filas. Los modelos por fold son **experimentales** y se guardan aparte del modelo congelado.

`report.json` incluye métricas por fold, por sesión y agrupadas de predicciones fuera de muestra: accuracy, balanced accuracy, Macro F1, precision/recall/F1 por clase, log loss y Brier multiclase. Incluye intervalos del 95 % por sesiones completas para las métricas agregadas e intervalos de diferencia frente a los baselines mediante bootstrap pareado, cuando hay al menos dos sesiones. `predictions.csv` conserva el timestamp y la sesión para comprobar la alineación. Las filas sin desenlace no entran en métricas, pero sí quedan registradas como exclusiones. Al evaluar, el programa verifica `SHA256SUMS` y los hashes del código registrados en el manifiesto; un cambio entre preparación y evaluación exige preparar un nuevo directorio.

## Alcance y límites

Todo el histórico del proyecto ya se examinó en fases anteriores. Los resultados son exploratorios y no constituyen evaluación prospectiva independiente ni evidencia de ventaja operativa. La disponibilidad SIP histórica solo se simula con el retraso mínimo; la recepción real de cada barra en aquella fecha no puede reconstruirse. Una comparación de temporización no equivale a una prueba de ejecución a precio de apertura. La calidad de la procedencia depende de los archivos privados locales y sus hashes; estos hashes detectan cambios posteriores a la preparación, pero no certifican externamente la autenticidad del proveedor.
