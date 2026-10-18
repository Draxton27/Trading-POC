# Fase 17 — catálogo de criterios observables

Estas variables son descriptores candidatos; ninguna es filtro obligatorio ni regla confirmada del operador. Se calculan con velas completamente cerradas y datos efectivamente recibidos. Los niveles trazados a mano conservan procedencia distinta de máximos, mínimos o medias calculados. Cuando falta el timestamp de una noticia o dibujo, su disponibilidad anterior a una decisión es desconocida. El CSV equivalente está en [phase17-feature-catalog.csv](../shared-artifacts/phase17-human-method/phase17-feature-catalog.csv).

| Grupo | Variable | Temporalidad | Fórmula propuesta | Datos necesarios | Primer momento conocible |
| --- | --- | --- | --- | --- | --- |
| Tendencia | sma_20 | 15m/1h/1d según registro | media aritmética de los últimos 20 cierres completos | cierres ajustados y calendario | cierre de la vela n completa |
| Tendencia | sma_20_slope | misma que SMA | SMA20(t)-SMA20(t-1); unidad precio por vela | dos SMA consecutivas completas | cierre de la segunda SMA |
| Tendencia | price_to_sma_20_pct | misma que SMA | 100 × (último cierre-SMA20)/SMA20 | último cierre completo y SMA | cierre de la vela de referencia |
| Tendencia | sma_40 | 15m/1h/1d según registro | media aritmética de los últimos 40 cierres completos | cierres ajustados y calendario | cierre de la vela n completa |
| Tendencia | sma_40_slope | misma que SMA | SMA40(t)-SMA40(t-1); unidad precio por vela | dos SMA consecutivas completas | cierre de la segunda SMA |
| Tendencia | price_to_sma_40_pct | misma que SMA | 100 × (último cierre-SMA40)/SMA40 | último cierre completo y SMA | cierre de la vela de referencia |
| Tendencia | sma_100 | 15m/1h/1d según registro | media aritmética de los últimos 100 cierres completos | cierres ajustados y calendario | cierre de la vela n completa |
| Tendencia | sma_100_slope | misma que SMA | SMA100(t)-SMA100(t-1); unidad precio por vela | dos SMA consecutivas completas | cierre de la segunda SMA |
| Tendencia | price_to_sma_100_pct | misma que SMA | 100 × (último cierre-SMA100)/SMA100 | último cierre completo y SMA | cierre de la vela de referencia |
| Tendencia | sma_200 | 15m/1h/1d según registro | media aritmética de los últimos 200 cierres completos | cierres ajustados y calendario | cierre de la vela n completa |
| Tendencia | sma_200_slope | misma que SMA | SMA200(t)-SMA200(t-1); unidad precio por vela | dos SMA consecutivas completas | cierre de la segunda SMA |
| Tendencia | price_to_sma_200_pct | misma que SMA | 100 × (último cierre-SMA200)/SMA200 | último cierre completo y SMA | cierre de la vela de referencia |
| Tendencia | sma_order | 15m/1h/1d según registro | orden de SMA20,40,100,200; igualdad explícita | cuatro SMA completas en la misma temporalidad | cierre de la última SMA disponible |
| Tendencia | sma_pair_distance_pct | misma temporalidad para ambas | 100 × (SMA_a-SMA_b)/SMA_b para cada par a,b | dos SMA completas y par declarado | cierre de ambas SMA |
| Tendencia | recent_sma_cross | misma temporalidad para precio y SMA | cambio de signo de cierre-SMA entre dos velas completas; registrar barras transcurridas | dos cierres y dos SMA; ventana predefinida después | cierre de la segunda vela |
| Tendencia | daily_hourly_direction_consistency | 1d + 1h | comparar signos de cierres completos frente a SMA elegidas; sin resolver contradicción por defecto | último día y hora completos, SMA especificadas | cierre posterior de ambas referencias |
| Estructura | previous_session_high | sesión regular 15m | máximo high de última sesión bursátil completa anterior | OHLCV 15m y calendario | cierre verificado de la sesión anterior |
| Estructura | previous_session_low | sesión regular 15m | mínimo low de última sesión bursátil completa anterior | OHLCV 15m y calendario | cierre verificado de la sesión anterior |
| Estructura | previous_period_high | período declarado por operador | máximo high de período completo previo declarado | OHLCV y definición explícita de período | cierre completo del período |
| Estructura | previous_period_low | período declarado por operador | mínimo low de período completo previo declarado | OHLCV y definición explícita de período | cierre completo del período |
| Estructura | manual_support | temporalidad y sesión declaradas | precio o zona inferior/superior tal como fue trazada; sin cálculo automático | anotación original, autor, capturedAt/drawnAt y hash | hora verificable de trazado; desconocida si falta |
| Estructura | manual_resistance | temporalidad y sesión declaradas | precio o zona inferior/superior tal como fue trazada; sin cálculo automático | anotación original, autor, capturedAt/drawnAt y hash | hora verificable de trazado; desconocida si falta |
| Estructura | distance_to_level_pct | temporalidad del nivel | 100 × (último cierre-precio del nivel)/precio del nivel; para zona guardar distancias a ambos bordes | último cierre completo y nivel disponible | máximo entre cierre de vela y trazado del nivel |
| Estructura | close_side_of_level | temporalidad del nivel y vela | comparación estricta cierre >, < o = media/nivel | cierre completo y nivel/medio conocido | cierre de la vela |
| Estructura | pullback_recovery | 15m + referencia declarada | registrar lado previo, toque por high/low y cierre de recuperación; definición exacta pendiente | dos velas completas y nivel congelado | cierre de vela de recuperación |
| Bollinger | band_position | 15m | (cierre-banda inferior)/(banda superior-banda inferior); ancho cero = nulo | Bollinger 20/2 y cierre completo | cierre de vela actual |
| Bollinger | band_width_pct | 15m | 100 × (banda superior-banda inferior)/media central; media cero = nulo | Bollinger 20/2 de cierres completos | cierre de vela actual |
| Bollinger | band_width_change | 15m | ancho(t)-ancho(t-1), sin umbral optimizado | anchos de dos velas completas | cierre de vela actual |
| Bollinger | band_mid_slope | 15m | media central(t)-media central(t-1) | dos medias centrales completas | cierre de vela actual |
| Bollinger | band_level_relation | 15m + nivel declarado | distancias de banda superior/inferior a nivel o bordes de zona | bandas completas y nivel manual/calculado con procedencia | máximo entre cierre de vela y disponibilidad del nivel |
| Contexto | qqq_direction | 15m, últimas cuatro consecutivas | signo de 100 × (cierre último/apertura primera-1); cero explícito | cuatro velas QQQ completas y recibidas | recepción de la cuarta vela |
| Contexto | smh_direction | 15m, últimas cuatro consecutivas | signo de 100 × (cierre último/apertura primera-1); cero explícito | cuatro velas SMH completas y recibidas | recepción de la cuarta vela |
| Contexto | historical_volatility_atr14 | 1d | ATR14% causal de Fase 13, calculado al cierre de D-1 | 14 TR diarios completos y 120 referencias previas para régimen | cierre de D-1 y recepción de datos |
| Contexto | verified_macro_event | timestamp del anuncio | categoría CPI/empleo/FOMC y tiempo desde publicación real | evento con fuente, hora y verificación | máximo de hora de publicación y verificación |
| Contexto | known_earnings_date | día y hora verificables | fecha anunciada; distinguir hora programada de publicación real | comunicado original NVIDIA y hora de consulta | hora en que el calendario era público; resultado solo tras publicación |
| Contexto | news_availability | timestamp UTC | disponible si publicación y verificación ocurrieron antes del corte | URL, publishedAtUtc, verifiedAtUtc y recepción | máximo de publicación, verificación y recepción |
| Contexto | no_trade_condition | hora de decisión | motivo textual registrado; codificación posterior separada | decisión humana y documentedAtUtc | documentación real del operador |

La pendiente se expresa en precio por vela, sin convertirla en señal. Distancias y porcentajes requieren denominador positivo. Cruces y recuperaciones no se usan para atribuir al operador umbrales o ventanas que no confirmó. La consistencia diaria/horaria registra conflicto como conflicto. Las variables de QQQ/SMH describen retornos recibidos, sin presumir causalidad por su exposición a NVDA.
