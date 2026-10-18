# Fase 10 — NVDA: contexto SMA multitemporal

Fuente local: NVDA_ALPACA_SIP_15min_20211017_20261017.csv. Se preservaron 781 señales de Fase 9: 413 alcistas y 368 bajistas.
Calendario: declarado por el importador como respuesta del calendario de Alpaca; este estudio no certifica su origen de forma independiente. Corte cronológico por sesiones: 2025-04-21. El último 30% ya fue examinado y no es validación independiente.

## Construcción temporal

Una hora: 8755 intervalos programados, 8755 completos y 0 incompletos. 1255 son finales abreviados por calendario y 1255 contienen todas sus velas esperadas.
Un día: 1255 sesiones agregadas, 1255 completas y 0 incompletas. Las sesiones incompletas se conservan para auditoría, pero no entran en ninguna SMA diaria.
Los intervalos horarios se anclan a las 09:30 de Nueva York. La última vela normal 15:30–16:00 dura 30 minutos y sí entra en las SMA cuando contiene sus dos velas de 15 minutos. Los cierres anticipados usan el cierre programado del calendario. Esta convención no se presenta como equivalente a TC2000 sin contrastar su configuración.
Cada señal usa la última vela superior completa cuyo cierre es anterior o igual al inicio de la vela de señal. El cierre parcial de la hora o del día de la señal queda excluido.

## Cobertura

| Temporalidad | SMA | Velas completas | Velas con SMA | Primera disponibilidad | Señales con SMA | Primer 70% | Último 30% |
|---|---:|---:|---:|---|---:|---:|---:|
| 1 hora | 20 | 8755 | 8736 | 2021-10-20T19:30:00.000Z | 781 | 539 | 242 |
| 1 hora | 40 | 8755 | 8716 | 2021-10-25T18:30:00.000Z | 781 | 539 | 242 |
| 1 hora | 100 | 8755 | 8656 | 2021-11-05T15:30:00.000Z | 776 | 534 | 242 |
| 1 hora | 200 | 8755 | 8556 | 2021-11-26T18:00:00.000Z | 769 | 527 | 242 |
| 1 día | 20 | 1255 | 1236 | 2021-11-12T21:00:00.000Z | 774 | 532 | 242 |
| 1 día | 40 | 1255 | 1216 | 2021-12-13T21:00:00.000Z | 763 | 521 | 242 |
| 1 día | 100 | 1255 | 1156 | 2022-03-10T21:00:00.000Z | 725 | 483 | 242 |
| 1 día | 200 | 1255 | 1056 | 2022-08-03T20:00:00.000Z | 657 | 415 | 242 |


Señales con las cuatro SMA horarias: 769. Con las cuatro diarias: 657. Con las ocho SMA: 657 (415 en exploración y 242 en evaluación).
La SMA 200 diaria no está disponible para ninguna señal del primer 70%; con este archivo no existe una evaluación cronológica independiente de las condiciones que la requieren.

## Resumen interpretativo

En el historial completo, 4 comparaciones tuvieron un intervalo descriptivo que no cruzó cero; en el primer 70% hubo 1 y en el último 30% hubo 3.
Las comparaciones del historial completo fueron: 1h: orden SMA20 < SMA40 < SMA100 < SMA200 / Alcista / 15m; 1h SMA 100: precio alineado con la señal / Alcista / 30m; 1h SMA 100: precio contrario a la señal / Alcista / 30m; 1d: orden SMA20 > SMA40 > SMA100 > SMA200 / Bajista / 15m.
La ausencia de repetición con muestra suficiente en los tramos cronológicos, junto con el número de comparaciones, impide considerar estos casos evidencia defendible de mejora. Las SMA aportan variables de contexto y segmentación, pero este archivo no demuestra una ventaja estable.

## Método estadístico

Cada condición selecciona un subconjunto descriptivo de las señales Bollinger originales. Se compara con Bollinger restringido a señales que tenían disponible la misma información y el mismo horizonte. La entrada hipotética permanece en la apertura de la siguiente vela de 15 minutos y las salidas en los cierres de la primera, segunda y cuarta vela, sin cruzar sesiones.
Los intervalos del 95% usan 2.000 remuestreos de sesiones completas y se omiten con menos de 30 resultados o 10 sesiones. El control horario usa observaciones sin señal del mismo intervalo local y segmento, pero no empareja régimen de SMA; se considera una referencia descriptiva limitada.
Contexto alcista de una temporalidad significa que su último cierre está por encima de las cuatro SMA; bajista, por debajo. Coincidencia exige que 1h y 1d sean ambos alcistas o ambos bajistas. Contradicción exige sentidos opuestos. Los contextos mixtos no se fuerzan a una dirección.

Condiciones conjuntas registradas:

- hour_above_all: 1h: precio encima de las cuatro SMA.
- hour_below_all: 1h: precio debajo de las cuatro SMA.
- hour_bullish_order: 1h: orden SMA20 > SMA40 > SMA100 > SMA200.
- hour_bearish_order: 1h: orden SMA20 < SMA40 < SMA100 < SMA200.
- day_above_all: 1d: precio encima de las cuatro SMA.
- day_below_all: 1d: precio debajo de las cuatro SMA.
- day_bullish_order: 1d: orden SMA20 > SMA40 > SMA100 > SMA200.
- day_bearish_order: 1d: orden SMA20 < SMA40 < SMA100 < SMA200.
- timeframes_agree: 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA.
- timeframes_contradict: 1h y 1d se contradicen en contexto de precio sobre/bajo las cuatro SMA.

## Historial completo: SMA individuales

Cada celda muestra: resultados evaluables; frecuencia favorable; movimiento medio firmado; movimiento favorable medio; movimiento desfavorable medio.

| TF | SMA | Dirección | Horizonte | Precio alineado n; fav.; media; fav. media; desfav. media | Precio contrario | Pendiente alineada | Pendiente contraria |
|---|---:|---|---:|---|---|---|---|
| 1h | 20 | Alcista | 15m | 228; 53.1%; -0.001%; +0.443%; -0.517% | 143; 51.0%; 0.057%; +0.531%; -0.456% | 226; 53.1%; -0.007%; +0.418%; -0.497% | 145; 51.0%; 0.066%; +0.570%; -0.487% |
| 1h | 20 | Alcista | 30m | 220; 49.5%; 0.003%; +0.617%; -0.616% | 136; 52.9%; 0.051%; +0.645%; -0.637% | 219; 47.5%; -0.041%; +0.578%; -0.622% | 137; 56.2%; 0.122%; +0.697%; -0.627% |
| 1h | 20 | Alcista | 60m | 199; 52.8%; 0.086%; +0.790%; -0.715% | 123; 53.7%; 0.097%; +0.974%; -0.952% | 196; 52.6%; 0.048%; +0.743%; -0.738% | 126; 54.0%; 0.156%; +1.039%; -0.911% |
| 1h | 20 | Bajista | 15m | 158; 51.9%; 0.031%; +0.502%; -0.491% | 180; 47.8%; 0.021%; +0.485%; -0.408% | 157; 51.0%; 0.025%; +0.493%; -0.474% | 181; 48.6%; 0.026%; +0.494%; -0.421% |
| 1h | 20 | Bajista | 30m | 147; 58.5%; 0.070%; +0.661%; -0.762% | 170; 51.8%; 0.053%; +0.608%; -0.550% | 148; 56.1%; 0.074%; +0.682%; -0.704% | 169; 53.8%; 0.050%; +0.591%; -0.589% |
| 1h | 20 | Bajista | 60m | 125; 52.8%; 0.100%; +1.040%; -0.984% | 155; 49.7%; 0.050%; +0.899%; -0.810% | 129; 50.4%; 0.109%; +1.100%; -0.942% | 151; 51.7%; 0.041%; +0.852%; -0.836% |
| 1h | 40 | Alcista | 15m | 240; 53.3%; 0.004%; +0.418%; -0.487% | 131; 50.4%; 0.054%; +0.588%; -0.504% | 233; 52.8%; 0.022%; +0.438%; -0.456% | 138; 51.4%; 0.021%; +0.542%; -0.556% |
| 1h | 40 | Alcista | 30m | 233; 50.6%; 0.015%; +0.609%; -0.611% | 123; 51.2%; 0.034%; +0.664%; -0.648% | 227; 49.8%; 0.020%; +0.602%; -0.567% | 129; 52.7%; 0.025%; +0.673%; -0.734% |
| 1h | 40 | Alcista | 60m | 211; 54.0%; 0.122%; +0.804%; -0.694% | 111; 51.4%; 0.030%; +0.974%; -1.004% | 206; 52.9%; 0.115%; +0.815%; -0.700% | 116; 53.4%; 0.045%; +0.941%; -0.983% |
| 1h | 40 | Bajista | 15m | 153; 51.0%; 0.016%; +0.480%; -0.480% | 185; 48.6%; 0.034%; +0.505%; -0.417% | 145; 52.4%; 0.019%; +0.482%; -0.492% | 193; 47.7%; 0.031%; +0.503%; -0.411% |
| 1h | 40 | Bajista | 30m | 143; 57.3%; 0.066%; +0.659%; -0.733% | 174; 52.9%; 0.057%; +0.612%; -0.572% | 136; 54.4%; 0.068%; +0.694%; -0.691% | 181; 55.2%; 0.056%; +0.590%; -0.604% |
| 1h | 40 | Bajista | 60m | 126; 50.8%; 0.126%; +1.100%; -0.925% | 154; 51.3%; 0.029%; +0.855%; -0.853% | 121; 53.7%; 0.203%; +1.157%; -0.955% | 159; 49.1%; -0.027%; +0.804%; -0.838% |
| 1h | 100 | Alcista | 15m | 235; 54.9%; 0.060%; +0.468%; -0.457% | 134; 47.8%; -0.049%; +0.488%; -0.548% | 221; 54.8%; 0.067%; +0.471%; -0.444% | 148; 48.6%; -0.049%; +0.480%; -0.558% |
| 1h | 100 | Alcista | 30m | 229; 52.8%; 0.102%; +0.645%; -0.514% | 125; 48.0%; -0.120%; +0.596%; -0.819% | 213; 53.1%; 0.084%; +0.607%; -0.517% | 141; 48.2%; -0.067%; +0.664%; -0.781% |
| 1h | 100 | Alcista | 60m | 206; 54.9%; 0.187%; +0.843%; -0.638% | 114; 49.1%; -0.092%; +0.910%; -1.059% | 189; 52.9%; 0.163%; +0.854%; -0.634% | 131; 52.7%; -0.021%; +0.883%; -1.043% |
| 1h | 100 | Bajista | 15m | 140; 49.3%; -0.015%; +0.472%; -0.496% | 196; 50.5%; 0.059%; +0.508%; -0.407% | 141; 47.5%; 0.002%; +0.462%; -0.425% | 195; 51.8%; 0.047%; +0.514%; -0.460% |
| 1h | 100 | Bajista | 30m | 129; 58.1%; 0.079%; +0.664%; -0.734% | 186; 53.2%; 0.057%; +0.612%; -0.582% | 132; 54.5%; 0.034%; +0.635%; -0.687% | 183; 55.7%; 0.089%; +0.634%; -0.606% |
| 1h | 100 | Bajista | 60m | 113; 54.0%; 0.195%; +1.122%; -0.966% | 165; 49.7%; 0.007%; +0.848%; -0.824% | 117; 53.8%; 0.104%; +0.980%; -0.991% | 161; 49.7%; 0.068%; +0.952%; -0.805% |
| 1h | 200 | Alcista | 15m | 235; 55.7%; 0.066%; +0.452%; -0.432% | 131; 47.3%; -0.036%; +0.521%; -0.543% | 217; 53.9%; 0.048%; +0.448%; -0.433% | 149; 51.0%; 0.003%; +0.514%; -0.537% |
| 1h | 200 | Alcista | 30m | 227; 52.9%; 0.066%; +0.582%; -0.522% | 124; 48.4%; -0.035%; +0.721%; -0.780% | 209; 53.1%; 0.073%; +0.561%; -0.489% | 142; 48.6%; -0.033%; +0.737%; -0.792% |
| 1h | 200 | Alcista | 60m | 203; 53.7%; 0.135%; +0.764%; -0.621% | 114; 51.8%; 0.019%; +1.044%; -1.080% | 187; 53.5%; 0.130%; +0.767%; -0.622% | 130; 52.3%; 0.040%; +1.003%; -1.032% |
| 1h | 200 | Bajista | 15m | 124; 49.2%; -0.034%; +0.479%; -0.549% | 208; 50.5%; 0.070%; +0.509%; -0.382% | 123; 51.2%; 0.031%; +0.559%; -0.551% | 209; 49.3%; 0.031%; +0.461%; -0.387% |
| 1h | 200 | Bajista | 30m | 116; 54.3%; 0.045%; +0.696%; -0.728% | 195; 55.9%; 0.085%; +0.607%; -0.583% | 114; 57.0%; 0.071%; +0.745%; -0.822% | 197; 54.3%; 0.070%; +0.576%; -0.538% |
| 1h | 200 | Bajista | 60m | 105; 50.5%; 0.127%; +1.192%; -1.037% | 169; 52.1%; 0.065%; +0.828%; -0.765% | 105; 56.2%; 0.120%; +1.048%; -1.173% | 169; 48.5%; 0.069%; +0.905%; -0.718% |
| 1d | 20 | Alcista | 15m | 233; 54.9%; 0.075%; +0.463%; -0.418% | 135; 48.1%; -0.049%; +0.496%; -0.563% | 227; 51.1%; 0.030%; +0.445%; -0.422% | 141; 54.6%; 0.029%; +0.519%; -0.570% |
| 1d | 20 | Alcista | 30m | 225; 51.6%; 0.077%; +0.619%; -0.510% | 128; 50.8%; -0.048%; +0.644%; -0.800% | 219; 50.2%; 0.029%; +0.576%; -0.532% | 134; 53.0%; 0.035%; +0.710%; -0.762% |
| 1d | 20 | Alcista | 60m | 203; 53.7%; 0.161%; +0.815%; -0.618% | 116; 51.7%; -0.020%; +0.958%; -1.087% | 196; 52.0%; 0.093%; +0.759%; -0.642% | 123; 54.5%; 0.097%; +1.028%; -1.054% |
| 1d | 20 | Bajista | 15m | 131; 48.9%; -0.014%; +0.486%; -0.499% | 204; 50.5%; 0.055%; +0.502%; -0.408% | 123; 49.6%; 0.020%; +0.518%; -0.485% | 211; 49.8%; 0.032%; +0.487%; -0.422% |
| 1d | 20 | Bajista | 30m | 122; 52.5%; 0.025%; +0.692%; -0.711% | 192; 57.3%; 0.096%; +0.601%; -0.588% | 116; 55.2%; 0.074%; +0.734%; -0.738% | 197; 55.3%; 0.064%; +0.580%; -0.581% |
| 1d | 20 | Bajista | 60m | 110; 51.8%; 0.096%; +1.067%; -1.027% | 167; 51.5%; 0.085%; +0.896%; -0.776% | 105; 55.2%; 0.140%; +1.011%; -1.023% | 171; 49.1%; 0.054%; +0.934%; -0.795% |
| 1d | 40 | Alcista | 15m | 230; 54.3%; 0.062%; +0.449%; -0.409% | 136; 50.0%; -0.025%; +0.521%; -0.580% | 231; 55.4%; 0.042%; +0.429%; -0.452% | 135; 48.1%; 0.009%; +0.563%; -0.513% |
| 1d | 40 | Alcista | 30m | 222; 53.2%; 0.063%; +0.558%; -0.508% | 129; 48.1%; -0.026%; +0.762%; -0.791% | 221; 52.0%; 0.056%; +0.561%; -0.501% | 130; 50.0%; -0.013%; +0.748%; -0.811% |
| 1d | 40 | Alcista | 60m | 198; 53.5%; 0.131%; +0.746%; -0.597% | 119; 52.1%; 0.031%; +1.062%; -1.109% | 202; 53.5%; 0.101%; +0.752%; -0.668% | 115; 52.2%; 0.080%; +1.061%; -1.008% |
| 1d | 40 | Bajista | 15m | 117; 50.4%; 0.009%; +0.524%; -0.543% | 211; 49.8%; 0.038%; +0.474%; -0.394% | 113; 44.2%; -0.057%; +0.523%; -0.544% | 215; 53.0%; 0.072%; +0.479%; -0.386% |
| 1d | 40 | Bajista | 30m | 110; 55.5%; 0.051%; +0.732%; -0.795% | 197; 55.3%; 0.070%; +0.576%; -0.557% | 107; 47.7%; -0.042%; +0.736%; -0.751% | 200; 59.5%; 0.120%; +0.587%; -0.567% |
| 1d | 40 | Bajista | 60m | 98; 55.1%; 0.132%; +1.091%; -1.150% | 172; 48.8%; 0.035%; +0.847%; -0.740% | 97; 52.6%; -0.049%; +0.966%; -1.256% | 173; 50.3%; 0.137%; +0.928%; -0.671% |
| 1d | 100 | Alcista | 15m | 246; 54.9%; 0.055%; +0.434%; -0.413% | 107; 49.5%; 0.012%; +0.602%; -0.589% | 263; 55.9%; 0.058%; +0.429%; -0.419% | 90; 45.6%; -0.003%; +0.670%; -0.591% |
| 1d | 100 | Alcista | 30m | 238; 51.3%; 0.036%; +0.539%; -0.501% | 100; 53.0%; 0.039%; +0.846%; -0.930% | 254; 51.2%; 0.027%; +0.552%; -0.537% | 84; 53.6%; 0.068%; +0.862%; -0.893% |
| 1d | 100 | Alcista | 60m | 217; 53.5%; 0.120%; +0.754%; -0.628% | 88; 52.3%; 0.013%; +1.099%; -1.206% | 228; 51.8%; 0.104%; +0.791%; -0.656% | 77; 57.1%; 0.042%; +1.016%; -1.256% |
| 1d | 100 | Bajista | 15m | 78; 53.8%; 0.100%; +0.607%; -0.536% | 228; 48.7%; 0.007%; +0.447%; -0.410% | 71; 54.9%; 0.073%; +0.589%; -0.613% | 235; 48.5%; 0.018%; +0.458%; -0.396% |
| 1d | 100 | Bajista | 30m | 73; 53.4%; 0.032%; +0.757%; -0.801% | 213; 54.9%; 0.033%; +0.540%; -0.586% | 66; 54.5%; 0.081%; +0.884%; -0.883% | 220; 54.5%; 0.018%; +0.507%; -0.570% |
| 1d | 100 | Bajista | 60m | 70; 57.1%; 0.014%; +0.935%; -1.348% | 182; 46.7%; 0.031%; +0.873%; -0.713% | 63; 52.4%; 0.000%; +1.124%; -1.374% | 189; 48.7%; 0.035%; +0.809%; -0.706% |
| 1d | 200 | Alcista | 15m | 268; 55.2%; 0.047%; +0.426%; -0.426% | 50; 44.0%; 0.050%; +0.663%; -0.464% | 267; 55.4%; 0.043%; +0.419%; -0.432% | 51; 43.1%; 0.075%; +0.709%; -0.437% |
| 1d | 200 | Alcista | 30m | 259; 51.7%; 0.034%; +0.545%; -0.532% | 46; 56.5%; 0.074%; +0.735%; -0.827% | 258; 51.2%; 0.020%; +0.530%; -0.531% | 47; 59.6%; 0.147%; +0.794%; -0.851% |
| 1d | 200 | Alcista | 60m | 235; 52.3%; 0.120%; +0.805%; -0.650% | 44; 59.1%; 0.159%; +0.885%; -0.941% | 234; 53.0%; 0.101%; +0.771%; -0.673% | 45; 55.6%; 0.257%; +1.055%; -0.779% |
| 1d | 200 | Bajista | 15m | 41; 61.0%; 0.048%; +0.528%; -0.802% | 236; 47.9%; 0.014%; +0.448%; -0.384% | 42; 61.9%; 0.064%; +0.506%; -0.750% | 235; 47.7%; 0.011%; +0.452%; -0.391% |
| 1d | 200 | Bajista | 30m | 39; 64.1%; 0.101%; +0.776%; -1.103% | 220; 54.1%; 0.026%; +0.511%; -0.547% | 40; 65.0%; 0.116%; +0.735%; -1.035% | 219; 53.9%; 0.023%; +0.518%; -0.556% |
| 1d | 200 | Bajista | 60m | 36; 63.9%; 0.105%; +0.981%; -1.445% | 190; 47.9%; 0.048%; +0.828%; -0.675% | 36; 61.1%; 0.111%; +0.973%; -1.245% | 190; 48.4%; 0.047%; +0.832%; -0.696% |


Igualdades y pendientes planas (suma de ambas direcciones):

| TF | SMA | Precio exactamente igual | Pendiente plana |
|---|---:|---:|---:|
| 1h | 20 | 0 | 0 |
| 1h | 40 | 0 | 0 |
| 1h | 100 | 0 | 0 |
| 1h | 200 | 0 | 0 |
| 1d | 20 | 0 | 0 |
| 1d | 40 | 0 | 0 |
| 1d | 100 | 0 | 0 |
| 1d | 200 | 0 | 0 |


## Historial completo: condiciones conjuntas

