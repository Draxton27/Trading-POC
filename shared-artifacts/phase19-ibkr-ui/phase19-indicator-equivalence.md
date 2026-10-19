# Indicadores mostrados frente al motor de investigación

`MarketChart` ya no invoca los indicadores nativos MA/BOLL de KLineChart para la serie de investigación. Solicita `/market/indicators` para las mismas velas paginadas y dibuja `POC_SMA` y `POC_BOLL` con los valores devueltos. KLineChart conserva solo la presentación de velas y volumen.

El motor usa cierres de velas completas: SMA 20/40/100/200 y Bollinger 20/2. La desviación es poblacional (`suma((cierre - media)^2)/20`). Antes de completar la ventana se devuelve nulo. Una vela incompleta no genera indicador ni incorpora su cierre. Los agregados horarios y diarios OFFLINE provienen de las funciones existentes con calendario Alpaca, incluidos cierres anticipados; las pruebas históricas de esos agregados siguen intactas. Los valores no se adelantan al inicio de la vela.

La prueba de regresión compara vela por vela las tres temporalidades DEMO con `calculateBollinger` original y verifica cada SMA; otra cambia cierres futuros y una vela incompleta sin alterar valores anteriores. La paridad de Fase 2 con `trading-signals` sigue cubierta por su prueba previa. No se modificaron detectores ni resultados F9–18. La representación visual precisa de cada trazo depende de KLineChart y se comprueba con las pruebas de navegador DEMO; no se ha cotejado pixel a pixel con un gráfico TWS.
