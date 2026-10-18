# Fase 14: contexto de mercado y eventos de NVDA

**Adquisición, sincronización y auditoría descriptiva.** No se formuló ninguna estrategia ni se evaluó ventaja operativa. Todo 2021–2026 es historial ya disponible; las diferencias entre sesiones con y sin eventos no son efectos causales.

Protocolo fijado antes de adquirir datos: `docs/phase14-data-protocol.md` (commit `e10d01c4ba6011dd7ea6e183be83a283a469dc47`). Código usado: `01f3aaf1fa665ac41685a9a131e6315f0ae70156`.
CSV NVDA original SHA-256: `7b06d0a493515b18a581963d2d2d488e73a7cd0dc2c961b60a99315e7a9b0ecc`. QQQ: `962696cb57499ecf0991b1915975f5fe5725e7df7185654bfa4a2f71775eb2fb`; SMH: `d517e4652e9f4e44c715b5580dd4fa6d303b0a9f3246169027d142b2aac0cb55`.
Los JSON de Fases 11, 12 y 13 conservan hashes 05031c1371b2596efa7653e326cdad1325855454479a1e1f25c3aeff66f6ba1f, 3e1f2ddab92bee95c270a9f1f170574a4089c1d9bd3696287a343a30fc030f56 y 45f15df045e7210651745919bbd7f22a9eb88cc199638a1a9c606a7ade40c0e7.

## Información nueva y cobertura

Se adquirieron 32510 velas QQQ y 32510 velas SMH de Alpaca SIP, 15Min, ajuste split y sesión regular. NVDA aporta 32510. El calendario original contiene 1255 sesiones programadas, incluidos cierres anticipados. Hay 32510/32510 intervalos con los tres símbolos completos (100.00%).
Sesiones completas NVDA/QQQ/SMH: NVDA 1255, QQQ 1255, SMH 1255; parciales NVDA 0, QQQ 0, SMH 0; ausentes NVDA 0, QQQ 0, SMH 0. No se rellenaron huecos ni se desplazaron velas.
Las tres series declaran `adjustment=split`. Como control descriptivo de discontinuidad, el mayor salto entre cierre regular y siguiente apertura fue NVDA 26.195% (2023-05-24→2023-05-25); QQQ -5.349% (2024-08-02→2024-08-05); SMH -8.018% (2024-08-02→2024-08-05). Esta comprobación no certifica individualmente cada acción corporativa de Alpaca.
Variables completas de cuatro velas y volumen comparable (NVDA/QQQ/SMH): NVDA 28745/29674, QQQ 28745/29674, SMH 28745/29674 intervalos; las referencias iniciales y los cierres anticipados reducen cobertura sin rellenar datos.
Calendario oficial: 237 eventos económicos (59 CPI, 59 Employment Situation, 119 piezas FOMC) y 20 anuncios originales de resultados NVIDIA. Hora exacta verificada: 182/257; sin hora verificable: 75. Días con múltiples registros: 50.
| Categoría | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 | Hora verificada / total |
|---|---|---|---|---|---|---|---|
| FOMC | 5 | 23 | 24 | 24 | 26 | 17 | 64/119 |
| EMPLOYMENT_SITUATION | 2 | 12 | 12 | 12 | 11 | 10 | 59/59 |
| CPI | 2 | 12 | 12 | 12 | 11 | 10 | 59/59 |
| NVIDIA_EARNINGS | 1 | 4 | 4 | 4 | 4 | 3 | 0/20 |
Las 1242 señales originales de Fases 11–12 quedaron enlazadas a su intervalo exacto y régimen de Fase 13; 1242 tienen las tres velas presentes. Los retornos originales de 30 minutos se copiaron sin recalcular.

## Descripción de mercado: sesiones con y sin publicación verificada

| Año | Bloque | Sesión con evento verificado | Velas NVDA | Sesiones | Muestra pequeña | Retorno vela medio % | P10/P50/P90 retorno % | Rango intravela medio % | P10/P50/P90 rango % |
|---|---|---|---|---|---|---|---|---|---|
| all | all | no | 27920 | 1078 | no | 0.001 | -0.493 / 0.000 / 0.487 | 0.663 | 0.255 / 0.531 / 1.221 |
| all | all | sí | 4590 | 177 | no | 0.007 | -0.540 / 0.011 / 0.538 | 0.728 | 0.266 / 0.575 / 1.350 |