| Condición | Dirección | Horizonte | Disponibles | Seleccionadas | Evaluables | Sesiones | Favorables | Media % | Fav. media % | Desfav. media % | Δ vs Bollinger comparable % | IC 95% Δ % | Muestra |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 1h: precio encima de las cuatro SMA | Alcista | 15m | 407 | 164 | 151 | 143 | 55.0% | 0.014 | 0.396 | -0.473 | -0.016 | [-0.093, 0.061] | ≥30 señales y ≥10 sesiones |
| 1h: precio debajo de las cuatro SMA | Alcista | 15m | 407 | 66 | 60 | 60 | 51.7% | 0.015 | 0.522 | -0.545 | -0.015 | [-0.171, 0.144] | ≥30 señales y ≥10 sesiones |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 15m | 407 | 115 | 106 | 101 | 54.7% | 0.044 | 0.410 | -0.415 | 0.014 | [-0.079, 0.112] | ≥30 señales y ≥10 sesiones |
| 1h: orden SMA20 < SMA40 < SMA100 < SMA200 | Alcista | 15m | 407 | 60 | 53 | 50 | 41.5% | -0.146 | 0.471 | -0.603 | -0.176 | [-0.354, -0.003] | ≥30 señales y ≥10 sesiones |
| 1d: precio encima de las cuatro SMA | Alcista | 15m | 350 | 192 | 177 | 168 | 54.2% | 0.039 | 0.412 | -0.414 | -0.009 | [-0.069, 0.050] | ≥30 señales y ≥10 sesiones |
| 1d: precio debajo de las cuatro SMA | Alcista | 15m | 350 | 33 | 26 | 25 | 38.5% | -0.109 | 0.456 | -0.494 | -0.157 | — | Pequeña |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 15m | 350 | 155 | 143 | 138 | 53.1% | 0.005 | 0.373 | -0.418 | -0.043 | [-0.112, 0.028] | ≥30 señales y ≥10 sesiones |
| 1d: orden SMA20 < SMA40 < SMA100 < SMA200 | Alcista | 15m | 350 | 24 | 22 | 21 | 31.8% | -0.033 | 0.747 | -0.426 | -0.081 | — | Pequeña |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Alcista | 15m | 350 | 142 | 128 | 122 | 53.9% | -0.016 | 0.349 | -0.467 | -0.064 | [-0.138, 0.012] | ≥30 señales y ≥10 sesiones |
| 1h y 1d se contradicen en contexto de precio sobre/bajo las cuatro SMA | Alcista | 15m | 350 | 0 | 0 | 0 | — | — | — | — | — | — | Pequeña |
| 1h: precio encima de las cuatro SMA | Alcista | 30m | 407 | 164 | 147 | 139 | 48.3% | 0.001 | 0.517 | -0.495 | -0.030 | [-0.121, 0.063] | ≥30 señales y ≥10 sesiones |
| 1h: precio debajo de las cuatro SMA | Alcista | 30m | 407 | 66 | 57 | 57 | 50.9% | -0.080 | 0.562 | -0.802 | -0.110 | [-0.336, 0.098] | ≥30 señales y ≥10 sesiones |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 30m | 407 | 115 | 102 | 97 | 49.0% | 0.091 | 0.629 | -0.426 | 0.061 | [-0.062, 0.177] | ≥30 señales y ≥10 sesiones |
| 1h: orden SMA20 < SMA40 < SMA100 < SMA200 | Alcista | 30m | 407 | 60 | 47 | 45 | 46.8% | -0.124 | 0.692 | -0.915 | -0.154 | [-0.435, 0.141] | ≥30 señales y ≥10 sesiones |
| 1d: precio encima de las cuatro SMA | Alcista | 30m | 350 | 192 | 169 | 161 | 51.5% | 0.040 | 0.519 | -0.478 | 0.001 | [-0.081, 0.080] | ≥30 señales y ≥10 sesiones |
| 1d: precio debajo de las cuatro SMA | Alcista | 30m | 350 | 33 | 22 | 22 | 54.5% | -0.088 | 0.468 | -0.841 | -0.128 | — | Pequeña |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 30m | 350 | 155 | 135 | 131 | 50.4% | -0.016 | 0.436 | -0.490 | -0.056 | [-0.156, 0.036] | ≥30 señales y ≥10 sesiones |
| 1d: orden SMA20 < SMA40 < SMA100 < SMA200 | Alcista | 30m | 350 | 24 | 20 | 20 | 55.0% | 0.027 | 0.919 | -1.198 | -0.013 | — | Pequeña |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Alcista | 30m | 350 | 142 | 122 | 116 | 47.5% | -0.024 | 0.476 | -0.491 | -0.063 | [-0.163, 0.033] | ≥30 señales y ≥10 sesiones |
| 1h y 1d se contradicen en contexto de precio sobre/bajo las cuatro SMA | Alcista | 30m | 350 | 0 | 0 | 0 | — | — | — | — | — | — | Pequeña |
| 1h: precio encima de las cuatro SMA | Alcista | 60m | 407 | 164 | 129 | 125 | 53.5% | 0.073 | 0.671 | -0.635 | -0.020 | [-0.162, 0.112] | ≥30 señales y ≥10 sesiones |
| 1h: precio debajo de las cuatro SMA | Alcista | 60m | 407 | 66 | 51 | 51 | 54.9% | -0.123 | 0.962 | -1.445 | -0.217 | [-0.600, 0.155] | ≥30 señales y ≥10 sesiones |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 60m | 407 | 115 | 94 | 90 | 54.3% | 0.164 | 0.778 | -0.593 | 0.070 | [-0.109, 0.258] | ≥30 señales y ≥10 sesiones |
| 1h: orden SMA20 < SMA40 < SMA100 < SMA200 | Alcista | 60m | 407 | 60 | 41 | 41 | 58.5% | -0.044 | 0.909 | -1.389 | -0.137 | [-0.533, 0.283] | ≥30 señales y ≥10 sesiones |
| 1d: precio encima de las cuatro SMA | Alcista | 60m | 350 | 192 | 155 | 149 | 52.3% | 0.086 | 0.708 | -0.612 | -0.040 | [-0.153, 0.068] | ≥30 señales y ≥10 sesiones |
| 1d: precio debajo de las cuatro SMA | Alcista | 60m | 350 | 33 | 22 | 22 | 63.6% | -0.010 | 0.745 | -1.331 | -0.136 | — | Pequeña |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 60m | 350 | 155 | 121 | 117 | 49.6% | 0.018 | 0.699 | -0.675 | -0.109 | [-0.247, 0.017] | ≥30 señales y ≥10 sesiones |
| 1d: orden SMA20 < SMA40 < SMA100 < SMA200 | Alcista | 60m | 350 | 24 | 20 | 20 | 55.0% | 0.196 | 1.162 | -0.985 | 0.070 | — | Pequeña |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Alcista | 60m | 350 | 142 | 113 | 109 | 55.8% | 0.043 | 0.620 | -0.685 | -0.083 | [-0.212, 0.045] | ≥30 señales y ≥10 sesiones |
| 1h y 1d se contradicen en contexto de precio sobre/bajo las cuatro SMA | Alcista | 60m | 350 | 0 | 0 | 0 | — | — | — | — | — | — | Pequeña |
| 1h: precio encima de las cuatro SMA | Bajista | 15m | 362 | 120 | 111 | 109 | 50.5% | 0.061 | 0.507 | -0.393 | 0.030 | [-0.059, 0.121] | ≥30 señales y ≥10 sesiones |
| 1h: precio debajo de las cuatro SMA | Bajista | 15m | 362 | 75 | 67 | 67 | 53.7% | -0.021 | 0.461 | -0.601 | -0.052 | [-0.198, 0.093] | ≥30 señales y ≥10 sesiones |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 15m | 362 | 100 | 93 | 86 | 52.7% | 0.057 | 0.456 | -0.389 | 0.026 | [-0.068, 0.125] | ≥30 señales y ≥10 sesiones |
| 1h: orden SMA20 < SMA40 < SMA100 < SMA200 | Bajista | 15m | 362 | 45 | 40 | 40 | 52.5% | 0.016 | 0.511 | -0.532 | -0.015 | [-0.196, 0.167] | ≥30 señales y ≥10 sesiones |
| 1d: precio encima de las cuatro SMA | Bajista | 15m | 307 | 173 | 158 | 149 | 49.4% | 0.049 | 0.453 | -0.344 | 0.030 | [-0.028, 0.094] | ≥30 señales y ≥10 sesiones |
| 1d: precio debajo de las cuatro SMA | Bajista | 15m | 307 | 19 | 16 | 16 | 68.8% | 0.156 | 0.533 | -0.844 | 0.137 | — | Pequeña |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 15m | 307 | 164 | 150 | 141 | 54.0% | 0.086 | 0.451 | -0.342 | 0.067 | [0.003, 0.136] | ≥30 señales y ≥10 sesiones |
| 1d: orden SMA20 < SMA40 < SMA100 < SMA200 | Bajista | 15m | 307 | 15 | 13 | 13 | 69.2% | 0.128 | 0.560 | -1.123 | 0.109 | — | Pequeña |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Bajista | 15m | 307 | 107 | 97 | 95 | 49.5% | 0.052 | 0.490 | -0.385 | 0.033 | [-0.059, 0.128] | ≥30 señales y ≥10 sesiones |
| 1h y 1d se contradicen en contexto de precio sobre/bajo las cuatro SMA | Bajista | 15m | 307 | 4 | 3 | 3 | 66.7% | -0.082 | 0.105 | -0.458 | -0.101 | — | Pequeña |
| 1h: precio encima de las cuatro SMA | Bajista | 30m | 362 | 120 | 105 | 103 | 54.3% | 0.066 | 0.560 | -0.531 | -0.004 | [-0.129, 0.119] | ≥30 señales y ≥10 sesiones |
| 1h: precio debajo de las cuatro SMA | Bajista | 30m | 362 | 75 | 61 | 61 | 59.0% | 0.035 | 0.666 | -0.873 | -0.035 | [-0.257, 0.175] | ≥30 señales y ≥10 sesiones |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 30m | 362 | 100 | 87 | 83 | 56.3% | 0.014 | 0.454 | -0.553 | -0.057 | [-0.194, 0.074] | ≥30 señales y ≥10 sesiones |
| 1h: orden SMA20 < SMA40 < SMA100 < SMA200 | Bajista | 30m | 362 | 45 | 38 | 38 | 55.3% | 0.127 | 0.840 | -0.753 | 0.057 | [-0.258, 0.366] | ≥30 señales y ≥10 sesiones |
| 1d: precio encima de las cuatro SMA | Bajista | 30m | 307 | 173 | 147 | 143 | 54.4% | 0.026 | 0.500 | -0.541 | -0.011 | [-0.100, 0.079] | ≥30 señales y ≥10 sesiones |
| 1d: precio debajo de las cuatro SMA | Bajista | 30m | 307 | 19 | 16 | 16 | 68.8% | 0.055 | 0.763 | -1.504 | 0.018 | — | Pequeña |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 30m | 307 | 164 | 139 | 135 | 53.2% | 0.050 | 0.519 | -0.483 | 0.013 | [-0.079, 0.105] | ≥30 señales y ≥10 sesiones |
| 1d: orden SMA20 < SMA40 < SMA100 < SMA200 | Bajista | 30m | 307 | 15 | 12 | 12 | 58.3% | -0.085 | 0.657 | -1.124 | -0.122 | — | Pequeña |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Bajista | 30m | 307 | 107 | 92 | 90 | 54.3% | 0.012 | 0.559 | -0.640 | -0.025 | [-0.155, 0.114] | ≥30 señales y ≥10 sesiones |
| 1h y 1d se contradicen en contexto de precio sobre/bajo las cuatro SMA | Bajista | 30m | 307 | 4 | 2 | 2 | 50.0% | -0.056 | 0.323 | -0.436 | -0.093 | — | Pequeña |
| 1h: precio encima de las cuatro SMA | Bajista | 60m | 362 | 120 | 95 | 94 | 52.6% | 0.056 | 0.758 | -0.725 | -0.033 | [-0.210, 0.152] | ≥30 señales y ≥10 sesiones |
| 1h: precio debajo de las cuatro SMA | Bajista | 60m | 362 | 75 | 56 | 56 | 53.6% | 0.205 | 1.257 | -1.092 | 0.117 | [-0.212, 0.453] | ≥30 señales y ≥10 sesiones |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 60m | 362 | 100 | 76 | 75 | 46.1% | -0.018 | 0.729 | -0.656 | -0.106 | [-0.305, 0.089] | ≥30 señales y ≥10 sesiones |
| 1h: orden SMA20 < SMA40 < SMA100 < SMA200 | Bajista | 60m | 362 | 45 | 34 | 34 | 52.9% | 0.182 | 1.209 | -1.198 | 0.093 | [-0.393, 0.588] | ≥30 señales y ≥10 sesiones |
| 1d: precio encima de las cuatro SMA | Bajista | 60m | 307 | 173 | 126 | 125 | 43.7% | -0.045 | 0.749 | -0.660 | -0.102 | [-0.233, 0.026] | ≥30 señales y ≥10 sesiones |
| 1d: precio debajo de las cuatro SMA | Bajista | 60m | 307 | 19 | 15 | 15 | 60.0% | 0.018 | 0.938 | -1.362 | -0.039 | — | Pequeña |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 60m | 307 | 164 | 117 | 117 | 47.0% | 0.067 | 0.835 | -0.624 | 0.010 | [-0.126, 0.154] | ≥30 señales y ≥10 sesiones |
| 1d: orden SMA20 < SMA40 < SMA100 < SMA200 | Bajista | 60m | 307 | 15 | 12 | 12 | 58.3% | -0.232 | 0.724 | -1.571 | -0.290 | — | Pequeña |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Bajista | 60m | 307 | 107 | 84 | 83 | 47.6% | 0.010 | 0.808 | -0.715 | -0.047 | [-0.222, 0.128] | ≥30 señales y ≥10 sesiones |
| 1h y 1d se contradicen en contexto de precio sobre/bajo las cuatro SMA | Bajista | 60m | 307 | 4 | 1 | 1 | 0.0% | -1.020 | — | -1.020 | -1.077 | — | Pequeña |


## Historial completo: intervalos disponibles

