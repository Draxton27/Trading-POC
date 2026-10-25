# Fase 41G: cambios SMA20/40 y visitas a medias

Estudio histórico exploratorio de NVDA. No hay entrenamiento, señal operativa, rentabilidad de opciones ni inferencia prospectiva. El protocolo fijo es [`ml/phase41g/protocol.json`](../ml/phase41g/protocol.json); sus reglas no se ajustaron a los resultados.

## Definiciones y procedencia

La fuente es el CSV privado NVDA Alpaca SIP de 15 minutos, regular, ajustado por splits, SHA-256 `7b06d0a493515b18a581963d2d2d488e73a7cd0dc2c961b60a99315e7a9b0ecc`. El puente TypeScript reutiliza el cargador, calendario oficial y SMA/interacciones de 41A/41B. Su salida es histórica: el cierre + 20 minutos es una **disponibilidad simulada**, no un timestamp de recepción que haya guardado Alpaca en 2021–2026. No se mezcla IEX `raw` con SIP `split`. La serie con ajuste retrospectivo por splits tampoco reproduce necesariamente el precio conocido originalmente en cada fecha.

Un **cambio** es un cruce estricto entre SMA20 y SMA40 observado al terminar una vela disponible; la igualdad aplaza la transición. Un **reinicio** es un cambio que devuelve la alineación de dos regímenes atrás. Cada reinicio también cuenta como cambio. En una secuencia binaria continua, prácticamente todos los cruces desde el tercero cumplen esa definición. Por ello `CHANGE` sin `RESTART` es un grupo muy pequeño y no permite una comparación estadística independiente con `RESTART`. Un cruce de medias no prueba por sí solo una tendencia duradera del precio.

Una primera visita verdadera requiere un régimen cuyo comienzo fue observado, una vela posterior enteramente separada por el lado del régimen y un toque posterior. Contactos consecutivos son un episodio; otra visita exige otra separación. Las visitas durante una alineación ya activa al inicio del histórico se marcan con censura izquierda. Una vela que toca varias SMA conserva eventos por período y un identificador de clúster común. El rechazo geométrico es información conocida solo al cierre de la vela de toque.

El desenlace se calcula después de fijar todos los eventos. Referencia: apertura de la primera vela programada **estrictamente posterior** a cierre + 20 minutos. Umbral favorable/adverso: ±0,5 ATR14 causal, medido desde la referencia en la dirección del régimen. El desenlace principal es el cierre de cuatro velas completas; se registran dos y seis como sensibilidades. En 15m y 1h no se traslada un horizonte incompleto a otra sesión; el diario utiliza sesiones consecutivas del calendario oficial. Los extremos intrabar se informan como excursiones, con empate de primera barrera marcado ambiguo. Las aperturas OHLC no son fills garantizados.

## Resultado histórico principal de 15 minutos

Cada celda muestra **eventos / evaluables / favorable / adverso** en cuatro velas. El denominador de las tasas son exclusivamente los evaluables. Las visitas censuradas a izquierda se excluyen.

| Régimen | SMA | Primera visita | Posteriores |
| --- | ---: | --- | --- |
| Bajista | 20 | 339 / 253 / 29,2 % / 28,1 % | 591 / 429 / 30,3 % / 29,4 % |
| Bajista | 40 | 351 / 277 / 25,6 % / 33,2 % | 339 / 273 / 29,3 % / 30,8 % |
| Bajista | 100 | 190 / 156 / 26,3 % / 28,8 % | 114 / 93 / 33,3 % / 29,0 % |
| Bajista | 200 | 118 / 101 / 31,7 % / 33,7 % | 77 / 68 / 19,1 % / 32,4 % |
| Alcista | 20 | 345 / 246 / 28,9 % / 30,5 % | 642 / 465 / 30,1 % / 26,5 % |
| Alcista | 40 | 355 / 261 / 28,4 % / 30,7 % | 382 / 291 / 28,2 % / 26,8 % |
| Alcista | 100 | 200 / 165 / 30,3 % / 30,9 % | 102 / 81 / 27,2 % / 37,0 % |
| Alcista | 200 | 112 / 91 / 28,6 % / 29,7 % | 51 / 42 / 28,6 % / 35,7 % |

En bajista SMA20, el IC 95 % por remuestreo de sesiones para la tasa favorable de primeras visitas es **23,3–34,8 %**, frente a **26,2–34,6 %** para visitas posteriores. Los IC por régimen son **23,7–35,2 %** y **26,0–34,6 %**. Estos intervalos se superponen ampliamente; no confirman una ventaja de la primera visita. Para SMA200 bajista, la diferencia puntual va en la otra dirección, pero hay solo 101 y 68 casos evaluables; su estimación es inestable y procede de comparaciones múltiples.

