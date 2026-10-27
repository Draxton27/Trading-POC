# Fase 41Q — cadena de opciones NVDA

## Alcance

La cadena Paper consulta definiciones IBKR de NVDA y presenta hasta cinco CALL o PUT por petición. La identidad del contrato, el permiso de cotización y el precio son verificaciones distintas. Ninguna ruta emite órdenes. DEMO sigue usando exclusivamente contratos sintéticos identificados como tales.

## `INVALID_CONTRACT`: diagnóstico y corrección

El síntoma real del 27/10/2026 fue: vencimiento `20261028`, 84 strikes, cinco CALL rechazadas. No se conservó una respuesta cruda de `ContractDetails`, por lo que **el campo que falló en esas cinco respuestas sigue sin demostrarse**. El adaptador anterior omitía `tradingClass` y `twsRequestId`, y la API comparaba literalmente la fecha y números devueltos. La documentación de [IBKR Contract](https://ibkrcampus.com/docs/tws-api/ref/contract) define `right` como `C/CALL/P/PUT`, `strike` y `multiplier` como numéricos, y `tradingClass` como un campo de identidad. La versión fijada de `@stoqey/ib` lee `lastTradeDateOrContractMonth` de `ContractDetails`; su decodificador puede conservar un sufijo horario. Este es un **mecanismo plausible** para el rechazo anterior, sujeto al registro de una respuesta TWS auténtica.

`validateOptionIdentity()` valida `conId` positivo, `OPT`, NVDA, USD, lado, fecha exacta YYYYMMDD con un sufijo horario IBKR inequívoco, strike exacto, multiplicador 100 y `tradingClass=NVDA`. Acepta solo `C/CALL` y `P/PUT`; no redondea strikes ni infiere campos ausentes. Los errores parciales incluyen el campo discrepante. Un log del backend incluye `requestId`, `twsRequestId`, `conId`, valores solicitados y resueltos y `mismatchFields`, sin cuentas ni credenciales. Una respuesta ambigua del adaptador sigue siendo `AMBIGUOUS`.

La inspección de contratos del Radar utiliza ahora la misma validación y normalización que la cadena principal. Una definición IBKR con vencimiento seguido de hora, lado `C/P` y campos numéricos en texto se acepta en ambas rutas si su identidad coincide; símbolos, fechas o strikes incompatibles se rechazan con los campos discrepantes. La inspección conserva su presupuesto de consultas y libera cada suscripción al terminar.

**Verificación pendiente:** repetir con TWS Paper auténtico y revisar el log `contract_identity_mismatch`. Las pruebas sintéticas no acreditan que los cinco contratos reales ya se resuelvan.

## Carga inicial y procedencia

Al entrar en Opciones, la pantalla pide vencimientos futuros de IBKR, elige el primero disponible y solicita hasta cinco strikes cercanos. Prioriza el último precio NVDA recibido por IBKR con feed LIVE durante los últimos 30 segundos. Si no existe, lee la proyección local 41P de una vela IEX completa: recolector activo, feed `SUBSCRIBED`, estado `CURRENT` o `PARTIAL`, recepción durante los últimos 15 minutos y cierre de vela durante los últimos 30 minutos. La hora de la vela y la hora de recepción aparecen por separado. El cierre IEX no es un tick actual ni un precio ejecutable. Nunca se usa el cierre SIP histórico como centro automático.

Si falta una referencia admisible, la interfaz ofrece los strikes paginados para selección manual; no usa el punto medio. “Todos los strikes” muestra páginas de 50 y solo consulta cinco definiciones al seleccionar un strike. El filtro avanzado de rango permanece disponible. La selección de vencimiento inicial usa la fecha local de Nueva York.

Los parámetros y definiciones conservan sus cachés de 60 segundos y los presupuestos TWS existentes. La cadena conserva los contratos correctos aunque otros fallen. `GET /options/quotes?conIds=...` solo lee cotizaciones de definiciones previamente resueltas; se consulta cada cinco segundos, sin abrir suscripciones ni reconstruir la cadena. El consumidor de la cadena se libera al cambiar de selección o abandonar la vista; el comparador y el análisis usan consumidores separados y también se liberan. Una definición válida puede permanecer sin BID/ASK o sin permiso OPRA.

## Interfaz y calidad

La vista principal muestra fuente y hora de la referencia, lado, vencimiento, strike, BID/ASK **por acción**, spread, costo bruto por contrato calculado por el motor 41L, calidad y acciones. Los datos avanzados se despliegan dentro del detalle. El comparador admite cuatro conId, incluso de vencimientos distintos, y permanece plegado inicialmente. El análisis reutiliza el motor 41L y la entrada hipotética 41M requiere confirmación manual. `N/D` sustituye cualquier precio o métrica ausente. La cotización LIVE sin timestamp de mercado verificable continúa clasificada `LIVE_UNVERIFIED`; no se crea `marketTimestampUtc`.

Al cambiar CALL/PUT o vencimiento, se retira el detalle y el formulario de simulación del contrato anterior. Una selección de análisis realizada desde el comparador se identifica expresamente como independiente del filtro de la cadena. Cuando el operador elige manualmente un strike por falta de precio admisible del subyacente, la referencia se rotula «Strike de referencia manual»; ese valor no se presenta como cotización observada de NVDA.

Los errores de identidad se resumen sin ocultar los contratos válidos y se pueden expandir por campo. El menú lateral tiene nombres accesibles aun cuando se oculta su texto en móvil. La tabla admite desplazamiento horizontal en pantallas pequeñas.

## Validación

- Pruebas de identidad: lados, fecha, strike, multiplicador, subyacente, conId, divisa, tipo y trading class.
- Pruebas de selección: IBKR reciente, IEX completo y conectado, fuente obsoleta o ausente.
- API: cinco contratos con un rechazo, caché de definiciones, lectura de cotizaciones sin suscripciones adicionales, permisos y datos ausentes.
- Paridad Radar/cadena: vencimiento IBKR con sufijo horario, normalización de lado y números, rechazo por campos incompatibles y liberación de suscripciones.
- E2E DEMO/PAPER simulado: análisis, comparador, liberación de consumidores, fallo parcial, teclado y móvil.
- E2E: cambio CALL/PUT y vencimiento limpia el detalle y simulador; strike manual se rotula sin atribuirlo a una cotización.

No se consultaron TWS ni cuentas reales durante la automatización. La disponibilidad OPRA y la corrección de los cinco contratos auténticos requieren repetir la prueba en Paper con permisos de mercado conocidos.

### Ejecución local de esta rama

La validación completa y la CI del commit correctivo se registran en el PR #77. La prueba con TWS Paper auténtico sigue pendiente; las pruebas de estas correcciones usan un agente simulado.