| Condición | Dirección | Horizonte | n | Δ media vs Bollinger comparable % | IC 95% por sesiones % | Δ vs control horario % | IC 95% vs control % |
|---|---|---:|---:|---:|---|---:|---|
| 1h SMA 20: precio alineado con la señal | Alcista | 15m | 228 | -0.022 | [-0.074, 0.029] | -0.003 | [-0.091, 0.083] |
| 1h SMA 20: precio contrario a la señal | Alcista | 15m | 143 | 0.036 | [-0.044, 0.119] | 0.053 | [-0.054, 0.162] |
| 1h SMA 20: pendiente alineada con la señal | Alcista | 15m | 226 | -0.028 | [-0.083, 0.026] | -0.008 | [-0.090, 0.070] |
| 1h SMA 20: pendiente contraria a la señal | Alcista | 15m | 145 | 0.044 | [-0.041, 0.129] | 0.061 | [-0.050, 0.175] |
| 1h SMA 40: precio alineado con la señal | Alcista | 15m | 240 | -0.018 | [-0.069, 0.031] | 0.002 | [-0.079, 0.077] |
| 1h SMA 40: precio contrario a la señal | Alcista | 15m | 131 | 0.032 | [-0.059, 0.124] | 0.050 | [-0.067, 0.173] |
| 1h SMA 40: pendiente alineada con la señal | Alcista | 15m | 233 | 0.000 | [-0.053, 0.055] | 0.019 | [-0.062, 0.100] |
| 1h SMA 40: pendiente contraria a la señal | Alcista | 15m | 138 | -0.001 | [-0.088, 0.091] | 0.017 | [-0.101, 0.143] |
| 1h SMA 100: precio alineado con la señal | Alcista | 15m | 235 | 0.040 | [-0.012, 0.097] | 0.058 | [-0.024, 0.139] |
| 1h SMA 100: precio contrario a la señal | Alcista | 15m | 134 | -0.069 | [-0.163, 0.021] | -0.053 | [-0.174, 0.067] |
| 1h SMA 100: pendiente alineada con la señal | Alcista | 15m | 221 | 0.047 | [-0.011, 0.105] | 0.065 | [-0.020, 0.147] |
| 1h SMA 100: pendiente contraria a la señal | Alcista | 15m | 148 | -0.070 | [-0.154, 0.016] | -0.053 | [-0.164, 0.059] |
| 1h SMA 200: precio alineado con la señal | Alcista | 15m | 235 | 0.037 | [-0.014, 0.090] | 0.064 | [-0.014, 0.140] |
| 1h SMA 200: precio contrario a la señal | Alcista | 15m | 131 | -0.065 | [-0.157, 0.025] | -0.039 | [-0.161, 0.086] |
| 1h SMA 200: pendiente alineada con la señal | Alcista | 15m | 217 | 0.019 | [-0.037, 0.075] | 0.047 | [-0.030, 0.128] |
| 1h SMA 200: pendiente contraria a la señal | Alcista | 15m | 149 | -0.027 | [-0.109, 0.052] | -0.002 | [-0.118, 0.114] |
| 1d SMA 20: precio alineado con la señal | Alcista | 15m | 233 | 0.046 | [-0.006, 0.099] | 0.072 | [0.002, 0.145] |
| 1d SMA 20: precio contrario a la señal | Alcista | 15m | 135 | -0.079 | [-0.169, 0.010] | -0.052 | [-0.174, 0.064] |
| 1d SMA 20: pendiente alineada con la señal | Alcista | 15m | 227 | 0.001 | [-0.054, 0.052] | 0.029 | [-0.044, 0.103] |
| 1d SMA 20: pendiente contraria a la señal | Alcista | 15m | 141 | -0.001 | [-0.083, 0.086] | 0.023 | [-0.098, 0.143] |
| 1d SMA 40: precio alineado con la señal | Alcista | 15m | 230 | 0.033 | [-0.020, 0.086] | 0.060 | [-0.017, 0.134] |
| 1d SMA 40: precio contrario a la señal | Alcista | 15m | 136 | -0.055 | [-0.140, 0.035] | -0.029 | [-0.153, 0.096] |
| 1d SMA 40: pendiente alineada con la señal | Alcista | 15m | 231 | 0.012 | [-0.042, 0.066] | 0.040 | [-0.040, 0.117] |
| 1d SMA 40: pendiente contraria a la señal | Alcista | 15m | 135 | -0.021 | [-0.110, 0.071] | 0.005 | [-0.114, 0.134] |
| 1d SMA 100: precio alineado con la señal | Alcista | 15m | 246 | 0.013 | [-0.039, 0.064] | 0.054 | [-0.016, 0.125] |
| 1d SMA 100: precio contrario a la señal | Alcista | 15m | 107 | -0.030 | [-0.146, 0.096] | 0.007 | [-0.132, 0.156] |
| 1d SMA 100: pendiente alineada con la señal | Alcista | 15m | 263 | 0.016 | [-0.033, 0.064] | 0.056 | [-0.012, 0.126] |
| 1d SMA 100: pendiente contraria a la señal | Alcista | 15m | 90 | -0.046 | [-0.182, 0.097] | -0.009 | [-0.183, 0.162] |
| 1d SMA 200: precio alineado con la señal | Alcista | 15m | 268 | -0.000 | [-0.034, 0.034] | 0.046 | [-0.023, 0.114] |
| 1d SMA 200: precio contrario a la señal | Alcista | 15m | 50 | 0.003 | [-0.180, 0.191] | 0.040 | [-0.150, 0.245] |
| 1d SMA 200: pendiente alineada con la señal | Alcista | 15m | 267 | -0.005 | [-0.038, 0.028] | 0.041 | [-0.023, 0.109] |
| 1d SMA 200: pendiente contraria a la señal | Alcista | 15m | 51 | 0.027 | [-0.152, 0.209] | 0.065 | [-0.133, 0.265] |
| 1h: precio encima de las cuatro SMA | Alcista | 15m | 151 | -0.016 | [-0.093, 0.061] | 0.014 | [-0.083, 0.100] |
| 1h: precio debajo de las cuatro SMA | Alcista | 15m | 60 | -0.015 | [-0.171, 0.144] | 0.013 | [-0.160, 0.205] |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 15m | 106 | 0.014 | [-0.079, 0.112] | 0.042 | [-0.066, 0.152] |
| 1h: orden SMA20 < SMA40 < SMA100 < SMA200 | Alcista | 15m | 53 | -0.176 | [-0.354, -0.003] | -0.151 | [-0.343, 0.045] |
| 1d: precio encima de las cuatro SMA | Alcista | 15m | 177 | -0.009 | [-0.069, 0.050] | 0.035 | [-0.041, 0.116] |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 15m | 143 | -0.043 | [-0.112, 0.028] | 0.002 | [-0.083, 0.085] |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Alcista | 15m | 128 | -0.064 | [-0.138, 0.012] | -0.019 | [-0.108, 0.072] |
| 1h SMA 20: precio alineado con la señal | Alcista | 30m | 220 | -0.018 | [-0.091, 0.052] | 0.005 | [-0.105, 0.111] |
| 1h SMA 20: precio contrario a la señal | Alcista | 30m | 136 | 0.030 | [-0.087, 0.141] | 0.050 | [-0.102, 0.189] |
| 1h SMA 20: pendiente alineada con la señal | Alcista | 30m | 219 | -0.063 | [-0.136, 0.005] | -0.039 | [-0.145, 0.065] |
| 1h SMA 20: pendiente contraria a la señal | Alcista | 30m | 137 | 0.100 | [-0.009, 0.217] | 0.120 | [-0.025, 0.275] |
| 1h SMA 40: precio alineado con la señal | Alcista | 30m | 233 | -0.007 | [-0.076, 0.059] | 0.016 | [-0.094, 0.129] |
| 1h SMA 40: precio contrario a la señal | Alcista | 30m | 123 | 0.013 | [-0.113, 0.144] | 0.034 | [-0.119, 0.199] |
| 1h SMA 40: pendiente alineada con la señal | Alcista | 30m | 227 | -0.002 | [-0.071, 0.066] | 0.020 | [-0.083, 0.119] |
| 1h SMA 40: pendiente contraria a la señal | Alcista | 30m | 129 | 0.003 | [-0.117, 0.127] | 0.025 | [-0.136, 0.190] |
| 1h SMA 100: precio alineado con la señal | Alcista | 30m | 229 | 0.079 | [0.008, 0.149] | 0.103 | [0.004, 0.206] |
| 1h SMA 100: precio contrario a la señal | Alcista | 30m | 125 | -0.144 | [-0.271, -0.015] | -0.119 | [-0.285, 0.045] |
| 1h SMA 100: pendiente alineada con la señal | Alcista | 30m | 213 | 0.060 | [-0.016, 0.138] | 0.084 | [-0.023, 0.193] |
| 1h SMA 100: pendiente contraria a la señal | Alcista | 30m | 141 | -0.091 | [-0.206, 0.027] | -0.066 | [-0.217, 0.090] |
| 1h SMA 200: precio alineado con la señal | Alcista | 30m | 227 | 0.036 | [-0.037, 0.104] | 0.066 | [-0.028, 0.163] |
| 1h SMA 200: precio contrario a la señal | Alcista | 30m | 124 | -0.065 | [-0.190, 0.070] | -0.033 | [-0.201, 0.142] |
| 1h SMA 200: pendiente alineada con la señal | Alcista | 30m | 209 | 0.043 | [-0.036, 0.118] | 0.073 | [-0.022, 0.168] |
| 1h SMA 200: pendiente contraria a la señal | Alcista | 30m | 142 | -0.063 | [-0.175, 0.055] | -0.032 | [-0.201, 0.131] |
| 1d SMA 20: precio alineado con la señal | Alcista | 30m | 225 | 0.045 | [-0.024, 0.114] | 0.076 | [-0.019, 0.173] |
| 1d SMA 20: precio contrario a la señal | Alcista | 30m | 128 | -0.079 | [-0.199, 0.045] | -0.046 | [-0.210, 0.118] |
| 1d SMA 20: pendiente alineada con la señal | Alcista | 30m | 219 | -0.002 | [-0.079, 0.071] | 0.030 | [-0.064, 0.129] |
| 1d SMA 20: pendiente contraria a la señal | Alcista | 30m | 134 | 0.004 | [-0.114, 0.128] | 0.035 | [-0.133, 0.199] |
| 1d SMA 40: precio alineado con la señal | Alcista | 30m | 222 | 0.033 | [-0.042, 0.103] | 0.063 | [-0.027, 0.163] |
| 1d SMA 40: precio contrario a la señal | Alcista | 30m | 129 | -0.056 | [-0.176, 0.071] | -0.024 | [-0.200, 0.157] |
| 1d SMA 40: pendiente alineada con la señal | Alcista | 30m | 221 | 0.026 | [-0.048, 0.094] | 0.056 | [-0.037, 0.155] |
| 1d SMA 40: pendiente contraria a la señal | Alcista | 30m | 130 | -0.043 | [-0.163, 0.082] | -0.013 | [-0.180, 0.159] |
| 1d SMA 100: precio alineado con la señal | Alcista | 30m | 238 | -0.001 | [-0.070, 0.062] | 0.037 | [-0.048, 0.124] |
| 1d SMA 100: precio contrario a la señal | Alcista | 30m | 100 | 0.002 | [-0.151, 0.167] | 0.040 | [-0.175, 0.265] |
| 1d SMA 100: pendiente alineada con la señal | Alcista | 30m | 254 | -0.010 | [-0.075, 0.048] | 0.028 | [-0.066, 0.119] |
| 1d SMA 100: pendiente contraria a la señal | Alcista | 30m | 84 | 0.031 | [-0.145, 0.222] | 0.068 | [-0.162, 0.312] |
| 1d SMA 200: precio alineado con la señal | Alcista | 30m | 259 | -0.006 | [-0.053, 0.037] | 0.035 | [-0.047, 0.129] |
| 1d SMA 200: precio contrario a la señal | Alcista | 30m | 46 | 0.034 | [-0.215, 0.300] | 0.070 | [-0.197, 0.355] |
| 1d SMA 200: pendiente alineada con la señal | Alcista | 30m | 258 | -0.020 | [-0.069, 0.027] | 0.021 | [-0.059, 0.110] |
| 1d SMA 200: pendiente contraria a la señal | Alcista | 30m | 47 | 0.107 | [-0.147, 0.386] | 0.144 | [-0.147, 0.434] |
| 1h: precio encima de las cuatro SMA | Alcista | 30m | 147 | -0.030 | [-0.121, 0.063] | 0.003 | [-0.098, 0.107] |
| 1h: precio debajo de las cuatro SMA | Alcista | 30m | 57 | -0.110 | [-0.336, 0.098] | -0.078 | [-0.311, 0.155] |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 30m | 102 | 0.061 | [-0.062, 0.177] | 0.093 | [-0.044, 0.235] |
| 1h: orden SMA20 < SMA40 < SMA100 < SMA200 | Alcista | 30m | 47 | -0.154 | [-0.435, 0.141] | -0.119 | [-0.418, 0.166] |
| 1d: precio encima de las cuatro SMA | Alcista | 30m | 169 | 0.001 | [-0.081, 0.080] | 0.041 | [-0.058, 0.144] |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 30m | 135 | -0.056 | [-0.156, 0.036] | -0.015 | [-0.113, 0.082] |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Alcista | 30m | 122 | -0.063 | [-0.163, 0.033] | -0.022 | [-0.125, 0.091] |
| 1h SMA 20: precio alineado con la señal | Alcista | 60m | 199 | -0.004 | [-0.097, 0.096] | 0.095 | [-0.041, 0.229] |
| 1h SMA 20: precio contrario a la señal | Alcista | 60m | 123 | 0.007 | [-0.155, 0.153] | 0.106 | [-0.114, 0.317] |
| 1h SMA 20: pendiente alineada con la señal | Alcista | 60m | 196 | -0.042 | [-0.143, 0.061] | 0.058 | [-0.080, 0.201] |
| 1h SMA 20: pendiente contraria a la señal | Alcista | 60m | 126 | 0.065 | [-0.094, 0.223] | 0.164 | [-0.066, 0.373] |
| 1h SMA 40: precio alineado con la señal | Alcista | 60m | 211 | 0.032 | [-0.058, 0.129] | 0.131 | [-0.011, 0.262] |
| 1h SMA 40: precio contrario a la señal | Alcista | 60m | 111 | -0.060 | [-0.251, 0.109] | 0.039 | [-0.206, 0.276] |
| 1h SMA 40: pendiente alineada con la señal | Alcista | 60m | 206 | 0.025 | [-0.070, 0.127] | 0.124 | [-0.019, 0.262] |
| 1h SMA 40: pendiente contraria a la señal | Alcista | 60m | 116 | -0.045 | [-0.220, 0.126] | 0.055 | [-0.172, 0.291] |
| 1h SMA 100: precio alineado con la señal | Alcista | 60m | 206 | 0.099 | [-0.006, 0.203] | 0.196 | [0.063, 0.340] |
| 1h SMA 100: precio contrario a la señal | Alcista | 60m | 114 | -0.179 | [-0.360, 0.011] | -0.082 | [-0.334, 0.162] |
| 1h SMA 100: pendiente alineada con la señal | Alcista | 60m | 189 | 0.075 | [-0.036, 0.186] | 0.171 | [0.028, 0.319] |
| 1h SMA 100: pendiente contraria a la señal | Alcista | 60m | 131 | -0.109 | [-0.267, 0.057] | -0.010 | [-0.237, 0.208] |
| 1h SMA 200: precio alineado con la señal | Alcista | 60m | 203 | 0.042 | [-0.062, 0.146] | 0.143 | [0.008, 0.277] |
| 1h SMA 200: precio contrario a la señal | Alcista | 60m | 114 | -0.074 | [-0.260, 0.113] | 0.030 | [-0.238, 0.279] |
| 1h SMA 200: pendiente alineada con la señal | Alcista | 60m | 187 | 0.037 | [-0.076, 0.151] | 0.140 | [-0.000, 0.270] |
| 1h SMA 200: pendiente contraria a la señal | Alcista | 60m | 130 | -0.053 | [-0.218, 0.111] | 0.049 | [-0.171, 0.276] |
| 1d SMA 20: precio alineado con la señal | Alcista | 60m | 203 | 0.066 | [-0.040, 0.168] | 0.169 | [0.038, 0.295] |
| 1d SMA 20: precio contrario a la señal | Alcista | 60m | 116 | -0.115 | [-0.286, 0.072] | -0.010 | [-0.266, 0.219] |
| 1d SMA 20: pendiente alineada con la señal | Alcista | 60m | 196 | -0.001 | [-0.105, 0.102] | 0.102 | [-0.043, 0.234] |
| 1d SMA 20: pendiente contraria a la señal | Alcista | 60m | 123 | 0.002 | [-0.160, 0.168] | 0.107 | [-0.135, 0.345] |
| 1d SMA 40: precio alineado con la señal | Alcista | 60m | 198 | 0.037 | [-0.073, 0.149] | 0.139 | [0.018, 0.268] |
| 1d SMA 40: precio contrario a la señal | Alcista | 60m | 119 | -0.062 | [-0.253, 0.121] | 0.042 | [-0.218, 0.295] |
| 1d SMA 40: pendiente alineada con la señal | Alcista | 60m | 202 | 0.008 | [-0.099, 0.113] | 0.111 | [-0.021, 0.248] |
| 1d SMA 40: pendiente contraria a la señal | Alcista | 60m | 115 | -0.013 | [-0.201, 0.175] | 0.088 | [-0.168, 0.343] |
| 1d SMA 100: precio alineado con la señal | Alcista | 60m | 217 | 0.031 | [-0.066, 0.127] | 0.129 | [0.006, 0.257] |
| 1d SMA 100: precio contrario a la señal | Alcista | 60m | 88 | -0.076 | [-0.312, 0.169] | 0.022 | [-0.298, 0.339] |
| 1d SMA 100: pendiente alineada con la señal | Alcista | 60m | 228 | 0.016 | [-0.075, 0.101] | 0.115 | [-0.011, 0.247] |
| 1d SMA 100: pendiente contraria a la señal | Alcista | 60m | 77 | -0.046 | [-0.292, 0.224] | 0.050 | [-0.277, 0.376] |
| 1d SMA 200: precio alineado con la señal | Alcista | 60m | 235 | -0.006 | [-0.065, 0.057] | 0.130 | [0.008, 0.268] |
| 1d SMA 200: precio contrario a la señal | Alcista | 60m | 44 | 0.033 | [-0.296, 0.341] | 0.166 | [-0.201, 0.494] |
| 1d SMA 200: pendiente alineada con la señal | Alcista | 60m | 234 | -0.025 | [-0.092, 0.035] | 0.111 | [-0.012, 0.242] |
| 1d SMA 200: pendiente contraria a la señal | Alcista | 60m | 45 | 0.131 | [-0.188, 0.452] | 0.265 | [-0.096, 0.598] |
| 1h: precio encima de las cuatro SMA | Alcista | 60m | 129 | -0.020 | [-0.162, 0.112] | 0.083 | [-0.066, 0.229] |
| 1h: precio debajo de las cuatro SMA | Alcista | 60m | 51 | -0.217 | [-0.600, 0.155] | -0.111 | [-0.543, 0.318] |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 60m | 94 | 0.070 | [-0.109, 0.258] | 0.175 | [-0.014, 0.378] |
| 1h: orden SMA20 < SMA40 < SMA100 < SMA200 | Alcista | 60m | 41 | -0.137 | [-0.533, 0.283] | -0.030 | [-0.472, 0.417] |
| 1d: precio encima de las cuatro SMA | Alcista | 60m | 155 | -0.040 | [-0.153, 0.068] | 0.095 | [-0.047, 0.238] |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 60m | 121 | -0.109 | [-0.247, 0.017] | 0.029 | [-0.131, 0.194] |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Alcista | 60m | 113 | -0.083 | [-0.212, 0.045] | 0.052 | [-0.113, 0.218] |
| 1h SMA 20: precio alineado con la señal | Bajista | 15m | 158 | 0.005 | [-0.069, 0.077] | 0.037 | [-0.075, 0.141] |
| 1h SMA 20: precio contrario a la señal | Bajista | 15m | 180 | -0.004 | [-0.066, 0.062] | 0.025 | [-0.062, 0.111] |
| 1h SMA 20: pendiente alineada con la señal | Bajista | 15m | 157 | -0.001 | [-0.069, 0.071] | 0.031 | [-0.077, 0.127] |
| 1h SMA 20: pendiente contraria a la señal | Bajista | 15m | 181 | 0.001 | [-0.061, 0.061] | 0.030 | [-0.058, 0.116] |
| 1h SMA 40: precio alineado con la señal | Bajista | 15m | 153 | -0.010 | [-0.082, 0.062] | 0.022 | [-0.089, 0.123] |
| 1h SMA 40: precio contrario a la señal | Bajista | 15m | 185 | 0.008 | [-0.052, 0.070] | 0.037 | [-0.045, 0.122] |
| 1h SMA 40: pendiente alineada con la señal | Bajista | 15m | 145 | -0.007 | [-0.086, 0.069] | 0.024 | [-0.086, 0.134] |
| 1h SMA 40: pendiente contraria a la señal | Bajista | 15m | 193 | 0.005 | [-0.050, 0.064] | 0.035 | [-0.048, 0.115] |
| 1h SMA 100: precio alineado con la señal | Bajista | 15m | 140 | -0.044 | [-0.128, 0.036] | -0.010 | [-0.120, 0.095] |
| 1h SMA 100: precio contrario a la señal | Bajista | 15m | 196 | 0.031 | [-0.026, 0.091] | 0.064 | [-0.022, 0.154] |
| 1h SMA 100: pendiente alineada con la señal | Bajista | 15m | 141 | -0.026 | [-0.103, 0.051] | 0.007 | [-0.089, 0.101] |
| 1h SMA 100: pendiente contraria a la señal | Bajista | 15m | 195 | 0.019 | [-0.037, 0.076] | 0.052 | [-0.048, 0.143] |
| 1h SMA 200: precio alineado con la señal | Bajista | 15m | 124 | -0.065 | [-0.155, 0.021] | -0.029 | [-0.152, 0.092] |
| 1h SMA 200: precio contrario a la señal | Bajista | 15m | 208 | 0.039 | [-0.013, 0.095] | 0.074 | [-0.002, 0.151] |
| 1h SMA 200: pendiente alineada con la señal | Bajista | 15m | 123 | 0.000 | [-0.092, 0.086] | 0.038 | [-0.090, 0.161] |
| 1h SMA 200: pendiente contraria a la señal | Bajista | 15m | 209 | -0.000 | [-0.052, 0.055] | 0.034 | [-0.042, 0.112] |
| 1d SMA 20: precio alineado con la señal | Bajista | 15m | 131 | -0.042 | [-0.129, 0.045] | -0.008 | [-0.119, 0.106] |
| 1d SMA 20: precio contrario a la señal | Bajista | 15m | 204 | 0.027 | [-0.028, 0.083] | 0.060 | [-0.024, 0.144] |
| 1d SMA 20: pendiente alineada con la señal | Bajista | 15m | 123 | -0.008 | [-0.094, 0.080] | 0.026 | [-0.085, 0.135] |
| 1d SMA 20: pendiente contraria a la señal | Bajista | 15m | 211 | 0.004 | [-0.046, 0.055] | 0.037 | [-0.044, 0.120] |
| 1d SMA 40: precio alineado con la señal | Bajista | 15m | 117 | -0.018 | [-0.120, 0.073] | 0.014 | [-0.105, 0.134] |
| 1d SMA 40: precio contrario a la señal | Bajista | 15m | 211 | 0.010 | [-0.040, 0.065] | 0.043 | [-0.042, 0.124] |
| 1d SMA 40: pendiente alineada con la señal | Bajista | 15m | 113 | -0.085 | [-0.186, 0.012] | -0.052 | [-0.177, 0.065] |
| 1d SMA 40: pendiente contraria a la señal | Bajista | 15m | 215 | 0.045 | [-0.006, 0.099] | 0.077 | [-0.001, 0.152] |
| 1d SMA 100: precio alineado con la señal | Bajista | 15m | 78 | 0.069 | [-0.059, 0.197] | 0.106 | [-0.043, 0.256] |
| 1d SMA 100: precio contrario a la señal | Bajista | 15m | 228 | -0.024 | [-0.067, 0.021] | 0.011 | [-0.065, 0.083] |
| 1d SMA 100: pendiente alineada con la señal | Bajista | 15m | 71 | 0.042 | [-0.104, 0.188] | 0.084 | [-0.086, 0.247] |
| 1d SMA 100: pendiente contraria a la señal | Bajista | 15m | 235 | -0.013 | [-0.055, 0.031] | 0.021 | [-0.055, 0.096] |
| 1d SMA 200: precio alineado con la señal | Bajista | 15m | 41 | 0.029 | [-0.182, 0.233] | 0.058 | [-0.196, 0.284] |
| 1d SMA 200: precio contrario a la señal | Bajista | 15m | 236 | -0.005 | [-0.040, 0.032] | 0.016 | [-0.055, 0.089] |
| 1d SMA 200: pendiente alineada con la señal | Bajista | 15m | 42 | 0.045 | [-0.152, 0.239] | 0.075 | [-0.154, 0.292] |
| 1d SMA 200: pendiente contraria a la señal | Bajista | 15m | 235 | -0.008 | [-0.043, 0.027] | 0.013 | [-0.059, 0.087] |
| 1h: precio encima de las cuatro SMA | Bajista | 15m | 111 | 0.030 | [-0.059, 0.121] | 0.065 | [-0.042, 0.173] |
| 1h: precio debajo de las cuatro SMA | Bajista | 15m | 67 | -0.052 | [-0.198, 0.093] | -0.011 | [-0.183, 0.152] |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 15m | 93 | 0.026 | [-0.068, 0.125] | 0.061 | [-0.053, 0.177] |
| 1h: orden SMA20 < SMA40 < SMA100 < SMA200 | Bajista | 15m | 40 | -0.015 | [-0.196, 0.167] | 0.020 | [-0.182, 0.221] |
| 1d: precio encima de las cuatro SMA | Bajista | 15m | 158 | 0.030 | [-0.028, 0.094] | 0.052 | [-0.029, 0.137] |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 15m | 150 | 0.067 | [0.003, 0.136] | 0.091 | [0.005, 0.175] |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Bajista | 15m | 97 | 0.033 | [-0.059, 0.128] | 0.055 | [-0.059, 0.167] |
| 1h SMA 20: precio alineado con la señal | Bajista | 30m | 147 | 0.009 | [-0.093, 0.114] | 0.071 | [-0.082, 0.219] |
| 1h SMA 20: precio contrario a la señal | Bajista | 30m | 170 | -0.008 | [-0.095, 0.081] | 0.052 | [-0.060, 0.162] |
| 1h SMA 20: pendiente alineada con la señal | Bajista | 30m | 148 | 0.013 | [-0.086, 0.118] | 0.073 | [-0.074, 0.221] |
| 1h SMA 20: pendiente contraria a la señal | Bajista | 30m | 169 | -0.011 | [-0.101, 0.075] | 0.050 | [-0.074, 0.168] |
| 1h SMA 40: precio alineado con la señal | Bajista | 30m | 143 | 0.005 | [-0.102, 0.107] | 0.065 | [-0.101, 0.221] |
| 1h SMA 40: precio contrario a la señal | Bajista | 30m | 174 | -0.004 | [-0.085, 0.086] | 0.057 | [-0.053, 0.172] |
| 1h SMA 40: pendiente alineada con la señal | Bajista | 30m | 136 | 0.007 | [-0.103, 0.118] | 0.067 | [-0.089, 0.225] |
| 1h SMA 40: pendiente contraria a la señal | Bajista | 30m | 181 | -0.005 | [-0.085, 0.077] | 0.056 | [-0.063, 0.168] |
| 1h SMA 100: precio alineado con la señal | Bajista | 30m | 129 | 0.013 | [-0.104, 0.135] | 0.076 | [-0.083, 0.236] |
| 1h SMA 100: precio contrario a la señal | Bajista | 30m | 186 | -0.009 | [-0.094, 0.071] | 0.058 | [-0.062, 0.177] |
| 1h SMA 100: pendiente alineada con la señal | Bajista | 30m | 132 | -0.032 | [-0.150, 0.082] | 0.030 | [-0.116, 0.180] |
| 1h SMA 100: pendiente contraria a la señal | Bajista | 30m | 183 | 0.023 | [-0.059, 0.109] | 0.091 | [-0.026, 0.203] |
| 1h SMA 200: precio alineado con la señal | Bajista | 30m | 116 | -0.025 | [-0.157, 0.107] | 0.042 | [-0.130, 0.223] |
| 1h SMA 200: precio contrario a la señal | Bajista | 30m | 195 | 0.015 | [-0.062, 0.094] | 0.086 | [-0.031, 0.202] |
| 1h SMA 200: pendiente alineada con la señal | Bajista | 30m | 114 | 0.001 | [-0.135, 0.135] | 0.069 | [-0.119, 0.251] |
| 1h SMA 200: pendiente contraria a la señal | Bajista | 30m | 197 | -0.001 | [-0.076, 0.077] | 0.070 | [-0.037, 0.173] |
| 1d SMA 20: precio alineado con la señal | Bajista | 30m | 122 | -0.044 | [-0.164, 0.084] | 0.023 | [-0.146, 0.190] |
| 1d SMA 20: precio contrario a la señal | Bajista | 30m | 192 | 0.028 | [-0.054, 0.106] | 0.097 | [-0.018, 0.206] |
| 1d SMA 20: pendiente alineada con la señal | Bajista | 30m | 116 | 0.006 | [-0.123, 0.145] | 0.072 | [-0.110, 0.260] |
| 1d SMA 20: pendiente contraria a la señal | Bajista | 30m | 197 | -0.004 | [-0.084, 0.075] | 0.065 | [-0.041, 0.172] |
| 1d SMA 40: precio alineado con la señal | Bajista | 30m | 110 | -0.012 | [-0.149, 0.127] | 0.048 | [-0.144, 0.236] |
| 1d SMA 40: precio contrario a la señal | Bajista | 30m | 197 | 0.007 | [-0.069, 0.085] | 0.071 | [-0.033, 0.184] |
| 1d SMA 40: pendiente alineada con la señal | Bajista | 30m | 107 | -0.105 | [-0.253, 0.024] | -0.046 | [-0.241, 0.144] |
| 1d SMA 40: pendiente contraria a la señal | Bajista | 30m | 200 | 0.056 | [-0.014, 0.138] | 0.121 | [0.012, 0.233] |
| 1d SMA 100: precio alineado con la señal | Bajista | 30m | 73 | -0.001 | [-0.198, 0.183] | 0.028 | [-0.203, 0.254] |
| 1d SMA 100: precio contrario a la señal | Bajista | 30m | 213 | 0.000 | [-0.062, 0.064] | 0.033 | [-0.071, 0.132] |
| 1d SMA 100: pendiente alineada con la señal | Bajista | 30m | 66 | 0.049 | [-0.173, 0.258] | 0.082 | [-0.183, 0.329] |
| 1d SMA 100: pendiente contraria a la señal | Bajista | 30m | 220 | -0.015 | [-0.077, 0.051] | 0.017 | [-0.084, 0.116] |
| 1d SMA 200: precio alineado con la señal | Bajista | 30m | 39 | 0.064 | [-0.262, 0.374] | 0.104 | [-0.262, 0.445] |
| 1d SMA 200: precio contrario a la señal | Bajista | 30m | 220 | -0.011 | [-0.065, 0.044] | 0.025 | [-0.076, 0.128] |
| 1d SMA 200: pendiente alineada con la señal | Bajista | 30m | 40 | 0.079 | [-0.230, 0.369] | 0.121 | [-0.222, 0.427] |
| 1d SMA 200: pendiente contraria a la señal | Bajista | 30m | 219 | -0.014 | [-0.069, 0.042] | 0.021 | [-0.079, 0.119] |
| 1h: precio encima de las cuatro SMA | Bajista | 30m | 105 | -0.004 | [-0.129, 0.119] | 0.067 | [-0.069, 0.200] |
| 1h: precio debajo de las cuatro SMA | Bajista | 30m | 61 | -0.035 | [-0.257, 0.175] | 0.036 | [-0.228, 0.281] |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 30m | 87 | -0.057 | [-0.194, 0.074] | 0.015 | [-0.116, 0.152] |
| 1h: orden SMA20 < SMA40 < SMA100 < SMA200 | Bajista | 30m | 38 | 0.057 | [-0.258, 0.366] | 0.123 | [-0.232, 0.469] |
| 1d: precio encima de las cuatro SMA | Bajista | 30m | 147 | -0.011 | [-0.100, 0.079] | 0.027 | [-0.088, 0.142] |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 30m | 139 | 0.013 | [-0.079, 0.105] | 0.051 | [-0.065, 0.166] |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Bajista | 30m | 92 | -0.025 | [-0.155, 0.114] | 0.013 | [-0.163, 0.187] |
| 1h SMA 20: precio alineado con la señal | Bajista | 60m | 125 | 0.028 | [-0.134, 0.191] | 0.091 | [-0.151, 0.312] |
| 1h SMA 20: precio contrario a la señal | Bajista | 60m | 155 | -0.023 | [-0.153, 0.112] | 0.044 | [-0.114, 0.216] |
| 1h SMA 20: pendiente alineada con la señal | Bajista | 60m | 129 | 0.036 | [-0.123, 0.205] | 0.099 | [-0.131, 0.343] |
| 1h SMA 20: pendiente contraria a la señal | Bajista | 60m | 151 | -0.031 | [-0.169, 0.103] | 0.036 | [-0.129, 0.202] |
| 1h SMA 40: precio alineado con la señal | Bajista | 60m | 126 | 0.053 | [-0.107, 0.214] | 0.115 | [-0.126, 0.358] |
| 1h SMA 40: precio contrario a la señal | Bajista | 60m | 154 | -0.044 | [-0.173, 0.089] | 0.024 | [-0.147, 0.194] |
| 1h SMA 40: pendiente alineada con la señal | Bajista | 60m | 121 | 0.131 | [-0.037, 0.306] | 0.195 | [-0.069, 0.437] |
| 1h SMA 40: pendiente contraria a la señal | Bajista | 60m | 159 | -0.100 | [-0.229, 0.028] | -0.034 | [-0.200, 0.130] |
| 1h SMA 100: precio alineado con la señal | Bajista | 60m | 113 | 0.112 | [-0.063, 0.295] | 0.185 | [-0.056, 0.434] |
| 1h SMA 100: precio contrario a la señal | Bajista | 60m | 165 | -0.077 | [-0.203, 0.045] | 0.001 | [-0.158, 0.173] |
| 1h SMA 100: pendiente alineada con la señal | Bajista | 60m | 117 | 0.021 | [-0.151, 0.191] | 0.094 | [-0.128, 0.322] |
| 1h SMA 100: pendiente contraria a la señal | Bajista | 60m | 161 | -0.015 | [-0.136, 0.107] | 0.062 | [-0.110, 0.245] |
| 1h SMA 200: precio alineado con la señal | Bajista | 60m | 105 | 0.039 | [-0.147, 0.234] | 0.115 | [-0.154, 0.373] |
| 1h SMA 200: precio contrario a la señal | Bajista | 60m | 169 | -0.024 | [-0.148, 0.094] | 0.060 | [-0.094, 0.224] |
| 1h SMA 200: pendiente alineada con la señal | Bajista | 60m | 105 | 0.031 | [-0.151, 0.227] | 0.108 | [-0.148, 0.366] |
| 1h SMA 200: pendiente contraria a la señal | Bajista | 60m | 169 | -0.019 | [-0.141, 0.094] | 0.064 | [-0.099, 0.236] |
| 1d SMA 20: precio alineado con la señal | Bajista | 60m | 110 | 0.006 | [-0.175, 0.192] | 0.085 | [-0.165, 0.333] |
| 1d SMA 20: precio contrario a la señal | Bajista | 60m | 167 | -0.004 | [-0.121, 0.119] | 0.080 | [-0.088, 0.254] |
| 1d SMA 20: pendiente alineada con la señal | Bajista | 60m | 105 | 0.053 | [-0.130, 0.251] | 0.130 | [-0.127, 0.386] |
| 1d SMA 20: pendiente contraria a la señal | Bajista | 60m | 171 | -0.033 | [-0.155, 0.080] | 0.048 | [-0.116, 0.216] |
| 1d SMA 40: precio alineado con la señal | Bajista | 60m | 98 | 0.062 | [-0.134, 0.271] | 0.119 | [-0.159, 0.379] |
| 1d SMA 40: precio contrario a la señal | Bajista | 60m | 172 | -0.035 | [-0.152, 0.082] | 0.030 | [-0.122, 0.179] |
| 1d SMA 40: pendiente alineada con la señal | Bajista | 60m | 97 | -0.119 | [-0.328, 0.084] | -0.061 | [-0.336, 0.191] |
| 1d SMA 40: pendiente contraria a la señal | Bajista | 60m | 173 | 0.067 | [-0.049, 0.188] | 0.131 | [-0.026, 0.292] |
| 1d SMA 100: precio alineado con la señal | Bajista | 60m | 70 | -0.012 | [-0.273, 0.227] | -0.003 | [-0.347, 0.304] |
| 1d SMA 100: precio contrario a la señal | Bajista | 60m | 182 | 0.005 | [-0.085, 0.103] | 0.027 | [-0.126, 0.179] |
| 1d SMA 100: pendiente alineada con la señal | Bajista | 60m | 63 | -0.027 | [-0.320, 0.257] | -0.017 | [-0.381, 0.330] |
| 1d SMA 100: pendiente contraria a la señal | Bajista | 60m | 189 | 0.009 | [-0.085, 0.106] | 0.031 | [-0.122, 0.185] |
| 1d SMA 200: precio alineado con la señal | Bajista | 60m | 36 | 0.047 | [-0.396, 0.451] | 0.090 | [-0.398, 0.533] |
| 1d SMA 200: precio contrario a la señal | Bajista | 60m | 190 | -0.009 | [-0.084, 0.077] | 0.043 | [-0.095, 0.175] |
| 1d SMA 200: pendiente alineada con la señal | Bajista | 60m | 36 | 0.053 | [-0.359, 0.421] | 0.100 | [-0.346, 0.525] |
| 1d SMA 200: pendiente contraria a la señal | Bajista | 60m | 190 | -0.010 | [-0.080, 0.071] | 0.041 | [-0.105, 0.190] |
| 1h: precio encima de las cuatro SMA | Bajista | 60m | 95 | -0.033 | [-0.210, 0.152] | 0.053 | [-0.131, 0.240] |
| 1h: precio debajo de las cuatro SMA | Bajista | 60m | 56 | 0.117 | [-0.212, 0.453] | 0.195 | [-0.179, 0.597] |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 60m | 76 | -0.106 | [-0.305, 0.089] | -0.020 | [-0.216, 0.175] |
| 1h: orden SMA20 < SMA40 < SMA100 < SMA200 | Bajista | 60m | 34 | 0.093 | [-0.393, 0.588] | 0.170 | [-0.350, 0.674] |
| 1d: precio encima de las cuatro SMA | Bajista | 60m | 126 | -0.102 | [-0.233, 0.026] | -0.048 | [-0.214, 0.116] |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 60m | 117 | 0.010 | [-0.126, 0.154] | 0.064 | [-0.106, 0.247] |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Bajista | 60m | 84 | -0.047 | [-0.222, 0.128] | 0.009 | [-0.193, 0.205] |


## Primer 70%: SMA individuales

Cada celda muestra: resultados evaluables; frecuencia favorable; movimiento medio firmado; movimiento favorable medio; movimiento desfavorable medio.

