# Fase 17 — informe de validación

**Base:** `main` en `3916adfc7c1924a89d577bbdcb4bf67788a694f4`. Antes de crear la rama se comprobó que los PR #21 y #22 estaban fusionados. **Versión exacta del código F17 probado:** `a0c7ff5afb69bbb280ab92c9138fd5ffe0668cf4`. La rama de entrega es `codex/phase17-human-strategy-specification`; no se fusionó ningún PR.

## Alcance y resultado

Se documentaron ocho etapas del posible método discrecional y 37 descriptores observables, cada uno con temporalidad, fórmula propuesta, datos necesarios y primera disponibilidad. La especificación separa lo solicitado por el encargo de una declaración verificable del operador, una hipótesis técnica y una regla pendiente de confirmación. No se dispone aquí de audio autorizado, transcripción certificada, decisiones reales ni fills reales; por tanto **no se ha confirmado un método concreto ni se ha medido su rentabilidad**.

La extensión del diario F16 acepta su antigua cabecera y añade texto libre en español, `no_trade`, temporalidades revisadas, cuatro SMA, niveles manuales, confirmación esperada, invalidación, contrato OCC opcional, motivos de strike/vencimiento, objetivo, límite, referencia de captura y modo de registro. `documentedAtUtc` lo fija el sistema. Una reconstrucción o anotación posterior no se convierte en prospectiva por etiqueta. Las entradas se agregan al diario privado con hash encadenado y las anotaciones vinculadas exigen un ID de decisión existente. Las capturas originales PNG/JPEG/WebP se conservan en privado por SHA-256; la hora declarada y el `mtime` permanecen explícitamente sin verificar.

El importador privado acepta CSV de ejecuciones individuales con OCC, compra/venta, cantidad y primas reales, empareja compras y ventas parciales FIFO y deja el neto calculado en `null` si falta una comisión. Rechaza contratos contradictorios, duplicados alterados, ventas sin inventario y ejecuciones futuras al importar. No deduce cotizaciones, spread, delta ni volatilidad implícita a partir de los fills. El esquema de datos de opciones describe futuras cotizaciones con bid/ask, tamaños, procedencia, disponibilidad y licencia; no adquirió datos de opciones.

La comparación usa señales congeladas F16 con tolerancia de ±15 minutos. Distingue coincidencia, decisión solo humana, rechazo **explícito**, `no_trade`, señal solo del sistema con cobertura humana cercana e información insuficiente. La vista se corta en la hora declarada de decisión: si la señal no estaba disponible entonces, sus indicadores no se muestran, incluso si el patrón coincide después. Nunca incluye el desenlace futuro. La mera falta de anotación humana no equivale a rechazo.

## Comprobaciones ejecutadas

| Comprobación | Resultado |
| --- | --- |
| `npm ci --cache /tmp/phase17-npm-cache` | Correcta, 4 paquetes instalados. |
| `npm run typecheck` | Correcta. |
| `npm test` | 147 pruebas aprobadas, 0 fallos; incluye 11 pruebas nuevas F17 y todas las pruebas anteriores. |
| Validadores NVDA | `validate:nvda`, `validate:nvda-volume`, `validate:nvda-indicators`, `validate:nvda-sma-context`, `validate:nvda-pullback-breakout`, `validate:nvda-failed-breakouts` y `validate:nvda-volatility`: correctos. |
| Validadores de contexto | `validate:phase14-context` y `validate:phase15-confirmation`: correctos. |
| Integridad histórica | `sha256sum -c SHA256SUMS.txt` correcto en paquetes F12, F14, F15 y F16; los archivos de resultados históricos versionados quedaron idénticos a `main` después de las ejecuciones. |
| Revisión de Git | Ningún detector F16 ni estudio F9–F15 aparece modificado en el diff respecto a `main`. |

La prueba manual con datos **sintéticos** ejecutó dos veces `journal:phase17` sobre una decisión `no_trade` marcada `historical_reconstruction`, dos veces `import:broker:phase17` sobre dos fills (una venta parcial), y `compare:phase17`. Los reintentos devolvieron el mismo ID de diario y el mismo archivo de importación; hubo una operación cerrada, un lote abierto y una decisión de no operar. El destino fue `/tmp` privado. Esta prueba comprueba funcionamiento e idempotencia, **no** constituye una observación humana o prospectiva.

## Límites pendientes

- El operador debe confirmar con su propia declaración las reglas de tendencia, niveles, entrada, selección de contrato, gestión y motivos de rechazo; las preguntas están documentadas sin respuestas inventadas.
- El CSV del bróker documentado cubre posiciones largas de opciones estándar con multiplicador 100 y fills BUY/SELL; otras estructuras o multiplicadores requieren un contrato nuevo antes de importar.
- La cobertura de mercado humano se registra de forma explícita pero no prueba vigilancia continua. Sin decisiones humanas reales, señales prospectivas y cotizaciones históricas de opciones, no existe comparación de rendimiento ni atribución de ventaja estadística.
- Audios, capturas originales, fills y resultados privados no se publicaron. El paquete compartido contiene solo especificación, esquemas, plantilla vacía y auditoría técnica.
