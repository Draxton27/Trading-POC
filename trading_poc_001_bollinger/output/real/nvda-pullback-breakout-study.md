# Fase 11: retrocesos y rupturas de NVDA

Estudio histórico exploratorio. No constituye una validación prospectiva, un sistema de operaciones ni un estudio de opciones.

Fuente: NVDA_ALPACA_SIP_15min_20211017_20261017.csv. SHA-256 del CSV: 7b06d0a493515b18a581963d2d2d488e73a7cd0dc2c961b60a99315e7a9b0ecc.
Velas: 32510; rango observado: 2021-10-18T13:30:00.000Z a 2026-10-16T19:45:00.000Z.
Calendario: 1255/1255 sesiones observadas; 0 ausentes y 0 parciales.
Agregaciones completas: 8755 horarias y 1255 diarias. Incompletas: 0 horarias y 0 diarias.
Contextos de las velas: alcista 16886, bajista 10780, contradictorio 4324, igualdad/neutral 0, insuficiente 520.

El protocolo se fijó en docs/phase11-research-protocol.md antes de ejecutar este estudio. Señal al cierre de la vela; entrada hipotética en la siguiente apertura. Horizonte principal: 30 minutos.

## Comparaciones principales: 30 minutos

| Hipótesis | Sentido | Señales | Evaluables | Sesiones | Con control | Favorables | IC 95% favorables | Media % | Favorable media % | Desfavorable media % | Control % | Diferencia % | IC 95% diferencia % | p Holm |
|---|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---|---:|
| A. Retroceso y recuperación | Alcista | 180 | 164 | 114 | 164 | 55.5% | [47.3%, 63.1%] | 0.030 | 0.417 | -0.464 | 0.013 | 0.017 | [-0.083, 0.111] | 1.0000 |
| A. Retroceso y recuperación | Bajista | 116 | 108 | 76 | 104 | 55.6% | [46.2%, 64.8%] | 0.093 | 0.547 | -0.496 | -0.014 | 0.100 | [-0.049, 0.246] | 0.6517 |
| B. Ruptura simple | Alcista | 352 | 305 | 242 | 305 | 51.5% | [45.5%, 57.1%] | 0.049 | 0.485 | -0.433 | 0.004 | 0.045 | [-0.035, 0.120] | 0.8036 |
| B. Ruptura simple | Bajista | 228 | 191 | 147 | 189 | 53.4% | [46.4%, 60.7%] | 0.047 | 0.583 | -0.573 | 0.003 | 0.034 | [-0.075, 0.144] | 1.0000 |

Los controles son velas sin ninguno de los dos eventos, con la misma dirección de tendencia, año y hora de Nueva York, de otras sesiones. Cada evento requiere diez controles de diez sesiones. La diferencia y sus intervalos se calculan solo donde existe referencia. Los intervalos se remuestrean por sesión (2.000 bloques); p de Holm corrige las cuatro comparaciones principales. Son inferencias exploratorias condicionadas a la referencia construida.

## Decisión por hipótesis

- **A. Retroceso y recuperación, alcista: Sin mejora demostrada.** La comparación principal no cumple todos los criterios predefinidos para avanzar.
- **A. Retroceso y recuperación, bajista: Sin mejora demostrada.** La comparación principal no cumple todos los criterios predefinidos para avanzar.
- **B. Ruptura simple, alcista: Sin mejora demostrada.** La comparación principal no cumple todos los criterios predefinidos para avanzar.
- **B. Ruptura simple, bajista: Sin mejora demostrada.** La comparación principal no cumple todos los criterios predefinidos para avanzar.

## Horizonte secundario: 15 y 60 minutos

| Hipótesis | Sentido | Horizonte | Evaluables | Favorables | Media % | Diferencia con control % | IC 95% diferencia % |
|---|---|---:|---:|---:|---:|---:|---|
| A. Retroceso y recuperación | Alcista | 15m | 171 | 56.7% | 0.014 | 0.005 | [-0.074, 0.079] |
| A. Retroceso y recuperación | Alcista | 60m | 149 | 54.4% | 0.021 | 0.001 | [-0.139, 0.130] |
| A. Retroceso y recuperación | Bajista | 15m | 112 | 59.8% | 0.088 | 0.091 | [-0.032, 0.213] |
| A. Retroceso y recuperación | Bajista | 60m | 101 | 51.5% | -0.003 | 0.004 | [-0.184, 0.197] |
| B. Ruptura simple | Alcista | 15m | 313 | 50.5% | 0.022 | 0.023 | [-0.027, 0.071] |
| B. Ruptura simple | Alcista | 60m | 268 | 49.3% | 0.046 | 0.031 | [-0.094, 0.149] |
| B. Ruptura simple | Bajista | 15m | 201 | 53.2% | 0.007 | 0.010 | [-0.085, 0.102] |
| B. Ruptura simple | Bajista | 60m | 167 | 50.9% | 0.100 | 0.102 | [-0.064, 0.262] |

