# Fase 16: observación prospectiva

Protocolo congelado: [phase16-protocol.md](phase16-protocol.md). Inicio: `2026-10-19T13:30:00.000Z`. Los CSV dry-run son pruebas históricas, no observaciones nuevas.

Archivos: `phase16-system-report.md` explica funcionamiento y límites; `phase16-data-access-audit.json` documenta permisos de feed; `phase16-dry-run-signals.csv` y `phase16-dry-run-settlements.csv` contienen la prueba de seis familias; `phase16-operator-journal-template.csv` solo tiene cabecera, sin decisiones ficticias; `phase16-reproducibility.json` fija hashes y versiones; `SHA256SUMS.txt` verifica los ocho archivos restantes.

Instale con `cd trading_poc_001_bollinger && npm ci`. Ejecute manualmente `npm run observe:phase16` y después `npm run settle:phase16`. Para una decisión humana, copie la plantilla CSV, complete exactamente una fila y ejecute `npm run journal:phase16 -- path/a/decision.csv`; el sistema fija `documentedAtUtc` con el reloj de ejecución. Compare con `npm run compare:phase16`. Reintentar no duplica IDs; ante una interrupción, elimine solo un `.write-lock` huérfano tras comprobar que ningún proceso sigue activo y valide la cadena antes de reanudar.

Revise cada lote nuevo en `live/ledger/` y haga commit/push manual de esos registros derivados a la rama autorizada. No incluya `output/phase16-private/` ni OHLCV SIP. Conserve el mismo checkout o restaure la última versión del diario desde GitHub antes de continuar. Las señales recibidas tarde siguen siendo hipotéticas. No se envían órdenes.
