# Fase 13: volatilidad y calidad de oportunidades de NVDA

**Estudio diagnóstico, retrospectivo y exploratorio.** Todo 2021–2026 estaba disponible antes de este análisis; los años y el corte 70/30 no validan de forma independiente. No se generan operaciones ni opciones.

Fuente local: `NVDA_ALPACA_SIP_15min_20211017_20261017.csv`; SHA-256 CSV: `7b06d0a493515b18a581963d2d2d488e73a7cd0dc2c961b60a99315e7a9b0ecc`.
Commit de código usado: `4a6fc6c11002d2c4c5d7ca848ef540a782681f23`. Protocolo fijado previamente: `docs/phase13-research-protocol.md`.
JSON anteriores verificados: F11 `05031c1371b2596efa7653e326cdad1325855454479a1e1f25c3aeff66f6ba1f`; F12 `3e1f2ddab92bee95c270a9f1f170574a4089c1d9bd3696287a343a30fc030f56`.
Velas: 32510; 2021-10-18T13:30:00.000Z a 2026-10-16T19:45:00.000Z. Eventos sin redefinir: F11 876, F12 366.
Calendario: 1255/1255 sesiones observadas; 0 ausentes y 0 parciales. ATR14 válido en 1241 sesiones; regímenes baja/media/alta/insuficiente: 439/327/354/135.

## Resultados observados: horizonte principal de 30 minutos

