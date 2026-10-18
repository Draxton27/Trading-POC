# Artefactos de Fase 14

Protocolo: [docs/phase14-data-protocol.md](../../docs/phase14-data-protocol.md).
Código usado: `01f3aaf1fa665ac41685a9a131e6315f0ae70156`. SHA-256 NVDA fuente: `7b06d0a493515b18a581963d2d2d488e73a7cd0dc2c961b60a99315e7a9b0ecc`.

- `phase14-report.md`: informe y limitaciones en español.
- `phase14-data-audit.json`: cobertura, distribución por año/horario, eventos y hashes.
- `phase14-synchronized-bars.csv`: una fila por intervalo, marcas de cobertura/evento y hash de la fila privada; OHLCV retenido localmente por permisos SIP no verificados.
- `phase14-economic-events.csv`: cada CPI, Employment Situation y pieza FOMC con fecha, hora verificada si existe y fuente.
- `phase14-nvda-corporate-events.csv`: fechas verificadas de resultados NVIDIA, sin hora inventada.
- `phase14-signal-context.csv`: señales F11/F12 originales con régimen F13, variables porcentuales de QQQ/SMH y eventos conocidos.
- `phase14-source-manifest.json`: URLs, fechas de consulta, hashes y condición de redistribución.
- `SHA256SUMS.txt`: hashes de los siete archivos anteriores y este README; el manifiesto no se incluye a sí mismo.

Reproducción desde `trading_poc_001_bollinger/`, con los tres CSV SIP y sidecars privados cuyos hashes figuran en el manifiesto:

```bash
npm ci
npm run typecheck
npm test
NODE_USE_ENV_PROXY=1 npm run validate:phase14-context
```

Si faltan QQQ/SMH y se cuenta con acceso Alpaca autorizado, ejecutar primero `NODE_USE_ENV_PROXY=1 npm run import:phase14-market`. No se vuelve a descargar NVDA. El comando de validación escribe también `output/real/phase14-synchronized-bars-full.csv`, privado, con OHLCV y todas las variables por intervalo.

El período es exploratorio y las noticias sin hora verificable no se atribuyen causalmente a velas intradía.
