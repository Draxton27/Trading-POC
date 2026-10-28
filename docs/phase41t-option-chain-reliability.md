# Fase 41T: cadena de opciones fuera de horario

## Observación real y alcance

El 27 de octubre de 2026, Gateway Paper estuvo READY y devolvió vencimientos NVDA. Para 20261030, dos definiciones del strike 140 llegaron a la pantalla; cuatro de los strikes 136 y 138 no llegaron. El PUT 140 tuvo `conId` 923039418. BID/ASK quedaron `N/D` y se vieron estados DELAYED y partial. No se guardaron los códigos de los cuatro fallos. Por eso **no sabemos** si fueron combinaciones inexistentes, pacing, timeout o identidad incompatible. La falta de precios tampoco prueba por sí sola ausencia de OPRA.

Se verificaron dos limitaciones del código anterior: la cadena solo centraba strikes con un dato IBKR de hasta 30 segundos o una vela IEX reciente con recolector activo; y procesaba solicitudes secuencialmente dentro de un presupuesto común. Una respuesta lenta podía consumir el presupuesto de contratos posteriores.

## Referencias de exploración

La prioridad es: IBKR LIVE reciente, vela IEX completa reciente, última vela IEX de 15 minutos **que termina exactamente al cierre de una sesión regular verificada por el calendario Alpaca**, y strike manual. No se utiliza el SIP local antiguo como cierre actual. La referencia histórica se deriva exclusivamente del ledger IEX Live con cadena de hashes válida y su primera versión; requiere calendario que cubra el día actual y no puede estar a más de una sesión bursátil. Viernes a lunes y feriados se cuentan por sesiones del calendario, no por horas. Una última vela intradía no se convierte en cierre de sesión. Si faltan calendario, barra completa, recepción posterior al cierre o cobertura suficiente, la pantalla exige un strike manual.

La API identifica la referencia histórica con `referenceKind=HISTORICAL_EXPLORATION`, fuente, observación UTC, recepción UTC, fecha de sesión NY y edad en sesiones. `isCurrent=false` e `isExecutable=false`. Solo centra la lista de strikes; no alimenta Radar, elegibilidad operativa, ITM/OTM ni el análisis de opciones como precio actual. El cierre de la última vela tampoco se presenta como cierre oficial diario. La búsqueda `GET /api/v1/options/strikes?expiration=YYYYMMDD&near=140&limit=25` devuelve strikes cercanos sin resolver ni suscribir contratos. Cuando no hay referencia histórica admisible, se elige el centro manualmente.

## Diagnóstico y presupuestos

Cada lado conserva su identidad y resultados por separado. `definitionStatus`, `subscriptionStatus` y `quoteStatus` separan la resolución del contrato, la suscripción y los ticks recibidos. Los errores conservan `right`, strike, etapa, `requestId`, `twsRequestId` cuando IBKR lo entregó, `ibkrCode`, duración y campos de identidad incompatibles. El backend registra solo estos datos acotados, nunca cuenta completa, secreto ni respuesta cruda. Un contrato resuelto permanece visible aunque sus BID/ASK sean `N/D`. `NOT_FOUND` no equivale a `INVALID_CONTRACT`, y `PAGE_TIMEOUT` significa que la combinación todavía no fue verificada.

`SUBSCRIPTION_LIMIT` conserva su identidad desde el código IBKR 101 hasta el transporte, AgentHub y la incidencia por CALL/PUT. El límite local de diez permanece separado del permiso del proveedor. Si una suscripción falla, el refresco de solo lectura conserva ese fallo para la definición en la conexión actual; un BID/ASK previo no vuelve a clasificarla como Live. Un reintento exitoso elimina el fallo. Si IBKR indica `marketDataStatus=unavailable`, `quoteStatus=UNAVAILABLE` prevalece aun con precios numéricos previos. La etiqueta de la cadena dice «Cotización no disponible» y el resumen cuenta «BID/ASK presentes (no necesariamente vigentes)»: presencia de campos no implica frescura, permisos ni ejecutabilidad.

Las definiciones más cercanas a la referencia se resuelven primero, con CALL y PUT por strike; se mantienen solicitudes secuenciales y límites de AgentHub. La página sigue siendo parcial si agota presupuesto o suscripciones. El botón **Reintentar** vuelve a consultar de forma explícita. `/options/quotes` solo lee cotizaciones de definiciones todavía válidas en el caché y en la conexión actual; no resuelve ni suscribe. El comparador también exige caché vigente de esa conexión. Un cambio de conexión o vencimiento invalida la presentación anterior.

Los códigos de mercado se interpretan según [IBKR TWS Error Codes](https://www.interactivebrokers.com/docs/tws-api/doc/error-handling/error-codes): 354 indica falta de suscripción; 10089, falta de permiso para usar los datos mediante API; 10090 y 10091 indican que **parte** de los ticks solicitados no está disponible con las suscripciones actuales, por lo que se conservan BID/ASK realmente recibidos; 10186 indica que los datos retrasados solicitados no están habilitados; 10197 informa conflicto explícito de sesiones de datos de mercado. El código 101 y el límite local de diez suscripciones se distinguen como `SUBSCRIPTION_LIMIT`. No se infiere 10197 de una desconexión genérica. Los feeds LIVE, DELAYED, FROZEN, DELAYED_FROZEN y UNKNOWN permanecen diferenciados; una definición válida no acredita OPRA ni un precio ejecutable. [IBKR describe](https://interactivebrokers.github.io/tws-api/options.html) que la lista de parámetros de opciones no garantiza que cada combinación de vencimiento y strike exista: se confirma con `reqContractDetails`.

## Comprobación manual en Windows

1. Abrir IB Gateway oficial en **Paper**, autenticar allí y ejecutar `npm.cmd run ibkr:gateway:doctor`. Confirmar READY, cuenta DU coincidente, backend y agente conectados. No introducir credenciales en Trading-POC.
2. Ejecutar `npm.cmd run dev:gateway`, abrir Opciones y elegir el vencimiento real. Si falta una referencia válida, abrir «Más strikes», buscar cerca de un precio conocido y elegir un strike como centro **manual**.
3. Capturar el resumen, expandir «Ver detalles técnicos» y registrar para cada CALL/PUT el strike, `conId` si existe, etapa, códigos, `requestId`, `twsRequestId`, estado de suscripción, feed y BID/ASK. Se pueden ocultar las cuentas; no copiar secretos.
4. Comparar un CALL y un PUT exactos. Reintentar solo las solicitudes fallidas con el botón. Comprobar que cambiar vencimiento y cerrar Opciones libera consumidores. Una identidad válida con cotización ausente debe seguir visible.
5. Registrar si IBKR entregó 354, 10090, 10186 o 10197 antes de atribuir una causa de permisos o sesión. Las pruebas automáticas usan fixtures y no acreditan el resultado de esta prueba real.

No se alteraron XGBoost, Radar, Investep, ledgers ni la interfaz de órdenes.