| Familia | ATR previo | Señales | Evaluables | Sesiones | Muestra pequeña | Final >0 | Media % | IC 95% % | MFE % | MAE % | DE % | Neto 5pb % | Neto 10pb % | Neto 20pb % | Control original | Dif. original % | Control general | Dif. general % |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Retroceso alcista (F11) | low | 93 | 85 | 56 | no | 62.4% | 0.134 | [0.031, 0.236] | 0.393 | -0.305 | 0.447 | 0.084 | 0.034 | -0.066 | 100.0% | 0.124 | 100.0% | 0.121 |
| Retroceso alcista (F11) | medium | 42 | 38 | 28 | no | 42.1% | -0.081 | [-0.319, 0.104] | 0.445 | -0.503 | 0.721 | -0.131 | -0.181 | -0.281 | 100.0% | -0.098 | 100.0% | -0.077 |
| Retroceso alcista (F11) | high | 35 | 32 | 23 | no | 53.1% | -0.112 | [-0.448, 0.123] | 0.409 | -0.571 | 0.825 | -0.162 | -0.212 | -0.312 | 100.0% | -0.114 | 100.0% | -0.109 |
| Retroceso bajista (F11) | low | 9 | 8 | 6 | sí | 62.5% | 0.323 | N/D | 0.683 | -0.298 | 0.632 | 0.273 | 0.223 | 0.123 | 100.0% | 0.326 | 100.0% | 0.327 |
| Retroceso bajista (F11) | medium | 29 | 27 | 19 | sí | 44.4% | 0.018 | N/D | 0.459 | -0.364 | 0.483 | -0.032 | -0.082 | -0.182 | 100.0% | 0.029 | 100.0% | 0.015 |
| Retroceso bajista (F11) | high | 58 | 54 | 39 | no | 64.8% | 0.197 | [0.014, 0.405] | 0.671 | -0.404 | 0.707 | 0.147 | 0.097 | -0.003 | 100.0% | 0.215 | 100.0% | 0.218 |
| Ruptura alcista (F11) | low | 186 | 159 | 128 | no | 49.7% | 0.026 | [-0.066, 0.120] | 0.406 | -0.384 | 0.604 | -0.024 | -0.074 | -0.174 | 100.0% | 0.017 | 100.0% | 0.013 |
| Ruptura alcista (F11) | medium | 77 | 68 | 56 | no | 48.5% | 0.068 | [-0.136, 0.285] | 0.493 | -0.466 | 0.815 | 0.018 | -0.032 | -0.132 | 100.0% | 0.053 | 100.0% | 0.077 |
| Ruptura alcista (F11) | high | 70 | 61 | 43 | no | 59.0% | 0.107 | [-0.047, 0.255] | 0.514 | -0.443 | 0.531 | 0.057 | 0.007 | -0.093 | 100.0% | 0.101 | 100.0% | 0.098 |
| Ruptura bajista (F11) | low | 32 | 25 | 19 | sí | 52.0% | 0.124 | N/D | 0.544 | -0.424 | 0.713 | 0.074 | 0.024 | -0.076 | 100.0% | 0.120 | 100.0% | 0.144 |
| Ruptura bajista (F11) | medium | 66 | 56 | 45 | no | 46.4% | -0.034 | [-0.185, 0.109] | 0.478 | -0.493 | 0.563 | -0.084 | -0.134 | -0.234 | 100.0% | -0.038 | 100.0% | -0.030 |
| Ruptura bajista (F11) | high | 85 | 72 | 55 | no | 54.2% | 0.018 | [-0.169, 0.186] | 0.714 | -0.626 | 0.784 | -0.032 | -0.082 | -0.182 | 100.0% | 0.022 | 100.0% | 0.036 |
| Falla de máximo, bajista (F12) | low | 70 | 63 | 47 | no | 52.4% | 0.071 | [-0.027, 0.182] | 0.392 | -0.286 | 0.450 | 0.021 | -0.029 | -0.129 | 71.4% | 0.100 | 100.0% | 0.089 |
| Falla de máximo, bajista (F12) | medium | 45 | 41 | 34 | no | 68.3% | 0.224 | [0.040, 0.435] | 0.534 | -0.302 | 0.607 | 0.174 | 0.124 | 0.024 | 56.1% | 0.283 | 100.0% | 0.236 |
| Falla de máximo, bajista (F12) | high | 46 | 42 | 34 | no | 50.0% | -0.047 | [-0.241, 0.127] | 0.401 | -0.495 | 0.599 | -0.097 | -0.147 | -0.247 | 59.5% | -0.120 | 100.0% | -0.033 |
| Falla de mínimo, alcista (F12) | low | 61 | 57 | 42 | no | 49.1% | -0.010 | [-0.136, 0.107] | 0.347 | -0.378 | 0.423 | -0.060 | -0.110 | -0.210 | 68.4% | 0.041 | 100.0% | -0.027 |
| Falla de mínimo, alcista (F12) | medium | 39 | 37 | 33 | no | 45.9% | 0.066 | [-0.132, 0.272] | 0.469 | -0.432 | 0.645 | 0.016 | -0.034 | -0.134 | 64.9% | 0.105 | 100.0% | 0.068 |
| Falla de mínimo, alcista (F12) | high | 53 | 49 | 37 | no | 53.1% | -0.165 | [-0.447, 0.074] | 0.526 | -0.662 | 0.925 | -0.215 | -0.265 | -0.365 | 57.1% | -0.422 | 100.0% | -0.187 |

MFE es máximo favorable y MAE máximo adverso dentro de la ventana, en porcentaje de entrada; no se conoce el orden de extremos en una vela ni son ganancias ejecutables. Los costos son escenarios completos sobre acciones. La media firmada, no MFE, es el resultado principal. Los intervalos remuestrean sesiones completas y faltan cuando la muestra es pequeña.

### Régimen insuficiente y controles

| Familia | Sin régimen | Evaluables | Sin control original | Sin control general | MFE / ATR | MAE / ATR | MFE / rango20 | MAE / rango20 |
|---|---|---|---|---|---|---|---|---|
| Retroceso alcista (F11) | 10 | 9 | 0 | 9 | 0.110 | -0.114 | 0.699 | -0.706 |
| Retroceso bajista (F11) | 20 | 19 | 4 | 19 | 0.127 | -0.095 | 0.774 | -0.562 |
| Ruptura alcista (F11) | 19 | 17 | 0 | 17 | 0.122 | -0.114 | 0.831 | -0.774 |
| Ruptura bajista (F11) | 45 | 38 | 2 | 38 | 0.138 | -0.126 | 0.925 | -0.827 |
| Falla de máximo, bajista (F12) | 21 | 19 | 60 | 19 | 0.110 | -0.089 | 0.714 | -0.582 |
| Falla de mínimo, alcista (F12) | 31 | 29 | 68 | 29 | 0.107 | -0.116 | 0.623 | -0.677 |

