# Fase 41E · Variables causales de velas y estructura Investep

Esta fase construye características retrospectivas de NVDA para los tres objetivos y los folds congelados en 41D. No entrena ni promueve modelos. IEX `raw` aporta las diez columnas originales y ocho descriptores de velas; SIP `split` aporta quince columnas técnicas mediante el motor 41A y el índice 41B. Las observaciones y etiquetas siguen siendo `HISTORICAL_EXPLORED`.

## Fuentes y tiempo

`ml.phase41c.sources.load_sources` verifica SHA-256, procedencia, calendario Alpaca, barras estrictas IEX de 15 minutos, observaciones y predicciones 38E. `ml.phase41e.sources` verifica todos los hashes de 41D, vuelve a construir sus tres objetivos sin cambiarlos y exige igualdad exacta con el archivo congelado. El puente TypeScript usa `loadPhase41bSip` para comprobar NVDA, Alpaca SIP, regular, 15 minutos, ajuste por splits y calendario oficial; después llama `createPhase41bIndex` y proyecta sus resultados. No descarga datos.

En `ideal`, `decision_at_utc` es el cierre IEX de t; en `delayed`, cierre +20 minutos. F0 y F1 provienen de la misma vela IEX t y no cambian entre escenarios. F2 selecciona exclusivamente barras SIP cuya disponibilidad **simulada** (`cierre + 15`, `+20` o `+30` minutos) es anterior o igual a la decisión. Los agregados de una hora y un día deben estar completos. `last_iex_feature_bar_end_utc`, `last_sip_feature_bar_end_utc` y `last_sip_assumed_available_at_utc` permanecen por fila. El cierre de la sesión actual no se anticipa. La continuidad usa el calendario oficial para cambios EST/EDT, festivos y cierres anticipados. Ninguna recepción histórica auténtica de SIP o IEX se infiere del REST.

SIP está ajustado retrospectivamente por splits. Una operación societaria posterior pudo cambiar sus valores antiguos. Este experimento evita mezclar **niveles de precio** SIP con IEX raw, pero no demuestra que el contexto SIP ajustado estuviera disponible con idénticos valores en aquel momento. Esa limitación debe resolverse antes de atribuirle validez prospectiva.

## Esquema fijo F0, F1 y F2

`feature-schema.json` registra nombres, orden, tipos, categorías, ausencias y SHA-256. F0 tiene diez columnas en el orden de 38E; se copian literalmente de `observations.json` verificado. El puente Node comprueba que cada vector y su orden reproduzcan el `feature_sha256` original. Nunca se recalculan para sustituirlo.

F1 agrega ocho columnas en este orden:

| Columna | Fórmula o regla | Ausencia |
|---|---|---|
| `body_range_ratio` | `abs(C−O)/(H−L)` | `null` si `H=L` |
| `upper_wick_range_ratio` | `(H−max(O,C))/(H−L)` | `null` si `H=L` |
| `lower_wick_range_ratio` | `(min(O,C)−L)/(H−L)` | `null` si `H=L` |
| `close_location_in_range` | `(C−L)/(H−L)` | `null` si `H=L` |
| `consecutive_up_4` | Desde t hacia atrás, hasta cuatro cuerpos con `C>O`; doji detiene | `null` sin cuatro barras continuas |
| `consecutive_down_4` | Análogo con `C<O` | `null` sin cuatro barras continuas |
| `higher_highs_4` | Número de pares adyacentes con máximo estrictamente mayor | `null` sin cuatro barras continuas |
| `lower_lows_4` | Número de pares adyacentes con mínimo estrictamente menor | `null` sin cuatro barras continuas |

Cuatro velas contienen **tres** comparaciones adyacentes. La igualdad no cuenta. Todas las ventanas terminan exactamente en t; un hueco reinicia la secuencia y no se rellena. Las cinco variables adicionales citadas como posibles diagnósticos en 41D no se agregan a F1.

