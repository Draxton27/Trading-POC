# Artefactos de Fase 12: NVDA

Estudio exploratorio de rupturas fallidas del máximo y mínimo de la sesión bursátil anterior. Protocolo fijado antes del análisis en [docs/phase12-research-protocol.md](../../docs/phase12-research-protocol.md).

Versión exacta del código usada: `51ac6bdc67f0249897160eb81b3ae6940c2ef252`. SHA-256 del CSV fuente: `7b06d0a493515b18a581963d2d2d488e73a7cd0dc2c961b60a99315e7a9b0ecc`. El historial SIP original no se redistribuye en esta carpeta. Se necesita el CSV local de cinco años y sus archivos `.meta.json`, `.calendar.json` y `.provenance.json`, con los hashes registrados en `phase12-data-audit.md`. No se necesitan credenciales para repetir el análisis.

Desde `trading_poc_001_bollinger/`, usando ese código y los archivos de entrada:

```bash
npm ci
npm run validate:nvda-failed-breakouts -- data/NVDA_ALPACA_SIP_15min_20211017_20261017.csv
```

- [phase12-report.md](phase12-report.md): conclusiones, tablas principales y negativas, costos, años y límites.
- [phase12-results.json](phase12-results.json): resultados estructurados, todos los episodios y señales.
- [phase12-signals.csv](phase12-signals.csv): cada falla confirmada, tres horizontes, MFE/MAE y controles.
- [phase12-events.csv](phase12-events.csv): cada ruptura inicial, regreso o no regreso, con timestamps.
- [phase12-data-audit.md](phase12-data-audit.md): cobertura, calendario, hashes y procedencia.
- [SHA256SUMS.txt](SHA256SUMS.txt): hashes de los seis archivos anteriores, incluido este README; el manifiesto se excluye de sí mismo.

El corte 70/30 y todos los años son retrospectivos; no constituyen validación prospectiva. MFE y MAE no suponen orden de máximos y mínimos dentro de cada vela ni ejecución garantizada.