| TF | SMA | Dirección | Horizonte | Precio alineado n; fav.; media; fav. media; desfav. media | Precio contrario | Pendiente alineada | Pendiente contraria |
|---|---:|---|---:|---|---|---|---|
| 1h | 20 | Alcista | 15m | 154; 53.2%; 0.006%; +0.481%; -0.557% | 108; 51.9%; 0.094%; +0.592%; -0.469% | 155; 52.9%; 0.000%; +0.450%; -0.519% | 107; 52.3%; 0.104%; +0.638%; -0.522% |
| 1h | 20 | Alcista | 30m | 147; 49.7%; 0.015%; +0.700%; -0.688% | 101; 53.5%; 0.078%; +0.728%; -0.683% | 148; 46.6%; -0.050%; +0.640%; -0.688% | 100; 58.0%; 0.175%; +0.797%; -0.683% |
| 1h | 20 | Alcista | 60m | 128; 53.1%; 0.113%; +0.878%; -0.781% | 90; 58.9%; 0.168%; +1.023%; -1.116% | 126; 54.0%; 0.065%; +0.806%; -0.833% | 92; 57.6%; 0.232%; +1.115%; -1.019% |
| 1h | 20 | Bajista | 15m | 113; 51.3%; 0.020%; +0.551%; -0.560% | 119; 50.4%; 0.050%; +0.522%; -0.437% | 113; 54.0%; 0.040%; +0.525%; -0.550% | 119; 47.9%; 0.031%; +0.548%; -0.451% |
| 1h | 20 | Bajista | 30m | 105; 59.0%; 0.061%; +0.701%; -0.861% | 113; 54.9%; 0.123%; +0.717%; -0.611% | 106; 57.5%; 0.077%; +0.752%; -0.837% | 112; 56.3%; 0.108%; +0.668%; -0.623% |
| 1h | 20 | Bajista | 60m | 91; 57.1%; 0.125%; +1.100%; -1.207% | 104; 48.1%; 0.096%; +1.061%; -0.828% | 94; 55.3%; 0.155%; +1.196%; -1.190% | 101; 49.5%; 0.067%; +0.960%; -0.826% |
| 1h | 40 | Alcista | 15m | 164; 54.9%; 0.028%; +0.460%; -0.526% | 98; 49.0%; 0.068%; +0.650%; -0.512% | 162; 53.1%; 0.058%; +0.497%; -0.457% | 100; 52.0%; 0.018%; +0.574%; -0.623% |
| 1h | 40 | Alcista | 30m | 157; 51.6%; 0.035%; +0.685%; -0.685% | 91; 50.5%; 0.050%; +0.759%; -0.689% | 156; 50.0%; 0.041%; +0.681%; -0.616% | 92; 53.3%; 0.040%; +0.760%; -0.818% |
| 1h | 40 | Alcista | 60m | 138; 56.5%; 0.191%; +0.902%; -0.759% | 80; 53.8%; 0.041%; +1.014%; -1.152% | 139; 55.4%; 0.182%; +0.903%; -0.762% | 79; 55.7%; 0.053%; +1.009%; -1.148% |
| 1h | 40 | Bajista | 15m | 105; 53.3%; 0.046%; +0.533%; -0.532% | 127; 48.8%; 0.027%; +0.539%; -0.469% | 100; 54.0%; 0.052%; +0.553%; -0.535% | 132; 48.5%; 0.023%; +0.522%; -0.468% |
| 1h | 40 | Bajista | 30m | 98; 59.2%; 0.106%; +0.742%; -0.815% | 120; 55.0%; 0.083%; +0.680%; -0.660% | 94; 56.4%; 0.106%; +0.790%; -0.797% | 124; 57.3%; 0.084%; +0.649%; -0.674% |
| 1h | 40 | Bajista | 60m | 89; 53.9%; 0.209%; +1.261%; -1.075% | 106; 50.9%; 0.026%; +0.920%; -0.921% | 86; 54.7%; 0.260%; +1.325%; -1.078% | 109; 50.5%; -0.010%; +0.871%; -0.925% |
| 1h | 100 | Alcista | 15m | 163; 54.6%; 0.085%; +0.518%; -0.468% | 97; 49.5%; -0.032%; +0.535%; -0.599% | 153; 54.2%; 0.086%; +0.528%; -0.473% | 107; 50.5%; -0.023%; +0.517%; -0.583% |
| 1h | 100 | Alcista | 30m | 157; 54.1%; 0.126%; +0.701%; -0.569% | 89; 47.2%; -0.101%; +0.733%; -0.883% | 146; 54.1%; 0.096%; +0.662%; -0.590% | 100; 48.0%; -0.031%; +0.794%; -0.825% |
| 1h | 100 | Alcista | 60m | 137; 56.2%; 0.242%; +0.933%; -0.690% | 79; 53.2%; -0.057%; +0.980%; -1.235% | 124; 55.6%; 0.233%; +0.940%; -0.691% | 92; 54.3%; -0.003%; +0.963%; -1.181% |
| 1h | 100 | Bajista | 15m | 97; 51.5%; 0.023%; +0.538%; -0.536% | 133; 51.1%; 0.052%; +0.535%; -0.468% | 100; 49.0%; 0.019%; +0.508%; -0.470% | 130; 53.1%; 0.056%; +0.556%; -0.519% |
| 1h | 100 | Bajista | 30m | 90; 60.0%; 0.125%; +0.760%; -0.828% | 126; 55.6%; 0.083%; +0.670%; -0.663% | 94; 56.4%; 0.047%; +0.714%; -0.815% | 122; 58.2%; 0.142%; +0.706%; -0.656% |
| 1h | 100 | Bajista | 60m | 80; 57.5%; 0.281%; +1.249%; -1.127% | 113; 49.6%; 0.016%; +0.942%; -0.895% | 84; 53.6%; 0.126%; +1.128%; -1.117% | 109; 52.3%; 0.126%; +1.043%; -0.880% |
| 1h | 200 | Alcista | 15m | 160; 55.0%; 0.100%; +0.516%; -0.425% | 97; 50.5%; -0.021%; +0.538%; -0.603% | 142; 54.2%; 0.085%; +0.502%; -0.430% | 115; 52.2%; 0.018%; +0.551%; -0.574% |
| 1h | 200 | Alcista | 30m | 152; 54.6%; 0.094%; +0.649%; -0.590% | 91; 47.3%; -0.015%; +0.833%; -0.808% | 134; 56.0%; 0.116%; +0.619%; -0.542% | 109; 46.8%; -0.023%; +0.849%; -0.818% |
| 1h | 200 | Alcista | 60m | 131; 55.7%; 0.189%; +0.833%; -0.667% | 82; 54.9%; 0.065%; +1.128%; -1.228% | 114; 57.9%; 0.215%; +0.839%; -0.686% | 99; 52.5%; 0.057%; +1.082%; -1.100% |
| 1h | 200 | Bajista | 15m | 90; 51.1%; -0.002%; +0.530%; -0.585% | 136; 51.5%; 0.074%; +0.553%; -0.441% | 88; 50.0%; 0.044%; +0.649%; -0.603% | 138; 52.2%; 0.043%; +0.479%; -0.432% |
| 1h | 200 | Bajista | 30m | 84; 56.0%; 0.073%; +0.774%; -0.817% | 128; 58.6%; 0.131%; +0.683%; -0.663% | 82; 56.1%; 0.100%; +0.874%; -0.888% | 130; 58.5%; 0.113%; +0.624%; -0.618% |
| 1h | 200 | Bajista | 60m | 77; 49.4%; 0.166%; +1.385%; -1.107% | 112; 55.4%; 0.112%; +0.899%; -0.862% | 77; 54.5%; 0.121%; +1.205%; -1.290% | 112; 51.8%; 0.143%; +0.995%; -0.772% |
| 1d | 20 | Alcista | 15m | 161; 54.7%; 0.101%; +0.519%; -0.433% | 98; 50.0%; -0.022%; +0.533%; -0.589% | 152; 50.7%; 0.050%; +0.507%; -0.448% | 107; 56.1%; 0.060%; +0.545%; -0.571% |
| 1d | 20 | Alcista | 30m | 153; 52.3%; 0.089%; +0.675%; -0.569% | 92; 51.1%; -0.001%; +0.774%; -0.849% | 144; 52.1%; 0.054%; +0.639%; -0.599% | 101; 51.5%; 0.057%; +0.817%; -0.781% |
| 1d | 20 | Alcista | 60m | 133; 55.6%; 0.216%; +0.886%; -0.659% | 82; 54.9%; 0.026%; +1.054%; -1.258% | 124; 54.8%; 0.173%; +0.846%; -0.669% | 91; 56.0%; 0.103%; +1.088%; -1.212% |
| 1d | 20 | Bajista | 15m | 96; 51.0%; 0.015%; +0.524%; -0.526% | 133; 51.1%; 0.057%; +0.552%; -0.476% | 90; 52.2%; 0.031%; +0.555%; -0.569% | 138; 50.0%; 0.045%; +0.536%; -0.454% |
| 1d | 20 | Bajista | 30m | 89; 53.9%; 0.052%; +0.774%; -0.794% | 126; 60.3%; 0.142%; +0.668%; -0.671% | 86; 57.0%; 0.100%; +0.835%; -0.874% | 128; 57.8%; 0.107%; +0.632%; -0.624% |
| 1d | 20 | Bajista | 60m | 80; 52.5%; 0.136%; +1.213%; -1.146% | 112; 53.6%; 0.134%; +0.988%; -0.851% | 79; 53.2%; 0.129%; +1.165%; -1.139% | 112; 52.7%; 0.132%; +1.025%; -0.861% |
| 1d | 40 | Alcista | 15m | 154; 53.2%; 0.084%; +0.508%; -0.416% | 103; 53.4%; 0.011%; +0.547%; -0.616% | 152; 53.9%; 0.052%; +0.483%; -0.474% | 105; 52.4%; 0.059%; +0.585%; -0.529% |
| 1d | 40 | Alcista | 30m | 146; 54.8%; 0.089%; +0.619%; -0.570% | 97; 47.4%; -0.001%; +0.873%; -0.821% | 142; 53.5%; 0.084%; +0.613%; -0.542% | 101; 49.5%; 0.011%; +0.862%; -0.857% |
| 1d | 40 | Alcista | 60m | 124; 57.3%; 0.203%; +0.811%; -0.648% | 89; 52.8%; 0.056%; +1.150%; -1.197% | 124; 56.5%; 0.181%; +0.839%; -0.713% | 89; 53.9%; 0.087%; +1.101%; -1.127% |
| 1d | 40 | Bajista | 15m | 86; 52.3%; 0.040%; +0.566%; -0.579% | 136; 50.7%; 0.038%; +0.517%; -0.455% | 82; 47.6%; -0.033%; +0.556%; -0.611% | 140; 53.6%; 0.081%; +0.526%; -0.431% |
| 1d | 40 | Bajista | 30m | 81; 56.8%; 0.098%; +0.807%; -0.835% | 127; 58.3%; 0.098%; +0.646%; -0.666% | 78; 51.3%; -0.010%; +0.773%; -0.835% | 130; 61.5%; 0.163%; +0.675%; -0.656% |
| 1d | 40 | Bajista | 60m | 72; 54.2%; 0.159%; +1.240%; -1.230% | 113; 51.3%; 0.076%; +0.931%; -0.825% | 71; 49.3%; -0.067%; +1.091%; -1.302% | 114; 54.4%; 0.218%; +1.035%; -0.757% |
| 1d | 100 | Alcista | 15m | 159; 54.1%; 0.067%; +0.473%; -0.423% | 85; 54.1%; 0.087%; +0.653%; -0.612% | 174; 57.5%; 0.095%; +0.467%; -0.420% | 70; 45.7%; 0.023%; +0.750%; -0.623% |
| 1d | 100 | Alcista | 30m | 151; 52.3%; 0.045%; +0.568%; -0.543% | 79; 53.2%; 0.102%; +1.009%; -0.980% | 166; 54.2%; 0.073%; +0.600%; -0.574% | 64; 48.4%; 0.044%; +1.072%; -0.950% |
| 1d | 100 | Alcista | 60m | 132; 56.1%; 0.186%; +0.818%; -0.655% | 69; 55.1%; 0.045%; +1.164%; -1.372% | 142; 55.6%; 0.224%; +0.894%; -0.658% | 59; 55.9%; -0.071%; +1.035%; -1.474% |
| 1d | 100 | Bajista | 15m | 57; 56.1%; 0.142%; +0.665%; -0.598% | 143; 49.7%; 0.007%; +0.482%; -0.463% | 57; 56.1%; 0.111%; +0.636%; -0.638% | 143; 49.7%; 0.019%; +0.496%; -0.451% |
| 1d | 100 | Bajista | 30m | 54; 59.3%; 0.056%; +0.771%; -0.983% | 133; 55.6%; 0.054%; +0.616%; -0.651% | 54; 57.4%; 0.105%; +0.917%; -0.988% | 133; 56.4%; 0.034%; +0.558%; -0.643% |
| 1d | 100 | Bajista | 60m | 52; 55.8%; -0.003%; +1.043%; -1.522% | 115; 47.8%; 0.069%; +0.975%; -0.760% | 52; 53.8%; -0.010%; +1.136%; -1.540% | 115; 48.7%; 0.072%; +0.930%; -0.741% |
| 1d | 200 | Alcista | 15m | 165; 57.0%; 0.089%; +0.462%; -0.417% | 44; 45.5%; 0.085%; +0.720%; -0.484% | 163; 57.7%; 0.085%; +0.451%; -0.425% | 46; 43.5%; 0.097%; +0.771%; -0.457% |
| 1d | 200 | Alcista | 30m | 157; 54.1%; 0.076%; +0.601%; -0.566% | 40; 52.5%; 0.061%; +0.845%; -0.850% | 155; 52.9%; 0.054%; +0.584%; -0.563% | 42; 57.1%; 0.144%; +0.873%; -0.877% |
| 1d | 200 | Alcista | 60m | 137; 55.5%; 0.222%; +0.898%; -0.652% | 38; 60.5%; 0.140%; +0.892%; -1.086% | 135; 56.3%; 0.186%; +0.843%; -0.696% | 40; 57.5%; 0.266%; +1.072%; -0.876% |
| 1d | 200 | Bajista | 15m | 34; 55.9%; 0.016%; +0.559%; -0.774% | 137; 50.4%; 0.031%; +0.486%; -0.430% | 37; 56.8%; 0.007%; +0.512%; -0.750% | 134; 50.0%; 0.034%; +0.499%; -0.430% |
| 1d | 200 | Bajista | 30m | 33; 66.7%; 0.087%; +0.764%; -1.266% | 127; 56.7%; 0.061%; +0.569%; -0.605% | 36; 66.7%; 0.074%; +0.706%; -1.188% | 124; 56.5%; 0.064%; +0.583%; -0.610% |
| 1d | 200 | Bajista | 60m | 31; 64.5%; 0.100%; +0.959%; -1.461% | 110; 48.2%; 0.099%; +0.963%; -0.704% | 33; 60.6%; 0.060%; +0.959%; -1.324% | 108; 49.1%; 0.112%; +0.963%; -0.709% |


Igualdades y pendientes planas (suma de ambas direcciones):

| TF | SMA | Precio exactamente igual | Pendiente plana |
|---|---:|---:|---:|
| 1h | 20 | 0 | 0 |
| 1h | 40 | 0 | 0 |
| 1h | 100 | 0 | 0 |
| 1h | 200 | 0 | 0 |
| 1d | 20 | 0 | 0 |
| 1d | 40 | 0 | 0 |
| 1d | 100 | 0 | 0 |
| 1d | 200 | 0 | 0 |


## Primer 70%: condiciones conjuntas

| Condición | Dirección | Horizonte | Disponibles | Seleccionadas | Evaluables | Sesiones | Favorables | Media % | Fav. media % | Desfav. media % | Δ vs Bollinger comparable % | IC 95% Δ % | Muestra |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 1h: precio encima de las cuatro SMA | Alcista | 15m | 286 | 106 | 98 | 94 | 53.1% | 0.033 | 0.447 | -0.465 | -0.022 | [-0.127, 0.077] | ≥30 señales y ≥10 sesiones |
| 1h: precio debajo de las cuatro SMA | Alcista | 15m | 286 | 47 | 43 | 43 | 53.5% | 0.041 | 0.553 | -0.577 | -0.014 | [-0.208, 0.174] | ≥30 señales y ≥10 sesiones |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 15m | 286 | 76 | 69 | 67 | 50.7% | 0.060 | 0.501 | -0.418 | 0.006 | [-0.125, 0.136] | ≥30 señales y ≥10 sesiones |
| 1h: orden SMA20 < SMA40 < SMA100 < SMA200 | Alcista | 15m | 286 | 44 | 38 | 35 | 44.7% | -0.076 | 0.525 | -0.590 | -0.131 | [-0.339, 0.084] | ≥30 señales y ≥10 sesiones |
| 1d: precio encima de las cuatro SMA | Alcista | 15m | 229 | 124 | 114 | 109 | 53.5% | 0.056 | 0.452 | -0.415 | -0.032 | [-0.111, 0.045] | ≥30 señales y ≥10 sesiones |
| 1d: precio debajo de las cuatro SMA | Alcista | 15m | 229 | 28 | 24 | 23 | 41.7% | -0.082 | 0.456 | -0.503 | -0.170 | — | Pequeña |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 15m | 229 | 107 | 99 | 97 | 55.6% | 0.048 | 0.387 | -0.383 | -0.040 | [-0.126, 0.042] | ≥30 señales y ≥10 sesiones |
| 1d: orden SMA20 < SMA40 < SMA100 < SMA200 | Alcista | 15m | 229 | 18 | 18 | 17 | 27.8% | -0.020 | 1.009 | -0.450 | -0.108 | — | Pequeña |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Alcista | 15m | 229 | 90 | 82 | 80 | 51.2% | -0.029 | 0.373 | -0.489 | -0.117 | [-0.214, -0.020] | ≥30 señales y ≥10 sesiones |
| 1h y 1d se contradicen en contexto de precio sobre/bajo las cuatro SMA | Alcista | 15m | 229 | 0 | 0 | 0 | — | — | — | — | — | — | Pequeña |
| 1h: precio encima de las cuatro SMA | Alcista | 30m | 286 | 106 | 94 | 90 | 47.9% | 0.013 | 0.575 | -0.525 | -0.041 | [-0.174, 0.097] | ≥30 señales y ≥10 sesiones |
| 1h: precio debajo de las cuatro SMA | Alcista | 30m | 286 | 47 | 40 | 40 | 47.5% | -0.086 | 0.664 | -0.802 | -0.139 | [-0.412, 0.132] | ≥30 señales y ≥10 sesiones |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 30m | 286 | 76 | 65 | 63 | 49.2% | 0.127 | 0.730 | -0.458 | 0.073 | [-0.104, 0.243] | ≥30 señales y ≥10 sesiones |
| 1h: orden SMA20 < SMA40 < SMA100 < SMA200 | Alcista | 30m | 286 | 44 | 33 | 31 | 45.5% | -0.100 | 0.878 | -1.029 | -0.153 | [-0.514, 0.237] | ≥30 señales y ≥10 sesiones |
| 1d: precio encima de las cuatro SMA | Alcista | 30m | 229 | 124 | 106 | 102 | 53.8% | 0.059 | 0.547 | -0.530 | -0.014 | [-0.132, 0.097] | ≥30 señales y ≥10 sesiones |
| 1d: precio debajo de las cuatro SMA | Alcista | 30m | 229 | 28 | 20 | 20 | 50.0% | -0.103 | 0.551 | -0.841 | -0.176 | — | Pequeña |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 30m | 229 | 107 | 91 | 90 | 57.1% | 0.039 | 0.441 | -0.523 | -0.034 | [-0.160, 0.085] | ≥30 señales y ≥10 sesiones |
| 1d: orden SMA20 < SMA40 < SMA100 < SMA200 | Alcista | 30m | 229 | 18 | 16 | 16 | 50.0% | -0.019 | 1.108 | -1.309 | -0.092 | — | Pequeña |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Alcista | 30m | 229 | 90 | 76 | 74 | 47.4% | -0.031 | 0.494 | -0.531 | -0.105 | [-0.236, 0.024] | ≥30 señales y ≥10 sesiones |
| 1h y 1d se contradicen en contexto de precio sobre/bajo las cuatro SMA | Alcista | 30m | 229 | 0 | 0 | 0 | — | — | — | — | — | — | Pequeña |
| 1h: precio encima de las cuatro SMA | Alcista | 60m | 286 | 106 | 78 | 77 | 53.8% | 0.109 | 0.742 | -0.665 | -0.032 | [-0.216, 0.170] | ≥30 señales y ≥10 sesiones |
| 1h: precio debajo de las cuatro SMA | Alcista | 60m | 286 | 47 | 35 | 35 | 60.0% | -0.121 | 1.013 | -1.822 | -0.263 | [-0.783, 0.231] | ≥30 señales y ≥10 sesiones |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 60m | 286 | 76 | 58 | 56 | 55.2% | 0.252 | 0.910 | -0.605 | 0.110 | [-0.147, 0.353] | ≥30 señales y ≥10 sesiones |
| 1h: orden SMA20 < SMA40 < SMA100 < SMA200 | Alcista | 60m | 286 | 44 | 29 | 29 | 55.2% | -0.131 | 1.053 | -1.588 | -0.272 | — | Pequeña |
| 1d: precio encima de las cuatro SMA | Alcista | 60m | 229 | 124 | 94 | 91 | 54.3% | 0.136 | 0.760 | -0.634 | -0.068 | [-0.223, 0.087] | ≥30 señales y ≥10 sesiones |
| 1d: precio debajo de las cuatro SMA | Alcista | 60m | 229 | 28 | 20 | 20 | 60.0% | -0.072 | 0.767 | -1.331 | -0.276 | — | Pequeña |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 60m | 229 | 107 | 77 | 76 | 55.8% | 0.123 | 0.766 | -0.733 | -0.081 | [-0.256, 0.102] | ≥30 señales y ≥10 sesiones |
| 1d: orden SMA20 < SMA40 < SMA100 < SMA200 | Alcista | 60m | 229 | 18 | 16 | 16 | 62.5% | 0.217 | 1.154 | -1.345 | 0.013 | — | Pequeña |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Alcista | 60m | 229 | 90 | 68 | 67 | 57.4% | 0.065 | 0.646 | -0.718 | -0.140 | [-0.325, 0.046] | ≥30 señales y ≥10 sesiones |
| 1h y 1d se contradicen en contexto de precio sobre/bajo las cuatro SMA | Alcista | 60m | 229 | 0 | 0 | 0 | — | — | — | — | — | — | Pequeña |
| 1h: precio encima de las cuatro SMA | Bajista | 15m | 241 | 75 | 71 | 70 | 53.5% | 0.063 | 0.527 | -0.471 | 0.020 | [-0.115, 0.150] | ≥30 señales y ≥10 sesiones |
| 1h: precio debajo de las cuatro SMA | Bajista | 15m | 241 | 56 | 52 | 52 | 53.8% | -0.035 | 0.485 | -0.670 | -0.079 | [-0.262, 0.096] | ≥30 señales y ≥10 sesiones |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 15m | 241 | 63 | 60 | 54 | 55.0% | 0.060 | 0.491 | -0.466 | 0.017 | [-0.124, 0.155] | ≥30 señales y ≥10 sesiones |
| 1h: orden SMA20 < SMA40 < SMA100 < SMA200 | Bajista | 15m | 241 | 33 | 30 | 30 | 56.7% | 0.080 | 0.594 | -0.593 | 0.036 | [-0.199, 0.257] | ≥30 señales y ≥10 sesiones |
| 1d: precio encima de las cuatro SMA | Bajista | 15m | 186 | 98 | 93 | 88 | 50.5% | 0.036 | 0.477 | -0.414 | 0.008 | [-0.080, 0.102] | ≥30 señales y ≥10 sesiones |
| 1d: precio debajo de las cuatro SMA | Bajista | 15m | 186 | 15 | 12 | 12 | 66.7% | 0.188 | 0.557 | -0.733 | 0.160 | — | Pequeña |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 15m | 186 | 108 | 100 | 95 | 56.0% | 0.101 | 0.469 | -0.368 | 0.072 | [-0.013, 0.166] | ≥30 señales y ≥10 sesiones |
| 1d: orden SMA20 < SMA40 < SMA100 < SMA200 | Bajista | 15m | 186 | 12 | 10 | 10 | 60.0% | 0.050 | 0.645 | -1.123 | 0.022 | — | Pequeña |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Bajista | 15m | 186 | 65 | 60 | 59 | 55.0% | 0.054 | 0.476 | -0.478 | 0.026 | [-0.105, 0.152] | ≥30 señales y ≥10 sesiones |
| 1h y 1d se contradicen en contexto de precio sobre/bajo las cuatro SMA | Bajista | 15m | 186 | 0 | 0 | 0 | — | — | — | — | — | — | Pequeña |
| 1h: precio encima de las cuatro SMA | Bajista | 30m | 241 | 75 | 67 | 66 | 56.7% | 0.119 | 0.672 | -0.628 | 0.011 | [-0.152, 0.190] | ≥30 señales y ≥10 sesiones |
| 1h: precio debajo de las cuatro SMA | Bajista | 30m | 241 | 56 | 47 | 47 | 57.4% | -0.006 | 0.711 | -0.974 | -0.114 | [-0.377, 0.159] | ≥30 señales y ≥10 sesiones |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 30m | 241 | 63 | 55 | 52 | 60.0% | 0.024 | 0.478 | -0.657 | -0.084 | [-0.264, 0.100] | ≥30 señales y ≥10 sesiones |
| 1h: orden SMA20 < SMA40 < SMA100 < SMA200 | Bajista | 30m | 241 | 33 | 28 | 28 | 57.1% | 0.216 | 1.000 | -0.828 | 0.108 | — | Pequeña |
| 1d: precio encima de las cuatro SMA | Bajista | 30m | 186 | 98 | 86 | 84 | 55.8% | 0.009 | 0.537 | -0.658 | -0.057 | [-0.181, 0.077] | ≥30 señales y ≥10 sesiones |
| 1d: precio debajo de las cuatro SMA | Bajista | 30m | 186 | 15 | 12 | 12 | 75.0% | 0.014 | 0.699 | -2.043 | -0.052 | — | Pequeña |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 30m | 186 | 108 | 93 | 91 | 54.8% | 0.055 | 0.539 | -0.533 | -0.011 | [-0.133, 0.117] | ≥30 señales y ≥10 sesiones |
| 1d: orden SMA20 < SMA40 < SMA100 < SMA200 | Bajista | 30m | 186 | 12 | 10 | 10 | 60.0% | -0.140 | 0.683 | -1.374 | -0.206 | — | Pequeña |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Bajista | 30m | 186 | 65 | 56 | 55 | 57.1% | 0.022 | 0.651 | -0.817 | -0.044 | [-0.233, 0.150] | ≥30 señales y ≥10 sesiones |
| 1h y 1d se contradicen en contexto de precio sobre/bajo las cuatro SMA | Bajista | 30m | 186 | 0 | 0 | 0 | — | — | — | — | — | — | Pequeña |
| 1h: precio encima de las cuatro SMA | Bajista | 60m | 241 | 75 | 60 | 60 | 50.0% | 0.066 | 0.862 | -0.730 | -0.068 | [-0.320, 0.176] | ≥30 señales y ≥10 sesiones |
| 1h: precio debajo de las cuatro SMA | Bajista | 60m | 241 | 56 | 44 | 44 | 52.3% | 0.183 | 1.385 | -1.191 | 0.048 | [-0.390, 0.474] | ≥30 señales y ≥10 sesiones |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 60m | 241 | 63 | 47 | 47 | 51.1% | -0.012 | 0.693 | -0.747 | -0.146 | [-0.411, 0.118] | ≥30 señales y ≥10 sesiones |
| 1h: orden SMA20 < SMA40 < SMA100 < SMA200 | Bajista | 60m | 241 | 33 | 25 | 25 | 52.0% | 0.266 | 1.450 | -1.220 | 0.131 | — | Pequeña |
| 1d: precio encima de las cuatro SMA | Bajista | 60m | 186 | 98 | 75 | 75 | 41.3% | -0.086 | 0.793 | -0.705 | -0.185 | [-0.367, 0.000] | ≥30 señales y ≥10 sesiones |
| 1d: precio debajo de las cuatro SMA | Bajista | 60m | 186 | 15 | 12 | 12 | 58.3% | -0.013 | 0.787 | -1.133 | -0.112 | — | Pequeña |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 60m | 186 | 108 | 79 | 79 | 49.4% | 0.106 | 0.884 | -0.652 | 0.007 | [-0.174, 0.181] | ≥30 señales y ≥10 sesiones |
| 1d: orden SMA20 < SMA40 < SMA100 < SMA200 | Bajista | 60m | 186 | 12 | 10 | 10 | 60.0% | -0.302 | 0.771 | -1.911 | -0.401 | — | Pequeña |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Bajista | 60m | 186 | 65 | 51 | 51 | 41.2% | -0.038 | 0.906 | -0.699 | -0.138 | [-0.380, 0.108] | ≥30 señales y ≥10 sesiones |
| 1h y 1d se contradicen en contexto de precio sobre/bajo las cuatro SMA | Bajista | 60m | 186 | 0 | 0 | 0 | — | — | — | — | — | — | Pequeña |


