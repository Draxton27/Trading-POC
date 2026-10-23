# Fase 38C: replay posterior a la disponibilidad

Este experimento utiliza el CSV privado de NVDA Alpaca SIP, ajustado por splits, con velas regulares de 15 minutos y calendario oficial. Reutiliza las diez variables de Fase 23. No modifica el modelo congelado ni los registros de ingesta o inferencia.

## Reloj y etiqueta

Para la vela `t`, la disponibilidad idealizada es su cierre; la disponibilidad SIP simulada es 20 minutos después. La apertura de referencia es la **primera apertura programada de 15 minutos estrictamente posterior** a esa disponibilidad. Por ejemplo, para `t = 10:00–10:15` NY, la versión retrasada está disponible a las 10:35 y la apertura de referencia es 10:45. Si falta la vela de 10:45, el desenlace queda sin evaluar; no se busca otra apertura.

La etiqueta usa el `open` de la vela de referencia y el `close` de la cuarta vela completa desde ella. Los límites ALCISTA y BAJISTA siguen siendo `±0,5 × ATR14(t)`. El precio de entrada, el precio de salida, la etiqueta y los motivos de exclusión se incorporan únicamente tras la emisión de las probabilidades. El horizonte debe terminar dentro de la sesión oficial, incluso en cierres anticipados. Se conservan las filas sin desenlace, con `MARKET_CLOSE` o `FUTURE_BARS_MISSING`.

Cada escenario entrena su propio XGBoost experimental por fold, con las sesiones observadas de prueba del protocolo de Fase 38B: un mínimo inicial de 252 sesiones y bloques posteriores de hasta 252. El entrenamiento exige que las etiquetas se hayan conocido estrictamente antes del corte y antes de la primera sesión de prueba. Un bloque interno anterior al test fija la cantidad de árboles por early stopping; luego se entrena con todas las filas causales disponibles. No se seleccionan hiperparámetros con los folds externos. Mayoría, frecuencias y regresión logística regularizada usan las mismas filas de entrenamiento; momentum aplica el signo fijo de `return_1(t)`.

## Ejecución local en Windows

Desde la raíz del repositorio, con Python 3.12, NumPy 2.1.3, XGBoost 2.1.4 y scikit-learn 1.6.1 del entorno existente:

```powershell
$env:PYTHON = (Resolve-Path .\.venv\phase28-py312\Scripts\python.exe).Path
npm.cmd run ml:replay:post:prepare -- --csv trading_poc_001_bollinger/data/NVDA_ALPACA_SIP_15min_20211017_20261017.csv --out trading_poc_001_bollinger/output/real/phase38c/mi-ejecucion
npm.cmd run ml:replay:post:evaluate -- --run trading_poc_001_bollinger/output/real/phase38c/mi-ejecucion
```

La salida contiene `observations.json`, `manifest.json`, modelos independientes por escenario y fold, `predictions.csv`, `report.json` y `SHA256SUMS`. La preparación comprueba metadatos, cobertura, calendario y procedencia; el evaluador comprueba los hashes antes de entrenar. Se requiere un directorio nuevo por ejecución, sin sobrescrituras. `output/real/` está excluido de Git.

`report.json` incluye métricas por fold, sesión, clase y escenario: accuracy, balanced accuracy, Macro F1, precision, recall, log loss, Brier multiclase, matriz de confusión y calibración descriptiva. Incluye intervalos y diferencias pareadas remuestreando sesiones completas, exclusiones y espera hasta la apertura de referencia. `phase38b_reference` compara distribuciones de clases de las mismas observaciones con desenlace disponible en ambos estudios; no compara directamente F1 de escenarios que predicen etiquetas diferentes.

## Interpretación

La disponibilidad es **simulada**; el histórico no acredita cuándo se recibió cada vela en su fecha original. La resolución de 15 minutos deja sin observar el precio entre aperturas. Una apertura OHLC de referencia tampoco acredita liquidez, acceso a ese precio ni ejecución de una orden. Los resultados históricos ya explorados no son validación prospectiva independiente. Este estudio mide calidad de clasificación y precedencia temporal, sin P&L, opciones ni señales operativas. Un futuro estudio con IEX de un minuto y recepción verificada podría reducir la limitación de resolución; no forma parte de esta fase.

## Comprobación local del 22-10-2026

El CSV privado disponible localmente produjo 64.980 observaciones preparadas, 32.490 por escenario. La evaluación generó ocho modelos nuevos en cuatro folds por escenario, con las mismas 25.970 observaciones de prueba iniciales por escenario. El SHA-256 del CSV fue `7b06d0a493515b18a581963d2d2d488e73a7cd0dc2c961b60a99315e7a9b0ecc`. Los 12 hashes de artefactos del directorio privado nuevo coincidieron con `SHA256SUMS`.

| Escenario | Desenlaces evaluables | Cierre de mercado | Espera a apertura | Macro F1 XGBoost / lineal / frecuencias | Log loss XGBoost / lineal | Recall BAJISTA XGBoost |
| --- | ---: | ---: | ---: | --- | --- | ---: |
| Idealizado | 20.955 | 5.015 | 15 min | 0,3348 / 0,3093 / 0,2049 | 1,0614 / 1,0650 | 0,0592 |
| SIP +20 min simulado | 19.952 | 6.018 | 10 min | 0,3239 / 0,2987 / 0,2096 | 1,0556 / 1,0592 | 0,0359 |

No hubo `FUTURE_BARS_MISSING` en este CSV. La diferencia pareada XGBoost menos baseline lineal en Macro F1 tuvo intervalos bootstrap por sesión de `[0,0181, 0,0317]` para ideal y `[0,0191, 0,0311]` para retrasado. El recall BAJISTA en el último fold fue 0,0354 y 0,0121, respectivamente. Estos intervalos describen el replay ya explorado y no corrigen sesgos de selección previos ni prueban ejecutabilidad. La mejora de clasificación frente a baselines coexiste con un desempeño bajista deficiente. Las dos columnas de Macro F1 no representan el mismo objetivo y no deben contrastarse como efecto del retraso.