Los horizontes secundarios no sustituyen el principal aunque parezcan más favorables.

## Sensibilidad a costos por operación completa sobre acciones

| Hipótesis | Sentido | Costo (pb) | Media neta % | Favorables netas |
|---|---|---:|---:|---:|
| A. Retroceso y recuperación | Alcista | 0 | 0.030 | 55.5% |
| A. Retroceso y recuperación | Alcista | 5 | -0.020 | 51.2% |
| A. Retroceso y recuperación | Alcista | 10 | -0.070 | 48.8% |
| A. Retroceso y recuperación | Alcista | 20 | -0.170 | 40.2% |
| A. Retroceso y recuperación | Bajista | 0 | 0.093 | 55.6% |
| A. Retroceso y recuperación | Bajista | 5 | 0.043 | 51.9% |
| A. Retroceso y recuperación | Bajista | 10 | -0.007 | 45.4% |
| A. Retroceso y recuperación | Bajista | 20 | -0.107 | 38.9% |
| B. Ruptura simple | Alcista | 0 | 0.049 | 51.5% |
| B. Ruptura simple | Alcista | 5 | -0.001 | 48.5% |
| B. Ruptura simple | Alcista | 10 | -0.051 | 46.2% |
| B. Ruptura simple | Alcista | 20 | -0.151 | 33.8% |
| B. Ruptura simple | Bajista | 0 | 0.047 | 53.4% |
| B. Ruptura simple | Bajista | 5 | -0.003 | 50.3% |
| B. Ruptura simple | Bajista | 10 | -0.053 | 46.1% |
| B. Ruptura simple | Bajista | 20 | -0.153 | 38.7% |

Los 0, 5, 10 y 20 puntos básicos son escenarios hipotéticos; no estiman ejecución real ni valor de contratos.

## Años y divisiones cronológicas, horizonte principal

Corte 70/30 por sesiones en 2025-04-21. Ambos tramos son retrospectivos; el último puede incluir fechas ya examinadas.

| Tramo | Hipótesis | Sentido | Señales | Evaluables | Sesiones | Con control | Media % | Control % | Diferencia % | IC 95% diferencia % |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| first70 | A. Retroceso y recuperación | Alcista | 126 | 117 | 79 | 117 | 0.043 | 0.022 | 0.021 | [-0.109, 0.140] |
| first70 | A. Retroceso y recuperación | Bajista | 77 | 70 | 50 | 66 | 0.078 | -0.003 | 0.069 | [-0.129, 0.276] |
| first70 | B. Ruptura simple | Alcista | 237 | 206 | 167 | 206 | 0.016 | 0.010 | 0.005 | [-0.097, 0.113] |
| first70 | B. Ruptura simple | Bajista | 166 | 141 | 110 | 139 | 0.071 | 0.008 | 0.050 | [-0.094, 0.193] |
| last30 | A. Retroceso y recuperación | Alcista | 54 | 47 | 35 | 47 | -0.003 | -0.009 | 0.006 | [-0.128, 0.129] |
| last30 | A. Retroceso y recuperación | Bajista | 39 | 38 | 26 | 38 | 0.120 | -0.033 | 0.153 | [-0.030, 0.356] |
| last30 | B. Ruptura simple | Alcista | 115 | 99 | 75 | 99 | 0.119 | -0.009 | 0.128 | [0.044, 0.231] |
| last30 | B. Ruptura simple | Bajista | 62 | 50 | 37 | 50 | -0.019 | -0.009 | -0.010 | [-0.189, 0.143] |
| 2021 | A. Retroceso y recuperación | Alcista | 4 | 4 | 4 | 4 | -0.437 | 0.140 | -0.577 | N/D |
| 2021 | A. Retroceso y recuperación | Bajista | 6 | 5 | 3 | 1 | -0.124 | -0.052 | -1.691 | N/D |
| 2021 | B. Ruptura simple | Alcista | 8 | 7 | 6 | 7 | 0.054 | -0.193 | 0.246 | N/D |
| 2021 | B. Ruptura simple | Bajista | 5 | 4 | 3 | 2 | 0.312 | 0.029 | -0.378 | N/D |
| 2022 | A. Retroceso y recuperación | Alcista | 22 | 20 | 14 | 20 | 0.210 | 0.013 | 0.197 | N/D |
| 2022 | A. Retroceso y recuperación | Bajista | 28 | 27 | 19 | 27 | -0.090 | -0.018 | -0.072 | N/D |
| 2022 | B. Ruptura simple | Alcista | 50 | 45 | 36 | 45 | 0.075 | 0.017 | 0.058 | [-0.277, 0.362] |
| 2022 | B. Ruptura simple | Bajista | 71 | 62 | 47 | 62 | 0.161 | 0.008 | 0.153 | [-0.067, 0.375] |
| 2023 | A. Retroceso y recuperación | Alcista | 48 | 44 | 26 | 44 | 0.126 | 0.018 | 0.107 | [-0.111, 0.303] |
| 2023 | A. Retroceso y recuperación | Bajista | 18 | 17 | 12 | 17 | -0.081 | -0.009 | -0.073 | N/D |
| 2023 | B. Ruptura simple | Alcista | 94 | 84 | 69 | 84 | -0.023 | 0.018 | -0.041 | [-0.187, 0.099] |
| 2023 | B. Ruptura simple | Bajista | 40 | 33 | 26 | 33 | -0.059 | 0.000 | -0.059 | [-0.203, 0.078] |
| 2024 | A. Retroceso y recuperación | Alcista | 47 | 45 | 32 | 45 | -0.041 | 0.019 | -0.060 | [-0.238, 0.092] |
| 2024 | A. Retroceso y recuperación | Bajista | 17 | 13 | 10 | 13 | 0.436 | 0.057 | 0.379 | N/D |
| 2024 | B. Ruptura simple | Alcista | 79 | 65 | 51 | 65 | 0.044 | 0.017 | 0.027 | [-0.128, 0.199] |
| 2024 | B. Ruptura simple | Bajista | 33 | 28 | 22 | 28 | -0.068 | 0.016 | -0.084 | N/D |
| 2025 | A. Retroceso y recuperación | Alcista | 32 | 26 | 19 | 26 | -0.004 | 0.003 | -0.007 | N/D |
| 2025 | A. Retroceso y recuperación | Bajista | 25 | 25 | 18 | 25 | 0.116 | -0.026 | 0.142 | N/D |
| 2025 | B. Ruptura simple | Alcista | 71 | 62 | 46 | 62 | 0.035 | 0.003 | 0.032 | [-0.080, 0.149] |
| 2025 | B. Ruptura simple | Bajista | 35 | 28 | 22 | 28 | 0.042 | 0.001 | 0.040 | N/D |
| 2026 | A. Retroceso y recuperación | Alcista | 27 | 25 | 19 | 25 | -0.042 | -0.015 | -0.028 | N/D |
| 2026 | A. Retroceso y recuperación | Bajista | 22 | 21 | 14 | 21 | 0.281 | -0.041 | 0.322 | N/D |
| 2026 | B. Ruptura simple | Alcista | 50 | 42 | 34 | 42 | 0.195 | -0.023 | 0.219 | [0.067, 0.393] |
| 2026 | B. Ruptura simple | Bajista | 44 | 36 | 27 | 36 | 0.014 | -0.011 | 0.025 | [-0.182, 0.213] |

