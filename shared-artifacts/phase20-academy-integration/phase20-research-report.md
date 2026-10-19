# Informe de investigación documental — Fase 20

## Evidencia observada

Se revisaron localmente una tabla de rangos, dos exportaciones de tabla fechadas y material complementario. Las tres fuentes de rangos tenían 53 registros. Los documentos no se copiaron a este repositorio. El modelo conserva el hash, la ubicación de tabla y el resultado normalizado, en una base local ignorada por Git.

## Conclusiones verificables

- Los rangos se tratan como prima ASK unitaria por instrucción explícita del operador.
- Hay fecha de análisis por fila, pero no un período de vigencia declarado.
- No hay evidencia suficiente de una fórmula reproducible ni de que un rango antiguo siga vigente.
- La evaluación exige ASK LIVE, timestamps de mercado y recepción recientes, USD y multiplicador 100. No usa `last` ni presenta feeds retrasados, congelados, desconocidos o simulados como precios ejecutables.

## Límites

Un ASK dentro de un rango documentado no evalúa tendencia, liquidez, vencimiento, rentabilidad ni conveniencia. La integración no incorpora envío de órdenes y no ha validado OPRA real durante esta fase.
