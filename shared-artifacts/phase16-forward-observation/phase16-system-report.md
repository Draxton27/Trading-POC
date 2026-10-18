# Fase 16 — infraestructura de observación prospectiva

El protocolo se congeló en el commit `3afe2424e9f452faf6c79d9cca073f6366538221`, con inicio `2026-10-19T13:30:00.000Z`. A la fecha de la prueba seca no existe ninguna observación prospectiva. Las 6 señales y 18 evaluaciones de estos CSV se reconstruyeron con datos históricos exclusivamente para comprobar código e integridad; **no son evidencia prospectiva ni disponibilidad operativa**.

## Funcionamiento

`observe:phase16` solicita calendario real Alpaca y barras SIP split de NVDA, QQQ y SMH, registra recepción e integridad por barra, y ejecuta las reglas originales F11/F12 sobre prefijos causales. Cada señal se fija como `pending` antes de agregar desenlaces. `settle:phase16` agrega evaluaciones separadas de 15, 30 y 60 minutos; el resultado teórico y la disponibilidad operativa son campos distintos. Se conservan MFE, MAE y exclusiones. No existe código de órdenes.

El diario derivado está en `shared-artifacts/phase16-forward-observation/live/ledger/` y es de solo adición, con hash encadenado, IDs estables, reintentos idempotentes y correcciones por entrada adicional. Las barras completas SIP se guardan en `trading_poc_001_bollinger/output/phase16-private/`, excluido de Git. **Tras cada ejecución real, el operador debe auditar y hacer commit/push del nuevo lote derivado a GitHub**; hasta entonces el archivo local no garantiza persistencia entre entornos. No hay programación automática.

## Acceso y límites

El snapshot SIP dio HTTP 403, el snapshot IEX HTTP 200 y la consulta SIP histórica posterior al cierre HTTP 200 el domingo 2026-10-18. La latencia de un mercado abierto sigue sin medirse. El sistema solo solicita SIP; una recepción posterior a la apertura siguiente se marca no ejecutable. IEX no sustituye SIP. El calendario futuro de eventos económicos requiere un archivo verificado adicional; sin él se informa `unavailable`, nunca «sin noticias». La cuenta no se usó para órdenes.

## Prueba manual

La ejecución seca confirmó un ejemplo histórico de cada una de las seis familias y reprodujo sus resultados originales a 30 minutos, fijando primero señales y luego evaluaciones en un diario temporal con 24 registros y último hash `8b48dd1d7422570bcb0394ded65a95fa0b34c6d222f2af6ca5b34b429408aaef`. Para la prueba real se necesitan credenciales Alpaca vigentes, reloj UTC correcto, red y persistencia GitHub tras la ejecución. Las primeras 60 sesiones registradas serán auditoría operativa; no se evaluó rentabilidad.
