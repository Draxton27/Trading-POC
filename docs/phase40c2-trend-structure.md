# Fase 40C2: estructura de tendencia en NVDA IEX

## Pregunta e hipótesis

Investigamos si nueve características de pendiente y estructura de máximos y mínimos ayudan a reconocer movimientos BAJISTAS. Es una hipótesis experimental, no una explicación demostrada. La familia se fijó completa antes de evaluar; no incluye las siete variables temporales de 40C1. La comparación principal es **cada algoritmo ampliado frente a su propia versión original**: XGBoost 19 frente a XGBoost 10, y LightGBM 19 frente a LightGBM 10. Qlib y FreqAI no participan en el pipeline.

## Datos y equivalencia

El CLI utiliza tres directorios privados, de solo lectura: histórico NVDA IEX `raw` estricto de 15 minutos y calendario Alpaca de 38D, predicciones y folds XGBoost de 38E, y predicciones LightGBM de 40B. Verifica los `SHA256SUMS`, procedencia, orden, etiquetas, probabilidades y métricas originales. Conserva el tratamiento documentado de `code_snapshot_drift` de 40A y admite solo normalización exacta CRLF→LF para snapshots de 40B afectados al extraer Git en Windows. Los hashes locales demuestran consistencia de artefactos, no autenticidad independiente de Alpaca.

Las diez características originales se leen **sin recalcular ni sustituir valores** de 38E. Como comprobación, `return_1`, `return_4`, `distance_ema9` y `distance_sma20` se reproducen desde 38D con tolerancia absoluta `1e-12`. El cálculo de EMA9 reproduce `calculateEma9()` de TypeScript: primera salida = SMA de nueve cierres, luego `(close − EMA previa) × 0,2 + EMA previa`. EMA20 se inicializa con la SMA de 20 cierres y continúa con multiplicador `2/21`. La SMA20 se calcula con las 20 velas cerradas más recientes.

Las nueve variables agregadas, en este orden, son:

| Variable | Cálculo al cierre de `t` |
|---|---|
| `ema9_slope_1` | `EMA9[t] / EMA9[t−1] − 1` |
| `ema20_slope_1` | `EMA20[t] / EMA20[t−1] − 1` |
| `sma20_slope_1` | `SMA20[t] / SMA20[t−1] − 1` |
| `distance_prior_20_high` | `close[t] / max(high[t−20:t]) − 1` |
| `distance_prior_20_low` | `close[t] / min(low[t−20:t]) − 1` |
| `consecutive_lower_highs_4` | Hasta cuatro comparaciones estrictas `high[i] < high[i−1]` terminadas en `t` |
| `consecutive_lower_lows_4` | Hasta cuatro comparaciones estrictas `low[i] < low[i−1]` |
| `consecutive_higher_highs_4` | Hasta cuatro comparaciones estrictas `high[i] > high[i−1]` |
| `consecutive_higher_lows_4` | Hasta cuatro comparaciones estrictas `low[i] > low[i−1]` |

La igualdad interrumpe las cuatro rachas. Las ventanas de máximos y mínimos **excluyen la vela actual**. Se requieren 21 velas causales continuas. Se reinicia la EMA al romperse la continuidad, sin truncar artificialmente segmentos más largos. Dentro de una sesión se exige un paso exacto de 15 minutos. Entre sesiones, se exigen jornadas consecutivas del calendario oficial, la última vela completa de la anterior y la primera completa de la siguiente. Esto incluye EST/EDT, fines de semana, festivos y cierres anticipados. Un hueco intradía o un calendario incompleto impide cruzar el corte.

La serie 38D original contiene 15.246 velas estrictas en 92 segmentos continuos. Las nueve variables pudieron calcularse en 13.986 velas; las otras 1.260 quedaron en calentamiento tras una ruptura de continuidad. La verificación previa al entrenamiento encontró **27.972 observaciones 38E alineadas**, correspondientes a las 13.986 velas elegibles, sin perder filas. La matriz del modelo nunca incluye etiquetas, desenlaces, velas posteriores a `t` ni los indicadores usados solo para la auditoría de cobertura.

### Auditoría de ventanas largas

La cobertura descriptiva del conjunto de observaciones original, por escenario, es:

| Requisito hipotético | Filas disponibles de 13.986 | Cobertura | Filas que se perderían |
|---|---:|---:|---:|
| 40 velas continuas | 13.119 | 93,80 % | 867 |
| 100 velas continuas | 11.136 | 79,62 % | 2.850 |
| Sesión bursátil anterior íntegra | 13.325 | 95,27 % | 661 |

`feature-audit.json` conserva cobertura por escenario, fold y fecha. Las cuatro variables hipotéticas `distance_sma40`, `distance_sma100` y distancias al máximo y mínimo de la sesión anterior **no se entrenan aquí**. Su cobertura no se usa para escoger una ventana según el resultado predictivo.

## Entrenamiento, métricas e incertidumbre

Se reconstruyen los mismos folds externos de 38E: al menos 252 sesiones iniciales, bloques de 126 sesiones y semilla 7. Cada etiqueta de entrenamiento debe estar disponible estrictamente antes del corte externo. Para elegir el número de árboles se usa un bloque interno cronológico cuya parte de entrenamiento está nuevamente purgada; se reentrena luego con todas las filas causales permitidas. XGBoost mantiene `standard` de 38E; LightGBM mantiene los parámetros de 40B. Ambos usan hasta 300 árboles, early stopping de 30 rondas, `multi_logloss`, dos hilos y `argmax`. No se reentrenan los baselines ni se cambian etiquetas, horizontes, pesos o umbrales.

El reporte separa `delayed` (principal) e `ideal` (secundario, con objetivos potencialmente diferentes). Incluye accuracy, balanced accuracy, Macro F1, métricas por clase, matrices, errores BAJISTA↔otras clases, log loss, Brier, ROC-AUC y average precision BAJISTA, y calibración descriptiva. El bootstrap pareado conserva fold y grupos completos: 400 réplicas por sesión, semana y mes, con semilla fija. Los intervalos son descriptivos; pueden quedar dependencias entre jornadas o regímenes prolongados. La importancia `gain` y la máxima correlación de Pearson por variable y fold se calculan solo sobre entrenamiento y no prueban causalidad ni justifican quitar variables en estos mismos folds.

## Reproducción en Windows

Desde la raíz del repositorio, con Python 3.12 x64 y el entorno local existente:

```powershell
.\.venv\phase28-py312\Scripts\python.exe -m pip install --only-binary=:all: -r ml\phase40c2\requirements.txt
.\.venv\phase28-py312\Scripts\python.exe -m unittest discover -s ml\phase40c2 -p "test_*.py"
.\.venv\phase28-py312\Scripts\python.exe -m ml.phase40c2.experiment `
  --history private\iex-history\nvda-2024-2026-phase38e `
  --run private\ml-iex\phase38e-20261023-v1 `
  --baseline40b private\ml-iex\phase40b-lightgbm-v2 `
  --out private\ml-iex\phase40c2-trend-v1
```

La salida debe ser un directorio **nuevo** e ignorado por Git. Contiene `manifest.json`, `report.json`, `report.md`, `predictions.csv`, `feature-audit.json`, doce modelos experimentales y `SHA256SUMS`. No se descargan datos ni se modifican los tres experimentos originales. `tzdata` se hereda de los requisitos fijados de 40C1 para `zoneinfo` en Windows.

## Resultados medidos

El run local `private/ml-iex/phase40c2-trend-v1/` conservó **16.374 predicciones externas**: 6.219 desenlaces evaluables `delayed` y 6.536 `ideal`, los mismos que 38E y 40B. Se entrenaron doce modelos nuevos (dos algoritmos × tres folds × dos escenarios). Los 17 archivos finales, incluidos modelos y predicciones, verificaron SHA-256. Una repetición en `phase40c2-trend-v2/` reprodujo byte por byte `report.json`, `report.md`, `predictions.csv`, `feature-audit.json` y los doce modelos; los manifiestos difieren por la hora de creación. No se suben a Git.