## Primer 70%: intervalos disponibles

| Condición | Dirección | Horizonte | n | Δ media vs Bollinger comparable % | IC 95% por sesiones % | Δ vs control horario % | IC 95% vs control % |
|---|---|---:|---:|---:|---|---:|---|
| 1h SMA 20: precio alineado con la señal | Alcista | 15m | 154 | -0.036 | [-0.108, 0.034] | -0.003 | [-0.111, 0.111] |
| 1h SMA 20: precio contrario a la señal | Alcista | 15m | 108 | 0.052 | [-0.049, 0.154] | 0.085 | [-0.045, 0.219] |
| 1h SMA 20: pendiente alineada con la señal | Alcista | 15m | 155 | -0.043 | [-0.115, 0.030] | -0.009 | [-0.117, 0.098] |
| 1h SMA 20: pendiente contraria a la señal | Alcista | 15m | 107 | 0.062 | [-0.042, 0.165] | 0.094 | [-0.045, 0.246] |
| 1h SMA 40: precio alineado con la señal | Alcista | 15m | 164 | -0.015 | [-0.083, 0.054] | 0.018 | [-0.087, 0.123] |
| 1h SMA 40: precio contrario a la señal | Alcista | 15m | 98 | 0.025 | [-0.091, 0.140] | 0.059 | [-0.088, 0.212] |
| 1h SMA 40: pendiente alineada con la señal | Alcista | 15m | 162 | 0.015 | [-0.056, 0.088] | 0.048 | [-0.054, 0.144] |
| 1h SMA 40: pendiente contraria a la señal | Alcista | 15m | 100 | -0.025 | [-0.139, 0.092] | 0.008 | [-0.137, 0.168] |
| 1h SMA 100: precio alineado con la señal | Alcista | 15m | 163 | 0.043 | [-0.027, 0.109] | 0.075 | [-0.029, 0.178] |
| 1h SMA 100: precio contrario a la señal | Alcista | 15m | 97 | -0.073 | [-0.181, 0.047] | -0.042 | [-0.186, 0.112] |
| 1h SMA 100: pendiente alineada con la señal | Alcista | 15m | 153 | 0.045 | [-0.030, 0.116] | 0.077 | [-0.031, 0.183] |
| 1h SMA 100: pendiente contraria a la señal | Alcista | 15m | 107 | -0.064 | [-0.168, 0.044] | -0.034 | [-0.167, 0.107] |
| 1h SMA 200: precio alineado con la señal | Alcista | 15m | 160 | 0.046 | [-0.022, 0.114] | 0.091 | [-0.004, 0.189] |
| 1h SMA 200: precio contrario a la señal | Alcista | 15m | 97 | -0.075 | [-0.188, 0.038] | -0.030 | [-0.178, 0.124] |
| 1h SMA 200: pendiente alineada con la señal | Alcista | 15m | 142 | 0.030 | [-0.047, 0.107] | 0.075 | [-0.020, 0.176] |
| 1h SMA 200: pendiente contraria a la señal | Alcista | 15m | 115 | -0.037 | [-0.132, 0.062] | 0.008 | [-0.128, 0.148] |
| 1d SMA 20: precio alineado con la señal | Alcista | 15m | 161 | 0.046 | [-0.019, 0.116] | 0.091 | [0.004, 0.179] |
| 1d SMA 20: precio contrario a la señal | Alcista | 15m | 98 | -0.076 | [-0.196, 0.033] | -0.031 | [-0.176, 0.123] |
| 1d SMA 20: pendiente alineada con la señal | Alcista | 15m | 152 | -0.004 | [-0.076, 0.066] | 0.042 | [-0.058, 0.143] |
| 1d SMA 20: pendiente contraria a la señal | Alcista | 15m | 107 | 0.006 | [-0.099, 0.112] | 0.049 | [-0.092, 0.193] |
| 1d SMA 40: precio alineado con la señal | Alcista | 15m | 154 | 0.029 | [-0.041, 0.101] | 0.075 | [-0.017, 0.169] |
| 1d SMA 40: precio contrario a la señal | Alcista | 15m | 103 | -0.044 | [-0.151, 0.058] | 0.001 | [-0.153, 0.151] |
| 1d SMA 40: pendiente alineada con la señal | Alcista | 15m | 152 | -0.003 | [-0.071, 0.069] | 0.041 | [-0.062, 0.139] |
| 1d SMA 40: pendiente contraria a la señal | Alcista | 15m | 105 | 0.005 | [-0.098, 0.107] | 0.051 | [-0.091, 0.190] |
| 1d SMA 100: precio alineado con la señal | Alcista | 15m | 159 | -0.007 | [-0.075, 0.066] | 0.058 | [-0.032, 0.153] |
| 1d SMA 100: precio contrario a la señal | Alcista | 15m | 85 | 0.013 | [-0.118, 0.143] | 0.077 | [-0.091, 0.249] |
| 1d SMA 100: pendiente alineada con la señal | Alcista | 15m | 174 | 0.021 | [-0.045, 0.088] | 0.086 | [0.000, 0.175] |
| 1d SMA 100: pendiente contraria a la señal | Alcista | 15m | 70 | -0.051 | [-0.218, 0.115] | 0.011 | [-0.192, 0.220] |
| 1d SMA 200: precio alineado con la señal | Alcista | 15m | 165 | 0.001 | [-0.046, 0.050] | 0.079 | [-0.013, 0.174] |
| 1d SMA 200: precio contrario a la señal | Alcista | 15m | 44 | -0.003 | [-0.188, 0.173] | 0.071 | [-0.140, 0.296] |
| 1d SMA 200: pendiente alineada con la señal | Alcista | 15m | 163 | -0.003 | [-0.053, 0.048] | 0.075 | [-0.010, 0.160] |
| 1d SMA 200: pendiente contraria a la señal | Alcista | 15m | 46 | 0.009 | [-0.173, 0.187] | 0.084 | [-0.120, 0.306] |
| 1h: precio encima de las cuatro SMA | Alcista | 15m | 98 | -0.022 | [-0.127, 0.077] | 0.025 | [-0.089, 0.142] |
| 1h: precio debajo de las cuatro SMA | Alcista | 15m | 43 | -0.014 | [-0.208, 0.174] | 0.033 | [-0.186, 0.238] |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 15m | 69 | 0.006 | [-0.125, 0.136] | 0.051 | [-0.082, 0.197] |
| 1h: orden SMA20 < SMA40 < SMA100 < SMA200 | Alcista | 15m | 38 | -0.131 | [-0.339, 0.084] | -0.089 | [-0.310, 0.155] |
| 1d: precio encima de las cuatro SMA | Alcista | 15m | 114 | -0.032 | [-0.111, 0.045] | 0.044 | [-0.057, 0.149] |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 15m | 99 | -0.040 | [-0.126, 0.042] | 0.037 | [-0.060, 0.134] |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Alcista | 15m | 82 | -0.117 | [-0.214, -0.020] | -0.043 | [-0.155, 0.076] |
| 1h SMA 20: precio alineado con la señal | Alcista | 30m | 147 | -0.026 | [-0.120, 0.071] | 0.014 | [-0.133, 0.161] |
| 1h SMA 20: precio contrario a la señal | Alcista | 30m | 101 | 0.037 | [-0.101, 0.179] | 0.074 | [-0.102, 0.267] |
| 1h SMA 20: pendiente alineada con la señal | Alcista | 30m | 148 | -0.091 | [-0.187, 0.011] | -0.051 | [-0.195, 0.089] |
| 1h SMA 20: pendiente contraria a la señal | Alcista | 30m | 100 | 0.135 | [-0.013, 0.288] | 0.170 | [-0.025, 0.373] |
| 1h SMA 40: precio alineado con la señal | Alcista | 30m | 157 | -0.006 | [-0.098, 0.086] | 0.033 | [-0.108, 0.177] |
| 1h SMA 40: precio contrario a la señal | Alcista | 30m | 91 | 0.010 | [-0.148, 0.169] | 0.048 | [-0.146, 0.250] |
| 1h SMA 40: pendiente alineada con la señal | Alcista | 30m | 156 | 0.000 | [-0.096, 0.096] | 0.038 | [-0.096, 0.176] |
| 1h SMA 40: pendiente contraria a la señal | Alcista | 30m | 92 | -0.000 | [-0.158, 0.163] | 0.038 | [-0.166, 0.250] |
| 1h SMA 100: precio alineado con la señal | Alcista | 30m | 157 | 0.082 | [-0.009, 0.183] | 0.123 | [-0.011, 0.261] |
| 1h SMA 100: precio contrario a la señal | Alcista | 30m | 89 | -0.145 | [-0.309, 0.017] | -0.102 | [-0.311, 0.109] |
| 1h SMA 100: pendiente alineada con la señal | Alcista | 30m | 146 | 0.052 | [-0.048, 0.151] | 0.092 | [-0.050, 0.225] |
| 1h SMA 100: pendiente contraria a la señal | Alcista | 30m | 100 | -0.075 | [-0.216, 0.066] | -0.032 | [-0.228, 0.187] |
| 1h SMA 200: precio alineado con la señal | Alcista | 30m | 152 | 0.041 | [-0.059, 0.133] | 0.091 | [-0.032, 0.226] |
| 1h SMA 200: precio contrario a la señal | Alcista | 30m | 91 | -0.068 | [-0.222, 0.104] | -0.015 | [-0.234, 0.204] |
| 1h SMA 200: pendiente alineada con la señal | Alcista | 30m | 134 | 0.062 | [-0.050, 0.169] | 0.113 | [-0.014, 0.258] |
| 1h SMA 200: pendiente contraria a la señal | Alcista | 30m | 109 | -0.077 | [-0.208, 0.061] | -0.025 | [-0.218, 0.176] |
| 1d SMA 20: precio alineado con la señal | Alcista | 30m | 153 | 0.034 | [-0.061, 0.126] | 0.086 | [-0.037, 0.220] |
| 1d SMA 20: precio contrario a la señal | Alcista | 30m | 92 | -0.057 | [-0.209, 0.104] | -0.002 | [-0.220, 0.218] |
| 1d SMA 20: pendiente alineada con la señal | Alcista | 30m | 144 | -0.001 | [-0.106, 0.100] | 0.051 | [-0.080, 0.178] |
| 1d SMA 20: pendiente contraria a la señal | Alcista | 30m | 101 | 0.002 | [-0.143, 0.148] | 0.055 | [-0.137, 0.268] |
| 1d SMA 40: precio alineado con la señal | Alcista | 30m | 146 | 0.036 | [-0.068, 0.132] | 0.086 | [-0.037, 0.220] |
| 1d SMA 40: precio contrario a la señal | Alcista | 30m | 97 | -0.054 | [-0.205, 0.105] | -0.001 | [-0.223, 0.213] |
| 1d SMA 40: pendiente alineada con la señal | Alcista | 30m | 142 | 0.030 | [-0.075, 0.133] | 0.081 | [-0.038, 0.209] |
| 1d SMA 40: pendiente contraria a la señal | Alcista | 30m | 101 | -0.042 | [-0.188, 0.108] | 0.009 | [-0.200, 0.209] |
| 1d SMA 100: precio alineado con la señal | Alcista | 30m | 151 | -0.020 | [-0.121, 0.085] | 0.043 | [-0.079, 0.165] |
| 1d SMA 100: precio contrario a la señal | Alcista | 30m | 79 | 0.037 | [-0.165, 0.236] | 0.101 | [-0.154, 0.364] |
| 1d SMA 100: pendiente alineada con la señal | Alcista | 30m | 166 | 0.008 | [-0.081, 0.101] | 0.071 | [-0.044, 0.197] |
| 1d SMA 100: pendiente contraria a la señal | Alcista | 30m | 64 | -0.020 | [-0.265, 0.207] | 0.042 | [-0.265, 0.342] |
| 1d SMA 200: precio alineado con la señal | Alcista | 30m | 157 | 0.003 | [-0.070, 0.076] | 0.075 | [-0.046, 0.198] |
| 1d SMA 200: precio contrario a la señal | Alcista | 30m | 40 | -0.012 | [-0.292, 0.277] | 0.056 | [-0.274, 0.386] |
| 1d SMA 200: pendiente alineada con la señal | Alcista | 30m | 155 | -0.019 | [-0.096, 0.054] | 0.052 | [-0.068, 0.174] |
| 1d SMA 200: pendiente contraria a la señal | Alcista | 30m | 42 | 0.070 | [-0.207, 0.355] | 0.139 | [-0.198, 0.483] |
| 1h: precio encima de las cuatro SMA | Alcista | 30m | 94 | -0.041 | [-0.174, 0.097] | 0.012 | [-0.125, 0.149] |
| 1h: precio debajo de las cuatro SMA | Alcista | 30m | 40 | -0.139 | [-0.412, 0.132] | -0.087 | [-0.402, 0.219] |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 30m | 65 | 0.073 | [-0.104, 0.243] | 0.126 | [-0.059, 0.324] |
| 1h: orden SMA20 < SMA40 < SMA100 < SMA200 | Alcista | 30m | 33 | -0.153 | [-0.514, 0.237] | -0.097 | [-0.495, 0.332] |
| 1d: precio encima de las cuatro SMA | Alcista | 30m | 106 | -0.014 | [-0.132, 0.097] | 0.056 | [-0.076, 0.196] |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 30m | 91 | -0.034 | [-0.160, 0.085] | 0.038 | [-0.084, 0.160] |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Alcista | 30m | 76 | -0.105 | [-0.236, 0.024] | -0.034 | [-0.175, 0.108] |
| 1h SMA 20: precio alineado con la señal | Alcista | 60m | 128 | -0.023 | [-0.159, 0.117] | 0.123 | [-0.056, 0.321] |
| 1h SMA 20: precio contrario a la señal | Alcista | 60m | 90 | 0.033 | [-0.163, 0.230] | 0.179 | [-0.114, 0.453] |
| 1h SMA 20: pendiente alineada con la señal | Alcista | 60m | 126 | -0.071 | [-0.218, 0.074] | 0.076 | [-0.116, 0.265] |
| 1h SMA 20: pendiente contraria a la señal | Alcista | 60m | 92 | 0.097 | [-0.099, 0.300] | 0.242 | [-0.041, 0.528] |
| 1h SMA 40: precio alineado con la señal | Alcista | 60m | 138 | 0.055 | [-0.076, 0.185] | 0.200 | [0.011, 0.398] |
| 1h SMA 40: precio contrario a la señal | Alcista | 60m | 80 | -0.095 | [-0.322, 0.136] | 0.052 | [-0.235, 0.351] |
| 1h SMA 40: pendiente alineada con la señal | Alcista | 60m | 139 | 0.047 | [-0.088, 0.177] | 0.192 | [0.006, 0.377] |
| 1h SMA 40: pendiente contraria a la señal | Alcista | 60m | 79 | -0.082 | [-0.306, 0.157] | 0.064 | [-0.243, 0.390] |
| 1h SMA 100: precio alineado con la señal | Alcista | 60m | 137 | 0.110 | [-0.027, 0.249] | 0.253 | [0.087, 0.429] |
| 1h SMA 100: precio contrario a la señal | Alcista | 60m | 79 | -0.190 | [-0.430, 0.047] | -0.047 | [-0.381, 0.276] |
| 1h SMA 100: pendiente alineada con la señal | Alcista | 60m | 124 | 0.101 | [-0.050, 0.254] | 0.242 | [0.049, 0.430] |
| 1h SMA 100: pendiente contraria a la señal | Alcista | 60m | 92 | -0.135 | [-0.340, 0.073] | 0.010 | [-0.285, 0.299] |
| 1h SMA 200: precio alineado con la señal | Alcista | 60m | 131 | 0.048 | [-0.094, 0.194] | 0.199 | [0.028, 0.370] |
| 1h SMA 200: precio contrario a la señal | Alcista | 60m | 82 | -0.076 | [-0.305, 0.153] | 0.076 | [-0.238, 0.413] |
| 1h SMA 200: pendiente alineada con la señal | Alcista | 60m | 114 | 0.073 | [-0.087, 0.226] | 0.226 | [0.032, 0.415] |
| 1h SMA 200: pendiente contraria a la señal | Alcista | 60m | 99 | -0.084 | [-0.263, 0.109] | 0.067 | [-0.220, 0.347] |
| 1d SMA 20: precio alineado con la señal | Alcista | 60m | 133 | 0.072 | [-0.068, 0.208] | 0.225 | [0.054, 0.410] |
| 1d SMA 20: precio contrario a la señal | Alcista | 60m | 82 | -0.117 | [-0.340, 0.113] | 0.037 | [-0.292, 0.384] |
| 1d SMA 20: pendiente alineada con la señal | Alcista | 60m | 124 | 0.029 | [-0.129, 0.179] | 0.182 | [-0.004, 0.365] |
| 1d SMA 20: pendiente contraria a la señal | Alcista | 60m | 91 | -0.040 | [-0.239, 0.186] | 0.116 | [-0.169, 0.420] |
| 1d SMA 40: precio alineado con la señal | Alcista | 60m | 124 | 0.061 | [-0.089, 0.210] | 0.213 | [0.043, 0.380] |
| 1d SMA 40: precio contrario a la señal | Alcista | 60m | 89 | -0.086 | [-0.291, 0.129] | 0.067 | [-0.252, 0.382] |
| 1d SMA 40: pendiente alineada con la señal | Alcista | 60m | 124 | 0.039 | [-0.105, 0.194] | 0.192 | [0.006, 0.377] |
| 1d SMA 40: pendiente contraria a la señal | Alcista | 60m | 89 | -0.055 | [-0.265, 0.148] | 0.096 | [-0.227, 0.387] |
| 1d SMA 100: precio alineado con la señal | Alcista | 60m | 132 | 0.048 | [-0.088, 0.199] | 0.198 | [0.026, 0.391] |
| 1d SMA 100: precio contrario a la señal | Alcista | 60m | 69 | -0.093 | [-0.384, 0.178] | 0.055 | [-0.316, 0.419] |
| 1d SMA 100: pendiente alineada con la señal | Alcista | 60m | 142 | 0.086 | [-0.038, 0.223] | 0.237 | [0.065, 0.416] |
| 1d SMA 100: pendiente contraria a la señal | Alcista | 60m | 59 | -0.208 | [-0.532, 0.089] | -0.063 | [-0.455, 0.317] |
| 1d SMA 200: precio alineado con la señal | Alcista | 60m | 137 | 0.018 | [-0.073, 0.119] | 0.235 | [0.054, 0.417] |
| 1d SMA 200: precio contrario a la señal | Alcista | 60m | 38 | -0.064 | [-0.422, 0.273] | 0.144 | [-0.243, 0.547] |
| 1d SMA 200: pendiente alineada con la señal | Alcista | 60m | 135 | -0.018 | [-0.111, 0.082] | 0.198 | [0.029, 0.376] |
| 1d SMA 200: pendiente contraria a la señal | Alcista | 60m | 40 | 0.062 | [-0.278, 0.380] | 0.272 | [-0.129, 0.649] |
| 1h: precio encima de las cuatro SMA | Alcista | 60m | 78 | -0.032 | [-0.216, 0.170] | 0.119 | [-0.070, 0.312] |
| 1h: precio debajo de las cuatro SMA | Alcista | 60m | 35 | -0.263 | [-0.783, 0.231] | -0.109 | [-0.672, 0.465] |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 60m | 58 | 0.110 | [-0.147, 0.353] | 0.265 | [0.005, 0.549] |
| 1d: precio encima de las cuatro SMA | Alcista | 60m | 94 | -0.068 | [-0.223, 0.087] | 0.146 | [-0.036, 0.338] |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 60m | 77 | -0.081 | [-0.256, 0.102] | 0.136 | [-0.072, 0.351] |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Alcista | 60m | 68 | -0.140 | [-0.325, 0.046] | 0.074 | [-0.149, 0.293] |
| 1h SMA 20: precio alineado con la señal | Bajista | 15m | 113 | -0.015 | [-0.104, 0.074] | 0.032 | [-0.099, 0.161] |
| 1h SMA 20: precio contrario a la señal | Bajista | 15m | 119 | 0.015 | [-0.071, 0.100] | 0.061 | [-0.048, 0.169] |
| 1h SMA 20: pendiente alineada con la señal | Bajista | 15m | 113 | 0.005 | [-0.084, 0.098] | 0.053 | [-0.085, 0.186] |
| 1h SMA 20: pendiente contraria a la señal | Bajista | 15m | 119 | -0.004 | [-0.089, 0.081] | 0.042 | [-0.073, 0.156] |
| 1h SMA 40: precio alineado con la señal | Bajista | 15m | 105 | 0.011 | [-0.084, 0.109] | 0.061 | [-0.069, 0.195] |
| 1h SMA 40: precio contrario a la señal | Bajista | 15m | 127 | -0.009 | [-0.092, 0.070] | 0.036 | [-0.072, 0.148] |
| 1h SMA 40: pendiente alineada con la señal | Bajista | 15m | 100 | 0.017 | [-0.079, 0.115] | 0.065 | [-0.074, 0.206] |
| 1h SMA 40: pendiente contraria a la señal | Bajista | 15m | 132 | -0.013 | [-0.087, 0.060] | 0.034 | [-0.070, 0.138] |
| 1h SMA 100: precio alineado con la señal | Bajista | 15m | 97 | -0.017 | [-0.123, 0.085] | 0.035 | [-0.103, 0.165] |
| 1h SMA 100: precio contrario a la señal | Bajista | 15m | 133 | 0.012 | [-0.062, 0.089] | 0.063 | [-0.044, 0.176] |
| 1h SMA 100: pendiente alineada con la señal | Bajista | 15m | 100 | -0.021 | [-0.119, 0.072] | 0.030 | [-0.096, 0.150] |
| 1h SMA 100: pendiente contraria a la señal | Bajista | 15m | 130 | 0.016 | [-0.057, 0.090] | 0.068 | [-0.043, 0.186] |
| 1h SMA 200: precio alineado con la señal | Bajista | 15m | 90 | -0.046 | [-0.156, 0.065] | 0.010 | [-0.137, 0.162] |
| 1h SMA 200: precio contrario a la señal | Bajista | 15m | 136 | 0.030 | [-0.043, 0.106] | 0.085 | [-0.015, 0.189] |
| 1h SMA 200: pendiente alineada con la señal | Bajista | 15m | 88 | 0.000 | [-0.119, 0.112] | 0.057 | [-0.095, 0.209] |
| 1h SMA 200: pendiente contraria a la señal | Bajista | 15m | 138 | -0.000 | [-0.070, 0.075] | 0.054 | [-0.050, 0.164] |
| 1d SMA 20: precio alineado con la señal | Bajista | 15m | 96 | -0.024 | [-0.129, 0.078] | 0.028 | [-0.119, 0.163] |
| 1d SMA 20: precio contrario a la señal | Bajista | 15m | 133 | 0.017 | [-0.059, 0.095] | 0.068 | [-0.041, 0.174] |
| 1d SMA 20: pendiente alineada con la señal | Bajista | 15m | 90 | -0.009 | [-0.112, 0.102] | 0.042 | [-0.102, 0.183] |
| 1d SMA 20: pendiente contraria a la señal | Bajista | 15m | 138 | 0.006 | [-0.067, 0.076] | 0.056 | [-0.050, 0.165] |
| 1d SMA 40: precio alineado con la señal | Bajista | 15m | 86 | 0.001 | [-0.114, 0.109] | 0.051 | [-0.106, 0.201] |
| 1d SMA 40: precio contrario a la señal | Bajista | 15m | 136 | -0.001 | [-0.071, 0.072] | 0.051 | [-0.055, 0.160] |
| 1d SMA 40: pendiente alineada con la señal | Bajista | 15m | 82 | -0.072 | [-0.194, 0.047] | -0.022 | [-0.175, 0.138] |
| 1d SMA 40: pendiente contraria a la señal | Bajista | 15m | 140 | 0.042 | [-0.026, 0.116] | 0.093 | [-0.010, 0.201] |
| 1d SMA 100: precio alineado con la señal | Bajista | 15m | 57 | 0.097 | [-0.063, 0.258] | 0.155 | [-0.028, 0.330] |
| 1d SMA 100: precio contrario a la señal | Bajista | 15m | 143 | -0.039 | [-0.104, 0.025] | 0.018 | [-0.087, 0.121] |
| 1d SMA 100: pendiente alineada con la señal | Bajista | 15m | 57 | 0.065 | [-0.101, 0.223] | 0.126 | [-0.065, 0.322] |
| 1d SMA 100: pendiente contraria a la señal | Bajista | 15m | 143 | -0.026 | [-0.088, 0.039] | 0.030 | [-0.067, 0.136] |
| 1d SMA 200: precio alineado con la señal | Bajista | 15m | 34 | -0.012 | [-0.246, 0.231] | 0.030 | [-0.240, 0.289] |
| 1d SMA 200: precio contrario a la señal | Bajista | 15m | 137 | 0.003 | [-0.052, 0.060] | 0.042 | [-0.067, 0.142] |
| 1d SMA 200: pendiente alineada con la señal | Bajista | 15m | 37 | -0.021 | [-0.240, 0.203] | 0.021 | [-0.230, 0.260] |
| 1d SMA 200: pendiente contraria a la señal | Bajista | 15m | 134 | 0.006 | [-0.052, 0.067] | 0.045 | [-0.063, 0.153] |
| 1h: precio encima de las cuatro SMA | Bajista | 15m | 71 | 0.020 | [-0.115, 0.150] | 0.075 | [-0.072, 0.217] |
| 1h: precio debajo de las cuatro SMA | Bajista | 15m | 52 | -0.079 | [-0.262, 0.096] | -0.019 | [-0.233, 0.183] |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 15m | 60 | 0.017 | [-0.124, 0.155] | 0.072 | [-0.076, 0.229] |
| 1h: orden SMA20 < SMA40 < SMA100 < SMA200 | Bajista | 15m | 30 | 0.036 | [-0.199, 0.257] | 0.091 | [-0.152, 0.348] |
| 1d: precio encima de las cuatro SMA | Bajista | 15m | 93 | 0.008 | [-0.080, 0.102] | 0.047 | [-0.068, 0.167] |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 15m | 100 | 0.072 | [-0.013, 0.166] | 0.112 | [0.000, 0.222] |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Bajista | 15m | 60 | 0.026 | [-0.105, 0.152] | 0.066 | [-0.078, 0.211] |
| 1h SMA 20: precio alineado con la señal | Bajista | 30m | 105 | -0.032 | [-0.164, 0.100] | 0.065 | [-0.124, 0.261] |
| 1h SMA 20: precio contrario a la señal | Bajista | 30m | 113 | 0.030 | [-0.092, 0.151] | 0.124 | [-0.023, 0.282] |
| 1h SMA 20: pendiente alineada con la señal | Bajista | 30m | 106 | -0.016 | [-0.141, 0.113] | 0.081 | [-0.106, 0.269] |
| 1h SMA 20: pendiente contraria a la señal | Bajista | 30m | 112 | 0.015 | [-0.104, 0.133] | 0.111 | [-0.036, 0.276] |
| 1h SMA 40: precio alineado con la señal | Bajista | 30m | 98 | 0.013 | [-0.126, 0.154] | 0.110 | [-0.091, 0.301] |
| 1h SMA 40: precio contrario a la señal | Bajista | 30m | 120 | -0.011 | [-0.125, 0.100] | 0.084 | [-0.061, 0.229] |
| 1h SMA 40: pendiente alineada con la señal | Bajista | 30m | 94 | 0.013 | [-0.128, 0.161] | 0.109 | [-0.096, 0.316] |
| 1h SMA 40: pendiente contraria a la señal | Bajista | 30m | 124 | -0.010 | [-0.117, 0.098] | 0.086 | [-0.055, 0.235] |
| 1h SMA 100: precio alineado con la señal | Bajista | 30m | 90 | 0.025 | [-0.119, 0.169] | 0.126 | [-0.078, 0.324] |
| 1h SMA 100: precio contrario a la señal | Bajista | 30m | 126 | -0.018 | [-0.123, 0.087] | 0.087 | [-0.066, 0.233] |
| 1h SMA 100: pendiente alineada con la señal | Bajista | 30m | 94 | -0.053 | [-0.189, 0.078] | 0.046 | [-0.171, 0.247] |
| 1h SMA 100: pendiente contraria a la señal | Bajista | 30m | 122 | 0.041 | [-0.062, 0.149] | 0.147 | [-0.011, 0.303] |
| 1h SMA 200: precio alineado con la señal | Bajista | 30m | 84 | -0.035 | [-0.197, 0.125] | 0.073 | [-0.142, 0.288] |
| 1h SMA 200: precio contrario a la señal | Bajista | 30m | 128 | 0.023 | [-0.082, 0.131] | 0.136 | [-0.006, 0.291] |
| 1h SMA 200: pendiente alineada con la señal | Bajista | 30m | 82 | -0.008 | [-0.171, 0.155] | 0.100 | [-0.139, 0.339] |
| 1h SMA 200: pendiente contraria a la señal | Bajista | 30m | 130 | 0.005 | [-0.097, 0.110] | 0.118 | [-0.025, 0.257] |
| 1d SMA 20: precio alineado con la señal | Bajista | 30m | 89 | -0.053 | [-0.206, 0.103] | 0.052 | [-0.169, 0.264] |
| 1d SMA 20: precio contrario a la señal | Bajista | 30m | 126 | 0.037 | [-0.072, 0.144] | 0.147 | [0.003, 0.291] |
| 1d SMA 20: pendiente alineada con la señal | Bajista | 30m | 86 | -0.004 | [-0.166, 0.156] | 0.100 | [-0.139, 0.338] |
| 1d SMA 20: pendiente contraria a la señal | Bajista | 30m | 128 | 0.003 | [-0.106, 0.109] | 0.111 | [-0.027, 0.249] |
| 1d SMA 40: precio alineado con la señal | Bajista | 30m | 81 | -0.000 | [-0.169, 0.165] | 0.096 | [-0.136, 0.322] |
| 1d SMA 40: precio contrario a la señal | Bajista | 30m | 127 | 0.000 | [-0.102, 0.110] | 0.104 | [-0.042, 0.252] |
| 1d SMA 40: pendiente alineada con la señal | Bajista | 30m | 78 | -0.109 | [-0.278, 0.062] | -0.013 | [-0.236, 0.207] |
| 1d SMA 40: pendiente contraria a la señal | Bajista | 30m | 130 | 0.065 | [-0.037, 0.172] | 0.170 | [0.028, 0.317] |
| 1d SMA 100: precio alineado con la señal | Bajista | 30m | 54 | 0.001 | [-0.224, 0.223] | 0.055 | [-0.240, 0.345] |
| 1d SMA 100: precio contrario a la señal | Bajista | 30m | 133 | -0.001 | [-0.089, 0.090] | 0.060 | [-0.084, 0.202] |
| 1d SMA 100: pendiente alineada con la señal | Bajista | 30m | 54 | 0.051 | [-0.184, 0.290] | 0.108 | [-0.207, 0.407] |
| 1d SMA 100: pendiente contraria a la señal | Bajista | 30m | 133 | -0.021 | [-0.113, 0.076] | 0.038 | [-0.096, 0.174] |
| 1d SMA 200: precio alineado con la señal | Bajista | 30m | 33 | 0.021 | [-0.323, 0.339] | 0.091 | [-0.307, 0.468] |
| 1d SMA 200: precio contrario a la señal | Bajista | 30m | 127 | -0.005 | [-0.085, 0.081] | 0.064 | [-0.072, 0.204] |
| 1d SMA 200: pendiente alineada con la señal | Bajista | 30m | 36 | 0.008 | [-0.306, 0.297] | 0.081 | [-0.291, 0.416] |
| 1d SMA 200: pendiente contraria a la señal | Bajista | 30m | 124 | -0.002 | [-0.083, 0.089] | 0.067 | [-0.075, 0.211] |
| 1h: precio encima de las cuatro SMA | Bajista | 30m | 67 | 0.011 | [-0.152, 0.190] | 0.123 | [-0.077, 0.309] |
| 1h: precio debajo de las cuatro SMA | Bajista | 30m | 47 | -0.114 | [-0.377, 0.159] | -0.002 | [-0.334, 0.304] |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 30m | 55 | -0.084 | [-0.264, 0.100] | 0.029 | [-0.158, 0.217] |
| 1d: precio encima de las cuatro SMA | Bajista | 30m | 86 | -0.057 | [-0.181, 0.077] | 0.015 | [-0.146, 0.179] |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 30m | 93 | -0.011 | [-0.133, 0.117] | 0.059 | [-0.086, 0.209] |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Bajista | 30m | 56 | -0.044 | [-0.233, 0.150] | 0.027 | [-0.231, 0.275] |
| 1h SMA 20: precio alineado con la señal | Bajista | 60m | 91 | 0.015 | [-0.189, 0.214] | 0.115 | [-0.176, 0.400] |
| 1h SMA 20: precio contrario a la señal | Bajista | 60m | 104 | -0.013 | [-0.187, 0.165] | 0.089 | [-0.137, 0.323] |
| 1h SMA 20: pendiente alineada con la señal | Bajista | 60m | 94 | 0.046 | [-0.146, 0.232] | 0.145 | [-0.165, 0.456] |
| 1h SMA 20: pendiente contraria a la señal | Bajista | 60m | 101 | -0.043 | [-0.218, 0.139] | 0.061 | [-0.147, 0.288] |
| 1h SMA 40: precio alineado con la señal | Bajista | 60m | 89 | 0.100 | [-0.117, 0.310] | 0.200 | [-0.121, 0.528] |
| 1h SMA 40: precio contrario a la señal | Bajista | 60m | 106 | -0.084 | [-0.252, 0.096] | 0.019 | [-0.195, 0.229] |
| 1h SMA 40: pendiente alineada con la señal | Bajista | 60m | 86 | 0.151 | [-0.071, 0.373] | 0.254 | [-0.067, 0.558] |
| 1h SMA 40: pendiente contraria a la señal | Bajista | 60m | 109 | -0.119 | [-0.294, 0.055] | -0.019 | [-0.229, 0.185] |
| 1h SMA 100: precio alineado con la señal | Bajista | 60m | 80 | 0.156 | [-0.066, 0.405] | 0.271 | [-0.044, 0.586] |
| 1h SMA 100: precio contrario a la señal | Bajista | 60m | 113 | -0.110 | [-0.279, 0.050] | 0.009 | [-0.209, 0.238] |
| 1h SMA 100: pendiente alineada con la señal | Bajista | 60m | 84 | -0.000 | [-0.208, 0.219] | 0.117 | [-0.191, 0.405] |
| 1h SMA 100: pendiente contraria a la señal | Bajista | 60m | 109 | 0.000 | [-0.171, 0.155] | 0.118 | [-0.134, 0.363] |
| 1h SMA 200: precio alineado con la señal | Bajista | 60m | 77 | 0.032 | [-0.217, 0.288] | 0.154 | [-0.163, 0.512] |
| 1h SMA 200: precio contrario a la señal | Bajista | 60m | 112 | -0.022 | [-0.202, 0.149] | 0.107 | [-0.109, 0.325] |
| 1h SMA 200: pendiente alineada con la señal | Bajista | 60m | 77 | -0.013 | [-0.250, 0.226] | 0.107 | [-0.231, 0.453] |
| 1h SMA 200: pendiente contraria a la señal | Bajista | 60m | 112 | 0.009 | [-0.156, 0.177] | 0.139 | [-0.088, 0.353] |
| 1d SMA 20: precio alineado con la señal | Bajista | 60m | 80 | 0.001 | [-0.232, 0.228] | 0.126 | [-0.205, 0.446] |
| 1d SMA 20: precio contrario a la señal | Bajista | 60m | 112 | -0.001 | [-0.160, 0.169] | 0.127 | [-0.101, 0.352] |
| 1d SMA 20: pendiente alineada con la señal | Bajista | 60m | 79 | -0.002 | [-0.238, 0.232] | 0.120 | [-0.188, 0.451] |
| 1d SMA 20: pendiente contraria a la señal | Bajista | 60m | 112 | 0.001 | [-0.165, 0.166] | 0.125 | [-0.090, 0.345] |
| 1d SMA 40: precio alineado con la señal | Bajista | 60m | 72 | 0.051 | [-0.195, 0.291] | 0.146 | [-0.204, 0.494] |
| 1d SMA 40: precio contrario a la señal | Bajista | 60m | 113 | -0.032 | [-0.186, 0.126] | 0.070 | [-0.147, 0.289] |
| 1d SMA 40: pendiente alineada con la señal | Bajista | 60m | 71 | -0.175 | [-0.429, 0.072] | -0.081 | [-0.421, 0.270] |
| 1d SMA 40: pendiente contraria a la señal | Bajista | 60m | 114 | 0.109 | [-0.041, 0.278] | 0.212 | [-0.004, 0.427] |
| 1d SMA 100: precio alineado con la señal | Bajista | 60m | 52 | -0.050 | [-0.366, 0.269] | -0.021 | [-0.430, 0.393] |
| 1d SMA 100: precio contrario a la señal | Bajista | 60m | 115 | 0.023 | [-0.124, 0.167] | 0.064 | [-0.145, 0.267] |
| 1d SMA 100: pendiente alineada con la señal | Bajista | 60m | 52 | -0.057 | [-0.388, 0.261] | -0.027 | [-0.444, 0.381] |
| 1d SMA 100: pendiente contraria a la señal | Bajista | 60m | 115 | 0.026 | [-0.121, 0.174] | 0.067 | [-0.134, 0.270] |
| 1d SMA 200: precio alineado con la señal | Bajista | 60m | 31 | 0.001 | [-0.449, 0.424] | 0.085 | [-0.426, 0.567] |
| 1d SMA 200: precio contrario a la señal | Bajista | 60m | 110 | -0.000 | [-0.115, 0.124] | 0.094 | [-0.112, 0.320] |
| 1d SMA 200: pendiente alineada con la señal | Bajista | 60m | 33 | -0.040 | [-0.467, 0.345] | 0.048 | [-0.453, 0.512] |
| 1d SMA 200: pendiente contraria a la señal | Bajista | 60m | 108 | 0.012 | [-0.105, 0.136] | 0.106 | [-0.113, 0.327] |
| 1h: precio encima de las cuatro SMA | Bajista | 60m | 60 | -0.068 | [-0.320, 0.176] | 0.063 | [-0.195, 0.303] |
| 1h: precio debajo de las cuatro SMA | Bajista | 60m | 44 | 0.048 | [-0.390, 0.474] | 0.174 | [-0.312, 0.652] |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 60m | 47 | -0.146 | [-0.411, 0.118] | -0.015 | [-0.283, 0.245] |
| 1d: precio encima de las cuatro SMA | Bajista | 60m | 75 | -0.185 | [-0.367, 0.000] | -0.089 | [-0.301, 0.141] |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 60m | 79 | 0.007 | [-0.174, 0.181] | 0.105 | [-0.124, 0.334] |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Bajista | 60m | 51 | -0.138 | [-0.380, 0.108] | -0.040 | [-0.315, 0.241] |


