# Fase 42B: reconstrucción histórica de contexto

## Estado parcial

La base de Airtable contiene las cuatro tablas solicitadas. Se confirmaron los 29 snapshots y 138 registros de pendientes mencionados en el encargo. Estos recuentos no son el número de oportunidades ni una muestra representativa. No se escribieron ni alteraron registros de Airtable.

El usuario proporcionó el texto de delegación, sin el ZIP original de capturas. Se capturaron las cuatro tablas en una carpeta privada nueva y se preparó una cola para los 138 pendientes, sin modificar snapshots ni atribuir estrategias. Los 167 lotes de entrada se refieren a 129 grupos de contratos y no equivalen a 167 operaciones independientes. El código inicial de auditoría no descarga velas, no demuestra autenticidad ni derechos de uso y no representa por sí solo una reconstrucción completa.

Los snapshots de los casos prioritarios contienen campos de origen, contexto e indicadores; eso no verifica por sí mismo las series originales ni su disponibilidad histórica. El archivo IBKR declara series en algunos marcos, pero los metadatos declarados no constituyen una auditoría OHLCV ni prueban que todos los casos estén cubiertos. Los marcos 1m y 5m, recepción histórica, ajustes y licencia deben verificarse por separado.

## Política temporal preliminar

Una vela solo es utilizable si su cierre físico y su disponibilidad respaldada son estrictamente anteriores al instante de entrada. El cierre por sí solo no demuestra recepción; las revisiones y ajustes retrospectivos tampoco prueban su disponibilidad histórica. Una ventana debe compararse con los intervalos completos derivados de un calendario oficial y con los metadatos de proveedor, fuente, ajuste y licencia. Los huecos, ausencia de procedencia o recepción desconocida producen `NO_VERIFICABLE`.

`phase42b-coverage.ts` implementa comprobaciones iniciales para Bollinger y SMA horaria sobre barras verificadas. El VWAP solo se calcula cuando existen VWAP de proveedor y volumen para todos los minutos exigidos, sin presentarlo como VWAP exacto a partir de OHLC. Su llamador futuro deberá obtener y verificar realmente el calendario y el carácter point-in-time antes de pasar esas condiciones; las banderas del contrato no son una prueba independiente. El auditor local 15m identifica ventanas previstas y ausencias sin calcular indicadores no verificados. En la primera ejecución encontró archivos locales para ocho pendientes; otros 130 carecían de fuente local 15m en las rutas auditadas. No certifica recepción previa ni ajustes históricos.

El usuario autorizó Alpaca SIP para uso personal. El nuevo descargador solicita ventanas de hasta 31 días con `feed=sip`, `adjustment=raw` y sin remapeo automático de símbolos; comprueba paginación, duplicados, OHLCV, errores y límite temporal. No cambia a IEX. Conserva respuestas y hashes privados, con su hora real de recepción actual. Las barras incluyen horas extendidas hasta que un análisis las filtre con el calendario oficial: no asumir que todas son RTH. Los precios `raw` no corrigen splits; hasta auditar eventos corporativos no se deben calcular ventanas históricas que los atraviesen como si fueran homogéneas.

Se recuperaron ventanas SIP para las primeras entradas AMD, GOOG y QQQ y los comparadores QQQ/SMH de AMD y GOOG. Las reconstrucciones locales enlazan los snapshots originales y califican los valores como `RETROSPECTIVO_NO_POINT_IN_TIME`, nunca como recepción histórica demostrada ni señal. Para QQQ a las 09:31 no hay un minuto que haya cerrado estrictamente antes de la entrada dentro de la sesión.

Se recorrieron los 138 pendientes: 63 tienen consultas SIP de acciones y 75 son SPXW. Con el calendario oficial, entre los 63 consultados la ventana de sesión anterior a la entrada tiene todas las barras esperadas en 61 casos de 1m, 48 de 5m y 32 de 15m; en los otros 2, 15 y 31 casos respectivamente no había ninguna vela de ese marco cerrada estrictamente antes de la entrada. Es una comprobación de presencia, no de calidad point-in-time, continuidad de sesiones anteriores ni disponibilidad original. Los marcos 1h/1d de acciones se descargaron en ventanas limitadas, insuficientes para garantizar SMA200.

La reconstrucción por lotes produjo Bollinger 15m condicional para los 63 lotes de acciones y contexto intradía condicional para 61; los dos restantes no tenían minutos cerrados estrictamente antes de la entrada. A partir de barras 15m completas y del calendario, se calcularon de forma condicional SMA20/40/100 horarias para los 63 casos y SMA20 diaria para 33; no hubo historia suficiente para SMA200 horaria ni para SMA40/100/200 diarias. El agregador de Trading-POC ancla sus velas horarias a la apertura regular, con la última abreviada; no se mezclan las barras horarias del proveedor que incluyen premercado. Cada registro conserva ID y enlace al lote de origen, hashes de las fuentes, hipótesis sin confirmar y evolución posterior separada. Estos resultados siguen marcados `NO_VERIFICABLE` por la ausencia de recepción point-in-time y de auditoría de eventos corporativos; no se han agregado como snapshots concluyentes a Airtable.

Con autorización posterior se consultó mediante IBKR el índice **SPX de CBOE**, sin sustituirlo por SPY. La cobertura intradía 15m obtenida comienza después de los pendientes; las series 1h y 1d sí ofrecen contexto parcial. Se validaron los horarios contra el calendario y las barras diarias con OHLC incoherente se conservaron en la fuente, pero se excluyeron de los cálculos: hubo 13 en toda la serie obtenida. De los 75 lotes, 51 tienen 201 cierres horarios consecutivos y 73 tienen 201 cierres diarios consecutivos para estimar retrospectivamente SMA200 y su pendiente; cada media se evalúa individualmente. La primera barra horaria RTH de 30 minutos se trata como barra abreviada conforme a la estructura recibida de IBKR. Estos cálculos no verifican recepción histórica, ni demuestran motivaciones. El índice no proporcionó volumen: VWAP y volumen del índice quedan no verificables.