| Escenario | Variante | Macro F1 | Balanced accuracy | Recall BAJISTA | Precision BAJISTA | Log loss | PR-AUC BAJISTA |
|---|---|---:|---:|---:|---:|---:|---:|
| delayed | XGB_BASE | 0,2877 | 0,3565 | 0,0358 | 0,3315 | 1,0554 | 0,3104 |
| delayed | XGB_TREND | 0,2868 | 0,3545 | 0,0317 | 0,3484 | 1,0570 | 0,3132 |
| delayed | LGB_BASE | 0,2752 | 0,3500 | 0,0364 | 0,3425 | 1,0555 | 0,3147 |
| delayed | LGB_TREND | 0,2677 | 0,3470 | 0,0258 | 0,3607 | 1,0565 | 0,3172 |
| ideal | XGB_BASE | 0,3072 | 0,3692 | 0,0598 | 0,3964 | 1,0609 | 0,3307 |
| ideal | XGB_TREND | 0,2988 | 0,3642 | 0,0571 | 0,4223 | 1,0625 | 0,3280 |
| ideal | LGB_BASE | 0,3048 | 0,3647 | 0,0620 | 0,3662 | 1,0637 | 0,3194 |
| ideal | LGB_TREND | 0,2635 | 0,3527 | 0,0394 | 0,3946 | 1,0627 | 0,3271 |

En `delayed`, XGB_TREND − XGB_BASE cambió Macro F1 **−0,0008**, recall BAJISTA **−0,0041**, precision **+0,0169** y log loss **+0,0017**. LGB_TREND − LGB_BASE cambió Macro F1 **−0,0075**, recall **−0,0106**, precision **+0,0181** y log loss **+0,0010**. Log loss más alto representa peor puntuación probabilística. La ligera alza de PR-AUC BAJISTA (+0,0029 XGBoost; +0,0025 LightGBM) no implicó mejor clasificación `argmax` ni una ventaja estable.

### Resultados por fold

Valores **ampliado menos base** dentro del mismo algoritmo. `ΔLL` positivo significa peor log loss.

| Escenario | Fold | Filas evaluables | XGB Δ Macro F1 | XGB Δ recall BAJISTA | LGB Δ Macro F1 | LGB Δ recall BAJISTA |
|---|---:|---:|---:|---:|---:|---:|
| delayed | 1 | 2.243 | +0,0116 | +0,0051 | −0,0089 | −0,0169 |
| delayed | 2 | 2.432 | −0,0082 | −0,0119 | −0,0035 | −0,0030 |
| delayed | 3 | 1.544 | −0,0138 | −0,0045 | −0,0167 | −0,0136 |
| ideal | 1 | 2.359 | −0,0004 | −0,0016 | −0,0694 | −0,0280 |
| ideal | 2 | 2.556 | −0,0138 | +0,0027 | −0,0279 | −0,0164 |
| ideal | 3 | 1.621 | −0,0148 | −0,0124 | −0,0229 | −0,0249 |

Las mejoras de XGBoost `delayed` en el primer fold no se mantuvieron en los siguientes. En LightGBM `delayed`, Macro F1 y recall BAJISTA bajaron en los tres folds. El log loss de ambos modelos `delayed` empeoró en los tres folds: XGBoost +0,0020, +0,0021 y +0,0006; LightGBM +0,0006, +0,0018 y +0,0004. Los dos algoritmos en `ideal` tampoco mostraron una mejora conjunta. Las métricas probabilísticas de `ideal` pertenecen a un objetivo diferente y no se comparan directamente con las de `delayed`.

### Incertidumbre descriptiva

Intervalos percentiles del 95 % con 400 remuestreos pareados de sesiones completas, escenario `delayed`:

| Diferencia | Δ Macro F1 | Δ recall BAJISTA | Δ precision BAJISTA | Δ log loss | Δ PR-AUC BAJISTA |
|---|---:|---:|---:|---:|---:|
| XGB_TREND − XGB_BASE | [−0,0076; +0,0075] | [−0,0117; +0,0034] | [−0,0385; +0,0828] | [+0,0001; +0,0035] | [−0,0050; +0,0100] |
| LGB_TREND − LGB_BASE | [−0,0153; +0,0006] | [−0,0170; −0,0047] | [−0,0396; +0,0782] | [−0,0005; +0,0027] | [−0,0041; +0,0102] |

Las sensibilidades agrupadas por semana y mes, Brier, F1 BAJISTA, ROC-AUC, matrices y calibración están en `report.json` privado. Los intervalos del mismo histórico repetidamente observado no validan una política operativa.