En el comparador predefinido de puntos sin visita, se emparejan observaciones anteriores del mismo régimen, SMA, bin de edad y hora local antes de calcular desenlaces. En bajista SMA20 hubo 395 pares evaluables; diferencia de tasa favorable visita menos control: **−4,3 puntos porcentuales**, IC 95 % por sesión **−9,1 a +0,5 puntos**. No constituye prueba de efecto causal. El reporte privado contiene los demás pares y los intervalos tanto por sesión como por régimen.

## Cambios, duración, cobertura y períodos

Se observaron **549 cambios alcistas y 551 bajistas** entre 15m, 1h y 1d. De ellos, **549 reinicios alcistas y 548 bajistas** según la definición binaria. La mediana de la alineación intermedia antes del reinicio es **30 velas** mezclando marcos, cifra que no debe convertirse a minutos. En 15m fueron 29 velas para reinicio alcista y 33 para bajista; en 1h, 27 y 33; en 1d, 26 y 32 sesiones. Se detectaron **2.694 primeras visitas verdaderas**, **2.976 posteriores** y **11 observaciones de visita con censura izquierda** entre los tres marcos.

El puente procesó **32.510** velas de 15m, **8.755** agregados de 1h y **1.255** diarios. En cada marco, 39 barras iniciales carecen aún de ambas SMA; en 15m hubo 3 empates. No aparecieron huecos ni agregados incompletos en este CSV verificado. La ausencia de gaps en esta fuente concreta no demuestra que otras capturas estén completas. En cuatro velas, **771** visitas terminaron sin horizonte dentro de la sesión y **753** carecieron de una apertura posterior elegible o quedaron censuradas al final del histórico. La evaluación de estos casos no se imputó.

La frecuencia favorable agregada a 15m cambia con el horizonte: alcista **25,2 % / 29,0 % / 33,9 %** y bajista **25,0 % / 28,6 % / 30,9 %** para 2/4/6 velas. Las muestras evaluables disminuyen con el horizonte. En 1h no hay seis velas consecutivas elegibles dentro de una sesión ordinaria tras el retraso; se informa `N/D`. El marco diario mide un objetivo temporal diferente y se conserva por separado.

La tasa favorable bajista SMA20 por año, sumando números de visita, fue: 2021 **30,4 %** (23 evaluables), 2022 **36,9 %** (160), 2023 **23,4 %** (137), 2024 **29,4 %** (119), 2025 **25,6 %** (121) y 2026 **32,8 %** (122). En el período comparable con 38E/41F desde 2024-06-10 fue **28,2 %** (309), frente a **31,4 %** (373) antes de esa fecha. Estas variaciones no sostienen estabilidad fuerte entre años; todo el histórico ya fue examinado en fases anteriores.

## Conclusión y límites

La hipótesis general de que la **primera** visita rebota más frecuentemente **no quedó confirmada**. En las dos SMA cortas del régimen bajista, la tasa favorable puntual fue menor en primeras visitas; en SMA100 también, y en SMA200 fue mayor con menos datos. Las diferencias de otras SMA y marcos son heterogéneas. No se puede atribuir esa variación a la visita: las visitas posteriores solo existen si el régimen sobrevive, varios eventos pueden compartir la misma vela, y el remuestreo por sesión o régimen no captura necesariamente dependencias entre jornadas o cambios prolongados de régimen. Las comparaciones CHANGE/RESTART carecen de grupos independientes por construcción. Es razonable formular hipótesis futuras sobre edad de régimen y SMA, pero requerirían un protocolo nuevo y datos no examinados.

Los recuentos por SMA, año, hora, edad, dirección y origen, estados de censura, excursiones, ambigüedad intrabar y el protocolo SHA-256 están en el reporte privado. Una tasa histórica de caída de NVDA no equivale a rentabilidad de PUT.

## Reproducción en Windows

Desde la raíz del repositorio, con Python 3.12 y Node 22 o 24:

```powershell
npm.cmd ci
python -m unittest ml.phase41g.test_events
npm.cmd run ml:investep:events -- --sip-csv trading_poc_001_bollinger/data/NVDA_ALPACA_SIP_15min_20211017_20261017.csv --out private/ml-iex/phase41g-investep-trend-events-NUEVA-EJECUCION --expected-sha256 7b06d0a493515b18a581963d2d2d488e73a7cd0dc2c961b60a99315e7a9b0ecc
```

La salida debe ser un directorio nuevo; el comando rechaza sobrescrituras. `private/` está ignorado por Git. Para verificar SHA de salidas, revisar `SHA256SUMS`; el manifiesto conserva hashes del código TypeScript/Python y del protocolo. Las salidas preliminares privadas de esta fase se conservaron; el informe definitivo es el directorio `phase41g-investep-trend-events-v1`.
