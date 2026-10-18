# Fase 17 — auditoría de integración y temporalidad

Esta entrega prepara el registro de decisiones y operaciones **auténticas cuando se reciban**. En la rama no hay decisiones ni fills humanos reales. Los tests y la prueba manual usan datos sintéticos etiquetados; sus CSV, capturas y sobres privados quedan fuera de Git. No se calcula rentabilidad del método ni se inicia una Fase 18.

## Flujo de una decisión real

1. Registrar la decisión con `npm run journal:phase17 -- /ruta/privada/decision.csv` antes de conocer el desenlace, si realmente se documentó a tiempo. `decisionAtUtc` es declarado; `documentedAtUtc` lo fija el sistema y no se puede retroceder. Si se reconstruye desde operaciones pasadas, usar `recordMode=historical_reconstruction`; una nota posterior usa `post_outcome_annotation`. `no_trade` sigue siendo una decisión válida sin contrato ni fills.
2. Si existe captura original autorizada, importar en privado con `npm run attach-chart:phase17 -- /ruta/privada/grafico.png ID [horaUTC]`; guardar el ID y SHA-256 en la decisión. El hash verifica el archivo, mientras que la hora declarada y el `mtime` no certifican cuándo se miró el gráfico. Un ID no importado o un hash distinto se rechazan.
3. Registrar el contexto observado y `contextKnownAtUtc` solo si se conoce cuándo se consultó. Si falta esta hora o es posterior a `decisionAtUtc`, los valores de SMA y tendencia se ocultan en la **vista previa**. Si se muestra, el estado se etiqueta `self_reported_time_unverified`: no es prueba independiente de disponibilidad. Los niveles manuales requieren su propio `drawnAtUtc` para aparecer en esa vista. El indicador Finviz menor que 2,5 permanece no identificado.
4. Importar cada CSV original privado del bróker con `npm run import:broker:phase17 -- /ruta/privada/archivo.csv`. Cada fill conserva `executed_at_utc` del bróker y cada fuente `importedAtUtc` fijado al recibirla. `npm run broker-state:phase17` verifica hash, duplicados, FIFO y posiciones abiertas desde todos los archivos.
5. Agregar una **nueva** fila de diario con `relatedDecisionId`, `linkedExecutionIds` separados por `|`, `exitReason` y, si cambió el plan, `planChangedAtUtc` más `planChangeReason`. Los objetivos/límites de esa nueva fila son cambios, no sustituyen el plan inicial. La anotación de fills debe ser retrospectiva, posterior a la disponibilidad de esos fills y del mismo OCC/posición. Un fill no se atribuye a dos decisiones. Una decisión `no_trade` no acepta fills.
6. `npm run review-trades:phase17` crea solo en el directorio privado una vista por decisión que separa contexto inicial, señales F16 conocidas o no al decidir, fills, fuentes, comisiones, salida y cambios de plan. `npm run compare:phase17` conserva su vista sin resultados futuros. Ambos comandos pueden ejecutarse sin señales o sin operaciones humanas; en ese caso no aportan evidencia de desempeño.

## Orden temporal auditado

| Momento | Fuente | Qué permite afirmar |
| --- | --- | --- |
| `contextKnownAtUtc` y `drawnAtUtc` | Declaración humana | Indican disponibilidad **declarada** de contexto/niveles; sin fuente contemporánea siguen sin verificación independiente. |
| `decisionAtUtc` | Declaración humana | Momento atribuido a la decisión; no reemplaza la hora fija de registro. |
| `documentedAtUtc` | Diario append-only del sistema | Primer instante demostrable en este sistema para el contenido de la decisión o nota. |
| `availableAtUtc` / `firstDetectedAtUtc` | Señal congelada F16 | Confirmación y primera detección del sistema; solo aparece en la vista previa si ya era conocida al decidir. |
| `executed_at_utc` | CSV original del bróker | Hora declarada de cada compra o venta; no prueba que la decisión previa fuera prospectiva. |
| `importedAtUtc` | Sobre privado del sistema | Primer ingreso verificable del archivo en este almacén. Para fills superpuestos se usa su primera importación. |
| `lastSaleAtUtc` y `resultAvailableInStoreAtUtc` | Fills y sobres privados | Venta final/importación necesaria para calcular resultado; ambas se presentan en revisión, nunca en vista previa. |
| `planChangedAtUtc` y hora de la nueva nota | Declaración y diario | Distingue cuándo se dice que cambió el plan de cuándo quedó documentado. La anotación tardía no se vuelve prospectiva. |

Las comparaciones con F16 conservan el detector original y no alteran señales ni desenlaces de Fases 9–16. `documentedBeforeFirstPurchase` se informa para cada posición vinculada; si es falso, la revisión no presenta esa selección como previa a la compra. `realizedGross` y `realizedNet` son montos de fills reales **solo cuando existan**; la MFE de estudios históricos no se usa como prima ejecutable. Sin cotizaciones bid/ask históricas de opciones no se infiere la calidad de ejecución.

Los sobres del bróker pueden contener información sensible aunque el CSV tenga la cabecera mínima. Los archivos permanecen en `output/phase17-private/`, ignorado por Git. No se publican audios, transcripciones privadas, capturas, números de cuenta, CSV fuente ni vistas privadas de revisión. Antes de una prueba con datos auténticos, confirmar el formato exportado, su autorización de uso y almacenamiento privado persistente. No se exige una operación ficticia para completar la infraestructura.
