# Fase 42B: reconstrucción histórica de contexto

## Estado parcial

La base de Airtable contiene las cuatro tablas solicitadas. Se confirmaron los 29 snapshots y 138 registros de pendientes mencionados en el encargo. Estos recuentos no son el número de oportunidades ni una muestra representativa. No se escribieron ni alteraron registros de Airtable.

El documento de delegación mencionado por el usuario todavía no está disponible en el entorno. Por ello esta fase aún no procesa los lotes, no modifica snapshots ni atribuye estrategias. El código inicial de auditoría es una pieza aislada para datos ya obtenidos: no descarga información, no demuestra autenticidad ni derechos de uso y no representa por sí solo una reconstrucción completa.

Los snapshots de los casos prioritarios contienen campos de origen, contexto e indicadores; eso no verifica por sí mismo las series originales ni su disponibilidad histórica. El archivo IBKR declara series en algunos marcos, pero los metadatos declarados no constituyen una auditoría OHLCV ni prueban que todos los casos estén cubiertos. Los marcos 1m y 5m, recepción histórica, ajustes y licencia deben verificarse por separado.

## Política temporal preliminar

Una vela solo es utilizable si su cierre físico y su disponibilidad respaldada son estrictamente anteriores al instante de entrada. El cierre por sí solo no demuestra recepción; las revisiones y ajustes retrospectivos tampoco prueban su disponibilidad histórica. Una ventana debe compararse con los intervalos completos derivados de un calendario oficial y con los metadatos de proveedor, fuente, ajuste y licencia. Los huecos, ausencia de procedencia o recepción desconocida producen `NO_VERIFICABLE`.

`phase42b-coverage.ts` implementa una comprobación inicial de ventanas intradía y cálculo de Bollinger sobre las barras verificadas. Su llamador futuro deberá obtener y verificar realmente el calendario, los derechos de uso y el carácter point-in-time antes de pasar esas condiciones; las banderas del contrato no son una prueba independiente. Aún faltan los conectores, el calendario diario, el procesamiento progresivo, las demás variables y el registro de hipótesis y contraevidencias.

Los precios y movimientos del subyacente no demuestran la motivación del operador, no acreditan rentabilidad de opciones ni permiten estimar su tasa general de aciertos a partir de capturas seleccionadas. Investep y las hipótesis nuevas se mantienen separados.
