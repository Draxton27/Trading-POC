# Fase 41U: explorador económico de opciones NVDA

La cadena de opciones mantiene CALL a la izquierda y PUT a la derecha. El modo inicial busca tres strikes alrededor de la primera referencia admisible de 41T: último precio IBKR Live reciente, vela IEX Live reciente, cierre verificado de la sesión IEX anterior para **exploración histórica**, o centro manual. El usuario puede ampliar a cinco niveles, elegir otra fecha o strike y volver explícitamente a la referencia de NVDA. La referencia histórica no se transforma en precio actual ni se usa para ITM/OTM; se muestra solo distancia descriptiva y fecha. DEMO usa contratos sintéticos.

## Presupuesto y filtros

«Por presupuesto» permite capital hipotético, costo máximo por contrato, cantidad y comisión de entrada declarada. La cantidad inicial es una. La comisión desconocida permanece desconocida. El costo bruto es `ASK × multiplicador × cantidad`; el porcentaje de capital usa el desembolso con los costos de entrada conocidos. No se consulta la cuenta IBKR ni se aplica un límite automático del 3 %. «Exploración libre» conserva selección de lado, vencimiento, búsqueda de strikes y paginación.

Los filtros opcionales e independientes son ASK mínimo y máximo, costo bruto máximo **total**, spread máximo sobre precio medio y DTE mínimo y máximo. Todos comienzan vacíos. Un ASK ausente no vale cero: el costo y cualquier filtro que lo requiera quedan `NO_EVALUABLE`. Sin BID, el spread queda `NO_EVALUABLE` aunque exista ASK. Una suscripción fallida, permiso denegado o cotización declarada no disponible tampoco valida el costo actual aunque queden ticks anteriores. Los feeds retrasados, congelados, obsoletos y sintéticos conservan importes observados como descripciones, con calidad visible. «Mostrar solo coincidencias evaluables» puede ocultar temporalmente otros niveles; desactivarlo conserva acceso a todos los contratos consultados.

**Los filtros se aplican a los contratos consultados, no a toda la cadena de IBKR.** Ningún filtro abre una búsqueda masiva, suscripción ni orden. Una coincidencia significa solo que las cifras disponibles caen dentro de límites hipotéticos del usuario; no implica recomendación, liquidez, ejecución ni rentabilidad probable.

## Resolución acotada de contratos

La consulta inicial conserva tres o cinco strikes y el presupuesto global de diez suscripciones compartidas. Si una definición inicial devuelve `NOT_FOUND` definitivo, la cadena puede intentar hasta **dos resoluciones adicionales en total** por consulta, en orden de proximidad a la referencia y para el mismo lado. Un segundo `NOT_FOUND` puede consumir el intento restante. `TIMEOUT`, `PAGE_TIMEOUT`, `PACING`, `DISCONNECTED` e `INVALID_CONTRACT` detienen la búsqueda de reemplazos para ese caso. Cada intento conserva `requestedStrike`, `resolvedStrike`, lado, vencimiento, recuentos y motivo. Un reemplazo se presenta como **otra fila con su strike real**, nunca como el conId de la fila original. El conId exacto enviado por Radar sigue fijado y su identidad no se sustituye.

El caché negativo dura 60 segundos y se limita al vencimiento, lado, strike y conexión IBKR. Solo guarda `NOT_FOUND`. El cambio de conexión obliga a resolver de nuevo. La ruta de refresco de cotizaciones sigue sin crear suscripciones. Los intentos adicionales comparten el deadline de la página y no alteran el límite global de diez; una definición no encontrada no consume una suscripción.

## Lectura económica

La tabla prioriza BID, ASK y costo bruto; muestra spread, DTE, calidad y, si se declara capital, porcentaje comprometido. Delta y Theta permanecen en detalles avanzados. El panel lateral reutiliza `analyzeLongOption()` de 41L para explicar prima por acción, multiplicador, costo, pérdida máxima de prima y equilibrio bruto al vencimiento. Son hipótesis matemáticas de una opción larga, sin garantía de compra al ASK ni de venta al BID. El rango ASK documental Investep conserva procedencia, fecha, vigencia y estado; es distinto del strike y no funciona como filtro automático ni recomendación vigente.

El comparador conserva cuatro conId como máximo y recalcula el costo bruto y capital comprometido con la cantidad y capital hipotéticos. Muestra BID, ASK, spread, DTE, equilibrio, distancia a la referencia y feed/recepción por contrato. Las diferencias son descriptivas: mezclar fechas, feeds y vencimientos limita la comparabilidad. No se elige un «mejor contrato».

## Verificación y límites

Las pruebas de contrato y E2E usan agentes y respuestas sintéticas; no acreditan disponibilidad OPRA ni la resolución de combinaciones reales en Gateway Paper. Las capturas DEMO y de fixtures Paper están en `test-results/phase41u-explorer/` y se excluyen de Git. La configuración, credenciales, ledgers, modelos y estudios existentes permanecen fuera de este flujo.
