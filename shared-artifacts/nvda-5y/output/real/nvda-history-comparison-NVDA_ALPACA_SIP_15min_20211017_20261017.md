# Comparación histórica NVDA: cobertura SMA y señales Bollinger

Archivo ampliado: NVDA_ALPACA_SIP_15min_20211017_20261017.csv. Referencia ya examinada: NVDA_ALPACA_SIP_15min_12m.csv (2025-10-17 a 2026-10-16).
Señales: referencia 161; historial ampliado 781. En el archivo ampliado, 617 preceden la ventana conocida, 164 caen dentro y 0 son posteriores.
Solapamiento de velas: 6497 timestamps coincidentes, 0 con alguna diferencia OHLCV y 0 ausentes en el historial ampliado. Si existen diferencias, una variación en señales o SMA puede provenir de revisiones del proveedor o del historial inicial disponible.
Corte por sesiones del historial ampliado: 2025-04-21. La SMA 200 diaria está disponible en 657 señales, 415 en exploración y 242 en evaluación.

## Cobertura por SMA

| TF | SMA | Señales en 12m | Señales en historial ampliado | Primer 70% ampliado | Último 30% ampliado |
|---|---:|---:|---:|---:|---:|
| 1h | 20 | 161 | 781 | 539 | 242 |
| 1h | 40 | 159 | 781 | 539 | 242 |
| 1h | 100 | 153 | 776 | 534 | 242 |
| 1h | 200 | 147 | 769 | 527 | 242 |
| 1d | 20 | 152 | 774 | 532 | 242 |
| 1d | 40 | 141 | 763 | 521 | 242 |
| 1d | 100 | 103 | 725 | 483 | 242 |
| 1d | 200 | 35 | 657 | 415 | 242 |

## SMA 200 diaria: precio alineado con la señal

| Tramo | Dirección | Horizonte | Con SMA | Condición | Evaluables | Sesiones | Favorables | Media % | Diferencia frente a Bollinger comparable % | IC 95% por sesiones % |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| total | Alcista | 15m | 350 | 289 | 268 | 255 | 55.2% | 0.047 | -0.000 | [-0.034, 0.034] |
| total | Alcista | 30m | 350 | 289 | 259 | 247 | 51.7% | 0.034 | -0.006 | [-0.053, 0.037] |
| total | Alcista | 60m | 350 | 289 | 235 | 228 | 52.3% | 0.120 | -0.006 | [-0.065, 0.057] |
| total | Bajista | 15m | 307 | 46 | 41 | 39 | 61.0% | 0.048 | 0.029 | [-0.182, 0.233] |
| total | Bajista | 30m | 307 | 46 | 39 | 38 | 64.1% | 0.101 | 0.064 | [-0.262, 0.374] |
| total | Bajista | 60m | 307 | 46 | 36 | 36 | 63.9% | 0.105 | 0.047 | [-0.396, 0.451] |
| exploracion | Alcista | 15m | 229 | 179 | 165 | 158 | 57.0% | 0.089 | 0.001 | [-0.046, 0.050] |
| exploracion | Alcista | 30m | 229 | 179 | 157 | 151 | 54.1% | 0.076 | 0.003 | [-0.070, 0.076] |
| exploracion | Alcista | 60m | 229 | 179 | 137 | 134 | 55.5% | 0.222 | 0.018 | [-0.073, 0.119] |
| exploracion | Bajista | 15m | 186 | 39 | 34 | 32 | 55.9% | 0.016 | -0.012 | [-0.246, 0.231] |
| exploracion | Bajista | 30m | 186 | 39 | 33 | 32 | 66.7% | 0.087 | 0.021 | [-0.323, 0.339] |
| exploracion | Bajista | 60m | 186 | 39 | 31 | 31 | 64.5% | 0.100 | 0.001 | [-0.449, 0.424] |
| evaluacion | Alcista | 15m | 121 | 110 | 103 | 97 | 52.4% | -0.019 | 0.010 | [-0.002, 0.030] |
| evaluacion | Alcista | 30m | 121 | 110 | 102 | 96 | 48.0% | -0.032 | -0.011 | [-0.035, 0.007] |
| evaluacion | Alcista | 60m | 121 | 110 | 98 | 94 | 48.0% | -0.023 | -0.017 | [-0.054, 0.009] |
| evaluacion | Bajista | 15m | 121 | 7 | 7 | 7 | 85.7% | 0.201 | 0.197 | — |
| evaluacion | Bajista | 30m | 121 | 7 | 6 | 6 | 50.0% | 0.181 | 0.191 | — |
| evaluacion | Bajista | 60m | 121 | 7 | 5 | 5 | 60.0% | 0.132 | 0.145 | — |

El referente Bollinger de cada fila utiliza la misma cobertura SMA 200 diaria y el mismo horizonte. Las restantes posiciones, pendientes y condiciones conjuntas están en el informe completo generado por validate:nvda-sma-context con el archivo ampliado.
Este historial combina fechas anteriores con un período ya investigado. Un primer 70% con más cobertura histórica no es una validación prospectiva nueva; el último 30% puede contener fechas ya examinadas. Hay dependencia entre señales y múltiples comparaciones. Ninguna diferencia equivale a rentabilidad de opciones.
