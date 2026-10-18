# Fase 18 — método técnico humano y viabilidad de opciones

Todo 2021–2026 es exploratorio y ya se examinó en fases anteriores. **No hay validación independiente ni estrategia rentable demostrada.** Protocolo preregistrado: `8aecb621b4bf284320a9b2fa3e5f0a8fd8a5006f`. CSV NVDA SHA-256: `7b06d0a493515b18a581963d2d2d488e73a7cd0dc2c961b60a99315e7a9b0ecc`.

## Investigación A: datos y características medibles

32510 intervalos regulares de 15 minutos en 1255 sesiones; agregados horarios completos 8755/8755, diarios 1255/1255. QQQ/SMH: 28745/28745 retornos de cuatro velas disponibles. 3508 intervalos tienen un evento F14 conocido. Un campo de evento vacío no descarta otras noticias.

Orden de cuatro SMA horario (conteos): {"bullish":9448,"bearish":4468,"other":17852,"insufficient":742}; diario: {"bullish":13564,"bearish":1560,"other":12198,"insufficient":5188}. Porcentaje del tiempo horario: {"bullish":29.061827130113812,"bearish":13.743463549677022,"other":54.912334666256534,"insufficient":2.28237465395263}; diario: {"bullish":41.722546908643494,"bearish":4.7985235312211625,"other":37.5207628422024,"insufficient":15.958166717932944}. Se miden orden, pendientes, distancia del precio, separación continua, cruces, persistencia y transiciones intrasesión. Las pendientes no se infieren del orden. El [CSV individual](phase18-sma-structures.csv) conserva cada observación; las transiciones agregadas constan en [integridad](phase18-data-integrity.json).

9684 filas descriptivas de aproximación, contacto, cruce y recuperación de SMA20/40 horarias aparecen en [eventos](phase18-pullback-events.csv). Un contacto puede compartir episodio con otra fila; el identificador y marca de repetición evitan tratarlo como evidencia independiente. La recuperación de las dos velas posteriores se conoce solo al cierre de su propia vela. Los máximos/mínimos anteriores son calculados, no niveles dibujados por el operador.

## Comportamiento histórico a 30 minutos

Las cifras siguientes son porcentajes firmados desde una **apertura teórica sin latencia** de la vela siguiente. Intervalos del 95%: 2.000 remuestras por sesión con semilla 180026. Referencia: año y bloque horario comparables, excluida la misma sesión.

| Configuración | Resultados | Sesiones | Media % | Diferencia frente a referencia % | IC95 media % |
| --- | ---: | ---: | ---: | ---: | --- |
| hour_bullish | 8724 | 420 | -0.0048 | -0.0140 | [-0.0199, 0.0104] |
| hour_bearish | 4128 | 201 | -0.0145 | -0.0152 | [-0.0534, 0.0218] |
| contact_sma20_bullish | 383 | 140 | 0.0499 | 0.0435 | [-0.0248, 0.1152] |
| contact_sma20_bearish | 166 | 71 | 0.0464 | 0.0516 | [-0.0870, 0.1833] |
| contact_sma40_bullish | 247 | 95 | -0.0179 | -0.0238 | [-0.1000, 0.0687] |
| contact_sma40_bearish | 121 | 61 | -0.0253 | -0.0191 | [-0.3026, 0.1790] |

Las medias negativas y los intervalos que abarcan cero se documentan expresamente; ningún subgrupo se convierte en regla por destacar entre muchas comparaciones. El [resultado completo](phase18-descriptive-results.csv) incluye media, mediana, favorable, MFE/MAE, cobertura de controles y horizontes 15/30/60; el principal se desglosa también por año. MFE/MAE no son precios ejecutables. El año y los eventos se vuelven muestras pequeñas en varios subgrupos.

## Relación con seis familias congeladas

1242 señales F11/F12 se enlazaron por índice y timestamp, con **0 discrepancias** de retorno principal y **0 de contexto** frente a los resultados publicados. Órdenes de sus SMA: {"hour":{"bullish":392,"bearish":188,"other":647,"insufficient":15},"day":{"bullish":513,"bearish":64,"other":456,"insufficient":209}}. Desglose de orden horario por familia: {"breakout_bearish":{"bullish":0,"bearish":90,"other":138,"insufficient":0},"breakout_bullish":{"bullish":177,"bearish":0,"other":170,"insufficient":5},"failed_high_bearish":{"bullish":69,"bearish":25,"other":85,"insufficient":3},"failed_low_bullish":{"bullish":41,"bearish":29,"other":109,"insufficient":5},"pullback_bearish":{"bullish":0,"bearish":44,"other":72,"insufficient":0},"pullback_bullish":{"bullish":105,"bearish":0,"other":73,"insufficient":2}}. [Cada comparación](phase18-previous-signals-comparison.csv) conserva estructura, distancias, contexto QQQ/SMH, régimen y evento disponible sin reemplazar la señal original. Esto mide cuánta superposición hay con la descripción humana; no demuestra que el detector represente su elección discrecional.

## Investigación B: datos reales de opciones

La [auditoría de proveedores](phase18-options-provider-audit.md) documenta cobertura, resolución, bid/ask, tamaños, costo y licencias de Alpaca, ThetaData, ORATS y Cboe. En la cuenta Alpaca actual, el GET de quote OPRA reciente devolvió 403 y la ruta histórica de quotes probada 404; el GET indicativo devolvió 200. Por ello, la auditoría marca `not_run_no_authorized_historical_opra_quotes` y el [piloto](phase18-options-pilot.csv) queda sin filas. Una quote indicativa o una barra de operaciones no se considera prima OPRA realizable.

## Conclusión y evidencia faltante

Se pueden medir objetivamente SMA 20/40/100/200, pendiente, orden, separaciones, niveles previos, Bollinger y contexto de QQQ/SMH. Se observaron configuraciones y trayectorias variadas, incluidas medias desfavorables y comparaciones sin mejora defendible; todo procede del mismo historial ya estudiado. Para evaluar CALL/PUT faltan una cadena y quotes históricas OPRA auténticas con tamaños, licencia, contratos ajustados, costos y tiempos de disponibilidad. Para afirmar viabilidad económica faltan además decisiones y fills humanos originales documentados antes del desenlace, prueba de ejecución y validación con datos nuevos. El Recom de Finviz no se asignó a sesiones porque su captura F17 carece de fecha de mercado. No se crean órdenes ni reglas de entrada.

## Validación técnica

`npm ci`, comprobación de tipos y **168/168 pruebas** aprobadas. Los nueve validadores históricos aplicables terminaron correctamente conservando los paquetes publicados; la auditoría completa y el efecto editorial de `codeVersion` en validadores antiguos constan en [validación](phase18-validation-report.md).