Los controles originales mantienen sus reglas y cobertura de Fases 11 y 12. La referencia adicional usa ventanas de otras sesiones del mismo año, régimen, sentido y bloque horario; cada diferencia se calcula solo donde existe emparejamiento. Ninguna agrupación demuestra causalidad. Las excursiones normalizadas usan ATR14 previo en dólares o rango medio previo de 20 velas, por separado.

### Costos y distribuciones

| Familia | ATR previo | 0pb neto % | 5pb neto % | 10pb neto % | 20pb neto % | P10/P50/P90 MFE % | P10/P50/P90 MAE % |
|---|---|---|---|---|---|---|---|
| Retroceso alcista (F11) | low | 0.134 | 0.084 | 0.034 | -0.066 | 0.067 / 0.263 / 0.967 | -0.581 / -0.248 / -0.055 |
| Retroceso alcista (F11) | medium | -0.081 | -0.131 | -0.181 | -0.281 | 0.000 / 0.308 / 0.896 | -0.944 / -0.320 / -0.075 |
| Retroceso alcista (F11) | high | -0.112 | -0.162 | -0.212 | -0.312 | 0.055 / 0.332 / 0.713 | -1.159 / -0.335 / -0.046 |
| Retroceso bajista (F11) | low | 0.323 | 0.273 | 0.223 | 0.123 | 0.002 / 0.411 / 2.043 | -0.634 / -0.378 / -0.047 |
| Retroceso bajista (F11) | medium | 0.018 | -0.032 | -0.082 | -0.182 | 0.009 / 0.347 / 1.030 | -0.580 / -0.260 / -0.057 |
| Retroceso bajista (F11) | high | 0.197 | 0.147 | 0.097 | -0.003 | 0.132 / 0.479 / 1.348 | -0.930 / -0.313 / -0.071 |
| Ruptura alcista (F11) | low | 0.026 | -0.024 | -0.074 | -0.174 | 0.055 / 0.256 / 0.842 | -0.924 / -0.241 / -0.087 |
| Ruptura alcista (F11) | medium | 0.068 | 0.018 | -0.032 | -0.132 | 0.066 / 0.278 / 1.248 | -1.165 / -0.358 / -0.057 |
| Ruptura alcista (F11) | high | 0.107 | 0.057 | 0.007 | -0.093 | 0.079 / 0.442 / 1.097 | -0.917 / -0.305 / -0.095 |
| Ruptura bajista (F11) | low | 0.124 | 0.074 | 0.024 | -0.076 | 0.066 / 0.391 / 1.729 | -0.968 / -0.399 / -0.119 |
| Ruptura bajista (F11) | medium | -0.034 | -0.084 | -0.134 | -0.234 | 0.048 / 0.357 / 1.041 | -1.126 / -0.305 / -0.098 |
| Ruptura bajista (F11) | high | 0.018 | -0.032 | -0.082 | -0.182 | 0.150 / 0.517 / 1.665 | -1.149 / -0.486 / -0.159 |
| Falla de máximo, bajista (F12) | low | 0.071 | 0.021 | -0.029 | -0.129 | 0.059 / 0.268 / 0.872 | -0.643 / -0.221 / -0.027 |
| Falla de máximo, bajista (F12) | medium | 0.224 | 0.174 | 0.124 | 0.024 | 0.082 / 0.362 / 1.166 | -0.560 / -0.259 / -0.050 |
| Falla de máximo, bajista (F12) | high | -0.047 | -0.097 | -0.147 | -0.247 | 0.063 / 0.257 / 0.927 | -0.924 / -0.392 / -0.135 |
| Falla de mínimo, alcista (F12) | low | -0.010 | -0.060 | -0.110 | -0.210 | 0.068 / 0.261 / 0.796 | -0.845 / -0.254 / -0.073 |
| Falla de mínimo, alcista (F12) | medium | 0.066 | 0.016 | -0.034 | -0.134 | 0.111 / 0.421 / 1.157 | -1.182 / -0.291 / -0.022 |
| Falla de mínimo, alcista (F12) | high | -0.165 | -0.215 | -0.265 | -0.365 | 0.042 / 0.393 / 1.166 | -1.875 / -0.380 / -0.067 |