La etiqueta de sesión con evento incluye velas anteriores al instante de publicación; sirve solo para descripción de sesión. La tabla sincronizada causal marca noticias conocidas únicamente cuando su timestamp es anterior al cierre de la vela. Rango intravela = 100 × (high−low)/open; no es un resultado de operación.

### Por año

| Año | Bloque | Sesión con evento verificado | Velas NVDA | Sesiones | Muestra pequeña | Retorno vela medio % | P10/P50/P90 retorno % | Rango intravela medio % | P10/P50/P90 rango % |
|---|---|---|---|---|---|---|---|---|---|
| 2021 | all | no | 1184 | 46 | no | -0.002 | -0.588 / 0.000 / 0.609 | 0.773 | 0.273 / 0.631 / 1.461 |
| 2021 | all | sí | 182 | 7 | sí | 0.014 | -0.862 / 0.031 / 0.634 | 1.019 | 0.389 / 0.831 / 1.843 |
| 2022 | all | no | 5552 | 214 | no | 0.000 | -0.680 / 0.000 / 0.663 | 0.893 | 0.409 / 0.747 / 1.575 |
| 2022 | all | sí | 962 | 37 | no | 0.006 | -0.708 / 0.000 / 0.719 | 0.976 | 0.436 / 0.788 / 1.765 |
| 2023 | all | no | 5540 | 214 | no | 0.005 | -0.432 / 0.000 / 0.442 | 0.591 | 0.265 / 0.491 / 1.027 |
| 2023 | all | sí | 936 | 36 | no | 0.038 | -0.439 / 0.036 / 0.495 | 0.629 | 0.273 / 0.509 / 1.111 |
| 2024 | all | no | 5632 | 218 | no | -0.001 | -0.504 / 0.012 / 0.480 | 0.674 | 0.279 / 0.540 / 1.240 |
| 2024 | all | sí | 884 | 34 | no | 0.010 | -0.568 / 0.032 / 0.567 | 0.752 | 0.297 / 0.588 / 1.428 |
| 2025 | all | no | 5540 | 214 | no | 0.003 | -0.449 / 0.005 / 0.438 | 0.604 | 0.210 / 0.466 / 1.128 |
| 2025 | all | sí | 924 | 36 | no | -0.002 | -0.522 / 0.010 / 0.461 | 0.664 | 0.225 / 0.495 / 1.348 |
| 2026 | all | no | 4472 | 172 | no | -0.001 | -0.362 / 0.000 / 0.366 | 0.497 | 0.210 / 0.399 / 0.891 |
| 2026 | all | sí | 702 | 27 | no | -0.025 | -0.399 / -0.014 / 0.347 | 0.499 | 0.210 / 0.412 / 0.909 |

### Por bloque horario desde 09:30 NY

| Año | Bloque | Sesión con evento verificado | Velas NVDA | Sesiones | Muestra pequeña | Retorno vela medio % | P10/P50/P90 retorno % | Rango intravela medio % | P10/P50/P90 rango % |
|---|---|---|---|---|---|---|---|---|---|
| all | 0 | no | 4312 | 1078 | no | -0.010 | -0.950 / 0.000 / 0.911 | 1.214 | 0.550 / 1.058 / 2.052 |
| all | 0 | sí | 708 | 177 | no | 0.027 | -0.970 / 0.059 / 0.996 | 1.226 | 0.547 / 1.059 / 2.115 |
| all | 1 | no | 4312 | 1078 | no | 0.006 | -0.558 / 0.003 / 0.565 | 0.735 | 0.347 / 0.645 / 1.229 |
| all | 1 | sí | 708 | 177 | no | -0.007 | -0.609 / 0.000 / 0.588 | 0.767 | 0.352 / 0.647 / 1.284 |
| all | 2 | no | 4312 | 1078 | no | 0.003 | -0.443 / 0.000 / 0.447 | 0.575 | 0.269 / 0.503 / 0.974 |
| all | 2 | sí | 708 | 177 | no | -0.006 | -0.488 / 0.000 / 0.466 | 0.606 | 0.257 / 0.497 / 1.003 |
| all | 3 | no | 4294 | 1078 | no | 0.003 | -0.396 / 0.003 / 0.396 | 0.509 | 0.232 / 0.439 / 0.855 |
| all | 3 | sí | 706 | 177 | no | -0.007 | -0.412 / 0.007 / 0.362 | 0.521 | 0.231 / 0.435 / 0.896 |
| all | 4 | no | 4276 | 1069 | no | 0.007 | -0.349 / 0.000 / 0.365 | 0.480 | 0.213 / 0.406 / 0.813 |
| all | 4 | sí | 704 | 176 | no | 0.019 | -0.412 / 0.013 / 0.445 | 0.597 | 0.222 / 0.464 / 1.104 |
| all | 5 | no | 4276 | 1069 | no | -0.004 | -0.380 / 0.000 / 0.361 | 0.489 | 0.209 / 0.411 / 0.849 |
| all | 5 | sí | 704 | 176 | no | 0.019 | -0.490 / 0.000 / 0.475 | 0.667 | 0.237 / 0.518 / 1.234 |
| all | 6 | no | 2138 | 1069 | no | 0.006 | -0.463 / 0.000 / 0.451 | 0.607 | 0.260 / 0.522 / 1.027 |
| all | 6 | sí | 352 | 176 | no | 0.006 | -0.534 / 0.021 / 0.461 | 0.697 | 0.284 / 0.567 / 1.255 |

