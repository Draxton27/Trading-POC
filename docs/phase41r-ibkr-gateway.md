# Fase 41R: TWS o IB Gateway Paper

## Arquitectura y seguridad

`scripts/ibkr-connection.mjs` resuelve una sola configuración para el lanzador, el agente y el diagnóstico. `TWS_PAPER` utiliza 7497 y `GATEWAY_PAPER` utiliza 4002 por defecto. En Gateway, `IBKR_GATEWAY_PORT` tiene precedencia sobre 4002; `IBKR_TWS_PORT` sigue aplicándose solo a TWS. Ambos comparten `IBKR_TWS_HOST`, `IBKR_CLIENT_ID` y `IBKR_EXPECTED_PAPER_ACCOUNT` por compatibilidad. Los comandos `dev:paper` y `dev:gateway` seleccionan explícitamente la aplicación sin reescribir `.env.local`.

El mismo `TwsReadOnlyAdapter` conecta con cualquiera de los dos programas. La verificación sigue exigiendo loopback, cuenta `DU` exacta en `managedAccounts`, `nextValidId`, handshake Paper y API de solo lectura. Un puerto abierto no demuestra autenticación. No hay fallback a Live, contraseñas, 2FA automatizada ni funciones de órdenes. El diagnóstico privado etiqueta la aplicación; un handshake antiguo de TWS no se atribuye a Gateway. Los registros previos sin etiqueta siguen asociados a TWS.

## Ejecución Windows

1. Abra IB Gateway, elija **Paper Trading**, inicie sesión en la aplicación oficial y habilite su API de solo lectura en el puerto Paper configurado. Trading-POC no abre ni autentica Gateway.
2. Configure una vez `.env.local` con `IBKR_EXPECTED_PAPER_ACCOUNT=DU...`, `IBKR_TWS_HOST=127.0.0.1` e `IBKR_CLIENT_ID=119`. Para un puerto Gateway personalizado, agregue `IBKR_GATEWAY_PORT=...`. No guarde contraseñas de IBKR.
3. Ejecute `npm.cmd run ibkr:gateway:doctor` para comprobar puerto y último handshake. `APPLICATION_NOT_REACHABLE` significa que la aplicación no responde; no prueba un conflicto de sesión. Un handshake exitoso y la cuenta correcta son comprobaciones separadas.
4. Ejecute `npm.cmd run dev:gateway`. Para TWS Paper, use `npm.cmd run ibkr:paper:doctor` y `npm.cmd run dev:paper`. DEMO y OFFLINE siguen independientes mediante `npm.cmd run dev:mock` y `npm.cmd run dev:offline`.

La vista Configuración muestra aplicación, puerto, cuenta enmascarada, feed y último handshake. Si IBKR está desconectado, las funciones locales de IEX, históricos, predicciones, diario y simulador interno no requieren ese agente. La cadena de opciones sí necesita definiciones disponibles del bróker.

## Sesiones y datos de mercado

IBKR documenta una sesión bursátil activa por nombre de usuario. Gateway no elimina esa limitación; otro usuario autorizado puede permitir acceso separado, sujeto a permisos de Paper y condiciones de la cuenta. Los permisos de mercado son por usuario y pueden tener cargos adicionales. No se presupone acceso OPRA ni sesiones simultáneas verificadas. El código 10197 identifica específicamente un conflicto de datos durante sesiones competidoras; una desconexión genérica no se clasifica así. [Sesiones de IBKR](https://www.interactivebrokers.com/docs/web-api/authentication/multiple-sessions), [códigos IBKR](https://www.interactivebrokers.com/docs/tws-api/doc/error/codescodes), [precios de datos](https://brokerage.ibkr.com/en/pricing/market-data-pricing.php).

IBKR documenta los puertos Paper predeterminados TWS 7497 y Gateway 4002. [Notas oficiales de TWS](https://www.ibkrguides.com/releasenotes/tws/archive/tws-archives/tws-archive.htm).

## Límites de verificación

Las pruebas automatizadas usan configuraciones y servicios simulados. No se inició Gateway ni se comprobó una cuenta o cotización auténtica durante la CI. La disponibilidad OPRA y la compatibilidad con otra sesión del mismo usuario deben evaluarse en una instalación real, sin relajar las comprobaciones de Paper.
