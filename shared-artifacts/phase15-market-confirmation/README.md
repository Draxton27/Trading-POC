# Fase 15: concordancia de mercado

Estudio exploratorio de señales históricas de NVDA y retornos previos de QQQ/SMH. Protocolo: [phase15-research-protocol.md](../../docs/phase15-research-protocol.md), commit `7ab491edb2c040b096213764ded69352cf593aad`. Código ejecutado: `9ff477c9a141f8b324afa30318e9e154234e2a24`.

- `phase15-report.md`: informe en español, decisión y límites.
- `phase15-results.json`: estimaciones, incertidumbre, desgloses y auditoría estructurados.
- `phase15-signal-analysis.csv`: las 1242 señales individuales con grupo, resultados, riesgo, costos y noticias.
- `phase15-group-comparison.csv`: contraste principal y desgloses por familia, año, régimen y horario.
- `phase15-robustness.csv`: cruces secundarios familia-año y familia-régimen.
- `phase15-data-audit.md`: trazabilidad, cobertura, exclusiones y hashes.
- `SHA256SUMS.txt`: integridad de los otros siete archivos.

Reproducción en entorno autorizado: `cd trading_poc_001_bollinger && npm ci && npm run validate:phase15-confirmation`. Requiere archivos originales F11–F14 y CSV SIP local de NVDA; no descarga datos. El CSV fuente SIP no se redistribuye porque la licencia pública no está verificada.
