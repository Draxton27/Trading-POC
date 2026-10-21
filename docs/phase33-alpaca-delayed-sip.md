# Ingesta Alpaca SIP retrasada

Esta variante de la ingesta local consulta únicamente velas de **NVDA**, de
**15 minutos**, con `feed=sip`, `adjustment=split` y sesión regular definida
por el calendario oficial de Alpaca. No cambia a IEX si SIP no está disponible.

## Ejecución en Windows

Desde la raíz del repositorio, configure `APCA_API_KEY_ID` y
`APCA_API_SECRET_KEY` exclusivamente en `.env.local`, que está excluido de
Git. Después ejecute:

```powershell
npm.cmd run alpaca:ingest -- --once --delay-minutes 20
```

`--delay-minutes` es un entero y no admite valores inferiores a 20. Si se
omite, el valor predeterminado también es 20. Para una ejecución periódica:

```powershell
npm.cmd run alpaca:ingest -- --delay-minutes 20 --every-seconds 60
```

## Límite temporal y procedencia

El timestamp de una vela es su inicio UTC y su cierre es inicio + 15 minutos.
En cada consulta, el programa calcula el último inicio admisible como la
frontera de 15 minutos inmediatamente anterior o igual a:

`reloj de consulta − retraso solicitado − 15 minutos`

Por tanto, toda vela solicitada ya había cerrado al menos 20 minutos antes de
que la consulta comenzara. Una respuesta HTTP lenta no puede hacer válida una
vela que era demasiado reciente en ese instante. El ledger privado append-only
conserva para cada consulta y vela la hora de consulta, la hora de recepción
tras leer la respuesta, el inicio y cierre de la vela, su hash y el retraso
efectivo. Las revisiones, el bloqueo exclusivo y la idempotencia se mantienen.
El calendario oficial usado en la consulta se guarda localmente junto al ledger
(`ledger.jsonl.calendar.json`). La escritura crea directorios privados faltantes
y publica un archivo completo mediante temporal y renombrado; un fallo conserva
el calendario anterior válido para el observador. Las sesiones de cada respuesta
oficial se fusionan con las ya guardadas: las fechas nuevas sustituyen la versión
anterior de esa fecha y las sesiones antiguas se conservan para indicadores que
cruzan varios días.

Todas las capturas de este comando se etiquetan como `DELAYED`; no representan
cotizaciones en tiempo real. `PROSPECTIVE_CAPTURE` sigue bloqueado.

## Errores de acceso

- HTTP 401 se registra como credenciales Alpaca inválidas.
- HTTP 403 para una ventana que solicita datos demasiado recientes se registra
  como `RECENT_DATA_FORBIDDEN` y explica que debe usarse el retraso mínimo.
- HTTP 403 para una ventana ya retrasada se registra como falta de permiso SIP,
  sin afirmar que las credenciales sean inválidas.

No se guardan credenciales ni cuerpos de respuestas del proveedor en el
ledger, los logs públicos ni Git. Esta ingesta no ejecuta órdenes, no conecta
IBKR y no realiza inferencia ni entrenamiento.