## Último 30%: SMA individuales

Cada celda muestra: resultados evaluables; frecuencia favorable; movimiento medio firmado; movimiento favorable medio; movimiento desfavorable medio.

| TF | SMA | Dirección | Horizonte | Precio alineado n; fav.; media; fav. media; desfav. media | Precio contrario | Pendiente alineada | Pendiente contraria |
|---|---:|---|---:|---|---|---|---|
| 1h | 20 | Alcista | 15m | 74; 52.7%; -0.016%; +0.364%; -0.439% | 35; 48.6%; -0.057%; +0.329%; -0.421% | 71; 53.5%; -0.022%; +0.351%; -0.451% | 38; 47.4%; -0.043%; +0.358%; -0.404% |
| 1h | 20 | Alcista | 30m | 73; 49.3%; -0.021%; +0.450%; -0.478% | 35; 51.4%; -0.025%; +0.398%; -0.502% | 71; 49.3%; -0.022%; +0.454%; -0.484% | 37; 51.4%; -0.023%; +0.393%; -0.489% |
| 1h | 20 | Alcista | 60m | 71; 52.1%; 0.038%; +0.627%; -0.603% | 33; 39.4%; -0.098%; +0.775%; -0.665% | 70; 50.0%; 0.018%; +0.621%; -0.586% | 34; 44.1%; -0.053%; +0.769%; -0.701% |
| 1h | 20 | Bajista | 15m | 45; 53.3%; 0.057%; +0.385%; -0.318% | 61; 42.6%; -0.036%; +0.398%; -0.358% | 44; 43.2%; -0.015%; +0.389%; -0.321% | 62; 50.0%; 0.017%; +0.394%; -0.360% |
| 1h | 20 | Bajista | 30m | 42; 57.1%; 0.093%; +0.557%; -0.526% | 57; 45.6%; -0.086%; +0.349%; -0.451% | 42; 52.4%; 0.064%; +0.488%; -0.403% | 57; 49.1%; -0.065%; +0.418%; -0.531% |
| 1h | 20 | Bajista | 60m | 34; 41.2%; 0.035%; +0.818%; -0.540% | 51; 52.9%; -0.045%; +0.601%; -0.772% | 35; 37.1%; -0.016%; +0.713%; -0.468% | 50; 56.0%; -0.011%; +0.658%; -0.861% |
| 1h | 40 | Alcista | 15m | 76; 50.0%; -0.047%; +0.320%; -0.415% | 33; 54.5%; 0.013%; +0.424%; -0.480% | 71; 52.1%; -0.060%; +0.302%; -0.454% | 38; 50.0%; 0.029%; +0.454%; -0.396% |
| 1h | 40 | Alcista | 30m | 76; 48.7%; -0.027%; +0.444%; -0.473% | 32; 53.1%; -0.011%; +0.408%; -0.520% | 71; 49.3%; -0.026%; +0.424%; -0.464% | 37; 51.4%; -0.014%; +0.448%; -0.531% |
| 1h | 40 | Alcista | 60m | 73; 49.3%; -0.008%; +0.593%; -0.593% | 31; 45.2%; 0.002%; +0.853%; -0.699% | 67; 47.8%; -0.024%; +0.603%; -0.597% | 37; 48.6%; 0.028%; +0.776%; -0.680% |
| 1h | 40 | Bajista | 15m | 48; 45.8%; -0.051%; +0.344%; -0.386% | 58; 48.3%; 0.049%; +0.430%; -0.306% | 45; 48.9%; -0.056%; +0.309%; -0.405% | 61; 45.9%; 0.048%; +0.457%; -0.300% |
| 1h | 40 | Bajista | 30m | 45; 53.3%; -0.023%; +0.460%; -0.575% | 54; 48.1%; 0.001%; +0.439%; -0.406% | 42; 50.0%; -0.017%; +0.454%; -0.488% | 57; 50.9%; -0.005%; +0.445%; -0.472% |
| 1h | 40 | Bajista | 60m | 37; 43.2%; -0.075%; +0.617%; -0.633% | 48; 52.1%; 0.035%; +0.713%; -0.701% | 35; 51.4%; 0.063%; +0.718%; -0.670% | 50; 46.0%; -0.066%; +0.642%; -0.669% |
| 1h | 100 | Alcista | 15m | 72; 55.6%; 0.005%; +0.356%; -0.434% | 37; 43.2%; -0.094%; +0.348%; -0.431% | 68; 55.9%; 0.025%; +0.346%; -0.382% | 41; 43.9%; -0.119%; +0.369%; -0.500% |
| 1h | 100 | Alcista | 30m | 72; 50.0%; 0.051%; +0.511%; -0.408% | 36; 50.0%; -0.169%; +0.275%; -0.649% | 67; 50.7%; 0.059%; +0.479%; -0.374% | 41; 48.8%; -0.155%; +0.353%; -0.670% |
| 1h | 100 | Alcista | 60m | 69; 52.2%; 0.078%; +0.652%; -0.549% | 35; 40.0%; -0.169%; +0.700%; -0.747% | 65; 47.7%; 0.030%; +0.662%; -0.546% | 39; 48.7%; -0.064%; +0.672%; -0.762% |
| 1h | 100 | Bajista | 15m | 43; 44.2%; -0.102%; +0.298%; -0.418% | 63; 49.2%; 0.076%; +0.450%; -0.286% | 41; 43.9%; -0.038%; +0.336%; -0.330% | 65; 49.2%; 0.030%; +0.424%; -0.352% |
| 1h | 100 | Bajista | 30m | 39; 53.8%; -0.028%; +0.417%; -0.546% | 60; 48.3%; 0.001%; +0.472%; -0.440% | 38; 50.0%; 0.001%; +0.413%; -0.412% | 61; 50.8%; -0.017%; +0.471%; -0.521% |
| 1h | 100 | Bajista | 60m | 33; 45.5%; -0.013%; +0.731%; -0.671% | 52; 50.0%; -0.013%; +0.643%; -0.668% | 33; 54.5%; 0.049%; +0.611%; -0.668% | 52; 44.2%; -0.052%; +0.726%; -0.670% |
| 1h | 200 | Alcista | 15m | 75; 57.3%; -0.006%; +0.322%; -0.448% | 34; 38.2%; -0.079%; +0.457%; -0.410% | 75; 53.3%; -0.020%; +0.344%; -0.437% | 34; 47.1%; -0.049%; +0.376%; -0.426% |
| 1h | 200 | Alcista | 30m | 75; 49.3%; 0.008%; +0.431%; -0.403% | 33; 51.5%; -0.091%; +0.437%; -0.695% | 75; 48.0%; -0.004%; +0.440%; -0.413% | 33; 54.5%; -0.064%; +0.418%; -0.688% |
| 1h | 200 | Alcista | 60m | 72; 50.0%; 0.036%; +0.624%; -0.552% | 32; 43.8%; -0.098%; +0.772%; -0.774% | 73; 46.6%; -0.001%; +0.628%; -0.549% | 31; 51.6%; -0.015%; +0.746%; -0.826% |
| 1h | 200 | Bajista | 15m | 34; 44.1%; -0.119%; +0.325%; -0.468% | 72; 48.6%; 0.061%; +0.421%; -0.278% | 35; 54.3%; -0.001%; +0.351%; -0.419% | 71; 43.7%; 0.006%; +0.417%; -0.312% |
| 1h | 200 | Bajista | 30m | 32; 50.0%; -0.028%; +0.467%; -0.522% | 67; 50.7%; -0.002%; +0.440%; -0.458% | 32; 59.4%; -0.004%; +0.432%; -0.639% | 67; 46.3%; -0.014%; +0.459%; -0.421% |
| 1h | 200 | Bajista | 60m | 28; 53.6%; 0.021%; +0.702%; -0.828% | 57; 45.6%; -0.030%; +0.660%; -0.608% | 28; 60.7%; 0.116%; +0.661%; -0.799% | 57; 42.1%; -0.076%; +0.686%; -0.630% |
| 1d | 20 | Alcista | 15m | 72; 55.6%; 0.019%; +0.342%; -0.385% | 37; 43.2%; -0.121%; +0.383%; -0.506% | 75; 52.0%; -0.010%; +0.322%; -0.370% | 34; 50.0%; -0.070%; +0.425%; -0.566% |
| 1d | 20 | Alcista | 30m | 72; 50.0%; 0.050%; +0.495%; -0.395% | 36; 50.0%; -0.167%; +0.307%; -0.678% | 75; 46.7%; -0.018%; +0.441%; -0.419% | 33; 57.6%; -0.031%; +0.418%; -0.690% |
| 1d | 20 | Alcista | 60m | 70; 50.0%; 0.056%; +0.664%; -0.551% | 34; 44.1%; -0.131%; +0.670%; -0.764% | 72; 47.2%; -0.043%; +0.585%; -0.605% | 32; 50.0%; 0.080%; +0.837%; -0.677% |
| 1d | 20 | Bajista | 15m | 35; 42.9%; -0.095%; +0.362%; -0.438% | 71; 49.3%; 0.053%; +0.405%; -0.290% | 33; 42.4%; -0.008%; +0.394%; -0.304% | 73; 49.3%; 0.009%; +0.391%; -0.363% |
| 1d | 20 | Bajista | 30m | 33; 48.5%; -0.048%; +0.444%; -0.512% | 66; 51.5%; 0.009%; +0.451%; -0.461% | 30; 50.0%; 0.001%; +0.403%; -0.402% | 69; 50.7%; -0.015%; +0.469%; -0.513% |
| 1d | 20 | Bajista | 60m | 30; 50.0%; -0.011%; +0.659%; -0.730% | 55; 47.3%; -0.014%; +0.685%; -0.640% | 26; 61.5%; 0.172%; +0.607%; -0.582% | 59; 42.4%; -0.094%; +0.719%; -0.692% |
| 1d | 40 | Alcista | 15m | 76; 56.6%; 0.018%; +0.336%; -0.395% | 33; 39.4%; -0.138%; +0.413%; -0.496% | 79; 58.2%; 0.024%; +0.334%; -0.408% | 30; 33.3%; -0.168%; +0.444%; -0.475% |
| 1d | 40 | Alcista | 30m | 76; 50.0%; 0.012%; +0.428%; -0.403% | 32; 50.0%; -0.104%; +0.444%; -0.694% | 79; 49.4%; 0.006%; +0.458%; -0.435% | 29; 51.7%; -0.097%; +0.366%; -0.639% |
| 1d | 40 | Alcista | 60m | 74; 47.3%; 0.010%; +0.614%; -0.532% | 30; 50.0%; -0.042%; +0.786%; -0.870% | 78; 48.7%; -0.026%; +0.591%; -0.612% | 26; 46.2%; 0.056%; +0.901%; -0.668% |
| 1d | 40 | Bajista | 15m | 31; 45.2%; -0.077%; +0.390%; -0.462% | 75; 48.0%; 0.037%; +0.393%; -0.291% | 31; 35.5%; -0.121%; +0.406%; -0.412% | 75; 52.0%; 0.055%; +0.388%; -0.305% |
| 1d | 40 | Bajista | 30m | 29; 51.7%; -0.078%; +0.500%; -0.698% | 70; 50.0%; 0.018%; +0.427%; -0.391% | 29; 37.9%; -0.128%; +0.604%; -0.575% | 70; 55.7%; 0.038%; +0.405%; -0.423% |
| 1d | 40 | Bajista | 60m | 26; 57.7%; 0.056%; +0.704%; -0.910% | 59; 44.1%; -0.043%; +0.659%; -0.596% | 26; 61.5%; 0.001%; +0.691%; -1.105% | 59; 42.4%; -0.019%; +0.665%; -0.537% |
| 1d | 100 | Alcista | 15m | 87; 56.3%; 0.033%; +0.365%; -0.394% | 22; 31.8%; -0.276%; +0.271%; -0.531% | 89; 52.8%; -0.014%; +0.348%; -0.419% | 20; 45.0%; -0.096%; +0.384%; -0.488% |
| 1d | 100 | Alcista | 30m | 87; 49.4%; 0.021%; +0.486%; -0.434% | 21; 52.4%; -0.199%; +0.224%; -0.737% | 88; 45.5%; -0.060%; +0.445%; -0.480% | 20; 70.0%; 0.145%; +0.397%; -0.533% |
| 1d | 100 | Alcista | 60m | 85; 49.4%; 0.017%; +0.642%; -0.594% | 19; 42.1%; -0.104%; +0.790%; -0.753% | 86; 45.3%; -0.093%; +0.582%; -0.653% | 18; 61.1%; 0.414%; +0.960%; -0.445% |
| 1d | 100 | Bajista | 15m | 21; 47.6%; -0.014%; +0.421%; -0.410% | 85; 47.1%; 0.008%; +0.385%; -0.326% | 14; 50.0%; -0.080%; +0.376%; -0.536% | 92; 46.7%; 0.016%; +0.395%; -0.315% |
| 1d | 100 | Bajista | 30m | 19; 36.8%; -0.039%; +0.694%; -0.466% | 80; 53.8%; -0.004%; +0.409%; -0.483% | 12; 41.7%; -0.029%; +0.682%; -0.538% | 87; 51.7%; -0.008%; +0.423%; -0.469% |
| 1d | 100 | Bajista | 60m | 18; 61.1%; 0.065%; +0.647%; -0.850% | 67; 44.8%; -0.034%; +0.686%; -0.634% | 11; 45.5%; 0.048%; +1.059%; -0.794% | 74; 48.6%; -0.022%; +0.622%; -0.649% |
| 1d | 200 | Alcista | 15m | 103; 52.4%; -0.019%; +0.363%; -0.439% | 6; 33.3%; -0.205%; +0.093%; -0.354% | 104; 51.9%; -0.024%; +0.363%; -0.442% | 5; 40.0%; -0.130%; +0.093%; -0.278% |
| 1d | 200 | Alcista | 30m | 102; 48.0%; -0.032%; +0.449%; -0.487% | 6; 83.3%; 0.157%; +0.272%; -0.419% | 103; 48.5%; -0.031%; +0.441%; -0.487% | 5; 80.0%; 0.174%; +0.322%; -0.419% |
| 1d | 200 | Alcista | 60m | 98; 48.0%; -0.023%; +0.655%; -0.647% | 6; 50.0%; 0.280%; +0.825%; -0.265% | 99; 48.5%; -0.015%; +0.657%; -0.647% | 5; 40.0%; 0.185%; +0.861%; -0.265% |
| 1d | 200 | Bajista | 15m | 7; 85.7%; 0.201%; +0.430%; -1.174% | 99; 44.4%; -0.010%; +0.387%; -0.328% | 5; 100.0%; 0.481%; +0.481%; — | 101; 44.6%; -0.020%; +0.382%; -0.343% |
| 1d | 200 | Bajista | 30m | 6; 50.0%; 0.181%; +0.867%; -0.505% | 93; 50.5%; -0.023%; +0.422%; -0.477% | 4; 50.0%; 0.487%; +1.092%; -0.119% | 95; 50.5%; -0.031%; +0.422%; -0.494% |
| 1d | 200 | Bajista | 60m | 5; 60.0%; 0.132%; +1.126%; -1.359% | 80; 47.5%; -0.022%; +0.640%; -0.636% | 3; 66.7%; 0.671%; +1.113%; -0.213% | 82; 47.6%; -0.038%; +0.653%; -0.680% |