Los estratos año × bloque horario están completos en `phase14-data-audit.json`. Los grupos menores de 30 velas o 10 sesiones se marcan como muestra pequeña. La comparación no controla sorpresas, dirección del anuncio, régimen ni cambios estructurales; no atribuye causalidad.

## Disponibilidad de noticias y límites

BLS publica calendario con horas Eastern verificables para CPI y Employment Situation. El comunicado FOMC usa la hora explícita de su propia página; las actas usan la fecha de publicación y la hora cuando figura en la página de conferencia vinculada. Las conferencias sin hora comprobable se conservan con fecha sola. Los comunicados originales de resultados de NVIDIA verifican la fecha, pero no la hora exacta de salida: los 20 quedan sin emparejamiento causal intradía ni marca inferida de reacción posterior. La hora de una conferencia no se reemplaza por la del resultado.
Los calendarios archivados pueden reflejar correcciones posteriores; se conserva URL y hash de cada página consultada, pero no se afirma que toda hora programada se conociera con la misma anticipación. Solo se cubren estas categorías; otras noticias relevantes no aparecen. El calendario BLS no lista una publicación CPI para cada mes del período y no se inventaron entradas faltantes.
Consensos históricos verificables: 0/257; sorpresas calculadas: 0. No se usaron cifras actuales o revisadas para rellenar expectativas antiguas.
Para datos de sesión regular, una publicación anterior a la apertura solo puede relacionarse con velas posteriores a 09:30; no se afirma conocer la trayectoria premarket. Una noticia a la hora exacta del cierre de una vela queda disponible desde la vela siguiente por prudencia. QQQ y SMH incluyen exposición a NVDA; diferencias de retornos no miden fuerza independiente.

## Permisos de datos y reproducción

Los términos públicos de Alpaca indican uso personal/no comercial y requieren aviso previo para ofrecer contenido a terceros; no se verificó permiso específico de redistribución de SIP. Por ello **los CSV originales QQQ/SMH y la tabla íntegra con OHLCV permanecen locales**. `phase14-synchronized-bars.csv` publica una fila por intervalo, marcas de cobertura/evento y un hash de cada fila privada, sin precios ni volúmenes. El CSV privado completo queda en `output/real/phase14-synchronized-bars-full.csv` con SHA-256 indicado en la auditoría. `phase14-signal-context.csv` contiene variables porcentuales derivadas solo en las señales seleccionadas, sin OHLCV original. Las fuentes oficiales y sus hashes están en el manifiesto.
Para reconstruir, colocar en `data/` los tres historiales SIP con sus sidecars de hashes indicados, ejecutar `npm ci` y `npm run validate:phase14-context`. QQQ/SMH pueden adquirirse de nuevo con `NODE_USE_ENV_PROXY=1 npm run import:phase14-market` usando acceso Alpaca autorizado; el importador reutiliza fragmentos válidos y no sobrescribe archivos finales.

## Conclusión

Ahora existen barras sincronizadas completas de tres símbolos, calendario oficial macroeconómico y fechas originales de resultados NVIDIA, además de una unión exacta con señales previas. Faltan horas originales verificadas de resultados, consenso económico histórico y autorización de redistribución SIP. Estos datos permiten **formular** estudios futuros sobre mercado amplio, semiconductores y horarios de noticias con reglas nuevas y datos posteriores; aquí no se descubre ni declara una estrategia rentable.
