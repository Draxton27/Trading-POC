# Fase 41F: comparación histórica F0/F1/F2

Estado del protocolo: `HISTORICAL_EXPLORED`. Esta investigación compara los objetivos congelados de 41D y las columnas congeladas de 41E. No cambia modelos congelados, datos operativos, ledgers ni órdenes.

## Fuentes y reconstrucción

- Histórico NVDA IEX raw 15m verificado de 38D/38E; observaciones y folds externos originales de 38E.
- Etiquetas `NET_MOVE_4B_ATR05_V1`, `DOWN_TOUCH_4B_ATR05_V1` y `PERSISTENT_BEAR_4B_ATR05_V1` reconstruidas con las reglas puras de 41D y las cuatro velas futuras verificadas. Estas velas se usan solo para etiquetas, nunca como variables.
- Variables F0 originales de 38E; geometría y secuencias F1 de 41E; contexto F2 mediante el puente TypeScript 41A/41B/41E con SIP split histórico y demora simulada de 20 minutos.
- Se comprueban `SHA256SUMS`, manifiestos, esquema SHA `f345656000b9e6970017be1bfb6cc7ca3a37b504b6e43f929cfa161e5b10bdfa` y protocolo SHA `29d3aae08bcb834cf1b86ee2ac905755da3bbca5aeeea8d261b0cd423b1ea4e3` contra los archivos reales. La corrida se detiene si falla la paridad exacta de F0/F1/F2, etiquetas o folds externos 41E `v1g`.

El archivo 41E `features.json` solo contiene observaciones externas. 41F reconstruye también las observaciones históricas de entrenamiento y validación interna usando las mismas funciones. La disponibilidad de la etiqueta es el cierre *teórico* del horizonte; no existe hora histórica verificada de recepción de IEX/SIP para esas filas.

## Protocolo congelado

`experiment-config.json` se escribe antes de calcular métricas. Define semilla 7, dos hilos por modelo, 300 árboles máximos, validación interna cronológica con purga, clase por `argmax` para NET_MOVE y umbral 0,5 para objetivos binarios. `frequency`, regresión logística, XGBoost y LightGBM usan las mismas observaciones de entrenamiento y evaluación para cada objetivo y conjunto. Los transformadores y prevalencias se ajustan solo en entrenamiento causal; los árboles usan one-hot sin orden ficticio de categorías.

La comparación principal F0/F1/F2 exige F2 completo tanto en entrenamiento como en evaluación. La comparación secundaria F0/F1 usa su población más amplia, por separado. El XGBoost original congelado de 38E se vuelve a puntuar únicamente para NET_MOVE en las mismas filas externas comunes. Los escenarios `delayed` e `ideal` nunca se mezclan durante entrenamiento y se presentan por separado.

Los folds conservan las sesiones y cortes de 38E. Una fila de entrenamiento entra solo si pertenece a una sesión anterior y su etiqueta ya sería conocida estrictamente antes del primer instante del fold externo. Early stopping usa el último bloque cronológico del entrenamiento, con otra purga antes de ese bloque. Las filas externas del fold actual no intervienen en selección, transformadores, prevalencias ni entrenamiento.

## Ejecutar en Windows

Desde la raíz del repositorio, con Node y el entorno Python 3.12 local ya configurado:

```powershell
.\.venv\phase28-py312\Scripts\python.exe -m ml.phase41f.experiment `
  --history private/iex-history/nvda-2024-2026-phase38e `
  --run private/ml-iex/phase38e-20261023-v1 `
  --targets private/ml-iex/phase41d-target-protocol-v1 `
  --features private/ml-iex/phase41e-features-v1g `
  --sip-csv trading_poc_001_bollinger/data/NVDA_ALPACA_SIP_15min_20211017_20261017.csv `
  --out private/ml-iex/phase41f-model-comparison-v1
```

El destino debe ser nuevo. Las matrices, modelos, transformadores, predicciones, resultados, manifiesto y hashes quedan en `private/`, excluido de Git. Un fallo deja los archivos parciales para diagnóstico; para reintentar, use otro directorio o conserve el intento incompleto con otro nombre. No se entrena ni se publica ningún modelo de producción.