Igualdades y pendientes planas (suma de ambas direcciones):

| TF | SMA | Precio exactamente igual | Pendiente plana |
|---|---:|---:|---:|
| 1h | 20 | 0 | 0 |
| 1h | 40 | 0 | 0 |
| 1h | 100 | 0 | 0 |
| 1h | 200 | 0 | 0 |
| 1d | 20 | 0 | 0 |
| 1d | 40 | 0 | 0 |
| 1d | 100 | 0 | 0 |
| 1d | 200 | 0 | 0 |


## Último 30%: condiciones conjuntas

| Condición | Dirección | Horizonte | Disponibles | Seleccionadas | Evaluables | Sesiones | Favorables | Media % | Fav. media % | Desfav. media % | Δ vs Bollinger comparable % | IC 95% Δ % | Muestra |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 1h: precio encima de las cuatro SMA | Alcista | 15m | 121 | 58 | 53 | 49 | 58.5% | -0.021 | 0.309 | -0.487 | 0.008 | [-0.104, 0.115] | ≥30 señales y ≥10 sesiones |
| 1h: precio debajo de las cuatro SMA | Alcista | 15m | 121 | 19 | 17 | 17 | 47.1% | -0.050 | 0.432 | -0.478 | -0.021 | — | Pequeña |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 15m | 121 | 39 | 37 | 34 | 62.2% | 0.014 | 0.271 | -0.409 | 0.043 | [-0.092, 0.174] | ≥30 señales y ≥10 sesiones |
| 1h: orden SMA20 < SMA40 < SMA100 < SMA200 | Alcista | 15m | 121 | 16 | 15 | 15 | 33.3% | -0.323 | 0.286 | -0.628 | -0.294 | — | Pequeña |
| 1d: precio encima de las cuatro SMA | Alcista | 15m | 121 | 68 | 63 | 59 | 55.6% | 0.007 | 0.341 | -0.411 | 0.036 | [-0.046, 0.128] | ≥30 señales y ≥10 sesiones |
| 1d: precio debajo de las cuatro SMA | Alcista | 15m | 121 | 5 | 2 | 2 | 0.0% | -0.431 | — | -0.431 | -0.402 | — | Pequeña |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 15m | 121 | 48 | 44 | 41 | 47.7% | -0.093 | 0.335 | -0.483 | -0.064 | [-0.188, 0.061] | ≥30 señales y ≥10 sesiones |
| 1d: orden SMA20 < SMA40 < SMA100 < SMA200 | Alcista | 15m | 121 | 6 | 4 | 4 | 50.0% | -0.092 | 0.093 | -0.277 | -0.063 | — | Pequeña |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Alcista | 15m | 121 | 52 | 46 | 42 | 58.7% | 0.007 | 0.312 | -0.426 | 0.036 | [-0.080, 0.153] | ≥30 señales y ≥10 sesiones |
| 1h y 1d se contradicen en contexto de precio sobre/bajo las cuatro SMA | Alcista | 15m | 121 | 0 | 0 | 0 | — | — | — | — | — | — | Pequeña |
| 1h: precio encima de las cuatro SMA | Alcista | 30m | 121 | 58 | 53 | 49 | 49.1% | -0.021 | 0.418 | -0.443 | 0.001 | [-0.122, 0.121] | ≥30 señales y ≥10 sesiones |
| 1h: precio debajo de las cuatro SMA | Alcista | 30m | 121 | 19 | 17 | 17 | 58.8% | -0.066 | 0.369 | -0.804 | -0.045 | — | Pequeña |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 30m | 121 | 39 | 37 | 34 | 48.6% | 0.028 | 0.448 | -0.369 | 0.050 | [-0.111, 0.216] | ≥30 señales y ≥10 sesiones |
| 1h: orden SMA20 < SMA40 < SMA100 < SMA200 | Alcista | 30m | 121 | 16 | 14 | 14 | 50.0% | -0.181 | 0.293 | -0.655 | -0.159 | — | Pequeña |
| 1d: precio encima de las cuatro SMA | Alcista | 30m | 121 | 68 | 63 | 59 | 47.6% | 0.009 | 0.464 | -0.404 | 0.031 | [-0.070, 0.133] | ≥30 señales y ≥10 sesiones |
| 1d: precio debajo de las cuatro SMA | Alcista | 30m | 121 | 5 | 2 | 2 | 100.0% | 0.056 | 0.056 | — | 0.078 | — | Pequeña |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 30m | 121 | 48 | 44 | 41 | 36.4% | -0.131 | 0.421 | -0.447 | -0.109 | [-0.243, 0.025] | ≥30 señales y ≥10 sesiones |
| 1d: orden SMA20 < SMA40 < SMA100 < SMA200 | Alcista | 30m | 121 | 6 | 4 | 4 | 75.0% | 0.207 | 0.416 | -0.419 | 0.229 | — | Pequeña |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Alcista | 30m | 121 | 52 | 46 | 42 | 47.8% | -0.010 | 0.446 | -0.428 | 0.012 | [-0.123, 0.146] | ≥30 señales y ≥10 sesiones |
| 1h y 1d se contradicen en contexto de precio sobre/bajo las cuatro SMA | Alcista | 30m | 121 | 0 | 0 | 0 | — | — | — | — | — | — | Pequeña |
| 1h: precio encima de las cuatro SMA | Alcista | 60m | 121 | 58 | 51 | 48 | 52.9% | 0.018 | 0.561 | -0.592 | 0.024 | [-0.138, 0.184] | ≥30 señales y ≥10 sesiones |
| 1h: precio debajo de las cuatro SMA | Alcista | 60m | 121 | 19 | 16 | 16 | 43.8% | -0.128 | 0.810 | -0.858 | -0.123 | — | Pequeña |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 60m | 121 | 39 | 36 | 34 | 52.8% | 0.022 | 0.556 | -0.575 | 0.027 | [-0.194, 0.243] | ≥30 señales y ≥10 sesiones |
| 1h: orden SMA20 < SMA40 < SMA100 < SMA200 | Alcista | 60m | 121 | 16 | 12 | 12 | 66.7% | 0.167 | 0.622 | -0.742 | 0.172 | — | Pequeña |
| 1d: precio encima de las cuatro SMA | Alcista | 60m | 121 | 68 | 61 | 58 | 49.2% | 0.009 | 0.620 | -0.582 | 0.014 | [-0.118, 0.160] | ≥30 señales y ≥10 sesiones |
| 1d: precio debajo de las cuatro SMA | Alcista | 60m | 121 | 5 | 2 | 2 | 100.0% | 0.614 | 0.614 | — | 0.619 | — | Pequeña |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 60m | 121 | 48 | 44 | 41 | 38.6% | -0.167 | 0.531 | -0.607 | -0.162 | [-0.341, 0.018] | ≥30 señales y ≥10 sesiones |
| 1d: orden SMA20 < SMA40 < SMA100 < SMA200 | Alcista | 60m | 121 | 6 | 4 | 4 | 25.0% | 0.113 | 1.247 | -0.265 | 0.118 | — | Pequeña |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Alcista | 60m | 121 | 52 | 45 | 42 | 53.3% | 0.010 | 0.577 | -0.639 | 0.015 | [-0.162, 0.195] | ≥30 señales y ≥10 sesiones |
| 1h y 1d se contradicen en contexto de precio sobre/bajo las cuatro SMA | Alcista | 60m | 121 | 0 | 0 | 0 | — | — | — | — | — | — | Pequeña |
| 1h: precio encima de las cuatro SMA | Bajista | 15m | 121 | 45 | 40 | 39 | 45.0% | 0.058 | 0.466 | -0.276 | 0.054 | [-0.071, 0.189] | ≥30 señales y ≥10 sesiones |
| 1h: precio debajo de las cuatro SMA | Bajista | 15m | 121 | 19 | 15 | 15 | 53.3% | 0.029 | 0.379 | -0.371 | 0.025 | — | Pequeña |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 15m | 121 | 37 | 33 | 32 | 48.5% | 0.050 | 0.385 | -0.266 | 0.046 | [-0.088, 0.186] | ≥30 señales y ≥10 sesiones |
| 1h: orden SMA20 < SMA40 < SMA100 < SMA200 | Bajista | 15m | 121 | 12 | 10 | 10 | 40.0% | -0.175 | 0.161 | -0.399 | -0.179 | — | Pequeña |
| 1d: precio encima de las cuatro SMA | Bajista | 15m | 121 | 75 | 65 | 61 | 47.7% | 0.067 | 0.416 | -0.251 | 0.064 | [-0.016, 0.152] | ≥30 señales y ≥10 sesiones |
| 1d: precio debajo de las cuatro SMA | Bajista | 15m | 121 | 4 | 4 | 4 | 75.0% | 0.059 | 0.470 | -1.174 | 0.055 | — | Pequeña |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 15m | 121 | 56 | 50 | 46 | 50.0% | 0.058 | 0.412 | -0.296 | 0.054 | [-0.046, 0.165] | ≥30 señales y ≥10 sesiones |
| 1d: orden SMA20 < SMA40 < SMA100 < SMA200 | Bajista | 15m | 121 | 3 | 3 | 3 | 100.0% | 0.390 | 0.390 | — | 0.386 | — | Pequeña |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Bajista | 15m | 121 | 42 | 37 | 36 | 40.5% | 0.047 | 0.521 | -0.276 | 0.044 | [-0.094, 0.194] | ≥30 señales y ≥10 sesiones |
| 1h y 1d se contradicen en contexto de precio sobre/bajo las cuatro SMA | Bajista | 15m | 121 | 4 | 3 | 3 | 66.7% | -0.082 | 0.105 | -0.458 | -0.086 | — | Pequeña |
| 1h: precio encima de las cuatro SMA | Bajista | 30m | 121 | 45 | 38 | 37 | 50.0% | -0.027 | 0.336 | -0.389 | -0.016 | [-0.164, 0.145] | ≥30 señales y ≥10 sesiones |
| 1h: precio debajo de las cuatro SMA | Bajista | 30m | 121 | 19 | 14 | 14 | 64.3% | 0.174 | 0.531 | -0.470 | 0.184 | — | Pequeña |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 30m | 121 | 37 | 32 | 31 | 50.0% | -0.004 | 0.403 | -0.410 | 0.006 | [-0.178, 0.202] | ≥30 señales y ≥10 sesiones |
| 1h: orden SMA20 < SMA40 < SMA100 < SMA200 | Bajista | 30m | 121 | 12 | 10 | 10 | 50.0% | -0.123 | 0.328 | -0.574 | -0.113 | — | Pequeña |
| 1d: precio encima de las cuatro SMA | Bajista | 30m | 121 | 75 | 61 | 59 | 52.5% | 0.049 | 0.445 | -0.388 | 0.059 | [-0.050, 0.184] | ≥30 señales y ≥10 sesiones |
| 1d: precio debajo de las cuatro SMA | Bajista | 30m | 121 | 4 | 4 | 4 | 50.0% | 0.178 | 1.051 | -0.695 | 0.188 | — | Pequeña |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 30m | 121 | 56 | 46 | 44 | 50.0% | 0.041 | 0.475 | -0.392 | 0.052 | [-0.089, 0.202] | ≥30 señales y ≥10 sesiones |
| 1d: orden SMA20 < SMA40 < SMA100 < SMA200 | Bajista | 30m | 121 | 3 | 2 | 2 | 50.0% | 0.188 | 0.501 | -0.125 | 0.198 | — | Pequeña |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Bajista | 30m | 121 | 42 | 36 | 35 | 50.0% | -0.004 | 0.395 | -0.404 | 0.006 | [-0.155, 0.178] | ≥30 señales y ≥10 sesiones |
| 1h y 1d se contradicen en contexto de precio sobre/bajo las cuatro SMA | Bajista | 30m | 121 | 4 | 2 | 2 | 50.0% | -0.056 | 0.323 | -0.436 | -0.046 | — | Pequeña |
| 1h: precio encima de las cuatro SMA | Bajista | 60m | 121 | 45 | 35 | 34 | 57.1% | 0.038 | 0.603 | -0.714 | 0.051 | [-0.162, 0.290] | ≥30 señales y ≥10 sesiones |
| 1h: precio debajo de las cuatro SMA | Bajista | 60m | 121 | 19 | 12 | 12 | 58.3% | 0.289 | 0.838 | -0.600 | 0.302 | — | Pequeña |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 60m | 121 | 37 | 29 | 28 | 37.9% | -0.028 | 0.808 | -0.539 | -0.015 | — | Pequeña |
| 1h: orden SMA20 < SMA40 < SMA100 < SMA200 | Bajista | 60m | 121 | 12 | 9 | 9 | 55.6% | -0.052 | 0.582 | -1.126 | -0.039 | — | Pequeña |
| 1d: precio encima de las cuatro SMA | Bajista | 60m | 121 | 75 | 51 | 50 | 47.1% | 0.015 | 0.693 | -0.588 | 0.028 | [-0.126, 0.198] | ≥30 señales y ≥10 sesiones |
| 1d: precio debajo de las cuatro SMA | Bajista | 60m | 121 | 4 | 3 | 3 | 66.7% | 0.143 | 1.467 | -2.505 | 0.156 | — | Pequeña |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 60m | 121 | 56 | 38 | 38 | 42.1% | -0.014 | 0.716 | -0.570 | -0.001 | [-0.200, 0.210] | ≥30 señales y ≥10 sesiones |
| 1d: orden SMA20 < SMA40 < SMA100 < SMA200 | Bajista | 60m | 121 | 3 | 2 | 2 | 50.0% | 0.116 | 0.444 | -0.213 | 0.128 | — | Pequeña |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Bajista | 60m | 121 | 42 | 33 | 32 | 57.6% | 0.085 | 0.700 | -0.750 | 0.098 | [-0.135, 0.345] | ≥30 señales y ≥10 sesiones |
| 1h y 1d se contradicen en contexto de precio sobre/bajo las cuatro SMA | Bajista | 60m | 121 | 4 | 1 | 1 | 0.0% | -1.020 | — | -1.020 | -1.007 | — | Pequeña |


## Último 30%: intervalos disponibles

