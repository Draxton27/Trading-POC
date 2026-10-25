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

## Lectura del reporte

`report.md` presenta tablas por objetivo y `delayed` principal. `metrics-by-fold.json` separa folds; `metrics-pooled.json` separa escenario, población y objetivo. `paired-comparisons.json` incluye F1−F0, F2−F0 y F2−F1 sobre las mismas filas y etiquetas; el bootstrap remuestrea sesiones completas dentro de cada fold y muestra sensibilidad semanal y mensual. `training-feature-coverage.json` revela tamaños y prevalencia BAJISTA; `feature-parity.json` revela reconstrucción y concordancia exacta. `predictions.csv` conserva probabilidades y etiquetas para auditar los cálculos. `SHA256SUMS` cubre los artefactos finales, modelos y transformadores.

Macro F1, balanced accuracy, precisión/recall BAJISTA y log loss corresponden a NET_MOVE. Para objetivos binarios, PR-AUC se lee junto a su prevalencia; Brier, log loss, precisión, recall y calibración son específicos de cada objetivo. Las métricas matemáticamente indefinidas por ausencia de una clase aparecen como `null` y un estado explícito. No se suman objetivos distintos para designar un modelo ganador.

## Limitaciones

Todo el histórico ya se investigó en fases anteriores, por lo que los folds externos son retrospectivos y exploratorios. SIP `split` puede contener ajustes corporativos posteriores; su latencia de +20 minutos es simulada y no representa una recepción histórica verificada. La comparación IEX/SIP no prueba equivalencia con captura en tiempo real. El bootstrap por sesión no siempre captura dependencia entre jornadas o cambios de régimen largos. Las variables correlacionadas no justifican atribución causal. Las aperturas OHLC no son ejecuciones garantizadas ni representan rentabilidad de opciones. Ningún resultado de 41F habilita predicciones prospectivas, reglas CALL/PUT u órdenes.
