# Fase 18 — datos derivados y auditoría de opciones

Protocolo congelado antes del cálculo real: [`docs/phase18-research-protocol.md`](../../docs/phase18-research-protocol.md), commit `8aecb621b4bf284320a9b2fa3e5f0a8fd8a5006f`. Todo el período es exploratorio. Ningún CSV SIP ni quote OPRA restringido se publica aquí.

- `phase18-report.md`: resultados y límites en español.
- `phase18-sma-structures.csv`: una fila por intervalo NVDA, estructura SMA horaria/diaria, niveles, Bollinger y contexto causal derivado; las columnas `posthoc_*` son desenlaces posteriores para auditoría y nunca se usan para definir estructuras.
- `phase18-pullback-events.csv`: aproximaciones, contactos, cruces y recuperaciones con episodio, hora conocida y desenlaces teóricos de 15/30/60 minutos.
- `phase18-descriptive-results.csv`: resultados por configuración/dirección/horizonte y referencias por año/hora.
- `phase18-previous-signals-comparison.csv`: cada señal congelada F11/F12 y su estructura, con verificación del retorno original.
- `phase18-options-provider-audit.md`: fuentes oficiales, cobertura, precios anunciados y licencia.
- `phase18-options-access-audit.json`: pruebas GET pequeñas de Alpaca, sin credenciales ni respuestas de mercado.
- `phase18-options-pilot.csv`: solo cabecera; el piloto no pudo ejecutarse sin quotes históricos OPRA autorizados.
- `phase18-options-pilot-report.md`: motivo y requisitos pendientes.
- `phase18-data-integrity.json`: hashes fuente, código y cobertura.
- `phase18-validation-report.md`: instalación, pruebas, validadores y preservación histórica.
- `SHA256SUMS.txt`: SHA-256 de los archivos anteriores y este README.

Reproducción autorizada desde `trading_poc_001_bollinger/`: disponer localmente de NVDA, QQQ y SMH de cinco años, sus `.meta.json`, `.calendar.json` y `.provenance.json` de Alpaca SIP, y los artefactos F11–F15. Ejecutar `npm ci`, `npm run typecheck`, `npm test` y `npm run study:phase18`. El importador Fase 18 **lee**, no descarga, esos CSV. Las sumas fuente se verifican antes de calcular. Desde esta carpeta: `sha256sum -c SHA256SUMS.txt`.

Los grupos, controles, intervalos y el piloto están definidos en el protocolo. Los resultados 2021–2026 no constituyen validación independiente ni justifican operaciones. La apertura siguiente de la acción es entrada teórica sin latencia, separada del escenario de ejecución de opciones que no pudo observarse.

Los números derivados de los CSV se publican redondeados a ocho decimales para mantener el tamaño del paquete razonable; los cálculos y la comparación exacta con los resultados históricos ocurren antes del redondeo.