## Exclusiones, repeticiones y relación con compresión

En las cuatro comparaciones principales, las causas de exclusión del resultado de 30 minutos son:
- A. Retroceso y recuperación, alcista: cierre de sesión 16, próxima vela ausente 0, horizonte incompleto 0, sin referencia comparable 0.
- A. Retroceso y recuperación, bajista: cierre de sesión 8, próxima vela ausente 0, horizonte incompleto 0, sin referencia comparable 4.
- B. Ruptura simple, alcista: cierre de sesión 47, próxima vela ausente 0, horizonte incompleto 0, sin referencia comparable 0.
- B. Ruptura simple, bajista: cierre de sesión 37, próxima vela ausente 0, horizonte incompleto 0, sin referencia comparable 2.
Eventos repetidos a menos de cuatro barras: 112; ventanas principales solapadas con un evento anterior: 50; eventos retenidos al quitar repeticiones: 770.
Sensibilidad descriptiva al quitar repeticiones, horizonte principal:

| Hipótesis | Sentido | Evaluables originales | Media original % | Evaluables sin repetición | Media sin repetición % |
|---|---|---:|---:|---:|---:|
| A. Retroceso y recuperación | Alcista | 164 | 0.030 | 138 | 0.018 |
| A. Retroceso y recuperación | Bajista | 108 | 0.093 | 92 | 0.113 |
| B. Ruptura simple | Alcista | 305 | 0.049 | 278 | 0.040 |
| B. Ruptura simple | Bajista | 191 | 0.047 | 177 | 0.046 |

Rupturas simples: 580; coincidentes en la misma vela y dirección con 781 señales históricas de compresión: 173. Comparación descriptiva con contexto de tendencia y resultado de 30 minutos:

| Sentido | Rupturas evaluables | Media ruptura % | Compresiones históricas evaluables | Media compresión % | Coincidentes |
|---|---:|---:|---:|---:|---:|
| Alcista | 305 | 0.049 | 211 | 0.105 | 113 |
| Bajista | 191 | 0.047 | 109 | 0.068 | 60 |

La compresión histórica tiene su propia selección y separación de señales. Esta tabla no representa una prueba causal ni otra comparación principal.

La selección de estas hipótesis siguió estudios previos y puede estar afectada por revisión retrospectiva. Los resultados negativos y las referencias insuficientes se conservan. Una pequeña diferencia después de examinar muchas combinaciones no demuestra ventaja; una hipótesis favorable necesitaría datos nuevos posteriores al protocolo para validación prospectiva.
