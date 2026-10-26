# Fase 41M: simulador interno de opciones NVDA

## Alcance y separación

**Simulador Paper** es un diario local de operaciones hipotéticas largas CALL/PUT. Una entrada o salida solo se registra tras una confirmación manual. No crea órdenes, no invoca `placeOrder`, no consulta posiciones ni ejecuciones del bróker y no aumenta suscripciones de mercado. `INTERNAL_SIMULATOR` y `MANUAL_HYPOTHETICAL` identifican los eventos. Sus IDs `SIM41M:*` nunca se usan como `executionId` de IBKR ni aparecen en `/api/v1/trades`, `/api/v1/executions` o `/api/v1/positions`.

La selección de contrato reutiliza exclusivamente el `conId` ya resuelto en Opciones. El servidor comprueba NVDA, USD, CALL/PUT, strike, multiplicador, vencimiento real y símbolo OCC si existe. Si la resolución de la cadena caducó, el usuario debe consultarla de nuevo. La apertura nunca resuelve contratos, solicita cotizaciones ni crea suscripciones. En PAPER puede registrarse una entrada sin cotización como prima **manual hipotética**; el servidor no inventa ASK, BID, calidad LIVE ni fill. Un contrato cuya fecha de vencimiento ya pasó no admite una entrada nueva PAPER.

La cotización copiada se vuelve a leer en el servidor desde el mismo `conId`. La prima debe coincidir con el ASK de entrada o BID de salida observado en ese momento. Se guarda proveedor, feed, hora de mercado, recepción y calidad de 41L; `UNKNOWN`, `DELAYED`, `FROZEN`, `DELAYED_FROZEN`, SIMULATED y cotizaciones sin timestamp verificable siguen etiquetados como tales. El precio copiado continúa siendo una **referencia**, con `fillStatus: HYPOTHETICAL` por convención del protocolo; no prueba una ejecución. Una prima manual no hereda calidad de mercado. La calidad LIVE de 41L exige procedencia IBKR verificable, timestamps causales y frescura de 30 segundos, sin tolerancia de reloj para un timestamp de mercado posterior a la recepción.

## Contratos, motor y eventos

`packages/contracts/src/paper-simulator.ts` declara solicitudes Zod estrictas, identidad de contrato, referencia de cotización y eventos versionados. `packages/market-domain/src/paper-simulator.ts` reconstruye posiciones sin red ni filesystem. Cada apertura crea un lote y una posición independiente; el endpoint `POST /positions/:id/add` permite agregar otro lote del mismo contrato. Dos posiciones del mismo OCC no se agregan entre sí. Los cierres consumen lotes FIFO en orden de entrada; no se permite agregar un lote o registrar una salida fuera de la secuencia económica causal. No existen posiciones cortas.

Eventos del ledger: `SIM_POSITION_OPENED`, `SIM_POSITION_LOT_ADDED`, `SIM_POSITION_PARTIALLY_CLOSED`, `SIM_POSITION_CLOSED`, `SIM_POSITION_NOTE_ADDED` y `SIM_POSITION_PLAN_UPDATED`. Las notas y el plan se agregan como eventos; no se edita la prima original. Esta fase no implementa una corrección económica retroactiva. Si una prima registrada era errónea, queda documentada y requiere un protocolo explícito futuro; no se sobrescribe el archivo.

Para `q` contratos, prima por acción `p` y multiplicador `m`, el costo bruto es `p × m × q`. Para cada salida, resultado bruto realizado = ingresos brutos de salida menos costo de los lotes FIFO consumidos. La comisión total de entrada conocida se asigna proporcionalmente a la cantidad cerrada del lote; el remanente exacto al centavo queda en la última salida. La comisión total de salida corresponde a esa salida. `0` significa costo explícitamente cero; vacío significa desconocido. Si falta cualquier comisión necesaria, el P&L neto realizado es `null`, no cero. Los importes se redondean a centavos para la contabilidad y se rechazan productos que excedan precisión monetaria segura de JavaScript. El porcentaje bruto realizado usa como denominador la base de costo de los contratos cerrados.

Las estadísticas cuentan posiciones **completamente cerradas**; un cierre parcial se muestra por separado. `DOCUMENTED_ON_TIME`, `HISTORICAL_SIMULATION` y `DEMO_SYNTHETIC` se informan en cohortes separadas. Los resultados brutos son matemáticos según primas introducidas; no constituyen evidencia de fills ni de ventaja estadística.

## Reloj, contexto y vencimiento

El operador declara `decisionAtUtc` y la hora hipotética de entrada o salida. `recordedAtUtc` se crea en el servidor durante la escritura. Una entrada o salida económica documentada con más de 60 segundos de retraso clasifica toda la posición como `HISTORICAL_SIMULATION`; no asciende a documentación puntual al cambiar manualmente una fecha. Incluso `DOCUMENTED_ON_TIME` es una declaración humana, no una certificación externa de ejecución. Una cotización recibida después de la decisión declarada no puede utilizarse como referencia conocida entonces.

