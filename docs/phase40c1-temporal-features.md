# Fase 40C1: memoria temporal en NVDA IEX

## Objetivo y fuentes

Este experimento histórico pregunta si una familia predefinida de siete características de memoria del cierre mejora **dentro de cada algoritmo** la clasificación BAJISTA: XGBoost con 17 frente al XGBoost original con 10, y LightGBM con 17 frente al LightGBM original con 10. La idea de estudiar familias de características por separado está inspirada en las prácticas de investigación de Qlib y FreqAI; no se instala ninguno de esos sistemas ni se toman sus señales.

Se leen tres fuentes privadas, de solo lectura: velas NVDA IEX `raw` estrictas de 15 minutos y calendario Alpaca de Fase 38D; observaciones, etiquetas, predicciones XGBoost y folds de 38E; modelos y probabilidades LightGBM de 40B. Sus `SHA256SUMS`, procedencia y correspondencia entre archivos se verifican antes de crear una salida. La integridad de los hashes locales **no prueba por sí misma** la autenticidad de las respuestas originales del proveedor. La diferencia conocida de snapshot en dos archivos de 38E se conserva en el manifiesto. El run privado 40B se creó con archivos LF; Git los extrajo como CRLF en Windows. El lector admite únicamente esa normalización exacta de finales de línea y registra los cuatro archivos afectados; cualquier otra diferencia de código se rechaza.

## Contrato de variables y continuidad

Las diez características originales se conservan exactamente desde las observaciones verificadas de 38E, en su orden anterior. Las siete nuevas se calculan únicamente con cierres de velas 38D hasta la observación `t`:

| Característica | Definición |
|---|---|
| `return_2` | `close[t] / close[t−2] − 1` |
| `return_8` | `close[t] / close[t−8] − 1` |
| `lagged_return_1` | `close[t−1] / close[t−2] − 1` |
| `lagged_return_2` | `close[t−2] / close[t−3] − 1` |
| `lagged_return_3` | `close[t−3] / close[t−4] − 1` |
| `consecutive_down_bars` | Retornos negativos consecutivos terminados en `t`, máximo ocho |
| `consecutive_up_bars` | Retornos positivos consecutivos terminados en `t`, máximo ocho |

Un retorno cero corta ambas rachas. Se exige una cadena continua de velas completas. Dentro de la sesión, cada inicio debe distar 15 minutos; entre sesiones, el último intervalo de la sesión anterior y el primero de la siguiente deben existir, y ambas fechas deben ser consecutivas en el calendario oficial. Festivos, fines de semana, EST/EDT y cierres anticipados se interpretan mediante `America/New_York` y los horarios del calendario verificado. Un hueco reinicia la cadena. Ninguna variable recibe precios, etiquetas ni exclusiones futuras. El lector compara además `return_1` y `return_4` originales con los cierres 38D, con tolerancia absoluta de `1e−12`; no recalcula las otras ocho variables originales. Una fila original sin nueva característica detiene toda comparación y muestra su identidad y motivo; no se reduce silenciosamente la muestra.

## Entrenamiento y evaluación

`delayed` es el escenario principal; `ideal` es secundario y tiene objetivos potencialmente diferentes. Se usan exactamente los folds externos 38E: 252 sesiones mínimas de entrenamiento, bloques de 126, semilla 7. Una etiqueta solo entra en entrenamiento si se conocía estrictamente antes del corte externo. El bloque interno cronológico vuelve a purgar las etiquetas antes de seleccionar árboles por `multi_logloss`. XGBoost conserva `standard` de Fase 38E y LightGBM conserva la configuración fija de 40B. Ambos se reentrenan con **todas** las filas causales anteriores al fold y solo las 17 variables. Los modelos base no se vuelven a entrenar. La regla de clasificación sigue siendo `argmax`; no se buscan subconjuntos, pesos o umbrales BAJISTA.

El reporte separa escenarios y folds; incluye matrices de confusión, BAJISTA→LATERAL, falsos positivos BAJISTA, Macro F1, balanced accuracy, precisión, recall, F1, log loss, Brier, ROC-AUC y average precision BAJISTA, más calibración descriptiva. Las diferencias ampliado menos base usan bootstrap pareado con 400 remuestreos de sesiones completas, y sensibilidad semanal y mensual. Las réplicas sin clases suficientes no reciben AUC inventada. El agrupamiento no captura necesariamente dependencias entre jornadas ni cambios prolongados de régimen.

