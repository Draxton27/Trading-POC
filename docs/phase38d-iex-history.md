# Fase 38D: histórico IEX y calidad de datos

`npm.cmd run iex:history` consulta exclusivamente `GET /v2/stocks/NVDA/bars` con `feed=iex`, `timeframe=1Min` y `adjustment=raw`. Cada ventana abarca como máximo 30 días y se pagina hasta agotar `next_page_token`. La descarga respeta 500 ms entre solicitudes y reintenta 429, 5xx y errores de red con esperas acotadas. 401 y 403 tienen estados separados.

## Windows

Guardar `APCA_API_KEY_ID` y `APCA_API_SECRET_KEY` en `.env.local` de la raíz, excluido de Git. Desde la raíz:

```powershell
npm.cmd run iex:history -- --start 2025-10-23 --end 2026-10-22 --out private/iex-history/nvda-2025-2026 --sip-csv trading_poc_001_bollinger/data/NVDA_ALPACA_SIP_15min_20211017_20261017.csv
```

El intervalo es `[start,end)` UTC; `end` debe estar al menos 20 minutos atrás. Repetir el mismo comando reutiliza las partes completas y verificadas por SHA-256. No se reemplazan partes existentes ni resultados finales diferentes. Tras un corte, revisar cualquier parte sin `.sha256` y retirarla manualmente antes de reintentar; no se confía en un archivo incompleto. Cada ejecución verifica el calendario oficial Alpaca, con festivos, horario de verano y cierres anticipados.

Los archivos privados incluyen `parts/`, `minutes.csv` con número de transacciones, `strict-15m.csv`, `calendar.json`, `query.json`, `report.json` y `SHA256SUMS`. No se asignan horas de recepción históricas: estas respuestas REST están separadas del ledger IEX Live por WebSocket.

## Auditoría

El reporte cuenta minutos esperados, observados y ausentes por sesión, volumen, transacciones y cobertura. Una vela estricta de 15 minutos exige sus 15 barras de minuto. Un minuto sin barra se considera cobertura ausente, no volumen cero. `featureEligible15m` cuenta las observaciones para las que `calculatePhase23Features` devuelve las variables originales después de sus requisitos de continuidad y calentamiento. La viabilidad indicada es preliminar: el número de observaciones no demuestra clases equilibradas ni estabilidad temporal para entrenar.

La comparación opcional con SIP se limita a cobertura de los mismos intervalos UTC de 15 minutos. IEX `raw` y SIP `split` no permiten comparar precios directamente; el reporte marca `UNAVAILABLE_ADJUSTMENT` hasta disponer de ajustes corporativos verificables. La cobertura IEX puede diferir de SIP por el universo de transacciones. Este estudio no entrena XGBoost ni reutiliza el modelo SIP congelado. Una evaluación de variables IEX frente a desenlaces consolidados SIP requiere un estudio posterior.

## Ejecución local del 23-10-2026

Con el rango privado `[2025-10-23, 2026-10-22)` se obtuvieron 97.129 minutos observados de 97.530 programados en 251 sesiones oficiales; hubo 401 minutos sin barra en nueve sesiones y dos cierres anticipados. Se construyeron 6.465 velas estrictas de 15 minutos, de las cuales 6.280 tienen las variables de Fase 23 disponibles. El estado de viabilidad es `RESEARCH_POSSIBLE`, condicionado a revisar distribución de clases y estabilidad temporal antes de entrenar.

En la ventana compartida con el CSV SIP local, de `2025-10-23T13:30:00Z` a `2026-10-16T20:00:00Z`, SIP contiene 6.398 intervalos de 15 minutos. IEX aporta 6.388 intervalos estrictos y todos coinciden en UTC con SIP; diez intervalos SIP carecen de una vela IEX estricta. Esta es una comparación de cobertura, sin contraste de precios. El informe final y sus hashes están en `private/iex-history/nvda-2025-2026-verified/`, fuera de Git. Se rechazaron cero filas inválidas; una fila inválida hace fallar la descarga en vez de desaparecer del informe.
