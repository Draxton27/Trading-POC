# Fase 38A: IEX Live en paralelo a SIP

## Uso local en Windows

Configurar `APCA_API_KEY_ID` y `APCA_API_SECRET_KEY` en `.env.local` de la raíz. El archivo es privado. Los comandos cargan ese archivo aunque npm se ejecute desde otro directorio de trabajo:

```powershell
npm.cmd run iex:probe -- --once
npm.cmd run iex:collect -- --continuous
```

`iex:probe` comprueba calendario, autenticación y suscripción a `bars` y `updatedBars` de NVDA; no escribe velas. `iex:collect` usa el WebSocket `wss://stream.data.alpaca.markets/v2/iex`, guarda su propio ledger y se detiene con Ctrl+C. No se instala ni inicia desde la tarea diaria de Windows. Una segunda ejecución se rechaza mediante un bloqueo de proceso; el conector no mata procesos ajenos. Si una conexión cae, espera con backoff limitado. Los fallos de credenciales, permisos, suscripción o límite de conexiones se muestran como códigos y terminan la ejecución. Fuera de horario puede aprobar la suscripción aunque todavía no lleguen velas.

El almacenamiento predeterminado es `%LOCALAPPDATA%\Trading-POC\iex\` en Windows y `private/iex/` en otros sistemas. `TRADING_POC_PRIVATE_DIR`, `TRADING_POC_IEX_LEDGER` y `TRADING_POC_IEX_CALENDAR` permiten elegir rutas privadas. La comparación lee el ledger SIP en la ruta predeterminada de `alpaca:ingest` (`private/alpaca-ingestion/ledger.jsonl`), o bajo `TRADING_POC_PRIVATE_DIR` si se configura para aislar el entorno, o en la ruta explícita `TRADING_POC_ALPACA_INGESTION_LOG`. El calendario oficial Alpaca se conserva en JSON; el ledger IEX es JSONL encadenado con SHA-256, append-only y con bloqueo de escritura. El ledger SIP, las predicciones y el modelo congelado se mantienen separados. No se almacenan credenciales en el ledger ni se devuelven por API.

## Semántica de datos

Alpaca documenta que IEX es una sola bolsa, mientras SIP reúne el mercado consolidado. `bars` entrega agregados de un minuto y `updatedBars` puede corregirlos posteriormente. La hora `t` es el **inicio** del minuto; `receivedAtUtc` procede del reloj local al recibir el mensaje. La latencia se mide desde el cierre del minuto o de la vela agregada hasta su recepción. Cada versión distinta se agrega como revisión, sin reemplazar la anterior. Las velas de 15 minutos solo se emiten tras observar los 15 minutos del intervalo y llegar a su hora de cierre; una ausencia no se interpreta automáticamente como un minuto sin transacciones. Un minuto con volumen y conteo cero explícitos se conserva como tal. Durante una desconexión, la cobertura queda incompleta; no se reconstruye con SIP.

El calendario oficial define sesiones regulares, festivos, horario EDT/EST y cierres anticipados. Los intervalos se alinean a cuartos de hora UTC, que coinciden con la apertura de 09:30 NY. El conector descarta velas fuera de la sesión regular. La prueba automática usa un WebSocket simulado; se necesita una sesión abierta para medir recepción y cobertura auténticas.

La API GET `/api/v1/ml/feeds?symbol=NVDA&timeframe=15m` muestra estado, cobertura y comparación; la vista «Predicciones» lo presenta como feed experimental. El precio IEX del stream se conserva **sin ajustar**. El histórico SIP local se solicitó con `adjustment=split`. Por ello las diferencias de OHLC se etiquetan `IEX_RAW_VS_SIP_SPLIT_ADJUSTED` y requieren revisar factores de split antes de cualquier interpretación económica. El volumen IEX cubre menos mercado; una diferencia de volumen no equivale a un error. Solo se comparan intervalos UTC idénticos, sin interpolación. La diferencia temporal usa la hora local de recepción de ambas fuentes.

## Contrato para un futuro modelo IEX

Un modelo IEX requeriría un dataset propio con `feed=iex`, `adjustment=raw`, calendario oficial, revisiones y recepción verificables; no se permite usar el modelo SIP congelado con estas velas. `preparePhase31Inference()` exige explícitamente `feed=sip` y `adjustment=split`, y el recolector de Fase 34 permanece conectado solo a `captureOnce()` SIP. La tarea diaria tampoco inicia IEX. Retornos, EMA, SMA, Bollinger y ATR conservan sus fórmulas, pero deben reevaluarse bajo cobertura IEX. Volumen relativo, huecos y etiquetas merecen una validación independiente por la menor cobertura y los minutos sin barras. Este PR no entrena, calibra ni ejecuta inferencia. La API no crea predicciones ni órdenes.

Referencias oficiales: [WebSocket Stream](https://docs.alpaca.markets/us/docs/streaming-market-data), [Real-time Stock Data](https://docs.alpaca.markets/us/docs/real-time-stock-pricing-data), [Market Data FAQ](https://docs.alpaca.markets/us/docs/market-data-faq).

## Cobertura y disponibilidad (corrección PR #47)

El ledger marca `OBSERVATION_STARTED` y `OBSERVATION_ENDED` al inicio y al final de cada ejecución. Además, conserva los eventos `SUBSCRIBED` y `DISCONNECTED`, que delimitan los tramos durante los que el WebSocket estuvo suscrito. La cobertura de período monitoreado cuenta únicamente intervalos de 15 minutos completos contenidos en esos tramos. Las sesiones SIP anteriores al primer monitoreo IEX no se contabilizan como faltantes IEX. Se informan por separado sesiones completas, parciales y sin monitoreo; la cobertura completa usa solo sesiones que el colector cubrió desde apertura hasta cierre. Sin períodos válidos, el porcentaje y el conteo de ausencias son `null`/N/D, no cero.

Los conteos de ausencia describen intervalos esperados durante la suscripción que no generaron una vela IEX. No se convierten en minutos con cero transacciones. Una desconexión cierra el tramo monitoreado y sus minutos quedan sin clasificar como observados o sin transacciones. Si el proceso sigue conectado dentro de una sesión del calendario y no recibe ningún mensaje por tres minutos, el estado pasa a `QUIET_ACTIVE_SESSION`: es una alerta de posible silencio del feed, no prueba de interrupción ni de ausencia de operaciones. El colector permanece conectado y vuelve a `SUBSCRIBED` cuando llega otro mensaje. Fuera del horario de sesión no emite esa alerta.

La latencia inicial de cada bloque de 15 minutos y la ganancia frente a SIP usan la primera versión completa registrada de cada fuente. Una corrección posterior no sustituye su disponibilidad original. El reporte calcula latencias de revisiones por separado, desde el cierre del bloque hasta la recepción de cada versión revisada. Las comparaciones y diferencias OHLC usan solo barras con el mismo inicio y cierre UTC; IEX raw y SIP split-adjusted siguen siendo bases de precio distintas.

Los ledgers anteriores que no contienen marcadores de suscripción pueden seguir leyéndose, pero no permiten reconstruir con certeza un período comparable: la API muestra cobertura/ausencias N/D en lugar de inferirla a partir de las velas guardadas.
