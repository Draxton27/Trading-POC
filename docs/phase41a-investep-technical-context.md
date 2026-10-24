# Fase 41A · Estructura técnica multitemporal

Este módulo describe NVDA, QQQ y SMH con velas de 15 minutos, horas ancladas a la apertura de Nueva York y sesiones diarias. Es investigación descriptiva: no genera predicciones, órdenes ni recomendaciones CALL/PUT. El Radar conserva su tendencia anterior y muestra esta estructura en una sección independiente. El asistente usa una herramienta local de solo lectura cuando la petición de estructura técnica identifica hasta dos activos permitidos.

## Procedencia y disponibilidad

La API lee el adaptador local autorizado. En OFFLINE/PAPER exige metadatos de Alpaca Market Data API, SIP, `split`, sesión regular, 15 minutos y calendario de mercado. No consulta Alpaca durante la petición, ni mezcla IEX raw, IBKR o cotizaciones aisladas. En DEMO usa el calendario fijo **sintético** de su fixture de 09:30 a 16:00 NY, claramente etiquetado; no lo atribuye a Alpaca. Las barras futuras, abiertas o recibidas después de `asOfUtc` no participan. Una agregación horaria o diaria está disponible tras el cierre **y** la recepción de la última vela fuente necesaria. Las barras horarias finales abreviadas conservan esa marca. La sesión diaria parcial no se usa para SMA diaria.

La continuidad se verifica por velas programadas y por sesiones consecutivas del calendario. Un hueco, una barra incompleta o una sesión ausente reinicia la serie de cálculo; no se suman cierres separados por un tramo desconocido. La SMA200 requiere 200 cierres consecutivos de su temporalidad. Para el endpoint se conservan hasta 8000 barras de 15 minutos anteriores al corte: suficientes para más de 200 sesiones ordinarias si la cobertura es continua. Si no lo son, el valor queda `null` y se declara insuficiencia. El estado `STALE` indica que falta una vela que ya debía haber cerrado según el calendario, o que el último cierre supera siete días respecto al `asOfUtc`. Esta clasificación descriptiva no demuestra acceso a un feed en tiempo real. `HISTORICAL` tampoco significa cotización LIVE. El CSV local disponible puede terminar en octubre de 2026.

## Reglas comunicadas por el operador

- Se usan exclusivamente medias **simples** de 20, 40, 100 y 200 cierres completos por temporalidad, calculadas con `calculateSmaPoints`.
- SMA20 mayor/menor que SMA40 indica alineación alcista/bajista corta; SMA100 mayor/menor que SMA200 indica alineación larga. La igualdad produce `MIXED`; un valor ausente, `INSUFFICIENT_DATA`.
- Cada pendiente se describe **separadamente** del orden de la pareja. Una pareja alcista con pendientes descendentes sigue siendo una pareja alcista, sin tendencia confirmada.
- Se registran cruces de cierres, toques, cuerpo completo, vela completa, rechazos y retesteos como hechos separados. Un cruce único no confirma un cambio de tendencia.

## Convenciones de ingeniería explícitas

Estas reglas permiten automatizar descripciones; no están atribuidas como umbrales validados de Investep.

