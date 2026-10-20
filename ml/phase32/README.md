# Fase 32 — ingesta verificable Alpaca SIP

La ingesta es un proceso local separado de Fastify. Solicita únicamente `NVDA`, velas `15Min`, `feed=sip`, `adjustment=split` y sesión regular definida por el calendario de Alpaca. No existe sustitución a IEX.

## Windows

Copie `.env.example` a `.env.local` y configure sus credenciales privadas:

```powershell
$env:APCA_API_KEY_ID = '...'
$env:APCA_API_SECRET_KEY = '...'
npm.cmd run alpaca:ingest -- --once
```

Para una ejecución periódica controlada (mínimo 60 segundos):

```powershell
npm.cmd run alpaca:ingest -- --every-seconds 60
```

El libro JSONL predeterminado es `private/alpaca-ingestion/ledger.jsonl`, ya ignorado por Git. Cada fila tiene hash, hash anterior, recepción local UTC, hash de respuesta, feed, ajuste y revisión. Una lectura idéntica no se duplica; una corrección de OHLCV del proveedor se conserva como revisión posterior.

El proceso rechaza velas fuera de calendario, incompletas, futuras, desordenadas y huecos intradía. Un permiso SIP ausente, límite de tasa o error HTTP queda registrado como estado explícito. La disponibilidad `CURRENT` o `DELAYED` se calcula a partir del cierre de la última vela y de la recepción local. `CURRENT` exige un retraso efectivo de hasta cinco minutos; no usa la protección histórica de 20 minutos como sustituto de un feed actual.

Una respuesta SIP válida en la cuenta local es la única evidencia de que el plan permite una captura suficientemente reciente. Esta fase no habilita `PROSPECTIVE_CAPTURE`, inferencia, señales, órdenes ni conexión IBKR.
