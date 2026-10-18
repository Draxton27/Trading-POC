# Fase 15 — concordancia de mercado y señales de NVDA

**Decisión: Inconclusa.** Estudio exploratorio retrospectivo sobre 2021–2026; ninguna subdivisión es validación prospectiva. No se evaluó ejecución real ni rentabilidad de opciones.

## Resultado principal

Se contrastaron los retornos firmados de NVDA a 30 minutos entre señales con QQQ y SMH concordantes y señales con ambos ETF contrarios. La diferencia cruda fue **0.0319 puntos porcentuales** y la diferencia ajustada por estratos exactos de familia, año, bloque horario y régimen fue **-0.0538 pp**; intervalo percentil por 2.000 remuestreos de sesiones: **[-0.2111, 0.1207] pp**. Semilla: 15015. Los grupos completos contienen 560 y 261 desenlaces; el soporte común contiene 173 y 136 en 92 estratos. Cobertura de soporte: 30.9% y 52.1%; tamaños efectivos de Kish 139.5 y 121.9. Comparabilidad insuficiente según el protocolo.

| Familia | Concordantes | Contrarios | Diferencia cruda (pp) | Diferencia ajustada (pp) |
|---|---:|---:|---:|---:|
| breakout_bearish | 139 | 5 | 0.7408 | 0.2411 |
| breakout_bullish | 205 | 15 | 0.1084 | 0.1477 |
| failed_high_bearish | 52 | 75 | 0.0136 | 0.1005 |
| failed_low_bullish | 59 | 73 | -0.2161 | -0.4449 |
| pullback_bearish | 41 | 42 | 0.0272 | 0.0787 |
| pullback_bullish | 64 | 51 | 0.1459 | -0.0156 |

Estas seis familias son hipótesis históricas distintas; las diferencias del conjunto dependen también de su composición. Los desgloses son secundarios.

El intervalo ajustado incluye cero y el efecto cambia de signo entre años. En particular, las rupturas bajistas tienen solo cinco desenlaces contradictorios, por lo que su diferencia individual es muy frágil. La comparación principal no demuestra mejora; la cobertura insuficiente del soporte común impide descartar una asociación de otra magnitud en datos nuevos. No se buscaron otros umbrales retrospectivos.

## Riesgo, sensibilidad y estabilidad

Promedio MFE/MAE a 30 minutos: concordancia 0.4809/-0.4401 pp; contradicción 0.4228/-0.4308 pp. MFE no es rentabilidad ejecutable: se desconoce el orden intravela. Porcentaje de cierre favorable: 53.8% y 54.0%. Los costos son escenarios completos hipotéticos sobre acciones.

| Costo (pb) | Media neta concordancia (pp) | Media neta contradicción (pp) | Fracción neta positiva concordancia | Fracción neta positiva contradicción |
|---:|---:|---:|---:|---:|
| 0 | 0.0526 | 0.0207 | 0.5375 | 0.5402 |
| 5 | 0.0026 | -0.0293 | 0.4964 | 0.4943 |
| 10 | -0.0474 | -0.0793 | 0.4750 | 0.4253 |
| 20 | -0.1474 | -0.1793 | 0.3589 | 0.3602 |

| Año | Concordantes | Contrarios | Diferencia cruda (pp) | Diferencia ajustada (pp) |
|---|---:|---:|---:|---:|
| 2021 | 18 | 12 | -0.0979 | -0.3639 |
| 2022 | 119 | 55 | 0.0454 | -0.2561 |
| 2023 | 142 | 43 | 0.0513 | 0.2246 |
| 2024 | 87 | 48 | 0.1441 | 0.0088 |
| 2025 | 110 | 58 | 0.0265 | 0.0022 |
| 2026 | 84 | 45 | -0.0448 | -0.3041 |

La sensibilidad a controles originales conserva 971 señales con referencia; diferencia ajustada de exceso respecto a control: -0.0616 pp, con 65 estratos compartidos. No reemplaza el resultado principal. El horizonte de 15 minutos da -0.0644 pp y 60 minutos -0.1663 pp, ambos secundarios.

## Noticias verificadas

El calendario incluye 159 publicaciones con hora verificada entre CPI, Employment Situation y comunicados FOMC. 24 señales cerraron antes y 121 después de al menos una publicación verificada del mismo día; 2 coincidieron exactamente. Varias publicaciones pueden corresponder a una señal.

| Categoría | Posición | Señales | Media firmada 30m (pp) |
|---|---|---:|---:|
| CPI | before | 0 | N/D |
| CPI | after | 56 | 0.1529 |
| CPI | at | 0 | N/D |
| EMPLOYMENT_SITUATION | before | 0 | N/D |
| EMPLOYMENT_SITUATION | after | 37 | 0.0296 |
| EMPLOYMENT_SITUATION | at | 0 | N/D |
| FOMC | before | 24 | 0.0855 |
| FOMC | after | 28 | -0.1720 |
| FOMC | at | 2 | -1.4645 |

Los resultados de NVIDIA sin hora exacta no se asignaron a ventanas intradía; no hubo consensos históricos verificables para calcular sorpresas. Las diferencias por noticias son descriptivas y no prueban causalidad.

## Integridad y límites

Se verificó la identidad de 1242 señales (F11 876; F12 366) en F13 y su contexto F14, incluyendo índices, timestamps, horizontes y controles. Hubo 137 horizontes principales incompletos, 154 señales repetidas y 50 desenlaces solapados; se conservaron para auditoría. El SHA-256 del CSV NVDA SIP es `7b06d0a493515b18a581963d2d2d488e73a7cd0dc2c961b60a99315e7a9b0ecc`; el código ejecutado corresponde al commit `9ff477c9a141f8b324afa30318e9e154234e2a24` y el protocolo al commit `7ab491edb2c040b096213764ded69352cf593aad`. Los ETF incluyen exposición a NVDA y los grupos pueden diferir en factores no observados. No se publican velas SIP originales ni se infiere una ventaja operativa causal.