### Ventanas generales: amplitud habitual en ambos sentidos, sin seleccionar futuro

| ATR previo | Sentido | Ventanas | Evaluables | Sesiones | Final >0 | Media % | MFE % | MAE % | Neto 10pb % | Cierre excluido |
|---|---|---|---|---|---|---|---|---|---|---|
| low | bullish | 11378 | 10500 | 439 | 50.8% | 0.010 | 0.352 | -0.366 | -0.090 | 878 |
| low | bearish | 11378 | 10500 | 439 | 47.3% | -0.010 | 0.366 | -0.352 | -0.110 | 878 |
| medium | bullish | 8454 | 7800 | 327 | 49.4% | -0.002 | 0.407 | -0.420 | -0.102 | 654 |
| medium | bearish | 8454 | 7800 | 327 | 49.0% | 0.002 | 0.420 | -0.407 | -0.098 | 654 |
| high | bullish | 9180 | 8472 | 354 | 50.8% | 0.012 | 0.491 | -0.496 | -0.088 | 708 |
| high | bearish | 9180 | 8472 | 354 | 48.3% | -0.012 | 0.496 | -0.491 | -0.112 | 708 |

Cada vela entra una sola vez como ventana y se calcula cada sentido por separado. No se suman ambos como si se pudiera escoger el ganador tras observarlo.

### Años y cortes cronológicos; ningún segmento es prospectivo

