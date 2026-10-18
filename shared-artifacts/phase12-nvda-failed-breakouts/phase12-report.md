# Fase 12: rupturas fallidas del máximo y mínimo previo de NVDA

Estudio retrospectivo **exploratorio**. Ninguna fecha dentro de este archivo constituye validación prospectiva. No se investigan opciones ni se generan operaciones reales.

Fuente: NVDA_ALPACA_SIP_15min_20211017_20261017.csv. SHA-256 del CSV fuente: `7b06d0a493515b18a581963d2d2d488e73a7cd0dc2c961b60a99315e7a9b0ecc`.
Versión del código utilizada: `51ac6bdc67f0249897160eb81b3ae6940c2ef252` (commit previo a generar estos artefactos).
Velas: 32510; rango UTC: 2021-10-18T13:30:00.000Z a 2026-10-16T19:45:00.000Z.
Sesiones observadas: 1255 de 1255; 0 ausentes y 0 parciales.
Sesiones con nivel anterior válido: 1254; sin nivel anterior: 1.

El protocolo fijo previo al análisis está en `docs/phase12-research-protocol.md`. La ruptura inicial no es una señal de reversión: la falla exige retorno estricto en la primera o segunda vela siguiente. La entrada hipotética sigue al cierre de confirmación; el horizonte principal termina al cierre de la segunda vela posterior.

## Dos comparaciones principales: 30 minutos

| Hipótesis | Rupturas iniciales | Fallas | Sin regreso | Observación incompleta | Evaluables | Sesiones | Con control | Favorables | IC 95% favorables | Media % | Favorable media % | Desfavorable media % | MFE media % | MAE media % | Media emparejada % | Control % | Diferencia % | IC 95% diferencia % | p Holm |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| A. Falla del máximo (bajista) | 543 | 182 | 311 | 50 | 165 | 129 | 105 | 54.5% | [0.470, 0.620] | 0.078 | 0.460 | -0.396 | 0.458 | -0.384 | 0.056 | -0.002 | 0.058 | [-0.072, 0.185] | 0.7616 |
| B. Falla del mínimo (alcista) | 520 | 184 | 300 | 36 | 172 | 134 | 104 | 49.4% | [0.416, 0.573] | -0.047 | 0.450 | -0.551 | 0.460 | -0.518 | -0.085 | -0.023 | -0.062 | [-0.214, 0.091] | 0.7616 |

El control principal procede de otras rupturas iniciales del mismo lado, año, bloque horario local y desplazamiento de confirmación; no habían fallado **hasta ese momento**. Para una falla en la primera observación, no se mira la segunda para seleccionar controles. Se necesitan diez observaciones de diez sesiones distintas. La diferencia es la media emparejada menos el control; la columna «Media %» incluye todas las señales evaluables. El intervalo y p se calculan solo en señales emparejadas. Se remuestrean sesiones completas 2.000 veces y se aplica Holm a las dos pruebas principales.

MFE es el máximo movimiento favorable y MAE el máximo desfavorable entre entrada y salida; los extremos dentro de una vela no tienen un orden conocido ni son ganancias/pérdidas ejecutables.

## Clasificación

- **A. Falla del máximo (bajista): Inconclusa por muestra insuficiente.** Menos de 100 resultados, 50 sesiones o 80 % de eventos con control comparable.
- **B. Falla del mínimo (alcista): Inconclusa por muestra insuficiente.** Menos de 100 resultados, 50 sesiones o 80 % de eventos con control comparable.

Ninguna etiqueta inconclusa demuestra una ventaja ni justifica avanzar por sí sola a una validación prospectiva.

## Horizontes secundarios: 15 y 60 minutos

| Hipótesis | Horizonte | Evaluables | Favorables | Media % | MFE % | MAE % | Diferencia con control % | IC 95% diferencia % |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| A. Falla del máximo (bajista) | 15m | 174 | 47.1% | 0.019 | 0.309 | -0.286 | 0.053 | [-0.026, 0.130] |
| A. Falla del máximo (bajista) | 60m | 156 | 51.3% | 0.092 | 0.662 | -0.516 | 0.019 | [-0.153, 0.188] |
| B. Falla del mínimo (alcista) | 15m | 180 | 49.4% | -0.025 | 0.341 | -0.368 | -0.004 | [-0.100, 0.091] |
| B. Falla del mínimo (alcista) | 60m | 163 | 52.8% | -0.056 | 0.639 | -0.700 | -0.099 | [-0.305, 0.098] |

Estos horizontes no reemplazan retroactivamente la prueba de 30 minutos.

## Costos hipotéticos por operación completa sobre acciones

| Hipótesis | Costo (pb) | Media neta % | Favorables netas |
|---|---:|---:|---:|
| A. Falla del máximo (bajista) | 0 | 0.078 | 54.5% |
| A. Falla del máximo (bajista) | 5 | 0.028 | 47.9% |
| A. Falla del máximo (bajista) | 10 | -0.022 | 44.2% |
| A. Falla del máximo (bajista) | 20 | -0.122 | 32.7% |
| B. Falla del mínimo (alcista) | 0 | -0.047 | 49.4% |
| B. Falla del mínimo (alcista) | 5 | -0.097 | 47.1% |
| B. Falla del mínimo (alcista) | 10 | -0.147 | 43.0% |
| B. Falla del mínimo (alcista) | 20 | -0.247 | 36.0% |