F2 agrega exactamente las quince columnas predeclaradas, en su orden 41D:

| Familia | Cálculo y semántica |
|---|---|
| `sma_full_order_15m` | Permutación descendente estricta de 20, 40, 100 y 200; existen 24 posibilidades. `TIED` preserva igualdad exacta; `UNAVAILABLE` preserva una SMA faltante. Las cuatro configuraciones ilustradas por Investep son ejemplos, no universo exhaustivo. |
| `sma_short_pair_alignment_15m`, `sma_long_pair_alignment_15m` | Estados originales de `classifySmaPair` para 20/40 y 100/200. El orden no determina la pendiente. |
| Cuatro `sma*_slope_15m` | `RISING`, `FALLING`, `FLAT`, `UNAVAILABLE` de `classifySmaSlope`, entre valores consecutivos disponibles de la misma SMA. |
| Cuatro `price_relative_sma*_15m` | `sipClose/sipSma−1`, equivalente a `distancePercent/100` de 41B. Ambos precios son de SIP split. Nunca se divide IEX raw entre SMA SIP. `null` sin SMA o precio. |
| `candidate_ceiling_context_15m`, `candidate_floor_context_15m` | Contexto descriptivo de los cuatro niveles SMA. Techo potencial si el cierre SIP está debajo o igual al nivel; piso potencial si está encima o igual. Un cruce/retesto de la barra observada también se conserva aunque el cierre cambie de lado. Su estado se obtiene de las interacciones y eventos geométricos **ya emitidos por 41A**. |
| `alignment_1h`, `alignment_1d` | Estado de cada agregado completo en 41B, que requiere ambas parejas 20/40 y 100/200. `INSUFFICIENT_DATA` si una pareja no existe. No se extrapola del día parcial. |

Para los candidatos, `NO_CANDIDATE` significa que no hay nivel en el lado correspondiente; `POTENTIAL_NO_INTERACTION` significa que el precio está de ese lado sin interacción geométrica observada. `INTERACTION_OBSERVED`, `REJECTION_OBSERVED`, `BREAK_OBSERVED`, `RETEST_PENDING`, `RETEST_CONFIRMED`, `RETEST_EXPIRED` y `RECOVERY_OBSERVED` reflejan exclusivamente eventos de 41A visibles hasta la decisión. `UNAVAILABLE` indica falta de nivel o precio. El archivo por fila conserva el orden, la posición, la dirección de aproximación cuando 41A puede reconocerla (`FROM_ABOVE`/`FROM_BELOW`; si no, `UNDETERMINED`), las interacciones, dirección y hora de cada evento. Una ruptura no implica retesteo; `PENDING` nunca se presenta como `CONFIRMED`. No se inventa tolerancia de cercanía ni número de velas de confirmación. Estos contextos **no** confirman rentabilidad de soporte o resistencia.

Las variables categóricas permanecen cadenas con dominio cerrado, sin códigos ordinales arbitrarios. Un futuro modelo lineal deberá ajustar one-hot solo con su entrenamiento causal; para árboles se podrá usar representación categórica compatible o un one-hot ajustado del mismo modo. Los `null`, `UNAVAILABLE` e `INSUFFICIENT_DATA` se conservan; nunca se sustituyen por cero ni por BAJISTA. F2 completo exige todos los numéricos y categorías disponibles. El reporte informa también la población común F0/F1/F2 para comparaciones justas posteriores.

## Unión con objetivos y artefactos

La clave exacta es `(scenario, bar_start_utc)`; se comprueban fold y `decision_at_utc`. Los tres objetivos 41D se adjuntan **después** de construir F0/F1/F2 y ocupan campos separados `targets` y `target_availability`. El SHA de la fila une características, estados, tiempos y hashes de origen. Las sensibilidades SIP +15/+20/+30 producen filas distintas; +20 es la principal. No se cambian etiquetas, folds, horizonte t+4 ni predicciones originales.