| Período | Familia | Evaluables | Sesiones | Media % | IC 95% % | Dif. control general % |
|---|---|---|---|---|---|---|
| 2021 | Retroceso alcista (F11) | 4 | 4 | -0.437 | N/D | N/D |
| 2022 | Retroceso alcista (F11) | 20 | 14 | 0.210 | N/D | 0.129 |
| 2023 | Retroceso alcista (F11) | 44 | 26 | 0.126 | [-0.105, 0.321] | 0.107 |
| 2024 | Retroceso alcista (F11) | 45 | 32 | -0.041 | [-0.220, 0.113] | -0.038 |
| 2025 | Retroceso alcista (F11) | 26 | 19 | -0.004 | N/D | -0.008 |
| 2026 | Retroceso alcista (F11) | 25 | 19 | -0.042 | N/D | -0.034 |
| 2021 | Retroceso bajista (F11) | 5 | 3 | -0.124 | N/D | N/D |
| 2022 | Retroceso bajista (F11) | 27 | 19 | -0.090 | N/D | 0.090 |
| 2023 | Retroceso bajista (F11) | 17 | 12 | -0.081 | N/D | -0.065 |
| 2024 | Retroceso bajista (F11) | 13 | 10 | 0.436 | N/D | 0.424 |
| 2025 | Retroceso bajista (F11) | 25 | 18 | 0.116 | N/D | 0.131 |
| 2026 | Retroceso bajista (F11) | 21 | 14 | 0.281 | N/D | 0.283 |
| 2021 | Ruptura alcista (F11) | 7 | 6 | 0.054 | N/D | N/D |
| 2022 | Ruptura alcista (F11) | 45 | 36 | 0.075 | [-0.249, 0.395] | 0.096 |
| 2023 | Ruptura alcista (F11) | 84 | 69 | -0.023 | [-0.159, 0.116] | -0.043 |
| 2024 | Ruptura alcista (F11) | 65 | 51 | 0.044 | [-0.114, 0.214] | 0.049 |
| 2025 | Ruptura alcista (F11) | 62 | 46 | 0.035 | [-0.077, 0.148] | 0.029 |
| 2026 | Ruptura alcista (F11) | 42 | 34 | 0.195 | [0.054, 0.371] | 0.202 |
| 2021 | Ruptura bajista (F11) | 4 | 3 | 0.312 | N/D | N/D |
| 2022 | Ruptura bajista (F11) | 62 | 47 | 0.161 | [-0.084, 0.387] | 0.231 |
| 2023 | Ruptura bajista (F11) | 33 | 26 | -0.059 | [-0.205, 0.084] | -0.051 |
| 2024 | Ruptura bajista (F11) | 28 | 22 | -0.068 | N/D | -0.060 |
| 2025 | Ruptura bajista (F11) | 28 | 22 | 0.042 | N/D | 0.037 |
| 2026 | Ruptura bajista (F11) | 36 | 27 | 0.014 | [-0.182, 0.193] | 0.011 |
| 2021 | Falla de máximo, bajista (F12) | 3 | 3 | 0.280 | N/D | N/D |
| 2022 | Falla de máximo, bajista (F12) | 44 | 33 | 0.155 | [-0.077, 0.377] | 0.255 |
| 2023 | Falla de máximo, bajista (F12) | 25 | 22 | -0.119 | N/D | -0.087 |
| 2024 | Falla de máximo, bajista (F12) | 32 | 23 | 0.019 | [-0.164, 0.207] | 0.022 |
| 2025 | Falla de máximo, bajista (F12) | 40 | 31 | 0.151 | [0.000, 0.333] | 0.167 |
| 2026 | Falla de máximo, bajista (F12) | 21 | 17 | 0.071 | N/D | 0.075 |
| 2021 | Falla de mínimo, alcista (F12) | 12 | 8 | -0.011 | N/D | N/D |
| 2022 | Falla de mínimo, alcista (F12) | 36 | 32 | -0.155 | [-0.455, 0.141] | -0.240 |
| 2023 | Falla de mínimo, alcista (F12) | 42 | 34 | -0.022 | [-0.212, 0.154] | -0.038 |
| 2024 | Falla de mínimo, alcista (F12) | 16 | 15 | -0.039 | N/D | -0.063 |
| 2025 | Falla de mínimo, alcista (F12) | 38 | 26 | -0.021 | [-0.254, 0.185] | -0.035 |
| 2026 | Falla de mínimo, alcista (F12) | 28 | 19 | 0.001 | N/D | 0.012 |
| first70 | Retroceso alcista (F11) | 117 | 79 | 0.043 | [-0.083, 0.162] | 0.036 |
| last30 | Retroceso alcista (F11) | 47 | 35 | -0.003 | [-0.136, 0.124] | -0.001 |
| first70 | Retroceso bajista (F11) | 70 | 50 | 0.078 | [-0.110, 0.264] | 0.195 |
| last30 | Retroceso bajista (F11) | 38 | 26 | 0.120 | [-0.057, 0.304] | 0.128 |
| first70 | Ruptura alcista (F11) | 206 | 167 | 0.016 | [-0.093, 0.120] | 0.008 |
| last30 | Ruptura alcista (F11) | 99 | 75 | 0.119 | [0.031, 0.213] | 0.118 |
| first70 | Ruptura bajista (F11) | 141 | 110 | 0.071 | [-0.066, 0.212] | 0.055 |
| last30 | Ruptura bajista (F11) | 50 | 37 | -0.019 | [-0.180, 0.133] | -0.022 |
| first70 | Falla de máximo, bajista (F12) | 115 | 89 | 0.071 | [-0.042, 0.191] | 0.094 |
| last30 | Falla de máximo, bajista (F12) | 50 | 40 | 0.093 | [-0.025, 0.243] | 0.098 |
| first70 | Falla de mínimo, alcista (F12) | 123 | 99 | -0.080 | [-0.230, 0.059] | -0.106 |
| last30 | Falla de mínimo, alcista (F12) | 49 | 35 | 0.037 | [-0.093, 0.169] | 0.037 |