## Resultado local verificado (SIP +20 simulado)

La ejecución reconstruyó **27.972 observaciones** (13.986 por escenario). La paridad externa fue exacta en **16.374/16.374** filas para F0, F1 y F2, y en **49.122/49.122** objetivos. El escenario delayed tiene tres folds con **2.243, 2.432 y 1.483** resultados comparables F2, respectivamente: **6.158** en total. De ellos, 1.687 son BAJISTA en NET_MOVE. La población más amplia F0/F1 añade 61 resultados evaluables en el tercer fold, incluidos 18 BAJISTA. La cobertura y prevalencia no son idénticas entre poblaciones.

La auditoría de exclusiones separa objetivos indisponibles de variables incompletas: en el tercer fold delayed, 478 de 2.022 observaciones externas carecen de desenlace elegible; otras 61 tienen desenlace pero F2 incompleto. F0/F1 están completos para los 1.544 desenlaces disponibles. Las filas de entrenamiento elegibles de ese fold son 9.022 para los tres conjuntos; no se rellenaron valores faltantes.

El SHA-256 de la configuración congelada es `9980b2801398d6d9baedfb41035889b1d986c224f39bbd25c329f5cf1fd05c8d`. Los SHA-256 verificados de `strict-15m.csv`, observaciones 38E, etiquetas 41D, características 41E y CSV SIP son, respectivamente: `2af4982ab63ce73debb23f214953e22459f27ae58265a1c9b6a51075218a0533`, `e82747d2f1491a945f01ec5128384e949e95bba859bcb76772acf3e84ab35f55`, `a12e55fea626eba0dcbf9cf3477d701f201acd0808b85134e6e51c0d8144e1eb`, `d69620ac7abeaa114939885a68315145914291ee84eba6d46644d14b458002e3` y `7b06d0a493515b18a581963d2d2d488e73a7cd0dc2c961b60a99315e7a9b0ecc`. Los archivos completos y sus rutas privadas figuran en `manifest.json` local.

La tabla usa Macro F1 para NET_MOVE y PR-AUC para los dos objetivos binarios, siempre sobre las mismas 6.158 filas de la comparación principal. PR-AUC de la prevalencia histórica se muestra como referencia, no como precisión de clasificación.

| Objetivo | Modelo | F0 | F1 | F2 |
|---|---|---:|---:|---:|
| NET_MOVE, Macro F1 | prevalencia | 0,2085 | 0,2085 | 0,2085 |
| NET_MOVE, Macro F1 | logística | 0,2343 | 0,2402 | 0,3014 |
| NET_MOVE, Macro F1 | XGBoost | 0,3027 | 0,2998 | 0,2957 |
| NET_MOVE, Macro F1 | LightGBM | 0,2753 | 0,2653 | 0,2651 |
| DOWN_TOUCH, PR-AUC | prevalencia | 0,5671 | 0,5671 | 0,5671 |
| DOWN_TOUCH, PR-AUC | logística | 0,6432 | 0,6394 | 0,6219 |
| DOWN_TOUCH, PR-AUC | XGBoost | 0,6526 | 0,6493 | 0,6450 |
| DOWN_TOUCH, PR-AUC | LightGBM | 0,6453 | 0,6528 | 0,6495 |
| PERSISTENT_BEAR, PR-AUC | prevalencia | 0,2254 | 0,2254 | 0,2254 |
| PERSISTENT_BEAR, PR-AUC | logística | 0,2353 | 0,2347 | 0,2248 |
| PERSISTENT_BEAR, PR-AUC | XGBoost | 0,2411 | 0,2456 | 0,2426 |
| PERSISTENT_BEAR, PR-AUC | LightGBM | 0,2411 | 0,2415 | 0,2309 |