El plan opcional registra motivo, tendencia observada, temporalidades, confirmación esperada, SMA, soportes/resistencias, invalidación y objetivos. Un `humanDecisionId` de Fase 17 se acepta solo si existe en el ledger humano íntegro de NVDA y se registró antes de la decisión. La ausencia de referencia no es un rechazo de Investep. Por defecto la interfaz informa `Technical context at entry: UNAVAILABLE`: no copia una SMA de hoy para justificar una entrada pasada. La integración con 41K y 41I solo podría mostrar referencias ya registradas y temporalmente verificables; no genera posiciones desde escenarios ni predicciones.

Una posición aún abierta después de la fecha de vencimiento pasa a `EXPIRED_UNRESOLVED`. La API rechaza también un POST directo de venta ordinaria en ese estado, sin añadir un evento. No se asigna una pérdida de 100 %, BID cero, liquidación o ejercicio automáticos. La comparación de vencimiento usa la fecha local de Nueva York; no afirma que sea posible negociar en cualquier hora de ese día. El calendario de vencimiento no verifica reglas específicas de ejercicio ni horarios de cierre anticipado de la serie; el operador debe documentar una resolución con un protocolo apropiado antes de atribuir resultados de vencimiento.

## Marca indicativa

La API lee únicamente el último BID ya presente en el `AgentHub` bajo el mismo `conId`; no se suscribe para vigilar posiciones. Se valoran las posiciones `OPEN` y `PARTIALLY_CLOSED` con cantidad restante; las `CLOSED` y `EXPIRED_UNRESOLVED` no reciben marca. `MARK_AVAILABLE` exige BID positivo y cotización `LIVE_RECENT` conforme a 41L. Los demás estados son `MARK_STALE`, `MARK_UNVERIFIED`, `MARK_MISSING` y `MARK_SIMULATED`. La valoración actual y el P&L no realizado actual son `N/D` si el BID no es verificable. La existencia de un BID positivo tampoco garantiza tamaño suficiente ni una venta al precio visible. Nunca se usa el precio de NVDA, un estudio XGBoost o LAST del subyacente como prima de opción.

## Persistencia, API y DEMO

En PAPER/OFFLINE el ledger está en `<privateRoot>/paper-simulator/` (`TRADING_POC_PRIVATE_DIR` o, opcionalmente, `TRADING_POC_SIMULATOR_DIR`). `.gitignore` ya excluye `private/`; en Windows el `privateRoot` predeterminado usa `%LOCALAPPDATA%\Trading-POC`. Cada evento ocupa un archivo numerado `00000001.json` con SHA-256 y `previousHash`; se escribe mediante archivo temporal, sincronización y renombrado. Un bloqueo exclusivo coordina procesos. La operación reabre, verifica y reconstruye el ledger dentro del bloqueo antes de decidir y escribir. `idempotencyKey` idéntica con solicitud idéntica devuelve el evento original; contenido diferente produce conflicto. Un ledger truncado, alterado o contradictorio se rechaza: nunca se interpreta como cartera vacía. El hash comprueba integridad accidental o manipulación detectable, **no autenticidad criptográfica** frente a un actor capaz de reescribir y recalcular toda la cadena.

Rutas locales bajo `/api/v1/simulator/`: `GET/POST positions`, `GET positions/:id`, `POST positions/:id/add`, `POST positions/:id/close`, `POST positions/:id/notes`, `POST positions/:id/plan`, `GET performance`, `GET ledger/verify`. Historial y posiciones aceptan paginación limitada. `GET positions` incluye `totalRemainingPremiumExposureUsd` calculado sobre todas las posiciones del replay verificado, sin depender de la página ni de IBKR/F17; el capital restante de la interfaz usa ese total. Si la suma excede la precisión monetaria segura, el total es `null` y la interfaz muestra `N/D`. Las escrituras usan el token local y origen loopback existente; el cuerpo pasa Zod estricto. No se aceptan rutas de archivos en las solicitudes. Errores de integridad no exponen rutas privadas.

DEMO utiliza solo memoria del proceso, con identidad `DEMO_SYNTHETIC` y contratos sintéticos. No escribe en el ledger privado PAPER y se vacía al reiniciar la aplicación. El vencimiento sintético de la cadena DEMO es `2027-01-15` para que la demostración de apertura funcione en octubre de 2026; no es una serie ni cotización real.

## Uso y verificación

1. Iniciar Trading-POC local y abrir **Opciones**.
2. Seleccionar un contrato NVDA, abrir su análisis y elegir **Registrar entrada simulada**.
3. Introducir prima manual o copiar explícitamente el ASK, cantidad, comisión total conocida o dejarla desconocida, y confirmar. Si el ASK cambió, volver a confirmar.
4. Abrir **Simulador Paper**, consultar la posición y registrar una salida parcial o total. Verificar `/api/v1/simulator/ledger/verify` para el recuento y hash de cabecera.

Validación local:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
```

Las pruebas usan contratos y precios sintéticos; no requieren TWS/OPRA. La interfaz no registra capital en un bróker ni ofrece stops, órdenes, ejecución automática, valoración inferida, asignación o estrategias multileg. Los costos fiscales y de ejecución permanecen fuera del modelo.
