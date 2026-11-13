# Fase 42B: reconstrucción histórica de contexto

## Estado parcial

La base de Airtable contiene las cuatro tablas solicitadas. Se confirmaron los 29 snapshots y 138 registros de pendientes mencionados en el encargo. Estos recuentos no son el número de oportunidades ni una muestra representativa. No se escribieron ni alteraron registros de Airtable.

El usuario proporcionó el texto de delegación, sin el ZIP original de capturas. Se capturaron las cuatro tablas en una carpeta privada nueva y se preparó una cola para los 138 pendientes, sin modificar snapshots ni atribuir estrategias. Los 167 lotes de entrada se refieren a 129 grupos de contratos y no equivalen a 167 operaciones independientes. El código inicial de auditoría no descarga velas, no demuestra autenticidad ni derechos de uso y no representa por sí solo una reconstrucción completa.

Los snapshots de los casos prioritarios contienen campos de origen, contexto e indicadores; eso no verifica por sí mismo las series originales ni su disponibilidad histórica. El archivo IBKR declara series en algunos marcos, pero los metadatos declarados no constituyen una auditoría OHLCV ni prueban que todos los casos estén cubiertos. Los marcos 1m y 5m, recepción histórica, ajustes y licencia deben verificarse por separado.

## Política temporal preliminar

Una vela solo es utilizable si su cierre físico y su disponibilidad respaldada son estrictamente anteriores al instante de entrada. El cierre por sí solo no demuestra recepción; las revisiones y ajustes retrospectivos tampoco prueban su disponibilidad histórica. Una ventana debe compararse con los intervalos completos derivados de un calendario oficial y con los metadatos de proveedor, fuente, ajuste y licencia. Los huecos, ausencia de procedencia o recepción desconocida producen `NO_VERIFICABLE`.

`phase42b-coverage.ts` implementa comprobaciones iniciales para Bollinger y SMA horaria sobre barras verificadas. El VWAP solo se calcula cuando existen VWAP de proveedor y volumen para todos los minutos exigidos, sin presentarlo como VWAP exacto a partir de OHLC. Su llamador futuro deberá obtener y verificar realmente el calendario, los derechos de uso y el carácter point-in-time antes de pasar esas condiciones; las banderas del contrato no son una prueba independiente. El auditor local 15m identifica ventanas previstas y ausencias sin calcular indicadores no verificados. En la primera ejecución encontró archivos locales para ocho pendientes; otros 130 carecían de fuente local 15m en las rutas auditadas. No certifica recepción previa ni ajustes históricos. Aún faltan fuentes autorizadas para los datos ausentes, auditoría completa de 1m, 5m, 1h y 1d, demás variables, contraevidencias y reconstrucciones verificables.

La cola conserva los IDs Airtable originales, el enlace al trade, la clave `ticker|fecha_hora_ET|numero_imagen_compra`, conflictos y motivos de no verificabilidad. Las hipótesis están separadas de observaciones y evolución posterior; no son clasificaciones confirmadas. La conversión horaria rechaza horas ambiguas o inexistentes por DST. `SPXW` no se sustituye por SPY. Los controles existentes no se modifican ni se publican en Git.

## Comandos locales (Windows)

```powershell
npm.cmd run research:42b:capture -- --run-id captura-001
npm.cmd run research:42b:queue -- --source-run captura-001 --run-id cola-001
npm.cmd run research:42b:audit -- --queue-run cola-001 --run-id auditoria-001
npm.cmd run research:42b:controls -- --source-run captura-001 --run-id controles-001
```

La captura usa el token privado configurado en `.env.local`, paginación del cliente existente y lectura solamente. Cada comando crea una carpeta nueva ignorada por Git y rechaza la sobrescritura. La captura escribe su manifiesto al final: si falta, el directorio es incompleto. La cola verifica hashes de las cuatro tablas y la auditoría verifica el hash de la cola. Los hashes detectan cambios, pero no prueban la autenticidad de la fuente. Los artefactos pueden contener información personal y no deben publicarse.

La revisión preliminar de los 29 controles encontró cuatro registros con al menos una marca horaria que no sería estrictamente anterior a la entrada **si** las barras de contexto fueran de un minuto; en doce no encontró el arreglo esperado. La duración real de esas barras y su recepción no están verificadas, por lo que son casos para revisión, no una conclusión de filtración. No se cambió ningún snapshot.

Los precios y movimientos del subyacente no demuestran la motivación del operador, no acreditan rentabilidad de opciones ni permiten estimar su tasa general de aciertos a partir de capturas seleccionadas. Investep y las hipótesis nuevas se mantienen separados.

Las explicaciones rivales incluyen fuerza relativa, catalizador, retesteo, VWAP, entrada anticipatoria y promediado. El registro inicial solo enumera esas hipótesis; no las considera demostradas ni interpreta el resultado posterior como validación. Una noticia requiere fuente, hora de publicación y disponibilidad previas a la entrada. Los resultados posteriores se almacenarán aparte. No se ha atribuido ninguna noticia ni estrategia a los casos prioritarios.