La importancia `gain` de los 17 campos se reporta como diagnóstico descriptivo por fold. Una variable con importancia baja puede ser redundante, pero este mismo histórico no se utiliza para eliminarla y reentrenar una combinación favorable.

## Reproducción en Windows

Desde la raíz del repositorio, con Python 3.12 x64 y `.venv\phase28-py312`:

```powershell
.\.venv\phase28-py312\Scripts\python.exe -m pip install --only-binary=:all: -r ml\phase40c1\requirements.txt
.\.venv\phase28-py312\Scripts\python.exe -m unittest discover -s ml\phase40c1 -p "test_*.py"
.\.venv\phase28-py312\Scripts\python.exe -m ml.phase40c1.experiment `
  --history private\iex-history\nvda-2024-2026-phase38e `
  --run private\ml-iex\phase38e-20261023-v1 `
  --baseline40b private\ml-iex\phase40b-lightgbm-v2 `
  --out private\ml-iex\phase40c1-temporal-v3
```

En Windows, Python `zoneinfo` requiere datos IANA externos; `tzdata==2026.5` queda fijado como wheel en el entorno de esta fase. [PyPI describe ese paquete como fuente IANA para sistemas sin datos de zona instalados](https://pypi.org/project/tzdata/2026.5/). El comando no descarga históricos ni contacta Alpaca. La salida debe ser una carpeta nueva e ignorada por Git. Contiene `manifest.json`, `report.json`, `report.md`, `predictions.csv`, `feature-audit.json`, modelos experimentales por fold y `SHA256SUMS`. Nunca se sobrescriben 38D, 38E o 40B.

## Resultado local del run privado

Se verificaron 15.246 velas estrictas distribuidas en 92 segmentos continuos. Las nuevas variables pudieron calcularse en 14.660 velas; 586 velas de calentamiento no alcanzaron ocho retornos consecutivos. **Las 27.972 observaciones originales de 38E** —13.986 velas únicas— sí tienen las siete variables; no se perdió ninguna fila original. Se conservaron las 16.374 predicciones externas. Las filas evaluables fueron **6.219 `delayed`** y **6.536 `ideal`**, exactamente las de 38E/40B. Se entrenaron doce modelos nuevos (dos algoritmos × tres folds × dos escenarios). Los 17 archivos finales de `private/ml-iex/phase40c1-temporal-v3/` verificaron SHA-256; no se publican modelos ni históricos.

| Escenario | Variante | Macro F1 | Recall BAJISTA | Precision BAJISTA | Log loss | PR-AUC BAJISTA |
|---|---|---:|---:|---:|---:|---:|
| delayed | XGB_BASE | 0,2877 | 0,0358 | 0,3315 | 1,0554 | 0,3104 |
| delayed | XGB_TEMPORAL | 0,2839 | 0,0352 | 0,3593 | 1,0561 | 0,3087 |
| delayed | LGB_BASE | 0,2752 | 0,0364 | 0,3425 | 1,0555 | 0,3147 |
| delayed | LGB_TEMPORAL | 0,2789 | 0,0387 | 0,3905 | 1,0569 | 0,3091 |
| ideal | XGB_BASE | 0,3072 | 0,0598 | 0,3964 | 1,0609 | 0,3307 |
| ideal | XGB_TEMPORAL | 0,2968 | 0,0566 | 0,3918 | 1,0618 | 0,3284 |
| ideal | LGB_BASE | 0,3048 | 0,0620 | 0,3662 | 1,0637 | 0,3194 |
| ideal | LGB_TEMPORAL | 0,2898 | 0,0561 | 0,3866 | 1,0644 | 0,3225 |

En el escenario principal `delayed`, XGB_TEMPORAL − XGB_BASE cambió Macro F1 **−0,0038**, recall BAJISTA **−0,0006**, precision BAJISTA **+0,0278**, log loss **+0,0007** y PR-AUC **−0,0017**. Los intervalos descriptivos del 95 % por sesiones fueron, respectivamente, [−0,0095, +0,0028], [−0,0076, +0,0067], [−0,0259, +0,0821], [−0,0003, +0,0015] y [−0,0071, +0,0030]. Log loss más alto significa peor calidad probabilística.

LGB_TEMPORAL − LGB_BASE cambió Macro F1 **+0,0036**, recall BAJISTA **+0,0023**, precision BAJISTA **+0,0480**, log loss **+0,0014** y PR-AUC **−0,0056**. Los intervalos por sesiones fueron [−0,0037, +0,0106], [−0,0037, +0,0083], [−0,0015, +0,1084], [+0,0002, +0,0027] y [−0,0126, +0,0006]. La modesta mejora de clasificación no supera claramente su incertidumbre; el log loss empeoró en este remuestreo descriptivo. La evaluación `ideal` tampoco mostró una mejora estable: Macro F1 cayó 0,0104 para XGBoost y 0,0150 para LightGBM; el recall BAJISTA cayó 0,0032 y 0,0059.

### Variación por fold

La tabla muestra **ampliado menos base** dentro del mismo algoritmo y escenario. `ΔLL` positivo significa peor log loss.

| Escenario | Fold | Filas | XGB Δ Macro F1 | XGB Δ Recall BAJISTA | LGB Δ Macro F1 | LGB Δ Recall BAJISTA | XGB ΔLL | LGB ΔLL |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| delayed | 1 | 2.243 | −0,0041 | −0,0017 | +0,0090 | −0,0017 | +0,0003 | +0,0018 |
| delayed | 2 | 2.432 | +0,0030 | +0,0045 | +0,0005 | +0,0059 | +0,0002 | +0,0006 |
| delayed | 3 | 1.544 | −0,0133 | −0,0068 | −0,0075 | +0,0023 | +0,0021 | +0,0023 |
| ideal | 1 | 2.359 | −0,0025 | −0,0031 | −0,0031 | −0,0031 | +0,0000 | +0,0009 |
| ideal | 2 | 2.556 | −0,0269 | −0,0082 | −0,0417 | −0,0151 | +0,0016 | +0,0001 |
| ideal | 3 | 1.621 | −0,0004 | +0,0042 | +0,0001 | +0,0042 | +0,0009 | +0,0014 |

### Respuestas a las preguntas de investigación

1. **Recall BAJISTA:** solo LightGBM `delayed` subió levemente; XGBoost `delayed` bajó y ambos `ideal` bajaron.
2. **Confusión BAJISTA/LATERAL:** en `delayed`, XGBoost pasó de 1.425 a 1.433 casos, y LightGBM de 1.459 a 1.452. La diferencia es pequeña frente al número total de errores.
3. **Falsos positivos BAJISTA:** en `delayed`, XGBoost bajó de 123 a 107 y LightGBM de 119 a 103; la precisión aumentó. Eso no compensa por sí solo las demás métricas.
4. **Macro F1:** bajó en XGBoost `delayed`, subió levemente en LightGBM `delayed`, y bajó en ambos modelos `ideal`.
5. **Discriminación probabilística BAJISTA:** PR-AUC cayó en ambos modelos `delayed`; el log loss también empeoró. La pequeña ganancia de recall de LightGBM no equivale a probabilidades mejor discriminadas.
6. **Consistencia entre folds:** no hay mejora común; las direcciones cambian por fold y por métrica.
7. **Beneficio de ambos algoritmos:** no. El cambio de siete variables como familia no produjo un beneficio consistente en ambos.
8. **Incertidumbre:** los intervalos descriptivos de recall y Macro F1 `delayed` incluyen cero para ambos algoritmos. No justifican afirmar una mejora estable.
9. **Información distinta:** la importancia `gain` de algunas variables de retorno, especialmente `return_8`, indica uso por los modelos, pero no prueba información incremental. Las rachas tienen poca importancia relativa en LightGBM; son candidatas a diagnóstico de redundancia, sin eliminarlas ni seleccionar subconjuntos con estos folds.
10. **Fase 40C2:** estudiar una familia nueva con protocolo fijado antes de evaluar, preservando filas, cortes y métricas. Harían falta datos verdaderamente nuevos para una validación independiente.

El [reporte local completo](../private/ml-iex/phase40c1-temporal-v3/report.md) contiene matrices, calibración, métricas por clase, intervalos por semana y mes e importancias por fold. Las probabilidades históricas no representan capturas prospectivas ni ejecución a un precio garantizado. El histórico ya fue examinado repetidamente; ninguna diferencia autoriza reemplazar el modelo congelado ni generar señales CALL/PUT.