La composición por año y régimen, incluidos recuentos con control, está en el JSON `yearRegimeRows`. Los años con menos de 30 eventos no sostienen una lectura de estabilidad.

### Horario de toda la sesión regular

| Bloque NY | Sentido | Señales | Evaluables | Excluidas al cierre | Media % | MFE % | MAE % | Ventanas generales | MFE general % | MAE general % |
|---|---|---|---|---|---|---|---|---|---|---|
| 09:30 | bullish | 158 | 158 | 0 | -0.062 | 0.527 | -0.621 | 5020 | 0.655 | -0.686 |
| 09:30 | bearish | 102 | 102 | 0 | 0.002 | 0.814 | -0.702 | 5020 | 0.686 | -0.655 |
| 10:30 | bullish | 147 | 147 | 0 | 0.153 | 0.519 | -0.390 | 5020 | 0.478 | -0.468 |
| 10:30 | bearish | 111 | 111 | 0 | 0.062 | 0.556 | -0.463 | 5020 | 0.468 | -0.478 |
| 11:30 | bullish | 83 | 83 | 0 | -0.043 | 0.390 | -0.417 | 5020 | 0.373 | -0.400 |
| 11:30 | bearish | 72 | 72 | 0 | 0.110 | 0.465 | -0.339 | 5020 | 0.400 | -0.373 |
| 12:30 | bullish | 73 | 73 | 0 | 0.078 | 0.376 | -0.346 | 5000 | 0.354 | -0.354 |
| 12:30 | bearish | 46 | 46 | 0 | -0.016 | 0.481 | -0.464 | 5000 | 0.354 | -0.354 |
| 13:30 | bullish | 68 | 68 | 0 | 0.049 | 0.430 | -0.397 | 4980 | 0.359 | -0.355 |
| 13:30 | bearish | 56 | 56 | 0 | 0.092 | 0.459 | -0.404 | 4980 | 0.355 | -0.359 |
| 14:30 | bullish | 112 | 112 | 0 | -0.055 | 0.337 | -0.411 | 4980 | 0.373 | -0.399 |
| 14:30 | bearish | 77 | 77 | 0 | 0.162 | 0.532 | -0.434 | 4980 | 0.399 | -0.373 |
| 15:30 | bullish | 75 | 0 | 75 | N/D | N/D | N/D | 2490 | N/D | N/D |
| 15:30 | bearish | 62 | 0 | 62 | N/D | N/D | N/D | 2490 | N/D | N/D |

El bloque 15:30 es abreviado; las exclusiones de cierre aumentan al final del día. El desglose horario no se cruza con los regímenes para decidir.

### Horizontes secundarios y exclusiones

| Familia | Minutos | Evaluables | Cierre | Falta siguiente | Hueco | Media % | MFE % | MAE % |
|---|---|---|---|---|---|---|---|---|
| Retroceso alcista (F11) | 15 | 171 | 9 | 0 | 0 | 0.014 | 0.287 | -0.318 |
| Retroceso alcista (F11) | 60 | 149 | 31 | 0 | 0 | 0.021 | 0.596 | -0.580 |
| Retroceso bajista (F11) | 15 | 112 | 4 | 0 | 0 | 0.088 | 0.455 | -0.348 |
| Retroceso bajista (F11) | 60 | 101 | 15 | 0 | 0 | -0.003 | 0.744 | -0.670 |
| Ruptura alcista (F11) | 15 | 313 | 39 | 0 | 0 | 0.022 | 0.311 | -0.332 |
| Ruptura alcista (F11) | 60 | 268 | 84 | 0 | 0 | 0.046 | 0.638 | -0.597 |
| Ruptura bajista (F11) | 15 | 201 | 27 | 0 | 0 | 0.007 | 0.481 | -0.447 |
| Ruptura bajista (F11) | 60 | 167 | 61 | 0 | 0 | 0.100 | 0.907 | -0.764 |
| Falla de máximo, bajista (F12) | 15 | 174 | 8 | 0 | 0 | 0.019 | 0.309 | -0.286 |
| Falla de máximo, bajista (F12) | 60 | 156 | 26 | 0 | 0 | 0.092 | 0.662 | -0.516 |
| Falla de mínimo, alcista (F12) | 15 | 180 | 4 | 0 | 0 | -0.025 | 0.341 | -0.368 |
| Falla de mínimo, alcista (F12) | 60 | 163 | 21 | 0 | 0 | -0.056 | 0.639 | -0.700 |

