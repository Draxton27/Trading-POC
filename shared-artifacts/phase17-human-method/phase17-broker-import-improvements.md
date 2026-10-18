# Fase 17 — importación de fills distribuidos entre archivos

La versión inicial del PR #23 emparejaba FIFO dentro de un solo CSV. Si `A.csv` contenía dos compras y `B.csv` una venta parcial, `B.csv` aislado fallaba por falta de inventario. La revisión reconstruye **todo el inventario desde los CSV originales privados** cada vez que se importa o consulta el estado. No migra los JSON one-off anteriores sin recuperar sus CSV fuente.

## Contrato de reconstrucción

1. `npm run import:broker:phase17 -- /ruta/privada/A.csv` copia sus bytes en un sobre JSON privado e inmutable `output/phase17-private/broker-sources/<SHA-256>.json`. El sobre conserva el CSV original en base64, el hash, la hora UTC real de importación y el nombre base del archivo; `envelopeSha256` protege esos metadatos frente a cambios accidentales. A continuación se importan B, C, etc. Ningún sobre se versiona en Git.
2. Cada lectura verifica el SHA-256 de los bytes originales y la cabecera documentada. Las fuentes se recorren por hash; los fills se ordenan por timestamp UTC y, si comparten hora y lado, por `execution_id`. Una compra y una venta del mismo OCC en el mismo instante se rechazan porque su orden no puede inferirse.
3. Un `execution_id` idéntico con todos los campos originales idénticos cuenta una sola vez, incluso en archivos superpuestos. El mismo ID con cualquier contenido distinto aborta **antes** de conservar el nuevo archivo. `executionSources` registra todos los hashes de archivo que contienen cada ejecución.
4. El inventario FIFO se separa por símbolo OCC exacto. La primera compra sin inventario inicia una posición larga con ID estable; compras adicionales y ventas parciales comparten ese ID hasta que la cantidad llega a cero. Un nuevo ciclo posterior crea otra posición. Una venta mayor que el inventario disponible se rechaza.
5. Cada venta calcula el movimiento bruto de las unidades casadas. La comisión de la compra se reparte según la cantidad vendida y la de la venta se carga una vez. Si falta una comisión necesaria, `realizedNet` queda `null`. El resultado realizado de una posición todavía abierta se distingue del resultado total definitivo.
6. El estado no depende de un snapshot mutable: `npm run broker-state:phase17` vuelve a verificar y calcularlo. Reimportar el mismo CSV devuelve `alreadyPresent=true` y el mismo hash de estado. Un bloqueo de importación evita carreras; si el proceso dueño desapareció, se recupera. Un archivo temporal incompleto no entra en el inventario.

El ejemplo sintético A (compra 2), B (venta 1), C (venta 1) forma **una posición**; después de B queda un contrato abierto y después de C queda cero. Se prueba también mediante un proceso Node nuevo. Los CSV sintéticos y el estado privado de prueba nunca se publican como operaciones reales.

## Alcance y límites

El almacén representa una sola identidad de bróker por directorio privado. Solo admite opciones largas estándar de multiplicador 100: BUY aumenta inventario y SELL lo reduce. No interpreta spreads, ventas para abrir, opciones ajustadas ni contratos con otro multiplicador. No dispone de bid/ask históricos por importar primas de transacción. Los timestamps provienen del CSV, mientras que `importedAtUtc` registra cuándo el sistema recibió el archivo; una reconstrucción histórica no se vuelve prospectiva por poseer horas antiguas de compra y venta.

Si una importación se corta antes de publicar el sobre original, un reintento con el mismo CSV lo reconstruye. Si se corta después de publicarlo, el reintento detecta el hash existente. Un sobre cuyo contenido no coincide con su nombre/hash se rechaza; no se corrige silenciosamente. Ante un bloqueo cuya propiedad no pueda verificarse, revise el proceso antes de intervenir manualmente. Conserve copias privadas de los CSV y de `output/phase17-private/` en almacenamiento persistente autorizado: el entorno temporal de Codex no es archivo permanente.