Permanecen pendientes el intradía de SPX, ajustes corporativos y más historia para SMA de acciones, la verificación de noticias, las hipótesis que requieren una secuencia de retesteo o datos que faltan y toda escritura nueva a Airtable.

Una posible fuente adicional para el intradía de índices es [Massive, agregados por minuto de índices](https://massive.com/docs/flat-files/indices/minute-aggregates). La documentación consultada indica disponibilidad histórica para determinados planes y exclusión del plan gratuito en sus archivos históricos; no se ha verificado una cuenta, licencia ni acceso del usuario, y no se hizo ninguna contratación. También debe verificarse que el índice y el período concretos estén cubiertos antes de utilizarla.

La cola conserva los IDs Airtable originales, el enlace al trade, la clave `ticker|fecha_hora_ET|numero_imagen_compra`, conflictos y motivos de no verificabilidad. Las hipótesis están separadas de observaciones y evolución posterior; no son clasificaciones confirmadas. La conversión horaria rechaza horas ambiguas o inexistentes por DST. `SPXW` no se sustituye por SPY. Los controles existentes no se modifican ni se publican en Git.

## Comandos locales (Windows)

```powershell
npm.cmd run research:42b:capture -- --run-id captura-001
npm.cmd run research:42b:queue -- --source-run captura-001 --run-id cola-001
npm.cmd run research:42b:audit -- --queue-run cola-001 --run-id auditoria-001
npm.cmd run research:42b:controls -- --source-run captura-001 --run-id controles-001
npm.cmd run research:42b:batch -- --queue-run cola-001 --limit 3 --offset 0 --run-id lote-001
npm.cmd run research:42b:batch-audit -- --queue-run cola-001 --batch-run lote-001 --calendar-run calendario-001 --run-id auditoria-lote-001
npm.cmd run research:42b:summary -- --queue-run cola-001 --run-id resumen-001
npm.cmd run research:42b:batch-reconstruct -- --queue-run cola-001 --calendar-run calendario-001 --run-id reconstruccion-001
npm.cmd run research:42b:spx-audit -- --queue-run cola-001 --source-run spx-001 --calendar-old calendario-anterior --calendar-new calendario-reciente --run-id auditoria-spx-001
npm.cmd run research:42b:report -- --queue-run cola-001 --equity-run reconstruccion-001 --spx-run auditoria-spx-001 --run-id reporte-001
```

La captura usa el token privado configurado en `.env.local`, paginación del cliente existente y lectura solamente. Cada comando crea una carpeta nueva ignorada por Git y rechaza la sobrescritura. La captura escribe su manifiesto al final: si falta, el directorio es incompleto. La cola verifica hashes de las cuatro tablas y la auditoría verifica el hash de la cola. Los hashes detectan cambios, pero no prueban la autenticidad de la fuente. Los artefactos pueden contener información personal y no deben publicarse.

El lote admite hasta diez entradas por ejecución y `--offset` permite continuar por orden de prioridad. Mantener la misma cola versionada y usar un `--run-id` nuevo cada vez. Para las acciones se usan barras SIP; SPX y SPXW se excluyen de ese descargador y se estudian por separado con el índice IBKR. Las ventanas diarias de 30 días no permiten calcular automáticamente SMA200. La descarga no actualiza Airtable y no prueba disponibilidad en el instante original. La captura del índice realizada con el conector IBKR se conserva privadamente; el comando de auditoría consume esas respuestas y sus hashes, pero no instala ni inicia una conexión IBKR.

La revisión preliminar de los 29 controles encontró cuatro registros con al menos una marca horaria que no sería estrictamente anterior a la entrada **si** las barras de contexto fueran de un minuto; en doce no encontró el arreglo esperado. La duración real de esas barras y su recepción no están verificadas, por lo que son casos para revisión, no una conclusión de filtración. No se cambió ningún snapshot.

Los precios y movimientos del subyacente no demuestran la motivación del operador, no acreditan rentabilidad de opciones ni permiten estimar su tasa general de aciertos a partir de capturas seleccionadas. Investep y las hipótesis nuevas se mantienen separados.

Las explicaciones rivales incluyen fuerza relativa, catalizador, retesteo, VWAP, entrada anticipatoria y promediado. Las comparaciones condicionales separan observaciones compatibles y contradictorias de fuerza relativa y posición frente al VWAP; no demuestran el motivo del operador ni un toque o retesteo. Las demás hipótesis permanecen sin evidencia cuando faltan datos. Una noticia requiere fuente, hora de publicación y disponibilidad previas a la entrada. Los resultados posteriores se almacenarán aparte. No se ha atribuido ninguna noticia ni estrategia a los casos prioritarios.

Como ejemplo de la precaución temporal, la página identificada para el caso AMD muestra una publicación inicial a las 05:51 y una actualización posterior a la primera entrada. La versión actual del texto no demuestra qué contenido concreto estaba disponible antes de la entrada; tampoco se ha acreditado de forma independiente la zona horaria indicada por la página ni la recepción por el operador. Se registra como pista por verificar, no como noticia previamente conocida ni como catalizador demostrado. [Fuente consultada](https://www.investing.com/news/stock-market-news/amd-broadcom-gain-after-reports-say-nvidia-board-preparing-to-oust-huang-5020894).