### Confusión, importancia y redundancia

El recall BAJISTA **bajó** para ambos algoritmos en el escenario principal. XGBoost clasificó correctamente 61→54 BAJISTA; BAJISTA→LATERAL bajó 1.425→1.416, pero BAJISTA→ALCISTA subió 219→235. Sus falsos positivos BAJISTA bajaron 123→101. LightGBM clasificó correctamente 62→44 BAJISTA, BAJISTA→LATERAL subió 1.459→1.477 y sus falsos positivos bajaron 119→78. La precisión BAJISTA subió porque ambos modelos emitieron menos predicciones BAJISTA: 184→155 en XGBoost y 181→122 en LightGBM. Por tanto, la mejora de precisión ocurrió junto a la pérdida de recall, no por una identificación bajista más amplia.

En `delayed`, las pendientes de medias y las distancias a extremos recibieron importancia `gain`; la variable de mayor importancia nueva cambió entre folds en XGBoost. En LightGBM aparecieron con frecuencia `distance_prior_20_low`, `distance_prior_20_high` y `sma20_slope_1`. No hay evidencia de valor incremental estable. En el tercer fold `delayed`, `ema9_slope_1` tuvo correlación de Pearson **0,99998** con `distance_ema9` original en entrenamiento; `ema20_slope_1` tuvo **0,98602** con `distance_sma20`. Esto sugiere redundancia descriptiva, sin justificar seleccionar subconjuntos retrospectivamente. Las rachas de máximos y mínimos tampoco sostuvieron una mejora de clasificación común.

La auditoría de ventanas largas varió entre folds externos, sin afectar los modelos:

| Fold externo | Filas | 40 continuas | 100 continuas | Sesión anterior íntegra |
|---:|---:|---:|---:|---:|
| 1 | 2.981 | 2.795 | 2.414 | 2.817 |
| 2 | 3.184 | 3.108 | 2.894 | 3.116 |
| 3 | 2.022 | 1.946 | 1.742 | 1.953 |

Los otros registros son de desarrollo; el archivo de auditoría privado incluye cada fecha y ambos escenarios. Exigir SMA100 habría excluido 2.850 de las 13.986 observaciones únicas originales.

### Interpretación y decisión

1. **Recall BAJISTA y BAJISTA→LATERAL:** no mejoraron en conjunto; LightGBM empeoró en ambos aspectos.
2. **Falsos positivos y precisión:** los falsos positivos bajaron, pero también cayó el número de BAJISTA verdaderos detectados. La precisión subió con menos predicciones BAJISTA.
3. **Macro F1, log loss y discriminación:** Macro F1 bajó en ambos modelos `delayed`; log loss empeoró. PR-AUC BAJISTA subió ligeramente, con intervalos descriptivos que incluyen cero.
4. **Estabilidad:** los folds de XGBoost dieron signos mixtos; LightGBM mostró caída de Macro F1 y recall en los tres.
5. **Variables:** gain muestra uso por los modelos, no beneficio causal. Las pendientes están fuertemente correlacionadas con variables originales en al menos un fold; la estructura de extremos tampoco demostró valor adicional estable.
6. **Conclusión:** mantener congelados los modelos operativos. Las comparaciones de 40B, 40C1 y 40C2 no demuestran una solución estable al bajo recall BAJISTA sobre este mismo histórico. El siguiente paso metodológicamente más valioso es recopilar datos nuevos e independientes antes de continuar con otra familia de características. Cualquier estudio posterior de volumen o volatilidad necesitaría un protocolo fijado de antemano y reportar resultados desfavorables sin reajustar estos folds.

## Límites y siguiente investigación

Este histórico ya fue examinado en 40A, 40B y 40C1; un cambio favorable no equivaldría a validación independiente. Ningún resultado reemplaza el modelo congelado de 38F ni autoriza señales CALL/PUT u órdenes. Después de 40C2 corresponde consolidar las tres comparaciones y decidir si una hipótesis de volumen o volatilidad merece un protocolo nuevo, o si es preferible priorizar datos verdaderamente independientes. No continuaremos una búsqueda indefinida de características sobre estos mismos folds.