El directorio privado inicial `private/ml-iex/phase41e-features-v1/` contiene manifiesto, esquema, cobertura, paridad, auditoría, filas, reportes JSON/Markdown y `SHA256SUMS`. La salida final se guarda en otro directorio, `private/ml-iex/phase41e-features-v1c/`, con desgloses por clase/fold **y** demora y hash del código generador separado de las pruebas. Las salidas previas `v1` y `v1b` se conservaron sin sobrescribir. `features.json` guarda incluso filas incompletas, motivos y evidencia de contexto; no descarta silenciosamente. `feature-coverage.json` separa escenario, fold, mes, clase real y demora, con disponibilidad SMA200 en 15m, 1h y 1d. Los archivos son privados e ignorados por Git.

## Cobertura histórica local verificada

El esquema tiene SHA-256 `2508358875811c827110271769cdba25eff3489d14829412e3b65d4ad0c415d7`. Se verificaron los SHA originales de F0 de **16.374** observaciones (8.187 por escenario), igualdad F0/F1 entre los 8.187 pares ideal/delayed y las **49.122** filas de los tres objetivos 41D. Los ocho archivos finales verificaron contra `SHA256SUMS`.

| Escenario · demora SIP | Observaciones | F0 | F1 | F2 | Etiqueta y F2 disponibles |
|---|---:|---:|---:|---:|---:|
| delayed · +15 | 8.187 | 8.187 | 8.187 | 8.103 | 6.158 |
| **delayed · +20** | **8.187** | **8.187** | **8.187** | **8.104** | **6.158** |
| delayed · +30 | 8.187 | 8.187 | 8.187 | 8.104 | 6.158 |
| ideal · +15/+20/+30, cada demora | 8.187 | 8.187 | 8.187 | 8.104 | 6.472 |

En delayed +20 se perdieron 83 observaciones para F2 (1,01 %), de las cuales 61 tenían etiqueta evaluable. El motivo registrado fue `SOURCE_OUT_OF_RANGE`: el SIP privado termina antes que la serie IEX 38E; no se rellenaron velas. F0 y F1 no perdieron observaciones. La cobertura de SMA200 en 15m, 1h y 1d coincidió con las 8.104 filas F2 completas en ese escenario. Por fold delayed +20: 2.981/2.981 F2 en fold 1, 3.184/3.184 en fold 2 y 1.939/2.022 en fold 3. La población con etiqueta y F2 fue 2.243, 2.432 y 1.483 respectivamente.

En delayed +20, entre las etiquetas evaluables: ALCISTA 1.669/1.681 con F2, BAJISTA **1.687/1.705**, LATERAL 2.802/2.833. Se pierden 18 BAJISTA; no debe inferirse desempeño ni ventaja estadística de estas coberturas. El archivo privado permite examinar otras clases y demoras sin mezclar las tres sensibilidades en un denominador.

### Reproducción en Windows

Desde la raíz del repositorio, con Node y el entorno Python 3.12 existente:

```powershell
.\.venv\phase28-py312\Scripts\python.exe -m ml.phase41e.report --history private\iex-history\nvda-2024-2026-phase38e --run private\ml-iex\phase38e-20261023-v1 --targets private\ml-iex\phase41d-target-protocol-v1 --sip-csv trading_poc_001_bollinger\data\NVDA_ALPACA_SIP_15min_20211017_20261017.csv --out private\ml-iex\phase41e-features-v1c
.\.venv\phase28-py312\Scripts\python.exe -m unittest ml.phase41e.test_features
```

El directorio de salida debe ser nuevo; si ya existe se rechaza y no se sobrescribe. CI usa fixtures sintéticas, sin Alpaca ni archivos privados. La auditoría histórica y su cobertura no constituyen resultados predictivos. Para 41F faltan el entrenamiento causal, preprocesamiento aprendido solo de desarrollo, comparación en filas comunes, evaluación de incertidumbre y evidencia prospectiva independiente.