Estos costos no son una estimación certificada de ejecución. No se calcula rentabilidad de opciones.

## Años y cortes cronológicos: horizonte principal

Corte 70/30 de sesiones en 2025-04-21. Ambos tramos son históricos, no prospectivos.

| Tramo | Hipótesis | Rupturas | Fallas | Sin regreso | Incompletas | Evaluables | Sesiones | Con control | Media % | Media emparejada % | Control % | Diferencia % | IC 95% diferencia % |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| first70 | A. Falla del máximo (bajista) | 393 | 129 | 232 | 32 | 115 | 89 | 82 | 0.071 | 0.051 | -0.018 | 0.070 | [-0.093, 0.228] |
| first70 | B. Falla del mínimo (alcista) | 368 | 130 | 216 | 22 | 123 | 99 | 73 | -0.080 | -0.099 | -0.012 | -0.087 | [-0.294, 0.097] |
| last30 | A. Falla del máximo (bajista) | 150 | 53 | 79 | 18 | 50 | 40 | 23 | 0.093 | 0.072 | 0.055 | 0.016 | N/D |
| last30 | B. Falla del mínimo (alcista) | 152 | 54 | 84 | 14 | 49 | 35 | 31 | 0.037 | -0.052 | -0.050 | -0.002 | [-0.182, 0.203] |
| 2021 | A. Falla del máximo (bajista) | 22 | 4 | 17 | 1 | 3 | 3 | 0 | 0.280 | N/D | N/D | N/D | N/D |
| 2021 | B. Falla del mínimo (alcista) | 31 | 14 | 12 | 5 | 12 | 8 | 0 | -0.011 | N/D | N/D | N/D | N/D |
| 2022 | A. Falla del máximo (bajista) | 123 | 48 | 68 | 7 | 44 | 33 | 30 | 0.155 | 0.150 | 0.045 | 0.106 | [-0.201, 0.424] |
| 2022 | B. Falla del mínimo (alcista) | 130 | 38 | 85 | 7 | 36 | 32 | 29 | -0.155 | -0.020 | -0.037 | 0.018 | N/D |
| 2023 | A. Falla del máximo (bajista) | 104 | 27 | 66 | 11 | 25 | 22 | 24 | -0.119 | -0.116 | -0.062 | -0.054 | N/D |
| 2023 | B. Falla del mínimo (alcista) | 101 | 45 | 53 | 3 | 42 | 34 | 26 | -0.022 | -0.096 | -0.010 | -0.086 | N/D |
| 2024 | A. Falla del máximo (bajista) | 110 | 37 | 66 | 7 | 32 | 23 | 24 | 0.019 | 0.078 | -0.062 | 0.141 | N/D |
| 2024 | B. Falla del mínimo (alcista) | 68 | 16 | 45 | 7 | 16 | 15 | 11 | -0.039 | -0.206 | 0.033 | -0.239 | N/D |
| 2025 | A. Falla del máximo (bajista) | 108 | 45 | 49 | 14 | 40 | 31 | 18 | 0.151 | 0.115 | -0.010 | 0.125 | N/D |
| 2025 | B. Falla del mínimo (alcista) | 88 | 42 | 40 | 6 | 38 | 26 | 15 | -0.021 | -0.177 | -0.001 | -0.176 | N/D |
| 2026 | A. Falla del máximo (bajista) | 76 | 21 | 45 | 10 | 21 | 17 | 9 | 0.071 | 0.021 | 0.176 | -0.155 | N/D |
| 2026 | B. Falla del mínimo (alcista) | 102 | 29 | 65 | 8 | 28 | 19 | 23 | 0.001 | -0.036 | -0.062 | 0.026 | N/D |

## Exclusiones, SMA descriptivas y dependencia entre eventos

- A. Falla del máximo (bajista): cierre de sesión 17; siguiente vela ausente 0; horizonte interrumpido 0; sin controles suficientes 60.
- B. Falla del mínimo (alcista): cierre de sesión 12; siguiente vela ausente 0; horizonte interrumpido 0; sin controles suficientes 68.
Contexto SMA al inicio de la confirmación, **sin filtrar señales**: alcista 179, bajista 138, contradictorio 43, igualdad 0, insuficiente 6.
Señales repetidas en menos de cuatro barras: 42; ventanas principales solapadas: 0; señales retenidas al quitar repeticiones: 331.

| Hipótesis | Evaluables originales | Media original % | Evaluables sin repetición | Media sin repetición % |
|---|---:|---:|---:|---:|
| A. Falla del máximo (bajista) | 165 | 0.078 | 147 | 0.045 |
| B. Falla del mínimo (alcista) | 172 | -0.047 | 158 | -0.063 |

La sensibilidad sin repetición es descriptiva y no sustituye la prueba principal. Los episodios sin regreso figuran en el CSV de eventos; los controles de primera observación pueden incluir episodios que fallaron más tarde.

## Límites de interpretación

El emparejamiento restringe año, horario y tipo de ruptura, pero no elimina diferencias de volatilidad, noticias o liquidez. El remuestreo mantiene los controles fijos. Se preservan resultados desfavorables y casos sin control. Las hipótesis fueron formuladas después de analizar el historial previo; un resultado histórico favorable requeriría datos nuevos posteriores al protocolo.
