# PR #25: correcciones de revisión de Fase 19

Rama: `codex/phase19-ibkr-desktop-web`. Base de revisión: `f47343996fa9d7e7935174b3c5cae2c29a52d3db`. Este documento añade evidencia sin reemplazar los informes originales. Los seis detectores F16 y los resultados publicados de F9–18 no se modifican. No se añadieron órdenes.

| Área | Cambio | Evidencia local |
| --- | --- | --- |
| Windows | `scripts/dev.mjs` ejecuta `npm-cli.js` con Node, comprueba puertos y detiene hijos. | Arranque manual Windows Node 24: API y Vite respondieron; prueba automatizada del launcher y script de humo CI Node 22/24. |
| Ticks | Libro independiente por solicitud; códigos live, frozen y delayed, reinicio al cambiar feed. | Fixtures de precios, tamaños y griegas. Sin TWS auténtico. |
| Indicadores | Gráfico usa series de `/market/indicators`; SMA y Bollinger del motor propio. | Paridad con Bollinger original para 15m, 1h y 1d sintéticos. |
| Contexto | `asOfUtc`, sesión anterior completa del calendario local, origen y disponibilidad. | Casos de lunes, feriado, sesión abreviada, años antiguos y ausencia de barra. |
| PAPER | WebSocket de estado y cotizaciones, leases compartidos, límite de 10 contratos, caducidad y recuperación tras reconexión. | Pruebas de canal y suscripciones; conexión Paper auténtica pendiente. |
| Diario | Escritura CSV F17 append-only, formulario breve marcado `timing_unverified`; ledger F19 antiguo solo lectura. | Pruebas de CSV completo, duplicados, hash y revisión F17 original. |
| Operaciones | Marcadores por cada fill con UTC validado; faltantes visibles. | Pruebas de fills parciales, fin exclusivo y varios días. |
| Seguridad | Token de sesión exige solicitud del mismo origen, validación temporal y correlación de mensajes. | Pruebas de origen, replay, tipo de respuesta y ausencia de rutas de órdenes. |

El modo DEMO se probó con Chrome local y datos sintéticos. OFFLINE y PAPER mantienen fuentes separadas; no hay barras nuevas construidas a partir de ticks. Los informes y CSV privados siguen fuera de Git. La ejecución CI de Windows y la prueba física de dos computadoras siguen pendientes de verificación externa.