En NET_MOVE, XGBoost F0 detectó 5,81 % de los BAJISTA reales con precisión 34,63 %. F1 detectó 4,74 % y F2 5,99 %, con Macro F1 inferior a F0. LightGBM tampoco mejoró Macro F1 con F1/F2. La regresión logística F2 elevó el recall BAJISTA de 0,59 % a 7,94 % y Macro F1 de 0,2343 a 0,3014 en los tres folds, pero su precisión BAJISTA bajó de 40,0 % a 29,1 %, y su log loss y Brier **empeoraron** (1,0623→1,0883; 0,6407→0,6567). Esa tensión no permite afirmar una mejora probabilística.

En PERSISTENT_BEAR, XGBoost y LightGBM clasificaron **cero** observaciones positivas con la regla congelada de 0,5, pese a PR-AUC algo superior a la prevalencia. Una PR-AUC mayor no implica capacidad práctica de detectar la clase con esa regla. DOWN_TOUCH es más frecuente: 3.517/6.158 casos; no se interpreta su mayor PR-AUC como evidencia de mejor predicción de BAJISTA terminal.

En las diferencias pareadas por sesión, XGBoost F2−F0 para NET_MOVE dio Macro F1 −0,0070 con IC descriptivo 95 % [−0,0171; 0,0032]. Para DOWN_TOUCH, XGBoost F2−F0 dio PR-AUC −0,0076 [−0,0146; 0,0014]. Para PERSISTENT_BEAR, XGBoost F2−F0 dio PR-AUC +0,0015 [−0,0122; 0,0136]. La regresión logística F2−F0 sí elevó Macro F1 de NET_MOVE +0,0671 [0,0540; 0,0818], a la vez que empeoró log loss +0,0260 [0,0179; 0,0327]. Estos intervalos describen muestras ya exploradas y varias comparaciones, sin acreditar una ventaja generalizable.

La importancia interna de árboles F2 ubicó `sma_full_order_15m` y ciertos contextos de techo/piso entre las variables usadas en varios folds. Esto no contradice el resultado comparativo desfavorable de XGBoost F2; variables correlacionadas pueden atraer divisiones sin añadir utilidad fuera de muestra. Los detalles por fold, clase, importancia y sensibilidad semanal/mensual quedan en el reporte privado. **Conclusión:** en esta población histórica no hay evidencia consistente de utilidad adicional de F1 o F2 para XGBoost/LightGBM; el cambio de la regresión logística F2 requiere investigación futura independiente por su peor calidad probabilística.

## Lectura del reporte

`report.md` presenta tablas por objetivo y `delayed` principal. `metrics-by-fold.json` separa folds; `metrics-pooled.json` separa escenario, población y objetivo. `paired-comparisons.json` incluye F1−F0, F2−F0 y F2−F1 sobre las mismas filas y etiquetas; el bootstrap remuestrea sesiones completas dentro de cada fold y muestra sensibilidad semanal y mensual. `training-feature-coverage.json` revela tamaños y prevalencia BAJISTA; `feature-parity.json` revela reconstrucción y concordancia exacta. `predictions.csv` conserva probabilidades y etiquetas para auditar los cálculos. `SHA256SUMS` cubre los artefactos finales, modelos y transformadores.

Macro F1, balanced accuracy, precisión/recall BAJISTA y log loss corresponden a NET_MOVE. Para objetivos binarios, PR-AUC se lee junto a su prevalencia; Brier, log loss, precisión, recall y calibración son específicos de cada objetivo. Las métricas matemáticamente indefinidas por ausencia de una clase aparecen como `null` y un estado explícito. No se suman objetivos distintos para designar un modelo ganador.

## Limitaciones

Todo el histórico ya se investigó en fases anteriores, por lo que los folds externos son retrospectivos y exploratorios. SIP `split` puede contener ajustes corporativos posteriores; su latencia de +20 minutos es simulada y no representa una recepción histórica verificada. La comparación IEX/SIP no prueba equivalencia con captura en tiempo real. El bootstrap por sesión no siempre captura dependencia entre jornadas o cambios de régimen largos. Las variables correlacionadas no justifican atribución causal. Las aperturas OHLC no son ejecuciones garantizadas ni representan rentabilidad de opciones. Ningún resultado de 41F habilita predicciones prospectivas, reglas CALL/PUT u órdenes.