| Condición | Dirección | Horizonte | n | Δ media vs Bollinger comparable % | IC 95% por sesiones % | Δ vs control horario % | IC 95% vs control % |
|---|---|---:|---:|---:|---|---:|---|
| 1h SMA 20: precio alineado con la señal | Alcista | 15m | 74 | 0.013 | [-0.057, 0.082] | -0.002 | [-0.134, 0.127] |
| 1h SMA 20: precio contrario a la señal | Alcista | 15m | 35 | -0.028 | [-0.176, 0.115] | -0.046 | [-0.206, 0.108] |
| 1h SMA 20: pendiente alineada con la señal | Alcista | 15m | 71 | 0.007 | [-0.066, 0.078] | -0.008 | [-0.136, 0.120] |
| 1h SMA 20: pendiente contraria a la señal | Alcista | 15m | 38 | -0.014 | [-0.141, 0.124] | -0.031 | [-0.193, 0.133] |
| 1h SMA 40: precio alineado con la señal | Alcista | 15m | 76 | -0.018 | [-0.093, 0.054] | -0.033 | [-0.151, 0.076] |
| 1h SMA 40: precio contrario a la señal | Alcista | 15m | 33 | 0.042 | [-0.125, 0.210] | 0.023 | [-0.176, 0.223] |
| 1h SMA 40: pendiente alineada con la señal | Alcista | 15m | 71 | -0.031 | [-0.110, 0.047] | -0.047 | [-0.165, 0.076] |
| 1h SMA 40: pendiente contraria a la señal | Alcista | 15m | 38 | 0.058 | [-0.093, 0.202] | 0.041 | [-0.141, 0.215] |
| 1h SMA 100: precio alineado con la señal | Alcista | 15m | 72 | 0.034 | [-0.037, 0.108] | 0.017 | [-0.110, 0.141] |
| 1h SMA 100: precio contrario a la señal | Alcista | 15m | 37 | -0.065 | [-0.210, 0.073] | -0.082 | [-0.228, 0.069] |
| 1h SMA 100: pendiente alineada con la señal | Alcista | 15m | 68 | 0.054 | [-0.027, 0.134] | 0.037 | [-0.084, 0.149] |
| 1h SMA 100: pendiente contraria a la señal | Alcista | 15m | 41 | -0.090 | [-0.223, 0.045] | -0.104 | [-0.271, 0.067] |
| 1h SMA 200: precio alineado con la señal | Alcista | 15m | 75 | 0.023 | [-0.047, 0.094] | 0.005 | [-0.117, 0.119] |
| 1h SMA 200: precio contrario a la señal | Alcista | 15m | 34 | -0.050 | [-0.215, 0.104] | -0.064 | [-0.242, 0.116] |
| 1h SMA 200: pendiente alineada con la señal | Alcista | 15m | 75 | 0.009 | [-0.059, 0.079] | -0.007 | [-0.130, 0.115] |
| 1h SMA 200: pendiente contraria a la señal | Alcista | 15m | 34 | -0.020 | [-0.181, 0.128] | -0.036 | [-0.209, 0.140] |
| 1d SMA 20: precio alineado con la señal | Alcista | 15m | 72 | 0.047 | [-0.025, 0.123] | 0.031 | [-0.085, 0.147] |
| 1d SMA 20: precio contrario a la señal | Alcista | 15m | 37 | -0.092 | [-0.241, 0.052] | -0.108 | [-0.284, 0.066] |
| 1d SMA 20: pendiente alineada con la señal | Alcista | 15m | 75 | 0.019 | [-0.059, 0.096] | 0.003 | [-0.100, 0.102] |
| 1d SMA 20: pendiente contraria a la señal | Alcista | 15m | 34 | -0.042 | [-0.215, 0.133] | -0.059 | [-0.267, 0.159] |
| 1d SMA 40: precio alineado con la señal | Alcista | 15m | 76 | 0.047 | [-0.021, 0.125] | 0.031 | [-0.082, 0.137] |
| 1d SMA 40: precio contrario a la señal | Alcista | 15m | 33 | -0.109 | [-0.275, 0.049] | -0.124 | [-0.327, 0.071] |
| 1d SMA 40: pendiente alineada con la señal | Alcista | 15m | 79 | 0.053 | [-0.016, 0.126] | 0.037 | [-0.068, 0.137] |
| 1d SMA 40: pendiente contraria a la señal | Alcista | 15m | 30 | -0.139 | [-0.315, 0.044] | -0.157 | [-0.373, 0.074] |
| 1d SMA 100: precio alineado con la señal | Alcista | 15m | 87 | 0.062 | [0.012, 0.123] | 0.047 | [-0.052, 0.150] |
| 1d SMA 100: pendiente alineada con la señal | Alcista | 15m | 89 | 0.015 | [-0.036, 0.070] | -0.002 | [-0.110, 0.103] |
| 1d SMA 200: precio alineado con la señal | Alcista | 15m | 103 | 0.010 | [-0.002, 0.030] | -0.006 | [-0.111, 0.099] |
| 1d SMA 200: pendiente alineada con la señal | Alcista | 15m | 104 | 0.005 | [-0.004, 0.017] | -0.011 | [-0.122, 0.093] |
| 1h: precio encima de las cuatro SMA | Alcista | 15m | 53 | 0.008 | [-0.104, 0.115] | -0.007 | [-0.161, 0.129] |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 15m | 37 | 0.043 | [-0.092, 0.174] | 0.027 | [-0.129, 0.167] |
| 1d: precio encima de las cuatro SMA | Alcista | 15m | 63 | 0.036 | [-0.046, 0.128] | 0.020 | [-0.109, 0.148] |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 15m | 44 | -0.064 | [-0.188, 0.061] | -0.079 | [-0.236, 0.071] |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Alcista | 15m | 46 | 0.036 | [-0.080, 0.153] | 0.022 | [-0.126, 0.156] |
| 1h SMA 20: precio alineado con la señal | Alcista | 30m | 73 | 0.001 | [-0.075, 0.080] | -0.014 | [-0.151, 0.126] |
| 1h SMA 20: precio contrario a la señal | Alcista | 30m | 35 | -0.003 | [-0.171, 0.158] | -0.019 | [-0.205, 0.158] |
| 1h SMA 20: pendiente alineada con la señal | Alcista | 30m | 71 | 0.000 | [-0.083, 0.078] | -0.015 | [-0.153, 0.123] |
| 1h SMA 20: pendiente contraria a la señal | Alcista | 30m | 37 | -0.001 | [-0.150, 0.157] | -0.016 | [-0.198, 0.181] |
| 1h SMA 40: precio alineado con la señal | Alcista | 30m | 76 | -0.005 | [-0.081, 0.076] | -0.020 | [-0.152, 0.120] |
| 1h SMA 40: precio contrario a la señal | Alcista | 30m | 32 | 0.011 | [-0.184, 0.187] | -0.005 | [-0.225, 0.213] |
| 1h SMA 40: pendiente alineada con la señal | Alcista | 30m | 71 | -0.004 | [-0.090, 0.086] | -0.020 | [-0.149, 0.109] |
| 1h SMA 40: pendiente contraria a la señal | Alcista | 30m | 37 | 0.008 | [-0.161, 0.180] | -0.007 | [-0.213, 0.202] |
| 1h SMA 100: precio alineado con la señal | Alcista | 30m | 72 | 0.073 | [-0.004, 0.163] | 0.058 | [-0.077, 0.200] |
| 1h SMA 100: precio contrario a la señal | Alcista | 30m | 36 | -0.147 | [-0.314, 0.006] | -0.163 | [-0.350, 0.012] |
| 1h SMA 100: pendiente alineada con la señal | Alcista | 30m | 67 | 0.081 | [-0.010, 0.173] | 0.065 | [-0.074, 0.204] |
| 1h SMA 100: pendiente contraria a la señal | Alcista | 30m | 41 | -0.133 | [-0.277, 0.018] | -0.147 | [-0.332, 0.030] |
| 1h SMA 200: precio alineado con la señal | Alcista | 30m | 75 | 0.030 | [-0.054, 0.115] | 0.014 | [-0.113, 0.142] |
| 1h SMA 200: precio contrario a la señal | Alcista | 30m | 33 | -0.069 | [-0.263, 0.120] | -0.083 | [-0.324, 0.167] |
| 1h SMA 200: pendiente alineada con la señal | Alcista | 30m | 75 | 0.018 | [-0.066, 0.103] | 0.003 | [-0.117, 0.131] |
| 1h SMA 200: pendiente contraria a la señal | Alcista | 30m | 33 | -0.042 | [-0.235, 0.148] | -0.057 | [-0.293, 0.174] |
| 1d SMA 20: precio alineado con la señal | Alcista | 30m | 72 | 0.072 | [-0.004, 0.155] | 0.056 | [-0.082, 0.193] |
| 1d SMA 20: precio contrario a la señal | Alcista | 30m | 36 | -0.145 | [-0.303, 0.009] | -0.159 | [-0.347, 0.025] |
| 1d SMA 20: pendiente alineada con la señal | Alcista | 30m | 75 | 0.004 | [-0.072, 0.088] | -0.011 | [-0.145, 0.115] |
| 1d SMA 20: pendiente contraria a la señal | Alcista | 30m | 33 | -0.009 | [-0.197, 0.164] | -0.025 | [-0.252, 0.213] |
| 1d SMA 40: precio alineado con la señal | Alcista | 30m | 76 | 0.034 | [-0.048, 0.120] | 0.018 | [-0.106, 0.137] |
| 1d SMA 40: precio contrario a la señal | Alcista | 30m | 32 | -0.082 | [-0.286, 0.115] | -0.095 | [-0.338, 0.154] |
| 1d SMA 40: pendiente alineada con la señal | Alcista | 30m | 79 | 0.028 | [-0.042, 0.105] | 0.012 | [-0.119, 0.139] |
| 1d SMA 100: precio alineado con la señal | Alcista | 30m | 87 | 0.043 | [-0.012, 0.102] | 0.027 | [-0.097, 0.148] |
| 1d SMA 100: pendiente alineada con la señal | Alcista | 30m | 88 | -0.038 | [-0.097, 0.014] | -0.054 | [-0.172, 0.069] |
| 1d SMA 200: precio alineado con la señal | Alcista | 30m | 102 | -0.011 | [-0.035, 0.007] | -0.026 | [-0.137, 0.096] |
| 1d SMA 200: pendiente alineada con la señal | Alcista | 30m | 103 | -0.009 | [-0.034, 0.008] | -0.025 | [-0.138, 0.092] |
| 1h: precio encima de las cuatro SMA | Alcista | 30m | 53 | 0.001 | [-0.122, 0.121] | -0.013 | [-0.173, 0.137] |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 30m | 37 | 0.050 | [-0.111, 0.216] | 0.035 | [-0.147, 0.222] |
| 1d: precio encima de las cuatro SMA | Alcista | 30m | 63 | 0.031 | [-0.070, 0.133] | 0.015 | [-0.127, 0.157] |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 30m | 44 | -0.109 | [-0.243, 0.025] | -0.124 | [-0.275, 0.026] |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Alcista | 30m | 46 | 0.012 | [-0.123, 0.146] | -0.004 | [-0.175, 0.159] |
| 1h SMA 20: precio alineado con la señal | Alcista | 60m | 71 | 0.043 | [-0.069, 0.166] | 0.045 | [-0.142, 0.235] |
| 1h SMA 20: precio contrario a la señal | Alcista | 60m | 33 | -0.092 | [-0.359, 0.156] | -0.093 | [-0.424, 0.212] |
| 1h SMA 20: pendiente alineada con la señal | Alcista | 60m | 70 | 0.023 | [-0.099, 0.147] | 0.025 | [-0.147, 0.204] |
| 1h SMA 20: pendiente contraria a la señal | Alcista | 60m | 34 | -0.047 | [-0.308, 0.209] | -0.047 | [-0.369, 0.272] |
| 1h SMA 40: precio alineado con la señal | Alcista | 60m | 73 | -0.003 | [-0.118, 0.116] | -0.001 | [-0.179, 0.182] |
| 1h SMA 40: precio contrario a la señal | Alcista | 60m | 31 | 0.007 | [-0.291, 0.291] | 0.006 | [-0.386, 0.359] |
| 1h SMA 40: pendiente alineada con la señal | Alcista | 60m | 67 | -0.019 | [-0.141, 0.108] | -0.017 | [-0.199, 0.159] |
| 1h SMA 40: pendiente contraria a la señal | Alcista | 60m | 37 | 0.034 | [-0.197, 0.266] | 0.036 | [-0.273, 0.331] |
| 1h SMA 100: precio alineado con la señal | Alcista | 60m | 69 | 0.083 | [-0.032, 0.206] | 0.084 | [-0.097, 0.266] |
| 1h SMA 100: precio contrario a la señal | Alcista | 60m | 35 | -0.163 | [-0.414, 0.066] | -0.162 | [-0.473, 0.133] |
| 1h SMA 100: pendiente alineada con la señal | Alcista | 60m | 65 | 0.035 | [-0.091, 0.162] | 0.036 | [-0.156, 0.234] |
| 1h SMA 100: pendiente contraria a la señal | Alcista | 60m | 39 | -0.058 | [-0.273, 0.159] | -0.056 | [-0.344, 0.217] |
| 1h SMA 200: precio alineado con la señal | Alcista | 60m | 72 | 0.041 | [-0.074, 0.160] | 0.041 | [-0.135, 0.218] |
| 1h SMA 200: precio contrario a la señal | Alcista | 60m | 32 | -0.093 | [-0.367, 0.173] | -0.088 | [-0.437, 0.249] |
| 1h SMA 200: pendiente alineada con la señal | Alcista | 60m | 73 | 0.004 | [-0.108, 0.119] | 0.005 | [-0.173, 0.179] |
| 1h SMA 200: pendiente contraria a la señal | Alcista | 60m | 31 | -0.010 | [-0.289, 0.283] | -0.008 | [-0.372, 0.331] |
| 1d SMA 20: precio alineado con la señal | Alcista | 60m | 70 | 0.061 | [-0.050, 0.185] | 0.062 | [-0.127, 0.245] |
| 1d SMA 20: precio contrario a la señal | Alcista | 60m | 34 | -0.126 | [-0.380, 0.115] | -0.124 | [-0.460, 0.180] |
| 1d SMA 20: pendiente alineada con la señal | Alcista | 60m | 72 | -0.038 | [-0.148, 0.073] | -0.035 | [-0.236, 0.151] |
| 1d SMA 20: pendiente contraria a la señal | Alcista | 60m | 32 | 0.085 | [-0.171, 0.330] | 0.083 | [-0.233, 0.402] |
| 1d SMA 40: precio alineado con la señal | Alcista | 60m | 74 | 0.015 | [-0.098, 0.134] | 0.016 | [-0.166, 0.184] |
| 1d SMA 40: precio contrario a la señal | Alcista | 60m | 30 | -0.037 | [-0.336, 0.261] | -0.034 | [-0.408, 0.324] |
| 1d SMA 40: pendiente alineada con la señal | Alcista | 60m | 78 | -0.020 | [-0.131, 0.083] | -0.018 | [-0.185, 0.143] |
| 1d SMA 100: precio alineado con la señal | Alcista | 60m | 85 | 0.022 | [-0.065, 0.112] | 0.023 | [-0.149, 0.182] |
| 1d SMA 100: pendiente alineada con la señal | Alcista | 60m | 86 | -0.088 | [-0.170, -0.015] | -0.087 | [-0.261, 0.087] |
| 1d SMA 200: precio alineado con la señal | Alcista | 60m | 98 | -0.017 | [-0.054, 0.009] | -0.017 | [-0.182, 0.158] |
| 1d SMA 200: pendiente alineada con la señal | Alcista | 60m | 99 | -0.010 | [-0.042, 0.014] | -0.009 | [-0.174, 0.158] |
| 1h: precio encima de las cuatro SMA | Alcista | 60m | 51 | 0.024 | [-0.138, 0.184] | 0.029 | [-0.181, 0.235] |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 60m | 36 | 0.027 | [-0.194, 0.243] | 0.031 | [-0.234, 0.293] |
| 1d: precio encima de las cuatro SMA | Alcista | 60m | 61 | 0.014 | [-0.118, 0.160] | 0.016 | [-0.182, 0.224] |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Alcista | 60m | 44 | -0.162 | [-0.341, 0.018] | -0.158 | [-0.371, 0.047] |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Alcista | 60m | 45 | 0.015 | [-0.162, 0.195] | 0.020 | [-0.213, 0.255] |
| 1h SMA 20: precio alineado con la señal | Bajista | 15m | 45 | 0.053 | [-0.062, 0.174] | 0.047 | [-0.110, 0.185] |
| 1h SMA 20: precio contrario a la señal | Bajista | 15m | 61 | -0.039 | [-0.125, 0.044] | -0.046 | [-0.178, 0.087] |
| 1h SMA 20: pendiente alineada con la señal | Bajista | 15m | 44 | -0.018 | [-0.143, 0.094] | -0.026 | [-0.179, 0.115] |
| 1h SMA 20: pendiente contraria a la señal | Bajista | 15m | 62 | 0.013 | [-0.065, 0.094] | 0.007 | [-0.122, 0.135] |
| 1h SMA 40: precio alineado con la señal | Bajista | 15m | 48 | -0.055 | [-0.179, 0.050] | -0.062 | [-0.216, 0.086] |
| 1h SMA 40: precio contrario a la señal | Bajista | 15m | 58 | 0.046 | [-0.040, 0.146] | 0.040 | [-0.085, 0.166] |
| 1h SMA 40: pendiente alineada con la señal | Bajista | 15m | 45 | -0.060 | [-0.177, 0.053] | -0.067 | [-0.217, 0.083] |
| 1h SMA 40: pendiente contraria a la señal | Bajista | 15m | 61 | 0.044 | [-0.038, 0.131] | 0.038 | [-0.083, 0.174] |
| 1h SMA 100: precio alineado con la señal | Bajista | 15m | 43 | -0.106 | [-0.229, 0.015] | -0.113 | [-0.272, 0.040] |
| 1h SMA 100: precio contrario a la señal | Bajista | 15m | 63 | 0.072 | [-0.010, 0.159] | 0.067 | [-0.057, 0.200] |
| 1h SMA 100: pendiente alineada con la señal | Bajista | 15m | 41 | -0.041 | [-0.161, 0.079] | -0.050 | [-0.186, 0.084] |
| 1h SMA 100: pendiente contraria a la señal | Bajista | 15m | 65 | 0.026 | [-0.050, 0.103] | 0.021 | [-0.111, 0.158] |
| 1h SMA 200: precio alineado con la señal | Bajista | 15m | 34 | -0.122 | [-0.280, 0.024] | -0.131 | [-0.330, 0.047] |
| 1h SMA 200: precio contrario a la señal | Bajista | 15m | 72 | 0.058 | [-0.011, 0.132] | 0.052 | [-0.060, 0.162] |
| 1h SMA 200: pendiente alineada con la señal | Bajista | 15m | 35 | -0.005 | [-0.162, 0.130] | -0.009 | [-0.190, 0.169] |
| 1h SMA 200: pendiente contraria a la señal | Bajista | 15m | 71 | 0.002 | [-0.066, 0.080] | -0.005 | [-0.117, 0.108] |
| 1d SMA 20: precio alineado con la señal | Bajista | 15m | 35 | -0.099 | [-0.249, 0.044] | -0.108 | [-0.293, 0.064] |
| 1d SMA 20: precio contrario a la señal | Bajista | 15m | 71 | 0.049 | [-0.020, 0.124] | 0.044 | [-0.069, 0.157] |
| 1d SMA 20: pendiente alineada con la señal | Bajista | 15m | 33 | -0.012 | [-0.150, 0.133] | -0.019 | [-0.173, 0.127] |
| 1d SMA 20: pendiente contraria a la señal | Bajista | 15m | 73 | 0.005 | [-0.058, 0.069] | -0.001 | [-0.125, 0.125] |
| 1d SMA 40: precio alineado con la señal | Bajista | 15m | 31 | -0.081 | [-0.262, 0.071] | -0.090 | [-0.291, 0.116] |
| 1d SMA 40: precio contrario a la señal | Bajista | 15m | 75 | 0.034 | [-0.027, 0.109] | 0.028 | [-0.084, 0.141] |
| 1d SMA 40: pendiente alineada con la señal | Bajista | 15m | 31 | -0.125 | [-0.300, 0.030] | -0.133 | [-0.339, 0.078] |
| 1d SMA 40: pendiente contraria a la señal | Bajista | 15m | 75 | 0.052 | [-0.012, 0.129] | 0.046 | [-0.070, 0.160] |
| 1d SMA 100: precio contrario a la señal | Bajista | 15m | 85 | 0.004 | [-0.047, 0.058] | -0.001 | [-0.107, 0.109] |
| 1d SMA 100: pendiente contraria a la señal | Bajista | 15m | 92 | 0.013 | [-0.029, 0.056] | 0.006 | [-0.090, 0.109] |
| 1d SMA 200: precio contrario a la señal | Bajista | 15m | 99 | -0.014 | [-0.048, 0.019] | -0.020 | [-0.121, 0.079] |
| 1d SMA 200: pendiente contraria a la señal | Bajista | 15m | 101 | -0.024 | [-0.051, -0.003] | -0.030 | [-0.135, 0.068] |
| 1h: precio encima de las cuatro SMA | Bajista | 15m | 40 | 0.054 | [-0.071, 0.189] | 0.049 | [-0.091, 0.214] |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 15m | 33 | 0.046 | [-0.088, 0.186] | 0.039 | [-0.099, 0.197] |
| 1d: precio encima de las cuatro SMA | Bajista | 15m | 65 | 0.064 | [-0.016, 0.152] | 0.058 | [-0.045, 0.172] |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 15m | 50 | 0.054 | [-0.046, 0.165] | 0.048 | [-0.096, 0.193] |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Bajista | 15m | 37 | 0.044 | [-0.094, 0.194] | 0.037 | [-0.118, 0.206] |
| 1h SMA 20: precio alineado con la señal | Bajista | 30m | 42 | 0.103 | [-0.074, 0.280] | 0.085 | [-0.184, 0.323] |
| 1h SMA 20: precio contrario a la señal | Bajista | 30m | 57 | -0.076 | [-0.203, 0.052] | -0.093 | [-0.238, 0.038] |
| 1h SMA 20: pendiente alineada con la señal | Bajista | 30m | 42 | 0.074 | [-0.073, 0.235] | 0.055 | [-0.134, 0.258] |
| 1h SMA 20: pendiente contraria a la señal | Bajista | 30m | 57 | -0.054 | [-0.180, 0.051] | -0.070 | [-0.262, 0.102] |
| 1h SMA 40: precio alineado con la señal | Bajista | 30m | 45 | -0.013 | [-0.166, 0.131] | -0.034 | [-0.260, 0.186] |
| 1h SMA 40: precio contrario a la señal | Bajista | 30m | 54 | 0.011 | [-0.110, 0.138] | -0.004 | [-0.158, 0.153] |
| 1h SMA 40: pendiente alineada con la señal | Bajista | 30m | 42 | -0.007 | [-0.156, 0.146] | -0.027 | [-0.216, 0.162] |
| 1h SMA 40: pendiente contraria a la señal | Bajista | 30m | 57 | 0.005 | [-0.108, 0.122] | -0.010 | [-0.208, 0.183] |
| 1h SMA 100: precio alineado con la señal | Bajista | 30m | 39 | -0.017 | [-0.190, 0.144] | -0.038 | [-0.234, 0.169] |
| 1h SMA 100: precio contrario a la señal | Bajista | 30m | 60 | 0.011 | [-0.094, 0.124] | -0.004 | [-0.186, 0.185] |
| 1h SMA 100: pendiente alineada con la señal | Bajista | 30m | 38 | 0.011 | [-0.150, 0.175] | -0.009 | [-0.189, 0.172] |
| 1h SMA 100: pendiente contraria a la señal | Bajista | 30m | 61 | -0.007 | [-0.109, 0.094] | -0.023 | [-0.227, 0.172] |
| 1h SMA 200: precio alineado con la señal | Bajista | 30m | 32 | -0.017 | [-0.214, 0.179] | -0.038 | [-0.259, 0.189] |
| 1h SMA 200: precio contrario a la señal | Bajista | 30m | 67 | 0.008 | [-0.083, 0.108] | -0.008 | [-0.179, 0.159] |
| 1h SMA 200: pendiente alineada con la señal | Bajista | 30m | 32 | 0.007 | [-0.210, 0.208] | -0.009 | [-0.297, 0.256] |
| 1h SMA 200: pendiente contraria a la señal | Bajista | 30m | 67 | -0.003 | [-0.100, 0.100] | -0.021 | [-0.171, 0.133] |
| 1d SMA 20: precio alineado con la señal | Bajista | 30m | 33 | -0.038 | [-0.232, 0.154] | -0.057 | [-0.269, 0.171] |
| 1d SMA 20: precio contrario a la señal | Bajista | 30m | 66 | 0.019 | [-0.075, 0.117] | 0.002 | [-0.177, 0.174] |
| 1d SMA 20: pendiente alineada con la señal | Bajista | 30m | 30 | 0.011 | [-0.175, 0.208] | -0.008 | [-0.216, 0.202] |
| 1d SMA 20: pendiente contraria a la señal | Bajista | 30m | 69 | -0.005 | [-0.084, 0.075] | -0.021 | [-0.201, 0.151] |
| 1d SMA 40: precio contrario a la señal | Bajista | 30m | 70 | 0.028 | [-0.066, 0.133] | 0.012 | [-0.126, 0.164] |
| 1d SMA 40: pendiente contraria a la señal | Bajista | 30m | 70 | 0.049 | [-0.046, 0.154] | 0.031 | [-0.111, 0.175] |
| 1d SMA 100: precio contrario a la señal | Bajista | 30m | 80 | 0.007 | [-0.060, 0.076] | -0.010 | [-0.156, 0.147] |
| 1d SMA 100: pendiente contraria a la señal | Bajista | 30m | 87 | 0.003 | [-0.055, 0.060] | -0.015 | [-0.159, 0.128] |
| 1d SMA 200: precio contrario a la señal | Bajista | 30m | 93 | -0.012 | [-0.061, 0.029] | -0.030 | [-0.171, 0.100] |
| 1d SMA 200: pendiente contraria a la señal | Bajista | 30m | 95 | -0.021 | [-0.062, 0.003] | -0.039 | [-0.182, 0.100] |
| 1h: precio encima de las cuatro SMA | Bajista | 30m | 38 | -0.016 | [-0.164, 0.145] | -0.031 | [-0.187, 0.123] |
| 1h: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 30m | 32 | 0.006 | [-0.178, 0.202] | -0.009 | [-0.205, 0.220] |
| 1d: precio encima de las cuatro SMA | Bajista | 30m | 61 | 0.059 | [-0.050, 0.184] | 0.043 | [-0.109, 0.200] |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 30m | 46 | 0.052 | [-0.089, 0.202] | 0.034 | [-0.140, 0.225] |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Bajista | 30m | 36 | 0.006 | [-0.155, 0.178] | -0.009 | [-0.180, 0.178] |
| 1h SMA 20: precio alineado con la señal | Bajista | 60m | 34 | 0.048 | [-0.189, 0.299] | 0.025 | [-0.282, 0.339] |
| 1h SMA 20: precio contrario a la señal | Bajista | 60m | 51 | -0.032 | [-0.195, 0.123] | -0.049 | [-0.288, 0.173] |
| 1h SMA 20: pendiente alineada con la señal | Bajista | 60m | 35 | -0.003 | [-0.223, 0.223] | -0.026 | [-0.265, 0.217] |
| 1h SMA 20: pendiente contraria a la señal | Bajista | 60m | 50 | 0.002 | [-0.160, 0.154] | -0.014 | [-0.282, 0.241] |
| 1h SMA 40: precio alineado con la señal | Bajista | 60m | 37 | -0.063 | [-0.288, 0.147] | -0.088 | [-0.368, 0.170] |
| 1h SMA 40: precio contrario a la señal | Bajista | 60m | 48 | 0.048 | [-0.113, 0.221] | 0.034 | [-0.236, 0.283] |
| 1h SMA 40: pendiente alineada con la señal | Bajista | 60m | 35 | 0.076 | [-0.159, 0.310] | 0.051 | [-0.249, 0.345] |
| 1h SMA 40: pendiente contraria a la señal | Bajista | 60m | 50 | -0.053 | [-0.213, 0.109] | -0.068 | [-0.317, 0.180] |
| 1h SMA 100: precio alineado con la señal | Bajista | 60m | 33 | -0.000 | [-0.252, 0.234] | -0.025 | [-0.337, 0.285] |
| 1h SMA 100: precio contrario a la señal | Bajista | 60m | 52 | 0.000 | [-0.141, 0.155] | -0.016 | [-0.253, 0.225] |
| 1h SMA 100: pendiente alineada con la señal | Bajista | 60m | 33 | 0.062 | [-0.171, 0.281] | 0.037 | [-0.247, 0.315] |
| 1h SMA 100: pendiente contraria a la señal | Bajista | 60m | 52 | -0.040 | [-0.180, 0.103] | -0.055 | [-0.313, 0.210] |
| 1h SMA 200: precio contrario a la señal | Bajista | 60m | 57 | -0.017 | [-0.149, 0.127] | -0.033 | [-0.251, 0.190] |
| 1h SMA 200: pendiente contraria a la señal | Bajista | 60m | 57 | -0.063 | [-0.194, 0.082] | -0.082 | [-0.316, 0.142] |
| 1d SMA 20: precio alineado con la señal | Bajista | 60m | 30 | 0.002 | [-0.276, 0.254] | -0.025 | [-0.347, 0.297] |
| 1d SMA 20: precio contrario a la señal | Bajista | 60m | 55 | -0.001 | [-0.138, 0.146] | -0.016 | [-0.242, 0.215] |
| 1d SMA 20: pendiente contraria a la señal | Bajista | 60m | 59 | -0.082 | [-0.196, 0.042] | -0.098 | [-0.327, 0.139] |
| 1d SMA 40: precio contrario a la señal | Bajista | 60m | 59 | -0.031 | [-0.157, 0.117] | -0.046 | [-0.260, 0.163] |
| 1d SMA 40: pendiente contraria a la señal | Bajista | 60m | 59 | -0.006 | [-0.141, 0.140] | -0.025 | [-0.230, 0.174] |
| 1d SMA 100: precio contrario a la señal | Bajista | 60m | 67 | -0.021 | [-0.123, 0.082] | -0.037 | [-0.245, 0.169] |
| 1d SMA 100: pendiente contraria a la señal | Bajista | 60m | 74 | -0.009 | [-0.097, 0.088] | -0.027 | [-0.223, 0.164] |
| 1d SMA 200: precio contrario a la señal | Bajista | 60m | 80 | -0.009 | [-0.084, 0.079] | -0.028 | [-0.205, 0.155] |
| 1d SMA 200: pendiente contraria a la señal | Bajista | 60m | 82 | -0.025 | [-0.078, 0.004] | -0.044 | [-0.231, 0.137] |
| 1h: precio encima de las cuatro SMA | Bajista | 60m | 35 | 0.051 | [-0.162, 0.290] | 0.036 | [-0.223, 0.303] |
| 1d: precio encima de las cuatro SMA | Bajista | 60m | 51 | 0.028 | [-0.126, 0.198] | 0.012 | [-0.218, 0.236] |
| 1d: orden SMA20 > SMA40 > SMA100 > SMA200 | Bajista | 60m | 38 | -0.001 | [-0.200, 0.210] | -0.020 | [-0.275, 0.264] |
| 1h y 1d coinciden en contexto de precio sobre/bajo las cuatro SMA | Bajista | 60m | 33 | 0.098 | [-0.135, 0.345] | 0.084 | [-0.199, 0.381] |


## Limitaciones

Las señales dentro de una sesión y los horizontes solapados son dependientes. Se analizaron ocho medias, varias clasificaciones, dos direcciones, tres horizontes y tres segmentos sin corrección conjunta por comparaciones múltiples. Los intervalos son descriptivos y no prueban causalidad.
La SMA 200 diaria aparece únicamente en el tramo ya examinado. Las condiciones combinadas tienen como máximo 35 señales antes de excluir horizontes; muchas quedan por debajo del mínimo para intervalos. Se requiere historial anterior adicional y después datos realmente nuevos para una evaluación defendible.
Los movimientos corresponden al precio de NVDA. No modelan contratos de opciones, costes, liquidez, deslizamiento ni ejecución real. No se definieron reglas de entrada, rebote, retroceso o ruptura.
