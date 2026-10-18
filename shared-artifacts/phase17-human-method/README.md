# Fase 17: método discrecional documentable

Esta entrega define qué información debe observarse y cómo conservarla, sin afirmar que el método humano esté ya confirmado ni que sea rentable. El [método](phase17-method-specification.md) separa declaraciones, hipótesis, datos y ambigüedades. El [catálogo](phase17-feature-catalog.csv) enumera 37 descriptores candidatos con temporalidad, fórmula, datos y primera disponibilidad. Las [preguntas abiertas](phase17-open-questions.md) documentan lo que falta confirmar. Ningún audio, captura ni operación real se publica aquí.

Los otros archivos son la [plantilla humana](phase17-human-decision-template.csv), el [esquema de fills del bróker](phase17-broker-trades-schema.json), el [contrato futuro de cotizaciones de opciones](phase17-options-data-schema.json), el [diseño de comparación](phase17-comparison-design.md), el [informe de validación](phase17-validation-report.md) y [SHA256SUMS.txt](SHA256SUMS.txt). La plantilla contiene solo cabecera; no hay decisiones inventadas.

## Uso privado

En `trading_poc_001_bollinger/`, ejecute `npm ci`, `npm run typecheck` y `npm test`. Copie la plantilla, escriba una sola decisión en español y ejecute `npm run journal:phase17 -- /ruta/privada/decision.csv`. `recordMode` requiere `live`, `historical_reconstruction` o `post_outcome_annotation`; `documentedAtUtc` lo fija el sistema. El importador también acepta la cabecera CSV antigua de Fase 16. Los campos desconocidos quedan vacíos. Para `no_trade`, use `direction=no_trade` y `operationType=no_trade`; `rejectedSignalIds` solo se utiliza si la señal fue rechazada explícitamente y `observedMarket=true`.

Para un archivo original PNG/JPEG/WebP: `npm run attach-chart:phase17 -- /ruta/privada/grafico.png ID_CAPTURA [horaUTC]`. El original se copia por hash a almacenamiento privado y se conserva su hora declarada y `mtime` del archivo, identificado como metadato no verificado. Relacione su ID y SHA-256 con la decisión. Los niveles o anotaciones manuales permanecen separados de los niveles calculados; si no conoce su hora de trazado, no se atribuyen a una decisión anterior.

El CSV del bróker contiene una fila por fill y exactamente la cabecera del esquema. Ejecute `npm run import:broker:phase17 -- /ruta/privada/fills.csv`. Compras y ventas parciales se casan FIFO por OCC; las comisiones vacías dejan el neto calculado en `null`. El programa no importa números de cuenta, no inventa bid/ask y no publica el CSV bruto. `npm run compare:phase17` relaciona el diario privado con las señales F16 existentes y escribe una vista sin desenlaces posteriores.

`PHASE17_PRIVATE_DIR` permite elegir el directorio privado persistente. `PHASE16_JOURNAL_DIR` apunta al diario de señales congeladas; el valor predeterminado es `shared-artifacts/phase16-forward-observation/live/ledger`, que puede estar vacío antes de iniciar la observación real. Una comparación sin señales o sin decisiones humanas reales solo comprueba el funcionamiento, no aporta evidencia de desempeño.

Por defecto, diario, capturas, importaciones y comparaciones quedan en `trading_poc_001_bollinger/output/phase17-private/`, excluido de Git. Conserve una copia privada persistente: el directorio temporal de Codex no garantiza continuidad entre entornos. Revise la privacidad antes de compartir cualquier resultado humano. Esta fase no solicita datos masivos de opciones, no ejecuta órdenes y no modifica las reglas congeladas.

Verifique el paquete publicado desde este directorio con `sha256sum -c SHA256SUMS.txt`.
