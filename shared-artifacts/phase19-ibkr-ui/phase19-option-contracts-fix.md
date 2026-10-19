# PR #25: contratos de opciones IBKR Paper

## Hallazgo y decisión

En la prueba auténtica comunicada por el usuario, expirations, strikes, positions y executions respondieron, mientras contracts devolvió HTTP 500 por timeout. El backend esperaba 5 s, pero una solicitud de detalles en TWS podía tardar 10 s. Además, varios contratos se consultaban secuencialmente y una respuesta posterior al timeout cerraba el canal del agente. La prueba auténtica confirma el fallo original; el código corregido se ha ensayado con respuestas simuladas. Todavía falta repetirlo contra TWS Paper real.

El backend ahora concede 20 s por resolución, 35 s para parámetros (incluye contrato subyacente y cadena), 20 s para suscripción y 60 s por página. TWS concede 10 s por detalles o parámetros y espacia solicitudes al menos 220 ms, con máximo de cinco solicitudes por segundo en el cliente IB. Las variables en los archivos `.env.example` permiten ajustar límites de manera acotada: TWS 5–15 s, backend resolución y suscripción 20–30 s, parámetros 35–45 s, página 40–120 s. Si se agota la página, cada strike pendiente tiene error `PAGE_TIMEOUT`. Si TWS tarda más que su presupuesto, se reporta `TIMEOUT` en etapa `contract_details` u `option_parameters`; si expira el backend, la etapa es `backend`.

Cada respuesta se asocia a `requestId`, tipo y conexión. Una respuesta tardía válida se descarta tras registrar duración y etapa, sin cerrar el WebSocket. Una suscripción confirmada después de expirar se cancela si ningún consumidor la necesita. Al reemplazar la conexión, las solicitudes pendientes reciben `DISCONNECTED` y las respuestas del socket anterior no se inyectan en la conexión nueva. Los registros incluyen tipo, duración, requestId, etapa, código clasificado y código numérico IBKR cuando existe; nunca cuenta, secreto ni texto bruto de IBKR.

`/options/contracts` devuelve contratos resueltos y errores por strike en el mismo HTTP 200. El contrato se valida contra vencimiento, lado, strike y multiplicador antes de mostrarlo. `NOT_FOUND`, `AMBIGUOUS`, `PACING`, `PERMISSION`, `TIMEOUT` y `DISCONNECTED` son visibles por separado. La consulta de cotización es posterior a la resolución. Un `conId` válido no demuestra acceso a OPRA ni bid/ask disponible. La tabla marca cotización pendiente, ausente, parcial, obsoleta o sin permisos. Cuando falta una última cotización reciente de NVDA, se exige strike o rango elegido por el usuario; se eliminó el punto medio silencioso. `/options/strikes` acepta vencimiento, rango de precio, offset y limit (máximo 200) y devuelve total y siguiente página; `reqSecDefOptParams` enumera strikes, pero cada combinación todavía debe validarse con `reqContractDetails`.

## Repetir en Windows

En ambas computadoras, dentro del repositorio y con Node 22 o 24:

```powershell
git fetch origin
git switch codex/phase19-ibkr-desktop-web
git pull --ff-only origin codex/phase19-ibkr-desktop-web
npm.cmd ci
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

En B, conserve su `.env` privado, `TRADING_POC_MODE=PAPER`, el secreto compartido y la IP privada configurada. Reinicie backend y web (el protocolo cambió):

```powershell
.\scripts\windows\Start-TradingPoc.ps1 -Mode PAPER
```

En A, confirme TWS **Paper**, API socket **Read-Only**, loopback, cuenta Paper esperada y ACL privada A→B. Conserve su `.env` privado; reinicie también el agente:

```powershell
.\scripts\windows\Start-IbkrAgent.ps1 -Mode TWS
```

En la interfaz B, abra Opciones, elija vencimiento y CALL/PUT. Si NVDA no muestra último precio, elija un strike o introduzca un rango cercano al precio que desee investigar; no se infiere un precio de mercado del rango. Use «Más strikes» para avanzar en la cadena. Pulse «Reintentar» y compruebe filas resueltas, errores por strike, `requestId`, bid/ask, feed y hora. Repita con varios contratos y desconecte/reconecte TWS. Un error de contrato no debe convertir toda la tabla en HTTP 500 ni desconectar el agente. Revise los logs JSON de B y A por `requestId`, sin compartir `.env`, números de cuenta o logs brutos de TWS. El hecho de recibir la definición de un contrato no confirma permisos OPRA: solo cotizaciones auténticas con timestamps y feed lo harían.

## Límites

La consulta de hasta diez contratos puede agotar el presupuesto de página si IBKR responde lento o aplica pacing; el reporte por strike permanece parcial. Las combinaciones de vencimiento y strike entregadas por `reqSecDefOptParams` no garantizan un contrato válido. La prueba local no dispone de TWS ni OPRA reales. No se añadieron órdenes ni cambios a detectores históricos, Bollinger o estudios QQQ/NVDA.

Verificación local de esta corrección: `npm.cmd run typecheck`, `npm.cmd test` (41 pruebas de aplicación y 168 históricas) y `npm.cmd run build` pasaron en Node 24. El E2E DEMO local no se ejecutó de forma concluyente porque había una instancia PAPER activa en el puerto habitual; la CI de Windows valida arranque, tipos, pruebas y compilación en Node 22 y 24. La prueba funcional contra TWS Paper debe repetirse con los pasos anteriores.