Los horizontes de 15 y 60 minutos no sustituyen el resultado principal predefinido de 30 minutos.

## Respuestas numéricas a las preguntas del protocolo

1. Las ventanas generales en régimen alto tuvieron MFE media alcista 0.491% y bajista 0.496%; en régimen bajo fueron 0.352% y 0.366%. Entre familias seleccionadas con régimen conocido, la mayor MFE fue Ruptura bajista (F11), high, 0.714% (72 resultados).
2. En las mismas ventanas generales, la MAE media en régimen alto fue -0.496% alcista y -0.491% bajista, frente a -0.366% y -0.352% en bajo: una mayor MFE vino acompañada de mayor magnitud adversa.
3. La celda de mayor MFE acabó con media neta a 10 pb de -0.082%. Las ventanas generales en régimen alto acabaron con -0.088% alcista y -0.112% bajista. La MFE potencial por sí sola no cubre un costo realizable.
4. El sentido importa: falla de máximo bajista (F12) tuvo retorno medio 0.078% en 165 casos, mientras falla de mínimo alcista tuvo -0.047% en 172; esas poblaciones son distintas y no prueban asimetría causal.
5. 3 de las seis familias cambiaron de signo entre años con al menos 30 resultados. Las tablas anuales muestran también familias con años insuficientes; los cortes históricos no son datos nuevos.
6. Fase 11 registró 876 eventos de retroceso/ruptura; Fase 12, 366 fallas. Sus seis medias familiares a 30 minutos van de -0.047% a 0.093%; comparar tipos no elimina diferencias de selección y control.
7. La diferencia frente a ventanas generales fue 0.166% para retroceso bajista y 0.095% para falla de máximo bajista; ambas deben leerse con sus coberturas y tamaños en la tabla. Ninguna de las 18 celdas satisfizo todos los criterios de suficiencia y estabilidad.
8. El horizonte fijo de 30 minutos conservó 89.0% de las señales; es medible bajo el umbral predefinido del 70%. La ausencia de celda candidata no justifica sustituirlo retroactivamente por 15 o 60 minutos.

## Interpretación y decisión de viabilidad

Entre las celdas familiares, la mayor MFE media observada corresponde a Ruptura bajista (F11), régimen high, 0.714% (72 resultados; MAE media -0.626%). La tabla principal y la línea base permiten comprobar si la mayor excursión favorable también vino con mayor excursión adversa; la comparación de MFE no equivale a rentabilidad.
La cobertura de 30 minutos fue 89.0%; alcanza el umbral diagnóstico del 70%.
Auditoría predefinida de suficiencia y estabilidad: 0 celdas candidatas de 18; 5 familias tienen al menos dos regímenes con 30 resultados y 10 sesiones. Decisión: **Patrones inconsistentes o demasiado pequeños**.
No apareció evidencia bajo el criterio fijo para convertir estas agrupaciones en una regla de entrada. Recomendamos dejar de probar variantes similares de señales de 15 minutos sobre este mismo historial y considerar otro horizonte o información nueva.
Los signos, coberturas y umbrales individuales de las 18 celdas están en `candidateAudit` del JSON. Las diferencias originales frente a control se informan por cobertura; Fase 11 y Fase 12 ya habían encontrado límites estadísticos y aquí no se reescriben sus conclusiones.

Este diagnóstico tiene sesgo de selección por investigación previa sobre el mismo período, múltiples comparaciones descriptivas, variación por año, controles imperfectos y posibles noticias/liquidez no modeladas. Ni una pequeña media positiva tras revisar celdas ni una MFE grande prueban ventaja. Las trayectorias y exclusiones individuales se conservan en los CSV adjuntos.