- `SMA_n(t) = sum(cierre de las últimas n velas completas continuas) / n`.
- `slopePercent = 100 × (SMA_n(t) − SMA_n(t−1)) / SMA_n(t−1)`. Se requieren dos puntos completos **consecutivos**. La igualdad exacta da `FLAT`.
- `priceDistancePercent = 100 × (cierre − SMA) / SMA`. Es distancia firmada; no se usa umbral de cercanía.
- Cruce superior/inferior: cierre previo estrictamente al lado contrario de su SMA previa y cierre actual estrictamente sobre/bajo la SMA actual. La igualdad no constituye lado ni cruce.
- Toque: `low <= SMA <= high`. Cuerpo entero sobre/bajo: `min(open,close) > SMA` / `max(open,close) < SMA`. Vela entera sobre/bajo: `low > SMA` / `high < SMA`.
- Rechazo: toque con cierre que permanece del mismo lado que el cierre anterior. `FULL_CANDLE_BREAK` describe geometría de una vela, no confirmación estadística.
- Retesteo experimental: después de un cruce, una de las cuatro velas completas siguientes toca la SMA y cierra del lado de la ruptura. Mientras no ocurra se registra `PENDING`; al volver al lado anterior, `RECOVERY` y `FAILED`; tras cuatro velas, `EXPIRED`. Las rupturas fallidas siguen presentes. No se seleccionan por desenlace favorable posterior.
- La lista de eventos examina las últimas 205 velas completas continuas de cada temporalidad. Incluye todos los eventos que cumplen la definición en esa ventana, tanto favorables como fallidos. Esta ventana de presentación no cambia el cálculo de las SMA sobre el tramo continuo completo.
- Los estados de compatibilidad entre temporalidades comparan el estado de cada marco, que exige acuerdo de sus parejas **corta y larga**. Así se evita llamar `ALIGNED_BULLISH` a un conjunto cuya pareja larga es bajista. Se describen acuerdo total, pullback corto contra 1h/1d alcistas, recuperación corta contra 1h/1d bajistas, contradicción, mezcla o insuficiencia. Las dos parejas de cada temporalidad permanecen visibles por separado. Son descripciones, no probabilidades.
- Los extremos de 5, 20 y 60 **sesiones completas anteriores** y la sesión previa son ventanas descriptivas de investigación. Se omite la sesión actual, incluso si ya cerró en el día de consulta. Una ventana con sesiones faltantes queda `UNAVAILABLE`. No se declara máximo histórico absoluto.
- Los máximos, mínimos y SMA se presentan como **niveles potenciales**, con método, fuente, intervalo de referencia y momento de disponibilidad. Que un extremo sea alto no prueba resistencia ni que uno bajo pruebe soporte.

## API y visualización

`GET /api/v1/market/technical-context?symbol=NVDA&asOfUtc=2026-10-16T18:00:00.000Z` acepta solo NVDA, QQQ o SMH y un instante ISO con zona explícita, opcional. Rechaza cortes futuros. La respuesta Zod incluye `timeframes['15m'|'1h'|'1d']`, cuatro SMA por marco, ambas parejas, pendientes, interacciones, `alignment`, rangos previos, niveles, eventos y limitaciones. `null` significa que no hay valor verificable; nunca se sustituye por cero. Radar agrega una tabla con estas tres temporalidades sin reemplazar el contrato ni la tendencia anterior. Para el asistente, «estructura técnica SMA20/40 de NVDA» selecciona `get_technical_context` y redacta un resumen de los datos calculados; una instrucción de compra no activa la selección determinista.

Ejemplo **sintético**: si SMA20=101 y SMA40=100, la alineación corta es alcista, aunque SMA20 haya bajado desde 102 (`FALLING`). Una vela con `open=101`, `high=102`, `low=99` y `close=99` cruzó por cierre, pero no quedó completamente por debajo: `high` no es menor que 100. Ninguna de estas observaciones indica rentabilidad esperada.

## Validación y límites

En Windows: `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run build`. La prueba `tests/phase19/technical-context.test.ts` usa velas sintéticas y cubre orden de SMA, pendientes, geometría, ruptura fallida, retesteos, continuidad, sesiones, cambios EDT/EST, cierre anticipado, procedencia, ausencia de datos, disponibilidad, API y selección del asistente. La suite Windows Node 22/24 se activa también al cambiar motor, contrato, tests o este documento.

El módulo no valida la metodología como estrategia ni mide retornos. Una fuente histórica que termina hace días puede producir SMA matemáticamente disponible y a la vez quedar obsoleta para interpretar el mercado presente. No usa los modelos congelados ni altera los estudios anteriores.
