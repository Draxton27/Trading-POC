# Fase 37: contexto informativo de observaciones XGBoost

Este estudio usa las probabilidades originales del modelo congelado. No reentrena XGBoost, no modifica predicciones y no crea señales. El dataset se construye localmente a partir de los ledgers privados de observaciones adelantadas al desenlace (Fase 34), evaluaciones originales (Fase 35), noticias y clasificaciones (Fase 36).

## Ejecutar en Windows

Configure `TRADING_POC_ML_RUN_DIR` en `.env.local` con el experimento congelado y mantenga las rutas privadas habituales. Luego, desde la raíz:

```powershell
npm.cmd run ml:news-context -- --once
```

El comando lee las observaciones y evaluaciones desde `private/ml-forward-observation` y `private/ml-evaluation` de la raíz, igual que sus CLI productores. Respeta `TRADING_POC_ML_FORWARD_OBSERVATION_LOG` y `TRADING_POC_ML_EVALUATION_LOG` cuando se configuraron rutas explícitas. Lee noticias según `TRADING_POC_PRIVATE_DIR` y `TRADING_POC_NEWS_DIR`. Opcionalmente, `TRADING_POC_ML_NEWS_CONTEXT_DIR` elige el directorio de salida. De forma predeterminada se escribe en `ml-news-context` dentro del directorio privado resuelto (en Windows, `%LOCALAPPDATA%\Trading-POC` cuando está disponible). Genera `dataset.csv`, `summary.json` y `manifest.json`; todos permanecen fuera de Git. El manifiesto registra SHA-256 de las entradas y salidas, orden de columnas y política de unión. El endpoint GET `/api/v1/ml/news-context?symbol=NVDA&timeframe=15m` devuelve solo el resumen validado, nunca el CSV ni rutas privadas. Reconstruya el dataset tras nuevas ingestas, clasificaciones o evaluaciones.

## Regla temporal fija

El instante de corte es `registeredAtUtc`, cuando quedó registrada la predicción. Una noticia cuenta solo si su primera recepción, la recepción de la revisión seleccionada y el fin de la clasificación de esa misma revisión son **estrictamente anteriores** a ese instante. La fecha declarada de publicación no sustituye la recepción local: una noticia publicada antes pero recibida después queda excluida. Entre las revisiones disponibles antes del corte se usa la última; si todavía no estaba clasificada, no se reutiliza una clasificación de contenido anterior. Se incluyen artículos clasificados con NVDA explícito o categoría `MACROECONOMIA`, regla fijada antes de mirar resultados. Si Ollama indicó evidencia insuficiente, el artículo cuenta para cobertura pero queda fuera del desglose por sentimiento, relevancia y categoría. La ventana de 60, 180 o 390 minutos se mide desde la recepción de la revisión, no desde la publicación.

Cada fila conserva identificador y hash del modelo, timestamps, probabilidades originales, clase real solo si existe una evaluación original `VERIFIED`, hash de esa evaluación y hashes/timestamps/proveedor de las noticias utilizadas. Las revisiones posteriores de Alpaca o noticias no cambian una fila ya definida para su instante de corte. Las observaciones sin desenlace permanecen en el CSV y no entran en métricas.

## Protocolo estadístico

El baseline es el propio XGBoost congelado, sin ajustar sus probabilidades. `summary.json` registra accuracy y log loss globales y condicionados a presencia de noticias; también desglosa sentimiento, relevancia, categoría y ventanas. En cada grupo se registra además el residuo medio por clase (`1` si ocurrió esa clase, `0` si no, menos la probabilidad XGBoost original). Un residuo sistemático podría motivar una investigación futura sobre información adicional, pero con pocos datos no demuestra mejora. Las observaciones se dividen 70/30 por sesiones NYSE completas ordenadas cronológicamente. El 30 % posterior se muestra por separado y no se usa para ajustar parámetros ni elegir grupos. La diferencia entre observaciones con y sin noticias es descriptiva y puede reflejar hora, volatilidad, selección de noticias o régimen de mercado. Si hay al menos 30 observaciones evaluadas, 10 sesiones y 10 observaciones en cada grupo, se calcula un intervalo percentil del 95 % con 500 remuestreos de sesiones completas y semilla fija. En otro caso se indica muestra insuficiente.

El sistema **no calcula una probabilidad modificada por noticias**: no existe aún un modelo contextual entrenado y evaluado causalmente. Por tanto, estas tablas exploran si podría haber información residual; no prueban una mejora incremental ni un efecto causal de las noticias. Varias categorías pueden aparecer en una misma observación; sus grupos se superponen. Ollama puede equivocarse al clasificar, la cobertura de fuentes es limitada, las observaciones de una sesión son dependientes y el histórico previo del proyecto ya fue examinado. La evidencia es observacional y no independiente. Los hashes del manifiesto detectan inconsistencias locales, pero por sí solos no prueban autenticidad de fuentes externas. No sirve para recomendar CALL/PUT ni para inferir rentabilidad ejecutable.
