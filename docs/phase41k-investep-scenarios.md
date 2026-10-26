# Fase 41K: escenarios técnicos descriptivos

El Radar presenta escenarios para NVDA, QQQ y SMH sobre velas de 15 minutos y estructuras agregadas de 1 hora y 1 día. El endpoint `GET /api/v1/radar/scenarios?symbol=NVDA` acepta únicamente esos tres símbolos y un `asOfUtc` ISO opcional. Consulta archivos locales; no llama a Alpaca, IBKR, Ollama, Python ni escribe en ledgers. No genera órdenes, señales CALL/PUT, probabilidades de éxito ni recomendaciones.

## Procedencia y reglas

El motor puro `phase41k-scenarios.ts` compone los eventos, medias, niveles y compatibilidad ya calculados por Fase 41A. Bollinger 20/2, retornos y RVOL proceden de `analyzeMarketBars`, usado por el Radar. Las definiciones geométricas y la ventana de cuatro velas del retesteo siguen en 41A. No se añadió ningún umbral de distancia ni el filtro RVOL 1,5. Las pendientes de las cuatro SMA y el orden de las parejas SMA20/40 y SMA100/200 se muestran por separado.

Las cuatro familias son `SMA_PULLBACK_REJECTION`, `SMA_STRUCTURE_BREAK` (distingue `CROSS` y `FULL_CANDLE_BREAK`), `SMA_BREAK_RETEST` y `BOLLINGER_VOLUME_CONTEXT`. `OBSERVED` significa únicamente que se detectó el hecho geométrico; `AWAITING_CONFIRMATION`, `FAILED` y `EXPIRED` conservan los estados causales de 41A. La permanencia encima o debajo de una media se ve en la posición del precio, sin inventar una ruptura en cada vela. El contexto Bollinger puede ser neutral o insuficiente y nunca activa una operación.

Un evento se presenta como escenario de la **última vela disponible de su propia temporalidad** solo si su `barStartUtc` coincide con el inicio de esa vela. Un retesteo pendiente solo figura allí mientras 41A lo mantiene pendiente. Los eventos anteriores se muestran en una sección histórica **sin** medias, contradicciones ni niveles calculados después del evento: ese snapshot pasado no se reconstruye en 41K. En un evento de 1h o 1d, los marcos inferiores cuyo último cierre es posterior al evento quedan marcados N/D. El identificador SHA-256 depende de símbolo, familia, tipo de evento, temporalidad, SMA, dirección y vela o episodio original; abrir el Radar de nuevo no crea un evento. Si 41A emite actualizaciones de un mismo retesteo, el episodio conserva su identidad. El listado tiene límites de 40 escenarios actuales y 50 históricos, ordenados por fecha descendente, temporalidad 15m/1h/1d, familia y SMA. Ese desempate es de presentación, no una escala de fuerza predictiva.

La salida mantiene contradicciones de **ambas** parejas de medias de cada temporalidad. Una pareja con orden opuesto a la dirección geométrica se informa, sin resolverla por votación ni asignarle probabilidad. La igualdad de medias, las pendientes, SMA ausentes, niveles potenciales y rangos previos permanecen visibles. Un máximo previo es un nivel potencial, no una resistencia confirmada.

## Tiempo y disponibilidad

`asOfUtc` es el corte de consulta. Solo entran velas cerradas y, cuando existe `receivedAtUtc`, recibidas antes del corte. Los eventos previos y las observaciones sintéticas nunca aparecen como cotizaciones actuales. La respuesta distingue `SYNTHETIC`, `HISTORICAL`, `STALE` y `UNAVAILABLE`.

`eventAtUtc` conserva el instante de observación emitido por 41A y `trigger.barStartUtc` identifica la vela; `availableAtUtc` solo se informa como recepción verificada cuando todas las velas consultadas tienen marcas de recepción. Se toma el instante más tardío entre la observación del evento y la recepción de los datos completos usados por el contexto, para que una revisión tardía no quede atribuida al cierre anterior. Para importaciones históricas sin esa evidencia vale `null`. El `availableAtUtc` de un nivel heredado de 41A indica la disponibilidad **calculada desde cierres** en esa estructura, no prueba que nuestro sistema recibiera la vela entonces; `source.receiptVerified=false` y la limitación explican esta diferencia. El contexto Bollinger usa la última recepción necesaria para las métricas cuando está verificada. `HISTORICAL` y `STALE` describen la última observación almacenada, nunca el precio actual.

La API valida procedencia Alpaca SIP ajustada por splits y calendario oficial para datos reales, igual que 41A. IEX `raw`, precios IBKR y un calendario ausente no sustituyen silenciosamente esa fuente. DEMO usa una sesión sintética declarada como tal. La vista conserva separadas las tarjetas existentes del Radar, el contexto 41A y las predicciones experimentales IEX.

## Alcance metodológico

El uso de medias, temporalidades, Bollinger, volumen, niveles y confirmación se atribuye a documentación del método humano, pero varios umbrales y decisiones siguen pendientes de cotejo con fuentes originales. Las clasificaciones de 41A/41K son convenciones de investigación. Los estudios 41G y 41H no establecieron una ventaja consistente de primeras visitas o rechazos para continuación favorable de 0,5 ATR a cuatro velas. Noticias, referencias ASK y probabilidades XGBoost no se combinan para confirmar un escenario. Ninguna asociación descriptiva se interpreta como rentabilidad de opciones.

## Uso y validación

En Windows, con el proyecto instalado y un modo local configurado:

```powershell
npm.cmd run dev:offline
# En otra terminal: GET http://127.0.0.1:4300/api/v1/radar/scenarios?symbol=NVDA
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
```

Las pruebas usan datos sintéticos y verifican clasificación de familias y estados, contradicciones, identidad estable, separación temporal, recepción tardía, procedencia, niveles, respuesta DEMO, consulta de solo lectura y la vista Radar. La fuente local histórica puede estar incompleta o faltar: en tal caso se informa insuficiencia o indisponibilidad, sin completar velas.
