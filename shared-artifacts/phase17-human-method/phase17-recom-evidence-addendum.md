# Identificación posterior del indicador Finviz Recom

**Fecha de documentación:** 2026-10-18 (UTC). Se conoce el día de recepción de la aclaración en esta conversación; no se conoce la hora original de la captura ni la fecha de mercado a la que corresponde.

**Trazabilidad:** la afirmación `PRE07` en el [registro original](phase17-operator-evidence-register.csv) decía que el indicador era desconocido. Se conserva como estado histórico del resumen de audio pendiente de cotejo. La fila `PRE07_V2` añade la aclaración posterior del usuario y la captura aportada en esta conversación. La captura se describe aquí para auditoría; **su archivo original, hash y metadatos no están disponibles en el repositorio** y no se publica una copia. La captura muestra claramente `Recom 1.21`, separado de `Volatility` y `ATR (14)`. No se atribuye un símbolo, fecha ni hora de mercado a ese valor.

**Fuente del campo y escala:** [Finviz, ayuda del screener](https://finviz.com/help/screener), sección “Analyst Recommendation”: 1.0 Strong Buy, 2.0 Buy, 3.0 Hold, 4.0 Sell, 5.0 Strong Sell. La página se consultó el 2026-10-18. `Recom` refleja una recomendación de analistas, **no** una medida de volatilidad.

**Criterio declarado por el operador:** `Recom < 2,5` (desigualdad estricta) para considerar una empresa favorable para invertir. El valor visible 1,21 satisface ese criterio aritmético. Esto documenta una declaración discrecional, no un rendimiento comprobado, una probabilidad ni una regla de entrada intradía. La aclaración y la captura identifican el campo y su valor visible; no certifican una transcripción literal de los ocho audios.

**Pendiente de confirmación:** si “invertir en la empresa” se refiere a compra de acciones, selección previa de empresas para operar opciones, compra de CALL, compra de PUT o exclusión de determinados activos; cómo, cuándo y para qué símbolo consultó el operador `Recom`; y si aplica el criterio en todos los casos. No usar `Recom` como predictor intradía ni añadirlo a los seis detectores congelados. Un ejemplo auténtico con hora de consulta y decisión permitiría cotejar el uso real sin inventar condiciones.
